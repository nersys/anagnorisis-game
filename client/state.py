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
    
    def set_player(self, player_data: dict) -> None:
        """Update player state."""
        self.player = player_data
    
    def set_party(self, party_data: dict) -> None:
        """Update party state."""
        self.party = party_data
    
    def set_adventure(self, adventure_data: dict) -> None:
        """Update adventure state."""
        self.adventure = adventure_data
    
    def add_message(self, msg_type: str, content: str, sender: str = "DM") -> None:
        """Add a message to history."""
        self.messages.append({
            "type": msg_type,
            "content": content,
            "sender": sender,
            "timestamp": datetime.now().isoformat(),
        })
        
        # Trim old messages
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]
    
    def clear(self) -> None:
        """Reset all state."""
        self.player = None
        self.party = None
        self.party_members = []
        self.adventure = None
        self.messages = []
    
    @property
    def player_name(self) -> str:
        """Get player name or default."""
        if self.player:
            return self.player.get("name", "Adventurer")
        return "Adventurer"
    
    @property
    def player_class(self) -> str:
        """Get player class or default."""
        if self.player:
            return self.player.get("player_class", "unknown")
        return "unknown"
    
    @property
    def is_in_party(self) -> bool:
        """Whether player is in a party."""
        return self.party is not None
    
    @property
    def is_in_adventure(self) -> bool:
        """Whether player is in an active adventure."""
        return self.adventure is not None
    
    @property
    def is_party_leader(self) -> bool:
        """Whether current player is party leader."""
        if not self.party or not self.player:
            return False
        return self.party.get("leader_id") == self.player.get("id")
    
    def get_time_string(self) -> str:
        """Get formatted game time."""
        hour = self.game_hour
        period = "AM" if hour < 12 else "PM"
        display_hour = hour if hour <= 12 else hour - 12
        if display_hour == 0:
            display_hour = 12
        return f"Day {self.game_day}, {display_hour}:00 {period}"
