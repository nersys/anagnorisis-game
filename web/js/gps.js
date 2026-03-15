/**
 * GPS Module — Real-world location tracking for Anagnorisis
 *
 * Tracks the player's actual GPS position so the game world IS their world.
 * Provides proximity checks so moving to a room requires physically going there.
 *
 * Desktop fallback: manual location entry or IP-based rough position.
 */

// ── Proximity threshold: within this many metres = "you're there" ─────────────
export const PROXIMITY_THRESHOLD_M = 80;

// ── Haversine distance (metres) between two GPS coords ───────────────────────
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── GPS state ─────────────────────────────────────────────────────────────────
const _state = {
  position: null,       // { lat, lng, accuracy }
  watchId: null,
  manual: false,        // true when position was set manually (desktop)
  simulating: false,    // true when "simulate travel" mode is active
  listeners: new Set(),
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start watching real GPS position.
 * Returns a promise that resolves to the first fix, or rejects with an error.
 */
export function startWatching() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by this browser'));
      return;
    }

    const opts = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    };

    _state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const prev = _state.position;
        _state.position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        _state.manual = false;

        // Only fire listeners if we've moved more than 5 m (avoids noise)
        const moved = !prev || haversineM(prev.lat, prev.lng, _state.position.lat, _state.position.lng) > 5;
        if (moved) _emit();

        resolve(_state.position);
      },
      (err) => {
        reject(err);
      },
      opts,
    );
  });
}

/** Stop GPS watch (call on cleanup) */
export function stopWatching() {
  if (_state.watchId !== null) {
    navigator.geolocation.clearWatch(_state.watchId);
    _state.watchId = null;
  }
}

/**
 * Manually set position (desktop fallback).
 * Accepts { lat, lng } or a string like "34.0522,-118.2437".
 */
export function setManualPosition(latOrObj, lng) {
  if (typeof latOrObj === 'string') {
    const parts = latOrObj.split(',').map(Number);
    _state.position = { lat: parts[0], lng: parts[1], accuracy: 1000 };
  } else if (typeof latOrObj === 'object') {
    _state.position = { lat: latOrObj.lat, lng: latOrObj.lng, accuracy: 1000 };
  } else {
    _state.position = { lat: Number(latOrObj), lng: Number(lng), accuracy: 1000 };
  }
  _state.manual = true;
  _state.simulating = false;
  _emit();
}

/** Enable simulate-travel mode: removes proximity gate for this session */
export function enableSimulateTravel() {
  _state.simulating = true;
  _emit();
}

export function disableSimulateTravel() {
  _state.simulating = false;
  _emit();
}

/** Current position or null if unavailable */
export function getPosition() {
  return _state.position ? { ..._state.position } : null;
}

export function isManual() { return _state.manual; }
export function isSimulating() { return _state.simulating; }

/**
 * Check whether the player is close enough to a target location.
 * Returns true if:
 *   - no GPS position is set (unknown → allow, don't block)
 *   - room has no lat/lng (classic dungeon → allow)
 *   - simulate mode is active
 *   - player is within PROXIMITY_THRESHOLD_M metres of the target
 */
export function isNearby(targetLat, targetLng) {
  if (_state.simulating) return true;
  if (!_state.position) return true;           // GPS unavailable → don't block
  if (targetLat == null || targetLng == null) return true;  // no coords on room
  const dist = haversineM(_state.position.lat, _state.position.lng, targetLat, targetLng);
  return dist <= PROXIMITY_THRESHOLD_M;
}

/**
 * Distance in metres from current position to target, or null if unknown.
 */
export function distanceTo(targetLat, targetLng) {
  if (!_state.position || targetLat == null || targetLng == null) return null;
  return Math.round(haversineM(_state.position.lat, _state.position.lng, targetLat, targetLng));
}

/** Subscribe to position updates. Callback receives current _state. */
export function onUpdate(fn) {
  _state.listeners.add(fn);
  return () => _state.listeners.delete(fn);
}

function _emit() {
  const snapshot = {
    position: _state.position ? { ..._state.position } : null,
    manual: _state.manual,
    simulating: _state.simulating,
  };
  _state.listeners.forEach(fn => fn(snapshot));
}

/**
 * Attempt to get a quick one-shot fix (for initial location query on adventure start).
 * Resolves immediately if we already have a position.
 */
export function getCurrentPositionOnce() {
  if (_state.position) return Promise.resolve({ ..._state.position });

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}
