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
)
from shared.constants import (
    CLASS_BASE_STATS,
    CLASS_STARTING_SKILLS,
    CLASS_STARTING_INVENTORY,
    GAME_TICK_SECONDS,
)
from server.connection_manager import ConnectionManager
from server.ai_dungeon_master import AIDungeonMaster

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
        
        # Get intro from AI DM if available
        intro_narrative = "Your adventure begins..."
        if self._dm:
            party_members = [self._players[pid] for pid in party.member_ids if pid in self._players]
            intro_narrative = await self._dm.generate_intro(adventure, party_members)
        
        # Notify all party members
        adventure_start = GameMessage(
            type=MessageType.GAME_EVENT,
            payload={
                "event": "adventure_started",
                "adventure": adventure.model_dump(mode="json"),
                "narrative": intro_narrative,
            }
        )
        await manager.broadcast_to_party(party.id, adventure_start)
        
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
        
        # Process through AI DM
        if self._dm:
            party_members = [self._players[pid] for pid in party.member_ids if pid in self._players]
            response = await self._dm.process_action(adventure, player, party_members, action_text)
        else:
            response = f"[AI DM not available] {player.name} attempts to: {action_text}"
        
        # Update last activity
        adventure.last_activity = datetime.utcnow()
        
        # Broadcast the action and response to the party
        action_event = GameMessage(
            type=MessageType.DM_RESPONSE,
            payload={
                "player_name": player.name,
                "action": action_text,
                "narrative": response,
                "game_day": self._current_game_day,
                "game_hour": self._current_game_hour,
            }
        )
        await manager.broadcast_to_party(party.id, action_event)
        
        return None  # Response already broadcast
    
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
