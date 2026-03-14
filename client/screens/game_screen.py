"""
Game Screen - Interactive Dungeon Crawler

Replaces the chat-based interface with a proper dungeon crawler:

┌─────────────────────────────────────────────────────────────┐
│  Adventure Name  │  PHASE  │  Day 1 8:00 AM                │
├──────────────────┬──────────────────────────────────────────┤
│  DUNGEON MAP     │                                          │
│                  │  Room description / Event log            │
│  [grid of rooms] │  (scrollable)                           │
│                  │                                          │
│                  ├──────────────────────────────────────────┤
│  STATS           │  HP: ████░░  80/100                     │
│  Level 1 Warrior │  MP: ██████  60/80                      │
│  STR:14  DEX:10  │  Gold: 50    XP: 120                    │
└──────────────────┴──────────────────────────────────────────┤
│  EXPLORING: [N]North  [S]South  [E]East  [W]West  [L]Loot  │
│  COMBAT:    [A]Attack  [1]Skill1  [2]Skill2  [I]Item  [F]Flee│
└─────────────────────────────────────────────────────────────┘
"""

import asyncio
from textual.app import ComposeResult
from textual.containers import Container, Vertical, Horizontal, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Button, Label, Static, ProgressBar, RichLog, Footer
from textual.binding import Binding
from rich.text import Text
from rich.panel import Panel

from shared.constants import CLASS_ICONS, SKILL_DEFINITIONS


# Direction keys mapping
DIRECTION_KEYS = {
    "up":    "north",
    "down":  "south",
    "right": "east",
    "left":  "west",
    "w":     "north",
    "s":     "south",
    "d":     "east",
    "a":     "west",
}

# Room type characters for minimap
ROOM_CHARS = {
    "start":    "S",
    "corridor": "·",
    "chamber":  "C",
    "treasure": "T",
    "boss":     "B",
}

ROOM_COLORS = {
    "start":    "green",
    "corridor": "white",
    "chamber":  "red",
    "treasure": "yellow",
    "boss":     "bright_red",
}


