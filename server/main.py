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
import httpx
import anthropic

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse

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

# Serve web client static files (CSS, JS, etc.)
_web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.isdir(_web_dir):
    app.mount("/static", StaticFiles(directory=_web_dir), name="static")

# Connection manager handles all WebSocket connections
manager = ConnectionManager()


# ============================================
# HTTP Endpoints
# ============================================

@app.get("/api")
async def root():
    """API info endpoint."""
    return {
        "name": "Anagnorisis",
        "version": "0.1.0",
        "status": "running",
        "message": "Your fate awaits, adventurer...",
    }


@app.get("/")
async def serve_web():
    """Serve the web client."""
    import os
    web_index = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web", "index.html")
    if os.path.exists(web_index):
        return FileResponse(web_index)
    return {"message": "Web client not found. Run from project root."}


@app.get("/scene-art")
async def generate_scene_art(
    prompt: str = Query(..., description="Scene description to illustrate"),
):
    """
    Generate a scene image. Tries DALL-E 3 first (if OPENAI_API_KEY is set),
    falls back to Claude SVG generation.
    """
    from fastapi.responses import Response

    # ── Try DALL-E 3 ──────────────────────────────────────────────────────────
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        try:
            import openai as openai_lib
            client = openai_lib.AsyncOpenAI(api_key=openai_key)
            dalle_prompt = (
                f"Dark fantasy RPG game scene: {prompt}. "
                "Atmospheric cinematic oil painting, dramatic lighting, "
                "concept art style, wide panoramic shot, 16:9 aspect ratio."
            )
            resp = await client.images.generate(
                model="dall-e-3",
                prompt=dalle_prompt,
                size="1792x1024",
                quality="standard",
                n=1,
            )
            image_url = resp.data[0].url
            logger.info(f"🎨 DALL-E 3 image generated for: {prompt[:50]}")
            return RedirectResponse(url=image_url, status_code=302)
        except Exception as e:
            logger.warning(f"DALL-E 3 failed ({e}), falling back to Claude SVG")

    svg_system = (
        "You are a dark fantasy SVG illustrator. "
        "Generate atmospheric SVG artwork (800x350 viewBox) for RPG game scenes. "
        "Use dark color palettes, gradients, silhouettes, and atmospheric effects. "
        "Output ONLY valid SVG code — no markdown, no explanation, just the SVG tag."
    )

    svg_prompt = (
        f"Create a dark fantasy SVG scene illustration (800x350) for: {prompt}\n\n"
        "Requirements:\n"
        "- Dark atmospheric background with gradient sky/environment\n"
        "- Silhouetted foreground elements (buildings, trees, rocks, ruins)\n"
        "- A dramatic light source (moon, torch, magic, fire)\n"
        "- 2-3 enemy/creature silhouettes if enemies are mentioned\n"
        "- Atmospheric effects (fog, stars, smoke, sparks)\n"
        "- Location name as styled text at bottom-left\n"
        "- Color scheme: deep purples, dark blues, amber/gold highlights\n"
        "Start with <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 350'>"
    )

    try:
        ai_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = ai_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=svg_system,
            messages=[{"role": "user", "content": svg_prompt}],
        )
        svg_text = response.content[0].text.strip()

        # Ensure it's clean SVG
        if not svg_text.startswith("<svg"):
            start = svg_text.find("<svg")
            if start != -1:
                svg_text = svg_text[start:]
            else:
                raise ValueError("No SVG found in response")

        logger.info(f"🎨 SVG scene generated ({len(svg_text)} chars)")
        return Response(
            content=svg_text,
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=600"},
        )

    except Exception as e:
        logger.error(f"SVG generation failed: {e}")
        # Fallback: return a minimal atmospheric SVG
        room_type = "dungeon"
        fallback_svg = f"""<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 350'>
  <defs>
    <radialGradient id='g' cx='50%' cy='40%' r='60%'>
      <stop offset='0%' stop-color='#2a1a4a'/>
      <stop offset='100%' stop-color='#080810'/>
    </radialGradient>
  </defs>
  <rect width='800' height='350' fill='url(#g)'/>
  <circle cx='400' cy='80' r='30' fill='#c9a84c' opacity='0.3'/>
  <circle cx='400' cy='80' r='15' fill='#f0cc6a' opacity='0.6'/>
  <text x='20' y='330' font-family='serif' font-size='16' fill='#c9a84c' opacity='0.7'>{prompt[:60]}</text>
</svg>"""
        return Response(content=fallback_svg, media_type="image/svg+xml")


