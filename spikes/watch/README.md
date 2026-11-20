# watch (spike T27)

A bare watchOS app for the checks in `docs/spike-apple-watch.md`. It speaks the protocol in `docs/watch-protocol.md`. Not production code: it has never been run on a device.

On your Mac:

    git checkout feat/t27-apple-watch-part-1
    brew install xcodegen
    cd spikes/watch && xcodegen generate && open WatchSpike.xcodeproj

Then follow "Steps for Dani" in `docs/spike-apple-watch.md`.
