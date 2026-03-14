import SwiftUI

struct GameView: View {
    @EnvironmentObject var vm: GameViewModel
    @State private var showInventory = false
    @State private var showMap = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Phase banner
                phaseBanner

                // Main content
                GeometryReader { geo in
                    if geo.size.width > 600 {
                        // iPad / landscape: side-by-side
                        HStack(spacing: 0) {
                            leftPanel.frame(width: 280)
                            Divider().background(Theme.border)
                            rightPanel
                        }
                    } else {
                        // iPhone: scrollable vertical layout
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 12) {
                                if let dungeon = vm.dungeon {
                                    DungeonMapView(dungeon: dungeon)
                                        .padding(.horizontal, 16)
                                }
                                if vm.gamePhase == .combat, let combat = vm.combat {
                                    combatEnemiesSection(combat)
                                        .padding(.horizontal, 16)
                                }
                                if let stats = vm.player?.stats {
                                    StatsBarView(
                                        stats: stats,
                                        playerClass: vm.player?.classEnum ?? .warrior,
                                        gold: vm.dungeon?.goldCollected ?? 0
                                    )
                                    .padding(.horizontal, 16)
                                }
                                NarrativeLogView(entries: vm.narrativeLog)
                                    .frame(minHeight: 200)
                                    .padding(.horizontal, 16)
                                    .padding(.bottom, 8)
                            }
                            .padding(.top, 12)
                        }
                    }
                }

                // Action bar (always visible at bottom)
                ActionBarView()
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationBarBackButtonHidden(true)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text(vm.currentAdventure?.name ?? "Adventure")
                        .font(.system(size: 15, weight: .bold, design: .serif))
                        .foregroundStyle(Theme.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 14) {
                        Text(vm.timeString)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.textMuted)
                        Button {
                            showInventory = true
                        } label: {
                            Image(systemName: "backpack.fill")
                                .foregroundStyle(Theme.accent)
                        }
                        NavigationLink {
                            LAMapView().environmentObject(vm)
                        } label: {
                            Image(systemName: "map.fill")
                                .foregroundStyle(Theme.accent)
                        }
                    }
                }
            }
            .sheet(isPresented: $showInventory) {
                InventorySheet()
                    .environmentObject(vm)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: - Phase banner

    private var phaseBanner: some View {
        HStack {
            Spacer()
            Text(vm.gamePhase.displayName)
                .font(.system(size: 12, weight: .black))
                .tracking(1.5)
                .foregroundStyle(Theme.phaseColour(vm.gamePhase))
            Spacer()
        }
        .padding(.vertical, 6)
        .background(Theme.phaseColour(vm.gamePhase).opacity(0.08))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundStyle(Theme.phaseColour(vm.gamePhase).opacity(0.3)),
            alignment: .bottom
        )
        .animation(.easeInOut(duration: 0.3), value: vm.gamePhase)
    }

    // MARK: - Left panel (iPad)

    private var leftPanel: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 12) {
                if let dungeon = vm.dungeon {
                    DungeonMapView(dungeon: dungeon)
                }
                if let stats = vm.player?.stats {
                    StatsBarView(
                        stats: stats,
                        playerClass: vm.player?.classEnum ?? .warrior,
                        gold: vm.dungeon?.goldCollected ?? 0
                    )
                }
            }
            .padding(12)
        }
    }

    // MARK: - Right panel (iPad)

    private var rightPanel: some View {
        VStack(spacing: 0) {
            if vm.gamePhase == .combat, let combat = vm.combat {
                combatEnemiesSection(combat)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
            }
            NarrativeLogView(entries: vm.narrativeLog)
                .padding(12)
        }
    }

    // MARK: - Enemy section

    @ViewBuilder
    private func combatEnemiesSection(_ combat: CombatState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ENEMIES")
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(Theme.danger)
                .tracking(1.5)
            ForEach(combat.livingEnemies) { enemy in
                EnemyHPBar(enemy: enemy)
            }
        }
    }
}

// MARK: - Inventory sheet

struct InventorySheet: View {
    @EnvironmentObject var vm: GameViewModel

    var body: some View {
        NavigationStack {
            List {
                if let player = vm.player {
                    Section {
                        ForEach(player.inventory, id: \.self) { item in
                            HStack {
                                Text(itemEmoji(item)).font(.title2)
                                VStack(alignment: .leading) {
                                    Text(item)
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(itemDescription(item))
                                        .font(.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }
                                Spacer()
                                if vm.gamePhase != .combat && isConsumable(item) {
                                    Button("Use") {
                                        vm.useItem(item)
                                    }
                                    .foregroundStyle(Theme.accent)
                                    .buttonStyle(.bordered)
                                    .tint(Theme.success)
                                }
                            }
                        }
                    } header: {
                        Text("ITEMS (\(player.inventory.count))")
                    }

                    Section {
                        ForEach(player.skills, id: \.self) { skill in
                            if let def = knownSkills[skill] {
                                HStack {
                                    Text(def.emoji).font(.title2)
                                    VStack(alignment: .leading) {
                                        Text(def.name).foregroundStyle(Theme.textPrimary)
                                        Text(def.description).font(.caption).foregroundStyle(Theme.textMuted)
                                    }
                                    Spacer()
                                    Text("\(def.mpCost) MP")
                                        .font(.caption.bold())
                                        .foregroundStyle(Theme.mana)
                                }
                            }
                        }
                    } header: {
                        Text("SKILLS")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Inventory & Skills")
            .navigationBarTitleDisplayMode(.inline)
        }
        .preferredColorScheme(.dark)
    }

    private func itemEmoji(_ name: String) -> String {
        let n = name.lowercased()
        if n.contains("health") || n.contains("potion") { return "🧪" }
        if n.contains("mana") { return "🔵" }
        if n.contains("sword") || n.contains("blade") { return "⚔️" }
        if n.contains("staff") { return "🪄" }
        if n.contains("bow") { return "🏹" }
        if n.contains("dagger") { return "🗡️" }
        if n.contains("shield") { return "🛡️" }
        return "📦"
    }

    private func itemDescription(_ name: String) -> String {
        let n = name.lowercased()
        if n.contains("greater_health") || n.contains("greater health") { return "Restores 80 HP" }
        if n.contains("health") { return "Restores 40 HP" }
        if n.contains("mana") { return "Restores 40 MP" }
        return "A useful adventuring item"
    }

    private func isConsumable(_ name: String) -> Bool {
        let n = name.lowercased()
        return n.contains("potion") || n.contains("health") || n.contains("mana")
    }
}

