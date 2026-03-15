"""
Game Engine - The Heart of Anagnorisis

============================================
DDIA CONCEPT: State Machines
============================================
Games are essentially state machines:
- States: Menu, Lobby, InGame, Combat, etc.
- Transitions: Player actions that move between states
- Rules: Valid transitions and their effects

The game engine:
1. Maintains authoritative game state
2. Validates and processes player actions
3. Triggers AI responses when needed
4. Manages the game clock and timed events
============================================
"""

import asyncio
import logging
import os
import random
from datetime import datetime
from typing import Optional

from shared.models import (
    GameMessage,
    MessageType,
    Player,
    PlayerClass,
    PlayerStats,
    Party,
    PartyStatus,
    Adventure,
    AdventureMode,
    ClientState,
    DungeonState,
    CombatState,
    GamePhase,
    Enemy,
    Item,
    ItemType,
)
from shared.constants import (
    CLASS_BASE_STATS,
    CLASS_STARTING_SKILLS,
    CLASS_STARTING_INVENTORY,
    GAME_TICK_SECONDS,
    SKILL_DEFINITIONS,
    ITEM_TEMPLATES,
)
from server.connection_manager import ConnectionManager
from server.ai_dungeon_master import AIDungeonMaster
from server.dungeon_generator import generate_dungeon, generate_dungeon_from_pois

logger = logging.getLogger("anagnorisis.engine")


