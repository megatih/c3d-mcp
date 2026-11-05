import AppCore
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import HelperCore

@MainActor
final class AppModel: ObservableObject {
    // Engine
    let engine: Engine?
    let appPath = Bundle.main.bundlePath

    // State shown in the window
    @Published var status: InstallStatus?
    @Published var doctor: DoctorReport?
    @Published var clients: [ClientRow] = []
    @Published var legacy: [LegacyFinding] = []
    @Published var approval: ApprovalMode = .session
    @Published var accessibility = false
    @Published var screenRecording = false
    @Published var helperState: HelperHost.State = .failed("not started")
    @Published var busy: String?
    @Published var banner: Banner?
    @Published var logText = ""
    @Published var showMigration = false
    @Published var lastReport: String?

    struct Banner: Identifiable, Equatable {
        enum Kind { case info, success, error }
        let id = UUID()
        let kind: Kind
        let text: String
    }

    private let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cheetah3D")
    var settingsURL: URL { support.appendingPathComponent("MCP/settings.json") }
    var helperLogURL: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/c3d-mcp/helper.log") }
    private var keepArgs: [String] { ["--keep-path", appPath] }
    private var firstLoadDone = false

    init(engine: Engine? = EngineLocator.locate().map { Engine(locator: $0) }) {
        self.engine = engine
        approval = SettingsFile.read(at: settingsURL)
    }

    // MARK: running work

    private func work<T>(_ title: String, _ body: () async throws -> T) async -> T? {
        busy = title
        defer { busy = nil }
        do { return try await body() } catch {
            banner = Banner(kind: .error, text: "\(error)")
            return nil
        }
    }

    private func requireEngine() throws -> Engine {
        guard let engine else { throw EngineError.notFound("This copy of C3D MCP has no bundled engine. Download the app again from the releases page.") }
        return engine
    }

    // MARK: refresh

    func refresh() async {
        refreshPermissions()
        guard let engine else {
            banner = Banner(kind: .error, text: "The bundled engine is missing from this app. Download C3D MCP again.")
            return
        }
        busy = "Checking…"
        defer { busy = nil }
        async let s = try? engine.json(InstallStatus.self, ["status"]).value
        async let d = try? engine.json(DoctorReport.self, ["doctor"]).value
        async let c = try? engine.json([ClientRow].self, ["clients", "list"] + keepArgs).value
        async let l = try? engine.json([LegacyFinding].self, ["legacy", "scan"] + keepArgs).value
        let (status, doctor, clients, legacy) = await (s, d, c, l)
        self.status = status
        self.doctor = doctor
        self.clients = clients ?? []
        self.legacy = legacy ?? []
        reloadLog()
        if !firstLoadDone {
            firstLoadDone = true
            if !self.legacy.filter(\.removable).isEmpty {
                showMigration = true // opens the Cleanup tab
                banner = Banner(kind: .info, text: "Earlier installations of c3d-mcp were found. Review them below and remove what you don't need; files go to the Trash.")
            }
        }
    }

    func refreshPermissions() {
        accessibility = AXIsProcessTrusted()
        screenRecording = CGPreflightScreenCaptureAccess()
    }

    func reloadLog() {
        guard let data = try? Data(contentsOf: helperLogURL) else { logText = "No log yet."; return }
        let text = String(decoding: data.suffix(40_000), as: UTF8.self)
        logText = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(300).joined(separator: "\n")
    }

    // MARK: components

    func installBridge(repair: Bool = false) async {
        _ = await work(repair ? "Repairing…" : "Installing…") {
            let engine = try requireEngine()
            let (result, _) = try await engine.json(InstallResult.self, ["install"] + (repair ? ["--repair"] : []))
            let skills = try? await engine.run(["skills", "install"])
            banner = result.ok
                ? Banner(kind: .success, text: "Bridge installed. Restart Cheetah3D once so it loads the C3D-MCP menu." + (skills?.status == 0 ? " Agent skills installed." : ""))
                : Banner(kind: .error, text: result.steps.last(where: { $0.status == "fail" })?.detail ?? "Install failed.")
        }
        await refresh()
    }

