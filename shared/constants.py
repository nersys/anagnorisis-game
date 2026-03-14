"""
Game constants and configuration.

These values define the core parameters of the game world.
Tweak these to balance gameplay!
"""

# ============================================
# Time & Scheduling
# ============================================

# How often the game clock ticks (in real seconds)
GAME_TICK_SECONDS = 60

# How many game hours pass per real tick
GAME_HOURS_PER_TICK = 1

# Hours in a game day
HOURS_PER_GAME_DAY = 24


# ============================================
# Player Stats
# ============================================

# Starting stats by class
CLASS_BASE_STATS = {
    "warrior": {
        "health": 120,
        "max_health": 120,
        "mana": 30,
        "max_mana": 30,
        "strength": 14,
        "intelligence": 8,
        "dexterity": 10,
        "charisma": 10,
    },
    "mage": {
        "health": 70,
        "max_health": 70,
        "mana": 100,
        "max_mana": 100,
        "strength": 6,
        "intelligence": 16,
        "dexterity": 10,
        "charisma": 10,
    },
    "rogue": {
        "health": 90,
        "max_health": 90,
        "mana": 50,
        "max_mana": 50,
        "strength": 10,
        "intelligence": 10,
        "dexterity": 16,
        "charisma": 12,
    },
    "cleric": {
        "health": 100,
        "max_health": 100,
        "mana": 80,
        "max_mana": 80,
        "strength": 10,
        "intelligence": 12,
        "dexterity": 8,
        "charisma": 14,
    },
    "ranger": {
        "health": 100,
        "max_health": 100,
        "mana": 60,
        "max_mana": 60,
        "strength": 12,
        "intelligence": 10,
        "dexterity": 14,
        "charisma": 8,
    },
}

# Starting skills by class
CLASS_STARTING_SKILLS = {
    "warrior": ["slash", "shield_bash", "battle_cry"],
    "mage": ["fireball", "frost_shield", "arcane_missile"],
    "rogue": ["backstab", "stealth", "pickpocket"],
    "cleric": ["heal", "smite", "bless"],
    "ranger": ["aimed_shot", "trap", "animal_companion"],
}

# Starting inventory by class
CLASS_STARTING_INVENTORY = {
    "warrior": ["iron_sword", "wooden_shield", "health_potion"],
    "mage": ["oak_staff", "spellbook", "mana_potion"],
    "rogue": ["twin_daggers", "lockpicks", "smoke_bomb"],
    "cleric": ["holy_mace", "prayer_beads", "bandages"],
    "ranger": ["longbow", "quiver", "hunting_knife"],
}


# ============================================
# Experience & Leveling
# ============================================

# XP required for each level (level: xp_needed)
XP_PER_LEVEL = {
    1: 0,
    2: 100,
    3: 300,
    4: 600,
    5: 1000,
    6: 1500,
    7: 2100,
    8: 2800,
    9: 3600,
    10: 4500,
}


# ============================================
# ASCII Art Assets
# ============================================

LOGO = r"""
    ╔═══════════════════════════════════════════╗
    ║                                           ║
    ║     ▄▀▄ ▐▀▄▀▌▄▀▄ ▄▀▀ ▐▀▄▀▌▄▀▄ █▀▄ █ ▄▀▀  ║
    ║     █▀█ █ ▀ ██▀█ █▀█ █ ▀ ██ █ █▀▄ █ ▀▀█  ║
    ║     ▀ ▀ ▀   ▀▀ ▀ ▀▀▀ ▀   ▀▀▀▀ ▀ ▀ ▀ ▀▀▀  ║
    ║                                           ║
    ║         ⚔️  The Moment of Truth  ⚔️        ║
    ║                                           ║
    ╚═══════════════════════════════════════════╝
"""

MINI_MAP_TEMPLATE = """
┌────────────────────────┐
│  ░░▒▒▓▓ THE REALM ▓▓▒▒░░ │
│                          │
│    🏰 ═══════ 🌲        │
│    ║         / \\        │
│    ║       {p1}  {p2}       │
│    ║      /     \\       │
│   🏠 ══ 🌉 ═══ ⛰️        │
│                          │
└────────────────────────┘
"""

CLASS_ICONS = {
    "warrior": "⚔️",
    "mage": "🧙",
    "rogue": "🗡️",
    "cleric": "✝️",
    "ranger": "🏹",
}