@app.get("/location-history")
async def location_history(
    name: str = Query(..., description="Location name to look up"),
    lat: float = Query(0.0),
    lng: float = Query(0.0),
):
    """
    Return real-world history for a location.
    Tries Wikipedia first, falls back to Claude generating atmospheric lore.
    """
    # ── Try Wikipedia ───────────────────────────────────────────────────────
    wiki_data = None
    try:
        import urllib.parse
        encoded = urllib.parse.quote(name.replace(" ", "_"))
        wiki_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded}"
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(wiki_url, headers={"User-Agent": "Anagnorisis-Game/1.0"})
            if r.status_code == 200:
                data = r.json()
                if data.get("extract") and data.get("type") != "disambiguation":
                    wiki_data = {
                        "title": data.get("title", name),
                        "extract": data.get("extract", "")[:800],
                        "thumbnail": (data.get("thumbnail") or {}).get("source"),
                        "url": data.get("content_urls", {}).get("desktop", {}).get("page"),
                        "source": "wikipedia",
                    }
    except Exception as e:
        logger.warning(f"Wikipedia lookup failed for '{name}': {e}")

    if wiki_data:
        return wiki_data

    # ── Fall back to Claude: generate atmospheric game-world lore ───────────
    try:
        ai_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        prompt = (
            f"You are a lore-keeper in a dark fantasy RPG set in a real-world city. "
            f"The player is at '{name}' (coordinates {lat:.4f}, {lng:.4f} in Los Angeles). "
            f"Write 3-4 sentences of atmospheric historical lore about this real place, "
            f"blending actual history with dark fantasy elements. "
            f"Mention real historical facts if you know them, weaving in RPG flavor."
        )
        response = ai_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        lore = response.content[0].text.strip()
        return {"title": name, "extract": lore, "thumbnail": None, "url": None, "source": "lore"}
    except Exception as e:
        logger.error(f"Lore generation failed: {e}")
        return {"title": name, "extract": f"The ancient records of {name} have been lost to time...", "thumbnail": None, "url": None, "source": "fallback"}


@app.get("/taverns")
async def find_taverns(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: int = Query(600, description="Search radius in metres"),
):
    """
    Find real bars/pubs/restaurants near the given coordinates using OpenStreetMap Overpass API.
    Returns them formatted as in-game taverns.
    """
    overpass_query = f"""
[out:json][timeout:10];
(
  node[amenity~"^(bar|pub|restaurant|cafe)$"](around:{radius},{lat},{lng});
);
out 12;
"""
    taverns = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": overpass_query},
                headers={"User-Agent": "Anagnorisis-Game/1.0"},
            )
            if r.status_code == 200:
                elements = r.json().get("elements", [])
                for el in elements:
                    tags = el.get("tags", {})
                    real_name = tags.get("name", "")
                    if not real_name:
                        continue
                    amenity = tags.get("amenity", "bar")
                    # Map real amenity to game tavern type
                    if amenity in ("bar", "pub"):
                        ttype, emoji = "tavern", "🍺"
                    elif amenity == "cafe":
                        ttype, emoji = "inn", "☕"
                    else:
                        ttype, emoji = "alehouse", "🍖"

                    taverns.append({
                        "name": real_name,
                        "type": ttype,
                        "emoji": emoji,
                        "amenity": amenity,
                        "lat": el.get("lat", lat),
                        "lng": el.get("lon", lng),
                        "cuisine": tags.get("cuisine", ""),
                        "opening_hours": tags.get("opening_hours", ""),
                    })
    except Exception as e:
        logger.warning(f"Overpass API failed: {e}")

    # If too few results, pad with thematic placeholders
    fallback_names = [
        ("The Wandering Blade", "tavern", "🍺"),
        ("The Dusty Flagon", "tavern", "🍺"),
        ("Crossroads Inn", "inn", "🛏"),
        ("The Healer's Hearth", "inn", "☕"),
    ]
    for fname, ftype, femoji in fallback_names:
        if len(taverns) >= 6:
            break
        taverns.append({"name": fname, "type": ftype, "emoji": femoji, "amenity": ftype, "lat": lat, "lng": lng, "cuisine": "", "opening_hours": ""})

    return {"taverns": taverns[:8], "location": {"lat": lat, "lng": lng}}


@app.post("/companion-chat")
async def companion_chat(
    message: str = Body(..., embed=True),
    player_class: str = Body("warrior", embed=True),
    player_name: str = Body("Hero", embed=True),
    context: str = Body("", embed=True),
):
    """
    Chat with your class companion using Claude AI.
    Returns a short in-character response.
    """
    COMPANION_PERSONAS = {
        "warrior": ("Bryn the Battle-Hardened", "a grizzled veteran warrior and loyal shield-bearer who respects strength and loyalty"),
        "mage":    ("Luma the Familiar", "a witty magical familiar spirit bound to the mage, knowledgeable but occasionally sarcastic"),
        "rogue":   ("Shade", "a mysterious shadow-companion who speaks in riddles, values cunning and gold"),
        "cleric":  ("Seraph", "a divine spirit-guide who offers wisdom and encouragement, occasionally cryptic"),
        "ranger":  ("Fang", "a loyal wolf companion who communicates through growls and body language, translated into short direct words"),
    }
    name, persona = COMPANION_PERSONAS.get(player_class, COMPANION_PERSONAS["warrior"])

    system_prompt = (
        f"You are {name}, {persona}. "
        f"You are the companion of {player_name}, a {player_class}. "
        "Respond in character with 1-3 short sentences. "
        "Be helpful, in-world, and match the dark fantasy dungeon RPG tone. "
        "Never break character or mention being an AI."
    )
    user_prompt = message
    if context:
        user_prompt = f"[Current situation: {context}]\n{message}"

    try:
        ai_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = ai_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        reply = response.content[0].text.strip()
    except Exception as e:
        logger.error(f"Companion chat failed: {e}")
        fallback = {
            "warrior": "Stay alert. We press on.",
            "mage": "Interesting question... *adjusts spectacles*",
            "rogue": "Eyes forward. Ask later.",
            "cleric": "The light guides us. Have faith.",
            "ranger": "*Fang sniffs the air and glances at you*",
        }
        reply = fallback.get(player_class, "...")

    return {"companion": name, "reply": reply}


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
