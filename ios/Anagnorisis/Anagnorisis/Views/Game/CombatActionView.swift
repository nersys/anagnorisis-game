import SwiftUI

/// Bottom action bar — adapts to game phase.
struct ActionBarView: View {
    @EnvironmentObject var vm: GameViewModel

    var body: some View {
        VStack(spacing: 0) {
            Divider().background(Theme.border)
            Group {
                switch vm.gamePhase {
                case .exploring:
                    ExploreActions()
                case .combat:
                    CombatActions()
                case .looting:
                    LootActions()
                case .victory:
                    VictoryBanner()
                case .gameOver:
                    GameOverBanner()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Theme.background)
        }
    }
}

// MARK: - Explore

private struct ExploreActions: View {
    @EnvironmentObject var vm: GameViewModel

    private var exits: [String] { vm.dungeon?.availableExits ?? [] }

    var body: some View {
        VStack(spacing: 10) {
            // Direction pad
            HStack(spacing: 8) {
                ForEach(["north", "south", "east", "west"], id: \.self) { dir in
                    DirectionButton(direction: dir, enabled: exits.contains(dir)) {
                        vm.move(direction: dir)
                    }
                }
            }
            // Loot button
            HStack(spacing: 8) {
                RPGButton("Loot Room", icon: "💰", color: Theme.warning,
                          isDisabled: !(vm.dungeon?.currentRoom?.hasLoot ?? false)) {
                    vm.lootRoom()
                }
                NavigationLink {
                    LAMapView()
                        .environmentObject(vm)
                } label: {
                    HStack(spacing: 6) {
                        Text("🗺️")
                        Text("Party Map")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))
                }
            }
        }
    }
}

private struct DirectionButton: View {
    let direction: String
    let enabled: Bool
    let action: () -> Void

    private var icon: String {
        switch direction {
        case "north": return "arrow.up"
        case "south": return "arrow.down"
        case "east":  return "arrow.right"
        case "west":  return "arrow.left"
        default:      return "arrow.right"
        }
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .bold))
                Text(direction.capitalized)
                    .font(.system(size: 9, weight: .medium))
            }
            .foregroundStyle(enabled ? Theme.accent : Theme.textMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(enabled ? Theme.surfaceRaised : Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(enabled ? Theme.accentDim : Theme.border, lineWidth: 1)
            )
        }
        .disabled(!enabled)
        .animation(.easeInOut(duration: 0.15), value: enabled)
    }
}

// MARK: - Combat

private struct CombatActions: View {
    @EnvironmentObject var vm: GameViewModel

    private var skills: [String] { vm.player?.skills ?? [] }
    private var stats: PlayerStats? { vm.player?.stats }

    var body: some View {
        VStack(spacing: 8) {
            // Top row: Attack + Flee
            HStack(spacing: 8) {
                RPGButton("⚔️ Attack", color: Theme.danger) { vm.combatAttack() }
                RPGButton("↩ Flee",   color: Theme.textMuted.opacity(0.6)) { vm.combatFlee() }
                    .frame(maxWidth: 90)
            }
            // Bottom row: skills + item
            HStack(spacing: 8) {
                ForEach(Array(skills.prefix(2).enumerated()), id: \.offset) { _, skillKey in
                    if let def = knownSkills[skillKey] {
                        let hasMp = (stats?.mana ?? 0) >= def.mpCost
                        RPGButton("\(def.emoji) \(def.name)", color: Theme.mana, isDisabled: !hasMp) {
                            vm.combatSkill(skillKey)
                        }
                    }
                }
                RPGButton("🧪 Potion", color: Theme.success) { vm.combatUseItem() }
            }
        }
    }
}

// MARK: - Loot

private struct LootActions: View {
    @EnvironmentObject var vm: GameViewModel
    var body: some View {
        HStack(spacing: 10) {
            RPGButton("💰 Grab Loot", color: Theme.warning) { vm.lootRoom() }
            RPGButton("Continue →", color: Theme.accentDim) { }  // just explore
        }
    }
}

// MARK: - Victory

private struct VictoryBanner: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("🏆  VICTORY!")
                .font(Theme.titleFont(22))
                .foregroundStyle(Theme.success)
            Text("You have conquered the dungeon. Your legend will be told for ages.")
                .font(.caption)
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(12)
    }
}

// MARK: - Game over

private struct GameOverBanner: View {
    @EnvironmentObject var vm: GameViewModel
    var body: some View {
        VStack(spacing: 10) {
            Text("💀  GAME OVER")
                .font(Theme.titleFont(22))
                .foregroundStyle(Theme.danger)
            Text("You have fallen in battle. Your quest ends here.")
                .font(.caption)
                .foregroundStyle(Theme.textMuted)
            RPGButton("Return to Tavern", icon: "🏠", color: Theme.accentDim) {
                vm.currentAdventure = nil
                vm.dungeon = nil
                vm.combat = nil
                vm.narrativeLog = []
                vm.screen = .lobby
            }
        }
        .frame(maxWidth: .infinity)
        .padding(8)
    }
}
