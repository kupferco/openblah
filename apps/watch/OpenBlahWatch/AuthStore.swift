import Foundation
import Security
import WatchConnectivity

/// Sign-in carried over from the phone app. The phone sends the Firebase refresh token once
/// (WatchConnectivity application context, see docs/watch.md). The watch keeps it in its own
/// Keychain and exchanges it for ID tokens itself, so the watch keeps working with the phone away.
/// The refresh token never leaves the Keychain or goes to anything except Google's token endpoint.
@MainActor
final class AuthStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var signedIn = false
    private var idToken: String?
    private var expiresAt = Date.distantPast
    private let account = "firebase-refresh-token"

    override init() {
        super.init()
        signedIn = readRefreshToken() != nil
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    /// A valid ID token, refreshed when it has under a minute left.
    func validIdToken() async throws -> String {
        if let t = idToken, expiresAt.timeIntervalSinceNow > 60 { return t }
        guard let refresh = readRefreshToken() else { throw AuthError.signedOut }
        var comps = URLComponents(string: "https://securetoken.googleapis.com/v1/token")!
        comps.queryItems = [URLQueryItem(name: "key", value: Config.firebaseAPIKey)]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refresh),
        ]
        req.httpBody = form.percentEncodedQuery?.data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = o["id_token"] as? String else {
            // Revoked or deleted account: ask for a new sign-in from the phone.
            if (resp as? HTTPURLResponse)?.statusCode == 400 { signOut() }
            throw AuthError.refreshFailed
        }
        idToken = id
        expiresAt = Date().addingTimeInterval(Double(o["expires_in"] as? String ?? "3600") ?? 3600)
        if let newRefresh = o["refresh_token"] as? String, newRefresh != refresh { saveRefreshToken(newRefresh) }
        return id
    }

    func signOut() {
        SecItemDelete(query() as CFDictionary)
        idToken = nil
        signedIn = false
    }

    // MARK: WCSessionDelegate
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if state == .activated { Task { @MainActor in self.accept(session.receivedApplicationContext) } }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) {
        Task { @MainActor in self.accept(ctx) }
    }

    /// `["refreshToken": String]` sends a sign-in; `["signedOut": true]` removes it.
    private func accept(_ ctx: [String: Any]) {
        if ctx["signedOut"] as? Bool == true { return signOut() }
        guard let t = ctx["refreshToken"] as? String, !t.isEmpty else { return }
        saveRefreshToken(t)
        idToken = nil
        signedIn = true
    }

    // MARK: Keychain
    private func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "dev.openblah.watch",
         kSecAttrAccount as String: account]
    }
    private func readRefreshToken() -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    private func saveRefreshToken(_ t: String) {
        SecItemDelete(query() as CFDictionary)
        var q = query()
        q[kSecValueData as String] = Data(t.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }
}

enum AuthError: LocalizedError {
    case signedOut, refreshFailed
    var errorDescription: String? {
        switch self {
        case .signedOut: return "Open OpenBlah on your iPhone to sign in"
        case .refreshFailed: return "Sign-in failed. Try again"
        }
    }
}
