import SwiftUI

@main
struct OpenBlahWatchApp: App {
    @StateObject private var auth: AuthStore
    @StateObject private var client: SessionClient
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let a = AuthStore()
        _auth = StateObject(wrappedValue: a)
        _client = StateObject(wrappedValue: SessionClient(auth: a))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .environmentObject(client)
                // The complication opens `openblah-watch://start`: begin talking right away.
                .onOpenURL { url in
                    if url.host == "start", auth.signedIn { client.start() }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            // Never leave the microphone open when the app is not on screen and nothing is live.
            if phase == .background, client.phase == .connecting { client.stop() }
        }
    }
}
