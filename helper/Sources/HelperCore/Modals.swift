import Foundation

public struct ModalDialog: Sendable, Equatable, Codable {
    public var title: String
    public var text: String
    public var buttons: [String]
    public var own: Bool
}

/// Dialog texts the helper itself caused (e.g. an Import dialog); these are not reported as blockers.
public final class OwnModalRegistry: @unchecked Sendable {
    public static let ttlMs = 120_000
    private let lock = NSLock()
    private var entries: [(text: String, expiresAt: Int)] = []

    public init() {}

    public func register(_ text: String, nowMs: Int) {
        lock.withLock {
            entries.removeAll { $0.expiresAt <= nowMs }
            entries.append((text, nowMs + Self.ttlMs))
        }
    }

    public func matches(_ haystack: String, nowMs: Int) -> Bool {
        lock.withLock {
            entries.removeAll { $0.expiresAt <= nowMs }
            return entries.contains { haystack.contains($0.text) }
        }
    }

    public func remove(matching haystack: String) {
        lock.withLock { entries.removeAll { haystack.contains($0.text) } }
    }
}

public struct DetectedModal {
    public let info: ModalDialog
    public let window: any UIElement
}

public enum ModalDetector {
    static let dialogSubroles: Set<String> = ["AXDialog", "AXSheet", "AXSystemDialog"]

    public static func isDialog(_ w: any UIElement) -> Bool {
        w.role == "AXSheet" || (w.subrole.map(dialogSubroles.contains) ?? false)
    }

    public static func detect(windows: [any UIElement], registry: OwnModalRegistry, nowMs: Int) -> [DetectedModal] {
        windows.filter(isDialog).map { w in
            var texts: [String] = []
            var buttons: [String] = []
            collect(w, depth: 4, texts: &texts, buttons: &buttons)
            let title = w.title ?? ""
            let text = texts.joined(separator: "\n")
            let own = registry.matches(title + "\n" + text, nowMs: nowMs)
            return DetectedModal(info: ModalDialog(title: title, text: text, buttons: buttons, own: own), window: w)
        }
    }

    private static func collect(_ e: any UIElement, depth: Int, texts: inout [String], buttons: inout [String]) {
        for child in e.children {
            switch child.role {
            case "AXStaticText":
                if let v = child.stringValue ?? child.title, !v.isEmpty { texts.append(v) }
            case "AXButton":
                if let t = child.title, !t.isEmpty { buttons.append(t) }
            default: break
            }
            if depth > 0 { collect(child, depth: depth - 1, texts: &texts, buttons: &buttons) }
        }
    }

    public static func button(named name: String, in e: any UIElement, depth: Int = 4) -> (any UIElement)? {
        for child in e.children {
            if child.role == "AXButton", child.title == name { return child }
            if depth > 0, let found = button(named: name, in: child, depth: depth - 1) { return found }
        }
        return nil
    }

    public static func blocked(by foreign: [ModalDialog]) -> HelperError {
        HelperError(
            .blockedByModal, "a dialog is open in Cheetah3D",
            hint: "Dismiss the dialog manually, then retry.",
            details: (try? JSONValue(encoding: ["dialogs": foreign])) ?? .null)
    }
}
