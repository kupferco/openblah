import Foundation

/// Server address and Firebase web API key come from the build settings in project.yml
/// (through Info.plist), never from code.
enum Config {
    static var serverURL: URL {
        let s = Bundle.main.object(forInfoDictionaryKey: "OpenBlahServerURL") as? String ?? ""
        return URL(string: s) ?? URL(string: "https://invalid.example")!
    }
    static var firebaseAPIKey: String {
        Bundle.main.object(forInfoDictionaryKey: "OpenBlahFirebaseAPIKey") as? String ?? ""
    }
}
