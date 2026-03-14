"""
Login Screen

The first screen players see - enter name and choose class.
"""

from textual.app import ComposeResult
from textual.containers import Container, Vertical, Horizontal, Center
from textual.screen import Screen
from textual.widgets import Button, Input, Label, Static, Select
from textual.binding import Binding
from rich.text import Text
from rich.panel import Panel

from shared.constants import LOGO, CLASS_ICONS


CLASS_DESCRIPTIONS = {
    "warrior": "⚔️  WARRIOR - Master of combat, high health, wields sword and shield",
    "mage": "🧙 MAGE - Wielder of arcane power, devastating spells, fragile body", 
    "rogue": "🗡️  ROGUE - Shadow dancer, critical strikes, cunning and quick",
    "cleric": "✝️  CLERIC - Divine healer, protective magic, smites the unholy",
    "ranger": "🏹 RANGER - Nature's ally, deadly aim, tracks any prey",
}


class LoginScreen(Screen):
    """
    Character creation and login screen.
    
    Features:
    - ASCII art logo
    - Name input
    - Class selection with descriptions
    - Connect button
    """
    
    CSS = """
    LoginScreen {
        align: center middle;
    }
    
    #login-container {
        width: 70;
        height: auto;
        border: solid $primary;
        padding: 1 2;
        background: $surface;
    }
    
    #logo-display {
        text-align: center;
        color: $primary;
        padding-bottom: 1;
    }
    
    #welcome-text {
        text-align: center;
        color: $text;
        padding: 1;
    }
    
    .form-label {
        padding: 1 0 0 0;
        color: $text-muted;
    }
    
    #name-input {
        margin: 0 0 1 0;
    }
    
    #class-select {
        margin: 0 0 1 0;
    }
    
    #class-description {
        color: $text-muted;
        text-align: center;
        padding: 1;
        height: 3;
    }
    
    #connect-btn {
        width: 100%;
        margin-top: 1;
    }
    
    #status-label {
        text-align: center;
        padding: 1;
        height: 2;
    }
    
    .error {
        color: $error;
    }
    
    .connecting {
        color: $warning;
    }
    """
    
    BINDINGS = [
        Binding("enter", "submit", "Connect", show=True),
    ]
    
    def __init__(self):
        super().__init__()
        self._selected_class = "warrior"
    
    def compose(self) -> ComposeResult:
        """Create the login form."""
        with Center():
            with Vertical(id="login-container"):
                # Logo
                yield Static(LOGO, id="logo-display")
                
                yield Static(
                    "Create your character and begin your adventure...",
                    id="welcome-text"
                )
                
                # Name input
                yield Label("Character Name:", classes="form-label")
                yield Input(
                    placeholder="Enter your name, adventurer...",
                    id="name-input"
                )
                
                # Class selection
                yield Label("Choose Your Class:", classes="form-label")
                yield Select(
                    [(desc, cls) for cls, desc in CLASS_DESCRIPTIONS.items()],
                    id="class-select",
                    value="warrior",
                )
                
                # Class description
                yield Static(
                    CLASS_DESCRIPTIONS["warrior"],
                    id="class-description"
                )
                
                # Connect button
                yield Button(
                    "⚔️  Begin Adventure  ⚔️",
                    id="connect-btn",
                    variant="primary"
                )
                
                # Status
                yield Static("", id="status-label")
    
    def on_mount(self) -> None:
        """Focus the name input when screen loads."""
        self.query_one("#name-input", Input).focus()
    
    def on_select_changed(self, event: Select.Changed) -> None:
        """Update class description when selection changes."""
        if event.select.id == "class-select":
            self._selected_class = event.value
            desc = CLASS_DESCRIPTIONS.get(event.value, "")
            self.query_one("#class-description", Static).update(desc)
    
    async def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle connect button press."""
        if event.button.id == "connect-btn":
            await self._attempt_login()
    
    def action_submit(self) -> None:
        """Handle enter key."""
        import asyncio
        asyncio.create_task(self._attempt_login())
    
    async def _attempt_login(self) -> None:
        """Attempt to connect and login."""
        name_input = self.query_one("#name-input", Input)
        status_label = self.query_one("#status-label", Static)
        
        name = name_input.value.strip()
        
        if not name:
            status_label.update("[bold red]Please enter a character name![/]")
            name_input.focus()
            return
        
        if len(name) < 2:
            status_label.update("[bold red]Name must be at least 2 characters![/]")
            name_input.focus()
            return
        
        if len(name) > 20:
            status_label.update("[bold red]Name must be 20 characters or less![/]")
            name_input.focus()
            return
        
        status_label.update("[yellow]Connecting to the realm...[/]")
        
        # Send connect message to server
        await self.app.send_message("connect", {
            "player_name": name,
            "player_class": self._selected_class,
        })
        
        status_label.update(f"[green]Welcome, {name} the {self._selected_class.title()}![/]")
