import SwiftUI
import MapKit

/// Shows party members on a real map of Los Angeles.
/// Each player class spawns at a distinct LA neighbourhood.
struct LAMapView: View {
    @EnvironmentObject var vm: GameViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 34.052, longitude: -118.243),
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        )
    )

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $position) {
                    // Current player
                    if let player = vm.player {
                        let coord = player.classEnum.defaultCoordinate
                        Annotation(player.name, coordinate: coord) {
                            PlayerPin(
                                emoji: player.classEnum.emoji,
                                name: player.name,
                                isCurrentPlayer: true
                            )
                        }
                    }

                    // Simulated party members at different LA spots
                    ForEach(simulatedPartyMembers) { member in
                        Annotation(member.name, coordinate: member.coordinate) {
                            PlayerPin(
                                emoji: member.emoji,
                                name: member.name,
                                isCurrentPlayer: false
                            )
                        }
                    }

                    // Dungeon entrance marker (Downtown LA)
                    Annotation("Dungeon Entrance", coordinate: CLLocationCoordinate2D(latitude: 34.049, longitude: -118.258)) {
                        Image(systemName: "flame.fill")
                            .foregroundStyle(Theme.danger)
                            .font(.title2)
                            .padding(8)
                            .background(Theme.surface.opacity(0.9))
                            .clipShape(Circle())
                            .overlay(Circle().strokeBorder(Theme.danger, lineWidth: 1.5))
                    }
                }
                .mapStyle(.standard(elevation: .realistic, emphasis: .automatic, pointsOfInterest: .excludingAll))
                .ignoresSafeArea(edges: .bottom)

                // Overlay: party member list
                VStack {
                    Spacer()
                    partyLegend
                }
            }
            .navigationTitle("Party Map — Los Angeles")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Theme.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Party legend overlay

    private var partyLegend: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PARTY LOCATIONS")
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(Theme.textMuted)
                .tracking(1.5)

            if let player = vm.player {
                PartyMemberRow(
                    emoji: player.classEnum.emoji,
                    name: player.name + " (You)",
                    neighbourhood: player.classEnum.laNeighbourhood,
                    isCurrentPlayer: true
                )
            }
            ForEach(simulatedPartyMembers) { m in
                PartyMemberRow(
                    emoji: m.emoji,
                    name: m.name,
                    neighbourhood: m.neighbourhood,
                    isCurrentPlayer: false
                )
            }
        }
        .padding(14)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border))
        .padding()
    }

    // MARK: - Simulated party members for demo

    private var simulatedPartyMembers: [SimulatedMember] {
        guard let party = vm.currentParty, party.member_ids.count > 1 else { return [] }
        // Generate plausible demo members from non-current-player slots
        let classes: [PlayerClass] = [.mage, .rogue, .cleric, .ranger]
        let names = ["Lyra", "Theron", "Mira", "Zephyr"]
        return zip(names, classes).prefix(min(party.member_ids.count - 1, 3)).map { name, cls in
            SimulatedMember(name: name, playerClass: cls)
        }
    }
}

// MARK: - Helpers

private struct SimulatedMember: Identifiable {
    let id = UUID()
    let name: String
    let playerClass: PlayerClass
    var emoji: String { playerClass.emoji }
    var coordinate: CLLocationCoordinate2D { playerClass.defaultCoordinate }
    var neighbourhood: String { playerClass.laNeighbourhood }
}

private struct PlayerPin: View {
    let emoji: String
    let name: String
    let isCurrentPlayer: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text(emoji)
                .font(.system(size: isCurrentPlayer ? 26 : 20))
                .padding(isCurrentPlayer ? 8 : 6)
                .background(isCurrentPlayer ? Theme.accent.opacity(0.25) : Theme.surface.opacity(0.9))
                .clipShape(Circle())
                .overlay(
                    Circle().strokeBorder(
                        isCurrentPlayer ? Theme.accent : Theme.border,
                        lineWidth: isCurrentPlayer ? 2 : 1
                    )
                )
                .shadow(color: isCurrentPlayer ? Theme.accent.opacity(0.5) : .clear, radius: 8)

            Text(name)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Theme.surface.opacity(0.9))
                .clipShape(Capsule())
        }
    }
}

private struct PartyMemberRow: View {
    let emoji: String
    let name: String
    let neighbourhood: String
    let isCurrentPlayer: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text(emoji).font(.title3)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isCurrentPlayer ? Theme.accent : Theme.textPrimary)
                Text(neighbourhood)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
            if isCurrentPlayer {
                Circle().fill(Theme.success).frame(width: 7, height: 7)
                    .shadow(color: Theme.success, radius: 3)
            }
        }
    }
}
