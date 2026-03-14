import Foundation
import Combine

@MainActor
final class GameViewModel: ObservableObject {

    // MARK: - Navigation
    @Published var screen: AppScreen = .login

    // MARK: - Connection
    @Published var serverURL: String = "ws://192.168.1.100:8000/ws"
    @Published var isConnected: Bool = false
    @Published var connectionError: String?

    // MARK: - Player
    @Published var player: Player?

    // MARK: - Lobby
    @Published var availableParties: [PartyListItem] = []
    @Published var currentParty: Party?

    // MARK: - Adventure
    @Published var currentAdventure: Adventure?
    @Published var gamePhase: GamePhase = .exploring
    @Published var gameDayHour: (day: Int, hour: Int) = (1, 8)

    // MARK: - Dungeon
    @Published var dungeon: DungeonState?
    @Published var combat: CombatState?

    // MARK: - Narrative log
    @Published var narrativeLog: [NarrativeEntry] = []

    // MARK: - Toast / alerts
    @Published var toastMessage: String?

    private let ws = GameWebSocketService()

    init() {
        ws.delegate = self
    }

    // MARK: - Connection

    func connectToServer() {
        connectionError = nil
        ws.connect(to: serverURL)
    }

    // MARK: - Auth / Login

    func login(name: String, playerClass: PlayerClass) {
        ws.sendMessage(type: "connect", payload: [
            "player_name": name,
            "player_class": playerClass.rawValue
        ])
    }

    // MARK: - Lobby

    func refreshParties() {
        ws.sendMessage(type: "list_parties")
    }

    func createParty(name: String) {
        ws.sendMessage(type: "create_party", payload: ["party_name": name])
    }

    func joinParty(id: String) {
        ws.sendMessage(type: "join_party", payload: ["party_id": id])
    }

    func leaveParty() {
        ws.sendMessage(type: "leave_party")
        currentParty = nil
    }

    func startAdventure(name: String, description: String) {
        ws.sendMessage(type: "start_adventure", payload: [
            "adventure_name": name,
            "description": description,
            "mode": "guided"
        ])
    }

    // MARK: - Dungeon actions

    func move(direction: String) {
        ws.sendMessage(type: "move", payload: ["direction": direction])
    }

    func combatAttack() {
        ws.sendMessage(type: "combat_action", payload: ["action": "attack"])
    }

    func combatSkill(_ skillName: String) {
        ws.sendMessage(type: "combat_action", payload: [
            "action": "skill",
            "skill_name": skillName
        ])
    }

    func combatFlee() {
        ws.sendMessage(type: "combat_action", payload: ["action": "flee"])
    }

    func combatUseItem() {
        // Use first health potion found
        guard let inv = player?.inventory else { return }
        let potion = inv.first { $0.lowercased().contains("health") || $0.lowercased().contains("potion") }
        guard let itemName = potion else {
            showToast("No health potions!")
            return
        }
        ws.sendMessage(type: "combat_action", payload: [
            "action": "use_item",
            "item_id": itemName
        ])
    }

    func lootRoom() {
        ws.sendMessage(type: "loot_room")
    }

    func useItem(_ name: String) {
        ws.sendMessage(type: "use_item", payload: ["item_name": name])
    }

    // MARK: - Helpers

    func showToast(_ msg: String) {
        toastMessage = msg
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if toastMessage == msg { toastMessage = nil }
        }
    }

    var isPartyLeader: Bool {
        guard let party = currentParty, let player = player else { return false }
        return party.leader_id == player.id
    }

    var timeString: String {
        let hour = gameDayHour.hour
        let period = hour < 12 ? "AM" : "PM"
        var h = hour % 12; if h == 0 { h = 12 }
        return "Day \(gameDayHour.day), \(h):00 \(period)"
    }
}

// MARK: - Log entry

