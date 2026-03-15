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
from server.poi_classifier import process_overpass_elements

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


@app.get("/api/config")
async def get_public_config():
    """Return public client configuration from env."""
    from fastapi.responses import JSONResponse
    return JSONResponse({
        "bloodlust_url": os.getenv("BLOODLUST_URL", "https://www.youtube.com/watch?v=YePpuaIi8c4"),
        "bloodlust_end_sec": int(os.getenv("BLOODLUST_END_SEC", "2")),
    })

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
    Generate a scene image using DALL-E (if OPENAI_API_KEY is set).
    Defaults to DALL-E 2. Set USE_DALLE_3=true in .env to use DALL-E 3.
    Falls back to error if no OPENAI_API_KEY.
    """
    from fastapi.responses import Response

    # ── Try DALL-E ────────────────────────────────────────────────────────────
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        try:
            import openai as openai_lib
            client = openai_lib.AsyncOpenAI(api_key=openai_key)
            use_dalle3 = os.getenv("USE_DALLE_3", "").lower() in ("1", "true", "yes")
            dalle_model = "dall-e-3" if use_dalle3 else "dall-e-2"
            dalle_size = "1792x1024" if use_dalle3 else "512x512"
            dalle_prompt = (
                f"Dark fantasy RPG environment: {prompt}. "
                "Atmospheric cinematic oil painting, dramatic lighting, "
                "concept art, wide shot. No text, no words, no labels, no captions, no UI."
            )
            resp = await client.images.generate(
                model=dalle_model,
                prompt=dalle_prompt[:1000],
                size=dalle_size,
                n=1,
            )
            image_url = resp.data[0].url
            logger.info(f"🎨 {dalle_model} image generated for: {prompt[:50]}")
            # Return JSON with URL so client can use it directly (avoids CORS/redirect issues)
            from fastapi.responses import JSONResponse
            return JSONResponse({"url": image_url, "source": "dalle3"})
        except Exception as e:
            logger.warning(f"DALL-E failed ({e})")

    # No OPENAI_API_KEY — client will use Pollinations.ai instead
    from fastapi.responses import JSONResponse
    return JSONResponse({"error": "no_dalle_key"}, status_code=404)


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


@app.get("/tts")
async def text_to_speech(
    text: str = Query(..., description="Text to narrate"),
):
    """
    Convert text to speech using ElevenLabs (if ELEVENLABS_API_KEY is set).
    Returns MP3 audio. Falls back to 404 so the client uses browser Web Speech API.

    Recommended voice: Adam (pNInz6obpgDQGcFmaJgB) — deep, dramatic narrator.
    Override via ELEVENLABS_VOICE_ID env var.
    """
    from fastapi.responses import Response

    elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
    if not elevenlabs_key:
        return Response(status_code=404)

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")  # Adam
    narration = text[:2500]

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": elevenlabs_key,
                    "Content-Type": "application/json",
                },
                json={
                    "text": narration,
                    "model_id": "eleven_monolingual_v1",
                    "voice_settings": {"stability": 0.45, "similarity_boost": 0.75},
                },
            )
            if r.status_code == 200:
                return Response(content=r.content, media_type="audio/mpeg")
            logger.warning(f"ElevenLabs TTS returned {r.status_code}")
            return Response(status_code=500)
    except Exception as e:
        logger.warning(f"ElevenLabs TTS failed: {e}")
        return Response(status_code=500)


@app.get("/taverns")
async def find_taverns(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: int = Query(1200, description="Search radius in metres"),
):
    """
    Find real bars/pubs/restaurants near the given coordinates using OpenStreetMap Overpass API.
    Returns them formatted as in-game taverns with distance from the player.
    """
    import math

    def haversine(lat1, lng1, lat2, lng2) -> int:
        """Return distance in metres between two lat/lng points."""
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lng2 - lng1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
        return int(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

    overpass_query = f"""
[out:json][timeout:15];
(
  node[amenity~"^(bar|pub|restaurant|cafe|biergarten|food_court)$"](around:{radius},{lat},{lng});
  way[amenity~"^(bar|pub|restaurant|cafe|biergarten|food_court)$"](around:{radius},{lat},{lng});
);
out center 20;
"""
    taverns = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
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
                    if amenity in ("bar", "pub", "biergarten"):
                        ttype, emoji = "bar", "🍺"
                    elif amenity == "cafe":
                        ttype, emoji = "café", "☕"
                    else:
                        ttype, emoji = "restaurant", "🍖"

                    # Prefer node lat/lng; for ways use center
                    elat = el.get("lat") or (el.get("center", {}) or {}).get("lat", lat)
                    elng = el.get("lon") or (el.get("center", {}) or {}).get("lon", lng)
                    dist = haversine(lat, lng, elat, elng)

                    # Build a short address from OSM tags
                    addr_parts = [
                        tags.get("addr:housenumber", ""),
                        tags.get("addr:street", ""),
                    ]
                    address = " ".join(p for p in addr_parts if p) or tags.get("addr:full", "")

                    taverns.append({
                        "name": real_name,
                        "type": ttype,
                        "emoji": emoji,
                        "amenity": amenity,
                        "lat": elat,
                        "lng": elng,
                        "cuisine": tags.get("cuisine", "").replace(";", ", "),
                        "opening_hours": tags.get("opening_hours", ""),
                        "address": address,
                        "distance_m": dist,
                    })
    except Exception as e:
        logger.warning(f"Overpass API failed: {e}")

    # Sort by distance; return closest 10
    taverns.sort(key=lambda t: t["distance_m"])
    return {"taverns": taverns[:10], "location": {"lat": lat, "lng": lng}}


@app.get("/nearby-rooms")
async def nearby_rooms(
    lat: float = Query(..., description="Player latitude"),
    lng: float = Query(..., description="Player longitude"),
    radius: int = Query(800, description="Search radius in metres (max 1500)"),
):
    """
    Query OpenStreetMap for real POIs near the player's GPS position and
    return them as classified game rooms. The dungeon IS the neighbourhood.
    """
    radius = min(radius, 1500)

    overpass_query = f"""
