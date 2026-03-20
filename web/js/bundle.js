// ═══ ws.js ═══
/**
 * WebSocket service for Anagnorisis
 * Handles connection, message sending, and event dispatching
 */
class GameWebSocket {
  constructor() {
    this._ws = null;
    this._handlers = {};
    this._url = '';
    this._heartbeatInterval = null;
    this._reconnectAttempts = 0;
    this.connected = false;
    this.onConnect = null;
    this.onDisconnect = null;
  }

  connect(url) {
    this._url = url;
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(url);

        this._ws.onopen = () => {
          this.connected = true;
          this._reconnectAttempts = 0;
          this._startHeartbeat();
          if (this.onConnect) this.onConnect();
          resolve();
        };

        this._ws.onclose = () => {
          this.connected = false;
          this._stopHeartbeat();
          if (this.onDisconnect) this.onDisconnect();
        };

        this._ws.onerror = (err) => {
          reject(new Error('Connection failed'));
        };

        this._ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this._dispatch(msg);
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };

        // Timeout if connection hangs
        const timer = setTimeout(() => reject(new Error('Connection timed out')), 8000);
        this._ws.addEventListener('open', () => clearTimeout(timer));
      } catch (e) {
        reject(e);
      }
    });
  }

  send(type, payload = {}) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return false;
    this._ws.send(JSON.stringify({ type: type.toLowerCase(), payload }));
    return true;
  }

  on(type, handler) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(handler);
  }

  off(type, handler) {
    if (!this._handlers[type]) return;
    this._handlers[type] = this._handlers[type].filter(h => h !== handler);
  }

  disconnect() {
    this._stopHeartbeat();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this.connected = false;
  }

  _dispatch(msg) {
    // Match both lowercase (server) and uppercase (legacy) handler keys
    const lower = (msg.type || '').toLowerCase();
    const upper = lower.toUpperCase();
    [lower, upper].forEach(key => {
      if (this._handlers[key]) this._handlers[key].forEach(h => h(msg));
    });
    if (this._handlers['*']) this._handlers['*'].forEach(h => h(msg));
  }

  _startHeartbeat() {
    this._heartbeatInterval = setInterval(() => {
      this.send('HEARTBEAT', {});
    }, 25000);
  }

  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }
}

// ═══ state.js ═══
/**
 * Reactive game state store
 */
const _listeners = {};
const _state = {
  screen: 'login',
  connectionId: null,
  playerId: null,
  player: null,
  party: null,
  adventure: null,
  dungeon: null,
  combat: null,
  phase: 'exploring',
  gameDay: 1,
  gameHour: 6,
  parties: [],
  narrativeLog: [],
};

const state = new Proxy(_state, {
  set(target, key, value) {
    target[key] = value;
    if (_listeners[key]) _listeners[key].forEach(fn => fn(value, target));
    if (_listeners['*']) _listeners['*'].forEach(fn => fn(key, value, target));
    return true;
  }
});

function on(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
}

function off(key, fn) {
  if (!_listeners[key]) return;
  _listeners[key] = _listeners[key].filter(h => h !== fn);
}

function get() {
  return _state;
}

/** Merge a STATE_UPDATE payload into state */
function applyStateUpdate(payload) {
  if (payload.player  !== undefined) state.player  = payload.player;
  if (payload.party   !== undefined) state.party   = payload.party;
  if (payload.dungeon !== undefined) state.dungeon = payload.dungeon;
  if (payload.combat  !== undefined) state.combat  = payload.combat;
  if (payload.phase   !== undefined) state.phase   = payload.phase;
  if (payload.explore_turn_order      !== undefined) state.exploreTurnOrder    = payload.explore_turn_order;
  if (payload.explore_active_player_id !== undefined) state.exploreActivePid  = payload.explore_active_player_id;
  // Server often sends player_stats instead of full player object
  if (payload.player_stats !== undefined && state.player) {
    state.player = { ...state.player, stats: payload.player_stats };
  }
  // Inventory updates from loot/item use
  if (payload.inventory !== undefined && state.player) {
    state.player = { ...state.player, inventory: payload.inventory };
  }
  // Party member live stats (keyed by player id)
  if (payload.party_members_stats !== undefined) {
    state.partyMembersStats = {};
    (payload.party_members_stats || []).forEach(m => {
      state.partyMembersStats[m.id] = m;
    });
  }
}

// ═══ la-map.js ═══
/**
 * LA Map — Real-world Leaflet map for Anagnorisis
 * Dungeon rooms are pinned to real LA locations (Ingress/Pokémon Go style)
 * Uses OpenStreetMap + CartoDB Dark tiles — completely free, no API key
 */

// ── Real LA location zones ──────────────────────────────────────────────────
// Each zone has 7 locations (one per dungeon room: r0-r6)
const ZONES = [
  {
    name: 'Griffith Park',
    zoom: 14,
    center: [34.1184, -118.2948],
    locations: [
      { name: 'Griffith Observatory',     lat: 34.1184, lng: -118.3004 },
      { name: 'Mount Hollywood Trail',    lat: 34.1225, lng: -118.2977 },
      { name: 'The Old Zoo Ruins',        lat: 34.1280, lng: -118.2871 },
      { name: 'Bronson Cave',             lat: 34.1264, lng: -118.3185 },
      { name: 'Beacon Hill Vista',        lat: 34.1060, lng: -118.2948 },
      { name: 'Travel Town Railroad',     lat: 34.1385, lng: -118.2897 },
      { name: 'Fern Dell Dark Forest',    lat: 34.1055, lng: -118.3060 },
    ],
  },
  {
    name: 'Downtown LA',
    zoom: 15,
    center: [34.0522, -118.2437],
    locations: [
      { name: 'Grand Central Market',     lat: 34.0502, lng: -118.2497 },
      { name: 'Angels Flight Railway',    lat: 34.0511, lng: -118.2494 },
      { name: 'The Bradbury Building',    lat: 34.0505, lng: -118.2480 },
      { name: 'Pershing Square',          lat: 34.0485, lng: -118.2518 },
      { name: 'The Last Bookstore',       lat: 34.0498, lng: -118.2508 },
      { name: 'Union Station Tunnels',    lat: 34.0560, lng: -118.2362 },
      { name: 'City Hall Undercroft',     lat: 34.0537, lng: -118.2427 },
    ],
  },
  {
    name: 'Venice & Canals',
    zoom: 15,
    center: [33.9850, -118.4695],
    locations: [
      { name: 'Venice Beach Boardwalk',   lat: 33.9850, lng: -118.4738 },
      { name: 'Muscle Beach',             lat: 33.9832, lng: -118.4727 },
      { name: 'Venice Canals',            lat: 33.9818, lng: -118.4637 },
      { name: 'Abbot Kinney Blvd',        lat: 33.9895, lng: -118.4659 },
      { name: 'Windward Plaza',           lat: 33.9870, lng: -118.4733 },
      { name: 'Ocean Front Walk',         lat: 33.9762, lng: -118.4717 },
      { name: 'The Venice Pier',          lat: 33.9847, lng: -118.4793 },
    ],
  },
  {
    name: 'Hollywood Hills',
    zoom: 14,
    center: [34.1150, -118.3400],
    locations: [
      { name: 'Hollywood Sign Trailhead', lat: 34.1341, lng: -118.3215 },
      { name: 'Lake Hollywood Park',      lat: 34.1200, lng: -118.3347 },
      { name: 'Cahuenga Peak',            lat: 34.1371, lng: -118.3257 },
      { name: 'Runyon Canyon Summit',     lat: 34.1018, lng: -118.3532 },
      { name: 'Mulholland Overlook',      lat: 34.1250, lng: -118.3570 },
      { name: 'Wisdom Tree',             lat: 34.1328, lng: -118.3242 },
      { name: 'The Hollywood Sign',       lat: 34.1341, lng: -118.3215 },
    ],
  },
  {
    name: 'Silver Lake & Echo Park',
    zoom: 15,
    center: [34.0872, -118.2706],
    locations: [
      { name: 'Echo Park Lake',           lat: 34.0782, lng: -118.2606 },
      { name: 'Silver Lake Reservoir',    lat: 34.0952, lng: -118.2736 },
      { name: 'Elysian Park Caves',       lat: 34.0820, lng: -118.2480 },
      { name: 'Dodger Stadium Tunnels',   lat: 34.0739, lng: -118.2400 },
      { name: 'Sunset Junction',          lat: 34.0885, lng: -118.2720 },
      { name: 'Barnsdall Art Park',       lat: 34.1039, lng: -118.2903 },
      { name: 'Vista del Valle',          lat: 34.0915, lng: -118.2585 },
    ],
  },
];

const ROOM_ICONS = {
  start:    '🚪',
  corridor: '🏚',
  chamber:  '⚔️',
  treasure: '💰',
  boss:     '💀',
};

// Maps game_role (from POI classifier) → display emoji for map markers
const ROLE_ICONS = {
  tavern:          '🍺',
  inn:             '🏨',
  training_hall:   '⚔️',
  mage_tower:      '📚',
  academy:         '🎓',
  healer_shrine:   '✨',
  merchant_guild:  '💰',
  bardic_stage:    '🎭',
  general_store:   '🏪',
  guard_post:      '🛡️',
  warrior_hall:    '🔥',
  cursed_ground:   '💀',
  waypoint:        '🚌',
  grove:           '🌿',
  arena:           '🏟️',
  ancient_archive: '🏛️',
  ancient_altar:   '⚱️',
  overlook:        '🔭',
  armory:          '⚔️',
  temple:          '🙏',
  mystery:         '❓',
  start:           '🚪',
};

class LAMap {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markers = {};
    this.lines = [];
    this.playerDot = null;         // GPS dot
    this.proximityCircle = null;   // 80 m ring around player
    this.roomLocations = {};  // roomId → [lat, lng]
    this.roomNames = {};      // roomId → real location name
    this.zone = null;
    this._assigned = false;
    this._poiMode = false;         // true when rooms carry real lat/lng
    this.onRoomClick = null;  // callback(roomId)
    this._poiLayer = null;         // full discovery POI layer
    this._poiFetched = false;
  }

  init() {
    if (this.map) return;

    // Start at player GPS if available, otherwise world-level zoom
    const gps = getPosition();
    const center = gps ? [gps.lat, gps.lng] : [20, 0];
    const zoom   = gps ? 14 : 3;

    this.map = L.map(this.containerId, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: false,
    });

    // CartoDB Dark Matter — free dark-themed tiles, perfect for a game
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
  }

  /**
   * Assign locations to rooms.
   * POI mode: rooms already carry real lat/lng from OpenStreetMap — use them.
   * Classic fallback: pick a random hardcoded zone only when no real coords exist.
   */
  assignLocations(rooms) {
    this._assigned = true;

    const roomList = Object.values(rooms);
    const hasPOICoords = roomList.some(r => r.lat != null && r.lng != null);

    if (hasPOICoords) {
      // Real GPS mode — every room has actual coordinates
      this._poiMode = true;
      roomList.forEach(room => {
        if (room.lat != null && room.lng != null) {
          this.roomLocations[room.id] = [room.lat, room.lng];
          this.roomNames[room.id] = room.name;
        }
      });
    } else {
      // Fallback: no real coords — use a classic zone
      this._poiMode = false;
      this.zone = ZONES[Math.floor(Math.random() * ZONES.length)];
      const locs = this.zone.locations;
      Object.keys(rooms).forEach((id, i) => {
        const loc = locs[i % locs.length];
        this.roomLocations[id] = [loc.lat, loc.lng];
        this.roomNames[id]     = loc.name;
      });
    }
  }

  /** Update the player's real GPS dot. Called on every GPS position update. */
  updatePlayerPosition(lat, lng) {
    if (!this.map) return;
    if (this.playerDot) {
      this.playerDot.setLatLng([lat, lng]);
      if (this.proximityCircle) this.proximityCircle.setLatLng([lat, lng]);
      return;
    }
    this.playerDot = L.circleMarker([lat, lng], {
      radius: 8, fillColor: '#c9a84c', color: '#fff', weight: 2, fillOpacity: 0.9,
    }).addTo(this.map);
    this.playerDot.bindTooltip('📍 You are here', { permanent: false });
    this.proximityCircle = L.circle([lat, lng], {
      radius: 80, color: '#c9a84c', fillColor: '#c9a84c',
      fillOpacity: 0.04, weight: 1, dashArray: '3 3',
    }).addTo(this.map);
    // Also pan map to player
    this.map.flyTo([lat, lng], this.map.getZoom(), { duration: 1.0 });
  }

  clearPlayerPosition() {
    if (this.playerDot) { this.playerDot.remove(); this.playerDot = null; }
    if (this.proximityCircle) { this.proximityCircle.remove(); this.proximityCircle = null; }
  }

  /** Full re-render of the map from dungeon state */
  render(dungeon) {
    if (!dungeon || !dungeon.rooms || !this.map) return;

    if (!this._assigned) this.assignLocations(dungeon.rooms);

    this._clearOverlays();

    const rooms = dungeon.rooms;

    // Draw connection lines first (under markers)
    Object.values(rooms).forEach(room => {
      const fromCoord = this.roomLocations[room.id];
      if (!fromCoord) return;
      Object.values(room.exits || {}).forEach(targetId => {
        const toCoord = this.roomLocations[targetId];
        if (!toCoord) return;
        const bothExplored = room.explored && rooms[targetId]?.explored;
        const line = L.polyline([fromCoord, toCoord], {
          color: bothExplored ? '#7a6830' : '#3a3020',
          weight: bothExplored ? 2 : 1.5,
          dashArray: bothExplored ? null : '5 5',
          opacity: bothExplored ? 0.9 : 0.5,
        }).addTo(this.map);
        this.lines.push(line);
      });
    });

    // Draw markers
    Object.values(rooms).forEach(room => {
      const coord = this.roomLocations[room.id];
      if (!coord) return;
      const isCurrent = room.id === dungeon.current_room_id;
      const marker = this._makeMarker(room, coord, isCurrent);
      marker.addTo(this.map);
      this.markers[room.id] = marker;
    });

    // Pan to current room
    const cur = this.roomLocations[dungeon.current_room_id];
    if (cur) {
      const zoom = this._poiMode ? 16 : (this.zone?.zoom || 14);
      this.map.flyTo(cur, zoom, { duration: 1.2 });
    }
  }

  /** Get the real location name for a room */
  getRoomName(roomId) {
    return this.roomNames[roomId] || null;
  }

  getZoneName() {
    return this._poiMode ? 'Your Neighbourhood' : (this.zone?.name || 'Los Angeles');
  }

  /** Fetch ALL nearby POIs from Overpass and render them as a faint discovery layer */
  async fetchPOILayer(lat, lng, dungeonRoomIds = new Set()) {
    if (this._poiFetched || !this.map) return;
    this._poiFetched = true;
    try {
      const r = await fetch(`/nearby-rooms?lat=${lat}&lng=${lng}&radius=1200`);
      if (!r.ok) return;
      const data = await r.json();
      const pois = data.pois || [];
      if (!pois.length) return;

      // Remove old layer
      if (this._poiLayer) { this._poiLayer.clearLayers(); }
      else { this._poiLayer = L.layerGroup().addTo(this.map); }

      pois.forEach(poi => {
        if (!poi.lat || !poi.lng) return;
        const isDungeon = dungeonRoomIds.has(poi.name) || dungeonRoomIds.has(poi.osm_id);
        if (isDungeon) return; // dungeon rooms have their own full markers

        const icon = ROLE_ICONS[poi.game_role] || '📍';
        const html = `<div class="la-poi-dot" title="${poi.name}">${icon}</div>`;
        const leafIcon = L.divIcon({ html, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
        const m = L.marker([poi.lat, poi.lng], { icon: leafIcon });
        const popup = `<div style="font-family:'Roboto Mono',monospace;font-size:11px;min-width:140px">
          <strong style="color:#c9a84c">${poi.name}</strong><br>
          <span style="color:#6a5f50;font-size:10px;text-transform:uppercase">${poi.game_role || 'location'}</span>
          ${poi.distance_m != null ? `<br><span style="color:#a09585">📍 ${poi.distance_m}m away</span>` : ''}
          ${(poi.services||[]).length ? `<br><span style="color:#6a5f50;font-size:10px">${poi.services.slice(0,2).join(' · ')}</span>` : ''}
        </div>`;
        m.bindPopup(popup, { className: 'la-popup' });
        this._poiLayer.addLayer(m);
      });
    } catch (e) {
      console.warn('[LAMap] POI layer fetch failed:', e.message);
    }
  }

  reset() {
    this._clearOverlays();
    this.clearPlayerPosition();
    this._assigned = false;
    this._poiMode = false;
    this._poiFetched = false;
    this.roomLocations = {};
    this.roomNames = {};
    this.zone = null;
    if (this._poiLayer) { this._poiLayer.clearLayers(); this._poiLayer = null; }
  }

  _makeMarker(room, coord, isCurrent) {
    const explored  = room.explored;
    const cleared   = room.cleared;
    const hasEnemy  = room.enemies?.some(e => e.hp > 0);
    const roleIcon  = ROLE_ICONS[room.game_role] || null;
    const icon      = roleIcon || ROOM_ICONS[room.room_type] || '❓';
    const realName  = this.roomNames[room.id] || room.name;

    const distLabel = (this._poiMode && room.distance_m != null)
      ? `<span class="la-marker__dist">${room.distance_m}m</span>`
      : '';

    const classes = [
      'la-marker',
      isCurrent  ? 'la-marker--current'   : '',
      !explored  ? 'la-marker--fog'        : '',
      cleared    ? 'la-marker--cleared'   : '',
      hasEnemy   ? 'la-marker--danger'    : '',
      room.room_type === 'boss' ? 'la-marker--boss' : '',
    ].filter(Boolean).join(' ');

    const html = `
      <div class="${classes}">
        <span class="la-marker__icon">${explored ? icon : '?'}</span>
        ${distLabel}
        ${hasEnemy  ? '<span class="la-marker__dot la-marker__dot--enemy"></span>'  : ''}
        ${cleared && !hasEnemy ? '<span class="la-marker__dot la-marker__dot--clear"></span>' : ''}
        ${isCurrent ? '<div class="la-marker__ring"></div>' : ''}
      </div>`;

    const leafletIcon = L.divIcon({ html, className: '', iconSize: [40, 50], iconAnchor: [20, 25] });
    const marker = L.marker(coord, { icon: leafletIcon });

    // Popup with real location info
    const servicesHtml = (room.services || []).length
      ? `<br><span style="color:#888;font-size:10px">${room.services.slice(0, 3).join(' · ')}</span>`
      : '';
    const popupHtml = `
      <div style="font-family:'Roboto Mono',monospace;font-size:12px;min-width:160px">
        <strong style="color:#c9a84c">${realName}</strong><br>
        <span style="color:#777;font-size:10px;text-transform:uppercase;letter-spacing:1px">${room.game_role || room.room_type}</span>
        ${room.distance_m != null ? `<br><span style="color:#c9a84c">📍 ${room.distance_m}m away</span>` : ''}
        ${!explored  ? '<br><span style="color:#555">⬛ Unexplored</span>' : ''}
        ${hasEnemy   ? '<br><span style="color:#e53935">⚔ Enemies here</span>'  : ''}
        ${cleared    ? '<br><span style="color:#43a047">✓ Cleared</span>'       : ''}
        ${room.gold > 0 && !cleared ? `<br><span style="color:#c9a84c">💰 ${room.gold} gold</span>` : ''}
        ${servicesHtml}
      </div>`;
    marker.bindPopup(popupHtml, { className: 'la-popup' });

    if (this.onRoomClick) {
      marker.on('click', () => this.onRoomClick(room.id));
    }

    return marker;
  }

  _clearOverlays() {
    Object.values(this.markers).forEach(m => m.remove());
    this.markers = {};
    this.lines.forEach(l => l.remove());
    this.lines = [];
  }
}

// ═══ gps.js ═══
/**
 * GPS Module — Real-world location tracking for Anagnorisis
 */

const PROXIMITY_THRESHOLD_M = 80;

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const _gpsState = {
  position: null,
  watchId: null,
  manual: false,
  simulating: false,
  listeners: new Set(),
};

function startWatching() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return; }
    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 };
    _gpsState.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const prev = _gpsState.position;
        _gpsState.position = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        _gpsState.manual = false;
        const moved = !prev || haversineM(prev.lat, prev.lng, _gpsState.position.lat, _gpsState.position.lng) > 5;
        if (moved) _gpsEmit();
        resolve(_gpsState.position);
      },
      (err) => reject(err),
      opts,
    );
  });
}

function setManualPosition(latOrObj, lng) {
  if (typeof latOrObj === 'string') {
    const parts = latOrObj.split(',').map(Number);
    _gpsState.position = { lat: parts[0], lng: parts[1], accuracy: 1000 };
  } else if (typeof latOrObj === 'object') {
    _gpsState.position = { lat: latOrObj.lat, lng: latOrObj.lng, accuracy: 1000 };
  } else {
    _gpsState.position = { lat: Number(latOrObj), lng: Number(lng), accuracy: 1000 };
  }
  _gpsState.manual = true;
  _gpsState.simulating = false;
  _gpsEmit();
}

function enableSimulateTravel() { _gpsState.simulating = true; _gpsEmit(); }
function disableSimulateTravel() { _gpsState.simulating = false; _gpsEmit(); }
function getPosition() { return _gpsState.position ? { ..._gpsState.position } : null; }
function isManual() { return _gpsState.manual; }
function isSimulating() { return _gpsState.simulating; }
function isGPSActive() { return _gpsState.watchId !== null && !_gpsState.manual; }

async function getIPGeolocation() {
  try {
    const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (r.ok) { const d = await r.json(); if (d.latitude && d.longitude) return { lat: d.latitude, lng: d.longitude, city: d.city || d.region || '' }; }
  } catch { /* fall through */ }
  try {
    const r = await fetch('https://ipinfo.io/json', { cache: 'no-store' });
    if (r.ok) { const d = await r.json(); if (d.loc) { const [lat, lng] = d.loc.split(',').map(Number); return { lat, lng, city: d.city || '' }; } }
  } catch { /* fall through */ }
  return null;
}

function isNearby(targetLat, targetLng) {
  if (_gpsState.simulating) return true;
  if (!_gpsState.position) return true;
  if (targetLat == null || targetLng == null) return true;
  return haversineM(_gpsState.position.lat, _gpsState.position.lng, targetLat, targetLng) <= PROXIMITY_THRESHOLD_M;
}

function distanceTo(targetLat, targetLng) {
  if (!_gpsState.position || targetLat == null || targetLng == null) return null;
  return Math.round(haversineM(_gpsState.position.lat, _gpsState.position.lng, targetLat, targetLng));
}

function onGPSUpdate(fn) { _gpsState.listeners.add(fn); return () => _gpsState.listeners.delete(fn); }

function _gpsEmit() {
  const snap = { position: _gpsState.position ? { ..._gpsState.position } : null, manual: _gpsState.manual, simulating: _gpsState.simulating };
  _gpsState.listeners.forEach(fn => fn(snap));
}

// ═══ app.js ═══
/**
 * Anagnorisis — Main Web Application
 * Handles all screens, UI rendering, and WebSocket message dispatch
 */


// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

/** Player stats live under player.stats — this helper flattens access */
function ps(player) { return (player && player.stats) ? player.stats : (player || {}); }