struct NarrativeEntry: Identifiable {
    enum Kind { case narrative, combat, system, loot, error }
    let id = UUID()
    let kind: Kind
    let text: String
    let timestamp = Date()
}

// MARK: - Message parsing

extension GameViewModel: GameWebSocketDelegate {

    nonisolated func socketDidConnect() {
        Task { @MainActor in
            isConnected = true
            connectionError = nil
        }
    }

    nonisolated func socketDidDisconnect(error: Error?) {
        Task { @MainActor in
            isConnected = false
            connectionError = error?.localizedDescription ?? "Disconnected"
        }
    }

    nonisolated func socketDidReceive(message: WSMessage) {
        Task { @MainActor in
            handleMessage(message)
        }
    }

    private func handleMessage(_ msg: WSMessage) {
        switch msg.type {
        case "success":
            handleSuccess(msg)
        case "error":
            let err = msg.payloadString("error") ?? "Unknown error"
            showToast(err)
            appendLog(.error, err)
        case "game_event":
            handleGameEvent(msg)
        case "room_entered":
            handleRoomEntered(msg)
        case "combat_update":
            handleCombatUpdate(msg)
        case "heartbeat":
            if let day = msg.payloadInt("game_day"),
               let hour = msg.payloadInt("game_hour") {
                gameDayHour = (day, hour)
            }
        default:
            break
        }
    }

    // MARK: Success

    private func handleSuccess(_ msg: WSMessage) {
        // Login response
        if let playerData = msg.decodePayloadKey("player", as: Player.self) {
            player = playerData
            screen = .lobby
            refreshParties()
            return
        }
        // Party created/joined
        if let partyData = msg.decodePayloadKey("party", as: Party.self) {
            currentParty = partyData
        }
        // Loot / item use
        if let text = msg.payloadString("message") {
            appendLog(.loot, text)
        }
        if let inv = msg.payloadArray("inventory") {
            let names = inv.compactMap { $0.stringValue }
            player?.inventory = names
        }
        if let statsVal = msg.payload["player_stats"],
           let statsData = try? statsVal.decode(PlayerStats.self) {
            player?.stats = statsData
        }
        // Party list
        if let parties = msg.payloadArray("parties") {
            availableParties = parties.compactMap { parsePartyListItem($0) }
        }
    }

    // MARK: Game event

    private func handleGameEvent(_ msg: WSMessage) {
        let event = msg.payloadString("event") ?? ""

        switch event {
        case "adventure_started":
            if let adv = msg.decodePayloadKey("adventure", as: Adventure.self) {
                currentAdventure = adv
            }
            if let narrative = msg.payloadString("narrative") {
                appendLog(.narrative, narrative)
            }
            if let d = parseDungeon(from: msg.payload["dungeon"]) {
                dungeon = d
            }
            gamePhase = GamePhase(rawValue: msg.payloadString("phase") ?? "exploring") ?? .exploring
            screen = .game

        case "player_joined":
            let name = msg.payloadString("player_name") ?? "Someone"
            let cls  = msg.payloadString("player_class") ?? "adventurer"
            appendLog(.system, "✦ \(name) the \(cls.capitalized) joined the party!")

        default:
            break
        }
    }

    // MARK: Room entered

    private func handleRoomEntered(_ msg: WSMessage) {
        if let d = parseDungeon(from: msg.payload["dungeon"]) { dungeon = d }
        gamePhase = GamePhase(rawValue: msg.payloadString("phase") ?? "exploring") ?? .exploring
        if let statsVal = msg.payload["player_stats"],
           let statsData = try? statsVal.decode(PlayerStats.self) {
            player?.stats = statsData
        }
        if let narrative = msg.payloadString("narrative") {
            appendLog(.narrative, narrative)
        }
        if gamePhase == .combat {
            // Seed combat state from room enemies
            if let roomVal = msg.payload["room"],
               let room = try? roomVal.decode(DungeonRoom.self) {
                combat = CombatState(
                    enemies: room.livingEnemies,
                    playerTurn: true,
                    turnNumber: 1,
                    log: ["Enemies appear in \(room.name)!"],
                    playerBuffedTurns: 0,
                    playerShieldedTurns: 0,
                    playerStealth: false
                )
            }
        } else {
            combat = nil
        }
    }

