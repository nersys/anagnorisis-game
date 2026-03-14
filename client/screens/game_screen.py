"""
Game Screen

The main adventure interface with narrative, stats, and action input.
"""

from textual.app import ComposeResult
from textual.containers import Container, Vertical, Horizontal, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Button, Input, Label, Static, ProgressBar, RichLog
from textual.binding import Binding
from rich.text import Text
from rich.panel import Panel
from rich.markdown import Markdown
from datetime import datetime


class GameScreen(Screen):
    """
    Main game interface.
    
    Layout:
    ┌─────────────────────────────────────────────┐
    │  Header: Adventure name, Game time          │
    ├───────────────────────────┬─────────────────┤
    │                           │  Player Stats   │
    │    Narrative Display      │  HP/MP bars     │
    │    (scrollable)           │  Party members  │
    │                           │  Inventory      │
    ├───────────────────────────┴─────────────────┤
    │  > Action Input                             │
    └─────────────────────────────────────────────┘
    """
    
    CSS = """
    GameScreen {
        layout: grid;
        grid-size: 1 3;
        grid-rows: 3 1fr 4;
    }
    
    #game-header {
        border-bottom: solid $primary;
        padding: 0 1;
        background: $surface-darken-1;
    }
    
    #header-content {
        width: 100%;
    }
    
    #adventure-title {
        text-style: bold;
        color: $primary;
    }
    
    #game-time {
        text-align: right;
        color: $text-muted;
    }
    
    #main-content {
        layout: grid;
        grid-size: 2 1;
        grid-columns: 2fr 1fr;
    }
    
    #narrative-panel {
        border: solid $primary;
        margin: 0 1 0 0;
        padding: 1;
    }
    
    #narrative-log {
        scrollbar-gutter: stable;
    }
    
    #stats-panel {
        border: solid $secondary;
        padding: 1;
    }
    
    .stats-section {
        margin-bottom: 1;
    }
    
    .stats-title {
        text-style: bold;
        color: $secondary;
        border-bottom: solid $secondary;
        margin-bottom: 1;
    }
    
    #hp-bar {
        color: $error;
        margin: 0 0 1 0;
    }
    
    #mp-bar {
        color: $primary;
        margin: 0 0 1 0;
    }
    
    #input-area {
        border-top: solid $primary;
        padding: 1;
        height: 4;
    }
    
    #action-input {
        width: 100%;
    }
    
    #input-hint {
        color: $text-muted;
        text-align: center;
    }
    
    .dm-message {
        margin: 1 0;
        padding: 1;
        border-left: solid $warning;
    }
    
    .player-message {
        margin: 1 0;
        padding: 1;
        border-left: solid $primary;
        color: $text-muted;
    }
    
    .event-message {
        margin: 1 0;
        padding: 1;
        border-left: solid $success;
        background: $surface-darken-1;
    }
    """
    
    BINDINGS = [
        Binding("enter", "submit_action", "Submit", show=False),
        Binding("i", "show_inventory", "Inventory"),
        Binding("p", "show_party", "Party"),
        Binding("escape", "back", "Menu"),
    ]
    
    def compose(self) -> ComposeResult:
        """Create the game interface."""
        # Header
        with Horizontal(id="game-header"):
            with Horizontal(id="header-content"):
                yield Static("⚔️ Adventure", id="adventure-title")
                yield Static("Day 1, 8:00 AM", id="game-time")
        
        # Main content area
        with Horizontal(id="main-content"):
            # Narrative panel (left)
            with Vertical(id="narrative-panel"):
                yield RichLog(
                    id="narrative-log",
                    highlight=True,
                    markup=True,
                    wrap=True,
                )
            
            # Stats panel (right)
            with Vertical(id="stats-panel"):
                # Player stats
                with Vertical(classes="stats-section"):
                    yield Static("📊 STATS", classes="stats-title")
                    yield Static("HP:", id="hp-label")
                    yield ProgressBar(id="hp-bar", total=100, show_eta=False)
                    yield Static("MP:", id="mp-label")
                    yield ProgressBar(id="mp-bar", total=100, show_eta=False)
                
                # Character info
                with Vertical(classes="stats-section"):
                    yield Static("🎭 CHARACTER", classes="stats-title")
                    yield Static(id="char-info")
                
                # Party
                with Vertical(classes="stats-section"):
                    yield Static("👥 PARTY", classes="stats-title")
                    yield Static(id="party-info")
                
                # Quick actions
                with Vertical(classes="stats-section"):
                    yield Static("⚡ SKILLS", classes="stats-title")
                    yield Static(id="skills-info")
        
        # Action input area
        with Vertical(id="input-area"):
            yield Static(
                "What do you do? (Type your action and press Enter)",
                id="input-hint"
            )
            yield Input(
                placeholder="I search the room for hidden passages...",
                id="action-input"
            )
    
    def on_mount(self) -> None:
        """Initialize the game screen."""
        self._update_header()
        self._update_stats()
        self._add_welcome_message()
        self.query_one("#action-input", Input).focus()
    
    def _update_header(self) -> None:
        """Update the header with adventure info."""
        state = self.app.game_state
        
        title = self.query_one("#adventure-title", Static)
        time_display = self.query_one("#game-time", Static)
        
        if state.adventure:
            title.update(f"⚔️ {state.adventure.get('name', 'Adventure')}")
        
        time_display.update(state.get_time_string())
    
    def _update_stats(self) -> None:
        """Update the stats panel."""
        state = self.app.game_state
        
        if state.player:
            stats = state.player.get("stats", {})
            
            # HP bar
            hp = stats.get("health", 100)
            max_hp = stats.get("max_health", 100)
            hp_bar = self.query_one("#hp-bar", ProgressBar)
            hp_bar.update(total=max_hp, progress=hp)
            self.query_one("#hp-label", Static).update(f"HP: {hp}/{max_hp}")
            
            # MP bar
            mp = stats.get("mana", 50)
            max_mp = stats.get("max_mana", 50)
            mp_bar = self.query_one("#mp-bar", ProgressBar)
            mp_bar.update(total=max_mp, progress=mp)
            self.query_one("#mp-label", Static).update(f"MP: {mp}/{max_mp}")
            
            # Character info
            char_info = self.query_one("#char-info", Static)
            char_info.update(
                f"{state.player_name}\n"
                f"{state.player_class.title()} Lv.{stats.get('level', 1)}\n"
                f"STR: {stats.get('strength', 10)} INT: {stats.get('intelligence', 10)}\n"
                f"DEX: {stats.get('dexterity', 10)} CHA: {stats.get('charisma', 10)}"
            )
            
            # Skills
            skills = state.player.get("skills", [])[:4]
            skills_info = self.query_one("#skills-info", Static)
            skills_info.update("\n".join(f"• {s.replace('_', ' ').title()}" for s in skills))
        
        # Party info
        if state.party:
            party = state.party
            party_info = self.query_one("#party-info", Static)
            member_count = len(party.get("member_ids", []))
            party_info.update(
                f"{party.get('name', 'Party')}\n"
                f"Members: {member_count}"
            )
    
    def _add_welcome_message(self) -> None:
        """Add welcome message to narrative log."""
        log = self.query_one("#narrative-log", RichLog)
        state = self.app.game_state
        
        log.write(Panel(
            f"[bold yellow]Welcome, {state.player_name}![/]\n\n"
            "Your adventure begins. Type your actions below and press Enter.\n"
            "The Dungeon Master awaits your commands...",
            title="⚔️ Anagnorisis ⚔️",
            border_style="yellow"
        ))
    
    async def handle_game_message(self, message: dict) -> None:
        """Handle incoming game messages from server."""
        log = self.query_one("#narrative-log", RichLog)
        msg_type = message.get("type")
        payload = message.get("payload", {})
        
        if msg_type == "dm_response":
            # Player action + DM response
            player_name = payload.get("player_name", "Someone")
            action = payload.get("action", "")
            narrative = payload.get("narrative", "")
            
            # Show player action
            log.write(f"\n[bold cyan]{player_name}:[/] [italic]\"{action}\"[/]")
            
            # Show DM response
            log.write(Panel(
                narrative,
                title="🎭 Dungeon Master",
                border_style="yellow"
            ))
            
            # Update game time
            if "game_day" in payload:
                self.app.game_state.game_day = payload["game_day"]
            if "game_hour" in payload:
                self.app.game_state.game_hour = payload["game_hour"]
            self._update_header()
            
        elif msg_type == "game_event":
            event = payload.get("event", "")
            
            if event == "adventure_started":
                narrative = payload.get("narrative", "")
                log.write(Panel(
                    narrative,
                    title="📜 The Adventure Begins",
                    border_style="green"
                ))
                
                if "adventure" in payload:
                    self.app.game_state.set_adventure(payload["adventure"])
                    self._update_header()
                    
            elif event == "player_joined":
                player_name = payload.get("player_name", "Someone")
                player_class = payload.get("player_class", "adventurer")
                log.write(f"\n[green]✦ {player_name} the {player_class.title()} has joined the party![/]")
                
            else:
                # Generic event
                log.write(Panel(
                    str(payload),
                    title=f"📣 {event.replace('_', ' ').title()}",
                    border_style="blue"
                ))
    
    async def _submit_action(self) -> None:
        """Submit the player's action."""
        input_widget = self.query_one("#action-input", Input)
        action = input_widget.value.strip()
        
        if not action:
            return
        
        # Clear input
        input_widget.value = ""
        
        # Send to server
        await self.app.send_message("player_action", {
            "action": action
        })
    
    async def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle input submission."""
        if event.input.id == "action-input":
            await self._submit_action()
    
    def action_submit_action(self) -> None:
        """Handle enter key for action submission."""
        import asyncio
        asyncio.create_task(self._submit_action())
    
    def action_show_inventory(self) -> None:
        """Show inventory (placeholder)."""
        log = self.query_one("#narrative-log", RichLog)
        state = self.app.game_state
        
        if state.player:
            items = state.player.get("inventory", [])
            items_str = "\n".join(f"• {item.replace('_', ' ').title()}" for item in items)
            log.write(Panel(
                items_str or "Your pack is empty.",
                title="🎒 Inventory",
                border_style="cyan"
            ))
    
    def action_show_party(self) -> None:
        """Show party info (placeholder)."""
        log = self.query_one("#narrative-log", RichLog)
        state = self.app.game_state
        
        if state.party:
            party = state.party
            log.write(Panel(
                f"Party: {party.get('name', 'Unknown')}\n"
                f"Members: {len(party.get('member_ids', []))}/{party.get('max_members', 4)}",
                title="👥 Party",
                border_style="magenta"
            ))
