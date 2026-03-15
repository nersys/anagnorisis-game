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
  // Server often sends player_stats instead of full player object
  if (payload.player_stats !== undefined && state.player) {
    state.player = { ...state.player, stats: payload.player_stats };
  }
  // Inventory updates from loot/item use
  if (payload.inventory !== undefined && state.player) {
    state.player = { ...state.player, inventory: payload.inventory };
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

class LAMap {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markers = {};
    this.lines = [];
    this.roomLocations = {};  // roomId → [lat, lng]
    this.roomNames = {};      // roomId → real location name
    this.zone = null;
    this._assigned = false;
    this.onRoomClick = null;  // callback(roomId)
  }

  init() {
    if (this.map) return;

    this.map = L.map(this.containerId, {
      center: [34.0522, -118.2437],
      zoom: 12,
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

  /** Assign real LA locations to dungeon rooms (called once per adventure) */
  assignLocations(rooms) {
    this._assigned = true;
    this.zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    const locs = this.zone.locations;
    Object.keys(rooms).forEach((id, i) => {
      const loc = locs[i % locs.length];
      this.roomLocations[id] = [loc.lat, loc.lng];
      this.roomNames[id]     = loc.name;
    });
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
          color: bothExplored ? '#3a3a8a' : '#1e1e3a',
          weight: 2,
          dashArray: bothExplored ? null : '4 4',
          opacity: 0.8,
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
    if (cur) this.map.flyTo(cur, this.zone?.zoom || 14, { duration: 1.2 });
  }

  /** Get the real LA name for a room */
  getRoomName(roomId) {
    return this.roomNames[roomId] || null;
  }

  getZoneName() {
    return this.zone?.name || 'Los Angeles';
  }

  reset() {
    this._clearOverlays();
    this._assigned = false;
    this.roomLocations = {};
    this.roomNames = {};
    this.zone = null;
  }

  _makeMarker(room, coord, isCurrent) {
    const explored  = room.explored;
    const cleared   = room.cleared;
    const hasEnemy  = room.enemies?.some(e => e.hp > 0);
    const icon      = ROOM_ICONS[room.room_type] || '❓';
    const realName  = this.roomNames[room.id] || room.name;

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
        ${hasEnemy  ? '<span class="la-marker__dot la-marker__dot--enemy"></span>'  : ''}
        ${cleared && !hasEnemy ? '<span class="la-marker__dot la-marker__dot--clear"></span>' : ''}
        ${isCurrent ? '<div class="la-marker__ring"></div>' : ''}
      </div>`;

    const leafletIcon = L.divIcon({ html, className: '', iconSize: [40, 40], iconAnchor: [20, 20] });
    const marker = L.marker(coord, { icon: leafletIcon });

    // Popup with real location info
    const popupHtml = `
      <div style="font-family:'Roboto Mono',monospace;font-size:12px;min-width:160px">
        <strong style="color:#c9a84c">${realName}</strong><br>
        <span style="color:#777;font-size:10px;text-transform:uppercase;letter-spacing:1px">${room.room_type}</span>
        ${!explored  ? '<br><span style="color:#555">⬛ Unexplored</span>' : ''}
        ${hasEnemy   ? '<br><span style="color:#e53935">⚔ Enemies here</span>'  : ''}
        ${cleared    ? '<br><span style="color:#43a047">✓ Cleared</span>'       : ''}
        ${room.gold > 0 && !cleared ? `<br><span style="color:#c9a84c">💰 ${room.gold} gold</span>` : ''}
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
  warrior: { emoji: '⚔️', name: 'Warrior', tag: 'Tank & Brawler', color: '#e53935' },
  mage:    { emoji: '🔮', name: 'Mage',    tag: 'Arcane Power',  color: '#7c3aed' },
  rogue:   { emoji: '🗡️', name: 'Rogue',   tag: 'Swift & Deadly', color: '#1e88e5' },
  cleric:  { emoji: '✨', name: 'Cleric',  tag: 'Divine Healer', color: '#f0cc6a' },
  ranger:  { emoji: '🏹', name: 'Ranger',  tag: 'Eagle Eye',     color: '#43a047' },
};

const SKILLS = {
  slash:          { name: 'Slash',         emoji: '⚔️', mp: 10, desc: 'A powerful sword strike dealing bonus damage.' },
  shield_bash:    { name: 'Shield Bash',   emoji: '🛡️', mp: 8,  desc: 'Bash the enemy, stunning them for one turn.' },
  battle_cry:     { name: 'Battle Cry',    emoji: '📣', mp: 12, desc: 'Raise your attack power for 3 turns.' },
  fireball:       { name: 'Fireball',      emoji: '🔥', mp: 20, desc: 'Hurl a ball of fire that ignores armor.' },
  frost_shield:   { name: 'Frost Shield',  emoji: '❄️', mp: 15, desc: 'Conjure ice armor, halving damage for 3 turns.' },
  arcane_missile: { name: 'Arcane Missile',emoji: '💫', mp: 10, desc: 'A bolt of pure arcane energy.' },
  backstab:       { name: 'Backstab',      emoji: '🗡️', mp: 15, desc: 'Strike from the shadows for massive damage.' },
  stealth:        { name: 'Stealth',       emoji: '👤', mp: 10, desc: 'Vanish! Next attack deals triple damage.' },
  pickpocket:     { name: 'Pickpocket',    emoji: '💰', mp: 5,  desc: 'Steal gold from an enemy.' },
  heal:           { name: 'Heal',          emoji: '💚', mp: 20, desc: 'Restore 30% of your max HP.' },
  smite:          { name: 'Smite',         emoji: '☀️', mp: 18, desc: 'Divine strike that bypasses defense.' },
  bless:          { name: 'Bless',         emoji: '🙏', mp: 12, desc: 'Blessed by the gods, attack up for 3 turns.' },
  aimed_shot:     { name: 'Aimed Shot',    emoji: '🎯', mp: 12, desc: 'A precise shot dealing heavy damage.' },
  trap:           { name: 'Trap',          emoji: '🪤', mp: 8,  desc: 'Set a trap that stuns the enemy.' },
  animal_companion:{ name: 'Companion',    emoji: '🐺', mp: 15, desc: 'Your wolf companion attacks for you.' },
};

const ITEM_EMOJIS = {
  health_potion: '🧪', greater_health_potion: '💊', mana_potion: '🔵',
  iron_sword: '⚔️', oak_staff: '🪄', twin_daggers: '🗡️', holy_mace: '🔨', longbow: '🏹',
  wooden_shield: '🛡️', spellbook: '📖', lockpicks: '🔑', prayer_beads: '📿', quiver: '🪄',
  smoke_bomb: '💨', hunting_knife: '🔪', bandages: '🩹',
  default: '📦',
};

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
let _gpsReady = false;

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
    }, 50);
  }
}

