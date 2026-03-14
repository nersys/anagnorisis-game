import Foundation

// MARK: - Delegate

protocol GameWebSocketDelegate: AnyObject {
    func socketDidConnect()
    func socketDidDisconnect(error: Error?)
    func socketDidReceive(message: WSMessage)
}

// MARK: - Service

final class GameWebSocketService: NSObject {
    // Exposed so UI can show connection state
    private(set) var isConnected = false

    weak var delegate: GameWebSocketDelegate?

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var pingTimer: Timer?
    private var serverURL: URL?

    // MARK: Connect / Disconnect

    func connect(to urlString: String) {
        guard let url = URL(string: urlString) else {
            print("[WS] Invalid URL: \(urlString)")
            return
        }
        serverURL = url
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
        urlSession = session
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()
        listenForMessages()
        schedulePing()
    }

    func disconnect() {
        pingTimer?.invalidate()
        pingTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        isConnected = false
    }

    // MARK: Send

    func send(_ payload: [String: Any]) {
        guard let task = webSocketTask, isConnected else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        task.send(.string(json)) { error in
            if let error { print("[WS] Send error: \(error)") }
        }
    }

    func sendMessage(type: String, payload: [String: Any] = [:]) {
        send(["type": type, "payload": payload])
    }

    // MARK: Receive loop

    private func listenForMessages() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handle(text: text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handle(text: text)
                    }
                @unknown default:
                    break
                }
                self.listenForMessages()  // re-arm
            case .failure(let error):
                print("[WS] Receive error: \(error)")
                self.isConnected = false
                DispatchQueue.main.async {
                    self.delegate?.socketDidDisconnect(error: error)
                }
            }
        }
    }

    private func handle(text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            let msg = try JSONDecoder().decode(WSMessage.self, from: data)
            DispatchQueue.main.async {
                self.delegate?.socketDidReceive(message: msg)
            }
        } catch {
            print("[WS] Decode error: \(error)\nRaw: \(text)")
        }
    }

    // MARK: Ping / keepalive

    private func schedulePing() {
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            self?.webSocketTask?.sendPing { _ in }
            self?.sendMessage(type: "heartbeat")
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension GameWebSocketService: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        isConnected = true
        print("[WS] Connected ✓")
        DispatchQueue.main.async { self.delegate?.socketDidConnect() }
    }

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        isConnected = false
        print("[WS] Closed: \(closeCode)")
        DispatchQueue.main.async { self.delegate?.socketDidDisconnect(error: nil) }
    }
}
