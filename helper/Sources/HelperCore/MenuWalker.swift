import Foundation

/// Menu traversal by title path. Handles the real `AXMenuBarItem > AXMenu > AXMenuItem` nesting
/// as well as flattened trees.
public enum MenuWalker {
    /// Items directly below `element`, looking through `AXMenu` wrappers.
    public static func items(of element: any UIElement) -> [any UIElement] {
        element.children.flatMap { $0.role == "AXMenu" ? $0.children : [$0] }
    }

    static func normalized(_ title: String?) -> String {
        (title ?? "").replacingOccurrences(of: "\u{2026}", with: "...").trimmingCharacters(in: .whitespaces)
    }

    public static func resolve(menuBar: any UIElement, path: [String]) throws -> any UIElement {
        var current = menuBar
        for (index, title) in path.enumerated() {
            let candidates = items(of: current)
            guard let next = candidates.first(where: { !normalized($0.title).isEmpty && normalized($0.title) == normalized(title) }) else {
                let available = candidates.map { normalized($0.title) }.filter { !$0.isEmpty }
                throw HelperError(
                    .triggerFailed, "menu item `\(title)` not found",
                    hint: "The menu may need a Cheetah3D restart (new macros) or the bridge macro is not installed.",
                    details: .object([
                        "path": .array(path.map(JSONValue.string)),
                        "failedAt": .int(index),
                        "missing": .string(title),
                        "available": .array(available.map(JSONValue.string)),
                    ]))
            }
            current = next
        }
        return current
    }

    /// JSON tree shaped like `research/raw/menus.json`: `{title, role, enabled, children?}`.
    public static func tree(of element: any UIElement, depth: Int) -> JSONValue {
        var o: [String: JSONValue] = [
            "title": .string(element.title ?? ""),
            "role": .string(element.role ?? ""),
            "enabled": .bool(element.isEnabled),
        ]
        let kids = items(of: element)
        if depth > 0, !kids.isEmpty {
            o["children"] = .array(kids.map { tree(of: $0, depth: depth - 1) })
        }
        return .object(o)
    }
}
