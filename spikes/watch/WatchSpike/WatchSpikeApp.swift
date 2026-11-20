import SwiftUI

@main
struct WatchSpikeApp: App {
    @StateObject private var client = BridgeClient()
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(client) }
    }
}

struct ContentView: View {
    @EnvironmentObject var client: BridgeClient
    var body: some View {
        VStack(spacing: 6) {
            Text(client.state).font(.headline)
            Text(client.lastLine).font(.caption).lineLimit(3)
            if client.running {
                Button(client.muted ? "Unmute" : "Mute") { client.setMuted(!client.muted) }
                Button("Stop", role: .destructive) { client.stop() }
            } else {
                Button("Start") { client.start() }
            }
        }
    }
}
