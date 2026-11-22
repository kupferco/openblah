import SwiftUI
import WidgetKit

/// The watch-face complication: raise wrist, tap, talk. A tap opens the app through
/// `openblah-watch://start`, and the app starts the session on launch. A complication cannot
/// open the microphone itself (docs/spike-apple-watch.md), so the app does it in the foreground.
struct Entry: TimelineEntry { let date: Date }

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}

struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Text("OpenBlah").font(.headline)
                Text("Tap to talk").font(.caption)
            }
        case .accessoryInline:
            Text("OpenBlah: tap to talk")
        default:
            Image(systemName: "waveform.circle.fill").font(.title2)
        }
    }
}

@main
struct OpenBlahComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OpenBlahComplication", provider: Provider()) { _ in
            ComplicationView()
                .widgetURL(URL(string: "openblah-watch://start"))
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("OpenBlah")
        .description("Tap to talk to your agent.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}
