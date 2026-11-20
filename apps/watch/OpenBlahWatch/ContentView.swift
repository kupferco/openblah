import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var client: SessionClient

    var body: some View {
        VStack(spacing: 6) {
            if !auth.signedIn {
                Text("Open OpenBlah on your iPhone to sign in")
                    .font(.footnote).multilineTextAlignment(.center)
            } else if client.isActive {
                Text(statusText).font(.headline)
                if !client.lastLine.isEmpty {
                    Text(client.lastLine).font(.caption).lineLimit(3)
                }
                HStack {
                    Button(client.muted ? "Unmute" : "Mute") { client.toggleMute() }
                    Button("Stop", role: .destructive) { client.stop() }
                }
                .disabled(client.phase != .live)
            } else {
                if let e = client.error { Text(e).font(.caption).foregroundStyle(.red) }
                Button(client.phase == .stopped ? "Talk again" : "Talk to \(client.agentName)") { client.start() }
            }
        }
        .padding(.horizontal)
    }

    private var statusText: String {
        if client.phase == .connecting { return "Connecting…" }
        switch client.agentState {
        case "listening": return "\(client.agentName) is listening"
        case "thinking": return "\(client.agentName) is thinking"
        case "speaking": return "\(client.agentName) is speaking"
        default: return client.muted ? "Muted" : "Connected"
        }
    }
}