const CLASSES = {
  warrior: {
    emoji: '⚔️', figure: '🪖', weapon: '🗡️', name: 'Warrior', tag: 'Iron & Blood',
    color: '#e53935', colorDim: 'rgba(229,57,53,0.15)', anim: 'warrior-float',
    lore: 'Forged in countless battles, you are a living weapon — iron will, iron fists.',
    stats: { str: 5, int: 1, dex: 3, hp: 5 },
  },
  mage: {
    emoji: '🔮', figure: '🧙', weapon: '✨', name: 'Mage', tag: 'Arcane Sovereign',
    color: '#9060e0', colorDim: 'rgba(144,96,224,0.15)', anim: 'mage-pulse',
    lore: 'Master of the arcane arts. Reality bends to your will, but flesh is fragile.',
    stats: { str: 1, int: 5, dex: 2, hp: 2 },
  },
  rogue: {
    emoji: '🗡️', figure: '🥷', weapon: '💨', name: 'Rogue', tag: 'Shadow & Steel',
    color: '#d4a54a', colorDim: 'rgba(212,165,74,0.15)', anim: 'rogue-flicker',
    lore: 'From the shadows you strike — unseen, unheard, unstoppable.',
    stats: { str: 3, int: 2, dex: 5, hp: 3 },
  },
  cleric: {
    emoji: '✨', figure: '🧝', weapon: '🙏', name: 'Cleric', tag: 'Light of the Divine',
    color: '#f0cc6a', colorDim: 'rgba(240,204,106,0.15)', anim: 'cleric-glow',
    lore: 'Blessed by the gods, you channel divine light to heal allies and smite evil.',
    stats: { str: 2, int: 4, dex: 2, hp: 4 },
  },
  ranger: {
    emoji: '🏹', figure: '🧙‍♀️', weapon: '🌿', name: 'Ranger', tag: 'Eyes of the Wild',
    color: '#43a047', colorDim: 'rgba(67,160,71,0.15)', anim: 'ranger-sway',
    lore: 'One with nature — your arrows fly true and the wilderness answers your call.',
    stats: { str: 3, int: 3, dex: 4, hp: 3 },
  },
  goblin: {
    emoji: '👺', figure: '👺', weapon: '🦴', name: 'Goblin', tag: 'Born to Brawl',
    color: '#7cb342', colorDim: 'rgba(124,179,66,0.15)', anim: 'warrior-float',
    lore: 'You are an absolute unit of pure violence. Tiny brain, enormous fists, zero regrets.',
    stats: { str: 5, int: 1, dex: 2, hp: 5 },
  },
};

const SKILLS = {
  // Warrior
  slash:          { name: 'Slash',          emoji: '⚔️',  mp: 10, desc: 'A powerful sword strike dealing bonus damage.' },
  shield_bash:    { name: 'Shield Bash',    emoji: '🛡️',  mp: 8,  desc: 'Bash the enemy, stunning them for one turn.' },
  battle_cry:     { name: 'Battle Cry',     emoji: '📣',  mp: 12, desc: 'Raise your attack power for 3 turns.' },
  power_strike:   { name: 'Power Strike',   emoji: '💥',  mp: 18, desc: '2x damage physical blow.' },
  iron_skin:      { name: 'Iron Skin',      emoji: '🪨',  mp: 10, desc: 'Reduce incoming damage for 4 turns.' },
  whirlwind:      { name: 'Whirlwind',      emoji: '🌀',  mp: 22, desc: 'Strike all enemies in a spinning blow.' },
  cleave:         { name: 'Cleave',         emoji: '🪓',  mp: 15, desc: 'Heavy cleave that weakens the enemy.' },
  execute:        { name: 'Execute',        emoji: '⚰️',  mp: 20, desc: 'Extra damage on weakened foes.' },
  taunt:          { name: 'Taunt',          emoji: '😤',  mp: 8,  desc: 'Stun enemies with intimidation.' },
  // Mage
  fireball:       { name: 'Fireball',       emoji: '🔥',  mp: 20, desc: 'Hurl a ball of fire that ignores armor.' },
  frost_shield:   { name: 'Frost Shield',   emoji: '❄️',  mp: 15, desc: 'Conjure ice armor, halving damage for 3 turns.' },
  arcane_missile: { name: 'Arcane Missile', emoji: '💫',  mp: 10, desc: 'A bolt of pure arcane energy.' },
  chain_lightning:{ name: 'Chain Lightning',emoji: '⚡',  mp: 25, desc: 'Lightning arcs through all enemies.' },
  blink:          { name: 'Blink',          emoji: '🌀',  mp: 18, desc: 'Teleport dodge — stun enemy next turn.' },
  time_warp:      { name: 'Time Warp',      emoji: '⌛',  mp: 30, desc: 'Slow time: skip enemy next 2 turns.' },
  ice_lance:      { name: 'Ice Lance',      emoji: '🔵',  mp: 15, desc: 'Frozen projectile — applies Frozen.' },
  mana_surge:     { name: 'Mana Surge',     emoji: '🔮',  mp: 5,  desc: 'Restore MP by dealing arcane damage.' },
  // Rogue
  backstab:       { name: 'Backstab',       emoji: '🗡️',  mp: 15, desc: 'Strike from the shadows for massive damage.' },
  stealth:        { name: 'Stealth',        emoji: '👤',  mp: 10, desc: 'Vanish! Next attack deals 2x damage.' },
  pickpocket:     { name: 'Pickpocket',     emoji: '💰',  mp: 5,  desc: 'Steal gold from an enemy.' },
  smoke_screen:   { name: 'Smoke Screen',   emoji: '💨',  mp: 12, desc: 'Blind enemy, dropping their attack.' },
  cripple:        { name: 'Cripple',        emoji: '🦵',  mp: 16, desc: 'Weaken enemy — reduce defense 2 turns.' },
  shadow_step:    { name: 'Shadow Step',    emoji: '🌑',  mp: 20, desc: 'Shadowstep deal double poison dmg.' },
  fan_of_blades:  { name: 'Fan of Blades',  emoji: '🪃',  mp: 18, desc: 'Throw blades at all enemies.' },
  // Cleric
  heal:           { name: 'Heal',           emoji: '💚',  mp: 20, desc: 'Restore 30% of your max HP.' },
  smite:          { name: 'Smite',          emoji: '☀️',  mp: 18, desc: 'Divine strike that bypasses defense.' },
  bless:          { name: 'Bless',          emoji: '🙏',  mp: 12, desc: 'Blessed by the gods, attack up for 3 turns.' },
  holy_nova:      { name: 'Holy Nova',      emoji: '✨',  mp: 28, desc: 'Blast all enemies with holy light and heal self.' },
  resurrection:   { name: 'Resurrection',  emoji: '💫',  mp: 35, desc: 'Rise! Restore 50% HP from near-death.' },
  divine_shield:  { name: 'Divine Shield', emoji: '🛡️',  mp: 22, desc: 'Negate all damage for 2 turns.' },
  consecrate:     { name: 'Consecrate',    emoji: '🕯️',  mp: 20, desc: 'Curse the ground — poison all enemies.' },
  // Ranger
  aimed_shot:     { name: 'Aimed Shot',    emoji: '🎯',  mp: 12, desc: 'A precise shot dealing heavy damage.' },
  trap:           { name: 'Trap',          emoji: '🪤',  mp: 8,  desc: 'Set a trap that stuns the enemy.' },
  animal_companion:{ name: 'Companion',   emoji: '🐺',  mp: 15, desc: 'Your wolf companion attacks for you.' },
  volley:         { name: 'Volley',        emoji: '🏹',  mp: 22, desc: 'Rain arrows on all enemies.' },
  entangle:       { name: 'Entangle',      emoji: '🌿',  mp: 14, desc: 'Roots enemy in vines — stun 2 turns.' },
  eagle_eye:      { name: 'Eagle Eye',     emoji: '🦅',  mp: 12, desc: 'Expose weakness — next shot ignores defense.' },
  camouflage:     { name: 'Camouflage',    emoji: '🌲',  mp: 10, desc: 'Blend in: next attack does 2x nature damage.' },
  // Goblin
  headbutt:       { name: 'Headbutt',       emoji: '💢',  mp: 6,  desc: 'Slam your thick skull — stuns target.' },
  feral_bite:     { name: 'Feral Bite',     emoji: '🦷',  mp: 5,  desc: 'Savage bite — poisons the wound.' },
  goblin_rage:    { name: 'Goblin Rage',    emoji: '😤',  mp: 8,  desc: 'Frenzy — surge attack power for 3 turns.' },
  reckless_charge:{ name: 'Reckless Charge',emoji: '🐗',  mp: 10, desc: 'Full-body slam — 2.2x physical damage.' },
  blood_frenzy:   { name: 'Blood Frenzy',   emoji: '🩸',  mp: 12, desc: 'AOE strike — weakens all enemies.' },
  bone_crusher:   { name: 'Bone Crusher',   emoji: '🦴',  mp: 10, desc: 'Overhead blow that shatters defense.' },
  skull_crusher:  { name: 'Skull Crusher',  emoji: '💀',  mp: 14, desc: 'Execute — 2.5x damage on weakened foes.' },
  goblin_king_shout:{ name: 'King Shout',   emoji: '👑',  mp: 15, desc: 'Terrifying shout — stuns + weakens all.' },
  rampage:        { name: 'Rampage',        emoji: '🌪️', mp: 14, desc: 'Berserk flurry — 1.6x hits everything.' },
};

const ITEM_EMOJIS = {
  // consumables
  health_potion: '🧪', greater_health_potion: '💊', mana_potion: '🔵',
  antidote: '💚', bandage: '🩹', smoke_bomb: '💨', bomb: '💣',
  elixir_of_strength: '💪', elixir_of_swiftness: '💨',
  // starting gear (key items)
  iron_sword: '⚔️', oak_staff: '🪄', twin_daggers: '🗡️', holy_mace: '🔨', longbow: '🏹',
  wooden_shield: '🛡️', spellbook: '📖', lockpicks: '🔑', prayer_beads: '📿', quiver: '🪄',
  bandages: '🩹', hunting_knife: '🔪', smoke_bomb: '💨',
  // ingredients
  healing_herb: '🌿', mana_crystal: '💎', empty_vial: '🫙', toxic_mushroom: '🍄',
  cloth_strip: '🧵', sulfur_chunk: '🪨', red_mushroom: '🍄‍🟫', spider_silk: '🕸️',
  bone_shard: '🦴', iron_ore: '⛏️', wolf_pelt: '🐺',
  // equipment
  iron_sword_plus: '⚔️', oak_staff_plus: '🪄', worn_daggers: '🗡️',
  shadow_blade: '🌑', veil_touched_bow: '🏹', holy_symbol_mace: '🔨', arcane_wand: '✨',
  leather_vest: '🧥', chain_mail: '⛓️', shadowweave_cloak: '🌑',
  arcane_robes: '👘', battle_plate: '🛡️',
  veil_shard_ring: '💍', archivist_tome: '📖', blood_pendant: '🩸',
  veil_blade: '🗡️', archivist_mantle: '🌌',
  default: '📦',
};

// Full item data for richer display (keyed by server item key)
const ITEM_DATA = {
  health_potion:         { name:'Health Potion',         type:'consumable', desc:'Restores 40 HP',                      rarity:'common'   },
  greater_health_potion: { name:'Greater Health Potion', type:'consumable', desc:'Restores 80 HP',                      rarity:'uncommon' },
  mana_potion:           { name:'Mana Potion',           type:'consumable', desc:'Restores 40 MP',                      rarity:'common'   },
  antidote:              { name:'Antidote',              type:'consumable', desc:'Cures poison, +10 HP',                rarity:'common'   },
  bandage:               { name:'Bandage',               type:'consumable', desc:'Restores 25 HP',                      rarity:'common'   },
  elixir_of_strength:    { name:'Elixir of Strength',   type:'consumable', desc:'+4 STR for 3 combat turns',           rarity:'uncommon' },
  elixir_of_swiftness:   { name:'Elixir of Swiftness',  type:'consumable', desc:'+4 DEX for 3 combat turns',           rarity:'uncommon' },
  bomb:                  { name:'Bomb',                  type:'consumable', desc:'30 fire damage to enemy',             rarity:'uncommon' },
  smoke_bomb:            { name:'Smoke Bomb',            type:'consumable', desc:'Guarantees escape from combat',       rarity:'uncommon' },
  healing_herb:          { name:'Healing Herb',          type:'ingredient', desc:'Medicinal herb with restorative properties' },
  mana_crystal:          { name:'Mana Crystal',          type:'ingredient', desc:'Shard pulsing with arcane energy'    },
  empty_vial:            { name:'Empty Vial',            type:'ingredient', desc:'Clean glass vial ready for a brew'   },
  toxic_mushroom:        { name:'Toxic Mushroom',        type:'ingredient', desc:'Blue-capped, dripping with venom'    },
  cloth_strip:           { name:'Cloth Strip',           type:'ingredient', desc:'Torn from fallen enemies'            },
  sulfur_chunk:          { name:'Sulfur Chunk',          type:'ingredient', desc:'Volatile when mixed right'           },
  red_mushroom:          { name:'Red Mushroom',          type:'ingredient', desc:'Raw power in fungal form'            },
  spider_silk:           { name:'Spider Silk',           type:'ingredient', desc:'Incredibly tough thread'             },
  bone_shard:            { name:'Bone Shard',            type:'ingredient', desc:'Sharp fragment from fallen undead'   },
  iron_ore:              { name:'Iron Ore',              type:'ingredient', desc:'Raw iron, surprisingly heavy'        },
  wolf_pelt:             { name:'Wolf Pelt',             type:'ingredient', desc:'Rough hide from a shadow wolf'       },
  // equipment
  iron_sword_plus:    { name:'Iron Sword +1',      type:'weapon',  rarity:'common',    desc:'+3 damage' },
  oak_staff_plus:     { name:'Enchanted Staff',    type:'weapon',  rarity:'common',    desc:'+2 arcane, +1 INT' },
  worn_daggers:       { name:'Worn Daggers',        type:'weapon',  rarity:'common',    desc:'+2 damage, +1 DEX' },
  shadow_blade:       { name:'Shadow Blade',        type:'weapon',  rarity:'uncommon',  desc:'+5 shadow, +2 DEX (Rogue)' },
  veil_touched_bow:   { name:'Veil-Touched Bow',   type:'weapon',  rarity:'uncommon',  desc:'+4 nature, +2 DEX (Ranger)' },
  holy_symbol_mace:   { name:'Blessed Mace',        type:'weapon',  rarity:'uncommon',  desc:'+4 holy, +2 INT (Cleric)' },
  arcane_wand:        { name:'Arcane Wand',          type:'weapon',  rarity:'uncommon',  desc:'+3 arcane, +3 INT, +15 MP (Mage)' },
  leather_vest:       { name:'Leather Vest',         type:'armor',   rarity:'common',    desc:'+2 defense' },
  chain_mail:         { name:'Chain Mail',           type:'armor',   rarity:'common',    desc:'+4 defense, +10 max HP' },
  shadowweave_cloak:  { name:'Shadowweave Cloak',   type:'armor',   rarity:'uncommon',  desc:'+3 defense, +2 DEX, +15 HP' },
  arcane_robes:       { name:'Arcane Robes',         type:'armor',   rarity:'uncommon',  desc:'+1 defense, +2 INT, +25 MP' },
  battle_plate:       { name:'Battle Plate',         type:'armor',   rarity:'uncommon',  desc:'+6 defense, +20 HP (Warrior)' },
  veil_shard_ring:    { name:'Veil Shard Ring',      type:'accessory', rarity:'rare',    desc:'+3 INT, +20 MP, +10 HP' },
  archivist_tome:     { name:'Tome Fragment',        type:'accessory', rarity:'rare',    desc:'+4 INT, +2 STR' },
  blood_pendant:      { name:"Warrior's Pendant",    type:'accessory', rarity:'rare',    desc:'+4 STR, +25 HP (Warrior)' },
  veil_blade:         { name:'The Veil Blade',       type:'weapon',  rarity:'legendary', desc:'+10 shadow, +4 STR, +4 DEX' },
  archivist_mantle:   { name:"Archivist's Mantle",   type:'armor',   rarity:'legendary', desc:'+8 defense, +5 INT, +40 MP, +30 HP' },
};

// Crafting recipes (mirrors server CRAFT_RECIPES)
const CRAFT_RECIPES_CLIENT = {
  health_potion:         { result: 'health_potion',         ingredients: ['healing_herb','empty_vial'] },
  greater_health_potion: { result: 'greater_health_potion', ingredients: ['health_potion','healing_herb','healing_herb'] },
  mana_potion:           { result: 'mana_potion',           ingredients: ['mana_crystal','empty_vial'] },
  antidote:              { result: 'antidote',              ingredients: ['toxic_mushroom','healing_herb'] },
  bandage:               { result: 'bandage',               ingredients: ['cloth_strip','cloth_strip'] },
  bomb:                  { result: 'bomb',                  ingredients: ['sulfur_chunk','cloth_strip'] },
  smoke_bomb:            { result: 'smoke_bomb',            ingredients: ['sulfur_chunk','cloth_strip','cloth_strip'] },
  elixir_of_strength:    { result: 'elixir_of_strength',    ingredients: ['red_mushroom','empty_vial','bone_shard'] },
  elixir_of_swiftness:   { result: 'elixir_of_swiftness',   ingredients: ['spider_silk','empty_vial','mana_crystal'] },
};

// Equipment template keys (for equip button logic)
const EQUIP_KEYS = new Set([
  'iron_sword_plus','oak_staff_plus','worn_daggers',
  'shadow_blade','veil_touched_bow','holy_symbol_mace','arcane_wand',
  'leather_vest','chain_mail','shadowweave_cloak','arcane_robes','battle_plate',
  'veil_shard_ring','archivist_tome','blood_pendant','veil_blade','archivist_mantle',
]);

const PHASE_LABELS = {
  exploring: '🧭 EXPLORING',
  combat:    '⚔️ COMBAT',
  looting:   '💰 LOOTING',
  victory:   '🏆 VICTORY',
  game_over: '💀 GAME OVER',
  resting:   '💤 RESTING',
};

// ═══════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════

const ws = new GameWebSocket();
let laMap = null;
let selectedClass = 'warrior';
let selectedMode = 'guided';
let selectedDifficulty = 'normal';
let currentRoomData = null;
let sceneImageSeed = 1;
let sceneImageEnabled = true;  // user can disable scene art generation
let _gpsReady = false;
let narratorEnabled = true;    // narrator is ON by default; user toggles with 🔊/🔇
let _narratorVoice = null;     // cached preferred voice
let dmEnabled = true;          // DM on/off — toggled in DM Options panel
let dmPersonality = 'balanced';// current DM personality preset
let dmMemoryTurns = 0;         // last known turn count from server
const _narrativeHistory = [];  // rolling log of last 8 DM narrative lines for companion context

// ═══════════════════════════════════════════════════════
// NARRATOR (Web Speech API TTS)
// ═══════════════════════════════════════════════════════

function _pickNarratorVoice() {
  if (_narratorVoice) return _narratorVoice;
  const voices = speechSynthesis.getVoices();
  // Prefer deep dramatic English voices: UK English male, then any English male, then first available
  const ranked = [
    voices.find(v => /en-GB/i.test(v.lang) && /male/i.test(v.name)),
    voices.find(v => /en/i.test(v.lang) && /male/i.test(v.name)),
    voices.find(v => /en-GB/i.test(v.lang)),
    voices.find(v => /en/i.test(v.lang)),
    voices[0],
  ];
  _narratorVoice = ranked.find(Boolean) || null;
  return _narratorVoice;
}

// Current narrator audio element (so we can stop it on new speech)
let _narratorAudio = null;

function _cleanForSpeech(text) {
  return text
    .replace(/\[\[ROLL:[^\]]+\]\]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function _speakFallback(clean) {
  // Web Speech API fallback — robotic but works without API key
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 0.88; utter.pitch = 0.85; utter.volume = 1.0;
  const voice = voices.find(v => /en-GB/i.test(v.lang) && /male/i.test(v.name))
    || voices.find(v => /en/i.test(v.lang) && /male/i.test(v.name))
    || voices.find(v => /en/i.test(v.lang));
  if (voice) utter.voice = voice;
  speechSynthesis.speak(utter);
}

async function narratorSpeak(text) {
  if (!narratorEnabled) return;
  const clean = _cleanForSpeech(text);
  if (!clean) return;

  // Stop any currently playing narration
  if (_narratorAudio) { _narratorAudio.pause(); _narratorAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  try {
    const res = await fetch(`/tts?text=${encodeURIComponent(clean)}`);
    if (!res.ok) throw new Error('no tts');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _narratorAudio = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    // Fall back to browser TTS
    _speakFallback(clean);
  }
}

// ═══════════════════════════════════════════════════════
// GAME SCREEN PARTICLES
// ═══════════════════════════════════════════════════════

let _particlesRAF = null;

function initGameParticles() {
  const canvas = document.getElementById('game-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const PALETTES = [
    ['#ffd54f','#ffca28','#ffb300'],  // gold embers
    ['#ef9a9a','#e57373','#c62828'],  // ember red
    ['#ce93d8','#ba68c8','#7b1fa2'],  // arcane purple
    ['#80cbc4','#4db6ac','#00695c'],  // mystical teal
  ];
  const COUNT = 40;
  const particles = Array.from({ length: COUNT }, () => {
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    return {
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(Math.random() * 0.5 + 0.2),
      r: Math.random() * 2.5 + 0.8,
      alpha: Math.random() * 0.5 + 0.15,
      color: pal[Math.floor(Math.random() * pal.length)],
      life: Math.random(),
    };
  });

  if (_particlesRAF) cancelAnimationFrame(_particlesRAF);

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.003;
      if (p.life <= 0 || p.y < -10) {
        p.x = Math.random() * canvas.width;
        p.y = canvas.height + 5;
        p.life = 1;
        p.vy = -(Math.random() * 0.5 + 0.2);
        p.vx = (Math.random() - 0.5) * 0.4;
      }
      const a = p.alpha * Math.min(p.life * 2, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    _particlesRAF = requestAnimationFrame(tick);
  }
  _particlesRAF = requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════════════
// EXPLORE TOOLBAR (quick actions, hidden in combat)
// ═══════════════════════════════════════════════════════

function renderExploreToolbar() {
  const toolbar = document.getElementById('explore-toolbar');
  if (!toolbar) return;
  const phase = state.phase || 'exploring';
  toolbar.classList.toggle('player-turn-active', isPlayersTurn() && phase !== 'combat');

  if (phase === 'combat') {
    toolbar.style.display = 'none';
    return;
  }
  toolbar.style.display = '';

  const cls = (state.player && state.player.player_class) || 'warrior';
  const hp = state.player ? ps(state.player).hp : 100;
  const maxHp = state.player ? ps(state.player).maxHp : 100;
  const needsRest = hp < maxHp * 0.9;

  const classAction = cls === 'mage' || cls === 'cleric'
    ? `<button class="explore-btn btn-pray" data-action="meditate">🧘 Meditate</button>`
    : `<button class="explore-btn btn-pray" data-action="pray">🙏 Pray</button>`;

  toolbar.innerHTML = `
    <span class="explore-toolbar-label">Quick Actions</span>
    <button class="explore-btn btn-introspect" data-action="introspect">🔍 Introspect</button>
    <button class="explore-btn btn-examine" data-action="examine">🧐 Examine</button>
    ${needsRest ? `<button class="explore-btn btn-rest" data-action="rest">💤 Rest</button>` : ''}
    ${classAction}
  `;

  const actions = {
    introspect: 'I look inward, reflecting on my journey so far and the choices that brought me here.',
    examine: 'I carefully examine my surroundings, searching for anything hidden or noteworthy.',
    rest: 'I take a moment to rest and catch my breath, tending to my wounds.',
    pray: 'I close my eyes and offer a prayer to the gods for strength and guidance.',
    meditate: 'I sit quietly and meditate, centering my mind and recovering my focus.',
  };

  toolbar.querySelectorAll('.explore-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      sendPlayerInput(actions[btn.dataset.action] || btn.dataset.action);
    });
  });
}

