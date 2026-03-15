# Claude Code — Project Instructions for Anagnorisis

## Project Overview
Anagnorisis is a real-world RPG: GPS + OpenStreetMap data turns your neighborhood into a dungeon. The tech stack is FastAPI (Python) backend, plain JS/CSS frontend, Claude API for DM narrative, ElevenLabs for TTS, DALL-E for scene art.

## Key Principles When Making Changes

1. **Edit `bundle.js` directly** — it IS the source. There are no separate source files to compile. Bump `?v=N` in `index.html` after every JS change.
2. **Bump CSS version** in `index.html` after every CSS change (`app.css?v=N`).
3. **Server is stateless** — all game state lives in `GameEngine._players`, `_parties`, `_adventures`, `_player_dungeons`. No database writes yet.
4. **Never** add blue (`#1e88e5`, `#4fc3f7`) — the palette is warm dark fantasy (gold, amber, red, purple for magic).
5. **Never** add `position:absolute` to `.scene-regen-btn` or `.scene-action-btns` children — they sit in a flex row.
6. **CSS variable names**: use `--amber` for warm accent (not blue/cyan), `--purple` for magic/mana, `--ember` for fire.

## Architecture Shortcuts

- Add a new HTTP endpoint: `server/main.py` — follow the `@app.get()` pattern
- Add a new WS message type: `shared/models.py` → add to `MessageType` enum, then add `_handle_X()` in `game_engine.py` and wire in `self._handlers`
- Change DM personality: `server/dm_prompt.py`
- Add a new enemy: `shared/constants.py` → `ENEMY_TEMPLATES`
- Add a new skill: `shared/constants.py` → `SKILL_DEFINITIONS`, add to appropriate class in `CLASS_STARTING_SKILLS`
- Add a new POI type: `server/poi_classifier.py` → add tag mapping in `classify_poi()`

## File Size Reference
- `bundle.js`: ~2750 lines (JS — client logic)
- `app.css`: ~1400 lines (styles)
- `index.html`: ~461 lines (DOM)
- `game_engine.py`: ~1520 lines (server core)
- `main.py`: ~665 lines (HTTP + WS endpoint)

## Dev Commands
```bash
make dev          # start server with hot reload
make test         # run tests
make build        # production build
```

## Environment Variables (`.env`)
```
ANTHROPIC_API_KEY    # required for DM (Claude)
OPENAI_API_KEY       # optional: DALL-E scene art
ELEVENLABS_API_KEY   # optional: TTS narrator
ELEVENLABS_VOICE_ID  # optional: default pNInz6obpgDQGcFmaJgB (Adam)
BLOODLUST_URL        # optional: YouTube URL for BLOODLUST button
```

## Private Blueprint
Full codebase blueprint is in `PRIVATE_README.md` (gitignored).