[out:json][timeout:15];
(
  node[amenity](around:{radius},{lat},{lng});
  node[leisure](around:{radius},{lat},{lng});
  node[tourism](around:{radius},{lat},{lng});
  node[historic](around:{radius},{lat},{lng});
  node[shop](around:{radius},{lat},{lng});
  way[amenity](around:{radius},{lat},{lng});
  way[leisure](around:{radius},{lat},{lng});
  way[tourism](around:{radius},{lat},{lng});
  way[historic](around:{radius},{lat},{lng});
);
out center 40;
"""

    elements: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            r = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": overpass_query},
                headers={"User-Agent": "Anagnorisis-Game/1.0"},
            )
            if r.status_code == 200:
                elements = r.json().get("elements", [])
                logger.info(f"🗺️  Overpass returned {len(elements)} elements near {lat:.4f},{lng:.4f}")
    except Exception as e:
        logger.warning(f"Overpass /nearby-rooms failed: {e}")

    pois = process_overpass_elements(elements, lat, lng, max_results=20)
    logger.info(f"🏙️  Classified {len(pois)} game POIs near player")

    return {
        "pois": pois,
        "player": {"lat": lat, "lng": lng},
        "count": len(pois),
    }


@app.post("/contextual-actions")
async def contextual_actions(
    room_name: str = Body("Unknown Room", embed=True),
    room_type: str = Body("corridor", embed=True),
    room_description: str = Body("", embed=True),
    player_class: str = Body("warrior", embed=True),
    player_name: str = Body("Hero", embed=True),
    enemies: list[str] = Body([], embed=True),
    location_name: str = Body("", embed=True),
    nearby_pois: list[str] = Body([], embed=True),
):
    """
    Generate 4–6 contextual action buttons for the current room using Claude.
    Returns a list of { label, action, icon } objects.
    """
    enemy_line = f"Enemies present: {', '.join(enemies)}." if enemies else "The room is peaceful."
    poi_line = f"Nearby real-world places: {', '.join(nearby_pois[:4])}." if nearby_pois else ""
    loc_line = f"Real-world location: {location_name}." if location_name else ""

    prompt = f"""You are a dungeon master generating interactive action choices for a player.

Room: "{room_name}" (type: {room_type})
Description: {room_description or "A dark dungeon room."}
Player: {player_name}, a {player_class}
{enemy_line}
{loc_line}
{poi_line}

Generate exactly 5 short, creative action choices this player can take right now.
Make them specific to this location and situation — reference the real place name if given.
Mix exploration, social, and clever actions (not just attack).
Format as JSON array of objects with keys: "label" (short, max 4 words), "action" (verb phrase for the DM), "icon" (single emoji).

Example format:
[
  {{"label": "Search the shadows", "action": "searches the room's dark corners for secrets", "icon": "🔍"}},
  {{"label": "Listen at the door", "action": "presses their ear against the door to listen", "icon": "👂"}}
]

Output ONLY the JSON array, no explanation."""

    try:
        ai_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = ai_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Parse JSON
        import json
        start = text.find('[')
        end = text.rfind(']') + 1
        if start != -1 and end > start:
            actions = json.loads(text[start:end])
            return {"actions": actions[:6]}
    except Exception as e:
        logger.error(f"Contextual actions failed: {e}")

    # Fallback generic actions
    fallback = [
        {"label": "Search the room", "action": "searches the room carefully", "icon": "🔍"},
        {"label": "Listen for sounds", "action": "listens quietly for any sounds", "icon": "👂"},
        {"label": "Inspect the walls", "action": "examines the walls for hidden passages", "icon": "🧱"},
        {"label": "Check your gear", "action": "inspects and adjusts their equipment", "icon": "🎒"},
        {"label": "Rest briefly", "action": "takes a moment to catch their breath", "icon": "💤"},
    ]
    return {"actions": fallback}


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
        "When given recent story context, reference it naturally — comment on what just happened, "
        "what you saw, or what it means for your journey. Stay grounded in the specific events described. "
        "Never break character or mention being an AI."
    )
    user_prompt = message
    if context:
        user_prompt = f"[Story context: {context}]\n\n{player_name} asks: {message}"

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