function isPlayersTurn() {
  const phase = state.phase || 'exploring';
  if (phase === 'combat') {
    const activePid = state.combat && state.combat.active_player_id;
    return !activePid || activePid === state.playerId;
  }
  const activePid = state.exploreActivePid;
  return !activePid || activePid === state.playerId;
}

function updatePlayerInputState() {
  const row = document.getElementById('player-input-row');
  const input = document.getElementById('player-action-input');
  const sendBtn = document.getElementById('btn-player-action-send');
  if (!row || !input || !sendBtn) return;

  const myTurn = isPlayersTurn();
  row.classList.toggle('player-turn-active', myTurn);
  row.classList.toggle('turn-locked', !myTurn);
  input.disabled = !myTurn;
  sendBtn.disabled = !myTurn;
  input.placeholder = myTurn
    ? 'What do you do? (type freely or use buttons above...)'
    : 'Wait for your turn...';
}

// ═══════════════════════════════════════════════════════
// SCREEN ROUTER
// ═══════════════════════════════════════════════════════

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
  state.screen = name;

  if (name === 'game') {
    setTimeout(() => {
      setupMapCanvas();
      renderGameUI();
      invalidateMapSize();
      try { initGameParticles(); } catch(e) { /* non-critical */ }
    }, 80);
  }
}

// ═══════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════

function initLogin() {
  // Render class portrait cards FIRST — particles are optional eye candy
  const grid = document.getElementById('class-grid');
  const statBar = (v, color, max = 5) =>
    `<div class="cls-stat-bar"><div class="cls-stat-fill" style="width:${(v/max)*100}%;background:${color}"></div></div>`;
  grid.innerHTML = Object.entries(CLASSES).map(([key, cls]) => `
    <div class="class-card ${key === selectedClass ? 'selected' : ''}" data-class="${key}"
         style="--class-color:${cls.color};--class-color-dim:${cls.colorDim || 'rgba(255,255,255,0.05)'}">
      <div class="class-portrait">
        <div class="class-portrait-aura"></div>
        <div class="class-figure ${cls.anim || ''}">${cls.figure || cls.emoji}</div>
        <div class="class-weapon">${cls.weapon || ''}</div>
      </div>
      <div class="class-info">
        <span class="class-name">${cls.name}</span>
        <span class="class-tag">${cls.tag}</span>
        <div class="class-lore">${cls.lore || ''}</div>
        <div class="class-stats">
          <div class="cls-stat-row"><span>STR</span>${statBar(cls.stats.str, cls.color)}</div>
          <div class="cls-stat-row"><span>INT</span>${statBar(cls.stats.int, cls.color)}</div>
          <div class="cls-stat-row"><span>DEX</span>${statBar(cls.stats.dex, cls.color)}</div>
          <div class="cls-stat-row"><span>HP</span>${statBar(cls.stats.hp, cls.color)}</div>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.class-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedClass = card.dataset.class;
      grid.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      validateLoginForm();
    });
  });

  // Name input validation
  const nameInput = document.getElementById('input-name');
  nameInput.addEventListener('input', validateLoginForm);

  // Server config toggle
  document.getElementById('toggle-server-config').addEventListener('click', () => {
    document.getElementById('server-config-panel').classList.toggle('hidden');
  });

  // Default server URL
  const serverInput = document.getElementById('input-server');
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  serverInput.value = `${protocol}//${location.host}/ws`;

  // Login button
  document.getElementById('btn-login').addEventListener('click', doLogin);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Particles are decorative only — never block the UI
  try { initParticles(); } catch(e) { /* non-critical */ }
}

function validateLoginForm() {
  const name = document.getElementById('input-name').value.trim();
  document.getElementById('btn-login').disabled = !name;
}

async function doLogin() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) return;

  const serverInput = document.getElementById('input-server');
  const url = serverInput.value.trim() || `ws://${location.host}/ws`;

  setLoginStatus('Connecting to server...');
  hideLoginError();
  document.getElementById('btn-login').disabled = true;

  try {
    await ws.connect(url);
    setLoginStatus('Authenticating...');
    ws.send('CONNECT', { player_name: name, player_class: selectedClass });
  } catch (e) {
    showLoginError(`Could not connect: ${e.message}`);
    document.getElementById('btn-login').disabled = false;
    setLoginStatus('');
  }
}

function setLoginStatus(msg) {
  const el = document.getElementById('login-status');
  const txt = document.getElementById('login-status-text');
  if (msg) {
    el.classList.remove('hidden');
    txt.textContent = msg;
  } else {
    el.classList.add('hidden');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideLoginError() {
  document.getElementById('login-error').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// PARTICLE BACKGROUND
// ═══════════════════════════════════════════════════════

function initParticles() {
  const canvas = document.getElementById('login-particles');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let W, H;

  const resize = () => {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    particles = Array.from({ length: 80 }, () => createParticle());
  };

  const createParticle = () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -Math.random() * 0.5 - 0.1,
    size: Math.random() * 2 + 0.5,
    alpha: Math.random() * 0.6 + 0.1,
    color: Math.random() > 0.7 ? '#c9a84c' : '#ffffff',
  });

  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.alpha -= 0.001;
      if (p.y < 0 || p.alpha <= 0) Object.assign(p, createParticle(), { y: H });
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    requestAnimationFrame(tick);
  };

  window.addEventListener('resize', resize);
  resize();
  tick();
}

// ═══════════════════════════════════════════════════════
// LOBBY SCREEN
// ═══════════════════════════════════════════════════════

