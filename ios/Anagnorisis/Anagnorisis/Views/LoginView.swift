import SwiftUI

struct LoginView: View {
    @EnvironmentObject var vm: GameViewModel

    @State private var playerName: String = ""
    @State private var selectedClass: PlayerClass = .warrior
    @State private var showServerConfig = false
    @FocusState private var nameFocused: Bool

    private var canLogin: Bool {
        playerName.trimmingCharacters(in: .whitespaces).count >= 2 && vm.isConnected
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 32) {
                logoSection
                connectionBadge
                characterForm
                classGrid
                loginButton
                serverConfigSection
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 48)
        }
        .background(Theme.background.ignoresSafeArea())
        .onAppear { vm.connectToServer() }
    }

    // MARK: - Logo

    private var logoSection: some View {
        VStack(spacing: 12) {
            Text("⚔️")
                .font(.system(size: 64))
                .shadow(color: Theme.accent.opacity(0.6), radius: 20)

            Text("ANAGNORISIS")
                .font(Theme.titleFont(32))
                .foregroundStyle(Theme.accent)
                .tracking(4)

            Text("The Moment of Truth")
                .font(.system(size: 14, weight: .light, design: .serif))
                .foregroundStyle(Theme.textMuted)
                .italic()
        }
        .padding(.top, 16)
    }

    // MARK: - Connection badge

    private var connectionBadge: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(vm.isConnected ? Theme.success : Theme.danger)
                .frame(width: 8, height: 8)
                .shadow(color: vm.isConnected ? Theme.success : Theme.danger, radius: 4)
            Text(vm.isConnected ? "Server connected" : "Connecting…")
                .font(.caption)
                .foregroundStyle(vm.isConnected ? Theme.success : Theme.textMuted)
            if let error = vm.connectionError, !vm.isConnected {
                Button("Retry") { vm.connectToServer() }
                    .font(.caption.bold())
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.surface)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: - Name input

    private var characterForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "CHARACTER NAME")
            TextField("", text: $playerName, prompt: Text("Enter your name…").foregroundStyle(Theme.textMuted))
                .font(.system(size: 18, weight: .medium, design: .serif))
                .foregroundStyle(Theme.textPrimary)
                .focused($nameFocused)
                .padding(14)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(nameFocused ? Theme.accent : Theme.border, lineWidth: 1.5)
                )
                .autocorrectionDisabled()
        }
    }

    // MARK: - Class grid

    private var classGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "CHOOSE YOUR CLASS")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(PlayerClass.allCases, id: \.self) { cls in
                    ClassCard(cls: cls, isSelected: selectedClass == cls)
                        .onTapGesture { withAnimation(.spring(response: 0.2)) { selectedClass = cls } }
                }
            }
        }
    }

    // MARK: - Login button

    private var loginButton: some View {
        RPGButton(
            "Begin Your Quest",
            icon: selectedClass.emoji,
            color: Theme.accent,
            isDisabled: !canLogin
        ) {
            let name = playerName.trimmingCharacters(in: .whitespaces)
            vm.login(name: name, playerClass: selectedClass)
        }
    }

    // MARK: - Server config

    private var serverConfigSection: some View {
        VStack(spacing: 8) {
            Button {
                withAnimation { showServerConfig.toggle() }
            } label: {
                HStack {
                    Text("Server: \(vm.serverURL)")
                        .font(.caption)
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(1)
                    Image(systemName: showServerConfig ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }

            if showServerConfig {
                TextField("", text: $vm.serverURL,
                          prompt: Text("ws://192.168.x.x:8000/ws").foregroundStyle(Theme.textMuted))
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(10)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                RPGButton("Connect", icon: "🔌", color: Theme.accentDim) {
                    vm.connectToServer()
                }
                .frame(maxWidth: 200)
            }
        }
        .padding(.bottom, 16)
    }
}

// MARK: - Class Card

private struct ClassCard: View {
    let cls: PlayerClass
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 8) {
            Text(cls.emoji)
                .font(.system(size: 32))
                .shadow(color: isSelected ? Theme.accent.opacity(0.8) : .clear, radius: 10)

            Text(cls.displayName)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(isSelected ? Theme.accent : Theme.textPrimary)

            Text(cls.tagline)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(isSelected ? Theme.surfaceRaised : Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    isSelected
                        ? LinearGradient(colors: [Theme.accent, Theme.accentDim], startPoint: .top, endPoint: .bottom)
                        : LinearGradient(colors: [Theme.border], startPoint: .top, endPoint: .bottom),
                    lineWidth: isSelected ? 1.5 : 1
                )
        )
        .scaleEffect(isSelected ? 1.02 : 1.0)
    }
}
