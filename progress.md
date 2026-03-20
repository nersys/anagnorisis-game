Original prompt: give me a github summary and then switch to working on this

- Investigating lobby roster bug where non-local party members render as `Player <id>` instead of selected names.
- Root cause: web client only knows `party.member_ids` for lobby rendering and falls back when no player object is cached.
- Follow-up issue: existing party members do not receive an updated party payload on join, only a `player_joined` event.
- Added `Party.member_details` / `PartyMemberSummary` so server party payloads include member names and classes.
- Added `GameEngine._party_to_dict()` and now use it for create/join/state updates; join also broadcasts a `STATE_UPDATE` with the refreshed roster.
- Updated `web/js/bundle.js` lobby rendering to use `party.member_details` before falling back to ID text, and rerender the lobby on `STATE_UPDATE`.
- Bumped `web/index.html` bundle cache version to `v=31`.
- Validation: `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile server/game_engine.py shared/models.py` passed. Browser flow not exercised yet in this environment.

- Investigated turn-based instability without changing code yet.
- Top suspected cause 1: client ignores `explore_turn_order` / `explore_active_player_id` on `DM_RESPONSE`, even though server advances turn and includes those fields for narrative actions; likely causes UI/action bar to show stale ownership after free-text turns.
- Top suspected cause 2: server removes players from `party.member_ids` on leave/disconnect but does not repair `party.explore_turn_order` or shared combat `turn_order`; stale IDs can leave parties waiting on absent players.
- Top suspected cause 3: combat round effects are modeled as shared combat-wide timers and are processed on each player action path, which makes status ticks / buff expiry / cooldowns inconsistent in multiplayer combat.
- Implemented turn-system fixes:
  - server now sanitizes exploration/combat turn orders when members leave/disconnect and before turn checks/render payloads
  - client now applies turn payloads from `DM_RESPONSE`, so free-text turns advance correctly in the UI
  - combat state now stores per-player timers/cooldowns/statuses instead of shared single values, and round-based effects tick once per round
  - companion auto-actions now resolve on the acting player's turn instead of once per round for the last actor
- UI update:
  - lower action areas (`explore-toolbar`, `action-bar`, `player-input-row`) now glow green on your turn
  - free-text action input is disabled when it is not your turn to prevent baiting invalid actions
- Validation:
  - `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile server/game_engine.py shared/models.py` passed
  - `node --check web/js/bundle.js` passed
  - `make test` fails in this environment because the Makefile uses `python` instead of `python3`
  - `python3 test_setup.py` is blocked here because project deps like `pydantic` are not installed
