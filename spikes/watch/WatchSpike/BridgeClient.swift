import AVFoundation
import Foundation

/// Spike client for docs/watch-protocol.md. Fill in `config` before running.
/// SPIKE ONLY: nothing here has been run on a device. It is the starting point for the Xcode steps
/// in docs/spike-apple-watch.md.
enum config {
    /// From `POST /v1/me/watch/ticket` (sign-in carried over from the phone app comes in T28).
    static let ticketURL = URL(string: "https://YOUR-SERVER/v1/me/watch/ticket")!
    static let idToken = "FIREBASE_ID_TOKEN"
    static let roomId = "rm_..."
}

@MainActor
final class BridgeClient: ObservableObject {
    @Published var state = "Idle"
    @Published var lastLine = ""
    @Published var running = false
    @Published var muted = false

    private var socket: URLSessionWebSocketTask?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    // 16 kHz mono 16-bit PCM, little endian, as the protocol says.
    private let wire = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

    func start() {
        Task {
            do {
                let (ticket, socketURL) = try await fetchTicket()
                try configureSession()
                let task = URLSession.shared.webSocketTask(with: socketURL)
                socket = task
                task.resume()
                try await send(["type": "start", "version": 1, "ticket": ticket])
                listen()
                try startAudio()
                running = true
                state = "Connecting"
            } catch { state = "Error: \(error.localizedDescription)" }
        }
    }

    func stop() { Task { try? await send(["type": "stop"]) } }
    func setMuted(_ m: Bool) { Task { try? await send(["type": "mute", "muted": m]) } }

    private func fetchTicket() async throws -> (String, URL) {
        var req = URLRequest(url: config.ticketURL)
        req.httpMethod = "POST"
        req.setValue("Bearer \(config.idToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["roomId": config.roomId])
        let (data, _) = try await URLSession.shared.data(for: req)
        let o = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        return (o["ticket"] as! String, URL(string: o["socketUrl"] as! String)!)
    }

    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .voiceChat)
        try s.setActive(true)
    }

    private func startAudio() throws {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: wire)
        let input = engine.inputNode
        guard let conv = AVAudioConverter(from: input.outputFormat(forBus: 0), to: wire) else { return }
        input.installTap(onBus: 0, bufferSize: 1600, format: input.outputFormat(forBus: 0)) { [weak self] buf, _ in
            guard let self else { return }
            let out = AVAudioPCMBuffer(pcmFormat: self.wire, frameCapacity: 1600)!
            var used = false
            conv.convert(to: out, error: nil) { _, status in
                if used { status.pointee = .noDataNow; return nil }
                used = true; status.pointee = .haveData; return buf
            }
            let bytes = out.int16ChannelData![0]
            let data = Data(bytes: bytes, count: Int(out.frameLength) * 2)
            self.socket?.send(.data(data)) { _ in }
        }
        try engine.start()
        player.play()
    }

    private func send(_ obj: [String: Any]) async throws {
        let d = try JSONSerialization.data(withJSONObject: obj)
        try await socket?.send(.string(String(decoding: d, as: UTF8.self)))
    }

    private func listen() {
        socket?.receive { [weak self] result in
            guard let self, case .success(let msg) = result else { return }
            Task { @MainActor in
                switch msg {
                case .data(let d): self.play(d)
                case .string(let s): self.handle(s)
                @unknown default: break
                }
                self.listen()
            }
        }
    }

    private func play(_ d: Data) {
        let frames = AVAudioFrameCount(d.count / 2)
        guard let buf = AVAudioPCMBuffer(pcmFormat: wire, frameCapacity: frames) else { return }
        buf.frameLength = frames
        d.withUnsafeBytes { buf.int16ChannelData![0].update(from: $0.bindMemory(to: Int16.self).baseAddress!, count: Int(frames)) }
        player.scheduleBuffer(buf)
    }

    private func handle(_ s: String) {
        guard let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return }
        switch o["type"] as? String {
        case "started": state = "Connected"
        case "agent_state": state = (o["state"] as? String ?? "").capitalized
        case "transcript": lastLine = "\(o["speaker"] ?? ""): \(o["text"] ?? "")"
        case "muted": muted = o["muted"] as? Bool ?? false
        case "stopped": running = false; state = "Stopped"; engine.inputNode.removeTap(onBus: 0); engine.stop()
        case "error": state = "Error: \(o["message"] ?? "")"
        default: break
        }
    }
}
