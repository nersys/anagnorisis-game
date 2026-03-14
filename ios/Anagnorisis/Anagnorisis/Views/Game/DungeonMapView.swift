import SwiftUI

/// Grid map of dungeon rooms with connecting corridors.
struct DungeonMapView: View {
    let dungeon: DungeonState

    private let cellSize: CGFloat = 44
    private let gapSize: CGFloat = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("DUNGEON MAP")
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(Theme.textMuted)
                .tracking(1.5)
                .padding(.bottom, 4)

            ScrollView([.horizontal, .vertical], showsIndicators: false) {
                mapGrid
                    .padding(12)
            }
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))

            // Legend
            HStack(spacing: 14) {
                legendItem("You", color: Theme.accent)
                legendItem("Enemy", color: Theme.danger)
                legendItem("Loot", color: Theme.warning)
                legendItem("Cleared", color: Theme.success.opacity(0.7))
                legendItem("Boss", color: Theme.warning.opacity(0.9))
            }
            .font(.system(size: 10))
            .foregroundStyle(Theme.textMuted)
            .padding(.top, 4)
        }
    }

    // MARK: - Grid

    private var mapGrid: some View {
        let rooms = dungeon.rooms.values.sorted { $0.y == $1.y ? $0.x < $1.x : $0.y < $1.y }
        let xs = rooms.map(\.x), ys = rooms.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(),
              let minY = ys.min(), let maxY = ys.max() else {
            return AnyView(EmptyView())
        }

        let posMap = Dictionary(uniqueKeysWithValues: rooms.map { (($0.x, $0.y), $0) })
        let colCount = maxX - minX + 1
        let rowCount = maxY - minY + 1
        let totalW = CGFloat(colCount) * cellSize + CGFloat(colCount - 1) * gapSize
        let totalH = CGFloat(rowCount) * cellSize + CGFloat(rowCount - 1) * gapSize

        return AnyView(
            ZStack {
                // Connection lines
                ForEach(rooms) { room in
                    connectionLines(room: room, posMap: posMap, minX: minX, minY: minY)
                }
                // Room cells
                ForEach(rooms) { room in
                    let col = room.x - minX
                    let row = room.y - minY
                    let cx  = CGFloat(col) * (cellSize + gapSize) + cellSize / 2
                    let cy  = CGFloat(row) * (cellSize + gapSize) + cellSize / 2
                    RoomCell(room: room, isCurrent: room.id == dungeon.currentRoomId)
                        .frame(width: cellSize, height: cellSize)
                        .position(x: cx, y: cy)
                }
            }
            .frame(width: totalW, height: totalH)
        )
    }

    @ViewBuilder
    private func connectionLines(room: DungeonRoom, posMap: [GridPos: DungeonRoom], minX: Int, minY: Int) -> some View {
        let col = room.x - minX
        let row = room.y - minY
        let cx  = CGFloat(col) * (cellSize + gapSize) + cellSize / 2
        let cy  = CGFloat(row) * (cellSize + gapSize) + cellSize / 2

        ForEach(Array(room.exits.keys.sorted()), id: \.self) { dir in
            if let destId = room.exits[dir],
               let dest = dungeon.rooms[destId] {
                let dCol = dest.x - minX
                let dRow = dest.y - minY
                let dx   = CGFloat(dCol) * (cellSize + gapSize) + cellSize / 2
                let dy   = CGFloat(dRow) * (cellSize + gapSize) + cellSize / 2
                // Only draw each line once (from lower id)
                if room.id < destId {
                    Path { p in
                        p.move(to: CGPoint(x: cx, y: cy))
                        p.addLine(to: CGPoint(x: dx, y: dy))
                    }
                    .stroke(Theme.border, lineWidth: 2)
                }
            }
        }
    }

    private func legendItem(_ label: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label)
        }
    }
}

typealias GridPos = (Int, Int)
// Hashable conformance via custom struct
extension DungeonRoom: Hashable {
    public static func == (lhs: DungeonRoom, rhs: DungeonRoom) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Room cell

private struct RoomCell: View {
    let room: DungeonRoom
    let isCurrent: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(cellBackground)
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(cellBorder, lineWidth: isCurrent ? 2 : 1)

            if !room.explored {
                Image(systemName: "questionmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textMuted)
            } else if isCurrent {
                Text("@")
                    .font(.system(size: 18, weight: .black, design: .monospaced))
                    .foregroundStyle(Theme.accent)
            } else {
                Text(room.roomTypeEnum.emoji)
                    .font(.system(size: 18))

                // Overlay indicator
                if room.explored && !room.cleared && room.hasEnemies {
                    VStack {
                        HStack {
                            Spacer()
                            Circle().fill(Theme.danger).frame(width: 8, height: 8)
                                .padding(3)
                        }
                        Spacer()
                    }
                } else if room.explored && room.cleared && room.hasLoot {
                    VStack {
                        HStack {
                            Spacer()
                            Circle().fill(Theme.warning).frame(width: 8, height: 8)
                                .padding(3)
                        }
                        Spacer()
                    }
                }
            }
        }
        .shadow(color: isCurrent ? Theme.accent.opacity(0.5) : .clear, radius: 8)
    }

    private var cellBackground: Color {
        if !room.explored { return Theme.surface.opacity(0.5) }
        if isCurrent { return Theme.surfaceRaised }
        switch room.roomTypeEnum {
        case .boss:     return Color(red: 0.20, green: 0.05, blue: 0.05)
        case .treasure: return Color(red: 0.18, green: 0.16, blue: 0.05)
        default:        return Theme.surfaceRaised
        }
    }

    private var cellBorder: Color {
        if isCurrent { return Theme.accent }
        if !room.explored { return Theme.border.opacity(0.5) }
        switch room.roomTypeEnum {
        case .boss:    return Theme.warning
        case .treasure: return Theme.warning.opacity(0.7)
        default:       return room.cleared ? Theme.success.opacity(0.5) : Theme.border
        }
    }
}
