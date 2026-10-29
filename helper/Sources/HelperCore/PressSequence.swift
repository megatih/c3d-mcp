import Foundation

public struct PressRequest: Sendable, Equatable {
    public var path: [String]
    public var timeoutMs = 2000
    /// Raise the document window with exactly this title (otherwise the main document window).
    public var docTitle: String?
    public var requireDocumentWindow = true
    /// Text of a dialog this press is expected to open; it is then registered as an own modal.
    public var ownModalText: String?

    public init(path: [String], timeoutMs: Int = 2000, docTitle: String? = nil,
                requireDocumentWindow: Bool = true, ownModalText: String? = nil) {
        self.path = path
        self.timeoutMs = timeoutMs
        self.docTitle = docTitle
        self.requireDocumentWindow = requireDocumentWindow
        self.ownModalText = ownModalText
    }
}

public struct PressOutcome: Sendable, Equatable {
    /// Milliseconds from activation until the menu item reported `AXEnabled`.
    public var activatedMs: Int
    /// True when the press ended in `kAXErrorCannotComplete` (dispatched, target busy).
    public var busy: Bool
}

/// PROTOCOL section 2.1: remember frontmost -> activate -> raise window -> poll enabled -> press -> restore.
public struct Presser: Sendable {
    public static let pollMs = 25
    public static let settleMs = 50

    let ax: any AXProvider
    let modals: OwnModalRegistry

    public init(ax: any AXProvider, modals: OwnModalRegistry) {
        self.ax = ax
        self.modals = modals
    }

    /// Permission and process pre-checks shared by every AX command.
    public func requireRunning() throws -> RunningApp {
        guard ax.isProcessTrusted() else {
            throw HelperError(.permissionMissing, "Accessibility permission is not granted to the helper",
                              hint: "System Settings > Privacy & Security > Accessibility: enable C3D Bridge Helper.")
        }
        guard let app = ax.cheetahApp() else {
            throw HelperError(.appNotRunning, "Cheetah3D is not running")
        }
        return app
    }

    /// `requireRunning` plus the modal check.
    public func preflight() throws -> RunningApp {
        let app = try requireRunning()
        let foreign = ModalDetector.detect(windows: ax.windows(pid: app.pid), registry: modals, nowMs: ax.nowMs())
            .map(\.info).filter { !$0.own }
        if !foreign.isEmpty { throw ModalDetector.blocked(by: foreign) }
        return app
    }

    public func press(_ r: PressRequest) async throws -> PressOutcome {
        let app = try preflight()
        guard ax.menuBar(pid: app.pid) != nil else {
            throw HelperError(.triggerFailed, "Cheetah3D has no accessible menu bar yet")
        }
        _ = try resolveItem(pid: app.pid, path: r.path)
        let target = try documentWindow(pid: app.pid, title: r.docTitle, required: r.requireDocumentWindow)

        let previous = ax.frontmostApp().flatMap { $0.pid == app.pid ? nil : $0 }
        let activatedAt = ax.nowMs()
        if !app.isFrontmost { _ = ax.activate(pid: app.pid) }
        defer { if let previous { _ = ax.activate(pid: previous.pid) } }

        if let target { _ = target.raise() }
        try await waitEnabled(pid: app.pid, path: r.path, timeoutMs: r.timeoutMs)
        let activatedMs = ax.nowMs() - activatedAt

        let item = try resolveItem(pid: app.pid, path: r.path)
        let result = item.press()
        let busy: Bool
        switch result {
        case .success: busy = false
        case .cannotComplete: busy = true
        case .failed(let code):
            throw HelperError(.triggerFailed, "AXPress failed",
                              details: .object(["axError": .int(Int(code)), "path": .array(r.path.map(JSONValue.string))]))
        }
        if let text = r.ownModalText { modals.register(text, nowMs: ax.nowMs()) }
        await ax.sleep(ms: Self.settleMs)
        return PressOutcome(activatedMs: activatedMs, busy: busy)
    }

    func resolveItem(pid: Int32, path: [String]) throws -> any UIElement {
        guard let bar = ax.menuBar(pid: pid) else {
            throw HelperError(.triggerFailed, "Cheetah3D has no accessible menu bar")
        }
        return try MenuWalker.resolve(menuBar: bar, path: path)
    }

    func waitEnabled(pid: Int32, path: [String], timeoutMs: Int) async throws {
        let start = ax.nowMs()
        while true {
            if try resolveItem(pid: pid, path: path).isEnabled { return }
            let waited = ax.nowMs() - start
            if waited >= timeoutMs {
                throw HelperError(
                    .triggerFailed, "menu item stayed disabled",
                    hint: "Cheetah3D needs a key document window; close panels (Render Manager) or create a document.",
                    details: .object([
                        "path": .array(path.map(JSONValue.string)),
                        "waitedMs": .int(waited),
                        "frontmost": .bool(ax.frontmostApp()?.pid == pid),
                        "windows": .array(ax.windows(pid: pid).map { .string($0.title ?? "") }),
                    ]))
            }
            await ax.sleep(ms: Self.pollMs)
        }
    }

    func documentWindow(pid: Int32, title: String?, required: Bool) throws -> (any UIElement)? {
        let candidates = ax.windows(pid: pid).filter {
            !ModalDetector.isDialog($0) && ($0.role ?? "AXWindow") == "AXWindow"
        }
        let picked: (any UIElement)?
        if let title {
            picked = candidates.first { $0.title == title }
        } else {
            let docs = candidates.filter { !Cheetah.nonDocumentWindowTitles.contains($0.title ?? "") }
            picked = docs.first(where: \.isMain) ?? docs.first
        }
        if picked == nil, required {
            throw HelperError(
                .triggerFailed, title.map { "document window `\($0)` not found" } ?? "no document window open",
                hint: "Open a document (newDocument) first.",
                details: .object(["windows": .array(candidates.map { .string($0.title ?? "") })]))
        }
        return picked
    }
}