class GameScreen(Screen):
    """Interactive dungeon crawler game screen."""

    CSS = """
    GameScreen {
        layout: grid;
        grid-size: 1 3;
        grid-rows: 3 1fr 6;
    }

    #game-header {
        border-bottom: solid $primary;
        padding: 0 1;
        background: $surface-darken-1;
        height: 3;
        layout: horizontal;
    }

    #adventure-title {
        text-style: bold;
        color: $primary;
        width: 2fr;
    }

    #phase-indicator {
        text-style: bold;
        text-align: center;
        width: 1fr;
    }

    #game-time {
        text-align: right;
        color: $text-muted;
        width: 1fr;
    }

    #main-content {
        layout: grid;
        grid-size: 2 1;
        grid-columns: 26 1fr;
    }

    #left-panel {
        border-right: solid $primary;
        padding: 1;
    }

    #map-title {
        text-style: bold;
        color: $secondary;
        text-align: center;
        margin-bottom: 1;
    }

    #dungeon-map {
        height: 12;
        color: $text;
    }

    #stats-divider {
        border-top: solid $primary;
        margin: 1 0;
        height: 1;
    }

    #stats-section {
        margin-top: 1;
    }

    #hp-label {
        color: $error;
    }

    #hp-bar {
        color: $error;
        margin: 0 0 1 0;
    }

    #mp-label {
        color: $primary;
    }

    #mp-bar {
        color: $primary;
        margin: 0 0 1 0;
    }

    #char-summary {
        color: $text-muted;
        margin-top: 1;
    }

    #right-panel {
        layout: grid;
        grid-size: 1 2;
        grid-rows: 1fr 5;
    }

    #event-log-container {
        border-bottom: solid $primary;
        padding: 1;
    }

    #event-log {
        scrollbar-gutter: stable;
    }

    #inventory-strip {
        padding: 0 1;
        height: 5;
        background: $surface-darken-1;
    }

    #inventory-title {
        text-style: bold;
        color: $secondary;
    }

    #inventory-items {
        color: $text-muted;
    }

    /* Bottom action bar */
    #action-bar {
        border-top: solid $primary;
        padding: 1;
        height: 6;
        background: $surface-darken-2;
    }

    #action-hint {
        text-align: center;
        color: $text-muted;
        height: 1;
        margin-bottom: 1;
    }

    #action-buttons {
        layout: horizontal;
        height: 3;
        align: center middle;
    }

    .direction-btn {
        min-width: 10;
        margin: 0 1;
    }

    .combat-btn {
        min-width: 12;
        margin: 0 1;
    }

    .combat-btn.primary-action {
        background: $error;
    }

    .combat-btn.skill-action {
        background: $primary;
    }

    .combat-btn.flee-action {
        background: $warning;
    }

    .item-btn {
        background: $success;
        min-width: 12;
        margin: 0 1;
    }

    #game-over-banner {
        text-align: center;
        color: $error;
        text-style: bold;
    }

    #victory-banner {
        text-align: center;
        color: $success;
        text-style: bold;
    }
    """

    BINDINGS = [
        # Movement
        Binding("up",    "move('north')", "North", show=False),
        Binding("down",  "move('south')", "South", show=False),
        Binding("left",  "move('west')",  "West",  show=False),
        Binding("right", "move('east')",  "East",  show=False),
        Binding("w", "move('north')", "North", show=False),
        Binding("s", "move('south')", "South", show=False),
        Binding("a", "move('west')",  "West",  show=False),
        Binding("d", "move('east')",  "East",  show=False),
        # Exploration
        Binding("l", "loot_room",  "Loot", show=False),
        # Combat
        Binding("f", "flee",       "Flee", show=False),
        # Items
        Binding("i", "show_inventory", "Inventory", show=False),
        Binding("escape", "back", "Menu", show=False),
    ]

    def compose(self) -> ComposeResult:
        # Header
        with Horizontal(id="game-header"):
            yield Static("⚔️  Adventure", id="adventure-title")
            yield Static("[ EXPLORING ]", id="phase-indicator")
            yield Static("Day 1, 8:00 AM", id="game-time")

        # Main content
        with Horizontal(id="main-content"):
            # Left: map + stats
            with Vertical(id="left-panel"):
                yield Static("DUNGEON MAP", id="map-title")
                yield Static("", id="dungeon-map")
                yield Static("─" * 22, id="stats-divider")
                with Vertical(id="stats-section"):
                    yield Static("HP:", id="hp-label")
                    yield ProgressBar(id="hp-bar", total=100, show_eta=False)
                    yield Static("MP:", id="mp-label")
                    yield ProgressBar(id="mp-bar", total=100, show_eta=False)
                    yield Static("", id="char-summary")

            # Right: event log + inventory strip
            with Vertical(id="right-panel"):
                with ScrollableContainer(id="event-log-container"):
                    yield RichLog(id="event-log", highlight=True, markup=True, wrap=True)
                with Vertical(id="inventory-strip"):
                    yield Static("INVENTORY", id="inventory-title")
                    yield Static("Empty pack", id="inventory-items")

        # Bottom action bar
        with Vertical(id="action-bar"):
            yield Static("", id="action-hint")
            with Horizontal(id="action-buttons"):
                # Exploration buttons (shown when exploring)
                yield Button("▲ North", id="btn-north", classes="direction-btn", variant="default")
                yield Button("▼ South", id="btn-south", classes="direction-btn", variant="default")
                yield Button("◄ West",  id="btn-west",  classes="direction-btn", variant="default")
                yield Button("► East",  id="btn-east",  classes="direction-btn", variant="default")
                yield Button("L Loot",  id="btn-loot",  classes="direction-btn", variant="success")
                # Combat buttons (hidden when exploring)
                yield Button("⚔ Attack",  id="btn-attack",  classes="combat-btn primary-action", variant="error")
                yield Button("✦ Skill 1", id="btn-skill1",  classes="combat-btn skill-action",   variant="primary")
                yield Button("✦ Skill 2", id="btn-skill2",  classes="combat-btn skill-action",   variant="primary")
                yield Button("🧪 Item",   id="btn-item",     classes="item-btn",                  variant="success")
                yield Button("↩ Flee",    id="btn-flee",     classes="combat-btn flee-action",    variant="warning")

    def on_mount(self) -> None:
        self._update_header()
        self._update_stats()
        self._update_map()
        self._update_inventory()
        self._update_action_bar()
        self._show_welcome()

    # ────────────────────────────────────────────
    # UI update helpers
    # ────────────────────────────────────────────

    def _update_header(self) -> None:
        state = self.app.game_state
        title = self.query_one("#adventure-title", Static)
        phase_lbl = self.query_one("#phase-indicator", Static)
        time_lbl = self.query_one("#game-time", Static)

        if state.adventure:
            title.update(f"⚔️  {state.adventure.get('name', 'Adventure')}")

        phase = state.game_phase
        phase_styles = {
            "exploring": ("[green][ EXPLORING ][/green]", "green"),
            "combat":    ("[red bold][ COMBAT ][/red bold]", "red"),
            "looting":   ("[yellow][ LOOTING ][/yellow]", "yellow"),
            "game_over": ("[red bold][ GAME OVER ][/red bold]", "red"),
            "victory":   ("[green bold][ VICTORY! ][/green bold]", "green"),
        }
        phase_lbl.update(phase_styles.get(phase, (f"[ {phase.upper()} ]", "white"))[0])
        time_lbl.update(state.get_time_string())

    def _update_stats(self) -> None:
        state = self.app.game_state
        stats = state.player_stats

        hp = stats.get("health", 100)
        max_hp = stats.get("max_health", 100)
        mp = stats.get("mana", 50)
        max_mp = stats.get("max_mana", 50)
        level = stats.get("level", 1)
        xp = stats.get("experience", 0)
        strength = stats.get("strength", 10)
        dex = stats.get("dexterity", 10)

        hp_bar = self.query_one("#hp-bar", ProgressBar)
        hp_bar.update(total=max_hp, progress=hp)
        self.query_one("#hp-label", Static).update(f"HP: {hp}/{max_hp}")

        mp_bar = self.query_one("#mp-bar", ProgressBar)
        mp_bar.update(total=max_mp, progress=mp)
        self.query_one("#mp-label", Static).update(f"MP: {mp}/{max_mp}")

        icon = CLASS_ICONS.get(state.player_class, "⚔️")
        gold = state.dungeon.get("gold_collected", 0) if state.dungeon else 0
        self.query_one("#char-summary", Static).update(
            f"{icon} {state.player_name}\n"
            f"Lv.{level} {state.player_class.title()}\n"
            f"STR:{strength}  DEX:{dex}\n"
            f"XP:{xp}  Gold:{gold}"
        )

    def _update_map(self) -> None:
        state = self.app.game_state
        dungeon = state.dungeon
        if not dungeon:
            self.query_one("#dungeon-map", Static).update("[ No dungeon loaded ]")
            return

        rooms = dungeon.get("rooms", {})
        current_id = dungeon.get("current_room_id", "")

        # Find grid bounds
        xs = [r["x"] for r in rooms.values()]
        ys = [r["y"] for r in rooms.values()]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        # Build a position -> room map
        pos_map: dict[tuple, dict] = {}
        for room in rooms.values():
            pos_map[(room["x"], room["y"])] = room

        lines: list[str] = []
        for y in range(min_y, max_y + 1):
            row_top = ""
            row_mid = ""
            for x in range(min_x, max_x + 1):
                room = pos_map.get((x, y))
                if room is None:
                    row_top += "    "
                    row_mid += "    "
                    continue

                is_current = room["id"] == current_id
                explored = room.get("explored", False)
                cleared = room.get("cleared", False)
                rtype = room.get("room_type", "corridor")

                if explored:
                    char = ROOM_CHARS.get(rtype, "?")
                    has_enemies = any(e.get("hp", 0) > 0 for e in room.get("enemies", []))
                    has_items = bool(room.get("items")) or room.get("gold", 0) > 0
                    if has_enemies:
                        char = "!"
                    elif has_items:
                        char = "$"
                else:
                    char = "?"

                if is_current:
                    cell = f"[@]"
                elif explored:
                    cell = f"[{char}]"
                else:
                    cell = "[?]"

                # East connection
                east_id = room.get("exits", {}).get("east")
                east_conn = "─" if east_id else " "
                row_mid += cell + east_conn

                # South connection
                south_id = room.get("exits", {}).get("south")
                south_conn = " │  " if south_id else "    "
                row_top += south_conn if y > min_y else "    "

            if y > min_y:
                lines.append(row_top)
            lines.append(row_mid)

        legend = "\n[@]=You  [!]=Enemy  [$]=Loot\n[S]=Start  [B]=Boss  [?]=Unknown"
        map_text = "\n".join(lines) + legend
        self.query_one("#dungeon-map", Static).update(map_text)

    def _update_inventory(self) -> None:
        state = self.app.game_state
        inv = state.player_inventory
        skills = state.player_skills

        if inv:
            items_str = "  ".join(f"[{i+1}]{name[:8]}" for i, name in enumerate(inv[:6]))
        else:
            items_str = "Pack is empty"

        skill_str = ""
        if skills:
            skill_names = []
            for s in skills[:3]:
                sdef = SKILL_DEFINITIONS.get(s, {})
                skill_names.append(f"{sdef.get('emoji','✦')} {sdef.get('name', s)[:10]}")
            skill_str = "  |  Skills: " + "  ".join(skill_names)

        self.query_one("#inventory-items", Static).update(items_str + skill_str)

    def _update_action_bar(self) -> None:
        state = self.app.game_state
        phase = state.game_phase

        # Show/hide button groups based on phase
        explore_ids = ["btn-north", "btn-south", "btn-west", "btn-east", "btn-loot"]
        combat_ids  = ["btn-attack", "btn-skill1", "btn-skill2", "btn-item", "btn-flee"]

        for btn_id in explore_ids:
            btn = self.query_one(f"#{btn_id}", Button)
            btn.display = (phase == "exploring")

        for btn_id in combat_ids:
            btn = self.query_one(f"#{btn_id}", Button)
            btn.display = (phase == "combat")

        # Dim direction buttons for unavailable exits
        if phase == "exploring":
            exits = state.get_available_exits()
            dir_map = {"north": "btn-north", "south": "btn-south", "west": "btn-west", "east": "btn-east"}
            for direction, btn_id in dir_map.items():
                btn = self.query_one(f"#{btn_id}", Button)
                btn.disabled = direction not in exits

        # Update skill button labels
        if phase == "combat":
            skills = state.player_skills
            for i, btn_id in enumerate(["btn-skill1", "btn-skill2"]):
                btn = self.query_one(f"#{btn_id}", Button)
                if i < len(skills):
                    sdef = SKILL_DEFINITIONS.get(skills[i], {})
                    cost = sdef.get("mp_cost", 0)
                    btn.label = f"{sdef.get('emoji','✦')} {sdef.get('name', skills[i])[:8]} ({cost}mp)"
                    btn.disabled = False
                else:
                    btn.label = "No skill"
                    btn.disabled = True

        # Hint text
        hint = self.query_one("#action-hint", Static)
        if phase == "exploring":
            exits = state.get_available_exits()
            exit_str = "  ".join(f"[{d[0].upper()}]{d.title()}" for d in exits)
            hint.update(f"Move: Arrow keys / WASD  |  {exit_str}  |  [L] Loot room")
        elif phase == "combat":
            enemies = state.get_living_enemies()
            enemy_str = ", ".join(f"{e.get('emoji','')} {e.get('name','')} HP:{e.get('hp',0)}/{e.get('max_hp',0)}" for e in enemies)
            hint.update(f"ENEMIES: {enemy_str}")
        elif phase == "game_over":
            hint.update("[ GAME OVER ] - Press Q to quit or ESC to return to lobby")
        elif phase == "victory":
            hint.update("[ VICTORY! ] You have conquered the dungeon! Press Q to quit.")
        else:
            hint.update("")

    def _show_welcome(self) -> None:
        log = self.query_one("#event-log", RichLog)
        state = self.app.game_state
        log.write(Panel(
            f"[bold yellow]Welcome, {state.player_name} the {state.player_class.title()}![/]\n\n"
            "Use [bold]arrow keys[/] or [bold]WASD[/] to navigate the dungeon.\n"
            "In combat, use the action buttons below or keyboard shortcuts.\n\n"
            "[dim]Exploring  [@]=You  [!]=Enemies  [$]=Loot/Items  [?]=Unexplored[/dim]",
            title="⚔️  Anagnorisis  ⚔️",
            border_style="yellow",
        ))

    # ────────────────────────────────────────────
    # Button handlers
    # ────────────────────────────────────────────

    def on_button_pressed(self, event: Button.Pressed) -> None:
        btn_id = event.button.id
        state = self.app.game_state

        if btn_id in ("btn-north", "btn-south", "btn-west", "btn-east"):
            direction = btn_id.split("-")[1]
            asyncio.create_task(self._do_move(direction))
        elif btn_id == "btn-loot":
            asyncio.create_task(self._do_loot())
        elif btn_id == "btn-attack":
            asyncio.create_task(self._do_combat_action("attack"))
        elif btn_id == "btn-skill1":
            skills = state.player_skills
            if skills:
                asyncio.create_task(self._do_combat_action("skill", skills[0]))
        elif btn_id == "btn-skill2":
            skills = state.player_skills
            if len(skills) > 1:
                asyncio.create_task(self._do_combat_action("skill", skills[1]))
        elif btn_id == "btn-flee":
            asyncio.create_task(self._do_combat_action("flee"))
        elif btn_id == "btn-item":
            asyncio.create_task(self._do_use_item_combat())

    # ────────────────────────────────────────────
    # Keyboard action handlers
    # ────────────────────────────────────────────

    def action_move(self, direction: str) -> None:
        asyncio.create_task(self._do_move(direction))

    def action_loot_room(self) -> None:
        asyncio.create_task(self._do_loot())

    def action_flee(self) -> None:
        if self.app.game_state.is_in_combat:
            asyncio.create_task(self._do_combat_action("flee"))

    def action_show_inventory(self) -> None:
        self._show_inventory_panel()

    def action_back(self) -> None:
        if len(self.app.screen_stack) > 1:
            self.app.pop_screen()

    # ────────────────────────────────────────────
    # Server communication
    # ────────────────────────────────────────────

    async def _do_move(self, direction: str) -> None:
        state = self.app.game_state
        if state.is_in_combat:
            self._log_event(f"[red]You're in combat! Can't move.[/red]")
            return
        await self.app.send_message("move", {"direction": direction})

    async def _do_loot(self) -> None:
        await self.app.send_message("loot_room", {})

    async def _do_combat_action(self, action: str, skill_name: str = "") -> None:
        payload: dict = {"action": action}
        if action == "skill" and skill_name:
            payload["skill_name"] = skill_name
        await self.app.send_message("combat_action", payload)

    async def _do_use_item_combat(self) -> None:
        """Use the first health potion in inventory during combat."""
        state = self.app.game_state
        inv = state.player_inventory
        # Prefer health potion
        for item_name in inv:
            if "potion" in item_name.lower() or "Health" in item_name:
                await self.app.send_message("combat_action", {
                    "action": "use_item",
                    "item_id": item_name,
                })
                return
        self._log_event("[yellow]No usable items in inventory![/yellow]")

    # ────────────────────────────────────────────
    # Message handling (from server)
    # ────────────────────────────────────────────

    async def handle_game_message(self, message: dict) -> None:
        msg_type = message.get("type")
        payload = message.get("payload", {})

        if msg_type == "game_event":
            await self._handle_game_event(payload)
        elif msg_type == "room_entered":
            await self._handle_room_entered(payload)
        elif msg_type == "combat_update":
            await self._handle_combat_update(payload)
        elif msg_type == "success":
            await self._handle_success(payload)
        elif msg_type == "dm_response":
            # Legacy: show as narrative
            narrative = payload.get("narrative", "")
            if narrative:
                self._log_dm(narrative)
        elif msg_type == "error":
            error = payload.get("error", "Unknown error")
            self._log_event(f"[red]{error}[/red]")

    async def _handle_game_event(self, payload: dict) -> None:
        state = self.app.game_state
        event = payload.get("event", "")

        if event == "adventure_started":
            narrative = payload.get("narrative", "")
            adventure = payload.get("adventure")
            dungeon_data = payload.get("dungeon")
            phase = payload.get("phase", "exploring")

            if adventure:
                state.set_adventure(adventure)
            if dungeon_data:
                state.set_dungeon(dungeon_data)
            state.set_phase(phase)

            self._log_event(Panel(
                narrative,
                title="📜 The Adventure Begins",
                border_style="green",
            ))
            self._refresh_all()

        elif event == "player_joined":
            player_name = payload.get("player_name", "Someone")
            player_class = payload.get("player_class", "adventurer")
            self._log_event(f"[green]✦ {player_name} the {player_class.title()} has joined![/green]")

    async def _handle_room_entered(self, payload: dict) -> None:
        state = self.app.game_state
        room = payload.get("room", {})
        narrative = payload.get("narrative", "")
        dungeon_data = payload.get("dungeon")
        phase = payload.get("phase", "exploring")
        player_stats = payload.get("player_stats", {})

        if dungeon_data:
            state.set_dungeon(dungeon_data)
        state.set_phase(phase)

        # Update player stats if provided
        if player_stats and state.player:
            state.player["stats"] = player_stats

        # Show room description
        room_name = room.get("name", "Unknown Room")
        room_type = room.get("room_type", "corridor")
        enemies = room.get("enemies", [])
        items = room.get("items", [])

        type_colors = {
            "start": "green", "corridor": "white",
            "chamber": "red", "treasure": "yellow", "boss": "bright_red"
        }
        color = type_colors.get(room_type, "white")
        border = "bright_red" if room_type == "boss" else color

        content_parts = [narrative or room.get("description", "")]
        if enemies:
            living = [e for e in enemies if e.get("hp", 0) > 0]
            if living:
                enemy_str = ", ".join(f"{e.get('emoji','')} {e.get('name','?')} (HP:{e.get('hp',0)})" for e in living)
                content_parts.append(f"\n[red]ENEMIES: {enemy_str}[/red]")
        if items:
            item_str = ", ".join(f"{i.get('emoji','')} {i.get('name','?')}" for i in items)
            content_parts.append(f"\n[yellow]ITEMS: {item_str}[/yellow]")
        if room.get("gold", 0) > 0:
            content_parts.append(f"\n[yellow]Gold: {room['gold']}[/yellow]")

        if phase == "combat":
            state.set_combat({"enemies": enemies, "player_turn": True, "turn_number": 1})
            self._log_event(Panel(
                "\n".join(content_parts),
                title=f"⚔️  {room_name} — ENEMIES!",
                border_style="red",
            ))
        else:
            self._log_event(Panel(
                "\n".join(content_parts),
                title=f"🚪 {room_name}",
                border_style=border,
            ))

        self._refresh_all()

    async def _handle_combat_update(self, payload: dict) -> None:
        state = self.app.game_state
        log_lines: list[str] = payload.get("log", [])
        phase = payload.get("phase", state.game_phase)
        player_stats = payload.get("player_stats", {})
        combat_data = payload.get("combat")
        dungeon_data = payload.get("dungeon")
        xp_gained = payload.get("xp_gained", 0)
        gold_gained = payload.get("gold_gained", 0)

        state.set_phase(phase)
        state.set_combat(combat_data)
        state.append_combat_log(log_lines)

        if player_stats and state.player:
            state.player["stats"] = player_stats

        if dungeon_data:
            state.set_dungeon(dungeon_data)

        # Display combat log lines
        for line in log_lines:
            if "attack" in line.lower() or "damage" in line.lower():
                self._log_event(f"[red]{line}[/red]")
            elif "heal" in line.lower() or "restore" in line.lower() or "victory" in line.lower():
                self._log_event(f"[green]{line}[/green]")
            elif "flee" in line.lower() or "stun" in line.lower():
                self._log_event(f"[yellow]{line}[/yellow]")
            elif "xp" in line.lower() or "gold" in line.lower():
                self._log_event(f"[cyan]{line}[/cyan]")
            else:
                self._log_event(line)

        if phase == "victory":
            self._log_event(Panel(
                "[bold green]You have defeated the final boss and cleared the dungeon!\n\n"
                "Your legend will be told for ages to come. WELL DONE, ADVENTURER![/bold green]",
                title="🏆 VICTORY!",
                border_style="bright_green",
            ))
        elif phase == "game_over":
            self._log_event(Panel(
                "[bold red]You have fallen in battle.\n\n"
                "Your quest ends here... for now.[/bold red]",
                title="💀 GAME OVER",
                border_style="red",
            ))

        self._refresh_all()

    async def _handle_success(self, payload: dict) -> None:
        state = self.app.game_state
        msg = payload.get("message", "")
        looted_items = payload.get("looted_items", [])
        player_stats = payload.get("player_stats")
        inventory = payload.get("inventory")
        dungeon_data = payload.get("dungeon")

        if msg:
            self._log_event(f"[green]{msg}[/green]")

        if player_stats and state.player:
            state.player["stats"] = player_stats

        if inventory is not None and state.player:
            state.player["inventory"] = inventory

        if dungeon_data:
            state.set_dungeon(dungeon_data)

        self._refresh_all()

    # ────────────────────────────────────────────
    # Log helpers
    # ────────────────────────────────────────────

    def _log_event(self, content) -> None:
        log = self.query_one("#event-log", RichLog)
        log.write(content)

    def _log_dm(self, text: str) -> None:
        log = self.query_one("#event-log", RichLog)
        log.write(Panel(text, title="🎭 Dungeon Master", border_style="yellow"))

    def _show_inventory_panel(self) -> None:
        state = self.app.game_state
        inv = state.player_inventory
        items_str = "\n".join(f"  • {item}" for item in inv) if inv else "  Your pack is empty."
        skills = state.player_skills
        skills_str = "\n".join(
            f"  {SKILL_DEFINITIONS.get(s, {}).get('emoji','✦')} {SKILL_DEFINITIONS.get(s, {}).get('name', s)} "
            f"({SKILL_DEFINITIONS.get(s, {}).get('mp_cost', 0)} MP) - "
            f"{SKILL_DEFINITIONS.get(s, {}).get('description', '')}"
            for s in skills
        )
        self._log_event(Panel(
            f"[bold]Items:[/bold]\n{items_str}\n\n[bold]Skills:[/bold]\n{skills_str}",
            title="🎒 Inventory & Skills",
            border_style="cyan",
        ))

    # ────────────────────────────────────────────
    # Full UI refresh
    # ────────────────────────────────────────────

    def _refresh_all(self) -> None:
        self._update_header()
        self._update_stats()
        self._update_map()
        self._update_inventory()
        self._update_action_bar()
