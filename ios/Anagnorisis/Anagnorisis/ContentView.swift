import SwiftUI

struct ContentView: View {
    @EnvironmentObject var vm: GameViewModel

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            Group {
                switch vm.screen {
                case .login:
                    LoginView()
                        .transition(.asymmetric(
                            insertion: .opacity,
                            removal: .move(edge: .leading).combined(with: .opacity)
                        ))
                case .lobby:
                    LobbyView()
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal:   .move(edge: .leading).combined(with: .opacity)
                        ))
                case .game:
                    GameView()
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .opacity
                        ))
                }
            }
            .animation(.easeInOut(duration: 0.35), value: vm.screen)

            // Global toast
            if let toast = vm.toastMessage {
                VStack {
                    Spacer()
                    Text(toast)
                        .font(.callout)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(Theme.surface.opacity(0.95))
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
                        .padding(.bottom, 40)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                .animation(.spring(response: 0.3), value: toast)
            }
        }
    }
}
