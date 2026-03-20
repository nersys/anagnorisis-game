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
    "goblin": {
        "health": 165,
        "max_health": 165,
        "mana": 35,
        "max_mana": 35,
        "strength": 17,
        "intelligence": 8,
        "dexterity": 10,
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
    "goblin": ["headbutt", "feral_bite", "goblin_rage"],
}

# Companion auto-actions in combat (one action per turn after enemy attacks)
COMPANION_ACTIONS = {
    "warrior": {
        "name": "Bryn", "emoji": "🛡",
        "action": "shield", "value": 1,
        "msg": "Bryn interposes his shield — you're shielded for the next hit!",
    },
    "mage": {
        "name": "Luma", "emoji": "✨",
        "action": "damage", "dtype": "arcane", "value": 0.55,
        "msg": "Luma hurls an arcane bolt — {dmg} arcane damage!",
    },
    "rogue": {
        "name": "Shade", "emoji": "🌑",
        "action": "damage", "dtype": "physical", "value": 0.45,
        "msg": "Shade strikes from the shadows — {dmg} damage!",
    },
    "cleric": {
        "name": "Seraph", "emoji": "☀️",
        "action": "heal", "value": 0.10,
        "msg": "Seraph channels holy light — you recover {v} HP!",
    },
    "ranger": {
        "name": "Fang", "emoji": "🐺",
        "action": "damage", "dtype": "nature", "value": 0.65,
        "msg": "Fang lunges at the enemy — {dmg} nature damage!",
    },
    "goblin": {
        "name": "Snark", "emoji": "🐀",
        "action": "damage", "dtype": "physical", "value": 0.40,
        "msg": "Snark the rat scurries in and bites — {dmg} damage!",
    },
}

