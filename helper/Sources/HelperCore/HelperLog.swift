import Foundation

/// Line logger writing to stderr and (optionally) a size-capped log file.
public final class HelperLog: @unchecked Sendable {
    static let maxBytes = 2_000_000
    private let lock = NSLock()
    private let fileURL: URL?
    private let echoToStderr: Bool

    public init(fileURL: URL?, echoToStderr: Bool = true) {
        self.fileURL = fileURL
        self.echoToStderr = echoToStderr
        if let dir = fileURL?.deletingLastPathComponent() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    /// `~/Library/Logs/c3d-mcp/helper.log`
    public static func standard() -> HelperLog {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/c3d-mcp/helper.log")
        return HelperLog(fileURL: url)
    }

    public static let silent = HelperLog(fileURL: nil, echoToStderr: false)

    public func info(_ message: String) { write("INFO", message) }
    public func error(_ message: String) { write("ERROR", message) }

    private func write(_ level: String, _ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) [\(level)] pid=\(getpid()) \(message)\n"
        lock.withLock {
            if echoToStderr { FileHandle.standardError.write(Data(line.utf8)) }
            guard let url = fileURL else { return }
            rotateIfNeeded(url)
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: Data(line.utf8))
            } else {
                try? Data(line.utf8).write(to: url)
            }
        }
    }

    private func rotateIfNeeded(_ url: URL) {
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        guard size > Self.maxBytes else { return }
        let old = url.appendingPathExtension("1")
        try? FileManager.default.removeItem(at: old)
        try? FileManager.default.moveItem(at: url, to: old)
    }
}

public enum HelperVersion {
    /// `CFBundleShortVersionString` of the app bundle (set from `helper/VERSION` by build-app.sh).
    public static var current: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0-dev"
    }
}
