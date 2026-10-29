import Foundation

/// Error codes the helper may emit (subset of `contracts/errors.json`).
public enum ErrorCode: String, Sendable {
    case appNotRunning = "APP_NOT_RUNNING"
    case triggerFailed = "TRIGGER_FAILED"
    case blockedByModal = "BLOCKED_BY_MODAL"
    case permissionMissing = "PERMISSION_MISSING"
    case invalidArgument = "INVALID_ARGUMENT"
    case internalError = "INTERNAL"
    case timeout = "TIMEOUT"
}

/// A structured error that maps 1:1 onto the `error` object of a response.
public struct HelperError: Error, Sendable, Equatable {
    public let code: ErrorCode
    public let message: String
    public let hint: String?
    public let details: JSONValue?

    public init(_ code: ErrorCode, _ message: String, hint: String? = nil, details: JSONValue? = nil) {
        self.code = code
        self.message = message
        self.hint = hint
        self.details = details
    }
}

public struct ErrorBody: Codable, Sendable, Equatable {
    public var code: String
    public var message: String
    public var hint: String?
    public var details: JSONValue?
}

public struct Response: Codable, Sendable, Equatable {
    public var id: String
    public var ok: Bool
    public var result: JSONValue?
    public var error: ErrorBody?

    public static func success(id: String, _ result: JSONValue) -> Response {
        Response(id: id, ok: true, result: result, error: nil)
    }

    public static func failure(id: String, _ e: HelperError) -> Response {
        Response(id: id, ok: false, result: nil,
                 error: ErrorBody(code: e.code.rawValue, message: e.message, hint: e.hint, details: e.details))
    }
}

public enum Command: String, CaseIterable, Sendable {
    case ping, status, pressBridge, pressMenu, listMenus, modalState, windows, raiseWindow
    case captureWindow, analyzeImage, downscaleImage, postProcessImage, permissions, launchApp, newDocument, dismissOwnModal
}

public enum ParseOutcome: Sendable {
    case accepted(Request)
    /// A ready-made error response (the id is empty when none could be read).
    case rejected(Response)
}

public struct Request: Sendable {
    public let id: String
    public let cmd: Command
    public let args: [String: JSONValue]

    /// Parses one JSON line strictly: object with exactly `id`, `cmd` and optional `args`.
    public static func parse(_ line: Data) -> ParseOutcome {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: line), case .object(let o) = value else {
            return .rejected(.failure(id: "", HelperError(.invalidArgument, "request is not a JSON object")))
        }
        let id = o["id"]?.stringValue ?? ""
        func fail(_ m: String) -> ParseOutcome {
            .rejected(.failure(id: id, HelperError(.invalidArgument, m)))
        }
        guard o["id"]?.stringValue != nil else { return fail("`id` must be a string") }
        if let extra = o.keys.first(where: { !["id", "cmd", "args"].contains($0) }) {
            return fail("unknown request field `\(extra)`")
        }
        guard let name = o["cmd"]?.stringValue else { return fail("`cmd` must be a string") }
        guard let cmd = Command(rawValue: name) else { return fail("unknown cmd `\(name)`") }
        var args: [String: JSONValue] = [:]
        if let a = o["args"] {
            guard case .object(let ao) = a else { return fail("`args` must be an object") }
            args = ao
        }
        return .accepted(Request(id: id, cmd: cmd, args: args))
    }
}

/// Strict, consuming reader for command arguments: every key must be read or `finish()` throws.
struct ArgReader {
    private var rest: [String: JSONValue]

    init(_ args: [String: JSONValue]) { rest = args }

    private func bad(_ key: String, _ expected: String) -> HelperError {
        HelperError(.invalidArgument, "argument `\(key)` must be \(expected)")
    }

    mutating func string(_ key: String, required: Bool = false, nonEmpty: Bool = true) throws -> String? {
        guard let v = rest.removeValue(forKey: key) else {
            if required { throw HelperError(.invalidArgument, "missing required argument `\(key)`") }
            return nil
        }
        guard let s = v.stringValue, !(nonEmpty && s.isEmpty) else { throw bad(key, "a non-empty string") }
        return s
    }

    mutating func requiredString(_ key: String) throws -> String {
        try string(key, required: true) ?? ""
    }

    mutating func int(_ key: String, in range: ClosedRange<Int>, default def: Int? = nil) throws -> Int {
        guard let v = rest.removeValue(forKey: key) else {
            if let def { return def }
            throw HelperError(.invalidArgument, "missing required argument `\(key)`")
        }
        guard let i = v.intValue, range.contains(i) else { throw bad(key, "an integer in \(range.lowerBound)...\(range.upperBound)") }
        return i
    }

    mutating func bool(_ key: String, default def: Bool) throws -> Bool {
        guard let v = rest.removeValue(forKey: key) else { return def }
        guard let b = v.boolValue else { throw bad(key, "a boolean") }
        return b
    }

    mutating func stringArray(_ key: String, required: Bool = false) throws -> [String]? {
        guard let v = rest.removeValue(forKey: key) else {
            if required { throw HelperError(.invalidArgument, "missing required argument `\(key)`") }
            return nil
        }
        guard let a = v.arrayValue else { throw bad(key, "an array of non-empty strings") }
        let strings = a.compactMap(\.stringValue).filter { !$0.isEmpty }
        guard strings.count == a.count, !strings.isEmpty else { throw bad(key, "a non-empty array of non-empty strings") }
        return strings
    }

    mutating func absolutePath(_ key: String, required: Bool = true) throws -> String? {
        guard let s = try string(key, required: required) else { return nil }
        guard s.hasPrefix("/"), !OutputPolicy.hasParentComponent(s) else { throw bad(key, "an absolute path without `..`") }
        return s
    }

    mutating func object(_ key: String) throws -> [String: JSONValue]? {
        guard let v = rest.removeValue(forKey: key) else { return nil }
        guard case .object(let o) = v else { throw bad(key, "an object") }
        return o
    }

    func finish() throws {
        if let k = rest.keys.sorted().first {
            throw HelperError(.invalidArgument, "unknown argument `\(k)`")
        }
    }
}
