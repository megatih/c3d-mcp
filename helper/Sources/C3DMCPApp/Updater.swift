import AppKit
import Foundation
import HelperCore
#if canImport(Sparkle)
import Sparkle
#endif

/// In-app updates (Sparkle 2). Updates are verified with an EdDSA signature (SUPublicEDKey in Info.plist), not with an Apple certificate, so they
/// work for this self-signed app; the feed is `appcast.xml` on the latest GitHub release.
@MainActor
final class UpdateController: NSObject, ObservableObject {
    @Published var status = "Not checked yet."
    @Published var automatic = true
    let isAvailable: Bool

    #if canImport(Sparkle)
    private var controller: SPUStandardUpdaterController?

    override init() {
        isAvailable = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") != nil
        super.init()
        guard isAvailable else { status = "Updates are not set up in this build."; return }
        let c = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
        controller = c
        automatic = c.updater.automaticallyChecksForUpdates
    }

    func check() { controller?.checkForUpdates(nil) }

    /// The silent, scheduled-style check (installs without a dialog when automatic updates are on).
    func checkInBackground() { controller?.updater.checkForUpdatesInBackground() }

    func setAutomatic(_ on: Bool) {
        controller?.updater.automaticallyChecksForUpdates = on
        automatic = on
    }
    #else
    override init() {
        isAvailable = false
        super.init()
        status = "Updates are not included in this build."
    }
    func check() {}
    func checkInBackground() {}
    func setAutomatic(_ on: Bool) {}
    #endif

    fileprivate func note(_ text: String) {
        status = text
        HelperLog.standard().info("updates: \(text)")
    }
}

#if canImport(Sparkle)
extension UpdateController: SPUUpdaterDelegate {
    /// Test hook: C3D_FEED_URL points the app at a local feed. Every update is still verified against SUPublicEDKey.
    nonisolated func feedURLString(for updater: SPUUpdater) -> String? { ProcessInfo.processInfo.environment["C3D_FEED_URL"] }

    nonisolated func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        let text = "Update available: \(item.displayVersionString)"
        Task { @MainActor in self.note(text) }
    }

    nonisolated func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: any Error) {
        Task { @MainActor in self.note("You have the latest version.") }
    }

    nonisolated func updater(_ updater: SPUUpdater, didAbortWithError error: any Error) {
        let text = "Update check failed: \(error.localizedDescription)"
        Task { @MainActor in self.note(text) }
    }
}
#endif