function initLobby() {
  document.getElementById('btn-disconnect').addEventListener('click', () => {
    ws.disconnect();
    showScreen('login');
    setLoginStatus('');
    document.getElementById('btn-login').disabled = false;
  });

  document.getElementById('btn-refresh-parties').addEventListener('click', refreshParties);
  document.getElementById('btn-create-party').addEventListener('click', createParty);
  document.getElementById('btn-leave-party').addEventListener('click', leaveParty);
  document.getElementById('btn-start-adventure').addEventListener('click', startAdventure);

  document.getElementById('mode-selector').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    selectedMode = btn.dataset.mode;
    document.querySelectorAll('#mode-selector .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  document.getElementById('difficulty-selector').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    selectedDifficulty = btn.dataset.diff;
    document.querySelectorAll('#difficulty-selector .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  initLocationWidget();
}

function renderLobbyPlayer() {
  const player = state.player;
  if (!player) return;
  const cls = CLASSES[player.player_class] || CLASSES.warrior;
  const s = ps(player);
  const pct = pctOf(s.health, s.max_health);
  const mptc = pctOf(s.mana, s.max_mana);

  document.getElementById('lobby-player-card').innerHTML = `
    <div class="class-emoji-lg">${cls.emoji}</div>
    <div class="player-info">
      <h3>${player.name}</h3>
      <p>${cls.name} · Level ${s.level || 1} · ${s.gold || 0} gold</p>
    </div>
    <div class="mini-bars">
      ${miniBar(pct, 'hp')}
      ${miniBar(mptc, 'mp')}
    </div>
  `;
}

function miniBar(pct, type) {
  return `<div class="bar-track" style="height:5px">
    <div class="bar-fill bar-${type}" style="width:${pct}%"></div>
  </div>`;
}

function renderPartyList() {
  const parties = state.parties || [];
  const el = document.getElementById('party-list');
  if (!parties.length) {
    el.innerHTML = '<div class="empty-state">No parties available. Create one!</div>';
    return;
  }
  el.innerHTML = parties.map(p => `
    <div class="party-item" data-id="${p.id}">
      <span class="party-name">🏰 ${p.name}</span>
      <span class="party-meta">${p.member_count || 0}/6 members</span>
      <span class="party-size">${p.status === 'lobby' ? '🟢' : '🔴'}</span>
    </div>
  `).join('');

  el.querySelectorAll('.party-item').forEach(item => {
    item.addEventListener('click', () => {
      if (state.party) return; // already in party
      ws.send('JOIN_PARTY', { party_id: item.dataset.id });
    });
  });
}

function renderCurrentParty() {
  const party = state.party;
  if (!party) {
    document.getElementById('panel-create-party').classList.remove('hidden');
    document.getElementById('panel-current-party').classList.add('hidden');
    return;
  }
  document.getElementById('panel-create-party').classList.add('hidden');
  document.getElementById('panel-current-party').classList.remove('hidden');

  document.getElementById('current-party-name').textContent = `🏰 ${party.name}`;
  document.getElementById('party-status-badge').textContent = (party.status || 'LOBBY').toUpperCase();
  document.getElementById('party-status-badge').className = `badge badge-${party.status === 'in_adventure' ? 'active' : 'lobby'}`;

  const membersEl = document.getElementById('party-members-list');
  const members = party.member_ids || [];
  const roster = Object.fromEntries((party.member_details || []).map(member => [member.id, member]));
  membersEl.innerHTML = members.map(id => {
    const isLeader = id === party.leader_id;
    const isSelf   = id === state.playerId;
    const member   = isSelf ? state.player : (roster[id] || null);
    const cls      = member ? (CLASSES[member.player_class] || CLASSES.warrior) : { emoji: '👤' };
    const name     = member ? member.name : `Player ${id.slice(0,6)}`;
    return `<div class="party-member">
      <span class="member-emoji">${cls.emoji}</span>
      <span class="member-name">${name}${isSelf ? ' (you)' : ''}</span>
      ${isLeader ? '<span class="leader-crown">👑</span>' : ''}
    </div>`;
  }).join('');

  const isLeader = party.leader_id === state.playerId;
  document.getElementById('panel-start-adventure').classList.toggle('hidden', !isLeader);
}

function refreshParties() {
  ws.send('LIST_PARTIES', {});
}

function createParty() {
  const name = document.getElementById('input-party-name').value.trim();
  if (!name) { lobbyToast('Enter a party name first.'); return; }
  ws.send('CREATE_PARTY', { party_name: name });
}

function leaveParty() {
  ws.send('LEAVE_PARTY', {});
}

async function startAdventure() {
  const name = document.getElementById('input-adventure-name').value.trim() || 'Into the Depths';
  let pos = getPosition();

  // Build payload — fetch nearby POIs if we have a position
  const payload = {
    adventure_name: name,
    description: 'A perilous dungeon adventure',
    mode: selectedMode,
    difficulty: selectedDifficulty,
  };

  // Always try to get location — from GPS, manual position, or IP geolocation
  if (!pos) {
    // No GPS — try IP geolocation as last resort
    const ip = await getIPGeolocation();
    if (ip) {
      setManualPosition(ip.lat, ip.lng);
      enableSimulateTravel();
      pos = { lat: ip.lat, lng: ip.lng, accuracy: 5000 };
      console.log('[Adventure] Falling back to IP geolocation:', ip);
    }
  }

  if (pos) {
    payload.lat = pos.lat;
    payload.lng = pos.lng;

    // Get location name for the DM intro
    const locStatus = document.getElementById('location-status');
    payload.location_name = locStatus ? locStatus.textContent : `${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}`;

    // Fetch nearby POIs to seed the dungeon from real-world places
    try {
      console.log(`[Adventure] Fetching POIs near ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}...`);
      const r = await fetch(`/nearby-rooms?lat=${pos.lat}&lng=${pos.lng}&radius=800`);
      if (r.ok) {
        const data = await r.json();
        payload.pois = (data.pois || []).slice(0, 12);
        console.log(`[Adventure] Got ${payload.pois.length} real POIs for dungeon`);
      } else {
        console.warn(`[Adventure] /nearby-rooms returned ${r.status} — using classic dungeon`);
      }
    } catch(e) {
      console.warn('[Adventure] Failed to fetch POIs:', e.message, '— using classic dungeon');
    }
  } else {
    console.warn('[Adventure] No location available — using classic dungeon');
  }

  showAdventureStartCinematic(name);
  ws.send('START_ADVENTURE', payload);
}

// ── Cinematic overlay shown while the server generates the dungeon ──
function showAdventureStartCinematic(adventureName) {
  // Remove any existing one
  const existing = document.getElementById('adventure-start-cinematic');
  if (existing) existing.remove();

  const LINES = [
    'The dungeon awakens…',
    'Fate is being woven…',
    'Your destiny calls…',
    'The realm takes shape…',
  ];

  const overlay = document.createElement('div');
  overlay.id = 'adventure-start-cinematic';
  overlay.innerHTML = `
    <canvas id="asc-canvas"></canvas>
    <div class="asc-center">
      <div class="asc-sigil">
        <svg viewBox="0 0 200 200" fill="none">
          <circle class="asc-ring" cx="100" cy="100" r="88" stroke-dasharray="553 553" stroke-dashoffset="553"/>
          <circle class="asc-ring-inner" cx="100" cy="100" r="62" stroke-dasharray="390 390" stroke-dashoffset="390"/>
          <path class="asc-cross" d="M100 28 L100 172 M28 100 L172 100" stroke-dasharray="300 300" stroke-dashoffset="300"/>
          <circle class="asc-center-dot" cx="100" cy="100" r="5" opacity="0"/>
        </svg>
      </div>
      <div class="asc-title" id="asc-title"></div>
      <div class="asc-adventure-name" id="asc-adv-name"></div>
      <div class="asc-flavor" id="asc-flavor">${LINES[0]}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Inject title letters with stagger
  const TITLE = 'ADVENTURE BEGINS';
  const titleEl = document.getElementById('asc-title');
  if (titleEl) {
    titleEl.innerHTML = TITLE.split('').map((ch, i) =>
      ch === ' '
        ? `<span style="display:inline-block;width:0.4em"></span>`
        : `<span class="asc-letter" style="animation-delay:${0.6 + i * 0.05}s">${ch}</span>`
    ).join('');
  }

  // Adventure name reveal
  const nameEl = document.getElementById('asc-adv-name');
  if (nameEl) {
    nameEl.textContent = adventureName;
    nameEl.style.animationDelay = '1.6s';
  }

  // Cycle flavor lines
  let flIdx = 0;
  const flavEl = document.getElementById('asc-flavor');
  const flTimer = setInterval(() => {
    if (!flavEl) return;
    flavEl.style.opacity = '0';
    setTimeout(() => {
      flIdx = (flIdx + 1) % LINES.length;
      if (flavEl) { flavEl.textContent = LINES[flIdx]; flavEl.style.opacity = ''; }
    }, 300);
  }, 900);

  // Ember canvas
  const canvas = document.getElementById('asc-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let W, H, embers = [];
    function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);
    function spawnEmber() {
      return { x: Math.random() * W, y: H + 8,
               vx: (Math.random()-0.5)*0.5, vy: -(0.5+Math.random()*1.2),
               life: 1, decay: 0.004+Math.random()*0.006,
               r: 1+Math.random()*2, hue: 28+Math.random()*20 };
    }
    for (let i = 0; i < 30; i++) { const e = spawnEmber(); e.y = Math.random()*H; embers.push(e); }
    let rafId;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      if (Math.random() < 0.4) embers.push(spawnEmber());
      embers = embers.filter(e => e.life > 0);
      embers.forEach(e => {
        e.x += e.vx + Math.sin(Date.now()*0.001+e.y*0.01)*0.12;
        e.y += e.vy; e.life -= e.decay;
        const a = Math.max(0, e.life*0.8);
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
        ctx.fillStyle = `hsla(${e.hue},90%,65%,${a})`; ctx.fill();
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r*2.5, 0, Math.PI*2);
        ctx.fillStyle = `hsla(${e.hue},90%,65%,${a*0.18})`; ctx.fill();
      });
      rafId = requestAnimationFrame(draw);
    }
    draw();
    overlay._stopCanvas = () => cancelAnimationFrame(rafId);
  }

  // Expose dismiss function — called by ROOM_ENTERED handler
  window._dismissAdventureCinematic = function() {
    clearInterval(flTimer);
    clearTimeout(ascFallbackTimer);
    if (overlay._stopCanvas) overlay._stopCanvas();
    overlay.classList.add('asc-done');
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 700);
    delete window._dismissAdventureCinematic;
  };

  // Safety fallback: dismiss after 15s no matter what (prevents getting stuck)
  const ascFallbackTimer = setTimeout(() => {
    if (window._dismissAdventureCinematic) window._dismissAdventureCinematic();
  }, 15000);
}

function lobbyToast(msg) {
  const el = document.getElementById('lobby-message');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ═══════════════════════════════════════════════════════
// GAME SCREEN
// ═══════════════════════════════════════════════════════

function setupMapCanvas() {
  if (!laMap) {
    laMap = new LAMap('la-map');
    laMap.init();
  }
  if (state.dungeon) {
    laMap.render(state.dungeon);
    // Also load full POI discovery layer if we have GPS
    const pos = getPosition();
    if (pos && !laMap._poiFetched) {
      const dungeonNames = new Set(
        Object.values(state.dungeon.rooms || {}).map(r => r.name)
      );
      laMap.fetchPOILayer(pos.lat, pos.lng, dungeonNames);
    }
  }
}

// Invalidate Leaflet size after map container becomes visible
function invalidateMapSize() {
  if (laMap && laMap.map) {
    setTimeout(() => laMap.map.invalidateSize(), 120);
  }
}

function sendPlayerAction() {
  const input = document.getElementById('player-action-input');
  if (!isPlayersTurn()) return;
  const text = input.value.trim();
  if (!text) return;
  const phase = state.phase || 'exploring';
  if (phase === 'combat') {
    // In combat, free-text maps to "skill/describe" — still sends as player action
    ws.send('PLAYER_ACTION', { action: text });
  } else {
    ws.send('PLAYER_ACTION', { action: text });
  }
  addLog(`▶ ${text}`, 'player-action');
  input.value = '';
}

function sendPlayerInput(text) {
  if (!isPlayersTurn()) return;
  if (!text) return;
  ws.send('PLAYER_ACTION', { action: text });
  addLog(`▶ ${text}`, 'player-action');
}

function initGame() {
  // ── Free-text player action input ──
  const actionInput = document.getElementById('player-action-input');
  document.getElementById('btn-player-action-send').addEventListener('click', sendPlayerAction);
  actionInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendPlayerAction(); });

  document.getElementById('btn-toggle-inventory').addEventListener('click', openInventory);
  document.getElementById('btn-close-inventory').addEventListener('click', closeInventory);
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    const log = document.getElementById('narrative-log');
    // Fade out old entries rather than deleting — new entries still appear
    log.querySelectorAll('.log-entry').forEach(e => { e.style.opacity = '0.25'; e.style.pointerEvents = 'none'; });
    const sep = document.createElement('div');
    sep.className = 'log-separator';
    sep.textContent = '─────── Chronicle cleared ───────';
    log.appendChild(sep);
    log.scrollTop = log.scrollHeight;
  });
  document.getElementById('btn-regen-image').addEventListener('click', () => {
    sceneImageSeed = Math.floor(Math.random() * 99999);
    generateSceneImage(currentRoomData, lastNarrativeHint);
  });

  // ── Narrator toggle ──
  document.getElementById('btn-narrator').addEventListener('click', () => {
    narratorEnabled = !narratorEnabled;
    const btn = document.getElementById('btn-narrator');
    btn.textContent = narratorEnabled ? '🔊' : '🔇';
    btn.title = narratorEnabled ? 'Narrator ON — click to mute' : 'Narrator OFF — click to enable';
    if (!narratorEnabled) {
      if (_narratorAudio) { _narratorAudio.pause(); _narratorAudio = null; }
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    }
  });

  // ── DM Options modal ──
  function openDMOptions() {
    document.getElementById('dm-options-modal').classList.remove('hidden');
    // Sync checkbox to current state
    document.getElementById('dm-enabled-checkbox').checked = dmEnabled;
    const imgToggle = document.getElementById('scene-image-toggle');
    if (imgToggle) imgToggle.checked = sceneImageEnabled;
    // Sync personality buttons
    document.querySelectorAll('.dm-personality-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.p === dmPersonality);
    });
    // Update memory turn counter (approximate from WS state if available)
    document.getElementById('dm-memory-count').textContent = dmMemoryTurns;
  }
  function closeDMOptions() {
    document.getElementById('dm-options-modal').classList.add('hidden');
  }
  document.getElementById('btn-dm-options').addEventListener('click', openDMOptions);
  document.getElementById('btn-dm-options-right').addEventListener('click', openDMOptions);
  document.getElementById('btn-dm-options-banner').addEventListener('click', openDMOptions);
  document.getElementById('btn-close-dm-options').addEventListener('click', closeDMOptions);
  document.getElementById('dm-options-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('dm-options-modal')) closeDMOptions();
  });

  // Personality preset buttons
  document.getElementById('dm-personality-grid').addEventListener('click', e => {
    const btn = e.target.closest('.dm-personality-btn');
    if (!btn) return;
    document.querySelectorAll('.dm-personality-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    dmPersonality = btn.dataset.p;
  });

  // DM enable/disable checkbox
  document.getElementById('dm-enabled-checkbox').addEventListener('change', e => {
    dmEnabled = e.target.checked;
    const optBtn = document.getElementById('btn-dm-options');
    optBtn.style.opacity = dmEnabled ? '' : '0.45';
    optBtn.title = dmEnabled ? 'DM Options' : 'DM disabled — click to configure';
  });

  // Clear memory button
  document.getElementById('btn-clear-dm-memory').addEventListener('click', () => {
    ws.send('DM_CONFIG', { clear_memory: true });
    dmMemoryTurns = 0;
    document.getElementById('dm-memory-count').textContent = '0';
    addLog('📜 Story memory cleared. The DM begins fresh.', 'system');
  });

  // Image generation toggle
  document.getElementById('scene-image-toggle')?.addEventListener('change', e => {
    sceneImageEnabled = e.target.checked;
    const img = document.getElementById('scene-image');
    if (sceneImageEnabled) {
      if (img) img.style.display = '';
      if (currentRoomData) { sceneImageSeed = Math.floor(Math.random() * 99999); generateSceneImage(currentRoomData, lastNarrativeHint); }
    } else {
      if (img) { img.src = ''; img.style.display = 'none'; }
    }
    addLog(`🎨 Scene art ${sceneImageEnabled ? 'enabled' : 'disabled'}`, 'system');
  });

  // Apply button — send full config to server
  document.getElementById('btn-dm-options-apply').addEventListener('click', () => {
    const notes = document.getElementById('dm-personality-notes').value.trim();
    ws.send('DM_CONFIG', {
      enabled: dmEnabled,
      personality: dmPersonality,
      personality_notes: notes,
    });
    closeDMOptions();
    const label = { balanced:'⚖️ Balanced', grim:'💀 Grim', whimsical:'🎪 Whimsical', brutal:'⚔️ Brutal' }[dmPersonality] || dmPersonality;
    addLog(`🎭 DM updated — ${dmEnabled ? label : 'Resting'}${notes ? ' · custom style active' : ''}`, 'system');
  });

  // ── Map expand ──
  document.getElementById('btn-expand-map').addEventListener('click', () => {
    const panel = document.getElementById('map-panel');
    const expanded = panel.classList.toggle('map-panel--expanded');
    document.getElementById('btn-expand-map').title = expanded ? 'Collapse map' : 'Expand map';
    if (laMap && laMap.map) laMap.map.invalidateSize();
  });

  // ── Theme toggle ──
  const themeBtn = document.getElementById('btn-theme-toggle');
  const isDark = () => document.documentElement.dataset.theme !== 'light';
  themeBtn.addEventListener('click', () => {
    if (isDark()) {
      document.documentElement.dataset.theme = 'light';
      themeBtn.textContent = '☀️';
    } else {
      delete document.documentElement.dataset.theme;
      themeBtn.textContent = '🌙';
    }
  });

  // ── Music: YouTube ambient embed ──
  // Dark fantasy RPG ambient — hours-long atmospheric track embedded via YouTube
  // Video ID can be overridden via appConfig.ambient_yt_id
  const DEFAULT_AMBIENT_YT = 'HGl9nhFkj9k'; // "Dark Souls / Hollow Knight style ambience" mix
  let spotifyOpen = false;
  let spotifyEl = null;

  function createSpotifyWidget() {
    const ytId = (appConfig && appConfig.ambient_yt_id) || DEFAULT_AMBIENT_YT;
    const el = document.createElement('div');
    el.id = 'spotify-widget';
    el.style.cssText = `
      position:fixed; bottom:60px; right:16px; z-index:9999;
      width:280px; border-radius:12px; overflow:hidden;
      box-shadow:0 8px 32px rgba(0,0,0,0.8);
      border:1px solid rgba(201,168,76,0.25);
      background:#0d0b06;
    `;
    el.innerHTML = `
      <div style="padding:8px 10px 4px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-family:var(--font-title);font-size:10px;color:#866a30;letter-spacing:0.1em">🎵 AMBIENT</span>
        <button onclick="(function(){var w=document.getElementById('spotify-widget');if(w)w.style.display='none';var b=document.getElementById('btn-music-toggle');if(b){b.textContent='🔇';b.title='Show ambient music';}})();"
          style="background:none;border:none;color:#554433;cursor:pointer;font-size:13px;padding:0;line-height:1">✕</button>
      </div>
      <iframe
        src="https://www.youtube.com/embed/${ytId}?autoplay=1&loop=1&playlist=${ytId}&controls=1&modestbranding=1&rel=0"
        width="280" height="158" frameborder="0"
        allow="autoplay; encrypted-media"
        allowfullscreen loading="lazy">
      </iframe>
    `;
    document.body.appendChild(el);
    return el;
  }

  document.getElementById('btn-music-toggle').addEventListener('click', () => {
    const btn = document.getElementById('btn-music-toggle');
    spotifyOpen = !spotifyOpen;
    if (spotifyOpen) {
      if (!spotifyEl) spotifyEl = createSpotifyWidget();
      spotifyEl.style.display = '';
      btn.textContent = '🎵';
      btn.title = 'Hide Spotify player';
    } else {
      if (spotifyEl) spotifyEl.style.display = 'none';
      btn.textContent = '🔇';
      btn.title = 'Show Spotify player';
    }
  });

  // ── Public config (env-driven features) ──
  let appConfig = { bloodlust_url: 'https://www.youtube.com/watch?v=YePpuaIi8c4', bloodlust_end_sec: 2 };
  fetch('/api/config').then(r => r.ok ? r.json() : null).then(cfg => { if (cfg) appConfig = cfg; }).catch(() => {});

  // ── Bloodlust effect button ──
  (function setupBloodlust() {
    const btn = document.getElementById('btn-bloodlust');
    if (!btn) return;

    let ytPlayer = null;
    let ytReady = false;
    let pendingPlay = false;

    // Inject YouTube IFrame API script once
    function ensureYTApi() {
      if (window.YT && window.YT.Player) { ytReady = true; return; }
      if (document.getElementById('yt-api-script')) return;
      const s = document.createElement('script');
      s.id = 'yt-api-script';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }

    window.onYouTubeIframeAPIReady = function() {
      ytReady = true;
      if (pendingPlay) { pendingPlay = false; playBloodlust(); }
    };

    function getVideoId(url) {
      try {
        const u = new URL(url);
        return u.searchParams.get('v') || u.pathname.split('/').pop();
      } catch { return null; }
    }

    function playBloodlust() {
      const vid = getVideoId(appConfig.bloodlust_url);
      if (!vid) return;
      const end = appConfig.bloodlust_end_sec || 2;

      // Screen flash effect
      const flash = document.createElement('div');
      flash.style.cssText = `
        position:fixed;inset:0;z-index:99999;pointer-events:none;
        background:radial-gradient(ellipse at center,rgba(180,0,0,0.55) 0%,rgba(80,0,0,0.2) 60%,transparent 100%);
        animation:bloodflash 0.8s ease-out forwards;
      `;
      if (!document.getElementById('bloodflash-style')) {
        const css = document.createElement('style');
        css.id = 'bloodflash-style';
        css.textContent = `@keyframes bloodflash{0%{opacity:1}100%{opacity:0}}`;
        document.head.appendChild(css);
      }
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 800);

      // Hidden YT player div
      let container = document.getElementById('yt-bloodlust-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'yt-bloodlust-container';
        container.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;right:0;z-index:-1;overflow:hidden;';
        document.body.appendChild(container);
        const playerDiv = document.createElement('div');
        playerDiv.id = 'yt-bloodlust-player';
        container.appendChild(playerDiv);
        ytPlayer = null;
      }

      if (ytPlayer) {
        ytPlayer.seekTo(0);
        ytPlayer.playVideo();
        setTimeout(() => { try { ytPlayer.pauseVideo(); } catch(e) {} }, end * 1000 + 200);
      } else {
        ytPlayer = new window.YT.Player('yt-bloodlust-player', {
          height: '1', width: '1',
          videoId: vid,
          playerVars: { autoplay: 1, start: 0, end, controls: 0, mute: 0 },
          events: {
            onReady: e => {
              e.target.setVolume(100);
              e.target.playVideo();
              setTimeout(() => { try { e.target.pauseVideo(); } catch(err) {} }, end * 1000 + 200);
            }
          }
        });
      }
    }

    btn.addEventListener('click', () => {
      ensureYTApi();
      if (ytReady) playBloodlust();
      else pendingPlay = true;
    });
  })();

  // ── Companion chat ──
  const companionInput = document.getElementById('companion-input');
  document.getElementById('btn-companion-send').addEventListener('click', sendCompanionMessage);
  companionInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendCompanionMessage(); });

  // ── Party chat ──
  const partyChatSendBtn = document.getElementById('btn-party-chat-send');
  const partyChatInput = document.getElementById('party-chat-input');
  if (partyChatSendBtn) partyChatSendBtn.addEventListener('click', sendPartyChat);
  if (partyChatInput) partyChatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendPartyChat(); });

  // ── Location history ──
  document.getElementById('btn-location-history').addEventListener('click', showLocationHistory);
  document.getElementById('btn-close-history').addEventListener('click', () => {
    document.getElementById('history-modal').classList.add('hidden');
  });

  // ── Tavern finder ──
  document.getElementById('btn-find-taverns').addEventListener('click', showTaverns);
  document.getElementById('btn-close-tavern').addEventListener('click', () => {
    document.getElementById('tavern-modal').classList.add('hidden');
  });

  // Service card selection
  let selectedService = 'ale';
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedService = card.dataset.service;
      window._selectedTavernService = selectedService;
    });
  });
  document.querySelector('.service-card[data-service="ale"]').classList.add('selected');
  window._selectedTavernService = 'ale';
}

// ═══════════════════════════════════════════════════════
// CHARACTER PORTRAIT — animated pixel-art sprite
// ═══════════════════════════════════════════════════════

const CHARACTER_SPRITES = {
  warrior: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 168" width="112" height="168">
    <!-- helmet -->
    <rect x="35" y="7" width="42" height="6" fill="#9e9e9e"/>
    <rect x="28" y="13" width="56" height="6" fill="#9e9e9e"/>
    <rect x="28" y="19" width="56" height="12" fill="#bdbdbd"/>
    <!-- visor slit -->
    <rect x="35" y="25" width="14" height="6" fill="#37474f"/>
    <rect x="63" y="25" width="14" height="6" fill="#37474f"/>
    <!-- face -->
    <rect x="35" y="31" width="42" height="8" fill="#ffcc80"/>
    <!-- neck -->
    <rect x="42" y="39" width="28" height="6" fill="#9e9e9e"/>
    <!-- pauldrons -->
    <rect x="14" y="45" width="21" height="14" fill="#78909c"/>
    <rect x="77" y="45" width="21" height="14" fill="#78909c"/>
    <!-- chest armor -->
    <rect x="28" y="45" width="56" height="28" fill="#c62828"/>
    <!-- chainmail center -->
    <rect x="35" y="52" width="42" height="14" fill="#78909c"/>
    <!-- belt -->
    <rect x="28" y="73" width="56" height="7" fill="#5d4037"/>
    <rect x="49" y="73" width="14" height="7" fill="#ffc107"/>
    <!-- left arm -->
    <rect x="7" y="59" width="14" height="28" fill="#78909c"/>
    <!-- shield (left hand) -->
    <rect x="0" y="73" width="14" height="28" fill="#546e7a"/>
    <rect x="3" y="76" width="8" height="22" fill="#78909c"/>
    <rect x="5" y="84" width="4" height="6" fill="#ffc107"/>
    <!-- right arm -->
    <rect x="91" y="59" width="14" height="21" fill="#78909c"/>
    <!-- sword (right hand) -->
    <rect x="101" y="66" width="7" height="42" fill="#bdbdbd"/>
    <rect x="94" y="80" width="21" height="7" fill="#ffc107"/>
    <rect x="103" y="108" width="5" height="14" fill="#ffc107"/>
    <!-- legs -->
    <rect x="28" y="80" width="24" height="42" fill="#c62828"/>
    <rect x="60" y="80" width="24" height="42" fill="#c62828"/>
    <!-- boots -->
    <rect x="28" y="122" width="24" height="14" fill="#37474f"/>
    <rect x="60" y="122" width="24" height="14" fill="#37474f"/>
  </svg>`,

  mage: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 168" width="112" height="168">
    <!-- hat brim -->
    <rect x="21" y="19" width="70" height="7" fill="#4a148c"/>
    <!-- hat cone -->
    <rect x="35" y="7" width="42" height="13" fill="#6a1b9a"/>
    <rect x="42" y="0" width="28" height="8" fill="#6a1b9a"/>
    <!-- face -->
    <rect x="35" y="26" width="42" height="19" fill="#ffcc80"/>
    <!-- beard -->
    <rect x="35" y="40" width="42" height="5" fill="#e0e0e0"/>
    <!-- neck -->
    <rect x="42" y="45" width="28" height="7" fill="#ffcc80"/>
    <!-- robe body -->
    <rect x="21" y="52" width="70" height="56" fill="#7b1fa2"/>
    <!-- robe trim -->
    <rect x="21" y="52" width="7" height="56" fill="#4a148c"/>
    <rect x="84" y="52" width="7" height="56" fill="#4a148c"/>
    <!-- star on chest -->
    <rect x="49" y="66" width="14" height="14" fill="#e040fb"/>
    <rect x="42" y="73" width="28" height="7" fill="#e040fb"/>
    <rect x="56" y="59" width="7" height="28" fill="#e040fb"/>
    <!-- left sleeve -->
    <rect x="7" y="52" width="14" height="35" fill="#7b1fa2"/>
    <!-- right sleeve holding staff -->
    <rect x="91" y="52" width="14" height="35" fill="#7b1fa2"/>
    <!-- staff -->
    <rect x="101" y="0" width="7" height="112" fill="#8d6e63"/>
    <!-- orb -->
    <rect x="97" y="0" width="14" height="14" fill="#7c4dff"/>
    <rect x="100" y="0" width="8" height="3" fill="#ea80fc"/>
    <!-- robe bottom -->
    <rect x="28" y="108" width="56" height="28" fill="#6a1b9a"/>
    <!-- robe feet -->
    <rect x="28" y="136" width="21" height="10" fill="#4a148c"/>
    <rect x="63" y="136" width="21" height="10" fill="#4a148c"/>
  </svg>`,

  rogue: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 168" width="112" height="168">
    <!-- hood outer -->
    <rect x="28" y="7" width="56" height="38" fill="#212121"/>
    <!-- hood shadow -->
    <rect x="35" y="13" width="42" height="26" fill="#1a1a1a"/>
    <!-- eyes (teal glow) -->
    <rect x="37" y="26" width="10" height="6" fill="#00bcd4"/>
    <rect x="65" y="26" width="10" height="6" fill="#00bcd4"/>
    <!-- face partial -->
    <rect x="35" y="32" width="42" height="8" fill="#546e7a"/>
    <!-- neck -->
    <rect x="42" y="45" width="28" height="7" fill="#37474f"/>
    <!-- cloak body -->
    <rect x="14" y="52" width="84" height="63" fill="#37474f"/>
    <!-- cloak inner lining (teal accent) -->
    <rect x="49" y="52" width="14" height="63" fill="#00838f"/>
    <rect x="28" y="52" width="21" height="7" fill="#00838f"/>
    <rect x="63" y="52" width="21" height="7" fill="#00838f"/>
    <!-- dagger left -->
    <rect x="7" y="66" width="7" height="35" fill="#b0bec5"/>
    <rect x="3" y="80" width="14" height="5" fill="#90a4ae"/>
    <rect x="7" y="101" width="7" height="7" fill="#78909c"/>
    <!-- dagger right -->
    <rect x="98" y="66" width="7" height="35" fill="#b0bec5"/>
    <rect x="95" y="80" width="14" height="5" fill="#90a4ae"/>
    <rect x="98" y="101" width="7" height="7" fill="#78909c"/>
    <!-- legs -->
    <rect x="28" y="115" width="21" height="35" fill="#263238"/>
    <rect x="63" y="115" width="21" height="35" fill="#263238"/>
    <!-- boots -->
    <rect x="28" y="143" width="21" height="14" fill="#1a1a1a"/>
    <rect x="63" y="143" width="21" height="14" fill="#1a1a1a"/>
    <!-- teal boot trim -->
    <rect x="28" y="143" width="21" height="3" fill="#00838f"/>
    <rect x="63" y="143" width="21" height="3" fill="#00838f"/>
  </svg>`,

  cleric: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 168" width="112" height="168">
    <!-- halo -->
    <rect x="35" y="0" width="42" height="6" fill="#ffd700"/>
    <rect x="28" y="3" width="56" height="3" fill="#ffe082"/>
    <!-- cowl -->
    <rect x="28" y="7" width="56" height="12" fill="#f5f5f5"/>
    <!-- face -->
    <rect x="35" y="19" width="42" height="20" fill="#ffcc80"/>
    <!-- eyes (gentle) -->
    <rect x="42" y="26" width="8" height="6" fill="#5d4037"/>
    <rect x="62" y="26" width="8" height="6" fill="#5d4037"/>
    <!-- neck -->
    <rect x="42" y="39" width="28" height="7" fill="#ffcc80"/>
    <!-- collar / cowl sides -->
    <rect x="21" y="39" width="21" height="20" fill="#f5f5f5"/>
    <rect x="70" y="39" width="21" height="20" fill="#f5f5f5"/>
    <!-- robe body -->
    <rect x="21" y="46" width="70" height="70" fill="#fafafa"/>
    <!-- gold trim cross -->
    <rect x="49" y="52" width="14" height="35" fill="#ffd700"/>
    <rect x="35" y="63" width="42" height="14" fill="#ffd700"/>
    <!-- inner white -->
    <rect x="52" y="55" width="8" height="29" fill="#fff9c4"/>
    <rect x="38" y="66" width="36" height="8" fill="#fff9c4"/>
    <!-- sleeves -->
    <rect x="7" y="46" width="14" height="42" fill="#f5f5f5"/>
    <rect x="91" y="46" width="14" height="42" fill="#f5f5f5"/>
    <!-- holy symbol (orb in hand) -->
    <rect x="0" y="70" width="14" height="14" fill="#ffe082"/>
    <rect x="3" y="73" width="8" height="8" fill="#ffd700"/>
    <!-- robe skirt -->
    <rect x="14" y="116" width="84" height="35" fill="#fafafa"/>
    <!-- gold hem -->
    <rect x="14" y="143" width="84" height="10" fill="#ffd700"/>
  </svg>`,

  goblin: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 168" width="112" height="168">
    <!-- big pointy ears -->
    <rect x="0"  y="19" width="21" height="7"  fill="#558b2f"/>
    <rect x="91" y="19" width="21" height="7"  fill="#558b2f"/>
    <rect x="0"  y="13" width="14" height="7"  fill="#558b2f"/>
    <rect x="98" y="13" width="14" height="7"  fill="#558b2f"/>
    <!-- head (wide, squat) -->
    <rect x="21" y="13" width="70" height="42" fill="#7cb342"/>
    <!-- bumpy forehead ridges -->
    <rect x="28" y="13" width="14" height="6"  fill="#8bc34a"/>
    <rect x="56" y="13" width="14" height="6"  fill="#8bc34a"/>
    <rect x="70" y="13" width="14" height="6"  fill="#8bc34a"/>
    <!-- sunken beady eyes (angry) -->
    <rect x="28" y="26" width="14" height="7"  fill="#1b1b1b"/>
    <rect x="70" y="26" width="14" height="7"  fill="#1b1b1b"/>
    <!-- red pupils -->
    <rect x="32" y="28" width="6"  height="4"  fill="#d32f2f"/>
    <rect x="74" y="28" width="6"  height="4"  fill="#d32f2f"/>
    <!-- flat smashed nose -->
    <rect x="49" y="33" width="14" height="6"  fill="#558b2f"/>
    <!-- huge grinning mouth with fangs -->
    <rect x="28" y="40" width="56" height="7"  fill="#1b1b1b"/>
    <rect x="35" y="40" width="7"  height="4"  fill="#f5f5f5"/>
    <rect x="63" y="40" width="7"  height="4"  fill="#f5f5f5"/>
    <rect x="42" y="43" width="28" height="4"  fill="#c62828"/>
    <!-- neck (thick) -->
    <rect x="35" y="55" width="42" height="7"  fill="#7cb342"/>
    <!-- chunky torso (ragged leather) -->
    <rect x="21" y="62" width="70" height="42" fill="#5d4037"/>
    <!-- belly bulge hint -->
    <rect x="28" y="76" width="56" height="14" fill="#6d4c41"/>
    <!-- torn cloth strips -->
    <rect x="21" y="90" width="10" height="14" fill="#4e342e"/>
    <rect x="81" y="90" width="10" height="14" fill="#4e342e"/>
    <!-- massive right arm -->
    <rect x="91" y="62" width="21" height="42" fill="#7cb342"/>
    <!-- massive left arm -->
    <rect x="0"  y="62" width="21" height="42" fill="#7cb342"/>
    <!-- spiked club (right hand) -->
    <rect x="105" y="48" width="7" height="70" fill="#5d4037"/>
    <rect x="100" y="48" width="14" height="7" fill="#5d4037"/>
    <!-- spikes on club -->
    <rect x="98" y="55" width="5"  height="5"  fill="#9e9e9e"/>
    <rect x="109" y="62" width="5" height="5"  fill="#9e9e9e"/>
    <rect x="98" y="69" width="5"  height="5"  fill="#9e9e9e"/>
    <!-- stubby legs -->
    <rect x="28" y="104" width="21" height="35" fill="#558b2f"/>
    <rect x="63" y="104" width="21" height="35" fill="#558b2f"/>
    <!-- crude boots -->
    <rect x="21" y="132" width="28" height="14" fill="#3e2723"/>
    <rect x="63" y="132" width="28" height="14" fill="#3e2723"/>
    <!-- bone/thorn on boots -->
    <rect x="21" y="132" width="5"  height="5"  fill="#e0e0e0"/>
    <rect x="86" y="132" width="5"  height="5"  fill="#e0e0e0"/>
  </svg>`,

  ranger: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 168" width="112" height="168">
    <!-- ranger cap -->
    <rect x="35" y="7" width="42" height="13" fill="#33691e"/>
    <rect x="21" y="19" width="70" height="6" fill="#33691e"/>
    <!-- amber feather -->
    <rect x="77" y="0" width="7" height="19" fill="#ff8f00"/>
    <rect x="80" y="3" width="5" height="3" fill="#ffc107"/>
    <!-- face -->
    <rect x="35" y="25" width="42" height="19" fill="#ffcc80"/>
    <!-- eyes -->
    <rect x="42" y="32" width="8" height="6" fill="#4e342e"/>
    <rect x="62" y="32" width="8" height="6" fill="#4e342e"/>
    <!-- neck -->
    <rect x="42" y="44" width="28" height="7" fill="#ffcc80"/>
    <!-- leather vest -->
    <rect x="28" y="51" width="56" height="49" fill="#5d4037"/>
    <!-- green cloak -->
    <rect x="14" y="51" width="14" height="63" fill="#558b2f"/>
    <rect x="84" y="51" width="14" height="63" fill="#558b2f"/>
    <!-- cloak details -->
    <rect x="14" y="65" width="14" height="7" fill="#33691e"/>
    <rect x="84" y="65" width="14" height="7" fill="#33691e"/>
    <!-- belt -->
    <rect x="28" y="93" width="56" height="7" fill="#4e342e"/>
    <rect x="49" y="93" width="14" height="7" fill="#8d6e63"/>
    <!-- bow (left side) -->
    <rect x="0" y="7" width="7" height="112" fill="#6d4c41"/>
    <rect x="0" y="13" width="3" height="7" fill="#5d4037"/>
    <rect x="0" y="100" width="3" height="7" fill="#5d4037"/>
    <!-- bowstring -->
    <rect x="3" y="7" width="3" height="112" fill="#ffc107"/>
    <!-- arrow nocked -->
    <rect x="3" y="56" width="28" height="4" fill="#ffc107"/>
    <rect x="28" y="54" width="7" height="7" fill="#ff8f00"/>
    <!-- legs -->
    <rect x="28" y="100" width="21" height="42" fill="#5d4037"/>
    <rect x="63" y="100" width="21" height="42" fill="#5d4037"/>
    <!-- boots -->
    <rect x="28" y="136" width="21" height="14" fill="#4e342e"/>
    <rect x="63" y="136" width="21" height="14" fill="#4e342e"/>
    <!-- green boot cuffs -->
    <rect x="28" y="136" width="21" height="5" fill="#33691e"/>
    <rect x="63" y="136" width="21" height="5" fill="#33691e"/>
  </svg>`,
};

function renderCharPortrait() {
  const wrap = document.getElementById('char-portrait-wrap');
  const figEl = document.getElementById('char-portrait-figure');
  const svgEl = document.getElementById('char-portrait-svg');
  const labelEl = document.getElementById('char-portrait-label');
  if (!wrap || !svgEl || !labelEl) return;

  const p = state.player;
  if (!p || state.screen !== 'game') {
    wrap.classList.add('hidden');
    return;
  }

  const cls = CLASSES[p.player_class] || CLASSES.warrior;
  const s = ps(p);
  const sprFn = CHARACTER_SPRITES[p.player_class] || CHARACTER_SPRITES.warrior;
  svgEl.innerHTML = sprFn();
  labelEl.textContent = `${cls.name} · Lv ${s.level || 1}`;
  wrap.classList.remove('hidden');

  // Low HP pulse
  if (figEl) {
    if (s.health > 0 && s.max_health > 0 && (s.health / s.max_health) < 0.25) {
      figEl.classList.add('char-low-hp');
    } else {
      figEl.classList.remove('char-low-hp');
    }
  }
}

function triggerCharAttack() {
  const el = document.getElementById('char-portrait-figure');
  if (!el) return;
  el.classList.remove('char-hurt');
  void el.offsetWidth;
  el.classList.add('char-attack');
  setTimeout(() => el.classList.remove('char-attack'), 420);
}

function triggerCharHurt() {
  const el = document.getElementById('char-portrait-figure');
  if (!el) return;
  el.classList.remove('char-attack');
  void el.offsetWidth;
  el.classList.add('char-hurt');
  setTimeout(() => el.classList.remove('char-hurt'), 640);
}

function renderGameUI() {
  renderStats();
  renderPhaseBanner();
  renderActionBar();
  renderEnemies();
  renderGameParty();
  updateCompanionPanel();
  renderCharPortrait();
  if (laMap && state.dungeon) laMap.render(state.dungeon);
  updateMapProgress();
}

function renderStats() {
  const p = state.player;
  if (!p) return;
  const cls = CLASSES[p.player_class] || CLASSES.warrior;
  const s = ps(p);
  const hpPct = pctOf(s.health, s.max_health);
  const mpPct = pctOf(s.mana, s.max_mana);
  const xpNeed = [0,0,100,300,600,1000,1500,2100,2800,3600,4500][s.level] || 4500;
  const xpPct = pctOf(s.experience || 0, xpNeed);
  const hpLow = hpPct < 25;
  const mpRegen = (p.player_class === 'mage') ? 5 : 3;

  document.getElementById('stats-panel').innerHTML = `
    <div class="stats-header">
      <span class="class-emoji">${cls.emoji}</span>
      <div>
        <h3>${p.name}</h3>
        <p>${cls.name} · Lv ${s.level || 1}</p>
      </div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>❤️ HP</span><span>${s.health}/${s.max_health}</span></div>
      <div class="bar-track"><div class="bar-fill bar-hp ${hpLow?'low':''}" style="width:${hpPct}%"></div></div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>💙 MP <span class="regen-hint">+${mpRegen}/t</span></span><span>${s.mana}/${s.max_mana}</span></div>
      <div class="bar-track"><div class="bar-fill bar-mp" style="width:${mpPct}%"></div></div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>⭐ XP</span><span>${s.experience||0}/${xpNeed}</span></div>
      <div class="bar-track" style="height:4px"><div class="bar-fill bar-xp" style="width:${xpPct}%"></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-label">Gold</div><div class="stat-value stat-gold">💰 ${s.gold||0}</div></div>
      <div class="stat-item"><div class="stat-label">STR</div><div class="stat-value stat-str">${s.strength||0}</div></div>
      <div class="stat-item"><div class="stat-label">INT</div><div class="stat-value stat-int">${s.intelligence||0}</div></div>
      <div class="stat-item"><div class="stat-label">DEX</div><div class="stat-value stat-dex">${s.dexterity||0}</div></div>
    </div>
  `;
}

let _lastPhase = '';
function renderPhaseBanner() {
  const banner = document.getElementById('phase-banner');
  const phase = state.phase || 'exploring';
  const changed = phase !== _lastPhase;
  _lastPhase = phase;
  banner.className = `phase-banner ${phase}`;
  const phaseLabel = PHASE_LABELS[phase] || phase.toUpperCase();
  let turnIndicatorHtml = '';
  if (phase === 'combat' && state.combat) {
    const activePid = state.combat.active_player_id;
    const turnOrder = state.combat.turn_order || [];
    const isMyTurn = !activePid || activePid === state.playerId;
    let tLabel, tCls;
    if (isMyTurn) {
      tLabel = '⚔️ YOUR TURN';
      tCls = 'player-turn';
    } else {
      const cache = state.partyMembersStats || {};
      const activeMember = cache[activePid];
      const activeName = activeMember ? activeMember.name : 'Ally';
      tLabel = `⏳ ${activeName}'s turn`;
      tCls = 'ally-turn';
    }
    let orderHtml = '';
    if (turnOrder.length > 1) {
      const cache = state.partyMembersStats || {};
      orderHtml = turnOrder.map(pid => {
        const isActive = pid === activePid;
        const m = cache[pid];
        const nm = m ? m.name : (pid === state.playerId ? (state.player && state.player.name) || 'You' : '?');
        return `<span class="turn-order-pip${isActive ? ' active' : ''}">${nm}</span>`;
      }).join('<span class="turn-order-sep">→</span>');
      orderHtml = `<span class="turn-order-row">${orderHtml}</span>`;
    }
    turnIndicatorHtml = `<span class="turn-indicator ${tCls}">${tLabel}</span>${orderHtml}`;
  } else if (phase !== 'combat') {
    // Explore / loot / victory phases — show explore turn order
    const activePid = state.exploreActivePid;
    const turnOrder = state.exploreTurnOrder || [];
    if (activePid && turnOrder.length > 1) {
      const isMyTurn = activePid === state.playerId;
      const cache = state.partyMembersStats || {};
      let tLabel, tCls;
      if (isMyTurn) {
        tLabel = '🧭 YOUR TURN';
        tCls = 'player-turn';
      } else {
        const m = cache[activePid];
        tLabel = `⏳ ${m ? m.name : 'Ally'}'s turn`;
        tCls = 'ally-turn';
      }
      const orderHtml = turnOrder.map(pid => {
        const isActive = pid === activePid;
        const m = cache[pid];
        const nm = m ? m.name : (pid === state.playerId ? (state.player && state.player.name) || 'You' : '?');
        return `<span class="turn-order-pip${isActive ? ' active' : ''}">${nm}</span>`;
      }).join('<span class="turn-order-sep">→</span>');
      turnIndicatorHtml = `<span class="turn-indicator ${tCls}">${tLabel}</span><span class="turn-order-row">${orderHtml}</span>`;
    }
  }
  document.getElementById('phase-text').innerHTML = `<span class="phase-label">${phaseLabel}</span>${turnIndicatorHtml}`;
  document.getElementById('game-time').textContent = `Day ${state.gameDay} · ${String(state.gameHour).padStart(2,'0')}:00`;
  if (changed) {
    banner.classList.add('just-changed');
    setTimeout(() => banner.classList.remove('just-changed'), 400);
  }
}