# Starting inventory by class
CLASS_STARTING_INVENTORY = {
    "warrior": ["iron_sword", "wooden_shield", "health_potion"],
    "mage": ["oak_staff", "spellbook", "mana_potion"],
    "rogue": ["twin_daggers", "lockpicks", "smoke_bomb"],
    "cleric": ["holy_mace", "prayer_beads", "bandages"],
    "ranger": ["longbow", "quiver", "hunting_knife"],
    "goblin": ["iron_sword", "health_potion", "health_potion"],
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

# Stat gains applied on level-up, per class
LEVEL_STAT_GAINS = {
    "warrior": {"max_health": 12, "max_mana": 3, "strength": 2, "dexterity": 1, "intelligence": 0},
    "mage":    {"max_health": 5,  "max_mana": 15, "strength": 0, "dexterity": 1, "intelligence": 3},
    "rogue":   {"max_health": 8,  "max_mana": 8,  "strength": 1, "dexterity": 2, "intelligence": 1},
    "cleric":  {"max_health": 10, "max_mana": 10, "strength": 1, "dexterity": 0, "intelligence": 2},
    "ranger":  {"max_health": 9,  "max_mana": 8,  "strength": 1, "dexterity": 2, "intelligence": 0},
    "goblin":  {"max_health": 18, "max_mana": 2,  "strength": 3, "dexterity": 0, "intelligence": 0},
}

# Skills offered at each level-up (3 choices per class per level)
LEVEL_SKILL_UNLOCKS = {
    "warrior": {
        2: ["power_strike", "iron_skin", "taunt"],
        3: ["whirlwind", "berserker_rage", "shield_wall"],
        4: ["execute", "war_shout", "last_stand"],
        5: ["blade_storm", "unbreakable", "champion_strike"],
    },
    "mage": {
        2: ["chain_lightning", "arcane_surge", "mana_shield"],
        3: ["blink", "time_distort", "void_bolt"],
        4: ["meteor", "arcane_intellect", "counterspell"],
        5: ["storm_call", "lich_touch", "reality_tear"],
    },
    "rogue": {
        2: ["smoke_screen", "cripple", "shadow_step"],
        3: ["expose_weakness", "fan_of_knives", "evasion"],
        4: ["marked_for_death", "shadow_dance", "garrote"],
        5: ["death_mark", "vanish", "crimson_edge"],
    },
    "cleric": {
        2: ["holy_nova", "divine_shield", "renew"],
        3: ["consecrate", "turn_undead", "resurrect"],
        4: ["radiant_burst", "guardian_spirit", "divine_wrath"],
        5: ["holy_word", "avatar", "mass_heal"],
    },
    "ranger": {
        2: ["volley", "entangle", "eagle_eye"],
        3: ["explosive_shot", "camouflage", "multi_shot"],
        4: ["bestial_fury", "piercing_arrow", "hawk_eye"],
        5: ["storm_of_arrows", "apex_predator", "nature_bond"],
    },
    "goblin": {
        2: ["reckless_charge", "power_strike", "whirlwind"],
        3: ["blood_frenzy", "execute", "bone_crusher"],
        4: ["skull_crusher", "berserker_rage", "iron_skin"],
        5: ["goblin_king_shout", "blade_storm", "rampage"],
    },
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
    "goblin": "👺",
}


# ============================================
# Damage Types & Status Effects
# ============================================

DAMAGE_TYPES = ["physical", "fire", "arcane", "holy", "nature", "shadow"]

# Status effects applied in combat
STATUS_EFFECTS = {
    "poison":  {"damage_per_turn": 2, "duration": 3, "emoji": "🐍", "label": "Poisoned"},
    "burn":    {"damage_per_turn": 3, "duration": 2, "emoji": "🔥", "label": "Burning"},
    "frozen":  {"damage_per_turn": 0, "duration": 1, "emoji": "❄️", "label": "Frozen", "skip_turn": True},
    "cursed":  {"damage_per_turn": 0, "duration": 3, "emoji": "💀", "label": "Cursed", "damage_mult": 0.75},
    "blessed": {"damage_per_turn": 0, "duration": 3, "emoji": "✨", "label": "Blessed", "damage_mult": 1.3},
    "weakened":{"damage_per_turn": 0, "duration": 2, "emoji": "🩹", "label": "Weakened", "defense_reduce": 3},
}


# ============================================
# Enemy Templates
# ============================================

# Each template: name, emoji, hp, max_hp, attack, defense, xp_reward, gold_reward
# weakness: damage type that deals 1.5x damage
# resistance: damage type that deals 0.65x damage
ENEMY_TEMPLATES = {
    "goblin": {
        "name": "Goblin Scout",
        "emoji": "👺",
        "hp": 20, "max_hp": 20,
        "attack": 5, "defense": 2,
        "xp_reward": 30, "gold_reward": 10,
        "weakness": "fire", "resistance": "shadow",
    },
    "orc": {
        "name": "Orc Warrior",
        "emoji": "👹",
        "hp": 40, "max_hp": 40,
        "attack": 8, "defense": 4,
        "xp_reward": 60, "gold_reward": 20,
        "weakness": "arcane", "resistance": "physical",
    },
    "skeleton": {
        "name": "Skeleton Archer",
        "emoji": "💀",
        "hp": 25, "max_hp": 25,
        "attack": 7, "defense": 1,
        "xp_reward": 40, "gold_reward": 15,
        "weakness": "holy", "resistance": "physical",
    },
    "troll": {
        "name": "Stone Troll",
        "emoji": "🗿",
        "hp": 60, "max_hp": 60,
        "attack": 10, "defense": 6,
        "xp_reward": 80, "gold_reward": 25,
        "weakness": "fire", "resistance": "nature",
    },
    "wraith": {
        "name": "Shadow Wraith",
        "emoji": "👻",
        "hp": 35, "max_hp": 35,
        "attack": 9, "defense": 3,
        "xp_reward": 70, "gold_reward": 20,
        "weakness": "arcane", "resistance": "physical",
    },
    "cultist": {
        "name": "Waking Eye Cultist",
        "emoji": "🔴",
        "hp": 30, "max_hp": 30,
        "attack": 8, "defense": 2,
        "xp_reward": 55, "gold_reward": 18,
        "weakness": "holy", "resistance": "shadow",
    },
    "shadow_beast": {
        "name": "Shadow Beast",
        "emoji": "🐈‍⬛",
        "hp": 45, "max_hp": 45,
        "attack": 11, "defense": 3,
        "xp_reward": 75, "gold_reward": 22,
        "weakness": "holy", "resistance": "shadow",
    },
    "dragon_boss": {
        "name": "The Ancient Dragon",
        "emoji": "🐉",
        "hp": 120, "max_hp": 120,
        "attack": 18, "defense": 8,
        "xp_reward": 300, "gold_reward": 100,
        "is_boss": True,
        "weakness": "arcane", "resistance": "fire",
        "phase2_attack_bonus": 5,
        "phase2_ability": "Dragonfire",
    },
    "lich_boss": {
        "name": "The Lich King",
        "emoji": "☠️",
        "hp": 100, "max_hp": 100,
        "attack": 20, "defense": 5,
        "xp_reward": 300, "gold_reward": 120,
        "is_boss": True,
        "weakness": "holy", "resistance": "shadow",
        "phase2_attack_bonus": 6,
        "phase2_ability": "Soul Drain",
    },
    "archivist_herald": {
        "name": "Herald of the Archivist",
        "emoji": "📖",
        "hp": 150, "max_hp": 150,
        "attack": 22, "defense": 7,
        "xp_reward": 400, "gold_reward": 150,
        "is_boss": True,
        "weakness": "holy", "resistance": "arcane",
        "phase2_attack_bonus": 7,
        "phase2_ability": "Veil Tear",
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
# damage_type: damage type key (physical/fire/arcane/holy/nature/shadow)
# cooldown_turns: turns before skill can be used again (0 = no cooldown)
# status_effect: status effect key to apply to target (from STATUS_EFFECTS)
SKILL_DEFINITIONS = {
    # ── Warrior ────────────────────────────────────
    "slash": {
        "name": "Slash", "emoji": "⚔️",
        "description": "A powerful sword strike",
        "damage_multiplier": 1.5, "mp_cost": 5,
        "damage_type": "physical", "cooldown_turns": 0,
    },
    "shield_bash": {
        "name": "Shield Bash", "emoji": "🛡️",
        "description": "Stun enemy for 1 turn",
        "damage_multiplier": 0.8, "mp_cost": 8,
        "effect": "stun", "damage_type": "physical", "cooldown_turns": 2,
    },
    "battle_cry": {
        "name": "Battle Cry", "emoji": "📣",
        "description": "+4 attack for 3 turns",
        "damage_multiplier": 0.0, "mp_cost": 10,
        "effect": "buff_attack", "cooldown_turns": 3,
    },
    "power_strike": {
        "name": "Power Strike", "emoji": "💥",
        "description": "Massive strike, weakens enemy defense",
        "damage_multiplier": 2.0, "mp_cost": 14,
        "damage_type": "physical", "cooldown_turns": 3, "status_effect": "weakened",
    },
    "iron_skin": {
        "name": "Iron Skin", "emoji": "🪨",
        "description": "Grants shield for 4 turns",
        "damage_multiplier": 0.0, "mp_cost": 12,
        "effect": "shield", "cooldown_turns": 4,
    },
    "taunt": {
        "name": "Taunt", "emoji": "😤",
        "description": "Draw enemy focus, +2 attack for 2 turns",
        "damage_multiplier": 0.0, "mp_cost": 8,
        "effect": "buff_attack", "cooldown_turns": 3,
    },
    "whirlwind": {
        "name": "Whirlwind", "emoji": "🌀",
        "description": "Spin attack hitting all enemies",
        "damage_multiplier": 1.3, "mp_cost": 16,
        "damage_type": "physical", "cooldown_turns": 3, "effect": "aoe",
    },
    "execute": {
        "name": "Execute", "emoji": "⚰️",
        "description": "2.5x damage against low-HP enemies",
        "damage_multiplier": 2.5, "mp_cost": 18,
        "damage_type": "physical", "cooldown_turns": 4, "effect": "execute",
    },
    "berserker_rage": {
        "name": "Berserker Rage", "emoji": "😡",
        "description": "Go berserk: +6 attack for 3 turns, but -2 defense",
        "damage_multiplier": 0.0, "mp_cost": 15,
        "effect": "buff_attack", "cooldown_turns": 5,
    },
    # ── Mage ────────────────────────────────────────
    "fireball": {
        "name": "Fireball", "emoji": "🔥",
        "description": "Magic fire that ignores armor",
        "damage_multiplier": 2.0, "mp_cost": 15,
        "effect": "magic_damage", "damage_type": "fire", "cooldown_turns": 2,
        "status_effect": "burn",
    },
    "frost_shield": {
        "name": "Frost Shield", "emoji": "❄️",
        "description": "Halve incoming damage for 3 turns",
        "damage_multiplier": 0.0, "mp_cost": 12,
        "effect": "shield", "cooldown_turns": 4,
    },
    "arcane_missile": {
        "name": "Arcane Missile", "emoji": "✨",
        "description": "Quick arcane bolt",
        "damage_multiplier": 1.2, "mp_cost": 8,
        "effect": "magic_damage", "damage_type": "arcane", "cooldown_turns": 0,
    },
    "chain_lightning": {
        "name": "Chain Lightning", "emoji": "⚡",
        "description": "Lightning that chains between enemies",
        "damage_multiplier": 1.8, "mp_cost": 18,
        "effect": "magic_damage", "damage_type": "arcane", "cooldown_turns": 3,
        "status_effect": "frozen",
    },
    "arcane_surge": {
        "name": "Arcane Surge", "emoji": "💫",
        "description": "Surge of arcane energy, ignores all resistance",
        "damage_multiplier": 2.2, "mp_cost": 20,
        "effect": "magic_damage", "damage_type": "arcane", "cooldown_turns": 4,
    },
    "mana_shield": {
        "name": "Mana Shield", "emoji": "🔵",
        "description": "Convert 20 mana to a damage shield for 3 turns",
        "damage_multiplier": 0.0, "mp_cost": 20,
        "effect": "shield", "cooldown_turns": 4,
    },
    "void_bolt": {
        "name": "Void Bolt", "emoji": "🌑",
        "description": "Shadow energy bolt — curses the target",
        "damage_multiplier": 1.7, "mp_cost": 16,
        "effect": "magic_damage", "damage_type": "shadow", "cooldown_turns": 3,
        "status_effect": "cursed",
    },
    # ── Rogue ────────────────────────────────────────
    "backstab": {
        "name": "Backstab", "emoji": "🗡️",
        "description": "Double damage from stealth",
        "damage_multiplier": 2.0, "mp_cost": 10,
        "damage_type": "physical", "cooldown_turns": 0,
    },
    "stealth": {
        "name": "Stealth", "emoji": "🌑",
        "description": "Vanish — next attack deals 2x damage",
        "damage_multiplier": 0.0, "mp_cost": 12,
        "effect": "stealth", "cooldown_turns": 4,
    },
    "pickpocket": {
        "name": "Cheap Shot", "emoji": "💰",
        "description": "Quick attack + steal gold",
        "damage_multiplier": 0.9, "mp_cost": 5,
        "effect": "steal", "damage_type": "physical", "cooldown_turns": 0,
    },
    "smoke_screen": {
        "name": "Smoke Screen", "emoji": "💨",
        "description": "Blind the enemy — they miss next 2 attacks",
        "damage_multiplier": 0.0, "mp_cost": 10,
        "effect": "stun", "cooldown_turns": 4,
    },
    "cripple": {
        "name": "Cripple", "emoji": "🦴",
        "description": "Poison strike — 3 turns of poison DOT",
        "damage_multiplier": 1.2, "mp_cost": 12,
        "damage_type": "nature", "cooldown_turns": 3, "status_effect": "poison",
    },
    "shadow_step": {
        "name": "Shadow Step", "emoji": "👥",
        "description": "Teleport behind enemy for a devastating ambush",
        "damage_multiplier": 2.5, "mp_cost": 16,
        "damage_type": "shadow", "cooldown_turns": 4,
    },
    # ── Cleric ────────────────────────────────────────
    "heal": {
        "name": "Heal", "emoji": "💚",
        "description": "Restore 30% max HP",
        "damage_multiplier": 0.0, "mp_cost": 15,
        "effect": "heal", "heal_percent": 0.30, "cooldown_turns": 0,
    },
    "smite": {
        "name": "Smite", "emoji": "✝️",
        "description": "Divine damage (ignores armor)",
        "damage_multiplier": 1.8, "mp_cost": 12,
        "effect": "magic_damage", "damage_type": "holy", "cooldown_turns": 1,
    },
    "bless": {
        "name": "Bless", "emoji": "🌟",
        "description": "+4 attack for 3 turns",
        "damage_multiplier": 0.0, "mp_cost": 10,
        "effect": "buff_attack", "cooldown_turns": 3,
    },
    "holy_nova": {
        "name": "Holy Nova", "emoji": "☀️",
        "description": "Burst of holy light — damages undead, heals you",
        "damage_multiplier": 1.5, "mp_cost": 18,
        "effect": "magic_damage", "damage_type": "holy", "cooldown_turns": 3,
        "heal_percent": 0.10,
    },
    "divine_shield": {
        "name": "Divine Shield", "emoji": "🛡️",
        "description": "Blessed shield for 5 turns",
        "damage_multiplier": 0.0, "mp_cost": 20,
        "effect": "shield", "cooldown_turns": 5,
    },
    "turn_undead": {
        "name": "Turn Undead", "emoji": "⚰️",
        "description": "3x damage vs undead — curses and terrifies",
        "damage_multiplier": 3.0, "mp_cost": 20,
        "effect": "magic_damage", "damage_type": "holy", "cooldown_turns": 4,
        "status_effect": "cursed",
    },
    # ── Ranger ────────────────────────────────────────
    "aimed_shot": {
        "name": "Aimed Shot", "emoji": "🏹",
        "description": "Precise shot, 1.5x damage",
        "damage_multiplier": 1.5, "mp_cost": 8,
        "damage_type": "physical", "cooldown_turns": 0,
    },
    "trap": {
        "name": "Bear Trap", "emoji": "🪤",
        "description": "Stun enemy for 1 turn",
        "damage_multiplier": 0.5, "mp_cost": 10,
        "effect": "stun", "damage_type": "physical", "cooldown_turns": 3,
    },
    "animal_companion": {
        "name": "Wolf Strike", "emoji": "🐺",
        "description": "Companion attacks (1.3x damage)",
        "damage_multiplier": 1.3, "mp_cost": 8,
        "damage_type": "nature", "cooldown_turns": 0,
    },
    "volley": {
        "name": "Volley", "emoji": "🪃",
        "description": "Rain of arrows — hits all enemies",
        "damage_multiplier": 1.1, "mp_cost": 14,
        "damage_type": "physical", "effect": "aoe", "cooldown_turns": 3,
    },
    "entangle": {
        "name": "Entangle", "emoji": "🌿",
        "description": "Nature vines stun enemy and poison them",
        "damage_multiplier": 0.6, "mp_cost": 12,
        "effect": "stun", "damage_type": "nature", "cooldown_turns": 3,
        "status_effect": "poison",
    },
    "eagle_eye": {
        "name": "Eagle Eye", "emoji": "🦅",
        "description": "Critical strike — ignores defense",
        "damage_multiplier": 2.2, "mp_cost": 16,
        "damage_type": "physical", "cooldown_turns": 4, "effect": "magic_damage",
    },
    "explosive_shot": {
        "name": "Explosive Shot", "emoji": "💣",
        "description": "Fire-tipped arrow — burns on impact",
        "damage_multiplier": 1.8, "mp_cost": 15,
        "damage_type": "fire", "cooldown_turns": 3, "status_effect": "burn",
    },
    # ── Goblin ─────────────────────────────────────
    "headbutt": {
        "name": "Headbutt", "emoji": "💢",
        "description": "Slam your thick skull into the enemy — stuns them",
        "damage_multiplier": 1.2, "mp_cost": 6,
        "effect": "stun", "damage_type": "physical", "cooldown_turns": 2,
    },
    "feral_bite": {
        "name": "Feral Bite", "emoji": "🦷",
        "description": "Savage bite that infects the wound with poison",
        "damage_multiplier": 1.1, "mp_cost": 5,
        "damage_type": "physical", "cooldown_turns": 0, "status_effect": "poison",
    },
    "goblin_rage": {
        "name": "Goblin Rage", "emoji": "😤",
        "description": "Fly into a frenzy — attack power surges for 3 turns",
        "damage_multiplier": 0.0, "mp_cost": 8,
        "effect": "buff_attack", "cooldown_turns": 4,
    },
    "reckless_charge": {
        "name": "Reckless Charge", "emoji": "🐗",
        "description": "Smash into the enemy with full body weight — massive damage",
        "damage_multiplier": 2.2, "mp_cost": 10,
        "damage_type": "physical", "cooldown_turns": 3,
    },
    "blood_frenzy": {
        "name": "Blood Frenzy", "emoji": "🩸",
        "description": "The sight of blood drives you wild — AOE strike, applies weakened",
        "damage_multiplier": 1.4, "mp_cost": 12,
        "effect": "aoe", "damage_type": "physical", "cooldown_turns": 3,
        "status_effect": "weakened",
    },
    "bone_crusher": {
        "name": "Bone Crusher", "emoji": "🦴",
        "description": "A brutal overhead blow that shatters defense",
        "damage_multiplier": 1.8, "mp_cost": 10,
        "damage_type": "physical", "cooldown_turns": 2, "status_effect": "weakened",
    },
    "skull_crusher": {
        "name": "Skull Crusher", "emoji": "💀",
        "description": "Execute a stunned or weakened enemy with lethal force",
        "damage_multiplier": 2.5, "mp_cost": 14,
        "effect": "execute", "damage_type": "physical", "cooldown_turns": 4,
    },
    "goblin_king_shout": {
        "name": "Goblin King Shout", "emoji": "👑",
        "description": "Terrifying war shout — stuns all enemies simultaneously",
        "damage_multiplier": 0.5, "mp_cost": 15,
        "effect": "aoe", "damage_type": "physical", "cooldown_turns": 5,
        "status_effect": "weakened",
    },
    "rampage": {
        "name": "Rampage", "emoji": "🌪️",
        "description": "Berserk flurry of attacks — hits all enemies 1.6x",
        "damage_multiplier": 1.6, "mp_cost": 14,
        "effect": "aoe", "damage_type": "physical", "cooldown_turns": 4,
    },
}


# ============================================
# Equipment Templates
# ============================================

# slot: "weapon" | "armor" | "accessory"
# rarity: "common" | "uncommon" | "rare" | "legendary"
# damage_bonus: added to physical attack
# defense_bonus: reduces incoming damage
# stat_bonus: dict of stat name -> value
# damage_type: weapon's damage type
# class_req: class restriction (None = any class)
EQUIPMENT_TEMPLATES = {
    # ── Common Weapons ──────────────────────────────────
    "iron_sword_plus": {
        "name": "Iron Sword +1", "emoji": "⚔️", "slot": "weapon", "rarity": "common",
        "damage_bonus": 3, "damage_type": "physical", "stat_bonus": {},
        "description": "A well-balanced blade, edge freshly honed.",
    },
    "oak_staff_plus": {
        "name": "Enchanted Staff", "emoji": "🪄", "slot": "weapon", "rarity": "common",
        "damage_bonus": 2, "damage_type": "arcane", "stat_bonus": {"intelligence": 1},
        "description": "Carved oak etched with arcane runes.",
    },
    "worn_daggers": {
        "name": "Worn Daggers", "emoji": "🗡️", "slot": "weapon", "rarity": "common",
        "damage_bonus": 2, "damage_type": "physical", "stat_bonus": {"dexterity": 1},
        "description": "Battered but still sharp. Perfect for quick strikes.",
    },
    # ── Uncommon Weapons ────────────────────────────────
    "shadow_blade": {
        "name": "Shadow Blade", "emoji": "🌑", "slot": "weapon", "rarity": "uncommon",
        "damage_bonus": 5, "damage_type": "shadow", "stat_bonus": {"dexterity": 2},
        "description": "A blade that seems to drink the light around it.",
        "class_req": "rogue",
    },
    "veil_touched_bow": {
        "name": "Veil-Touched Bow", "emoji": "🏹", "slot": "weapon", "rarity": "uncommon",
        "damage_bonus": 4, "damage_type": "nature", "stat_bonus": {"dexterity": 2},
        "description": "Carved from a tree that grew over a Veil rift.",
        "class_req": "ranger",
    },
    "holy_symbol_mace": {
        "name": "Blessed Mace", "emoji": "🔨", "slot": "weapon", "rarity": "uncommon",
        "damage_bonus": 4, "damage_type": "holy", "stat_bonus": {"intelligence": 2},
        "description": "Humming with divine light. Devastating against undead.",
        "class_req": "cleric",
    },
    "arcane_wand": {
        "name": "Arcane Wand", "emoji": "✨", "slot": "weapon", "rarity": "uncommon",
        "damage_bonus": 3, "damage_type": "arcane", "stat_bonus": {"intelligence": 3, "max_mana": 15},
        "description": "A wand that channels arcane energy with frightening ease.",
        "class_req": "mage",
    },
    # ── Common Armor ─────────────────────────────────────
    "leather_vest": {
        "name": "Leather Vest", "emoji": "🧥", "slot": "armor", "rarity": "common",
        "defense_bonus": 2, "stat_bonus": {},
        "description": "Supple leather — protection without slowing you down.",
    },
    "chain_mail": {
        "name": "Chain Mail", "emoji": "⛓️", "slot": "armor", "rarity": "common",
        "defense_bonus": 4, "stat_bonus": {"max_health": 10},
        "description": "Interlocking iron rings. Heavy but reliable.",
    },
    # ── Uncommon Armor ───────────────────────────────────
    "shadowweave_cloak": {
        "name": "Shadowweave Cloak", "emoji": "🌑", "slot": "armor", "rarity": "uncommon",
        "defense_bonus": 3, "stat_bonus": {"dexterity": 2, "max_health": 15},
        "description": "Woven from shadow-touched silk. Whispers as you move.",
    },
    "arcane_robes": {
        "name": "Arcane Robes", "emoji": "👘", "slot": "armor", "rarity": "uncommon",
        "defense_bonus": 1, "stat_bonus": {"intelligence": 2, "max_mana": 25},
        "description": "Robes that crackle with static arcane charge.",
    },
    "battle_plate": {
        "name": "Battle Plate", "emoji": "🛡️", "slot": "armor", "rarity": "uncommon",
        "defense_bonus": 6, "stat_bonus": {"max_health": 20},
        "description": "Scarred but unyielding plate. Built to last.",
        "class_req": "warrior",
    },
    # ── Rare Items ───────────────────────────────────────
    "veil_shard_ring": {
        "name": "Veil Shard Ring", "emoji": "💍", "slot": "accessory", "rarity": "rare",
        "defense_bonus": 0, "stat_bonus": {"intelligence": 3, "max_mana": 20, "max_health": 10},
        "description": "A fragment of the Veil crystallized into a ring. It pulses with forgotten power.",
    },
    "archivist_tome": {
        "name": "Tome Fragment", "emoji": "📖", "slot": "accessory", "rarity": "rare",
        "defense_bonus": 0, "stat_bonus": {"intelligence": 4, "strength": 2},
        "description": "A page from the Tome of Unmaking. Reality feels thinner when you hold it.",
    },
    "blood_pendant": {
        "name": "Warrior's Pendant", "emoji": "🩸", "slot": "accessory", "rarity": "rare",
        "defense_bonus": 1, "stat_bonus": {"strength": 4, "max_health": 25},
        "description": "Soaked in the blood of a hundred victories.",
        "class_req": "warrior",
    },
    # ── Legendary ────────────────────────────────────────
    "veil_blade": {
        "name": "The Veil Blade", "emoji": "🗡️✨", "slot": "weapon", "rarity": "legendary",
        "damage_bonus": 10, "damage_type": "shadow", "stat_bonus": {"strength": 4, "dexterity": 4},
        "description": "Forged in the tear between worlds. Every strike echoes through the Veil.",
    },
    "archivist_mantle": {
        "name": "Archivist's Mantle", "emoji": "🌌", "slot": "armor", "rarity": "legendary",
        "defense_bonus": 8, "stat_bonus": {"intelligence": 5, "max_mana": 40, "max_health": 30},
        "description": "Stolen from the Archivist's own sanctum. It remembers every battle.",
    },
}

# Rarity drop weights for loot (higher = more common)
EQUIPMENT_RARITY_WEIGHTS = {
    "common": 50,
    "uncommon": 30,
    "rare": 15,
    "legendary": 5,
}

# Which rarities can drop from each room type
EQUIPMENT_DROP_BY_ROOM = {
    "corridor": ["common"],
    "chamber": ["common", "uncommon"],
    "treasure": ["uncommon", "rare"],
    "boss": ["rare", "legendary"],
    "default": ["common", "uncommon"],
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
