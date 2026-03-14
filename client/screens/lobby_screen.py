"""
Lobby Screen

Party creation and management before adventures.
"""

from textual.app import ComposeResult
from textual.containers import Container, Vertical, Horizontal, Center, Grid
from textual.screen import Screen
from textual.widgets import Button, Input, Label, Static, ListView, ListItem, DataTable
from textual.binding import Binding
from rich.text import Text
from rich.panel import Panel


class LobbyScreen(Screen):
    """
    Party lobby screen.
    
    Features:
    - Create new party
    - View available parties
    - Join existing party
    - Start adventure (if leader)
    """
    
    CSS = """
    LobbyScreen {
        layout: grid;
        grid-size: 2 1;
        grid-columns: 1fr 1fr;
    }
    
    #left-panel {
        border: solid $primary;
        margin: 1;
        padding: 1;
    }
    
    #right-panel {
        border: solid $secondary;
        margin: 1;
        padding: 1;
    }
    
    .panel-title {
        text-align: center;
        text-style: bold;
        color: $primary;
        padding: 1;
        border-bottom: solid $primary;
        margin-bottom: 1;
    }
    
    #player-info {
        padding: 1;
        margin-bottom: 1;
        border: dashed $text-muted;
    }
    
    #party-name-input {
        margin: 1 0;
    }
    
    .action-btn {
        width: 100%;
        margin: 1 0;
    }
    
    #parties-table {
        height: 15;
        margin: 1 0;
    }
    
    #party-status {
        padding: 1;
        text-align: center;
    }
    
    #party-members {
        height: 10;
        border: solid $text-muted;
        padding: 1;
    }
    
    #start-adventure-section {
        margin-top: 1;
        padding: 1;
        border: double $success;
    }
    
    #adventure-name-input {
        margin: 1 0;
    }
    """
    
    BINDINGS = [
        Binding("r", "refresh", "Refresh Parties"),
        Binding("c", "create", "Create Party"),
        Binding("s", "start", "Start Adventure"),
    ]
    
    def compose(self) -> ComposeResult:
        """Create the lobby layout."""
        # Left panel - Party creation and list
        with Vertical(id="left-panel"):
            yield Static("🏰 PARTY HALL 🏰", classes="panel-title")
            
            # Player info
            yield Static(id="player-info")
            
            # Create party section
            yield Label("Create a New Party:")
            yield Input(
                placeholder="Party name...",
                id="party-name-input"
            )
            yield Button(
                "⚔️ Create Party",
                id="create-party-btn",
                classes="action-btn",
                variant="primary"
            )
            
            # Available parties
            yield Label("Available Parties:")
            yield DataTable(id="parties-table")
            yield Button(
                "🔄 Refresh List",
                id="refresh-btn",
                classes="action-btn"
            )
        
        # Right panel - Current party
        with Vertical(id="right-panel"):
            yield Static("🎭 YOUR PARTY 🎭", classes="panel-title")
            
            yield Static(id="party-status")
            yield Static("Members:", classes="form-label")
            yield ListView(id="party-members")
            
            # Start adventure section (only visible to leader)
            with Vertical(id="start-adventure-section"):
                yield Label("Ready to embark?")
                yield Input(
                    placeholder="Adventure name...",
                    id="adventure-name-input",
                    value="A New Beginning"
                )
                yield Button(
                    "🗺️ Start Adventure!",
                    id="start-adventure-btn",
                    classes="action-btn",
                    variant="success"
                )
            
            yield Button(
                "🚪 Leave Party",
                id="leave-party-btn",
                classes="action-btn",
                variant="error"
            )
    
    def on_mount(self) -> None:
        """Initialize the screen."""
        self._update_player_info()
        self._setup_parties_table()
        self._update_party_display()
        
        # Request party list
        import asyncio
        asyncio.create_task(self._refresh_parties())
    
    def _update_player_info(self) -> None:
        """Update player info display."""
        state = self.app.game_state
        info = self.query_one("#player-info", Static)
        
        if state.player:
            player = state.player
            info.update(
                f"[bold]{player.get('name', 'Unknown')}[/]\n"
                f"Class: {player.get('player_class', 'unknown').title()}\n"
                f"Level: {player.get('stats', {}).get('level', 1)}"
            )
        else:
            info.update("Not logged in")
    
    def _setup_parties_table(self) -> None:
        """Setup the parties data table."""
        table = self.query_one("#parties-table", DataTable)
        table.add_columns("ID", "Name", "Leader", "Players", "")
        table.cursor_type = "row"
    
    def _update_party_display(self) -> None:
        """Update current party display."""
        state = self.app.game_state
        status = self.query_one("#party-status", Static)
        members_list = self.query_one("#party-members", ListView)
        start_section = self.query_one("#start-adventure-section")
        leave_btn = self.query_one("#leave-party-btn")
        
        members_list.clear()
        
        if state.party:
            party = state.party
            status.update(
                f"[bold green]Party: {party.get('name', 'Unknown')}[/]\n"
                f"ID: {party.get('id', 'N/A')} (share with friends!)"
            )
            
            # Show members
            member_ids = party.get("member_ids", [])
            for i, member_id in enumerate(member_ids):
                is_leader = member_id == party.get("leader_id")
                prefix = "👑 " if is_leader else "   "
                # For now just show IDs, we'd need member details from server
                members_list.append(ListItem(Label(f"{prefix}Player {member_id[:8]}")))
            
            # Show/hide start button based on leadership
            start_section.display = state.is_party_leader
            leave_btn.display = True
        else:
            status.update("[dim]You're not in a party yet.[/]\nCreate one or join an existing party!")
            start_section.display = False
            leave_btn.display = False
    
    async def _refresh_parties(self) -> None:
        """Refresh the list of available parties."""
        await self.app.send_message("list_parties", {})
    
    async def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        button_id = event.button.id
        
        if button_id == "create-party-btn":
            await self._create_party()
        elif button_id == "refresh-btn":
            await self._refresh_parties()
        elif button_id == "leave-party-btn":
            await self._leave_party()
        elif button_id == "start-adventure-btn":
            await self._start_adventure()
    
    async def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """Handle party selection in table."""
        table = self.query_one("#parties-table", DataTable)
        row_key = event.row_key
        
        if row_key:
            # Get party ID from first column
            party_id = table.get_cell(row_key, "ID")
            await self._join_party(str(party_id))
    
    async def _create_party(self) -> None:
        """Create a new party."""
        name_input = self.query_one("#party-name-input", Input)
        name = name_input.value.strip() or f"{self.app.game_state.player_name}'s Party"
        
        await self.app.send_message("create_party", {
            "party_name": name,
        })
        
        name_input.value = ""
        self._update_party_display()
    
    async def _join_party(self, party_id: str) -> None:
        """Join an existing party."""
        await self.app.send_message("join_party", {
            "party_id": party_id,
        })
        self._update_party_display()
    
    async def _leave_party(self) -> None:
        """Leave current party."""
        await self.app.send_message("leave_party", {})
        self.app.game_state.party = None
        self._update_party_display()
    
    async def _start_adventure(self) -> None:
        """Start an adventure with the party."""
        name_input = self.query_one("#adventure-name-input", Input)
        adventure_name = name_input.value.strip() or "A New Beginning"
        
        await self.app.send_message("start_adventure", {
            "adventure_name": adventure_name,
            "description": "An adventure awaits...",
            "mode": "guided",
        })
        
        # Switch to game screen
        from client.screens.game_screen import GameScreen
        await self.app.switch_screen(GameScreen())
    
    def action_refresh(self) -> None:
        """Refresh parties action."""
        import asyncio
        asyncio.create_task(self._refresh_parties())
    
    def action_create(self) -> None:
        """Create party action."""
        self.query_one("#party-name-input", Input).focus()
    
    def action_start(self) -> None:
        """Start adventure action."""
        import asyncio
        asyncio.create_task(self._start_adventure())
