import SwiftUI

/// Central design system — dark fantasy/RPG aesthetic.
enum Theme {
    // MARK: - Colours
    static let background  = Color(red: 0.05, green: 0.05, blue: 0.08)   // Near-black charcoal
    static let surface     = Color(red: 0.10, green: 0.10, blue: 0.16)   // Dark panel
    static let surfaceRaised = Color(red: 0.14, green: 0.14, blue: 0.21) // Card / elevated
    static let border      = Color(red: 0.28, green: 0.22, blue: 0.14)   // Warm dark border

    static let accent      = Color(red: 0.80, green: 0.66, blue: 0.28)   // Gold
    static let accentDim   = Color(red: 0.50, green: 0.40, blue: 0.16)   // Muted gold

    static let danger      = Color(red: 0.86, green: 0.18, blue: 0.18)   // Crimson HP
    static let mana        = Color(red: 0.30, green: 0.42, blue: 0.95)   // Cobalt MP
    static let success     = Color(red: 0.18, green: 0.72, blue: 0.38)   // Emerald
    static let warning     = Color(red: 0.95, green: 0.65, blue: 0.10)   // Amber warning

    static let textPrimary = Color(red: 0.92, green: 0.88, blue: 0.82)   // Warm off-white
    static let textMuted   = Color(red: 0.55, green: 0.50, blue: 0.44)   // Muted gray-brown

    // Phase tint colours
    static func phaseColour(_ phase: GamePhase) -> Color {
        switch phase {
        case .exploring: return accent
        case .combat:    return danger
        case .looting:   return warning
        case .victory:   return success
        case .gameOver:  return textMuted
        }
    }

    // MARK: - Fonts
    static func titleFont(_ size: CGFloat = 28) -> Font {
        .system(size: size, weight: .bold, design: .serif)
    }
    static func bodyFont(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }
    static func monoFont(_ size: CGFloat = 13) -> Font {
        .system(size: size, weight: .regular, design: .monospaced)
    }

    // MARK: - Card modifier
    struct CardStyle: ViewModifier {
        func body(content: Content) -> some View {
            content
                .background(Theme.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Theme.border, lineWidth: 1)
                )
        }
    }

    struct GoldBorderStyle: ViewModifier {
        func body(content: Content) -> some View {
            content
                .background(Theme.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(
                            LinearGradient(
                                colors: [Theme.accent, Theme.accentDim, Theme.accent],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            ),
                            lineWidth: 1.5
                        )
                )
        }
    }
}

extension View {
    func cardStyle() -> some View     { modifier(Theme.CardStyle()) }
    func goldBorderStyle() -> some View { modifier(Theme.GoldBorderStyle()) }
}

// MARK: - Reusable RPG button

struct RPGButton: View {
    let title: String
    let icon: String?
    let color: Color
    let action: () -> Void
    var isDisabled: Bool = false

    init(_ title: String, icon: String? = nil, color: Color = Theme.accent, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.color = color
        self.isDisabled = isDisabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Text(icon) }
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundStyle(isDisabled ? Theme.textMuted : Theme.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(isDisabled ? Theme.surface : color)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(isDisabled ? Theme.border : color.opacity(0.4), lineWidth: 1)
            )
        }
        .disabled(isDisabled)
        .animation(.easeInOut(duration: 0.15), value: isDisabled)
    }
}

// MARK: - Section header

struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Theme.textMuted)
            .tracking(1.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
    }
}