    // MARK: Combat update

    private func handleCombatUpdate(_ msg: WSMessage) {
        gamePhase = GamePhase(rawValue: msg.payloadString("phase") ?? "exploring") ?? .exploring
        if let statsVal = msg.payload["player_stats"],
           let statsData = try? statsVal.decode(PlayerStats.self) {
            player?.stats = statsData
        }
        if let d = parseDungeon(from: msg.payload["dungeon"]) { dungeon = d }

        // Combat log lines
        if let lines = msg.payloadArray("log") {
            for line in lines.compactMap({ $0.stringValue }) {
                appendLog(.combat, line)
            }
        }

        // Update combat state from server
        if let combatVal = msg.payload["combat"], case .object(_) = combatVal,
           let updatedCombat = parseCombat(from: combatVal) {
            combat = updatedCombat
        } else if msg.payload["combat"] == .some(.null) || gamePhase != .combat {
            combat = nil
        }

        // XP / gold notifications
        if let xp = msg.payloadInt("xp_gained"), xp > 0 {
            appendLog(.loot, "+\(xp) XP earned!")
        }
        if let gold = msg.payloadInt("gold_gained"), gold > 0 {
            appendLog(.loot, "+\(gold) gold collected!")
        }
    }

    // MARK: - Parsing helpers

    private func parsePartyListItem(_ val: JSONValue) -> PartyListItem? {
        guard let obj = val.objectValue,
              let id      = obj["id"]?.stringValue,
              let name    = obj["name"]?.stringValue,
              let leader  = obj["leader"]?.stringValue,
              let members = obj["members"]?.intValue,
              let maxM    = obj["max_members"]?.intValue else { return nil }
        return PartyListItem(id: id, name: name, leader: leader, members: members, maxMembers: maxM)
    }

    private func parseDungeon(from val: JSONValue?) -> DungeonState? {
        guard let val, let data = try? JSONEncoder().encode(val) else { return nil }
        struct Raw: Decodable {
            let current_room_id: String
            let total_rooms: Int
            let rooms_cleared: Int
            let gold_collected: Int
            let rooms: [String: DungeonRoom]
        }
        guard let raw = try? JSONDecoder().decode(Raw.self, from: data) else { return nil }
        return DungeonState(
            rooms: raw.rooms,
            currentRoomId: raw.current_room_id,
            totalRooms: raw.total_rooms,
            roomsCleared: raw.rooms_cleared,
            goldCollected: raw.gold_collected
        )
    }

    private func parseCombat(from val: JSONValue) -> CombatState? {
        guard let data = try? JSONEncoder().encode(val) else { return nil }
        struct Raw: Decodable {
            let enemies: [Enemy]
            let player_turn: Bool
            let turn_number: Int
            let log: [String]
            let player_buffed_turns: Int
            let player_shielded_turns: Int
            let player_stealth: Bool
        }
        guard let raw = try? JSONDecoder().decode(Raw.self, from: data) else { return nil }
        return CombatState(
            enemies: raw.enemies,
            playerTurn: raw.player_turn,
            turnNumber: raw.turn_number,
            log: raw.log,
            playerBuffedTurns: raw.player_buffed_turns,
            playerShieldedTurns: raw.player_shielded_turns,
            playerStealth: raw.player_stealth
        )
    }

    private func appendLog(_ kind: NarrativeEntry.Kind, _ text: String) {
        let entry = NarrativeEntry(kind: kind, text: text)
        narrativeLog.append(entry)
        if narrativeLog.count > 200 {
            narrativeLog.removeFirst(narrativeLog.count - 200)
        }
    }
}