function renderActionBar() {
  renderExploreToolbar();
  const bar = document.getElementById('action-bar');
  const phase = state.phase || 'exploring';
  bar.classList.toggle('player-turn-active', isPlayersTurn());

  if (phase === 'victory' || phase === 'game_over') {
    bar.innerHTML = `
      <button class="btn btn-primary" id="btn-return-lobby">
        ${phase === 'victory' ? '🏆 Return to Lobby' : '💀 Back to Lobby'}
      </button>
    `;
    document.getElementById('btn-return-lobby').addEventListener('click', returnToLobby);
    updatePlayerInputState();
    return;
  }

  if (phase === 'combat') {
    const p = state.player;
    const skills = (p && p.skills) ? p.skills : [];
    const hasPotion = p && p.inventory && p.inventory.some(i => (typeof i === 'string' ? i : i.name || '').includes('health_potion'));

    // Check if it's this player's turn in party combat
    const activePid = state.combat && state.combat.active_player_id;
    const isMyTurn = !activePid || activePid === state.playerId;

    if (!isMyTurn) {
      // Waiting for another player's turn
      const cache = state.partyMembersStats || {};
      const activeMember = cache[activePid];
      const activeName = activeMember ? activeMember.name : 'your ally';
      bar.innerHTML = `
        <div class="waiting-turn-panel">
          <div class="waiting-turn-pulse"></div>
          <div class="waiting-turn-text">
            <span class="waiting-turn-icon">⚔️</span>
            <span class="waiting-turn-name">${activeName}</span>
            <span class="waiting-turn-label"> is taking their turn…</span>
          </div>
        </div>
      `;
      updatePlayerInputState();
      return;
    }

    bar.innerHTML = `
      <div class="action-group">
        <button class="attack-btn" id="btn-attack">⚔️ ATTACK</button>
      </div>
      <div class="action-divider"></div>
      <div class="action-group" id="skill-buttons"></div>
      <div class="action-divider"></div>
      <button class="flee-btn" id="btn-flee">🏃 FLEE</button>
    `;

    document.getElementById('btn-attack').addEventListener('click', () => {
      ws.send('COMBAT_ACTION', { action: 'attack' });
    });
    document.getElementById('btn-flee').addEventListener('click', () => {
      ws.send('COMBAT_ACTION', { action: 'flee' });
    });

    const skillContainer = document.getElementById('skill-buttons');
    const cooldowns = (state.combat && state.combat.skill_cooldowns) || {};
    skills.forEach(skillKey => {
      const skill = SKILLS[skillKey] || { name: skillKey, emoji: '✨', mp: 0 };
      const p = state.player;
      const cdTurns = cooldowns[skillKey] || 0;
      const canUse = !p || (ps(p).mana >= skill.mp && cdTurns === 0);
      const btn = document.createElement('button');
      btn.className = `skill-btn${cdTurns > 0 ? ' on-cooldown' : ''}`;
      btn.dataset.cls = p.player_class || 'warrior';
      btn.disabled = !canUse;
      if (cdTurns > 0) {
        btn.innerHTML = `<span>${skill.emoji} ${skill.name}</span><span class="skill-cooldown-overlay">${cdTurns}</span>`;
      } else {
        btn.innerHTML = `<span>${skill.emoji} ${skill.name}</span><span class="skill-cost">${skill.mp} MP</span>`;
      }
      btn.addEventListener('click', () => {
        ws.send('COMBAT_ACTION', { action: 'skill', skill_name: skillKey });
      });
      skillContainer.appendChild(btn);
    });

    // Potion button if available
    if (p && p.inventory) {
      const potionItem = p.inventory.find(item => {
        const name = typeof item === 'string' ? item : item.name;
        return name && name.includes('health_potion');
      });
      if (potionItem) {
        const potBtn = document.createElement('button');
        potBtn.className = 'skill-btn';
        potBtn.innerHTML = `<span>🧪 Potion</span><span class="skill-cost">use</span>`;
        potBtn.addEventListener('click', () => {
          const name = typeof potionItem === 'string' ? potionItem : potionItem.name;
          ws.send('COMBAT_ACTION', { action: 'use_item', item_id: name });
        });
        skillContainer.appendChild(potBtn);
      }
    }
    updatePlayerInputState();
    return;
  }

  // Helper: render waiting overlay for explore turns
  function exploreWaitingHtml() {
    const activePid = state.exploreActivePid;
    const cache = state.partyMembersStats || {};
    const m = cache[activePid];
    const activeName = m ? m.name : 'your ally';
    return `
      <div class="waiting-turn-panel">
        <div class="waiting-turn-pulse"></div>
        <div class="waiting-turn-text">
          <span class="waiting-turn-icon">🧭</span>
          <span class="waiting-turn-name">${activeName}</span>
          <span class="waiting-turn-label"> is leading the way…</span>
        </div>
      </div>
    `;
  }

  // Check explore turn gating for non-combat phases
  const exploreActivePid = state.exploreActivePid;
  const isMyExploreTurn = !exploreActivePid || exploreActivePid === state.playerId;

  if (phase === 'looting') {
    if (!isMyExploreTurn) {
      bar.innerHTML = exploreWaitingHtml();
      updatePlayerInputState();
      return;
    }
    bar.innerHTML = `
      <button class="btn btn-accent btn-large" id="btn-loot">💰 LOOT THE ROOM</button>
      <span style="color:var(--text-muted);font-size:11px">or continue exploring</span>
    `;
    document.getElementById('btn-loot').addEventListener('click', () => {
      ws.send('LOOT_ROOM', {});
    });
    // Also show direction buttons for already-cleared rooms
    renderDirectionButtons(bar, true);
    updatePlayerInputState();
    return;
  }

  // Exploring (default) — direction buttons + contextual actions
  if (!isMyExploreTurn) {
    bar.innerHTML = exploreWaitingHtml();
    updatePlayerInputState();
    return;
  }

  bar.innerHTML = `
    <div class="action-group" id="dir-group"></div>
    <div class="action-divider"></div>
    <div class="action-group contextual-actions" id="contextual-actions-group">
      <span style="color:var(--text-dim);font-size:11px;align-self:center">✨ Loading actions…</span>
    </div>
  `;
  renderDirectionButtons(document.getElementById('dir-group'), false);

  // Load contextual actions for current room
  const curRoom = state.dungeon && state.dungeon.rooms && state.dungeon.rooms[state.dungeon.current_room_id];
  if (curRoom) loadContextualActions(curRoom);
  updatePlayerInputState();
}

function renderDirectionButtons(container, append) {
  const dungeon = state.dungeon;
  const currentRoom = dungeon && dungeon.current_room_id ? dungeon.rooms[dungeon.current_room_id] : null;
  const exits = currentRoom ? (currentRoom.exits || {}) : {};

  // Detect POI mode (forward/back exits) vs classic mode (cardinal)
  const isPOI = 'forward' in exits || 'back' in exits;

  const dirs = isPOI
    ? [
        { key: 'back',    icon: '⟵', label: 'Back'    },
        { key: 'forward', icon: '⟶', label: 'Forward'  },
      ]
    : [
        { key: 'north', icon: '↑', label: 'N' },
        { key: 'west',  icon: '←', label: 'W' },
        { key: 'east',  icon: '→', label: 'E' },
        { key: 'south', icon: '↓', label: 'S' },
      ];

  const group = append ? document.createElement('div') : container;
  if (append) {
    group.className = isPOI ? 'action-group action-group--poi' : 'action-group';
    container.appendChild(group);
  } else if (isPOI) {
    group.classList.add('action-group--poi');
  }

  dirs.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'dir-btn';
    btn.title = d.label;
    btn.innerHTML = `${d.icon} <span style="font-size:10px">${d.label}</span>`;
    btn.disabled = !exits[d.key];
    btn.addEventListener('click', () => ws.send('MOVE', { direction: d.key }));
    group.appendChild(btn);
  });
}