    func uninstallEverything() async {
        _ = await work("Uninstalling…") {
            let engine = try requireEngine()
            let out = try await engine.run(["uninstall", "--all", "--yes"])
            _ = try? await engine.run(["permissions", "revoke", "--yes"]) // the Claude Code allow rule added by "Allow all c3d tools"
            banner = out.status == 0 ? Banner(kind: .success, text: "c3d-mcp was removed from Cheetah3D, your AI clients and the agent skills. Your scripts and backups were kept.")
                                     : Banner(kind: .error, text: out.stderr.isEmpty ? out.stdout : out.stderr)
        }
        await refresh()
    }

    func installSkills(_ install: Bool) async {
        _ = await work(install ? "Installing skills…" : "Removing skills…") {
            let out = try await requireEngine().run(["skills", install ? "install" : "uninstall"])
            banner = out.status == 0 ? Banner(kind: .success, text: install ? "Agent skills installed. Restart your AI client." : "Agent skills removed.") : Banner(kind: .error, text: out.stderr)
        }
    }

    // MARK: clients

    func setClient(_ row: ClientRow, connected: Bool) async {
        _ = await work(connected ? "Connecting \(row.label)…" : "Disconnecting \(row.label)…") {
            let engine = try requireEngine()
            let args = ["clients", connected ? "add" : "remove", row.client] + (connected ? ["--yes"] : []) + keepArgs
            let (results, _) = try await engine.json([ClientResult].self, args)
            let r = results.first
            let ok = r.map { ["added", "replaced", "unchanged", "removed", "absent"].contains($0.status) } ?? false
            banner = Banner(kind: ok ? .success : .error, text: ok ? "\(row.label): \(connected ? "connected. Restart it to use c3d." : "disconnected.")" : (r?.detail ?? "Nothing happened."))
        }
        await refresh()
    }

    func allowClaudeCode(_ allow: Bool) async {
        _ = await work("Updating Claude Code…") {
            let (r, _) = try await requireEngine().json(PermissionsResult.self, ["permissions", allow ? "allow" : "revoke", "--yes"])
            banner = Banner(kind: ["added", "removed", "unchanged"].contains(r.status) ? .success : .error, text: allow ? "Claude Code will no longer ask before each c3d tool. (\(r.detail))" : "Claude Code asks again. (\(r.detail))")
        }
    }

    // MARK: approvals

    func setApproval(_ mode: ApprovalMode) {
        do {
            try SettingsFile.write(mode, at: settingsURL)
            approval = mode
            banner = Banner(kind: .success, text: "Saved. It applies the next time your AI client starts c3d-mcp (restart the client or reconnect the server).")
        } catch {
            banner = Banner(kind: .error, text: "Could not save the setting: \(error.localizedDescription)")
        }
    }

    // MARK: cleanup of earlier installs

    func removeLegacy(ids: [String]) async {
        let stay = legacy.contains { ids.contains($0.id) && $0.needsQuit != nil }
        _ = await work("Removing earlier installs…") {
            let engine = try requireEngine()
            var args = ["legacy", "remove", "--yes", "--ids", ids.joined(separator: ",")] + keepArgs
            if stay { args.append("--quit-apps") }
            let (out, _) = try await engine.json(LegacyRemoveOutput.self, args)
            lastReport = out.report
            let bad = out.results.filter { $0.status == "failed" || $0.status == "blocked" }
            banner = bad.isEmpty
                ? Banner(kind: .success, text: "Removed \(out.results.filter { $0.status == "removed" }.count) item(s). Files went to the Trash.")
                : Banner(kind: .error, text: bad.map { "\($0.kind): \($0.detail)" }.joined(separator: "\n"))
        }
        await refresh()
    }

    // MARK: permissions

    func openPane(_ pane: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
    }

    func requestAccessibility() {
        let key = "AXTrustedCheckOptionPrompt" // the value of kAXTrustedCheckOptionPrompt (the C global is not concurrency-safe)
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        openPane("Privacy_Accessibility")
    }

    func requestScreenRecording() {
        _ = CGRequestScreenCaptureAccess()
        openPane("Privacy_ScreenCapture")
    }
}
