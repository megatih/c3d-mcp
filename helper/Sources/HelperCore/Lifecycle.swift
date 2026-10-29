import Foundation

/// Launching Cheetah3D and creating documents.
public struct Lifecycle: Sendable {
    public static let launchTimeoutMs = 30_000
    public static let newWindowTimeoutMs = 5_000

    let ax: any AXProvider
    let presser: Presser

    public init(ax: any AXProvider, presser: Presser) {
        self.ax = ax
        self.presser = presser
    }

    /// Starts Cheetah3D if needed and waits until its AX menu bar is populated.
    public func launchApp() async throws -> Int32 {
        guard ax.isProcessTrusted() else {
            throw HelperError(.permissionMissing, "Accessibility permission is not granted to the helper")
        }
        let pid: Int32
        if let app = ax.cheetahApp() {
            pid = app.pid
        } else {
            do { pid = try await ax.launchCheetah() } catch let e as HelperError { throw e } catch {
                throw HelperError(.internalError, "could not launch Cheetah3D: \(error.localizedDescription)")
            }
        }
        let start = ax.nowMs()
        while true {
            if let bar = ax.menuBar(pid: pid), !bar.children.isEmpty { return pid }
            if ax.nowMs() - start >= Self.launchTimeoutMs {
                throw HelperError(.timeout, "Cheetah3D menu bar did not appear within \(Self.launchTimeoutMs / 1000) s")
            }
            await ax.sleep(ms: 250)
        }
    }

    /// File > New, then reports the title of the window that appeared.
    public func newDocument() async throws -> String {
        let app = try presser.preflight()
        let before = ax.windows(pid: app.pid).map { $0.title ?? "" }
        _ = try await presser.press(PressRequest(path: Cheetah.newDocumentMenuPath, requireDocumentWindow: false))
        let start = ax.nowMs()
        while true {
            let now = ax.windows(pid: app.pid).map { $0.title ?? "" }
            if let fresh = now.first(where: { !before.contains($0) }) ?? (now.count > before.count ? now.last : nil) {
                return fresh
            }
            if ax.nowMs() - start >= Self.newWindowTimeoutMs {
                throw HelperError(.triggerFailed, "no new window appeared after File > New",
                                  details: .object(["windows": .array(now.map(JSONValue.string))]))
            }
            await ax.sleep(ms: Presser.pollMs)
        }
    }
}