function renderEnemies() {
  const el = document.getElementById('enemy-list');
  const combat = state.combat;
  const phase = state.phase;

  if (!combat || !combat.enemies || phase !== 'combat') {
    el.innerHTML = '<div class="empty-state">The room is clear.</div>';
    document.getElementById('combat-panel-title').textContent = '⚔ Encounter';
    return;
  }

  document.getElementById('combat-panel-title').textContent = `⚔ Combat — Turn ${combat.turn_number || 1}`;

  const enemyStatuses = (combat.enemy_status_effects) || {};
  el.innerHTML = combat.enemies.map(enemy => {
    const hpPct = pctOf(enemy.hp, enemy.max_hp);
    const isDead = enemy.hp <= 0;
    const phase2 = enemy.boss_phase === 2;
    const statusEffects = (enemyStatuses[enemy.id] || []);
    const statusBadges = statusEffects.map(e =>
      `<span class="status-badge">${e.emoji} ${e.turns}</span>`).join('');
    return `
      <div class="enemy-card ${enemy.stunned ? 'stunned' : ''} ${isDead ? 'dead' : ''} ${phase2 ? 'phase2' : ''}" id="enemy-${enemy.id}">
        <div class="enemy-header">
          <span class="enemy-emoji">${enemy.emoji || '👹'}</span>
          <span class="enemy-name">${enemy.name}${phase2 ? ' 💢' : ''}</span>
          ${enemy.is_boss ? '<span class="enemy-boss-tag">BOSS</span>' : ''}
          ${enemy.stunned ? '<span class="enemy-stun-tag">STUNNED</span>' : ''}
        </div>
        <div class="enemy-hp-bar">
          <div class="enemy-hp-fill" style="width:${hpPct}%"></div>
        </div>
        <div class="enemy-hp-text">${enemy.hp}/${enemy.max_hp} HP · ATK ${enemy.attack} · DEF ${enemy.defense}</div>
        ${statusBadges ? `<div class="status-badges">${statusBadges}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderGameParty() {
  const el = document.getElementById('game-party-members');
  if (!el) return;
  const party = state.party;
  const otherIds = (party && party.member_ids || []).filter(id => id !== state.playerId);
  if (otherIds.length === 0) {
    el.innerHTML = '<div class="empty-state" style="font-size:10px">Solo adventure</div>';
    return;
  }
  const cache = state.partyMembersStats || {};
  const activePid = state.combat && state.combat.active_player_id;
  el.innerHTML = otherIds.map(id => {
    const m = cache[id];
    if (!m) return `<div class="game-party-member"><div class="gpm-header"><span class="gpm-emoji">👤</span><div class="gpm-info"><span class="gpm-name">Adventurer</span><span class="gpm-meta">connecting...</span></div></div></div>`;
    const cls = CLASSES[m.player_class] || CLASSES.warrior;
    const hpPct = pctOf(m.hp, m.max_hp);
    const mpPct = pctOf(m.mana, m.max_mana);
    const hpColor = hpPct < 25 ? '#e53935' : hpPct < 50 ? '#fb8c00' : '#4caf50';
    const isActive = activePid === id;
    return `<div class="game-party-member${isActive ? ' gpm-active-turn' : ''}">
      <div class="gpm-header">
        <span class="gpm-emoji">${cls.emoji}</span>
        <div class="gpm-info">
          <span class="gpm-name">${m.name}${isActive ? ' <span class="gpm-turn-badge">TURN</span>' : ''}</span>
          <span class="gpm-meta">Lv ${m.level} ${m.player_class}</span>
        </div>
        <span class="gpm-hp-num" style="color:${hpColor}">${m.hp}/${m.max_hp}</span>
      </div>
      <div class="bar-track gpm-bar">
        <div class="bar-fill bar-hp" style="width:${hpPct}%;background:${hpColor}"></div>
      </div>
      <div class="bar-track gpm-bar">
        <div class="bar-fill bar-mp" style="width:${mpPct}%"></div>
      </div>
    </div>`;
  }).join('');
}

function updateMapProgress() {
  const dungeon = state.dungeon;
  if (!dungeon) return;
  const rooms = Object.values(dungeon.rooms || {});
  const cleared = rooms.filter(r => r.cleared).length;
  document.getElementById('map-progress').textContent = `${cleared}/${rooms.length}`;
}

// ═══════════════════════════════════════════════════════
// CONTEXTUAL ACTIONS (Claude-generated per room)
// ═══════════════════════════════════════════════════════

let _contextualActionRoom = null;

async function loadContextualActions(room, narrativeHint) {
  if (!room) return;
  _contextualActionRoom = room.id;

  const pos = getPosition();
  const nearby = [];
  if (state.dungeon && state.dungeon.rooms) {
    Object.values(state.dungeon.rooms).forEach(r => {
      if (r.id !== room.id && r.name) nearby.push(r.name);
    });
  }

  // Use latest DM narrative or lastNarrativeHint to drive specific action buttons
  const narrative = narrativeHint || lastNarrativeHint || '';

  try {
    const body = {
      room_name: room.name || 'Unknown Room',
      room_type: room.room_type || 'corridor',
      room_description: room.description || '',
      player_class: state.player?.player_class || 'warrior',
      player_name: state.player?.name || 'Hero',
      enemies: (room.enemies || []).map(e => e.name || e),
      location_name: pos ? `${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}` : '',
      nearby_pois: nearby.slice(0, 5),
      dm_narrative: narrative.slice(0, 800),
    };

    const r = await fetch('/contextual-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('fetch failed');
    const data = await r.json();

    // Only render if we're still in the same room
    if (_contextualActionRoom !== room.id) return;
    renderContextualActions(data.actions || []);
  } catch(e) {
    if (_contextualActionRoom === room.id) {
      renderContextualActions([
        { label: 'Search the area', action: 'searches the area carefully', icon: '🔍' },
        { label: 'Listen quietly', action: 'listens for sounds', icon: '👂' },
        { label: 'Check your gear', action: 'checks their gear', icon: '🎒' },
      ]);
    }
  }
}

function renderContextualActions(actions) {
  const container = document.getElementById('contextual-actions-group');
  if (!container) return;

  container.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm contextual-action-btn';
    btn.innerHTML = `${a.icon || '✨'} ${a.label}`;
    btn.title = a.action || a.label;
    btn.addEventListener('click', () => {
      if (!isPlayersTurn()) return;
      // Send the action as a free-form player action
      ws.send('PLAYER_ACTION', { action: a.action, label: a.label });
      addLog(`You ${a.action}.`, 'narrative');
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });
    container.appendChild(btn);
  });
}

function returnToLobby() {
  state.dungeon = null;
  state.combat = null;
  state.phase = 'exploring';
  if (laMap) laMap.reset();
  showScreen('lobby');
  renderCurrentParty();
  refreshParties();
}

// ═══════════════════════════════════════════════════════
// NARRATIVE LOG
// ═══════════════════════════════════════════════════════

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function addLog(text, kind = 'narrative') {
  const el = document.getElementById('narrative-log');
  if (!el) return;

  const entry = document.createElement('div');
  // Companion action log entries get special styling
  const isCompanion = typeof text === 'string' && text.startsWith('[') &&
    (text.includes('Bryn') || text.includes('Luma') || text.includes('Shade') ||
     text.includes('Seraph') || text.includes('Fang'));
  entry.className = `log-entry ${kind}${isCompanion ? ' companion-action' : ''}`;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  entry.innerHTML = `${renderMarkdown(text)}<span class="log-time">${timeStr}</span>`;
  el.appendChild(entry);

  // Auto-scroll
  el.scrollTop = el.scrollHeight;

  // Keep log manageable
  while (el.children.length > 100) el.removeChild(el.firstChild);
}

// ═══════════════════════════════════════════════════════
// SCENE IMAGE GENERATION (DALL-E 3 via server)
// ═══════════════════════════════════════════════════════

// Track last narrative so DM_RESPONSE can trigger a scene refresh
let lastNarrativeHint = '';

function generateSceneImage(room, narrativeHint) {
  if (!room) return;
  if (!sceneImageEnabled) {
    // Show a placeholder when art is disabled
    const img = document.getElementById('scene-image');
    if (img) { img.src = ''; img.style.display = 'none'; }
    const loading = document.getElementById('scene-loading');
    if (loading) loading.style.display = 'none';
    return;
  }
  currentRoomData = room;

  const img = document.getElementById('scene-image');
  const loading = document.getElementById('scene-loading');
  const nameEl = document.getElementById('scene-room-name');
  const wrapper = document.getElementById('scene-wrapper');

  const realName = (laMap && laMap.getRoomName(room.id)) || room.name || '';
  nameEl.textContent = realName;
  wrapper.style.background = roomGradient(room.room_type);
  img.style.display = 'none';
  loading.style.display = 'flex';

  const pos = getPosition();
  const locHint = pos ? `near lat ${pos.lat.toFixed(2)} lng ${pos.lng.toFixed(2)},` : '';
  const zoneName = (laMap && laMap.getZoneName()) || '';
  const hasEnemies = room.enemies && room.enemies.length > 0;
  const enemyDesc = hasEnemies ? room.enemies.map(e => e.name).join(', ') : '';

  // Use narrative hint to ground the image in what's actually happening in the story
  const storyContext = narrativeHint
    ? narrativeHint.replace(/[^\w\s,.'"-]/g, '').slice(0, 200)
    : '';

  let prompt = `dark fantasy RPG scene`;
  if (zoneName) prompt += ` in ${zoneName}, Los Angeles`;
  if (locHint) prompt += `, ${locHint}`;
  prompt += `, ${realName}`;
  if (storyContext) prompt += `. Scene: ${storyContext}`;
  if (room.room_type === 'boss') prompt += ', final boss chamber, ancient evil, dramatic purple light';
  else if (room.room_type === 'treasure') prompt += ', hidden treasure vault, gold and gems glowing';
  else if (room.room_type === 'start') prompt += ', adventure entrance, torch-lit stone archway';
  else if (!storyContext) prompt += `, ${room.description || room.name || 'dungeon corridor'}`;
  if (hasEnemies) prompt += `, ${enemyDesc} lurking`;
  prompt += ', cinematic wide shot, oil painting, atmospheric fog, concept art';

  const seed = sceneImageSeed;

  const showFallback = () => {
    loading.style.display = 'none';
    img.style.display = 'none';
    wrapper.style.background = roomGradient(room.room_type);
  };

  function loadImageUrl(url) {
    const tempImg = new Image();
    const timeout = setTimeout(showFallback, 30000);
    tempImg.onload = () => {
      clearTimeout(timeout);
      img.src = url;
      img.style.display = '';
      img.style.opacity = '0';
      loading.style.display = 'none';
      requestAnimationFrame(() => {
        img.style.transition = 'opacity 1s ease';
        img.style.opacity = '1';
      });
    };
    tempImg.onerror = () => { clearTimeout(timeout); showFallback(); };
    tempImg.src = url;
  }

  // DALL-E 3 via server (/scene-art returns {url} JSON)
  fetch(`/scene-art?prompt=${encodeURIComponent(prompt)}`)
    .then(r => r.ok ? r.json() : Promise.reject('no key'))
    .then(data => {
      if (data && data.url) loadImageUrl(data.url);
      else showFallback();
    })
    .catch(() => showFallback());
}

function roomGradient(type) {
  const gradients = {
    start:    'radial-gradient(ellipse at 50% 80%, #1a3a1a 0%, #0a1a0a 60%, #050a05 100%)',
    corridor: 'radial-gradient(ellipse at 30% 70%, #1a1a3a 0%, #0d0d20 60%, #080810 100%)',
    chamber:  'radial-gradient(ellipse at 50% 60%, #221535 0%, #130d22 60%, #080810 100%)',
    treasure: 'radial-gradient(ellipse at 50% 80%, #3a2e00 0%, #1f1800 50%, #0a0800 100%)',
    boss:     'radial-gradient(ellipse at 50% 40%, #3a0a4a 0%, #1a0028 50%, #080010 100%)',
  };
  return gradients[type] || gradients.chamber;
}

function generateCustomArt() {
  const promptEl = document.getElementById('art-prompt');
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  const gallery = document.getElementById('art-gallery');
  const fullPrompt = `${prompt}, dark fantasy RPG, dramatic lighting, Los Angeles`;
  const encoded = encodeURIComponent(fullPrompt);
  const url = `/scene-art?prompt=${encoded}`;

  // Add placeholder
  const item = document.createElement('div');
  item.className = 'art-item';
  item.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;background:var(--surface2);gap:8px">
    <span class="spinner"></span><span style="font-size:11px;color:var(--text-dim)">Painting...</span>
  </div>`;
  gallery.insertBefore(item, gallery.firstChild);

  const img = new Image();
  img.onload = () => {
    item.innerHTML = '';
    const imgEl = document.createElement('img');
    imgEl.src = url;
    imgEl.style.cssText = 'width:100%;display:block;border-radius:var(--radius)';
    item.appendChild(imgEl);
    // Click to expand
    item.addEventListener('click', () => expandImage(url, prompt));
  };
  img.onerror = () => {
    item.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--red)">Failed to generate image.</div>`;
  };
  img.src = url;

  promptEl.value = '';
}

// ═══════════════════════════════════════════════════════
// LOCATION HISTORY
// ═══════════════════════════════════════════════════════

async function showLocationHistory() {
  const room = currentRoomData;
  const locationName = (laMap && laMap.getRoomName(room && room.id)) || (room && room.name) || 'This Location';
  const lat = (laMap && room && laMap.roomLocations[room.id]) ? laMap.roomLocations[room.id][0] : 34.0522;
  const lng = (laMap && room && laMap.roomLocations[room.id]) ? laMap.roomLocations[room.id][1] : -118.2437;

  // Open modal, show spinner
  const modal = document.getElementById('history-modal');
  const body  = document.getElementById('history-modal-body');
  const title = document.getElementById('history-modal-title');
  const sub   = document.getElementById('history-modal-subtitle');
  const thumb = document.getElementById('history-modal-thumb');
  const link  = document.getElementById('history-wiki-link');

  title.textContent = `📜 ${locationName}`;
  sub.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  body.innerHTML = '<div class="status-line"><span class="spinner"></span><span>Consulting the ancient scrolls...</span></div>';
  thumb.innerHTML = '';
  link.classList.add('hidden');
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/location-history?name=${encodeURIComponent(locationName)}&lat=${lat}&lng=${lng}`);
    const data = await res.json();

    const sourceBadge = data.source === 'wikipedia'
      ? '<span class="history-source-badge">Wikipedia</span>'
      : '<span class="history-source-badge">Game Lore</span>';

    body.innerHTML = sourceBadge + '<p style="margin-top:8px">' + (data.extract || 'No records found.') + '</p>';

    if (data.thumbnail) {
      thumb.innerHTML = `<img src="${data.thumbnail}" alt="${data.title}" />`;
    }
    if (data.url) {
      link.href = data.url;
      link.classList.remove('hidden');
    }
  } catch (e) {
    body.innerHTML = '<p style="color:var(--red)">Failed to load location history.</p>';
  }
}

// ═══════════════════════════════════════════════════════
// TAVERNS
// ═══════════════════════════════════════════════════════

async function showTaverns() {
  // Use real GPS position first; fall back to room map position
  const gps = getPosition();
  const room = currentRoomData;
  let lat, lng, locationName;
  if (gps && gps.lat) {
    lat = gps.lat;
    lng = gps.lng;
    locationName = 'your location';
  } else if (laMap && room && laMap.roomLocations && laMap.roomLocations[room.id]) {
    [lat, lng] = laMap.roomLocations[room.id];
    locationName = (laMap.getRoomName && laMap.getRoomName(room.id)) || room.name || 'the area';
  } else {
    lat = 34.0522; lng = -118.2437; locationName = 'Los Angeles';
  }

  const modal  = document.getElementById('tavern-modal');
  const list   = document.getElementById('tavern-list');
  const label  = document.getElementById('tavern-location-label');
  const status = document.getElementById('tavern-action-status');

  label.textContent = `Near ${locationName}`;
  list.innerHTML = '<div class="status-line"><span class="spinner"></span><span>Scouting establishments...</span></div>';
  status.classList.add('hidden');
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/taverns?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    const taverns = data.taverns || [];

    if (!taverns.length) {
      list.innerHTML = '<div class="empty-state">No real establishments found nearby. Try moving closer to a populated area.</div>';
      return;
    }

    list.innerHTML = taverns.map(t => {
      const dist = t.distance_m < 1000
        ? `${t.distance_m}m away`
        : `${(t.distance_m / 1000).toFixed(1)}km away`;
      const sub = [t.type, t.cuisine].filter(Boolean).join(' · ');
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.name + ' ' + (t.address || ''))}`;
      return `
      <div class="tavern-item">
        <span class="tavern-emoji">${t.emoji}</span>
        <div class="tavern-info">
          <div class="tavern-name">
            <a href="${mapsUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="Open in Google Maps">${t.name} ↗</a>
          </div>
          <div class="tavern-type">${sub}</div>
          ${t.address ? `<div class="tavern-cuisine" style="color:var(--text-dim)">${t.address}</div>` : ''}
          <div class="tavern-cuisine" style="color:var(--text-muted);font-size:11px">${dist}${t.opening_hours ? ' · ' + t.opening_hours : ''}</div>
        </div>
        <button class="tavern-visit-btn" onclick="visitTavern('${t.name.replace(/'/g,"\\'")}')">Visit</button>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<p style="color:var(--red);padding:12px">Failed to find nearby establishments.</p>';
  }
}

function visitTavern(tavernName) {
  const service = window._selectedTavernService || 'ale';
  const status  = document.getElementById('tavern-action-status');
  const p = state.player;
  const COSTS = { ale: 10, meal: 25, elixir: 30, rest: 60 };
  const gold = p ? (p.stats ? p.stats.gold : 0) : 0;
  const cost = COSTS[service] || 10;

  if (gold < cost) {
    status.className = 'tavern-action-status error';
    status.textContent = `⚠️ Not enough gold! You have ${gold}g but need ${cost}g.`;
    status.classList.remove('hidden');
    return;
  }

  status.className = 'tavern-action-status';
  status.innerHTML = '<span class="spinner"></span> Ordering...';
  status.classList.remove('hidden');

  ws.send('TAVERN_VISIT', { tavern_name: tavernName, service });
}

async function sendCompanionMessage() {
  const input = document.getElementById('companion-input');
  const msg = input.value.trim();
  if (!msg) return;

  const p = state.player;
  const log = document.getElementById('companion-log');

  // Remove placeholder
  const placeholder = log.querySelector('.empty-state');
  if (placeholder) placeholder.remove();

  // Show player message as a rich bubble
  appendCompanionBubble(log, 'You', msg, true);
  input.value = '';

  // Build rich context: recent narrative + current game state
  const phase = state.phase || 'exploring';
  const room = currentRoomData;
  const storyLines = _narrativeHistory.slice(-4).join(' | ');
  const context = [
    storyLines ? `Recent story: ${storyLines}` : '',
    phase === 'combat' ? 'We are in combat' : `We are ${phase}`,
    room ? `Current location: ${room.name || 'a dungeon room'}` : '',
    room?.description ? `Room: ${room.description}` : '',
    state.dungeon ? `${state.dungeon.rooms_cleared || 0} rooms cleared` : '',
  ].filter(Boolean).join('. ');

  // Show typing indicator as a companion bubble
  const typingEl = appendCompanionBubble(log, '···', '<span class="spinner" style="width:10px;height:10px;border-width:1px;display:inline-block"></span>', false);

  try {
    const res = await fetch('/companion-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        player_class: p ? p.player_class : 'warrior',
        player_name: p ? p.name : 'Hero',
        context,
      }),
    });
    const data = await res.json();
    const companionName = data.companion || 'Companion';
    const reply = data.reply || '...';
    // Replace typing indicator with real response
    typingEl.querySelector('.companion-sender').textContent = companionName;
    typingEl.querySelector('.companion-bubble').textContent = reply;
    // Also log in chronicle
    addLog(`💬 ${companionName}: "${reply}"`, 'system');
  } catch (e) {
    typingEl.querySelector('.companion-bubble').textContent = '*silence*';
  }
  log.scrollTop = log.scrollHeight;
}

function updateCompanionPanel() {
  const p = state.player;
  if (!p) return;
  const COMPANION_NAMES = {
    warrior: '🛡 Bryn', mage: '✨ Luma', rogue: '🌑 Shade',
    cleric: '☀️ Seraph', ranger: '🐺 Fang', goblin: '🐀 Snark',
  };
  const nameEl = document.getElementById('companion-name');
  const tagEl = document.getElementById('companion-class-tag');
  if (nameEl) nameEl.textContent = COMPANION_NAMES[p.player_class] || '🗡 Companion';
  if (tagEl) tagEl.textContent = p.player_class;
}

function sendPartyChat() {
  const input = document.getElementById('party-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  ws.send('PARTY_CHAT', { text });
  input.value = '';
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function expandImage(url, caption) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer';
  overlay.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:80vh;border-radius:8px;border:1px solid var(--border2)">
    <p style="color:var(--text-dim);font-size:12px;max-width:600px;text-align:center">${caption}</p>
    <span style="font-size:11px;color:var(--text-muted)">Click to close</span>`;
  overlay.addEventListener('click', () => document.body.removeChild(overlay));
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════
// INVENTORY MODAL
// ═══════════════════════════════════════════════════════

function openInventory() {
  const p = state.player;
  if (!p) return;
  document.getElementById('inventory-modal').classList.remove('hidden');
  _renderInvTab('items');

  // Tab switching
  document.querySelectorAll('.inv-tab').forEach(btn => {
    btn.onclick = () => _renderInvTab(btn.dataset.tab);
  });
}

function _renderInvTab(tab) {
  document.querySelectorAll('.inv-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.inv-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById(`inv-pane-${tab}`)?.classList.remove('hidden');

  if (tab === 'items')   _renderInvItems();
  if (tab === 'craft')   _renderInvCraft();
  if (tab === 'skills')  _renderInvSkills();
}

function _renderInvItems() {
  const p = state.player;
  const stats = ps(p) || {};
  const equipped = stats.equipped || {};
  const inv = p ? (p.inventory || []) : [];
  const inCombat = state.phase === 'combat';
  const party = state.party;
  const partyMembers = party ? (party.member_ids || []).filter(id => id !== state.playerId) : [];

  // Equipped slots
  const slotsHtml = ['weapon', 'armor', 'accessory'].map(slot => {
    const key = equipped[slot];
    const d = key ? (ITEM_DATA[key] || {}) : null;
    const emoji = key ? (ITEM_EMOJIS[key] || '📦') : '';
    const rarityColor = d && d.rarity ? EQUIPMENT_RARITIES[d.rarity]?.color || '#aaa' : '#aaa';
    return `<div class="equip-slot">
      <span class="equip-slot-label">${slot.toUpperCase()}</span>
      ${key
        ? `<span class="equip-slot-item equipped" style="color:${rarityColor}">${emoji} ${d?.name || formatName(key)}</span>`
        : `<span class="equip-slot-item empty">— none —</span>`}
    </div>`;
  }).join('');
  document.getElementById('inv-equipped-slots').innerHTML =
    `<div class="inv-section-title">Equipped</div>${slotsHtml}`;

  // Inventory list
  if (!inv.length) {
    document.getElementById('inventory-items').innerHTML = '<div class="empty-state">Empty backpack</div>';
    return;
  }

  const html = inv.map((key, idx) => {
    const d = ITEM_DATA[key] || {};
    const emoji = ITEM_EMOJIS[key] || '📦';
    const name = d.name || formatName(key);
    const desc = d.desc || '';
    const type = d.type || 'key';
    const rarity = d.rarity || '';
    const rarityColor = rarity ? EQUIPMENT_RARITIES[rarity]?.color || '#aaa' : null;
    const rarityBadge = rarity ? `<span class="inv-rarity-badge" style="color:${rarityColor}">${rarity}</span>` : '';
    const typeBadge = `<span class="inv-type-badge inv-type-${type}">${type}</span>`;

    const isConsumable = type === 'consumable';
    const isEquipment = EQUIP_KEYS.has(key);
    const isIngredient = type === 'ingredient';

    let actions = '';
    if (isConsumable && !inCombat) {
      actions += `<button class="inv-btn inv-btn-use" data-item="${key}" data-idx="${idx}">Use</button>`;
    }
    if (isEquipment) {
      actions += `<button class="inv-btn inv-btn-equip" data-item="${key}">Equip</button>`;
    }
    if (partyMembers.length > 0 && !isIngredient) {
      actions += `<button class="inv-btn inv-btn-give" data-item="${key}">Give</button>`;
    }

    return `<div class="inv-item-row">
      <span class="inv-item-emoji">${emoji}</span>
      <div class="inv-item-details">
        <div class="inv-item-top">${name}${rarityBadge}${typeBadge}</div>
        ${desc ? `<div class="inv-item-desc">${desc}</div>` : ''}
      </div>
      <div class="inv-item-actions">${actions}</div>
    </div>`;
  }).join('');
  document.getElementById('inventory-items').innerHTML = html;

  // Bind actions
  document.querySelectorAll('.inv-btn-use').forEach(btn => {
    btn.addEventListener('click', () => {
      ws.send('USE_ITEM', { item_name: btn.dataset.item });
      closeInventory();
    });
  });
  document.querySelectorAll('.inv-btn-equip').forEach(btn => {
    btn.addEventListener('click', () => {
      ws.send('EQUIP_ITEM', { item_key: btn.dataset.item });
      closeInventory();
    });
  });
  document.querySelectorAll('.inv-btn-give').forEach(btn => {
    btn.addEventListener('click', () => _showGiveItemDialog(btn.dataset.item, partyMembers));
  });
}

function _renderInvCraft() {
  const inv = state.player ? (state.player.inventory || []) : [];
  const html = Object.entries(CRAFT_RECIPES_CLIENT).map(([key, recipe]) => {
    const resultData = ITEM_DATA[key] || {};
    const emoji = ITEM_EMOJIS[key] || '📦';
    const name = resultData.name || formatName(key);
    const desc = resultData.desc || '';
    // Count ingredients available
    const invCopy = [...inv];
    let canCraft = true;
    const ingHtml = recipe.ingredients.map(ing => {
      const idx = invCopy.indexOf(ing);
      const have = idx !== -1;
      if (have) invCopy.splice(idx, 1);
      else canCraft = false;
      const ingD = ITEM_DATA[ing] || {};
      const ingEmoji = ITEM_EMOJIS[ing] || '📦';
      return `<span class="craft-ing ${have ? 'have' : 'missing'}" title="${ingD.desc || ''}">${ingEmoji} ${ingD.name || formatName(ing)}</span>`;
    }).join(' + ');

    return `<div class="craft-recipe ${canCraft ? 'craftable' : ''}">
      <div class="craft-result">
        <span class="craft-result-emoji">${emoji}</span>
        <div class="craft-result-info">
          <div class="craft-result-name">${name}</div>
          <div class="craft-result-desc">${desc}</div>
        </div>
        <button class="inv-btn inv-btn-craft${canCraft ? '' : ' disabled'}" data-recipe="${key}" ${canCraft ? '' : 'disabled'}>CRAFT</button>
      </div>
      <div class="craft-ingredients">Needs: ${ingHtml}</div>
    </div>`;
  }).join('');

  document.getElementById('inventory-crafting').innerHTML = html || '<div class="empty-state">No recipes</div>';
  document.querySelectorAll('.inv-btn-craft:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      ws.send('CRAFT', { recipe: btn.dataset.recipe });
      closeInventory();
    });
  });
}

function _renderInvSkills() {
  const skills = state.player ? (state.player.skills || []) : [];
  document.getElementById('inventory-skills').innerHTML = skills.map(key => {
    const skill = SKILLS[key] || { name: formatName(key), emoji: '✨', mp: 0, desc: '' };
    return `<div class="skill-card">
      <div class="skill-header">
        <span class="skill-emoji">${skill.emoji}</span>
        <span class="skill-name">${skill.name}</span>
        <span class="skill-mp">${skill.mp} MP</span>
      </div>
      <div class="skill-desc">${skill.desc}</div>
    </div>`;
  }).join('') || '<div class="empty-state">No skills yet</div>';
}

function _showGiveItemDialog(itemKey, memberIds) {
  const d = ITEM_DATA[itemKey] || {};
  const itemName = d.name || formatName(itemKey);
  const partyStats = state.partyMembersStats || {};

  const opts = memberIds.map(pid => {
    const m = partyStats[pid];
    const mname = m ? m.name : pid.slice(0, 8);
    return `<button class="give-member-btn btn btn-ghost" data-pid="${pid}">${mname}</button>`;
  }).join('');

  const dlg = document.createElement('div');
  dlg.className = 'modal-overlay give-dialog';
  dlg.innerHTML = `
    <div class="modal card" style="max-width:320px">
      <div class="modal-header">
        <h2>Give ${ITEM_EMOJIS[itemKey] || '📦'} ${itemName}</h2>
        <button class="modal-close" id="give-dlg-close">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Choose a party member:</p>
        <div style="display:flex;flex-direction:column;gap:8px">${opts}</div>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#give-dlg-close').addEventListener('click', () => dlg.remove());
  dlg.querySelectorAll('.give-member-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ws.send('GIVE_ITEM', { item_key: itemKey, target_player_id: btn.dataset.pid });
      dlg.remove();
      closeInventory();
    });
  });
}

function closeInventory() {
  document.getElementById('inventory-modal').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// DAMAGE NUMBER ANIMATION
// ═══════════════════════════════════════════════════════

function showDamageNumber(amount, x, y, type = 'damage') {
  const el = document.createElement('div');
  el.className = `damage-number ${type === 'heal' ? 'heal' : type === 'mana' ? 'mana' : ''}`;
  el.textContent = type === 'damage' ? `-${amount}` : type === 'heal' ? `+${amount}` : `${amount} MP`;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => document.body.removeChild(el), 1200);
}

// ═══════════════════════════════════════════════════════
// WEBSOCKET MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════

function setupHandlers() {

  // Initial welcome (connection established)
  ws.on('SUCCESS', msg => {
    const payload = msg.payload || {};

    // Login response
    if (payload.player) {
      state.player  = payload.player;
      state.playerId = payload.player.id;

      // Check if also in a party
      if (payload.party) {
        state.party = payload.party;
      }
      if (payload.parties) {
        state.parties = payload.parties;
      }

      setLoginStatus('');
      showScreen('lobby');
      renderLobbyPlayer();
      renderCurrentParty();
      refreshParties();
    }

    // Party created / joined
    if (payload.party && !payload.player) {
      state.party = payload.party;
      renderCurrentParty();
    }

    // Party list
    if (payload.parties && !payload.player) {
      state.parties = payload.parties;
      renderPartyList();
    }

    // Left party
    if (payload.left_party) {
      state.party = null;
      renderCurrentParty();
    }

    // Adventure started
    if (payload.dungeon) {
      state.dungeon = payload.dungeon;
      state.phase   = payload.phase || 'exploring';
      if (payload.player) state.player = payload.player;
      showScreen('game');
      renderGameUI();
    }

    // Loot collected (server sends looted_items + gold + inventory + dungeon)
    if (payload.looted_items !== undefined) {
      applyStateUpdate(payload); // handles player_stats, inventory, dungeon
      const items = payload.looted_items || [];
      const gold = payload.gold || 0;
      const parts = [];
      if (items.length) parts.push(items.map(formatName).join(', '));
      if (gold > 0) parts.push(`${gold} gold`);
      addLog(parts.length ? `💰 Looted: ${parts.join(' and ')}!` : '🔍 Nothing left to loot.', 'loot');
      state.phase = 'exploring';
      renderStats();
      renderPhaseBanner();
      renderActionBar();
    }

    // Item used outside combat (server sends player_stats + inventory + message, no looted_items)
    if (payload.message && payload.player_stats && payload.inventory && !payload.looted_items) {
      applyStateUpdate(payload);
      addLog(`🧪 ${payload.message}`, 'loot');
      renderStats();
      renderActionBar();
    }

    // Tavern visit response
    if (payload.tavern_visited) {
      applyStateUpdate(payload); // updates player stats (hp, mp, gold)
      addLog(`🍺 ${payload.message}`, 'loot');
      renderStats();
      // Update tavern modal status
      const status = document.getElementById('tavern-action-status');
      if (status) {
        status.className = 'tavern-action-status';
        status.textContent = `✅ ${payload.message}`;
        status.classList.remove('hidden');
      }
    }
  });

  // State updates
  ws.on('STATE_UPDATE', msg => {
    applyStateUpdate(msg.payload || {});
    if (state.screen === 'lobby') {
      renderCurrentParty();
    }
    if (state.screen === 'game') {
      renderStats();
      renderPhaseBanner();
      renderActionBar();
      renderEnemies();
      renderGameParty();
      if (laMap && state.dungeon) laMap.render(state.dungeon);
      updateMapProgress();
    }
  });

  // New room entered
  ws.on('ROOM_ENTERED', msg => {
    const payload = msg.payload || {};
    applyStateUpdate(payload);

    // Dismiss the "Adventure Begins" cinematic if active
    if (window._dismissAdventureCinematic) window._dismissAdventureCinematic();

    if (state.screen !== 'game') {
      showScreen('game');
    }

    const room = payload.room;
    if (room) {
      triggerRoomTransition(() => {
        currentRoomData = room;
        sceneImageSeed = Math.floor(Math.random() * 99999);
        generateSceneImage(room);
        if (laMap && state.dungeon) laMap.render(state.dungeon);
        updateMapProgress();
        renderPhaseBanner();
        renderActionBar();
        renderEnemies();
      });
    } else {
      renderPhaseBanner();
      renderActionBar();
      renderEnemies();
    }

    if (payload.narrative) {
      typewriterLog(payload.narrative, 'narrative');
    }
    renderGameParty();
  });

  // Combat updates
  ws.on('COMBAT_UPDATE', msg => {
    const payload = msg.payload || {};
    const prevHp = state.player?.stats?.health ?? 999;
    const prevActivePid = state.combat?.active_player_id;
    applyStateUpdate(payload);
    const newHp = state.player?.stats?.health ?? 999;
    const newActivePid = state.combat?.active_player_id;
    // Trigger character portrait animations
    if (payload.xp_gained || payload.gold_gained) triggerCharAttack();
    else if (newHp < prevHp) triggerCharHurt();

    // Show "YOUR TURN" burst when active player changes to us
    if (newActivePid && newActivePid === state.playerId && prevActivePid !== state.playerId) {
      showYourTurnBurst();
    }

    // Fled successfully — server moved us to prev room, update scene + actions
    if (payload.phase === 'exploring' && payload.dungeon && payload.room) {
      generateSceneImage(payload.room);
      addLog('You catch your breath, having escaped...', 'system');
      loadContextualActions(payload.room);
    }

    if (state.screen === 'game') {
      renderStats();
      renderPhaseBanner();
      renderActionBar();
      renderEnemies();
      renderCharPortrait();
      renderGameParty();
      if (laMap && state.dungeon) laMap.render(state.dungeon);
    }

    // Log combat events
    const log = payload.combat_log || payload.log || [];
    if (typeof log === 'string') {
      addLog(log, 'combat');
    } else if (Array.isArray(log)) {
      log.forEach(entry => addLog(entry, 'combat'));
    }

    // Damage numbers (animate near enemies)
    if (payload.damage_dealt) {
      const enemyEl = document.querySelector('.enemy-card:not(.enemy-dead)') || document.querySelector('.enemy-card');
      if (enemyEl) {
        const rect = enemyEl.getBoundingClientRect();
        showDamageNumber(payload.damage_dealt, rect.left + rect.width/2, rect.top + 20, 'damage');
        enemyEl.classList.add('hit-flash');
        enemyEl.classList.add('enemy-shake');
        setTimeout(() => {
          enemyEl.classList.remove('hit-flash');
          enemyEl.classList.remove('enemy-shake');
        }, 500);
      }
      flashEnemyCard('#c44b4b');
    }
    if (payload.damage_taken) {
      const statsEl = document.getElementById('stats-panel');
      if (statsEl) {
        const rect = statsEl.getBoundingClientRect();
        showDamageNumber(payload.damage_taken, rect.left + 80, rect.top + 40, 'damage');
        statsEl.classList.add('hit-flash');
        setTimeout(() => statsEl.classList.remove('hit-flash'), 400);
      }
      shakeScreen();
    }

    // Death / Victory overlay
    if (payload.phase === 'game_over') {
      saveAdventureToProfile('defeat', payload);
      setTimeout(() => showGameOverOverlay(payload.death_narrative || '', payload), 600);
    }
    if (payload.phase === 'victory') {
      saveAdventureToProfile('victory', payload);
      setTimeout(() => showVictoryOverlay(payload.victory_narrative || '', payload), 600);
    }

    // Level-up detection (purely visual; real trigger now comes via LEVEL_UP_CHOICE)
    const prevLevel = state.player && state.player.stats ? state.player.stats.level : 1;
    if (payload.player_stats && payload.player_stats.level && payload.player_stats.level > prevLevel) {
      triggerLevelUp(payload.player_stats.level);
    }

    // XP / gold toasts
    if (payload.xp_gained) {
      const statsEl = document.getElementById('stats-panel');
      const rect = statsEl ? statsEl.getBoundingClientRect() : { left: window.innerWidth/2, top: 120 };
      showEarnToast(`+${payload.xp_gained} XP`, rect.left + 60, rect.top + 20);
    }
    if (payload.gold_gained) {
      const statsEl = document.getElementById('stats-panel');
      const rect = statsEl ? statsEl.getBoundingClientRect() : { left: window.innerWidth/2, top: 120 };
      showEarnToast(`+${payload.gold_gained}g`, rect.left + 120, rect.top + 45);
    }
  });

  // AI DM narrative
  ws.on('DM_RESPONSE', msg => {
    const payload = msg.payload || {};
    applyStateUpdate(payload);
    const text = payload.narrative || payload.response || payload.text || '';
    // Show roll summary inline before narrative if present
    if (payload.roll_summary) addLog(payload.roll_summary, 'roll');
    if (text) {
      typewriterLog(text, 'narrative');
      narratorSpeak(text);
      lastNarrativeHint = text;
      // Track narrative history for companion context
      _narrativeHistory.push(text);
      if (_narrativeHistory.length > 8) _narrativeHistory.shift();
      dmMemoryTurns++;
      document.getElementById('dm-memory-count') && (document.getElementById('dm-memory-count').textContent = dmMemoryTurns);
      // Refresh scene image to reflect new story moment
      if (currentRoomData) generateSceneImage(currentRoomData, text);
    }

    // After DM responds, regenerate contextual actions based on the specific narrative
    const phase = state.phase || 'exploring';
    if (phase === 'exploring') {
      const curRoom = state.dungeon && state.dungeon.rooms && state.dungeon.rooms[state.dungeon.current_room_id];
      if (curRoom) loadContextualActions(curRoom, text);
    }
    if (state.screen === 'game') {
      renderPhaseBanner();
      renderActionBar();
      renderGameParty();
    }
  });

  // Party chat
  ws.on('PARTY_CHAT', msg => {
    const { sender_name, sender_class, text, sender_id } = msg.payload || {};
    if (!text) return;
    const isSelf = sender_id === state.playerId;
    const cls = CLASSES[sender_class] || CLASSES.warrior;
    const chatEl = document.getElementById('party-chat-log');
    if (chatEl) {
      const div = document.createElement('div');
      div.className = `party-chat-entry${isSelf ? ' pce-self' : ''}`;
      div.innerHTML = `<span class="pce-who">${cls.emoji} ${sender_name}</span><span class="pce-text">${escHtml(text)}</span>`;
      chatEl.appendChild(div);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  });

  // ── Dice roll requested by DM ──
  ws.on('DICE_ROLL_REQUIRED', msg => {
    const { die = 'd20', stat = 'NONE', dc = 10 } = msg.payload || {};
    showDiceModal(die, stat, dc);
  });

  function getStatModifier(stat) {
    const s = state.player && state.player.stats;
    if (!s) return 0;
    const statMap = {
      STR: s.strength || 0,
      DEX: s.dexterity || 0,
      INT: s.intelligence || 0,
      WIS: s.wisdom || 0,
      CHA: s.charisma || 0,
      CON: s.constitution || 0,
    };
    const val = statMap[stat] || 0;
    return Math.floor((val - 10) / 2);
  }

  function showDiceModal(die, stat, dc) {
    document.getElementById('dice-modal')?.remove();

    const sides = parseInt(die.replace('d', '')) || 20;
    const mod = stat !== 'NONE' ? getStatModifier(stat) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;

    // Inject keyframe styles once
    if (!document.getElementById('dice-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'dice-modal-styles';
      style.textContent = `
        @keyframes dm-overlay-in { from { opacity:0; } to { opacity:1; } }
        @keyframes dm-card-in { from { opacity:0; transform:scale(0.88) translateY(20px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes dm-spin { 0%{transform:rotate(0deg) scale(1)} 25%{transform:rotate(90deg) scale(1.18)} 50%{transform:rotate(180deg) scale(1)} 75%{transform:rotate(270deg) scale(1.18)} 100%{transform:rotate(360deg) scale(1)} }
        @keyframes dm-land { 0%{transform:scale(1.5) rotate(18deg)} 45%{transform:scale(0.82) rotate(-6deg)} 72%{transform:scale(1.12) rotate(3deg)} 100%{transform:scale(1) rotate(0deg)} }
        @keyframes dm-result-rise { from{opacity:0;transform:translateY(14px) scale(0.75)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes dm-bar-fill { from{width:0%} }
        @keyframes dm-shimmer { 0%,100%{box-shadow:0 0 60px rgba(201,168,76,0.12)} 50%{box-shadow:0 0 80px rgba(201,168,76,0.28)} }
        #dice-modal { animation: dm-overlay-in 0.2s ease both; }
        #dice-modal .dm-card { animation: dm-card-in 0.3s cubic-bezier(0.34,1.4,0.64,1) both, dm-shimmer 3s ease infinite; }
        #dice-face-wrap.dm-spinning { animation: dm-spin 0.22s linear infinite; }
        #dice-face-wrap.dm-landing { animation: dm-land 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .dm-result-block { animation: dm-result-rise 0.45s cubic-bezier(0.34,1.4,0.64,1) both; }
        .dm-bar-inner { animation: dm-bar-fill 0.7s cubic-bezier(0.4,0,0.2,1) both; }
        #dice-roll-btn:not(:disabled):hover { filter:brightness(1.12); transform:translateY(-1px); }
        #dice-roll-btn:not(:disabled):active { transform:scale(0.97); }
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'dice-modal';
    modal.style.cssText = `position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.9);backdrop-filter:blur(10px);`;
    modal.innerHTML = `
      <div class="dm-card" style="
        background:linear-gradient(155deg,#1c1608 0%,#0e0b06 60%,#140d04 100%);
        border:1px solid rgba(201,168,76,0.45);border-radius:18px;
        padding:36px 44px 32px;text-align:center;min-width:300px;max-width:360px;width:90vw;
      ">
        <div style="font-family:var(--font-title,serif);color:#866a30;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:20px">
          ⚔&nbsp; Skill Check Required &nbsp;⚔
        </div>

        <!-- Stat chips row -->
        <div style="display:flex;align-items:stretch;justify-content:center;gap:0;margin-bottom:28px;border:1px solid rgba(201,168,76,0.2);border-radius:10px;overflow:hidden;">
          <div style="flex:1;padding:10px 0;background:rgba(201,168,76,0.06);">
            <div style="font-size:9px;color:#665535;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">Die</div>
            <div style="font-family:var(--font-title,serif);font-size:20px;font-weight:700;color:#c9a84c">${die.toUpperCase()}</div>
          </div>
          ${stat !== 'NONE' ? `
          <div style="width:1px;background:rgba(201,168,76,0.15)"></div>
          <div style="flex:1;padding:10px 0;background:rgba(201,168,76,0.04);">
            <div style="font-size:9px;color:#665535;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">Mod</div>
            <div style="font-family:var(--font-title,serif);font-size:20px;font-weight:700;color:#c9a84c">${modStr}&thinsp;<span style="font-size:13px;opacity:0.7">${stat}</span></div>
          </div>` : ''}
          <div style="width:1px;background:rgba(201,168,76,0.15)"></div>
          <div style="flex:1;padding:10px 0;background:rgba(201,168,76,0.06);">
            <div style="font-size:9px;color:#665535;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">DC</div>
            <div style="font-family:var(--font-title,serif);font-size:20px;font-weight:700;color:#c9a84c">${dc}</div>
          </div>
        </div>

        <!-- Animated die face -->
        <div id="dice-face-wrap" style="font-size:82px;line-height:1;display:inline-block;margin-bottom:24px;filter:drop-shadow(0 0 12px rgba(201,168,76,0.2))">🎲</div>

        <!-- Result area -->
        <div id="dice-result-display" style="min-height:80px;margin-bottom:20px"></div>

        <!-- Roll button -->
        <button id="dice-roll-btn" style="
          font-family:var(--font-title,serif);font-size:14px;letter-spacing:0.12em;font-weight:700;
          background:linear-gradient(135deg,#c9a84c 0%,#a07428 100%);
          color:#0d0900;border:none;border-radius:9px;
          padding:13px 0;width:100%;cursor:pointer;
          box-shadow:0 3px 16px rgba(201,168,76,0.28);
          transition:filter 0.15s,transform 0.1s,box-shadow 0.15s;
        ">⚔ &nbsp;ROLL THE ${die.toUpperCase()}&nbsp; ⚔</button>
      </div>
    `;
    document.body.appendChild(modal);

    const faceWrap = modal.querySelector('#dice-face-wrap');
    const btn = modal.querySelector('#dice-roll-btn');
    const resultEl = modal.querySelector('#dice-result-display');
    const faceEmojis = ['⚀','⚁','⚂','⚃','⚄','⚅'];

    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.style.opacity = '0.35';
      faceWrap.classList.add('dm-spinning');

      const totalFrames = 20 + Math.floor(Math.random() * 10);
      let t = 0;
      const anim = setInterval(() => {
        faceWrap.textContent = faceEmojis[Math.floor(Math.random() * faceEmojis.length)];
        t++;
        if (t >= totalFrames) {
          clearInterval(anim);
          const raw   = Math.floor(Math.random() * sides) + 1;
          const total = raw + mod;
          const success  = total >= dc;
          const isCrit   = raw === sides;
          const isFumble = raw === 1 && sides >= 10;

          faceWrap.classList.remove('dm-spinning');
          faceWrap.classList.add('dm-landing');
          faceWrap.textContent = isCrit ? '💥' : isFumble ? '💀' : faceEmojis[Math.min(raw - 1, 5)];

          const successColor = isCrit ? '#ffd700' : success ? '#43a047' : '#e53935';
          const failGlow     = isCrit ? 'rgba(255,215,0,0.4)' : success ? 'rgba(67,160,71,0.35)' : 'rgba(229,57,53,0.35)';
          const resultLabel  = isCrit ? '⚡ CRITICAL HIT' : isFumble ? '💀 CRITICAL FUMBLE' : success ? '✓  SUCCESS' : '✗  FAILURE';

          // DC bar: scale total and dc onto a [0,100%] range for visual comparison
          const scale   = (dc + 10);
          const barPct  = Math.min(100, Math.round((total / scale) * 100));
          const dcPct   = Math.min(99,  Math.round((dc    / scale) * 100));

          setTimeout(() => {
            resultEl.innerHTML = `
              <div class="dm-result-block">
                <div style="font-size:64px;font-weight:900;font-family:var(--font-title,serif);color:${successColor};line-height:1;
                            text-shadow:0 0 30px ${failGlow};margin-bottom:6px">${total}</div>
                <div style="font-size:11px;color:#665535;margin-bottom:12px">
                  rolled&nbsp;<strong style="color:#a08040">${raw}</strong>${mod !== 0 ? `&nbsp;${modStr}` : ''}
                  &nbsp;=&nbsp;<strong style="color:${successColor}">${total}</strong>&nbsp;vs DC&nbsp;<strong style="color:#a08040">${dc}</strong>
                </div>
                <!-- progress bar -->
                <div style="position:relative;height:5px;background:#1c1810;border-radius:3px;overflow:visible;margin-bottom:14px">
                  <div class="dm-bar-inner" style="position:absolute;left:0;top:0;height:100%;width:${barPct}%;background:${successColor};border-radius:3px"></div>
                  <!-- DC marker -->
                  <div style="position:absolute;left:${dcPct}%;top:-4px;width:2px;height:13px;background:rgba(255,255,255,0.4);border-radius:1px"></div>
                  <div style="position:absolute;left:${dcPct}%;top:-16px;font-size:9px;color:#665535;transform:translateX(-50%)">DC</div>
                </div>
                <div style="font-family:var(--font-title,serif);font-size:17px;font-weight:700;letter-spacing:0.1em;color:${successColor};
                            text-shadow:0 0 20px ${failGlow}">${resultLabel}</div>
              </div>
            `;

            setTimeout(() => {
              ws.send('DICE_RESULT', { raw, modifier: mod, total, stat, dc, die });
              modal.style.animation = 'dm-overlay-in 0.18s ease reverse';
              setTimeout(() => modal.remove(), 180);
            }, 2400);
          }, 250);
        }
      }, 75);
    });
  }

  // Game events (world events, broadcasts)
  ws.on('GAME_EVENT', msg => {
    const payload = msg.payload || {};
    const event = payload.event || payload.event_type || '';
    const data = payload.data || payload;

    if (event === 'adventure_started') {
      // Show game state immediately — cinematic (if any) plays on top
      if (payload.dungeon) {
        state.dungeon = payload.dungeon;
        state.phase   = payload.phase || 'exploring';
        if (payload.player) state.player = payload.player;
        if (payload.party)  state.party  = payload.party;
        if (payload.explore_turn_order)       state.exploreTurnOrder = payload.explore_turn_order;
        if (payload.explore_active_player_id) state.exploreActivePid = payload.explore_active_player_id;

        // Non-leaders: start cinematic now (leaders already have it from button click)
        if (!document.getElementById('adventure-start-cinematic')) {
          const advName = (payload.adventure && payload.adventure.name) || 'Into the Depths';
          showAdventureStartCinematic(advName);
        }

        showScreen('game');
        renderGameUI();
        const startRoom = payload.dungeon.rooms && payload.dungeon.rooms[payload.dungeon.current_room_id];
        if (startRoom) {
          currentRoomData = startRoom;
          sceneImageSeed = Math.floor(Math.random() * 99999);
          generateSceneImage(startRoom);
          document.getElementById('scene-room-name').textContent = startRoom.name || '';
        }
        if (payload.narrative) typewriterLog(payload.narrative, 'narrative');
        addLog(`🗡️ The adventure begins! Use the arrow buttons to explore.`, 'system');
        startEmbers();

        // Dismiss the cinematic after it's had time to play (~2.5s)
        setTimeout(() => {
          if (window._dismissAdventureCinematic) window._dismissAdventureCinematic();
        }, 2500);
        return;
      }
      if (payload.narrative) typewriterLog(payload.narrative, 'narrative');
      addLog(`🗡️ The adventure begins! Use the arrow buttons to explore.`, 'system');
      startEmbers();
    } else if (event === 'item_received') {
      if (payload.inventory) { if (state.player) state.player.inventory = payload.inventory; }
      if (payload.player_stats) { if (state.player) state.player.stats = payload.player_stats; }
      addLog(`📦 ${payload.from_name} gave you ${payload.item_emoji || ''} ${payload.item_name}!`, 'loot');
      renderStats();
      renderInventoryPanel();
    } else if (event === 'player_joined') {
      addLog(`👤 ${data.player_name || 'A hero'} joined the party!`, 'system');
    } else if (event === 'player_left') {
      addLog(`💨 ${data.player_name || 'A hero'} left.`, 'system');
    } else if (payload.message) {
      addLog(payload.message, 'system');
    }

    if (payload.party) {
      state.party = payload.party;
      if (state.screen === 'lobby') renderCurrentParty();
      if (state.screen === 'game') renderGameParty();
    }
  });

  // Level-up skill choice
  ws.on('LEVEL_UP_CHOICE', msg => {
    const { level, choices, skill_defs } = msg.payload || {};
    triggerLevelUp(level);
    setTimeout(() => showSkillChoiceOverlay(level, choices, skill_defs), 2800);
  });

  // Boss phase 2 enrage
  ws.on('BOSS_PHASE_2', msg => {
    const { boss_name, ability } = msg.payload || {};
    showBossPhase2Banner(boss_name, ability);
  });

  // NPC encounter
  ws.on('NPC_ENCOUNTER', msg => {
    const npc = msg.payload || {};
    showNPCEncounterBanner(npc);
  });

  // Errors
  ws.on('ERROR', msg => {
    const payload = msg.payload || {};
    const errText = payload.error || payload.message || 'Unknown error';
    if (state.screen === 'login') {
      showLoginError(errText);
      setLoginStatus('');
      document.getElementById('btn-login').disabled = false;
    } else if (state.screen === 'game') {
      addLog(`⚠️ ${errText}`, 'error');
    } else {
      lobbyToast(`⚠️ ${errText}`);
    }
  });

  // Heartbeat response / general success
  ws.on('SUCCESS', msg => {
    const payload = msg.payload || {};
    if (payload.game_day !== undefined) {
      state.gameDay  = payload.game_day;
      state.gameHour = payload.game_hour || 0;
      if (state.screen === 'game') renderPhaseBanner();
    }
    // Skill learned
    if (payload.skill && payload.skills) {
      if (state.player) state.player.skills = payload.skills;
      if (payload.player_stats) {
        if (state.player) state.player.stats = payload.player_stats;
      }
      addLog(`✨ ${payload.message}`, 'system');
      if (state.screen === 'game') renderStats();
    }
    // Item equipped
    if (payload.item_key && payload.slot) {
      if (payload.player_stats && state.player) state.player.stats = payload.player_stats;
      if (payload.inventory && state.player) state.player.inventory = payload.inventory;
      addLog(`🔧 ${payload.message}`, 'loot');
      if (state.screen === 'game') { renderStats(); renderInventoryPanel(); }
    }
    // Item crafted
    if (payload.crafted_item) {
      if (payload.player_stats && state.player) state.player.stats = payload.player_stats;
      if (payload.inventory && state.player) state.player.inventory = payload.inventory;
      const craftEmoji = ITEM_EMOJIS[payload.crafted_item] || '📦';
      addLog(`⚗️ ${payload.message}`, 'loot');
      if (state.screen === 'game') { renderStats(); renderInventoryPanel(); }
    }
    // Item given
    if (payload.message && payload.inventory && !payload.item_key && !payload.crafted_item) {
      if (payload.player_stats && state.player) state.player.stats = payload.player_stats;
      if (payload.inventory && state.player) state.player.inventory = payload.inventory;
      addLog(`🤝 ${payload.message}`, 'system');
      if (state.screen === 'game') renderInventoryPanel();
    }
  });

  // WS disconnect
  ws.onDisconnect = () => {
    if (state.screen === 'game') {
      addLog('🔌 Disconnected from server.', 'error');
    }
  };
}

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════

function pctOf(val, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((val / max) * 100)));
}

function formatName(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════
// GPS INIT
// ═══════════════════════════════════════════════════════

function renderGPSIndicator() {
  const el = document.getElementById('gps-indicator');
  if (!el) return;
  const pos = getPosition();
  if (!pos) {
    el.textContent = '📡 No location'; el.style.color = '#e53935';
    el.title = 'No location set — will use classic dungeon';
  } else if (isGPSActive()) {
    el.textContent = `📍 GPS ±${Math.round(pos.accuracy)}m`; el.style.color = '#43a047';
    el.title = `Live GPS: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
  } else if (isSimulating()) {
    el.textContent = `🌍 ${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`; el.style.color = '#c9a84c';
    el.title = 'Real-world dungeon active (desktop mode)';
  } else {
    el.textContent = `📍 ${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`; el.style.color = '#c9a84c';
    el.title = `Location set: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
  }
}

async function initGPS() {
  let gpsResolved = false;
  startWatching().then(() => {
    gpsResolved = true; _gpsReady = true;
    renderGPSIndicator();
    updateLocationWidget('📍 GPS active', 'GPS');
    if (laMap) { const pos = getPosition(); if (pos) laMap.updatePlayerPosition(pos.lat, pos.lng); }
  }).catch(() => {});

  const ip = await getIPGeolocation();
  if (ip && !gpsResolved) {
    setManualPosition(ip.lat, ip.lng);
    enableSimulateTravel();
    _gpsReady = true;
    renderGPSIndicator();
    const label = ip.city ? `${ip.city} (${ip.lat.toFixed(3)}, ${ip.lng.toFixed(3)})` : `${ip.lat.toFixed(3)}, ${ip.lng.toFixed(3)}`;
    updateLocationWidget(label, 'IP');
    // Pan map to detected location
    if (laMap && laMap.map) laMap.map.flyTo([ip.lat, ip.lng], 13, { duration: 1.5 });
    return;
  }
  if (!ip && !gpsResolved) {
    _gpsReady = false;
    renderGPSIndicator();
    updateLocationWidget('Could not detect — enter your location below', '');
  }
}

// ═══════════════════════════════════════════════════════
// LOCATION WIDGET
// ═══════════════════════════════════════════════════════

async function geocodePlace(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Anagnorisis-Game/1.0' } });
    if (r.ok) {
      const data = await r.json();
      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), city: data[0].display_name.split(',')[0] };
      }
    }
  } catch(e) { /* ignore */ }
  return null;
}

function updateLocationWidget(statusText, source) {
  const statusEl = document.getElementById('location-status');
  const sourceEl = document.getElementById('location-source');
  if (statusEl) statusEl.textContent = statusText;
  if (sourceEl) {
    const labels = { GPS: '(live GPS)', IP: '(from IP — approximate)', manual: '(set manually)' };
    sourceEl.textContent = labels[source] || '';
  }
}

function initLocationWidget() {
  const editPanel = document.getElementById('location-edit');
  const changeBtn = document.getElementById('btn-change-location');
  const setBtn    = document.getElementById('btn-location-set');
  const cancelBtn = document.getElementById('btn-location-cancel');
  const input     = document.getElementById('input-location-text');
  if (!editPanel || !changeBtn) return;

  changeBtn.addEventListener('click', () => {
    editPanel.classList.remove('hidden');
    input.focus();
  });
  cancelBtn.addEventListener('click', () => editPanel.classList.add('hidden'));

  setBtn.addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!raw) return;
    setBtn.textContent = '…';
    setBtn.disabled = true;

    const parts = raw.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      setManualPosition(parts[0], parts[1]);
      enableSimulateTravel();
      updateLocationWidget(`${parts[0].toFixed(4)}, ${parts[1].toFixed(4)}`, 'manual');
      editPanel.classList.add('hidden');
    } else {
      const result = await geocodePlace(raw);
      if (result) {
        setManualPosition(result.lat, result.lng);
        enableSimulateTravel();
        updateLocationWidget(`${result.city || raw} (${result.lat.toFixed(3)}, ${result.lng.toFixed(3)})`, 'manual');
        editPanel.classList.add('hidden');
      } else {
        updateLocationWidget(`❌ Could not find "${raw}" — try lat,lng format`, '');
      }
    }

    setBtn.textContent = 'Set';
    setBtn.disabled = false;
    input.value = '';
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') setBtn.click(); });
}