class GameEngine:
    """
    The central game logic processor.
    
    Responsibilities:
    - Player management (create, lookup, state)
    - Party management (create, join, leave)
    - Adventure management (start, progress, complete)
    - Message routing to appropriate handlers
    - Game clock management
    """
    
    def __init__(self):
        # In-memory state (will be replaced with database later)
        self._players: dict[str, Player] = {}
        self._parties: dict[str, Party] = {}
        self._adventures: dict[str, Adventure] = {}

        # Map connection_id -> player_id for quick lookup
        self._connection_to_player: dict[str, str] = {}

        # AI Dungeon Master
        self._dm: Optional[AIDungeonMaster] = None

        # Game clock state
        self._running = False
        self._current_game_hour = 8  # Start at 8 AM
        self._current_game_day = 1

        # Per-player dungeon state (player_id -> DungeonState)
        self._player_dungeons: dict[str, DungeonState] = {}
        # Per-player combat state (player_id -> CombatState)
        self._player_combat: dict[str, CombatState] = {}
        # Per-player game phase (player_id -> GamePhase)
        self._player_phase: dict[str, GamePhase] = {}
        # Per-player buff tracking
        self._player_attack_buff: dict[str, int] = {}  # player_id -> bonus attack
        # Pending dice rolls: player_id -> {action, setup_narrative, die, stat, dc, party_id}
        self._pending_dice: dict[str, dict] = {}
        # Per-adventure narrator locks to prevent concurrent narrator invocations
        self._narrator_locks: dict[str, asyncio.Lock] = {}
    
    async def initialize(self) -> None:
        """Initialize the game engine."""
        logger.info("Initializing game engine...")
        
        # Initialize AI DM
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if api_key and api_key != "your-api-key-here":
            self._dm = AIDungeonMaster(api_key)
            logger.info("✨ AI Dungeon Master initialized")
        else:
            logger.warning("⚠️ No API key found - AI DM disabled. Set ANTHROPIC_API_KEY in .env")
            self._dm = None
        
        self._running = True
        logger.info("Game engine ready!")
    
    async def shutdown(self) -> None:
        """Clean shutdown of the game engine."""
        self._running = False
        logger.info("Game engine shut down.")
    
    # ============================================
    # Message Handling (Main Entry Point)
    # ============================================
    
    async def handle_message(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> Optional[GameMessage]:
        """
        Process an incoming message and return a response.
        
        This is the main dispatcher - routes messages to specific handlers.
        """
        handlers = {
            MessageType.CONNECT: self._handle_connect,
            MessageType.HEARTBEAT: self._handle_heartbeat,
            MessageType.CREATE_PARTY: self._handle_create_party,
            MessageType.JOIN_PARTY: self._handle_join_party,
            MessageType.LEAVE_PARTY: self._handle_leave_party,
            MessageType.LIST_PARTIES: self._handle_list_parties,
            MessageType.START_ADVENTURE: self._handle_start_adventure,
            MessageType.PLAYER_ACTION: self._handle_player_action,
            # Interactive dungeon/combat
            MessageType.MOVE: self._handle_move,
            MessageType.COMBAT_ACTION: self._handle_combat_action,
            MessageType.LOOT_ROOM: self._handle_loot_room,
            MessageType.USE_ITEM: self._handle_use_item,
            MessageType.TAVERN_VISIT: self._handle_tavern_visit,
            MessageType.DICE_RESULT: self._handle_dice_result,
        }
        
        handler = handlers.get(message.type)
        if handler:
            return await handler(connection_id, message, manager)
        else:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": f"Unknown message type: {message.type}"}
            )
    
    async def handle_disconnect(self, connection_id: str) -> None:
        """Handle a player disconnecting."""
        player_id = self._connection_to_player.pop(connection_id, None)
        if player_id:
            logger.info(f"Player {player_id} disconnected")
            # TODO: Handle party state, save progress, etc.
    
    # ============================================
    # Connection & Player Management
    # ============================================
    
    async def _handle_connect(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Handle player connection/login.
        
        Expected payload:
        {
            "player_name": "Aragorn",
            "player_class": "warrior"
        }
        """
        payload = message.payload
        player_name = payload.get("player_name", "").strip()
        player_class_str = payload.get("player_class", "warrior").lower()
        
        if not player_name:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "Player name is required"}
            )
        
        # Validate class
        try:
            player_class = PlayerClass(player_class_str)
        except ValueError:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": f"Invalid class. Choose from: {[c.value for c in PlayerClass]}"}
            )
        
        # Create or retrieve player
        # For MVP, we create a new player each time
        # TODO: Add persistence and login
        base_stats = CLASS_BASE_STATS.get(player_class.value, {})
        
        player = Player(
            name=player_name,
            player_class=player_class,
            stats=PlayerStats(**base_stats),
            skills=CLASS_STARTING_SKILLS.get(player_class.value, []),
            inventory=CLASS_STARTING_INVENTORY.get(player_class.value, []),
        )
        
        # Store player
        self._players[player.id] = player
        self._connection_to_player[connection_id] = player.id
        
        # Associate with connection manager
        manager.associate_player(connection_id, player.id)
        
        logger.info(f"Player '{player.name}' ({player.player_class.value}) joined as {player.id}")
        
        # Return success with player state
        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": f"Welcome, {player.name} the {player.player_class.value.title()}!",
                "player": player.model_dump(mode="json"),
                "available_commands": [
                    "create_party - Create a new adventuring party",
                    "list_parties - See available parties to join",
                    "join_party <id> - Join an existing party",
                ]
            }
        )
    
    async def _handle_heartbeat(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """Handle heartbeat to keep connection alive."""
        manager.update_heartbeat(connection_id)
        return GameMessage(
            type=MessageType.HEARTBEAT,
            payload={"status": "alive", "game_day": self._current_game_day, "game_hour": self._current_game_hour}
        )
    
    # ============================================
    # Party Management
    # ============================================
    
    async def _handle_create_party(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Create a new party.
        
        Expected payload:
        {
            "party_name": "Fellowship of the Ring",
            "max_members": 4  # optional
        }
        """
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You must connect first (send CONNECT message)"}
            )
        
        player = self._players.get(player_id)
        if not player:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "Player not found"}
            )
        
        payload = message.payload
        party_name = payload.get("party_name", f"{player.name}'s Party")
        max_members = min(payload.get("max_members", 4), 6)  # Cap at 6
        
        # Create the party
        party = Party(
            name=party_name,
            leader_id=player_id,
            member_ids=[player_id],
            max_members=max_members,
        )
        
        self._parties[party.id] = party
        manager.associate_party(connection_id, party.id)
        
        logger.info(f"Party '{party.name}' created by {player.name}")
        
        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": f"Party '{party.name}' created! Share this ID with friends: {party.id}",
                "party": party.model_dump(mode="json"),
            }
        )
    
    async def _handle_join_party(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Join an existing party.
        
        Expected payload:
        {
            "party_id": "abc123"
        }
        """
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You must connect first"}
            )
        
        player = self._players.get(player_id)
        party_id = message.payload.get("party_id")
        
        if not party_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "party_id is required"}
            )
        
        party = self._parties.get(party_id)
        if not party:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": f"Party '{party_id}' not found"}
            )
        
        if party.status != PartyStatus.LOBBY:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "This party is already on an adventure"}
            )
        
        if len(party.member_ids) >= party.max_members:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "Party is full"}
            )
        
        if player_id in party.member_ids:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You're already in this party"}
            )
        
        # Join the party
        party.member_ids.append(player_id)
        manager.associate_party(connection_id, party.id)
        
        # Notify other party members
        join_notification = GameMessage(
            type=MessageType.GAME_EVENT,
            payload={
                "event": "player_joined",
                "player_name": player.name,
                "player_class": player.player_class.value,
                "party_size": len(party.member_ids),
            }
        )
        await manager.broadcast_to_party(party.id, join_notification, exclude=connection_id)
        
        logger.info(f"Player {player.name} joined party {party.name}")
        
        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": f"You joined '{party.name}'!",
                "party": party.model_dump(mode="json"),
                "members": [self._players[pid].name for pid in party.member_ids],
            }
        )
    
    async def _handle_leave_party(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """Leave current party."""
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You must connect first"}
            )
        
        # Find player's party
        for party in self._parties.values():
            if player_id in party.member_ids:
                party.member_ids.remove(player_id)
                
                # If party is empty, delete it
                if not party.member_ids:
                    del self._parties[party.id]
                    logger.info(f"Party {party.name} disbanded (empty)")
                # If leader left, assign new leader
                elif party.leader_id == player_id:
                    party.leader_id = party.member_ids[0]
                
                return GameMessage(
                    type=MessageType.SUCCESS,
                    payload={"message": f"You left '{party.name}'"}
                )
        
        return GameMessage(
            type=MessageType.ERROR,
            payload={"error": "You're not in a party"}
        )
    
    async def _handle_list_parties(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """List all available parties to join."""
        available = [
            {
                "id": p.id,
                "name": p.name,
                "leader": self._players[p.leader_id].name if p.leader_id in self._players else "Unknown",
                "members": len(p.member_ids),
                "max_members": p.max_members,
                "status": p.status.value,
            }
            for p in self._parties.values()
            if p.status == PartyStatus.LOBBY
        ]
        
        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "parties": available,
                "message": f"Found {len(available)} available parties" if available else "No parties available. Create one!",
            }
        )
    
    # ============================================
    # Adventure Management
    # ============================================
    
    async def _handle_start_adventure(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Start a new adventure for the party.
        
        Expected payload:
        {
            "adventure_name": "The Lost Temple",
            "description": "A mysterious temple has been discovered...",
            "mode": "guided"  # optional: freeform, structured, guided
        }
        """
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You must connect first"}
            )
        
        # Find player's party
        party = None
        for p in self._parties.values():
            if player_id in p.member_ids:
                party = p
                break
        
        if not party:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You must be in a party to start an adventure"}
            )
        
        if party.leader_id != player_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "Only the party leader can start an adventure"}
            )
        
        if party.status != PartyStatus.LOBBY:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "Party is already on an adventure"}
            )
        
        payload = message.payload
        mode_str = payload.get("mode", "guided").lower()
        
        try:
            mode = AdventureMode(mode_str)
        except ValueError:
            mode = AdventureMode.GUIDED
        
        # Create the adventure
        adventure = Adventure(
            name=payload.get("adventure_name", "A New Beginning"),
            description=payload.get("description", "Your adventure awaits..."),
            mode=mode,
            party_id=party.id,
        )
        
        self._adventures[adventure.id] = adventure
        party.status = PartyStatus.IN_ADVENTURE
        party.current_adventure_id = adventure.id

        logger.info(f"Adventure '{adventure.name}' started for party {party.name}")

        # Generate dungeon for each party member
        # If the player sent GPS coords + pre-fetched POIs, build a real-world dungeon
        player_lat = payload.get("lat")
        player_lng = payload.get("lng")
        pois = payload.get("pois", [])

        for pid in party.member_ids:
            if player_lat is not None and player_lng is not None and pois:
                rooms = generate_dungeon_from_pois(pois, player_lat, player_lng)
                logger.info(f"🌍 Real-world dungeon generated ({len(rooms)} rooms) for {pid}")
            else:
                rooms = generate_dungeon()
                logger.info(f"🏰 Classic dungeon generated for {pid}")

            dungeon = DungeonState(
                rooms={rid: r for rid, r in rooms.items()},
                current_room_id="r0",
                total_rooms=len(rooms),
            )
            self._player_dungeons[pid] = dungeon
            self._player_phase[pid] = GamePhase.EXPLORING
            self._player_attack_buff[pid] = 0

        # Get intro from AI DM if available — pass real-world location context
        start_room = self._player_dungeons[party.member_ids[0]].rooms["r0"]
        intro_narrative = start_room.description
        if self._dm:
            party_members = [self._players[pid] for pid in party.member_ids if pid in self._players]
            location_name = payload.get("location_name", "")
            nearby_names = [p.get("name", "") for p in pois if p.get("name")] if pois else []
            intro_narrative = await self._dm.generate_intro(
                adventure, party_members,
                location_name=location_name,
                nearby_places=nearby_names,
            )

        # Notify all party members with their dungeon state
        for pid in party.member_ids:
            conn = manager.get_connection_by_player(pid)
            if conn:
                dungeon = self._player_dungeons[pid]
                await manager.send_to(conn.id, GameMessage(
                    type=MessageType.GAME_EVENT,
                    payload={
                        "event": "adventure_started",
                        "adventure": adventure.model_dump(mode="json"),
                        "narrative": intro_narrative,
                        "dungeon": _dungeon_to_dict(dungeon),
                        "phase": GamePhase.EXPLORING.value,
                    }
                ))

        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": "The adventure begins!",
                "adventure_id": adventure.id,
            }
        )
    
    async def _handle_player_action(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Handle a player action during an adventure.
        
        Expected payload:
        {
            "action": "I search the room for hidden doors"
        }
        """
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You must connect first"}
            )
        
        player = self._players.get(player_id)
        
        # Find player's party and adventure
        party = None
        for p in self._parties.values():
            if player_id in p.member_ids:
                party = p
                break
        
        if not party or not party.current_adventure_id:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "You're not on an adventure"}
            )
        
        adventure = self._adventures.get(party.current_adventure_id)
        if not adventure:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "Adventure not found"}
            )
        
        action_text = message.payload.get("action", "").strip()
        if not action_text:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "No action provided"}
            )
        
        # Acquire per-adventure lock to prevent two narrators running simultaneously
        if adventure.id not in self._narrator_locks:
            self._narrator_locks[adventure.id] = asyncio.Lock()
        narrator_lock = self._narrator_locks[adventure.id]

        if narrator_lock.locked():
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": "The narrator is still speaking — please wait a moment before acting again."}
            )

        async with narrator_lock:
            # Process through AI DM
            if self._dm:
                party_members = [self._players[pid] for pid in party.member_ids if pid in self._players]
                response = await self._dm.process_action(adventure, player, party_members, action_text)
            else:
                response = f"[AI DM not available] {player.name} attempts to: {action_text}"

            adventure.last_activity = datetime.utcnow()

        # Check if the DM embedded a dice roll request
        if self._dm:
            roll_req = self._dm.extract_dice_request(response)
        else:
            roll_req = None

        if roll_req:
            setup = self._dm.strip_dice_tag(response)
            # Store pending roll so we can resolve it when the client sends the result
            self._pending_dice[player_id] = {
                "action": action_text,
                "setup_narrative": setup,
                "die": roll_req["die"],
                "stat": roll_req["stat"],
                "dc": roll_req["dc"],
                "party_id": party.id,
                "adventure_id": adventure.id,
            }
            # Send setup narrative + roll request to client
            await manager.broadcast_to_party(party.id, GameMessage(
                type=MessageType.DM_RESPONSE,
                payload={"player_name": player.name, "action": action_text, "narrative": setup},
            ))
            await manager.send_to(connection_id, GameMessage(
                type=MessageType.DICE_ROLL_REQUIRED,
                payload={
                    "die": roll_req["die"],
                    "stat": roll_req["stat"],
                    "dc": roll_req["dc"],
                    "player_id": player_id,
                },
            ))
        else:
            await manager.broadcast_to_party(party.id, GameMessage(
                type=MessageType.DM_RESPONSE,
                payload={
                    "player_name": player.name,
                    "action": action_text,
                    "narrative": response,
                    "game_day": self._current_game_day,
                    "game_hour": self._current_game_hour,
                },
            ))

        return None  # Response already broadcast
    
    async def _handle_dice_result(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager,
    ) -> GameMessage:
        """Player sends back their dice roll result; DM resolves the outcome."""
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not connected"})

        pending = self._pending_dice.pop(player_id, None)
        if not pending:
            return GameMessage(type=MessageType.ERROR, payload={"error": "No pending dice roll"})

        roll_total = int(message.payload.get("total", 10))
        raw_roll = int(message.payload.get("raw", roll_total))
        modifier = int(message.payload.get("modifier", 0))

        player = self._players.get(player_id)
        adventure = self._adventures.get(pending["adventure_id"])
        party = self._parties.get(pending["party_id"])

        if not adventure or not player or not party:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Adventure not found"})

        party_members = [self._players[pid] for pid in party.member_ids if pid in self._players]

        resolution = await self._dm.resolve_with_roll(
            adventure=adventure,
            acting_player=player,
            party=party_members,
            original_action=pending["action"],
            setup_narrative=pending["setup_narrative"],
            roll_total=roll_total,
            dc=pending["dc"],
            stat=pending["stat"],
            die=pending["die"],
        )

        success = roll_total >= pending["dc"]
        roll_summary = (
            f"🎲 {pending['die'].upper()} roll: {raw_roll}"
            + (f" + {modifier} ({pending['stat']})" if modifier != 0 else "")
            + f" = **{roll_total}** vs DC {pending['dc']} → {'✅ SUCCESS' if success else '❌ FAILURE'}"
        )

        await manager.broadcast_to_party(pending["party_id"], GameMessage(
            type=MessageType.DM_RESPONSE,
            payload={
                "player_name": player.name,
                "action": f"[Roll: {roll_summary}]",
                "narrative": resolution,
                "roll_summary": roll_summary,
                "roll_success": success,
            },
        ))
        return None

    # ============================================
    # Dungeon Movement
    # ============================================

    async def _handle_move(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Move player in a direction within the dungeon.

        Expected payload: { "direction": "north" | "south" | "east" | "west" }
        """
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not connected"})

        phase = self._player_phase.get(player_id, GamePhase.EXPLORING)
        if phase == GamePhase.COMBAT:
            return GameMessage(type=MessageType.ERROR, payload={"error": "You are in combat! Defeat or flee your enemies first."})
        if phase == GamePhase.GAME_OVER:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Game over."})
        if phase == GamePhase.VICTORY:
            return GameMessage(type=MessageType.ERROR, payload={"error": "You have already won!"})

        dungeon = self._player_dungeons.get(player_id)
        if not dungeon:
            return GameMessage(type=MessageType.ERROR, payload={"error": "No active dungeon"})

        direction = message.payload.get("direction", "").lower()
        if direction not in ("north", "south", "east", "west", "forward", "back"):
            return GameMessage(type=MessageType.ERROR, payload={"error": f"Invalid direction: {direction}"})

        current_room = dungeon.rooms.get(dungeon.current_room_id)
        if not current_room:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Current room not found"})

        target_room_id = current_room.exits.get(direction)
        if not target_room_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": f"No exit to the {direction}."})

        # Blocked if current room is not cleared
        if not current_room.cleared:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Defeat the enemies here before moving on!"})

        target_room = dungeon.rooms.get(target_room_id)
        if not target_room:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Target room not found"})

        # Move player (track previous for flee)
        dungeon.prev_room_id = dungeon.current_room_id
        dungeon.current_room_id = target_room_id
        target_room.explored = True

        # Get room description from AI DM or use default
        room_narrative = target_room.description
        if self._dm and not target_room.cleared:
            try:
                room_narrative = await self._dm.describe_room(target_room)
            except Exception:
                pass

        # Check for enemies -> enter combat
        living_enemies = [e for e in target_room.enemies if e.hp > 0]
        new_phase = GamePhase.EXPLORING

        if living_enemies:
            new_phase = GamePhase.COMBAT
            self._player_combat[player_id] = CombatState(
                enemies=living_enemies,
                player_turn=True,
                turn_number=1,
                log=[f"You enter {target_room.name}... enemies appear!"],
            )
            self._player_phase[player_id] = GamePhase.COMBAT
        elif not target_room.cleared:
            target_room.cleared = True
            dungeon.rooms_cleared += 1
            self._player_phase[player_id] = GamePhase.EXPLORING
        else:
            self._player_phase[player_id] = GamePhase.EXPLORING

        player = self._players.get(player_id)
        await manager.send_to(connection_id, GameMessage(
            type=MessageType.ROOM_ENTERED,
            payload={
                "room": target_room.model_dump(mode="json"),
                "narrative": room_narrative,
                "dungeon": _dungeon_to_dict(dungeon),
                "phase": new_phase.value,
                "player_stats": player.stats.model_dump() if player else {},
            }
        ))
        return None

    # ============================================
    # Combat System
    # ============================================

    async def _handle_combat_action(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """
        Process a combat action.

        Expected payload:
        {
            "action": "attack" | "skill" | "flee",
            "skill_name": "slash",       # if action == "skill"
            "item_id": "...",            # if action == "use_item"
        }
        """
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not connected"})

        phase = self._player_phase.get(player_id)
        if phase != GamePhase.COMBAT:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not in combat"})

        player = self._players.get(player_id)
        combat = self._player_combat.get(player_id)
        dungeon = self._player_dungeons.get(player_id)

        if not player or not combat or not dungeon:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Invalid game state"})

        action = message.payload.get("action", "attack")
        log: list[str] = []
        skill_name = message.payload.get("skill_name", "")

        # --- Player turn ---
        if combat.player_turn:
            if action == "flee":
                success = random.random() < 0.6
                if success:
                    log.append("You successfully flee the battle!")
                    self._player_phase[player_id] = GamePhase.EXPLORING
                    del self._player_combat[player_id]
                    # Move player back to previous room so they're not stuck
                    if dungeon.prev_room_id and dungeon.prev_room_id in dungeon.rooms:
                        dungeon.current_room_id = dungeon.prev_room_id
                        flee_room = dungeon.rooms[dungeon.prev_room_id]
                        flee_room.explored = True
                    else:
                        flee_room = dungeon.rooms.get(dungeon.current_room_id)
                    await manager.send_to(connection_id, GameMessage(
                        type=MessageType.COMBAT_UPDATE,
                        payload={
                            "log": log,
                            "phase": GamePhase.EXPLORING.value,
                            "player_stats": player.stats.model_dump(),
                            "combat": None,
                            "dungeon": _dungeon_to_dict(dungeon),
                            "room": flee_room.model_dump() if flee_room else None,
                        }
                    ))
                    return None
                else:
                    log.append("You try to flee but the enemies block your path!")

            elif action == "attack":
                dmg, msg = self._calc_player_attack(player, combat, bonus_mult=1.0)
                self._apply_damage_to_enemy(combat, 0, dmg)
                log.append(msg)

            elif action == "skill" and skill_name:
                result_log = self._apply_skill(player, combat, skill_name)
                log.extend(result_log)

            elif action == "use_item":
                item_id = message.payload.get("item_id", "")
                result_log = self._use_item_in_combat(player, item_id)
                log.extend(result_log)

            # Remove dead enemies
            combat.enemies = [e for e in combat.enemies if e.hp > 0]

            # Check win condition
            if not combat.enemies:
                return await self._resolve_combat_victory(
                    connection_id, player_id, player, combat, dungeon, manager, log
                )

            # Enemy turn
            combat.player_turn = False

        # --- Enemy turn(s) ---
        for enemy in combat.enemies:
            if enemy.stunned:
                log.append(f"{enemy.name} is stunned and cannot act!")
                enemy.stunned = False
                continue

            dmg, msg = self._calc_enemy_attack(enemy, player, combat)
            log.append(msg)
            player.stats.health = max(0, player.stats.health - dmg)

            if player.stats.health <= 0:
                log.append(f"You have been slain by {enemy.name}! Game over.")
                self._player_phase[player_id] = GamePhase.GAME_OVER
                await manager.send_to(connection_id, GameMessage(
                    type=MessageType.COMBAT_UPDATE,
                    payload={
                        "log": log,
                        "phase": GamePhase.GAME_OVER.value,
                        "player_stats": player.stats.model_dump(),
                        "combat": _combat_to_dict(combat),
                    }
                ))
                return None

        # Decrement buff timers
        if combat.player_buffed_turns > 0:
            combat.player_buffed_turns -= 1
            if combat.player_buffed_turns == 0:
                self._player_attack_buff[player_id] = 0
                log.append("Your attack buff fades.")
        if combat.player_shielded_turns > 0:
            combat.player_shielded_turns -= 1

        combat.player_turn = True
        combat.turn_number += 1
        combat.log.extend(log)

        await manager.send_to(connection_id, GameMessage(
            type=MessageType.COMBAT_UPDATE,
            payload={
                "log": log,
                "phase": GamePhase.COMBAT.value,
                "player_stats": player.stats.model_dump(),
                "combat": _combat_to_dict(combat),
            }
        ))
        return None

    def _calc_player_attack(self, player, combat: CombatState, bonus_mult: float = 1.0):
        """Calculate player attack damage and return (damage, log_message)."""
        base = player.stats.strength + random.randint(1, 6)
        buff = self._player_attack_buff.get(player.id, 0)
        dmg = max(1, int((base + buff) * bonus_mult))
        target = combat.enemies[0]
        final = max(1, dmg - target.defense)
        if combat.player_stealth:
            final = int(final * 3)
            combat.player_stealth = False
            msg = f"STEALTH STRIKE! You deal {final} damage to {target.name}!"
        else:
            msg = f"You attack {target.name} for {final} damage."
        return final, msg

    def _apply_damage_to_enemy(self, combat: CombatState, enemy_idx: int, dmg: int):
        if enemy_idx < len(combat.enemies):
            combat.enemies[enemy_idx].hp = max(0, combat.enemies[enemy_idx].hp - dmg)

    def _calc_enemy_attack(self, enemy: Enemy, player, combat: CombatState):
        """Calculate enemy attack and return (damage, log_message)."""
        base = enemy.attack + random.randint(1, 4)
        reduction = 1.0
        if combat.player_shielded_turns > 0:
            reduction = 0.5
        final = max(1, int(base * reduction))
        msg = f"{enemy.name} attacks you for {final} damage."
        if reduction < 1.0:
            msg += " (Shielded!)"
        return final, msg

    def _apply_skill(self, player, combat: CombatState, skill_name: str) -> list[str]:
        """Apply a skill effect, return log messages."""
        log = []
        skill = SKILL_DEFINITIONS.get(skill_name)
        if not skill:
            log.append(f"Unknown skill: {skill_name}")
            return log

        mp_cost = skill.get("mp_cost", 0)
        if player.stats.mana < mp_cost:
            log.append(f"Not enough MP! (Need {mp_cost}, have {player.stats.mana})")
            return log

        player.stats.mana = max(0, player.stats.mana - mp_cost)

        effect = skill.get("effect", "")
        mult = skill.get("damage_multiplier", 1.0)

        if effect == "heal":
            heal = int(player.stats.max_health * skill.get("heal_percent", 0.3))
            player.stats.health = min(player.stats.max_health, player.stats.health + heal)
            log.append(f"You cast {skill['name']} and restore {heal} HP.")
            return log

        if effect == "shield":
            combat.player_shielded_turns = 3
            log.append(f"You cast {skill['name']}! Damage reduced for 3 turns.")
            return log

        if effect == "buff_attack":
            buff = 4 if skill_name in ("battle_cry", "bless") else 3
            self._player_attack_buff[player.id] = buff
            combat.player_buffed_turns = 3
            log.append(f"You use {skill['name']}! Attack increased by {buff} for 3 turns.")
            return log

        if effect == "stealth":
            combat.player_stealth = True
            log.append(f"You enter stealth! Next attack will deal 3x damage.")
            return log

        if effect == "stun" and combat.enemies:
            target = combat.enemies[0]
            target.stunned = True
            dmg = max(1, int((player.stats.strength * mult) + random.randint(1, 4) - target.defense))
            if effect == "magic_damage":
                dmg = max(1, int(player.stats.intelligence * mult + random.randint(1, 6)))
            self._apply_damage_to_enemy(combat, 0, dmg)
            log.append(f"You use {skill['name']}! {target.name} is stunned and takes {dmg} damage.")
            return log

        # Standard / magic damage
        if mult > 0 and combat.enemies:
            target = combat.enemies[0]
            if effect == "magic_damage":
                dmg = max(1, int(player.stats.intelligence * mult + random.randint(1, 8)))
                log.append(f"You cast {skill['name']} at {target.name} for {dmg} magic damage!")
            else:
                base = player.stats.strength + self._player_attack_buff.get(player.id, 0)
                dmg = max(1, int((base + random.randint(1, 6)) * mult) - target.defense)
                log.append(f"You use {skill['name']}! You hit {target.name} for {dmg} damage.")
            self._apply_damage_to_enemy(combat, 0, dmg)

        return log

    def _use_item_in_combat(self, player, item_id: str) -> list[str]:
        """Use an item from inventory. Returns log messages."""
        log = []
        inv = player.inventory
        # Find item by name (inventory is list of strings)
        # Match by template name
        item_name = item_id  # item_id is actually the item name string

        if item_name not in inv:
            log.append(f"You don't have '{item_name}' in your inventory.")
            return log

        template = None
        for key, tmpl in {
            "health_potion": ITEM_TEMPLATES["health_potion"],
            "greater_health_potion": ITEM_TEMPLATES["greater_health_potion"],
            "mana_potion": ITEM_TEMPLATES["mana_potion"],
        }.items():
            if tmpl["name"] == item_name or key == item_name:
                template = tmpl
                item_name = key if key == item_name else item_name
                break

        if not template:
            # Try to find by template name match
            for key, tmpl in ITEM_TEMPLATES.items():
                if tmpl["name"].lower() == item_name.lower():
                    template = tmpl
                    break

        if not template:
            log.append(f"Cannot use '{item_name}'.")
            return log

        inv.remove(item_name) if item_name in inv else None

        val = template.get("effect_value", 0)
        item_type = template.get("item_type", "")

        if item_type == "consumable":
            if "mana" in template["name"].lower():
                player.stats.mana = min(player.stats.max_mana, player.stats.mana + val)
                log.append(f"You drink the {template['name']} and restore {val} MP.")
            else:
                restore = min(val, player.stats.max_health - player.stats.health)
                player.stats.health = min(player.stats.max_health, player.stats.health + val)
                log.append(f"You drink the {template['name']} and restore {restore} HP.")

        return log

    async def _resolve_combat_victory(
        self,
        connection_id: str,
        player_id: str,
        player,
        combat: CombatState,
        dungeon: DungeonState,
        manager: ConnectionManager,
        log: list[str]
    ) -> None:
        """Handle winning a combat."""
        current_room = dungeon.rooms.get(dungeon.current_room_id)

        # Award XP and gold
        total_xp = sum(e.xp_reward for e in combat.enemies) + sum(
            ENEMY_TEMPLATES.get(k, {}).get("xp_reward", 0)
            for k in []
        )
        # Recalculate from original enemies in room
        total_xp = sum(
            e.xp_reward for e in (current_room.enemies if current_room else [])
        )
        total_gold = sum(
            e.gold_reward for e in (current_room.enemies if current_room else [])
        )
        if current_room:
            total_gold += current_room.gold // 2

        player.stats.experience += total_xp
        player.stats.gold += total_gold
        log.append(f"Victory! You defeated all enemies. +{total_xp} XP, +{total_gold} gold.")

        # Mark room cleared
        if current_room:
            current_room.cleared = True
            dungeon.rooms_cleared += 1

        dungeon.gold_collected += total_gold

        # Check boss kill -> victory
        is_boss_room = current_room and current_room.room_type.value == "boss"
        if is_boss_room:
            new_phase = GamePhase.VICTORY
            log.append("You have slain the final boss! VICTORY! The dungeon is yours!")
        else:
            new_phase = GamePhase.EXPLORING
            log.append("The room is now safe. You may explore further or loot the room.")

        self._player_phase[player_id] = new_phase
        del self._player_combat[player_id]

        await manager.send_to(connection_id, GameMessage(
            type=MessageType.COMBAT_UPDATE,
            payload={
                "log": log,
                "phase": new_phase.value,
                "player_stats": player.stats.model_dump(),
                "combat": None,
                "dungeon": _dungeon_to_dict(dungeon),
                "xp_gained": total_xp,
                "gold_gained": total_gold,
            }
        ))

    # ============================================
    # Loot & Items
    # ============================================

    async def _handle_loot_room(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """Loot items from the current room."""
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not connected"})

        dungeon = self._player_dungeons.get(player_id)
        player = self._players.get(player_id)
        if not dungeon or not player:
            return GameMessage(type=MessageType.ERROR, payload={"error": "No active dungeon"})

        phase = self._player_phase.get(player_id)
        if phase == GamePhase.COMBAT:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Cannot loot during combat!"})

        room = dungeon.rooms.get(dungeon.current_room_id)
        if not room:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Room not found"})

        if not room.cleared:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Defeat the enemies first!"})

        looted: list[str] = []
        gold = room.gold

        for item in room.items:
            player.inventory.append(item.name)
            looted.append(item.name)

        room.items = []
        room.gold = 0
        dungeon.gold_collected += gold
        player.stats.gold += gold

        if not looted and gold == 0:
            msg = "Nothing left to loot here."
        else:
            parts = []
            if looted:
                parts.append(f"items: {', '.join(looted)}")
            if gold > 0:
                parts.append(f"{gold} gold")
            msg = "You loot: " + " and ".join(parts) + "!"

        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": msg,
                "looted_items": looted,
                "gold": gold,
                "player_stats": player.stats.model_dump(),
                "inventory": player.inventory,
                "dungeon": _dungeon_to_dict(dungeon),
            }
        )

    async def _handle_use_item(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """Use an item outside of combat."""
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not connected"})

        player = self._players.get(player_id)
        if not player:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Player not found"})

        item_name = message.payload.get("item_name", "")
        phase = self._player_phase.get(player_id, GamePhase.EXPLORING)
        if phase == GamePhase.COMBAT:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Use items in combat via combat actions."})

        if item_name not in player.inventory:
            return GameMessage(type=MessageType.ERROR, payload={"error": f"'{item_name}' not in inventory."})

        # Find template
        template = None
        for key, tmpl in ITEM_TEMPLATES.items():
            if tmpl["name"] == item_name or key == item_name:
                template = tmpl
                break

        if not template or template.get("item_type") != "consumable":
            return GameMessage(type=MessageType.ERROR, payload={"error": "That item cannot be used."})

        player.inventory.remove(item_name)
        val = template.get("effect_value", 0)

        if "mana" in template["name"].lower():
            player.stats.mana = min(player.stats.max_mana, player.stats.mana + val)
            msg = f"You drink the {template['name']} and restore {val} MP."
        else:
            restore = min(val, player.stats.max_health - player.stats.health)
            player.stats.health = min(player.stats.max_health, player.stats.health + val)
            msg = f"You drink the {template['name']} and restore {restore} HP."

        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": msg,
                "player_stats": player.stats.model_dump(),
                "inventory": player.inventory,
            }
        )

    async def _handle_tavern_visit(
        self,
        connection_id: str,
        message: GameMessage,
        manager: ConnectionManager
    ) -> GameMessage:
        """Spend gold at a real-world tavern to restore HP/MP."""
        player_id = self._connection_to_player.get(connection_id)
        if not player_id:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Not connected"})
        player = self._players.get(player_id)
        if not player:
            return GameMessage(type=MessageType.ERROR, payload={"error": "Player not found"})

        # Tavern services: cost, hp_restore, mp_restore, description
        SERVICES = {
            "ale":     {"cost": 10, "hp": 20,  "mp": 5,   "label": "Ale & Bread",      "emoji": "🍺"},
            "meal":    {"cost": 25, "hp": 45,  "mp": 15,  "label": "Hearty Meal",       "emoji": "🍖"},
            "elixir":  {"cost": 30, "hp": 10,  "mp": 45,  "label": "Mage's Elixir",     "emoji": "🔮"},
            "rest":    {"cost": 60, "hp": 999, "mp": 999, "label": "Full Night's Rest",  "emoji": "🛏"},
        }

        service_key = message.payload.get("service", "ale")
        tavern_name = message.payload.get("tavern_name", "The Tavern")
        svc = SERVICES.get(service_key, SERVICES["ale"])

        if player.stats.gold < svc["cost"]:
            return GameMessage(
                type=MessageType.ERROR,
                payload={"error": f"Not enough gold! {svc['label']} costs {svc['cost']}g (you have {player.stats.gold}g)"}
            )

        player.stats.gold -= svc["cost"]
        hp_gained = min(svc["hp"], player.stats.max_health - player.stats.health)
        mp_gained = min(svc["mp"], player.stats.max_mana - player.stats.mana)
        player.stats.health = min(player.stats.max_health, player.stats.health + svc["hp"])
        player.stats.mana   = min(player.stats.max_mana,   player.stats.mana   + svc["mp"])

        msg = (
            f"You visit {tavern_name} and order {svc['emoji']} {svc['label']} for {svc['cost']}g. "
            f"Restored +{hp_gained} HP and +{mp_gained} MP. "
            f"Remaining gold: {player.stats.gold}g."
        )

        return GameMessage(
            type=MessageType.SUCCESS,
            payload={
                "message": msg,
                "tavern_visited": tavern_name,
                "service": service_key,
                "hp_gained": hp_gained,
                "mp_gained": mp_gained,
                "gold_spent": svc["cost"],
                "player_stats": player.stats.model_dump(),
            }
        )

    # ============================================
    # Game Clock
    # ============================================

    async def run_game_clock(self) -> None:
        """
        Background task that advances the game clock.
        
        This is where time-based events would trigger.
        """
        logger.info("⏰ Game clock started")
        
        while self._running:
            await asyncio.sleep(GAME_TICK_SECONDS)
            
            if not self._running:
                break
            
            # Advance time
            self._current_game_hour += 1
            if self._current_game_hour >= 24:
                self._current_game_hour = 0
                self._current_game_day += 1
                logger.info(f"🌅 Day {self._current_game_day} begins")
            
            # TODO: Check for scheduled events
            # TODO: Trigger time-based world events
        
        logger.info("⏰ Game clock stopped")


# ============================================
# Serialization helpers
# ============================================

def _dungeon_to_dict(dungeon: DungeonState) -> dict:
    """Serialize DungeonState to a JSON-safe dict."""
    return {
        "current_room_id": dungeon.current_room_id,
        "total_rooms": dungeon.total_rooms,
        "rooms_cleared": dungeon.rooms_cleared,
        "gold_collected": dungeon.gold_collected,
        "rooms": {
            rid: room.model_dump(mode="json")
            for rid, room in dungeon.rooms.items()
        },
    }


def _combat_to_dict(combat: CombatState) -> dict:
    """Serialize CombatState to a JSON-safe dict."""
    return {
        "enemies": [e.model_dump(mode="json") for e in combat.enemies],
        "player_turn": combat.player_turn,
        "turn_number": combat.turn_number,
        "log": combat.log[-20:],
        "player_buffed_turns": combat.player_buffed_turns,
        "player_shielded_turns": combat.player_shielded_turns,
        "player_stealth": combat.player_stealth,
    }
