import SwiftUI

/// HP / MP progress bars with animated fill.
struct StatsBarView: View {
    let stats: PlayerStats
    let playerClass: PlayerClass
    let gold: Int

    var body: some View {
        VStack(spacing: 10) {
            // HP
            StatRow(
                label: "HP",
                icon: "heart.fill",
                color: hpColor,
                value: stats.health,
                max: stats.max_health,
                percent: stats.healthPercent
            )
            // MP
            StatRow(
                label: "MP",
                icon: "sparkles",
                color: Theme.mana,
                value: stats.mana,
                max: stats.max_mana,
                percent: stats.manaPercent
            )
            Divider().background(Theme.border)
            // Character summary row
            HStack {
                Label(playerClass.displayName, systemImage: "person.fill")
                    .font(.caption.bold())
                    .foregroundStyle(Theme.accent)
                Spacer()
                Text("Lv.\(stats.level)")
                    .font(.caption.bold())
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Label("\(gold)", systemImage: "circle.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.warning)
                    .labelStyle(.titleAndIcon)
            }
            // XP bar
            VStack(alignment: .leading, spacing: 4) {
                let xpPercent = xpProgress(level: stats.level, xp: stats.experience)
                HStack {
                    Text("XP").font(.system(size: 10)).foregroundStyle(Theme.textMuted)
                    Spacer()
                    Text("\(stats.experience)").font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.textMuted)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.surface)
                        Capsule()
                            .fill(LinearGradient(colors: [Theme.accentDim, Theme.accent], startPoint: .leading, endPoint: .trailing))
                            .frame(width: geo.size.width * xpPercent)
                            .animation(.easeInOut(duration: 0.4), value: xpPercent)
                    }
                }
                .frame(height: 5)
            }
        }
        .padding(12)
        .cardStyle()
    }

    private var hpColor: Color {
        if stats.healthPercent > 0.5 { return Theme.success }
        if stats.healthPercent > 0.25 { return Theme.warning }
        return Theme.danger
    }

    private func xpProgress(level: Int, xp: Int) -> Double {
        let table = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500]
        let current = level <= 10 ? table[min(level - 1, 9)] : table[9]
        let next    = level < 10  ? table[min(level, 9)]    : table[9]
        let range = max(next - current, 1)
        return Double(xp - current) / Double(range)
    }
}

private struct StatRow: View {
    let label: String
    let icon: String
    let color: Color
    let value: Int
    let max: Int
    let percent: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(label, systemImage: icon)
                    .font(.caption.bold())
                    .foregroundStyle(color)
                Spacer()
                Text("\(value) / \(max)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Theme.textMuted)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(
                                colors: [color.opacity(0.6), color],
                                startPoint: .leading, endPoint: .trailing
                            )
                        )
                        .frame(width: geo.size.width * max(0, min(1, percent)))
                        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: percent)
                }
            }
            .frame(height: 8)
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}

// MARK: - Enemy HP bar (used in combat)

struct EnemyHPBar: View {
    let enemy: Enemy

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(enemy.emoji).font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(enemy.name)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(enemy.is_boss ? Theme.warning : Theme.textPrimary)
                        if enemy.is_boss {
                            Text("BOSS").font(.system(size: 9, weight: .black))
                                .foregroundStyle(Theme.warning)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Theme.warning.opacity(0.2))
                                .clipShape(Capsule())
                        }
                        if enemy.stunned {
                            Text("STUNNED").font(.system(size: 9, weight: .black))
                                .foregroundStyle(Theme.mana)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Theme.mana.opacity(0.2))
                                .clipShape(Capsule())
                        }
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3).fill(Theme.surface)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(enemy.is_boss ? Theme.warning : Theme.danger)
                                .frame(width: geo.size.width * enemy.hpPercent)
                                .animation(.spring(response: 0.35), value: enemy.hpPercent)
                        }
                    }
                    .frame(height: 6)
                }
                Spacer()
                Text("\(enemy.hp)/\(enemy.max_hp)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .padding(10)
        .cardStyle()
    }
}
