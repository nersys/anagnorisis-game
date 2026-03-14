"""
WebSocket Client

Handles the WebSocket connection to the game server.
"""

import asyncio
import json
import logging
from typing import Callable, Optional

import websockets
from websockets.client import WebSocketClientProtocol

logger = logging.getLogger("anagnorisis.ws")


class WebSocketClient:
    """
    WebSocket client for server communication.
    
    Handles:
    - Connection management
    - Auto-reconnection
    - Message serialization
    - Heartbeat/keepalive
    """
    
    def __init__(
        self,
        url: str,
        on_message: Callable,
        on_connect: Optional[Callable] = None,
        on_disconnect: Optional[Callable] = None,
        reconnect_interval: float = 5.0,
    ):
        self.url = url
        self._on_message = on_message
        self._on_connect = on_connect
        self._on_disconnect = on_disconnect
        self._reconnect_interval = reconnect_interval
        
        self._ws: Optional[WebSocketClientProtocol] = None
        self._connected = False
        self._should_reconnect = True
        self._receive_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
    
    @property
    def connected(self) -> bool:
        """Whether we're currently connected."""
        return self._connected and self._ws is not None
    
    async def connect(self) -> None:
        """Establish connection to the server."""
        while self._should_reconnect:
            try:
                logger.info(f"Connecting to {self.url}...")
                self._ws = await websockets.connect(self.url)
                self._connected = True
                
                logger.info("Connected!")
                
                if self._on_connect:
                    await self._on_connect()
                
                # Start receive loop
                self._receive_task = asyncio.create_task(self._receive_loop())
                
                # Start heartbeat
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                
                # Wait for connection to close
                await self._receive_task
                
            except websockets.ConnectionClosed as e:
                logger.warning(f"Connection closed: {e}")
            except Exception as e:
                logger.error(f"Connection error: {e}")
            
            self._connected = False
            
            if self._on_disconnect:
                await self._on_disconnect()
            
            if self._should_reconnect:
                logger.info(f"Reconnecting in {self._reconnect_interval}s...")
                await asyncio.sleep(self._reconnect_interval)
    
    async def disconnect(self) -> None:
        """Close the connection."""
        self._should_reconnect = False
        self._connected = False
        
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        
        if self._ws:
            await self._ws.close()
    
    async def send(self, message: dict) -> bool:
        """
        Send a message to the server.
        
        Returns True if sent successfully.
        """
        if not self.connected:
            logger.warning("Cannot send: not connected")
            return False
        
        try:
            data = json.dumps(message)
            await self._ws.send(data)
            logger.debug(f"Sent: {message.get('type')}")
            return True
        except Exception as e:
            logger.error(f"Send error: {e}")
            return False
    
    async def _receive_loop(self) -> None:
        """Continuously receive messages from the server."""
        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)
                    await self._on_message(data)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON received: {e}")
        except websockets.ConnectionClosed:
            logger.info("Receive loop ended: connection closed")
        except Exception as e:
            logger.error(f"Receive loop error: {e}")
    
    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to keep connection alive."""
        try:
            while self.connected:
                await asyncio.sleep(30)  # Heartbeat every 30 seconds
                if self.connected:
                    await self.send({"type": "heartbeat", "payload": {}})
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Heartbeat error: {e}")
