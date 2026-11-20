import AVFoundation
import Foundation

/// Thin audio client for docs/watch-protocol.md. All logic (agent, tools, keys, limits) is on the
/// server: this records the microphone, plays the answer and shows state and the latest line.
@MainActor
final class SessionClient: ObservableObject {
    enum Phase { case idle, connecting, live, stopped }

    @Published var phase = Phase.idle
    @Published var agentState = ""
    @Published var agentName = "Blah"
    @Published var lastLine = ""
    @Published var muted = false
    @Published var error: String?

    private let auth: AuthStore
    private var socket: URLSessionWebSocketTask?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    // 16 kHz mono 16-bit PCM, little endian, as the protocol says.
    private let wire = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    private var generation = 0

    init(auth: AuthStore) { self.auth = auth }

    var isActive: Bool { phase == .connecting || phase == .live }

    /// Start a new call with the agent. Safe to call twice (the complication and the Start button).
    func start() {
        guard !isActive else { return }
        generation += 1
        let gen = generation
        phase = .connecting
        error = nil
        agentState = ""
        lastLine = ""
        muted = false
        Task {
            do {
                let ticket = try await fetchTicket()
                guard gen == generation else { return }
                try configureSession()
                let task = URLSession.shared.webSocketTask(with: ticket.socketURL)
                socket = task
                task.resume()
                try await send(["type": "start", "version": 1, "ticket": ticket.ticket])
                listen(task, gen)
                try startAudio()
            } catch {
                guard gen == generation else { return }
                fail(error.localizedDescription)
            }
        }
    }

    func stop() {
        Task { try? await send(["type": "stop"]) }
        // If the server does not answer, do not leave the microphone open.
        let gen = generation
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if gen == generation, isActive { finish(.stopped) }
        }
    }

    func toggleMute() {
        let next = !muted
        Task { try? await send(["type": "mute", "muted": next]) }
    }

    // MARK: Network
    private struct Ticket { let ticket: String; let socketURL: URL }

    private func fetchTicket() async throws -> Ticket {
        let token = try await auth.validIdToken()
        var req = URLRequest(url: Config.serverURL.appendingPathComponent("v1/me/watch/ticket"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // No roomId: the server starts a new call with the agent on.
        req.httpBody = try JSONSerialization.data(withJSONObject: ["displayName": "Watch"])
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200, let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let t = o["ticket"] as? String, let s = o["socketUrl"] as? String, let url = URL(string: s) else {
            throw status == 404 ? WatchError.notEnabled : WatchError.server(status)
        }
        return Ticket(ticket: t, socketURL: url)
    }

    private func send(_ obj: [String: Any]) async throws {
        let d = try JSONSerialization.data(withJSONObject: obj)
        try await socket?.send(.string(String(decoding: d, as: UTF8.self)))
    }

    private func listen(_ task: URLSessionWebSocketTask, _ gen: Int) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, gen == self.generation else { return }
                switch result {
                case .failure: if self.isActive { self.fail("Connection lost") }
                case .success(let msg):
                    switch msg {
                    case .data(let d): self.play(d)
                    case .string(let s): self.handle(s)
                    @unknown default: break
                    }
                    self.listen(task, gen)
                }
            }
        }
    }

    private func handle(_ s: String) {
        guard let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return }
        switch o["type"] as? String {
        case "started":
            phase = .live
            agentName = o["agentName"] as? String ?? agentName
        case "agent_state": agentState = o["state"] as? String ?? ""
        case "transcript":
            let line = "\(o["speaker"] ?? ""): \(o["text"] ?? "")"
            lastLine = line
        case "muted": muted = o["muted"] as? Bool ?? false
        case "stopped": finish(.stopped)
        case "error": fail(o["message"] as? String ?? "Error")
        default: break
        }
    }

    // MARK: Audio
    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .voiceChat)
        try s.setActive(true)
    }

    private func startAudio() throws {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: wire)
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard let conv = AVAudioConverter(from: inFormat, to: wire) else { throw WatchError.audio }
        let ratio = wire.sampleRate / inFormat.sampleRate
        input.installTap(onBus: 0, bufferSize: 4800, format: inFormat) { [weak self] buf, _ in
            guard let self else { return }
            let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 16
            guard let out = AVAudioPCMBuffer(pcmFormat: self.wire, frameCapacity: cap) else { return }
            var used = false
            conv.convert(to: out, error: nil) { _, status in
                if used { status.pointee = .noDataNow; return nil }
                used = true; status.pointee = .haveData; return buf
            }
            guard out.frameLength > 0, let ch = out.int16ChannelData?[0] else { return }
            let data = Data(bytes: ch, count: Int(out.frameLength) * 2)
            Task { @MainActor in self.socket?.send(.data(data)) { _ in } }
        }
        try engine.start()
        player.play()
    }

    private func play(_ d: Data) {
        let frames = AVAudioFrameCount(d.count / 2)
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: wire, frameCapacity: frames) else { return }
        buf.frameLength = frames
        d.withUnsafeBytes { raw in
            buf.int16ChannelData![0].update(from: raw.bindMemory(to: Int16.self).baseAddress!, count: Int(frames))
        }
        player.scheduleBuffer(buf)
    }

    // MARK: End
    private func fail(_ message: String) {
        error = message
        finish(.stopped)
    }

    private func finish(_ next: Phase) {
        generation += 1
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        phase = next
        agentState = ""
    }
}

enum WatchError: LocalizedError {
    case notEnabled, server(Int), audio
    var errorDescription: String? {
        switch self {
        case .notEnabled: return "Watch is not enabled on this server"
        case .server(let c): return "Server error \(c)"
        case .audio: return "Microphone unavailable"
        }
    }
}