// ═══════════════════════════════════════════════════════
// CINEMATIC LOADING SCREEN
// ═══════════════════════════════════════════════════════

(function initLoadingScreen() {
  const TITLE = 'ANAGNORISIS';
  const FLAVORS = [
    'Awakening the old magic…',
    'Weaving fate into the streets…',
    'Consulting the oracle…',
    'Charging the ley lines…',
    'Summoning your destiny…',
    'The dungeon stirs…',
    'Binding runes to the map…',
    'The veil grows thin…',
  ];
  const TOTAL_MS   = 3800; // ms before auto-dismiss
  const BAR_START  = 2200; // ms when bar begins filling
  const BAR_DUR    = 1400; // ms bar takes to reach 100%

  // ── inject title letters ──
  const titleEl = document.getElementById('lc-title');
  if (titleEl) {
    titleEl.innerHTML = TITLE.split('').map((ch, i) =>
      `<span class="lc-letter" style="animation-delay:${1.6 + i * 0.07}s">${ch}</span>`
    ).join('');
  }

  // ── ember canvas ──
  const canvas = document.getElementById('lc-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let W, H, embers = [];
    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function spawnEmber() {
      return {
        x: Math.random() * W,
        y: H + 10,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -(0.4 + Math.random() * 1.1),
        life: 1,
        decay: 0.004 + Math.random() * 0.006,
        r: 1 + Math.random() * 2.2,
        hue: 30 + Math.random() * 25,
      };
    }
    for (let i = 0; i < 40; i++) {
      const e = spawnEmber();
      e.y = Math.random() * H;
      embers.push(e);
    }

    let rafId;
    function drawEmbers() {
      ctx.clearRect(0, 0, W, H);
      if (Math.random() < 0.35) embers.push(spawnEmber());
      embers = embers.filter(e => e.life > 0);
      embers.forEach(e => {
        e.x  += e.vx + Math.sin(Date.now() * 0.001 + e.y * 0.01) * 0.15;
        e.y  += e.vy;
        e.life -= e.decay;
        const alpha = Math.max(0, e.life * 0.85);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${e.hue},90%,65%,${alpha})`;
        ctx.fill();
        // tiny glow
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${e.hue},90%,65%,${alpha * 0.2})`;
        ctx.fill();
      });
      rafId = requestAnimationFrame(drawEmbers);
    }
    drawEmbers();

    // stop canvas when done
    window._lcStopCanvas = () => cancelAnimationFrame(rafId);
  }

  // ── flavor text cycling ──
  const flavorEl = document.getElementById('lc-flavor');
  let flavorIdx = 0;
  const flavorTimer = setInterval(() => {
    if (!flavorEl) return;
    flavorEl.classList.add('lc-flavor-fade');
    setTimeout(() => {
      flavorIdx = (flavorIdx + 1) % FLAVORS.length;
      if (flavorEl) { flavorEl.textContent = FLAVORS[flavorIdx]; flavorEl.classList.remove('lc-flavor-fade'); }
    }, 300);
  }, 700);

  // ── progress bar ──
  const barEl = document.getElementById('lc-bar');
  function tickBar(startTime) {
    const pct = Math.min(100, ((Date.now() - startTime) / BAR_DUR) * 100);
    if (barEl) barEl.style.width = pct + '%';
    if (pct < 100) requestAnimationFrame(() => tickBar(startTime));
  }
  setTimeout(() => tickBar(Date.now()), BAR_START);

  // ── dismiss ──
  window._dismissLoadingScreen = function() {
    clearInterval(flavorTimer);
    if (window._lcStopCanvas) window._lcStopCanvas();
    const screen = document.getElementById('loading-screen');
    if (screen) {
      screen.classList.add('lc-done');
      setTimeout(() => { if (screen.parentNode) screen.parentNode.removeChild(screen); }, 950);
    }
  };
  setTimeout(window._dismissLoadingScreen, TOTAL_MS);
})();

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════

