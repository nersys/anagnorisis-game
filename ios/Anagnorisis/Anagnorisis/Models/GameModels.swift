import Foundation
import CoreLocation

// MARK: - App Navigation

enum AppScreen: Equatable {
    case login
    case lobby
    case game
}

// MARK: - Player

enum PlayerClass: String, CaseIterable, Codable, Hashable {
    case warrior, mage, rogue, cleric, ranger

    var displayName: String { rawValue.capitalized }

    var emoji: String {
        switch self {
        case .warrior: return "⚔️"
        case .mage:    return "🧙"
        case .rogue:   return "🗡️"
        case .cleric:  return "✝️"
        case .ranger:  return "🏹"
        }
    }

    var tagline: String {
        switch self {
        case .warrior: return "Unyielding tank — high HP & strength"
        case .mage:    return "Master of arcane — devastating spells"
        case .rogue:   return "Shadow striker — stealth & speed"
        case .cleric:  return "Divine warrior — heals & smites"
        case .ranger:  return "Wilderness hunter — precision & traps"
        }
    }

    /// LA neighbourhood each class starts near (for map flavour)
    var laNeighbourhood: String {
        switch self {
        case .warrior: return "Downtown LA"
        case .mage:    return "Silver Lake"
        case .rogue:   return "Hollywood"
        case .cleric:  return "Koreatown"
        case .ranger:  return "Griffith Park"
        }
    }

    /// Approximate LA map coordinates for demo
    var defaultCoordinate: CLLocationCoordinate2D {
        switch self {
        case .warrior: return CLLocationCoordinate2D(latitude: 34.0522, longitude: -118.2437)
        case .mage:    return CLLocationCoordinate2D(latitude: 34.0867, longitude: -118.2700)
        case .rogue:   return CLLocationCoordinate2D(latitude: 34.0928, longitude: -118.3287)
        case .cleric:  return CLLocationCoordinate2D(latitude: 34.0600, longitude: -118.3100)
        case .ranger:  return CLLocationCoordinate2D(latitude: 34.1184, longitude: -118.3004)
        }
    }
}

struct PlayerStats: Codable, Equatable {
    var health: Int
    var max_health: Int
    var mana: Int
    var max_mana: Int
    var strength: Int
    var intelligence: Int
    var dexterity: Int
    var charisma: Int
    var level: Int
    var experience: Int

    var healthPercent: Double { Double(health) / Double(max(max_health, 1)) }
    var manaPercent: Double   { Double(mana)   / Double(max(max_mana,   1)) }
}

struct Player: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var player_class: String
    var stats: PlayerStats
    var inventory: [String]
    var skills: [String]

    var classEnum: PlayerClass { PlayerClass(rawValue: player_class) ?? .warrior }
}

// MARK: - Party

enum PartyStatus: String, Codable {
    case lobby = "lobby"
    case in_adventure = "in_adventure"
    case completed = "completed"
}

struct Party: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var leader_id: String
    var member_ids: [String]
    var max_members: Int
    var status: String
    var current_adventure_id: String?

    var isFull: Bool { member_ids.count >= max_members }
}

struct PartyListItem: Identifiable {
    let id: String
    let name: String
    let leader: String
    let members: Int
    let maxMembers: Int
}

// MARK: - Adventure

struct Adventure: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var description: String
    var mode: String
    var party_id: String
    var game_day: Int
}

// MARK: - Dungeon

enum GamePhase: String, Equatable {
    case exploring = "exploring"
    case combat    = "combat"
    case looting   = "looting"
    case gameOver  = "game_over"
    case victory   = "victory"

    var displayName: String {
        switch self {
        case .exploring: return "EXPLORING"
        case .combat:    return "⚔️ COMBAT"
        case .looting:   return "LOOTING"
        case .gameOver:  return "💀 GAME OVER"
        case .victory:   return "🏆 VICTORY"
        }
    }
}

enum RoomType: String, Codable {
    case start     = "start"
    case corridor  = "corridor"
    case chamber   = "chamber"
    case treasure  = "treasure"
    case boss      = "boss"

    var emoji: String {
        switch self {
        case .start:    return "🚪"
        case .corridor: return "🏚"
        case .chamber:  return "💀"
        case .treasure: return "💰"
        case .boss:     return "🐉"
        }
    }
}

struct RoomItem: Codable, Identifiable {
    var id: String
    var name: String
    var emoji: String
    var description: String
}

