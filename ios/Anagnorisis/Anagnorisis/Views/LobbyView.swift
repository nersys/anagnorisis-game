import SwiftUI

struct LobbyView: View {
    @EnvironmentObject var vm: GameViewModel

    @State private var newPartyName = ""
    @State private var adventureName = "The Dungeon of Shadows"
    @State private var showCreateParty = false
    @State private var showStartAdventure = false

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 20) {
                        playerHeader
                        if let party = vm.currentParty {
                            currentPartySection(party)
                        } else {
                            joinPartySection
                            createPartySection
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle("Tavern")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        vm.refreshParties()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(Theme.accent)
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Sign Out") {
                        vm.screen = .login
                    }
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
                }
            }
            .onAppear { vm.refreshParties() }
        }
    }

    // MARK: - Player header

    private var playerHeader: some View {
        HStack(spacing: 16) {
            Text(vm.player?.classEnum.emoji ?? "⚔️")
                .font(.system(size: 44))
                .padding(12)
                .background(Theme.surfaceRaised)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Theme.accentDim, lineWidth: 1.5))

            VStack(alignment: .leading, spacing: 4) {
                Text(vm.player?.name ?? "Adventurer")
                    .font(.system(size: 20, weight: .bold, design: .serif))
                    .foregroundStyle(Theme.accent)

                Text("\(vm.player?.classEnum.displayName ?? "") • Level \(vm.player?.stats.level ?? 1)")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textMuted)

                // Mini HP/MP in header
                if let stats = vm.player?.stats {
                    HStack(spacing: 12) {
                        MiniStatBar(value: stats.health, max: stats.max_health, color: Theme.danger, icon: "❤️")
                        MiniStatBar(value: stats.mana,   max: stats.max_mana,   color: Theme.mana,  icon: "💙")
                    }
                }
            }
            Spacer()
        }
        .padding(16)
        .goldBorderStyle()
        .padding(.top, 8)
    }

    // MARK: - Available parties to join

    private var joinPartySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "AVAILABLE PARTIES")

            if vm.availableParties.isEmpty {
                Text("No parties in the tavern. Create one and await allies.")
                    .font(.callout)
                    .foregroundStyle(Theme.textMuted)
                    .italic()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                ForEach(vm.availableParties) { party in
                    PartyRow(party: party) {
                        vm.joinParty(id: party.id)
                    }
                }
            }
        }
    }

    // MARK: - Create party

    private var createPartySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "FORM A PARTY")

            VStack(spacing: 10) {
                TextField("", text: $newPartyName,
                          prompt: Text("Party name…").foregroundStyle(Theme.textMuted))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(12)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))

                RPGButton("Create Party", icon: "🏕️", color: Theme.accentDim) {
                    let name = newPartyName.trimmingCharacters(in: .whitespaces)
                    if !name.isEmpty {
                        vm.createParty(name: name)
                        newPartyName = ""
                    }
                }
                .disabled(newPartyName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    // MARK: - Current party

    @ViewBuilder
    private func currentPartySection(_ party: Party) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "YOUR PARTY")

            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(party.name)
                            .font(.system(size: 20, weight: .bold, design: .serif))
                            .foregroundStyle(Theme.accent)
                        Text("\(party.member_ids.count)/\(party.max_members) adventurers")
                            .font(.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                    Spacer()
                    Text(vm.isPartyLeader ? "👑 Leader" : "Member")
                        .font(.caption.bold())
                        .foregroundStyle(vm.isPartyLeader ? Theme.warning : Theme.textMuted)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Theme.surface)
                        .clipShape(Capsule())
                }
                .padding(14)
                .goldBorderStyle()

                if vm.isPartyLeader {
                    startAdventureSection
                }

                RPGButton("Leave Party", icon: "🚪", color: Theme.danger.opacity(0.8)) {
                    vm.leaveParty()
                }
            }
        }
    }

    private var startAdventureSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "START ADVENTURE")

            TextField("", text: $adventureName,
                      prompt: Text("Adventure name…").foregroundStyle(Theme.textMuted))
                .foregroundStyle(Theme.textPrimary)
                .padding(12)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))

            RPGButton("⚔️ Descend Into the Dungeon", color: Theme.accent) {
                vm.startAdventure(
                    name: adventureName.isEmpty ? "The Dungeon of Shadows" : adventureName,
                    description: "An ancient dungeon filled with monsters and treasure."
                )
            }
        }
        .padding(14)
        .cardStyle()
    }
}

// MARK: - Party row

private struct PartyRow: View {
    let party: PartyListItem
    let onJoin: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(party.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text("Led by \(party.leader)  •  \(party.members)/\(party.maxMembers) members")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
            Button(action: onJoin) {
                Text("Join")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.background)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Theme.accent)
                    .clipShape(Capsule())
            }
            .disabled(party.members >= party.maxMembers)
        }
        .padding(14)
        .cardStyle()
    }
}

// MARK: - Mini stat bar

private struct MiniStatBar: View {
    let value: Int
    let max: Int
    let color: Color
    let icon: String

    var body: some View {
        HStack(spacing: 4) {
            Text(icon).font(.system(size: 10))
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface)
                    Capsule().fill(color)
                        .frame(width: geo.size.width * Double(value) / Double(Swift.max(max, 1)))
                }
            }
            .frame(width: 60, height: 6)
            Text("\(value)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(Theme.textMuted)
        }
    }
}
