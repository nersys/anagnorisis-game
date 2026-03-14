"""
Anagnorisis TUI Client

============================================
DDIA CONCEPT: Client-Side State Management
============================================
The client maintains its own view of the game state:
- Optimistic updates: Show actions immediately, reconcile with server
- Local caching: Store recent messages for display
- Reconnection: Handle network interruptions gracefully

We use Textual, a modern TUI framework that provides:
- Rich widget library (buttons, inputs, tables)
- CSS-like styling
- Reactive data binding
- Async support (perfect for WebSockets)
============================================
"""

import asyncio
import logging
import os
import sys

from dotenv import load_dotenv
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    Label,
    ListItem,
    ListView,
    Static,
    TabbedContent,
    TabPane,
)
from textual.screen import Screen
from rich.text import Text
from rich.panel import Panel

from client.websocket_client import WebSocketClient
from client.screens.login_screen import LoginScreen
from client.screens.lobby_screen import LobbyScreen
from client.screens.game_screen import GameScreen
from client.state import ClientGameState
from shared.constants import LOGO

# Load environment
load_dotenv()

# Configure logging to FILE instead of stdout (so it doesn't mess up TUI)
log_file = os.path.join(os.path.dirname(__file__), '..', 'client.log')
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") == "true" else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    filename=log_file,
    filemode='w',
)
logger = logging.getLogger("anagnorisis.client")


class AnagnorisisApp(App):
    """
    The main Anagnorisis TUI application.
    
    Screens:
    1. Login: Enter name and choose class
    2. Lobby: Create/join parties
    3. Game: The main adventure interface
    """
    
    TITLE = "⚔️ Anagnorisis ⚔️"
    SUB_TITLE = "The Moment of Truth"
    
    CSS = """
    Screen {
        background: $surface;
    }
    
    #logo {
        width: 100%;
        height: auto;
        content-align: center middle;
        text-align: center;
        color: $primary;
        padding: 1;
    }
    
    .title {
        text-align: center;
        text-style: bold;
        color: $primary;
        padding: 1;
    }
    
    .subtitle {
        text-align: center;
        color: $text-muted;
    }
    
    .panel {
        border: solid $primary;
        padding: 1;
        margin: 1;
    }
    
    .error {
        color: $error;
        text-align: center;
        padding: 1;
    }
    
    .success {
        color: $success;
        text-align: center;
        padding: 1;
    }
    
    Button {
        margin: 1;
    }
    
    Button.primary {
        background: $primary;
    }
    
    Input {
        margin: 1;
    }
    
    #connection-status {
        dock: bottom;
        height: 1;
        background: $surface-darken-1;
        text-align: center;
    }
    
    .connected {
        color: $success;
    }
    
    .disconnected {
        color: $error;
    }
    """
    
    BINDINGS = [
        Binding("q", "quit", "Quit", priority=True),
        Binding("escape", "back", "Back"),
        Binding("?", "help", "Help"),
    ]
    
    def __init__(self):
        super().__init__()
        self.ws_client: WebSocketClient = None
        self.game_state = ClientGameState()
        self._server_url = os.getenv("SERVER_URL", "ws://localhost:8000/ws")
    
    def compose(self) -> ComposeResult:
        """Create the initial UI."""
        yield Header(show_clock=True)
        yield Footer()
    
    async def on_mount(self) -> None:
        """Called when the app is mounted."""
        # Initialize WebSocket client
        self.ws_client = WebSocketClient(
            url=self._server_url,
            on_message=self._handle_server_message,
            on_connect=self._handle_connect,
            on_disconnect=self._handle_disconnect,
        )
        
        # Start connection attempt
        asyncio.create_task(self._connect_to_server())
        
        # Show login screen
        await self.push_screen(LoginScreen())
    
    async def _connect_to_server(self) -> None:
        """Attempt to connect to the game server."""
        logger.info(f"Connecting to {self._server_url}...")
        try:
            await self.ws_client.connect()
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            self.notify(f"Connection failed: {e}", severity="error")
    
    async def _handle_connect(self) -> None:
        """Called when WebSocket connects."""
        logger.info("Connected to server!")
        self.notify("Connected to server!", severity="information")
        self.game_state.connected = True
    
    async def _handle_disconnect(self) -> None:
        """Called when WebSocket disconnects."""
        logger.warning("Disconnected from server")
        self.notify("Disconnected from server", severity="warning")
        self.game_state.connected = False
    
    async def _handle_server_message(self, message: dict) -> None:
        """Handle incoming messages from the server."""
        logger.debug(f"Received: {message}")
        
        msg_type = message.get("type")
        payload = message.get("payload", {})
        
        # Update game state based on message
        current_screen = self.screen

        if msg_type == "success":
            if isinstance(current_screen, GameScreen):
                # Forward success messages (loot, item use, etc.) to game screen
                await current_screen.handle_game_message(message)
            elif "player" in payload:
                self.game_state.set_player(payload["player"])
                await self.switch_screen(LobbyScreen())
            elif "party" in payload:
                self.game_state.set_party(payload["party"])

        elif msg_type in (
            "dm_response", "game_event",
            "room_entered", "combat_update",
            "dungeon_state",
        ):
            if isinstance(current_screen, GameScreen):
                await current_screen.handle_game_message(message)
            elif msg_type == "game_event" and payload.get("event") == "adventure_started":
                # Switch to game screen on adventure start
                await self.switch_screen(GameScreen())
                new_screen = self.screen
                if isinstance(new_screen, GameScreen):
                    await new_screen.handle_game_message(message)

        elif msg_type == "error":
            self.notify(payload.get("error", "Unknown error"), severity="error")
    
    async def send_message(self, msg_type: str, payload: dict) -> None:
        """Send a message to the server."""
        if self.ws_client and self.ws_client.connected:
            await self.ws_client.send({
                "type": msg_type,
                "payload": payload,
            })
        else:
            self.notify("Not connected to server", severity="error")
    
    def action_quit(self) -> None:
        """Quit the application."""
        self.exit()
    
    def action_back(self) -> None:
        """Go back to previous screen."""
        if len(self.screen_stack) > 1:
            self.pop_screen()
    
    def action_help(self) -> None:
        """Show help."""
        self.notify("Press Q to quit, ESC to go back", severity="information")


def main():
    """Entry point for the TUI client."""
    # Don't print to stdout - it interferes with TUI
    app = AnagnorisisApp()
    app.run()


if __name__ == "__main__":
    main()