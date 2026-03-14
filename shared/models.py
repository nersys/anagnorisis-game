"""
Shared message models for client-server communication.

============================================
DDIA CONCEPT: Data Serialization
============================================
When two processes communicate (client ↔ server), they need a common
language for data. Options include:

1. JSON: Human-readable, widely supported, but verbose
2. Protocol Buffers: Binary, fast, requires schema compilation
3. MessagePack: Binary JSON, good middle ground

We use JSON via Pydantic because:
- Easy to debug (you can read the messages)
- Pydantic gives us validation for free
- Perfect for MVP; optimize later if needed
============================================
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
import uuid


def generate_id() -> str:
    """Generate a unique ID for messages and entities."""
    return str(uuid.uuid4())[:8]


# ============================================
# Message Types (Client ↔ Server Protocol)
# ============================================

class MessageType(str, Enum):
    """All possible message types in our protocol."""

    # Connection
    CONNECT = "connect"
    DISCONNECT = "disconnect"
    HEARTBEAT = "heartbeat"

    # Lobby
    CREATE_PARTY = "create_party"
    JOIN_PARTY = "join_party"
    LEAVE_PARTY = "leave_party"
    LIST_PARTIES = "list_parties"

    # Game
    START_ADVENTURE = "start_adventure"
    PLAYER_ACTION = "player_action"
    DM_RESPONSE = "dm_response"
    GAME_EVENT = "game_event"

    # Dungeon & Combat (new interactive game messages)
    MOVE = "move"
    COMBAT_ACTION = "combat_action"
    LOOT_ROOM = "loot_room"
    USE_ITEM = "use_item"
    DUNGEON_STATE = "dungeon_state"
    COMBAT_UPDATE = "combat_update"
    ROOM_ENTERED = "room_entered"

    # System
    ERROR = "error"
    SUCCESS = "success"
    STATE_UPDATE = "state_update"


class GameMessage(BaseModel):
    """
    Base message format for all client-server communication.
    
    Every message has:
    - id: Unique identifier (for tracking responses)
    - type: What kind of message this is
    - timestamp: When it was created
    - payload: The actual data
    """
    id: str = Field(default_factory=generate_id)
    type: MessageType
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    payload: dict[str, Any] = Field(default_factory=dict)
    
    class Config:
        use_enum_values = True


# ============================================
# Player & Party Models
# ============================================

class PlayerClass(str, Enum):
    """Available player classes."""
    WARRIOR = "warrior"
    MAGE = "mage"
    ROGUE = "rogue"
    CLERIC = "cleric"
    RANGER = "ranger"


class PlayerStats(BaseModel):
    """Core player statistics."""
    health: int = 100
    max_health: int = 100
    mana: int = 50
    max_mana: int = 50
    strength: int = 10
    intelligence: int = 10
    dexterity: int = 10
    charisma: int = 10
    level: int = 1
    experience: int = 0


class Player(BaseModel):
    """A player in the game."""
    id: str = Field(default_factory=generate_id)
    name: str
    player_class: PlayerClass
    stats: PlayerStats = Field(default_factory=PlayerStats)
    inventory: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PartyStatus(str, Enum):
    """Party lifecycle states."""
    LOBBY = "lobby"          # Waiting for players
    IN_ADVENTURE = "in_adventure"  # Currently playing
    COMPLETED = "completed"   # Adventure finished


class Party(BaseModel):
    """A group of players adventuring together."""
    id: str = Field(default_factory=generate_id)
    name: str
    leader_id: str
    member_ids: list[str] = Field(default_factory=list)
    max_members: int = 4
    status: PartyStatus = PartyStatus.LOBBY
    current_adventure_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================
# Adventure & Mission Models  
# ============================================

class AdventureMode(str, Enum):
    """How the AI DM behaves."""
    FREEFORM = "freeform"        # AI improvises everything
    STRUCTURED = "structured"    # AI follows game rules strictly
    GUIDED = "guided"           # Mix of both


class Adventure(BaseModel):
    """An adventure that a party undertakes."""
    id: str = Field(default_factory=generate_id)
    name: str
    description: str
    mode: AdventureMode = AdventureMode.GUIDED
    party_id: str
    current_mission_index: int = 0
    missions: list[str] = Field(default_factory=list)  # Mission IDs
    game_day: int = 1  # Internal game clock
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity: datetime = Field(default_factory=datetime.utcnow)


# ============================================
# Game Events (Time-based triggers)
# ============================================

class GameEventType(str, Enum):
    """Types of scheduled events."""
    WORLD_EVENT = "world_event"      # Something happens in the world
    NPC_ACTION = "npc_action"        # An NPC does something
    QUEST_UPDATE = "quest_update"    # Quest state changes
    ENVIRONMENT = "environment"      # Weather, time of day, etc.


class ScheduledEvent(BaseModel):
    """An event that triggers at a specific game time."""
    id: str = Field(default_factory=generate_id)
    event_type: GameEventType
    trigger_game_day: int
    trigger_game_hour: int = 0
    description: str
    payload: dict[str, Any] = Field(default_factory=dict)
    triggered: bool = False
    adventure_id: str


# ============================================
# Client State (What the client knows)
# ============================================

class ClientState(BaseModel):
    """
    The game state as known to a specific client.

    This is what we send to update the client's view.
    """
    player: Optional[Player] = None
    party: Optional[Party] = None
    adventure: Optional[Adventure] = None
    other_players: list[Player] = Field(default_factory=list)
    recent_messages: list[str] = Field(default_factory=list)  # Last N DM messages
    available_actions: list[str] = Field(default_factory=list)


# ============================================
# Dungeon & Combat Models (Interactive Game)
# ============================================

class GamePhase(str, Enum):
    """Current phase of gameplay."""
    EXPLORING = "exploring"
    COMBAT = "combat"
    LOOTING = "looting"
    RESTING = "resting"
    GAME_OVER = "game_over"
    VICTORY = "victory"


class ItemType(str, Enum):
    CONSUMABLE = "consumable"
    WEAPON = "weapon"
    ARMOR = "armor"
    KEY = "key"


class Item(BaseModel):
    id: str = Field(default_factory=generate_id)
    name: str
    item_type: ItemType
    description: str
    effect_value: int = 0   # HP restore amount, damage bonus, etc.
    emoji: str = "📦"


class Enemy(BaseModel):
    id: str = Field(default_factory=generate_id)
    name: str
    emoji: str = "👹"
    hp: int
    max_hp: int
    attack: int
    defense: int
    xp_reward: int
    gold_reward: int
    is_boss: bool = False
    stunned: bool = False  # Misses next attack if True


class RoomType(str, Enum):
    START = "start"
    CORRIDOR = "corridor"
    CHAMBER = "chamber"
    TREASURE = "treasure"
    BOSS = "boss"


class Room(BaseModel):
    id: str = Field(default_factory=generate_id)
    x: int
    y: int
    room_type: RoomType
    name: str = ""
    description: str = ""
    exits: dict[str, str] = Field(default_factory=dict)  # direction -> room_id
    enemies: list[Enemy] = Field(default_factory=list)
    items: list[Item] = Field(default_factory=list)
    explored: bool = False
    cleared: bool = False   # True when no living enemies remain
    gold: int = 0


class DungeonState(BaseModel):
    rooms: dict[str, Room] = Field(default_factory=dict)
    current_room_id: str = ""
    total_rooms: int = 0
    rooms_cleared: int = 0
    gold_collected: int = 0


class CombatState(BaseModel):
    enemies: list[Enemy] = Field(default_factory=list)
    player_turn: bool = True
    turn_number: int = 0
    log: list[str] = Field(default_factory=list)
    player_buffed_turns: int = 0    # Turns of active buff (e.g. Battle Cry)
    player_shielded_turns: int = 0  # Turns of active shield
    player_stealth: bool = False    # Rogue stealth - next hit does 3x damage
