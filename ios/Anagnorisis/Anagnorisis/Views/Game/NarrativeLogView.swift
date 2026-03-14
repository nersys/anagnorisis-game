import SwiftUI

/// Scrollable narrative / combat log with colour-coded entries.
struct NarrativeLogView: View {
    let entries: [NarrativeEntry]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(entries) { entry in
                        LogEntryRow(entry: entry)
                            .id(entry.id)
                    }
                }
                .padding(12)
            }
            .onChange(of: entries.count) { _, _ in
                if let last = entries.last {
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))
    }
}

private struct LogEntryRow: View {
    let entry: NarrativeEntry

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Colour accent bar
            RoundedRectangle(cornerRadius: 2)
                .fill(accentColor)
                .frame(width: 3)

            Text(entry.text)
                .font(textFont)
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .animation(.easeOut(duration: 0.25), value: entry.id)
    }

    private var accentColor: Color {
        switch entry.kind {
        case .narrative: return Theme.accentDim
        case .combat:    return Theme.danger
        case .system:    return Theme.mana
        case .loot:      return Theme.warning
        case .error:     return Theme.danger.opacity(0.6)
        }
    }

    private var textColor: Color {
        switch entry.kind {
        case .narrative: return Theme.textPrimary
        case .combat:
            let t = entry.text.lowercased()
            if t.contains("victory") || t.contains("defeat") || t.contains("slain") { return Theme.danger }
            if t.contains("heal") || t.contains("restore") { return Theme.success }
            if t.contains("xp") || t.contains("gold") { return Theme.warning }
            return Theme.textPrimary
        case .system:    return Theme.mana
        case .loot:      return Theme.warning
        case .error:     return Theme.danger
        }
    }

    private var textFont: Font {
        switch entry.kind {
        case .narrative: return .system(size: 14, design: .serif)
        case .combat:    return .system(size: 13, weight: .medium)
        case .system:    return .system(size: 13, design: .default)
        case .loot:      return .system(size: 13, weight: .semibold)
        case .error:     return .system(size: 13, weight: .medium)
        }
    }
}
