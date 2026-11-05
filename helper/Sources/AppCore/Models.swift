import Foundation

// Shapes of the `c3d-mcp ... --json` output (see packages/server/src/cli/index.ts). Decoding is tolerant: extra fields are ignored.

public struct Component: Codable, Sendable, Equatable, Identifiable {
    public var id: String { name }
    public let name: String
    public let status: String
    public let detail: String
}

public struct InstallStatus: Codable, Sendable, Equatable {
    public let kind: String
    public let components: [Component]
    public let recommended: String
    public let summary: String
}

public struct DoctorCheck: Codable, Sendable, Equatable, Identifiable {
    public var id: String { name }
    public let name: String
    public let status: String
    public let detail: String
    public let fix: String
}

public struct DoctorReport: Codable, Sendable, Equatable {
    public let ok: Bool
    public let summary: String
    public let checks: [DoctorCheck]
}

public struct InstallStep: Codable, Sendable, Equatable, Identifiable {
    public var id: String { name }
    public let name: String
    public let status: String
    public let detail: String
}

public struct InstallResult: Codable, Sendable, Equatable {
    public let ok: Bool
    public let steps: [InstallStep]
    public let guidance: [String]
}

public struct ClientRow: Codable, Sendable, Equatable, Identifiable {
    public var id: String { client }
    public let client: String
    public let label: String
    public let detected: Bool
    /// none | current | legacy | foreign
    public let state: String
    public let detail: String
}

public struct ClientResult: Codable, Sendable, Equatable, Identifiable {
    public var id: String { client }
    public let client: String
    public let status: String
    public let detail: String
}

public struct LegacyFinding: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: String
    public let label: String
    public let installedBy: String
    public let paths: [String]
    public let evidence: String
    public let removable: Bool
    public let needsQuit: String?
}

public struct LegacyRemoveResult: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: String
    public let status: String
    public let detail: String
}

public struct LegacyRemoveOutput: Codable, Sendable, Equatable {
    public let results: [LegacyRemoveResult]
    public let report: String?
}

public struct PermissionsResult: Codable, Sendable, Equatable {
    public let status: String
    public let target: String
    public let detail: String
}

/// How the server asks for confirmation (C3D_MCP_APPROVAL).
public enum ApprovalMode: String, CaseIterable, Sendable, Identifiable {
    case strict, session, trusted
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .strict: return "Ask every time"
        case .session: return "Ask once per action"
        case .trusted: return "Never ask"
        }
    }
    public var explanation: String {
        switch self {
        case .strict: return "Every overwrite, bulk delete and risky script asks for your approval, even repeats."
        case .session: return "A prompt you accept is not repeated for the same action (for example saving the same file again) until the server restarts."
        case .trusted: return "No confirmation prompts from c3d-mcp. Files that existed before a session are still never overwritten."
        }
    }
}

/// `<MCP folder>/settings.json`, written by the control panel and read by the server.
public enum SettingsFile {
    public static func read(at url: URL) -> ApprovalMode {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = obj["approval"] as? String, let mode = ApprovalMode(rawValue: raw) else { return .session }
        return mode
    }

    /// Keeps any other keys that are already in the file.
    public static func write(_ mode: ApprovalMode, at url: URL) throws {
        var obj: [String: Any] = [:]
        if let data = try? Data(contentsOf: url), let old = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { obj = old }
        obj["approval"] = mode.rawValue
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
    }
}
