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

export class LAMap {
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
