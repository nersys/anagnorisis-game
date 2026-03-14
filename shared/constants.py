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


# ============================================
# Enemy Templates
# ============================================

# Each template: name, emoji, hp, max_hp, attack, defense, xp_reward, gold_reward
ENEMY_TEMPLATES = {
    "goblin": {
        "name": "Goblin Scout",
        "emoji": "👺",
        "hp": 20, "max_hp": 20,
        "attack": 5, "defense": 2,
        "xp_reward": 30, "gold_reward": 10,
    },
    "orc": {
        "name": "Orc Warrior",
        "emoji": "👹",
        "hp": 40, "max_hp": 40,
        "attack": 8, "defense": 4,
        "xp_reward": 60, "gold_reward": 20,
    },
    "skeleton": {
        "name": "Skeleton Archer",
        "emoji": "💀",
        "hp": 25, "max_hp": 25,
        "attack": 7, "defense": 1,
        "xp_reward": 40, "gold_reward": 15,
    },
    "troll": {
        "name": "Stone Troll",
        "emoji": "🗿",
        "hp": 60, "max_hp": 60,
        "attack": 10, "defense": 6,
        "xp_reward": 80, "gold_reward": 25,
    },
    "wraith": {
        "name": "Shadow Wraith",
        "emoji": "👻",
        "hp": 35, "max_hp": 35,
        "attack": 9, "defense": 3,
        "xp_reward": 70, "gold_reward": 20,
    },
    "dragon_boss": {
        "name": "The Ancient Dragon",
        "emoji": "🐉",
        "hp": 120, "max_hp": 120,
        "attack": 18, "defense": 8,
        "xp_reward": 300, "gold_reward": 100,
        "is_boss": True,
    },
    "lich_boss": {
        "name": "The Lich King",
        "emoji": "☠️",
        "hp": 100, "max_hp": 100,
        "attack": 20, "defense": 5,
        "xp_reward": 300, "gold_reward": 120,
        "is_boss": True,
    },
}


# ============================================
# Item Templates
# ============================================

ITEM_TEMPLATES = {
    "health_potion": {
        "name": "Health Potion",
        "item_type": "consumable",
        "description": "Restores 40 HP",
        "effect_value": 40,
        "emoji": "🧪",
    },
    "greater_health_potion": {
        "name": "Greater Health Potion",
        "item_type": "consumable",
        "description": "Restores 80 HP",
        "effect_value": 80,
        "emoji": "💊",
    },
    "mana_potion": {
        "name": "Mana Potion",
        "item_type": "consumable",
        "description": "Restores 40 MP",
        "effect_value": 40,
        "emoji": "🔵",
    },
    "antidote": {
        "name": "Antidote",
        "item_type": "consumable",
        "description": "Cures poison, restores 10 HP",
        "effect_value": 10,
        "emoji": "💚",
    },
    "gold_coin": {
        "name": "Gold Coins",
        "item_type": "key",
        "description": "Shiny gold coins",
        "effect_value": 50,
        "emoji": "🪙",
    },
}


# ============================================
# Skill Definitions (combat effects)
# ============================================

# damage_multiplier: multiplier on base attack
# heal_percent: % of max HP to heal
# mp_cost: mana cost
# effect: special effect string
SKILL_DEFINITIONS = {
    # Warrior
    "slash": {
        "name": "Slash",
        "description": "A powerful sword strike",
        "damage_multiplier": 1.5,
        "mp_cost": 5,
        "emoji": "⚔️",
    },
    "shield_bash": {
        "name": "Shield Bash",
        "description": "Stun enemy for 1 turn",
        "damage_multiplier": 0.8,
        "mp_cost": 8,
        "effect": "stun",
        "emoji": "🛡️",
    },
    "battle_cry": {
        "name": "Battle Cry",
        "description": "+4 attack for 3 turns",
        "damage_multiplier": 0.0,
        "mp_cost": 10,
        "effect": "buff_attack",
        "emoji": "📣",
    },
    # Mage
    "fireball": {
        "name": "Fireball",
        "description": "Magic fire that ignores armor",
        "damage_multiplier": 2.0,
        "mp_cost": 15,
        "effect": "magic_damage",
        "emoji": "🔥",
    },
    "frost_shield": {
        "name": "Frost Shield",
        "description": "Halve incoming damage for 3 turns",
        "damage_multiplier": 0.0,
        "mp_cost": 12,
        "effect": "shield",
        "emoji": "❄️",
    },
    "arcane_missile": {
        "name": "Arcane Missile",
        "description": "Quick arcane bolt",
        "damage_multiplier": 1.2,
        "mp_cost": 8,
        "effect": "magic_damage",
        "emoji": "✨",
    },
    # Rogue
    "backstab": {
        "name": "Backstab",
        "description": "Double damage from stealth",
        "damage_multiplier": 2.0,
        "mp_cost": 10,
        "emoji": "🗡️",
    },
    "stealth": {
        "name": "Stealth",
        "description": "Next attack deals 3x damage",
        "damage_multiplier": 0.0,
        "mp_cost": 12,
        "effect": "stealth",
        "emoji": "🌑",
    },
    "pickpocket": {
        "name": "Cheap Shot",
        "description": "Quick attack + steal gold",
        "damage_multiplier": 0.9,
        "mp_cost": 5,
        "effect": "steal",
        "emoji": "💰",
    },
    # Cleric
    "heal": {
        "name": "Heal",
        "description": "Restore 30% max HP",
        "damage_multiplier": 0.0,
        "mp_cost": 15,
        "effect": "heal",
        "heal_percent": 0.30,
        "emoji": "💚",
    },
    "smite": {
        "name": "Smite",
        "description": "Divine damage (ignores armor)",
        "damage_multiplier": 1.8,
        "mp_cost": 12,
        "effect": "magic_damage",
        "emoji": "✝️",
    },
    "bless": {
        "name": "Bless",
        "description": "+3 attack for 3 turns",
        "damage_multiplier": 0.0,
        "mp_cost": 10,
        "effect": "buff_attack",
        "emoji": "🌟",
    },
    # Ranger
    "aimed_shot": {
        "name": "Aimed Shot",
        "description": "High accuracy, 1.5x damage",
        "damage_multiplier": 1.5,
        "mp_cost": 8,
        "emoji": "🏹",
    },
    "trap": {
        "name": "Bear Trap",
        "description": "Stun enemy for 1 turn",
        "damage_multiplier": 0.5,
        "mp_cost": 10,
        "effect": "stun",
        "emoji": "🪤",
    },
    "animal_companion": {
        "name": "Wolf Strike",
        "description": "Companion attacks (1.3x damage)",
        "damage_multiplier": 1.3,
        "mp_cost": 8,
        "emoji": "🐺",
    },
}


# ============================================
# Dungeon Room Names by Type
# ============================================

ROOM_NAMES = {
    "start": [
        "The Entrance Chamber",
        "The Gateway",
        "The Threshold",
    ],
    "corridor": [
        "The Dark Passage",
        "The Winding Corridor",
        "The Torchlit Hall",
        "The Narrow Tunnel",
    ],
    "chamber": [
        "The Guardroom",
        "The Beast's Lair",
        "The Ancient Hall",
        "The Dungeon Pit",
    ],
    "treasure": [
        "The Vault",
        "The Treasure Room",
        "The Hoard Chamber",
    ],
    "boss": [
        "The Throne of Darkness",
        "The Final Chamber",
        "The Sanctum of Evil",
    ],
}
