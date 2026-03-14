# Anagnorisis MVP

> *"Anagnorisis"* — the moment in a story when the protagonist discovers the true nature of their situation.

An AI-powered, multiplayer D&D-style game where adventures unfold in real-time.

```
    ⚔️  ANAGNORISIS  ⚔️
    
    "Your fate awaits, adventurer..."
    
    ┌────────────────────────────┐
    │  ░░▒▒▓▓ THE REALM ▓▓▒▒░░  │
    │                            │
    │    🏰 ═══════ 🌲          │
    │    ║         / \          │
    │    ║       🧙  🗡️         │
    │    ║      /     \         │
    │   🏠 ══ 🌉 ═══ ⛰️         │
    │                            │
    └────────────────────────────┘
```

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │◄──────────────────►│   Server    │
│   (TUI)     │                    │  (FastAPI)  │
└─────────────┘                    └──────┬──────┘
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                         ┌────────┐  ┌────────┐  ┌────────┐
                         │ SQLite │  │ Claude │  │ Event  │
                         │   DB   │  │  API   │  │ Clock  │
                         └────────┘  └────────┘  └────────┘
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.11+ (for local development)

### Running with Docker

```bash
# Build and start everything
docker-compose up --build

# In another terminal, run the client
docker-compose exec client python -m client.main
```

### Running Locally

```bash
cd mvp

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e ".[dev]"

# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Start the server
python -m server.main

# In another terminal, start the client
python -m client.main
```

## Project Structure

```
mvp/
├── server/           # Game server (FastAPI + WebSocket)
│   ├── main.py       # Entry point
│   ├── game/         # Game engine, mechanics
│   ├── ai/           # Claude DM integration
│   ├── db/           # Database models, queries
│   └── events/       # Scheduler, timed events
│
├── client/           # TUI client (Textual)
│   ├── main.py       # Entry point
│   ├── screens/      # Different UI screens
│   ├── widgets/      # Reusable UI components
│   └── assets/       # ASCII art, maps
│
├── shared/           # Shared code
│   ├── models.py     # Pydantic models for messages
│   └── constants.py  # Game constants
│
├── docker-compose.yml
├── Dockerfile.server
├── Dockerfile.client
└── pyproject.toml
```

## Connecting a Friend (Local Network)

See `LOCAL_SETUP.md` (not in git) for instructions on sharing with friends.

## Learning Journey

This project is also a learning exercise in distributed systems. Key DDIA concepts explored:

- [ ] Client-Server architecture
- [ ] WebSocket bidirectional communication  
- [ ] Database persistence and transactions
- [ ] Event scheduling and time-based triggers
- [ ] State synchronization across clients
- [ ] (Future) Horizontal scaling, message queues

## License

MIT
