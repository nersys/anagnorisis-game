"""
Anagnorisis Game Server

============================================
DDIA CONCEPT: Request Routing & WebSockets
============================================
Traditional HTTP is request-response: client asks, server answers, done.
WebSockets maintain a persistent connection, allowing:
- Server to push updates to clients (game events!)
- Lower latency (no connection overhead per message)
- Real-time bidirectional communication

We use FastAPI because it elegantly handles both:
- HTTP endpoints (health checks, REST API if needed)
- WebSocket connections (real-time game communication)
============================================
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from shared.models import GameMessage, MessageType
from server.connection_manager import ConnectionManager
from server.game_engine import GameEngine

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") == "true" else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("anagnorisis.server")


# ============================================
# Application Lifespan (Startup/Shutdown)
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle.
    
    This runs code on startup (before `yield`) and shutdown (after `yield`).
    Perfect for initializing/closing database connections, starting background tasks, etc.
    """
    logger.info("🎮 Anagnorisis server starting up...")
    
    # Initialize game engine
    app.state.game_engine = GameEngine()
    await app.state.game_engine.initialize()
    
    # Start the game clock (background task)
    app.state.clock_task = asyncio.create_task(
        app.state.game_engine.run_game_clock()
    )
    
    logger.info("✅ Server ready! Awaiting adventurers...")
    
    yield  # Server is running
    
    # Shutdown
    logger.info("🛑 Server shutting down...")
    app.state.clock_task.cancel()
    await app.state.game_engine.shutdown()
    logger.info("👋 Farewell, adventurers!")


# ============================================
# FastAPI Application
# ============================================

app = FastAPI(
    title="Anagnorisis",
    description="AI-powered D&D-style multiplayer game server",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow CORS for development (the TUI client won't need this, but useful for web clients)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connection manager handles all WebSocket connections
manager = ConnectionManager()


# ============================================
# HTTP Endpoints
# ============================================

@app.get("/")
async def root():
    """Welcome message and server info."""
    return {
        "name": "Anagnorisis",
        "version": "0.1.0",
        "status": "running",
        "message": "Your fate awaits, adventurer...",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint for Docker/load balancers."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "connections": manager.active_connection_count,
    }


# ============================================
# WebSocket Endpoint
# ============================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint for game communication.
    
    ============================================
    DDIA CONCEPT: Connection State Machine
    ============================================
    Each WebSocket connection goes through states:
    1. CONNECTING: Client initiates connection
    2. OPEN: Connection established, messages flow
    3. CLOSING: Either side initiates close
    4. CLOSED: Connection terminated
    
    We need to handle each state properly to avoid:
    - Resource leaks (unclosed connections)
    - Lost messages (during disconnect)
    - Zombie connections (client disappeared without closing)
    ============================================
    """
    # Accept the connection
    connection_id = await manager.connect(websocket)
    logger.info(f"🔗 New connection: {connection_id}")
    
    # Send welcome message
    welcome = GameMessage(
        type=MessageType.SUCCESS,
        payload={
            "message": "Welcome to Anagnorisis!",
            "connection_id": connection_id,
            "instructions": "Send a CONNECT message with your player name to begin.",
        }
    )
    await manager.send_to(connection_id, welcome)
    
    try:
        # Main message loop
        while True:
            # Wait for a message from the client
            data = await websocket.receive_json()
            
            # Parse and validate the message
            try:
                message = GameMessage(**data)
                logger.debug(f"📨 Received from {connection_id}: {message.type}")
                
                # Process the message through the game engine
                response = await app.state.game_engine.handle_message(
                    connection_id, message, manager
                )
                
                # Send response if there is one
                if response:
                    await manager.send_to(connection_id, response)
                    
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                error_msg = GameMessage(
                    type=MessageType.ERROR,
                    payload={"error": str(e)}
                )
                await manager.send_to(connection_id, error_msg)
                
    except WebSocketDisconnect:
        logger.info(f"🔌 Connection {connection_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for {connection_id}: {e}")
    finally:
        # Clean up the connection
        await manager.disconnect(connection_id)
        await app.state.game_engine.handle_disconnect(connection_id)


# ============================================
# Entry Point
# ============================================

def main():
    """Run the server using uvicorn."""
    import uvicorn
    
    host = os.getenv("SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("SERVER_PORT", "8000"))
    debug = os.getenv("DEBUG", "false").lower() == "true"
    
    logger.info(f"Starting server on {host}:{port}")
    
    uvicorn.run(
        "server.main:app",
        host=host,
        port=port,
        reload=debug,
        log_level="debug" if debug else "info",
    )


if __name__ == "__main__":
    main()
