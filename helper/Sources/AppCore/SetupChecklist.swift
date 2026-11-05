import Foundation

/// The four things a new user has to get right, derived from data the app already has (the doctor report, the Accessibility state, the clients).
public struct ChecklistItem: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable { case bridge, cheetah, accessibility, client }
    public enum Action: String, Sendable { case installBridge, grantAccessibility, openClients, none }

    public var id: String { kind.rawValue }
    public let kind: Kind
    public let title: String
    public let done: Bool
    /// What to do next, in plain words (empty when done).
    public let next: String
    public let action: Action
}

public enum SetupChecklist {
    public static func build(doctor: DoctorReport?, accessibilityGranted: Bool, clients: [ClientRow]) -> [ChecklistItem] {
        func status(_ name: String) -> String? { doctor?.checks.first { $0.name == name }?.status }
        let bridgeDone = status("bridge-installed") == "ok"
        let running = status("cheetah-running") == "ok"
        let menu = status("menu-item") == "ok"
        let cheetahNext: String
        if doctor == nil { cheetahNext = "Checking…" }
        else if !running { cheetahNext = "Start Cheetah3D. This page checks again by itself." }
        else if !menu { cheetahNext = "Restart Cheetah3D once so the C3D-MCP menu appears (it only loads macros at launch)." }
        else { cheetahNext = "" }
        let clientDone = clients.contains { $0.state == "current" }
        return [
            ChecklistItem(kind: .bridge, title: "Bridge installed in Cheetah3D", done: bridgeDone, next: bridgeDone ? "" : "Install the bridge.", action: bridgeDone ? .none : .installBridge),
            ChecklistItem(kind: .cheetah, title: "Cheetah3D running with the C3D-MCP menu", done: running && menu, next: cheetahNext, action: .none),
            ChecklistItem(kind: .accessibility, title: "Accessibility allowed for C3D MCP", done: accessibilityGranted, next: accessibilityGranted ? "" : "Allow C3D MCP under Accessibility, then come back here.", action: accessibilityGranted ? .none : .grantAccessibility),
            ChecklistItem(kind: .client, title: "An AI app connected", done: clientDone, next: clientDone ? "" : "Connect Claude, Codex or another AI app.", action: clientDone ? .none : .openClients),
        ]
    }
}