// ═══════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════

function initLogin() {
  // Render class cards FIRST — particles are optional eye candy
  const grid = document.getElementById('class-grid');
  grid.innerHTML = Object.entries(CLASSES).map(([key, cls]) => `
    <div class="class-card ${key === selectedClass ? 'selected' : ''}"
         data-class="${key}" style="--class-color:${cls.color}">
      <span class="class-emoji">${cls.emoji}</span>
      <span class="class-name">${cls.name}</span>
      <span class="class-tag">${cls.tag}</span>
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
  membersEl.innerHTML = members.map(id => {
    const isLeader = id === party.leader_id;
    const isSelf   = id === state.playerId;
    const p        = isSelf ? state.player : null;
    const cls      = p ? (CLASSES[p.player_class] || CLASSES.warrior) : { emoji: '👤' };
    const name     = p ? p.name : `Player ${id.slice(0,6)}`;
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
  const pos = getPosition();

  // Build payload — fetch nearby POIs if we have a position
  const payload = {
    adventure_name: name,
    description: 'A perilous dungeon adventure',
    mode: selectedMode,
    difficulty: selectedDifficulty,
  };

  if (pos) {
    payload.lat = pos.lat;
    payload.lng = pos.lng;

    // Get location name for the DM intro
    const locStatus = document.getElementById('location-status');
    payload.location_name = locStatus ? locStatus.textContent : `${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}`;

    // Fetch nearby POIs to seed the dungeon and the narrative
    try {
      const r = await fetch(`/nearby-rooms?lat=${pos.lat}&lng=${pos.lng}&radius=800`);
      if (r.ok) {
        const data = await r.json();
        payload.pois = (data.pois || []).slice(0, 12);
      }
    } catch(e) { /* proceed without POIs */ }
  }

  ws.send('START_ADVENTURE', payload);
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
  if (state.dungeon) laMap.render(state.dungeon);
}

function initGame() {
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
    generateSceneImage(currentRoomData);
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

  // ── Music toggle (ambient dungeon atmosphere via Web Audio) ──
  let audioCtx = null;
  let musicNodes = [];
  let musicOn = false;
  let chordTimer = null;

  // Pentatonic minor scale in Hz (A2 root): A2 C3 D3 E3 G3 A3 C4 D4 E4 G4
  const SCALE = [110, 130.8, 146.8, 164.8, 196, 220, 261.6, 293.7, 329.6, 392];
  // Chord shapes as scale indices
  const CHORDS = [[0,2,4,7],[0,3,5,8],[2,4,6,9],[1,3,5,7]];

  function makeOsc(ctx, freq, type, gain, dest) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g); g.connect(dest);
    osc.start();
    return { osc, gain: g };
  }

  function startMusic() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.4;

    // Reverb via ConvolverNode (impulse response simulation)
    const convolver = audioCtx.createConvolver();
    const irLen = audioCtx.sampleRate * 2.5;
    const irBuf = audioCtx.createBuffer(2, irLen, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5);
    }
    convolver.buffer = irBuf;
    const reverbGain = audioCtx.createGain(); reverbGain.gain.value = 0.35;
    masterGain.connect(convolver); convolver.connect(reverbGain); reverbGain.connect(audioCtx.destination);
    masterGain.connect(audioCtx.destination);

    // Drone: deep sub bass
    const { osc: bass } = makeOsc(audioCtx, SCALE[0] / 2, 'sine', 0.18, masterGain);

    // Slow LFO breathing on master volume
    const breathLfo = audioCtx.createOscillator();
    const breathGain = audioCtx.createGain(); breathGain.gain.value = 0.06;
    breathLfo.frequency.value = 0.08; breathLfo.connect(breathGain); breathGain.connect(masterGain.gain);
    breathLfo.start();

    musicNodes = [bass, breathLfo];
    let chordIdx = 0;

    function playChord() {
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      const chord = CHORDS[chordIdx % CHORDS.length];
      chordIdx++;

      chord.forEach((si, i) => {
        const freq = SCALE[si % SCALE.length];
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        // Slight detune for warmth
        osc.detune.value = (Math.random() - 0.5) * 8;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.07 / (i + 1), now + 0.3);
        env.gain.setTargetAtTime(0, now + 4.5, 1.5);
        osc.connect(env); env.connect(masterGain);
        osc.start(now); osc.stop(now + 8);
      });

      // Occasional plucked high note
      if (Math.random() < 0.4) {
        const hi = SCALE[4 + Math.floor(Math.random() * 5)];
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();
        osc.type = 'triangle'; osc.frequency.value = hi * 2;
        env.gain.setValueAtTime(0.04, now + 0.8);
        env.gain.exponentialRampToValueAtTime(0.001, now + 3);
        osc.connect(env); env.connect(masterGain);
        osc.start(now + 0.8); osc.stop(now + 3.5);
      }

      chordTimer = setTimeout(playChord, 7000 + Math.random() * 3000);
    }

    playChord();
  }

  function stopMusic() {
    clearTimeout(chordTimer); chordTimer = null;
    musicNodes.forEach(n => { try { n.osc ? n.osc.stop() : n.stop(); } catch(e) {} });
    musicNodes = [];
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  }

  document.getElementById('btn-music-toggle').addEventListener('click', () => {
    const btn = document.getElementById('btn-music-toggle');
    musicOn = !musicOn;
    if (musicOn) { startMusic(); btn.textContent = '🔊'; btn.title = 'Mute ambient music'; }
    else { stopMusic(); btn.textContent = '🔇'; btn.title = 'Play ambient music'; }
  });

  // ── Companion chat ──
  const companionInput = document.getElementById('companion-input');
  document.getElementById('btn-companion-send').addEventListener('click', sendCompanionMessage);
  companionInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendCompanionMessage(); });

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

function renderGameUI() {
  renderStats();
  renderPhaseBanner();
  renderActionBar();
  renderEnemies();
  renderGameParty();
  updateCompanionPanel();
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
  const xpNeed = [0,100,250,500,900,1400,2000,2700,3500,4500][s.level] || 999;
  const xpPct = pctOf(s.xp || 0, xpNeed);
  const hpLow = hpPct < 25;

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
      <div class="bar-label"><span>💙 MP</span><span>${s.mana}/${s.max_mana}</span></div>
      <div class="bar-track"><div class="bar-fill bar-mp" style="width:${mpPct}%"></div></div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>⭐ XP</span><span>${s.xp||0}/${xpNeed}</span></div>
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

function renderPhaseBanner() {
  const banner = document.getElementById('phase-banner');
  const phase = state.phase || 'exploring';
  banner.className = `phase-banner ${phase}`;
  document.getElementById('phase-text').textContent = PHASE_LABELS[phase] || phase.toUpperCase();
  document.getElementById('game-time').textContent = `Day ${state.gameDay} · ${String(state.gameHour).padStart(2,'0')}:00`;
}

function renderActionBar() {
  const bar = document.getElementById('action-bar');
  const phase = state.phase || 'exploring';

  if (phase === 'victory' || phase === 'game_over') {
    bar.innerHTML = `
      <button class="btn btn-primary" id="btn-return-lobby">
        ${phase === 'victory' ? '🏆 Return to Lobby' : '💀 Back to Lobby'}
      </button>
    `;
    document.getElementById('btn-return-lobby').addEventListener('click', returnToLobby);
    return;
  }

  if (phase === 'combat') {
    const p = state.player;
    const skills = (p && p.skills) ? p.skills.slice(0, 3) : [];
    const hasPotion = p && p.inventory && p.inventory.some(i => (typeof i === 'string' ? i : i.name || '').includes('health_potion'));

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
    skills.forEach(skillKey => {
      const skill = SKILLS[skillKey] || { name: skillKey, emoji: '✨', mp: 0 };
      const p = state.player;
      const canUse = !p || (ps(p).mana >= skill.mp);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.disabled = !canUse;
      btn.innerHTML = `<span>${skill.emoji} ${skill.name}</span><span class="skill-cost">${skill.mp} MP</span>`;
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
    return;
  }

  if (phase === 'looting') {
    bar.innerHTML = `
      <button class="btn btn-accent btn-large" id="btn-loot">💰 LOOT THE ROOM</button>
      <span style="color:var(--text-muted);font-size:11px">or continue exploring</span>
    `;
    document.getElementById('btn-loot').addEventListener('click', () => {
      ws.send('LOOT_ROOM', {});
    });
    // Also show direction buttons for already-cleared rooms
    renderDirectionButtons(bar, true);
    return;
  }

  // Exploring (default) — direction buttons + contextual actions
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
}

function renderDirectionButtons(container, append) {
  const dungeon = state.dungeon;
  const currentRoom = dungeon && dungeon.current_room_id ? dungeon.rooms[dungeon.current_room_id] : null;
  const exits = currentRoom ? (currentRoom.exits || {}) : {};

  const dirs = [
    { key: 'north', icon: '↑', label: 'N' },
    { key: 'south', icon: '↓', label: 'S' },
    { key: 'west',  icon: '←', label: 'W' },
    { key: 'east',  icon: '→', label: 'E' },
  ];

  const group = append ? document.createElement('div') : container;
  if (append) {
    group.className = 'action-group';
    container.appendChild(group);
  }

  dirs.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'dir-btn';
    btn.title = d.key.charAt(0).toUpperCase() + d.key.slice(1);
    btn.innerHTML = d.icon;
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

  el.innerHTML = combat.enemies.map(enemy => {
    const hpPct = pctOf(enemy.hp, enemy.max_hp);
    const isDead = enemy.hp <= 0;
    return `
      <div class="enemy-card ${enemy.stunned ? 'stunned' : ''} ${isDead ? 'dead' : ''}" id="enemy-${enemy.id}">
        <div class="enemy-header">
          <span class="enemy-emoji">${enemy.emoji || '👹'}</span>
          <span class="enemy-name">${enemy.name}</span>
          ${enemy.is_boss ? '<span class="enemy-boss-tag">BOSS</span>' : ''}
          ${enemy.stunned ? '<span class="enemy-stun-tag">STUNNED</span>' : ''}
        </div>
        <div class="enemy-hp-bar">
          <div class="enemy-hp-fill" style="width:${hpPct}%"></div>
        </div>
        <div class="enemy-hp-text">${enemy.hp}/${enemy.max_hp} HP · ATK ${enemy.attack} · DEF ${enemy.defense}</div>
      </div>
    `;
  }).join('');
}

function renderGameParty() {
  const el = document.getElementById('game-party-members');
  const party = state.party;
  if (!party || !party.member_ids || party.member_ids.length <= 1) {
    el.innerHTML = '<div class="empty-state" style="font-size:10px">Solo adventure</div>';
    return;
  }
  const p = state.player;
  el.innerHTML = party.member_ids.map(id => {
    const isSelf = id === state.playerId;
    const member = isSelf ? p : null;
    const cls = member ? (CLASSES[member.player_class] || CLASSES.warrior) : { emoji: '👤' };
    const name = member ? member.name : `Player...`;
    const hpPct = member ? pctOf(ps(member).health, ps(member).max_health) : 100;
    return `<div class="game-party-member">
      <div class="gpm-header">
        <span class="gpm-emoji">${cls.emoji}</span>
        <span class="gpm-name">${name}${isSelf ? ' ★' : ''}</span>
      </div>
      <div class="bar-track" style="height:4px">
        <div class="bar-fill bar-hp" style="width:${hpPct}%"></div>
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

async function loadContextualActions(room) {
  if (!room) return;
  _contextualActionRoom = room.id;

  const pos = getPosition();
  const nearby = [];
  if (state.dungeon && state.dungeon.rooms) {
    Object.values(state.dungeon.rooms).forEach(r => {
      if (r.id !== room.id && r.name) nearby.push(r.name);
    });
  }

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
  entry.className = `log-entry ${kind}`;
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

function generateSceneImage(room) {
  if (!room) return;
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

  let prompt = `dark fantasy RPG, ${locHint} ${realName}`;
  if (zoneName) prompt += ` in ${zoneName}`;
  if (room.room_type === 'boss') prompt += ', final boss chamber, ancient evil, dramatic purple light';
  else if (room.room_type === 'treasure') prompt += ', hidden treasure vault, gold and gems glowing';
  else if (room.room_type === 'start') prompt += ', adventure entrance, torch-lit stone archway';
  else prompt += `, ${room.description || room.name || 'dungeon corridor'}`;
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
  const room = currentRoomData;
  const locationName = (laMap && laMap.getRoomName(room && room.id)) || (room && room.name) || 'your location';
  const lat = (laMap && room && laMap.roomLocations[room.id]) ? laMap.roomLocations[room.id][0] : 34.0522;
  const lng = (laMap && room && laMap.roomLocations[room.id]) ? laMap.roomLocations[room.id][1] : -118.2437;

  const modal   = document.getElementById('tavern-modal');
  const list    = document.getElementById('tavern-list');
  const label   = document.getElementById('tavern-location-label');
  const status  = document.getElementById('tavern-action-status');

  label.textContent = `Near ${locationName}`;
  list.innerHTML = '<div class="status-line"><span class="spinner"></span><span>Scouting establishments...</span></div>';
  status.classList.add('hidden');
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/taverns?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    const taverns = data.taverns || [];

    if (!taverns.length) {
      list.innerHTML = '<div class="empty-state">No taverns found nearby. The wilderness is barren.</div>';
      return;
    }

    list.innerHTML = taverns.map((t, i) => `
      <div class="tavern-item">
        <span class="tavern-emoji">${t.emoji}</span>
        <div class="tavern-info">
          <div class="tavern-name">${t.name}</div>
          <div class="tavern-type">${t.type}${t.cuisine ? ' · ' + t.cuisine : ''}</div>
          ${t.opening_hours ? `<div class="tavern-cuisine">⏰ ${t.opening_hours}</div>` : ''}
        </div>
        <button class="tavern-visit-btn" onclick="visitTavern('${t.name.replace(/'/g,"\\'")}')">Visit</button>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p style="color:var(--red);padding:12px">Failed to find nearby taverns.</p>';
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

  // Show player message
  const playerEl = document.createElement('div');
  playerEl.className = 'companion-msg player';
  playerEl.textContent = msg;
  log.appendChild(playerEl);
  input.value = '';
  log.scrollTop = log.scrollHeight;

  // Build context from current game state
  const phase = state.phase || 'exploring';
  const room = currentRoomData;
  const context = [
    phase === 'combat' ? 'We are in combat' : `We are ${phase}`,
    room ? `in ${room.name || 'a dungeon room'}` : '',
    state.dungeon ? `(${state.dungeon.rooms_cleared || 0} rooms cleared)` : '',
  ].filter(Boolean).join(', ');

  // Show typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'companion-msg companion';
  typingEl.innerHTML = '<span class="companion-sender">...</span><span class="spinner" style="width:10px;height:10px;border-width:1px"></span>';
  log.appendChild(typingEl);
  log.scrollTop = log.scrollHeight;

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
    typingEl.innerHTML = `<span class="companion-sender">${data.companion || 'Companion'}</span>${data.reply || '...'}`;
    // Also log in chronicle
    addLog(`💬 ${data.companion}: "${data.reply}"`, 'system');
  } catch (e) {
    typingEl.innerHTML = '<span class="companion-sender">Companion</span>*no response*';
  }
  log.scrollTop = log.scrollHeight;
}

function updateCompanionPanel() {
  const p = state.player;
  if (!p) return;
  const COMPANION_NAMES = {
    warrior: '🛡 Bryn', mage: '✨ Luma', rogue: '🌑 Shade',
    cleric: '☀️ Seraph', ranger: '🐺 Fang',
  };
  const nameEl = document.getElementById('companion-name');
  const tagEl = document.getElementById('companion-class-tag');
  if (nameEl) nameEl.textContent = COMPANION_NAMES[p.player_class] || '🗡 Companion';
  if (tagEl) tagEl.textContent = p.player_class;
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

  const items = p.inventory || [];
  const skills = p.skills || [];

  document.getElementById('inventory-items').innerHTML = items.length
    ? items.map(item => {
        const name = typeof item === 'string' ? item : item.name;
        const desc = typeof item === 'object' ? item.description : '';
        const emoji = ITEM_EMOJIS[name] || ITEM_EMOJIS.default;
        const isConsumable = name.includes('potion') || name.includes('bandage');
        return `<div class="item-row">
          <span class="item-emoji">${emoji}</span>
          <div class="item-info">
            <div class="item-name">${formatName(name)}</div>
            ${desc ? `<div class="item-desc">${desc}</div>` : ''}
          </div>
          ${isConsumable && state.phase !== 'combat' ?
            `<button class="btn btn-ghost btn-sm use-item-btn" data-item="${name}">Use</button>` : ''}
        </div>`;
      }).join('')
    : '<div class="empty-state">No items</div>';

  document.getElementById('inventory-skills').innerHTML = skills.map(key => {
    const skill = SKILLS[key] || { name: key, emoji: '✨', mp: 0, desc: '' };
    return `<div class="skill-card">
      <div class="skill-header">
        <span class="skill-emoji">${skill.emoji}</span>
        <span class="skill-name">${skill.name}</span>
        <span class="skill-mp">${skill.mp} MP</span>
      </div>
      <div class="skill-desc">${skill.desc}</div>
    </div>`;
  }).join('');

  // Bind use-item buttons
  document.querySelectorAll('.use-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ws.send('USE_ITEM', { item_name: btn.dataset.item });
      closeInventory();
    });
  });

  document.getElementById('inventory-modal').classList.remove('hidden');
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

    if (state.screen !== 'game') {
      showScreen('game');
    }

    const room = payload.room;
    if (room) {
      currentRoomData = room;
      sceneImageSeed = Math.floor(Math.random() * 99999);
      generateSceneImage(room);
      if (laMap && state.dungeon) laMap.render(state.dungeon);
      updateMapProgress();
    }

    if (payload.narrative) {
      addLog(payload.narrative, 'narrative');
    }

    renderPhaseBanner();
    renderActionBar();
    renderEnemies();
  });

  // Combat updates
  ws.on('COMBAT_UPDATE', msg => {
    const payload = msg.payload || {};
    applyStateUpdate(payload);

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
      const enemyEl = document.querySelector('.enemy-card');
      if (enemyEl) {
        const rect = enemyEl.getBoundingClientRect();
        showDamageNumber(payload.damage_dealt, rect.left + rect.width/2, rect.top + 20, 'damage');
        enemyEl.classList.add('hit-flash');
        setTimeout(() => enemyEl.classList.remove('hit-flash'), 400);
      }
    }
    if (payload.damage_taken) {
      const statsEl = document.getElementById('stats-panel');
      if (statsEl) {
        const rect = statsEl.getBoundingClientRect();
        showDamageNumber(payload.damage_taken, rect.left + 80, rect.top + 40, 'damage');
        statsEl.classList.add('hit-flash');
        setTimeout(() => statsEl.classList.remove('hit-flash'), 400);
      }
    }
  });

  // AI DM narrative
  ws.on('DM_RESPONSE', msg => {
    const payload = msg.payload || {};
    const text = payload.narrative || payload.response || payload.text || '';
    if (text) addLog(text, 'narrative');
  });

  // Game events (world events, broadcasts)
  ws.on('GAME_EVENT', msg => {
    const payload = msg.payload || {};
    const event = payload.event || payload.event_type || '';
    const data = payload.data || payload;

    if (event === 'adventure_started') {
      // Server sends dungeon + player + phase here — transition to game
      if (payload.dungeon) {
        state.dungeon = payload.dungeon;
        state.phase   = payload.phase || 'exploring';
        if (payload.player) state.player = payload.player;
        if (payload.party)  state.party  = payload.party;
        showScreen('game');
        renderGameUI();

        // Load the starting room scene image and log
        const startRoom = payload.dungeon.rooms && payload.dungeon.rooms[payload.dungeon.current_room_id];
        if (startRoom) {
          currentRoomData = startRoom;
          sceneImageSeed = Math.floor(Math.random() * 99999);
          generateSceneImage(startRoom);
          document.getElementById('scene-room-name').textContent = startRoom.name || '';
        }
      }
      if (payload.narrative) addLog(payload.narrative, 'narrative');
      addLog(`🗡️ The adventure begins! Use the arrow buttons to explore.`, 'system');
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

  // Heartbeat response (has game time)
  ws.on('SUCCESS', msg => {
    const payload = msg.payload || {};
    if (payload.game_day !== undefined) {
      state.gameDay  = payload.game_day;
      state.gameHour = payload.game_hour || 0;
      if (state.screen === 'game') renderPhaseBanner();
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
    el.textContent = `🌍 ${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`; el.style.color = '#4fc3f7';
    el.title = 'Real-world dungeon active (desktop mode)';
  } else {
    el.textContent = `📍 ${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`; el.style.color = '#4fc3f7';
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
// BOOT
// ═══════════════════════════════════════════════════════

function boot() {
  setupHandlers();
  initLogin();
  initLobby();
  initGame();
  showScreen('login');
  initGPS();
}

// Script is at bottom of <body> — DOM already parsed, call directly
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
