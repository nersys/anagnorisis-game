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

export const state = new Proxy(_state, {
  set(target, key, value) {
    target[key] = value;
    if (_listeners[key]) _listeners[key].forEach(fn => fn(value, target));
    if (_listeners['*']) _listeners['*'].forEach(fn => fn(key, value, target));
    return true;
  }
});

export function on(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
}

export function off(key, fn) {
  if (!_listeners[key]) return;
  _listeners[key] = _listeners[key].filter(h => h !== fn);
}

export function get() {
  return _state;
}

/** Merge a STATE_UPDATE payload into state */
export function applyStateUpdate(payload) {
  if (payload.player  !== undefined) state.player  = payload.player;
  if (payload.party   !== undefined) state.party   = payload.party;
  if (payload.dungeon !== undefined) state.dungeon = payload.dungeon;
  if (payload.combat  !== undefined) state.combat  = payload.combat;
  if (payload.phase   !== undefined) state.phase   = payload.phase;
}