function boot() {
  setupHandlers();
  initLogin();
  initLobby();
  initGame();
  showScreen('login');
  initGPS();
  showReturningAdventurerCard();
}

// Unlock Web Speech on the first user interaction (browsers block autoplay until gesture)
let _speechUnlocked = false;
document.addEventListener('click', function _unlockSpeech() {
  if (_speechUnlocked || !('speechSynthesis' in window)) return;
  _speechUnlocked = true;
  // Fire a zero-length utterance to unblock the audio context
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  speechSynthesis.speak(u);
  document.removeEventListener('click', _unlockSpeech);
}, { once: true });

// Script is at bottom of <body> — DOM already parsed, call directly
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ═══════════════════════════════════════════════════════
// INTERACTIVE ENHANCEMENTS
// ═══════════════════════════════════════════════════════

// ── Typewriter narrative ──
// Speed: chars per frame (~16ms). 0 = instant fallback.
const TYPEWRITER_SPEED = 2; // chars per RAF tick

function typewriterLog(text, kind = 'narrative') {
  const el = document.getElementById('narrative-log');
  if (!el) { addLog(text, kind); return; }

  const entry = document.createElement('div');
  entry.className = `log-entry ${kind} typing`;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  entry.appendChild(cursor);
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 100) el.removeChild(el.firstChild);

  const rendered = renderMarkdown(text);
  // Strip tags to get plain char stream, then type into a span, then set innerHTML at end
  const temp = document.createElement('div');
  temp.innerHTML = rendered;
  const plain = temp.textContent || '';
  let i = 0;
  const textNode = document.createElement('span');
  entry.insertBefore(textNode, cursor);

  function tick() {
    const charsToAdd = Math.min(TYPEWRITER_SPEED, plain.length - i);
    i += charsToAdd;
    textNode.textContent = plain.slice(0, i);
    el.scrollTop = el.scrollHeight;
    if (i < plain.length) {
      requestAnimationFrame(tick);
    } else {
      // Replace plain text with rich HTML and remove cursor
      entry.innerHTML = `${rendered}<span class="log-time">${timeStr}</span>`;
      entry.classList.remove('typing');
    }
  }
  requestAnimationFrame(tick);
}

// ── Screen shake on damage ──
function shakeScreen() {
  const center = document.querySelector('.game-center');
  if (!center) return;
  center.classList.add('shake');
  setTimeout(() => center.classList.remove('shake'), 420);
}

// ── "YOUR TURN" burst ──
function showYourTurnBurst() {
  const el = document.createElement('div');
  el.className = 'your-turn-burst';
  el.innerHTML = `<span>⚔️ YOUR TURN</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ── Skill use flash on enemy ──
function flashEnemyCard(color = '#c9a84c') {
  const card = document.querySelector('.enemy-card:not(.enemy-dead)');
  if (!card) return;
  card.style.boxShadow = `0 0 24px 6px ${color}`;
  card.style.transform = 'scale(1.04)';
  setTimeout(() => {
    card.style.boxShadow = '';
    card.style.transform = '';
  }, 320);
}

// ── Level-up overlay ──
function triggerLevelUp(newLevel) {
  const overlay = document.createElement('div');
  overlay.className = 'level-up-overlay';
  overlay.innerHTML = `
    <div class="level-up-text">LEVEL UP</div>
    <div class="level-up-sub">Level ${newLevel} Achieved</div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2700);
}

// ── Room transition flash ──
function triggerRoomTransition(callback) {
  const flash = document.createElement('div');
  flash.className = 'room-transition';
  document.body.appendChild(flash);
  setTimeout(() => {
    callback();
    flash.remove();
  }, 220); // run callback at mid-point of flash
}

// ── Earn toast (XP / Gold) ──
function showEarnToast(label, x, y) {
  const el = document.createElement('div');
  const isGold = label.includes('gold') || label.includes('g');
  const isHP   = label.includes('HP');
  el.className = `toast-earn ${isHP ? 'hp' : isGold ? 'gold' : 'xp'}`;
  el.textContent = label;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

// ── Ember particle spawner ──
let _emberInterval = null;
function startEmbers() {
  if (_emberInterval) return;
  let layer = document.getElementById('ember-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'ember-layer';
    document.body.appendChild(layer);
  }
  _emberInterval = setInterval(() => {
    if (document.getElementById('screen-game') && !document.getElementById('screen-game').classList.contains('active')) return;
    const e = document.createElement('div');
    const styles = ['s1','s2','s3','s4'];
    const sm = Math.random() > 0.6 ? ' sm' : '';
    e.className = `ember ${styles[Math.floor(Math.random()*4)]}${sm}`;
    e.style.left = `${Math.random() * 100}vw`;
    e.style.bottom = '0';
    const dur = 2.5 + Math.random() * 2.5;
    e.style.animationDuration = `${dur}s`;
    layer.appendChild(e);
    setTimeout(() => e.remove(), dur * 1000 + 200);
  }, 600);
}
function stopEmbers() {
  if (_emberInterval) { clearInterval(_emberInterval); _emberInterval = null; }
}

// ── Companion message builder (rich bubbles) ──
function appendCompanionBubble(log, who, text, isPlayer) {
  const msg = document.createElement('div');
  msg.className = `companion-msg${isPlayer ? ' player' : ''}`;
  msg.innerHTML = `
    <span class="companion-sender">${who}</span>
    <div class="companion-bubble">${text}</div>
  `;
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

// ── Enemy death trigger ──
function triggerEnemyDeath(enemyId) {
  const el = document.getElementById(`enemy-${enemyId}`);
  if (!el) return;
  el.classList.add('dying');
  setTimeout(() => el.remove(), 600);
}

// ══════════════════════════════════════════════════════════════
// SKILL CHOICE OVERLAY (LEVEL UP)
// ══════════════════════════════════════════════════════════════

function showSkillChoiceOverlay(level, choices, skillDefs) {
  if (!choices || !choices.length) return;
  document.getElementById('skill-choice-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'skill-choice-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.92);backdrop-filter:blur(8px);';
  const cards = choices.map(skillKey => {
    const sd = skillDefs && skillDefs[skillKey] || {};
    const ls = SKILLS[skillKey] || { name: skillKey, emoji: '✨', mp: 0, desc: '' };
    const name = sd.name || ls.name;
    const emoji = sd.emoji || ls.emoji;
    const mp = sd.mp_cost !== undefined ? sd.mp_cost : ls.mp;
    const desc = sd.description || ls.desc;
    const dtype = sd.damage_type ? `<span class="skill-dtype-badge">${sd.damage_type}</span>` : '';
    const cd = sd.cooldown_turns ? `<span class="skill-cd-badge">${sd.cooldown_turns}t cd</span>` : '';
    return `
      <div class="skill-choice-card" data-skill="${skillKey}">
        <div class="scc-emoji">${emoji}</div>
        <div class="scc-name">${name}</div>
        <div class="scc-badges">${dtype}${cd}</div>
        <div class="scc-mp">${mp} MP</div>
        <div class="scc-desc">${desc}</div>
        <button class="btn btn-accent scc-pick" data-skill="${skillKey}">Choose</button>
      </div>
    `;
  }).join('');
  overlay.innerHTML = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-family:var(--font-title,serif);font-size:11px;color:var(--amber,#c9a84c);letter-spacing:0.25em;text-transform:uppercase;">Level ${level} — Choose a Skill</div>
    </div>
    <div class="skill-choice-cards">${cards}</div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.scc-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const skillKey = btn.dataset.skill;
      ws.send('SKILL_CHOSEN', { skill: skillKey });
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    });
  });
}

// ══════════════════════════════════════════════════════════════
// BOSS PHASE 2 BANNER
// ══════════════════════════════════════════════════════════════

function showBossPhase2Banner(bossName, ability) {
  const banner = document.createElement('div');
  banner.className = 'boss-phase2-banner';
  banner.innerHTML = `
    <div class="bp2-title">💢 ${bossName || 'BOSS'} ENRAGES!</div>
    ${ability ? `<div class="bp2-ability">${ability}</div>` : ''}
  `;
  document.body.appendChild(banner);
  shakeScreen();
  setTimeout(() => {
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 600);
  }, 3500);
}

// ══════════════════════════════════════════════════════════════
// NPC ENCOUNTER BANNER
// ══════════════════════════════════════════════════════════════

const NPC_ALIGNMENT_COLOR = {
  friendly: 'var(--amber,#c9a84c)',
  neutral:  '#a08040',
  cryptic:  'var(--purple,#9c4dcc)',
  hostile:  '#c0392b',
};

function showNPCEncounterBanner(npc) {
  const color = NPC_ALIGNMENT_COLOR[npc.alignment] || 'var(--amber,#c9a84c)';
  const banner = document.createElement('div');
  banner.className = 'npc-encounter-banner';
  banner.style.borderColor = color;
  banner.innerHTML = `
    <div class="npc-banner-header" style="color:${color}">
      <span class="npc-banner-emoji">${npc.emoji || '👤'}</span>
      <span class="npc-banner-name">${npc.name}</span>
      <span class="npc-banner-role">${npc.role || ''}</span>
    </div>
    <div class="npc-banner-line">"${npc.line || ''}"</div>
    ${npc.tip ? `<div class="npc-banner-tip">💡 ${npc.tip}</div>` : ''}
  `;
  const logEl = document.getElementById('narrative-log');
  if (logEl) {
    logEl.insertBefore(banner, logEl.firstChild);
    logEl.scrollTop = 0;
  } else {
    document.body.appendChild(banner);
  }
  addLog(`${npc.emoji || '👤'} ${npc.name}: "${npc.line || ''}"`, 'narrative');
  // TTS via narratorSpeak if not already triggered by DM_RESPONSE
  narratorSpeak(npc.line || '');
}

// ══════════════════════════════════════════════════════════════
// GAME OVER OVERLAY
// ══════════════════════════════════════════════════════════════

function showGameOverOverlay(narrative, payload) {
  document.getElementById('game-over-overlay')?.remove();
  const dungeon = state.dungeon || {};
  const stats = {
    rooms: dungeon.rooms_cleared || 0,
    enemies: payload.enemies_slain || 0,
    gold: dungeon.gold_collected || 0,
    turns: payload.turns_played || 0,
  };
  const overlay = document.createElement('div');
  overlay.id = 'game-over-overlay';
  overlay.className = 'game-end-overlay game-over-overlay';
  overlay.innerHTML = `
    <div class="geo-title">FALLEN</div>
    <div class="geo-narrative" id="geo-narrative-text"></div>
    <div class="geo-stats">
      <div class="geo-stat"><span class="geo-stat-icon">🏛️</span><span>${stats.rooms}</span><span>Rooms</span></div>
      <div class="geo-stat"><span class="geo-stat-icon">💀</span><span>${stats.enemies}</span><span>Slain</span></div>
      <div class="geo-stat"><span class="geo-stat-icon">💰</span><span>${stats.gold}</span><span>Gold</span></div>
      <div class="geo-stat"><span class="geo-stat-icon">⚔️</span><span>${stats.turns}</span><span>Turns</span></div>
    </div>
    <div id="geo-return-wrap" style="opacity:0;transition:opacity 0.5s"></div>
  `;
  document.body.appendChild(overlay);
  if (narrative) typewriterInto('geo-narrative-text', narrative, 40);
  setTimeout(() => {
    const wrap = document.getElementById('geo-return-wrap');
    if (wrap) {
      wrap.style.opacity = '1';
      wrap.innerHTML = '<button class="btn btn-primary" id="btn-geo-lobby">Return to Lobby</button>';
      document.getElementById('btn-geo-lobby')?.addEventListener('click', () => {
        overlay.remove();
        returnToLobby();
      });
    }
  }, 5000);
}

// ══════════════════════════════════════════════════════════════
// VICTORY OVERLAY
// ══════════════════════════════════════════════════════════════

function showVictoryOverlay(narrative, payload) {
  document.getElementById('victory-overlay')?.remove();
  const dungeon = state.dungeon || {};
  const stats = {
    rooms: dungeon.rooms_cleared || 0,
    enemies: payload.enemies_slain || 0,
    gold: dungeon.gold_collected || 0,
    turns: payload.turns_played || 0,
  };
  const overlay = document.createElement('div');
  overlay.id = 'victory-overlay';
  overlay.className = 'game-end-overlay victory-overlay';
  overlay.innerHTML = `
    <div class="geo-title">DUNGEON FALLS</div>
    <div class="geo-narrative" id="victory-narrative-text"></div>
    <div class="geo-stats">
      <div class="geo-stat"><span class="geo-stat-icon">🏛️</span><span>${stats.rooms}</span><span>Rooms</span></div>
      <div class="geo-stat"><span class="geo-stat-icon">💀</span><span>${stats.enemies}</span><span>Slain</span></div>
      <div class="geo-stat"><span class="geo-stat-icon">💰</span><span>${stats.gold}</span><span>Gold</span></div>
      <div class="geo-stat"><span class="geo-stat-icon">⚔️</span><span>${stats.turns}</span><span>Turns</span></div>
    </div>
    <button class="btn btn-accent" id="btn-vic-lobby">🏆 Return to Lobby</button>
  `;
  document.body.appendChild(overlay);
  if (narrative) typewriterInto('victory-narrative-text', narrative, 35);
  document.getElementById('btn-vic-lobby')?.addEventListener('click', () => {
    overlay.remove();
    returnToLobby();
  });
}

// ── Typewriter into a specific element ──
function typewriterInto(elementId, text, msPerChar) {
  const el = document.getElementById(elementId);
  if (!el) return;
  let i = 0;
  el.textContent = '';
  const t = setInterval(() => {
    if (i < text.length) { el.textContent += text[i++]; } else clearInterval(t);
  }, msPerChar || 35);
}

// ══════════════════════════════════════════════════════════════
// EQUIPMENT UI (Inventory Panel)
// ══════════════════════════════════════════════════════════════

const EQUIPMENT_RARITIES = {
  common: { label: 'Common', color: '#aaa' },
  uncommon: { label: 'Uncommon', color: '#43a047' },
  rare: { label: 'Rare', color: '#7c4dff' },
  legendary: { label: 'Legendary', color: '#c9a84c' },
};

// Equipment templates known to client (subset for display)
function getEquipTemplate(itemKey) {
  // Server sends these in player_stats.equipped or we derive from inventory key naming
  // We just need to show equip button for keys that look like equipment
  const equipKeys = [
    'iron_sword_plus1','oak_staff_plus1','twin_fangs','holy_mace_plus1',
    'longbow_plus1','hunting_knife_plus1','shadowweave_cloak','arcane_focus',
    'veil_shard_weapon','veil_shard_armor','leather_armor_plus1','chain_mail_plus1',
    'iron_ring','assassins_gloves','hunters_pendant',
  ];
  return equipKeys.includes(itemKey) ? { isEquipment: true } : null;
}

function renderInventoryPanel() {
  // Re-render the currently active tab if modal is open
  const modal = document.getElementById('inventory-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  const activeTab = document.querySelector('.inv-tab.active');
  if (activeTab) _renderInvTab(activeTab.dataset.tab);
}

// Legacy compat (may be called elsewhere)
function getEquipTemplate(itemKey) {
  return EQUIP_KEYS.has(itemKey) ? { isEquipment: true } : null;
}

// ══════════════════════════════════════════════════════════════
// localStorage ADVENTURE PROFILE
// ══════════════════════════════════════════════════════════════

const PROFILE_KEY = 'anagnorisis_profile';

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; }
  catch { return null; }
}

function saveAdventureToProfile(result, payload) {
  const p = state.player;
  if (!p) return;
  let profile = loadProfile() || { name: p.name, playerClass: p.player_class, adventures: [], bestLevel: 1, totalGold: 0 };
  const dungeon = state.dungeon || {};
  const run = {
    date: new Date().toISOString().slice(0, 10),
    result,
    level: (p.stats && p.stats.level) || 1,
    gold: dungeon.gold_collected || 0,
    enemies: payload.enemies_slain || 0,
    rooms: dungeon.rooms_cleared || 0,
  };
  profile.adventures.unshift(run);
  if (profile.adventures.length > 10) profile.adventures = profile.adventures.slice(0, 10);
  profile.bestLevel = Math.max(profile.bestLevel || 1, run.level);
  profile.totalGold = (profile.totalGold || 0) + run.gold;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
}

function showReturningAdventurerCard() {
  const profile = loadProfile();
  const el = document.getElementById('returning-adventurer');
  if (!el) return;
  if (!profile || !profile.adventures || !profile.adventures.length) {
    el.style.display = 'none';
    return;
  }
  const last = profile.adventures[0];
  el.style.display = '';
  el.innerHTML = `
    <div class="ra-greeting">Welcome back, <strong>${profile.name}</strong></div>
    <div class="ra-last">Last run: ${last.result === 'victory' ? '🏆' : '💀'} Lvl ${last.level} · ${last.rooms} rooms · ${last.gold}g</div>
  `;
}

// ── Hook: start embers when game screen shows ──
const _origShowScreen = window.showScreen;
if (typeof _origShowScreen === 'function') {
  window.showScreen = function(name, ...args) {
    _origShowScreen(name, ...args);
    if (name === 'game') startEmbers();
    else stopEmbers();
  };
}
