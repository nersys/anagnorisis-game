"""
WebSocket Connection Manager

============================================
DDIA CONCEPT: Connection Pooling & State
============================================
Managing many simultaneous connections requires:

1. Tracking: Who is connected? What's their state?
2. Routing: Send message X to player Y
3. Broadcasting: Send event to all players in party Z
4. Cleanup: Handle disconnections gracefully

This is a simplified version. In production, you'd consider:
- Redis for shared state across multiple server instances
- Connection heartbeats to detect zombie connections
- Rate limiting to prevent abuse
============================================
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import uuid

from fastapi import WebSocket

from shared.models import GameMessage

logger = logging.getLogger("anagnorisis.connections")


@dataclass
class Connection:
    """Represents a single WebSocket connection with metadata."""
    id: str
    websocket: WebSocket
    connected_at: datetime = field(default_factory=datetime.utcnow)
    player_id: Optional[str] = None
    party_id: Optional[str] = None
    last_heartbeat: datetime = field(default_factory=datetime.utcnow)


class ConnectionManager:
    """
    Manages all WebSocket connections to the server.
    
    Think of this as a phone switchboard operator:
    - Knows who's on the line
    - Can route calls (messages) to specific people
    - Can broadcast announcements to groups
    """
    
    def __init__(self):
        # Map of connection_id -> Connection
        self._connections: dict[str, Connection] = {}
        
        # Reverse lookup: player_id -> connection_id
        self._player_to_connection: dict[str, str] = {}
    
    @property
    def active_connection_count(self) -> int:
        """Number of active connections."""
        return len(self._connections)
    
    async def connect(self, websocket: WebSocket) -> str:
        """
        Accept a new WebSocket connection.
        
        Returns the unique connection ID.
        """
        await websocket.accept()
        
        # Generate unique connection ID
        connection_id = str(uuid.uuid4())[:8]
        
        # Store the connection
        self._connections[connection_id] = Connection(
            id=connection_id,
            websocket=websocket,
        )
        
        logger.debug(f"Connection {connection_id} established. Total: {self.active_connection_count}")
        return connection_id
    
    async def disconnect(self, connection_id: str) -> None:
        """
        Clean up a disconnected connection.
        """
        if connection_id not in self._connections:
            return
        
        connection = self._connections[connection_id]
        
        # Remove from player lookup if they were logged in
        if connection.player_id:
            self._player_to_connection.pop(connection.player_id, None)
        
        # Remove the connection
        del self._connections[connection_id]
        
        logger.debug(f"Connection {connection_id} removed. Total: {self.active_connection_count}")
    
    def associate_player(self, connection_id: str, player_id: str) -> None:
        """
        Associate a player ID with a connection.
        Called when a player logs in.
        """
        if connection_id in self._connections:
            self._connections[connection_id].player_id = player_id
            self._player_to_connection[player_id] = connection_id
            logger.debug(f"Player {player_id} associated with connection {connection_id}")
    
    def associate_party(self, connection_id: str, party_id: str) -> None:
        """Associate a connection with a party."""
        if connection_id in self._connections:
            self._connections[connection_id].party_id = party_id

    def clear_party(self, connection_id: str) -> None:
        """Clear any party association for a connection."""
        if connection_id in self._connections:
            self._connections[connection_id].party_id = None
    
    def get_connection(self, connection_id: str) -> Optional[Connection]:
        """Get connection by ID."""
        return self._connections.get(connection_id)
    
    def get_connection_by_player(self, player_id: str) -> Optional[Connection]:
        """Get connection by player ID."""
        connection_id = self._player_to_connection.get(player_id)
        if connection_id:
            return self._connections.get(connection_id)
        return None
    
    def get_party_connections(self, party_id: str) -> list[Connection]:
        """Get all connections in a party."""
        return [
            conn for conn in self._connections.values()
            if conn.party_id == party_id
        ]
    
    async def send_to(self, connection_id: str, message: GameMessage) -> bool:
        """
        Send a message to a specific connection.
        
        Returns True if successful, False otherwise.
        """
        connection = self._connections.get(connection_id)
        if not connection:
            logger.warning(f"Attempted to send to unknown connection: {connection_id}")
            return False
        
        try:
            await connection.websocket.send_json(message.model_dump(mode="json"))
            return True
        except Exception as e:
            logger.error(f"Failed to send to {connection_id}: {e}")
            return False
    
    async def send_to_player(self, player_id: str, message: GameMessage) -> bool:
        """Send a message to a specific player."""
        connection = self.get_connection_by_player(player_id)
        if connection:
            return await self.send_to(connection.id, message)
        return False
    
    async def broadcast_to_party(self, party_id: str, message: GameMessage, exclude: Optional[str] = None) -> int:
        """
        Broadcast a message to all players in a party.
        
        Args:
            party_id: The party to broadcast to
            message: The message to send
            exclude: Optional connection_id to exclude (e.g., the sender)
        
        Returns the number of successful sends.
        """
        connections = self.get_party_connections(party_id)
        successful = 0
        
        for conn in connections:
            if exclude and conn.id == exclude:
                continue
            if await self.send_to(conn.id, message):
                successful += 1
        
        return successful
    
    async def broadcast_all(self, message: GameMessage) -> int:
        """
        Broadcast a message to ALL connected clients.
        Use sparingly (e.g., server shutdown notices).
        """
        successful = 0
        for connection_id in self._connections:
            if await self.send_to(connection_id, message):
                successful += 1
        return successful
    
    def update_heartbeat(self, connection_id: str) -> None:
        """Update the last heartbeat time for a connection."""
        if connection_id in self._connections:
            self._connections[connection_id].last_heartbeat = datetime.utcnow()