struct Enemy: Codable, Identifiable {
    var id: String
    var name: String
    var emoji: String
    var hp: Int
    var max_hp: Int
    var attack: Int
    var defense: Int
    var xp_reward: Int
    var gold_reward: Int
    var is_boss: Bool
    var stunned: Bool

    var hpPercent: Double { Double(hp) / Double(max(max_hp, 1)) }
    var isAlive: Bool { hp > 0 }
}

struct DungeonRoom: Codable, Identifiable {
    var id: String
    var x: Int
    var y: Int
    var room_type: String
    var name: String
    var description: String
    var exits: [String: String]   // direction -> room_id
    var enemies: [Enemy]
    var items: [RoomItem]
    var explored: Bool
    var cleared: Bool
    var gold: Int

    var roomTypeEnum: RoomType { RoomType(rawValue: room_type) ?? .corridor }
    var livingEnemies: [Enemy] { enemies.filter(\.isAlive) }
    var hasEnemies: Bool { !livingEnemies.isEmpty }
    var hasLoot: Bool { !items.isEmpty || gold > 0 }
}

struct DungeonState: Equatable {
    var rooms: [String: DungeonRoom]
    var currentRoomId: String
    var totalRooms: Int
    var roomsCleared: Int
    var goldCollected: Int

    var currentRoom: DungeonRoom? { rooms[currentRoomId] }
    var availableExits: [String] { currentRoom?.exits.keys.sorted() ?? [] }
    var progressPercent: Double { Double(roomsCleared) / Double(max(totalRooms, 1)) }
}

struct CombatState: Equatable {
    var enemies: [Enemy]
    var playerTurn: Bool
    var turnNumber: Int
    var log: [String]
    var playerBuffedTurns: Int
    var playerShieldedTurns: Int
    var playerStealth: Bool

    var livingEnemies: [Enemy] { enemies.filter(\.isAlive) }
    var isPlayerBuffed: Bool { playerBuffedTurns > 0 }
    var isPlayerShielded: Bool { playerShieldedTurns > 0 }
}

// MARK: - Skill definitions (mirrors server constants)

struct SkillDef {
    let name: String
    let emoji: String
    let description: String
    let mpCost: Int
}

let knownSkills: [String: SkillDef] = [
    "slash":            SkillDef(name: "Slash",           emoji: "⚔️",  description: "Powerful sword strike",        mpCost: 5),
    "shield_bash":      SkillDef(name: "Shield Bash",     emoji: "🛡️",  description: "Stun enemy for 1 turn",        mpCost: 8),
    "battle_cry":       SkillDef(name: "Battle Cry",      emoji: "📣",  description: "+4 attack for 3 turns",        mpCost: 10),
    "fireball":         SkillDef(name: "Fireball",        emoji: "🔥",  description: "Magic fire ignores armor",     mpCost: 15),
    "frost_shield":     SkillDef(name: "Frost Shield",    emoji: "❄️",  description: "Halve damage for 3 turns",     mpCost: 12),
    "arcane_missile":   SkillDef(name: "Arcane Missile",  emoji: "✨",  description: "Quick arcane bolt",            mpCost: 8),
    "backstab":         SkillDef(name: "Backstab",        emoji: "🗡️",  description: "Double damage",                mpCost: 10),
    "stealth":          SkillDef(name: "Stealth",         emoji: "🌑",  description: "Next attack 3× damage",        mpCost: 12),
    "pickpocket":       SkillDef(name: "Cheap Shot",      emoji: "💰",  description: "Quick attack + steal gold",    mpCost: 5),
    "heal":             SkillDef(name: "Heal",            emoji: "💚",  description: "Restore 30% max HP",           mpCost: 15),
    "smite":            SkillDef(name: "Smite",           emoji: "✝️",  description: "Divine damage (no armor)",     mpCost: 12),
    "bless":            SkillDef(name: "Bless",           emoji: "🌟",  description: "+3 attack for 3 turns",        mpCost: 10),
    "aimed_shot":       SkillDef(name: "Aimed Shot",      emoji: "🏹",  description: "High accuracy 1.5× damage",   mpCost: 8),
    "trap":             SkillDef(name: "Bear Trap",       emoji: "🪤",  description: "Stun + damage",                mpCost: 10),
    "animal_companion": SkillDef(name: "Wolf Strike",     emoji: "🐺",  description: "Companion attacks 1.3× dmg",  mpCost: 8),
]
