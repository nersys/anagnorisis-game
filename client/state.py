"""
Client-side Game State

Manages the local view of game state for the TUI.
"""

from dataclasses import dataclass, field
from typing import Optional, Any
from datetime import datetime


@dataclass
class ClientGameState:
    """
    The client's view of the game world.

    This is kept in sync with the server via WebSocket messages.
    """

    # Connection state
    connected: bool = False
    connection_id: Optional[str] = None

    # Player state
    player: Optional[dict] = None

    # Party state
    party: Optional[dict] = None
    party_members: list[dict] = field(default_factory=list)

    # Adventure state
    adventure: Optional[dict] = None

    # Game time
    game_day: int = 1
    game_hour: int = 8

    # Message history (for display)
    messages: list[dict] = field(default_factory=list)
    max_messages: int = 100

    # ---- Interactive dungeon state ----
    # Full dungeon dict (from server)
    dungeon: Optional[dict] = None
    # Current room dict
    current_room: Optional[dict] = None
    # Current game phase string: "exploring" | "combat" | "looting" | "game_over" | "victory"
    game_phase: str = "exploring"
    # Current combat state dict (from server)
    combat: Optional[dict] = None
    # Combat log lines for display
    combat_log: list[str] = field(default_factory=list)

    def set_player(self, player_data: dict) -> None:
        """Update player state."""
        self.player = player_data

    def set_party(self, party_data: dict) -> None:
        """Update party state."""
        self.party = party_data

    def set_adventure(self, adventure_data: dict) -> None:
        """Update adventure state."""
        self.adventure = adventure_data

    def set_dungeon(self, dungeon_data: dict) -> None:
        """Update dungeon state and current room."""
        self.dungeon = dungeon_data
        if dungeon_data:
            room_id = dungeon_data.get("current_room_id", "")
            self.current_room = dungeon_data.get("rooms", {}).get(room_id)

    def set_phase(self, phase: str) -> None:
        self.game_phase = phase

    def set_combat(self, combat_data: Optional[dict]) -> None:
        self.combat = combat_data

    def append_combat_log(self, lines: list[str]) -> None:
        self.combat_log.extend(lines)
        if len(self.combat_log) > 200:
            self.combat_log = self.combat_log[-200:]

    def add_message(self, msg_type: str, content: str, sender: str = "DM") -> None:
        """Add a message to history."""
        self.messages.append({
            "type": msg_type,
            "content": content,
            "sender": sender,
            "timestamp": datetime.now().isoformat(),
        })
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]

    def clear(self) -> None:
        """Reset all state."""
        self.player = None
        self.party = None
        self.party_members = []
        self.adventure = None
        self.messages = []
        self.dungeon = None
        self.current_room = None
        self.game_phase = "exploring"
        self.combat = None
        self.combat_log = []

    @property
    def player_name(self) -> str:
        if self.player:
            return self.player.get("name", "Adventurer")
        return "Adventurer"

    @property
    def player_class(self) -> str:
        if self.player:
            return self.player.get("player_class", "unknown")
        return "unknown"

    @property
    def player_stats(self) -> dict:
        if self.player:
            return self.player.get("stats", {})
        return {}

    @property
    def player_inventory(self) -> list[str]:
        if self.player:
            return self.player.get("inventory", [])
        return []

    @property
    def player_skills(self) -> list[str]:
        if self.player:
            return self.player.get("skills", [])
        return []

    @property
    def is_in_party(self) -> bool:
        return self.party is not None

    @property
    def is_in_adventure(self) -> bool:
        return self.adventure is not None

    @property
    def is_party_leader(self) -> bool:
        if not self.party or not self.player:
            return False
        return self.party.get("leader_id") == self.player.get("id")

    @property
    def is_in_combat(self) -> bool:
        return self.game_phase == "combat"

    @property
    def is_exploring(self) -> bool:
        return self.game_phase == "exploring"

    def get_time_string(self) -> str:
        hour = self.game_hour
        period = "AM" if hour < 12 else "PM"
        display_hour = hour if hour <= 12 else hour - 12
        if display_hour == 0:
            display_hour = 12
        return f"Day {self.game_day}, {display_hour}:00 {period}"

    def get_available_exits(self) -> list[str]:
        """Return list of available exit directions from current room."""
        if self.current_room:
            return list(self.current_room.get("exits", {}).keys())
        return []

    def get_living_enemies(self) -> list[dict]:
        """Return living enemies from current combat."""
        if self.combat:
            return [e for e in self.combat.get("enemies", []) if e.get("hp", 0) > 0]
        return []
