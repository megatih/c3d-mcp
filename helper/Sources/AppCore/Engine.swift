import Foundation

/// Result of one run of the bundled c3d-mcp command line.
public struct ProcessOutput: Sendable, Equatable {
    public let status: Int32
    public let stdout: String
    public let stderr: String
    public init(status: Int32, stdout: String, stderr: String) {
        self.status = status
        self.stdout = stdout
        self.stderr = stderr
    }
}

public enum EngineError: Error, CustomStringConvertible, Sendable {
    case notFound(String)
    case launchFailed(String)
    case timedOut(Int)
    case badJSON(String)
    case failed(Int32, String)

    public var description: String {
        switch self {
        case .notFound(let m): return m
        case .launchFailed(let m): return "Could not start the c3d-mcp engine: \(m)"
        case .timedOut(let s): return "The c3d-mcp engine did not answer within \(s) s."
        case .badJSON(let m): return "The c3d-mcp engine returned something unexpected: \(m)"
        case .failed(let code, let m): return m.isEmpty ? "The c3d-mcp engine failed (exit \(code))." : m
        }
    }
}

/// Where the bundled Node and the c3d-mcp server live.
public struct EngineLocator: Sendable, Equatable {
    public let node: URL
    public let script: URL

    public init(node: URL, script: URL) {
        self.node = node
        self.script = script
    }

    /// `C3D MCP.app/Contents/Resources/node/bin/node` + `.../server/bin/c3d-mcp.js`.
    public static func bundled(resources: URL?) -> EngineLocator? {
        guard let resources else { return nil }
        let node = resources.appendingPathComponent("node/bin/node")
        let script = resources.appendingPathComponent("server/bin/c3d-mcp.js")
        let fm = FileManager.default
        return fm.isExecutableFile(atPath: node.path) && fm.fileExists(atPath: script.path) ? EngineLocator(node: node, script: script) : nil
    }

    /// Development builds: C3D_APP_NODE and C3D_APP_SERVER (path of bin/c3d-mcp.js) point at a checkout.
    public static func fromEnvironment(_ env: [String: String]) -> EngineLocator? {
        guard let node = env["C3D_APP_NODE"], let script = env["C3D_APP_SERVER"] else { return nil }
        return EngineLocator(node: URL(fileURLWithPath: node), script: URL(fileURLWithPath: script))
    }

    public static func locate(resources: URL? = Bundle.main.resourceURL, env: [String: String] = ProcessInfo.processInfo.environment) -> EngineLocator? {
        bundled(resources: resources) ?? fromEnvironment(env)
    }
}

private final class Collector: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    func append(_ d: Data) { lock.lock(); data.append(d); lock.unlock() }
    var string: String { lock.lock(); defer { lock.unlock() }; return String(decoding: data, as: UTF8.self) }
}

/// Runs the c3d-mcp command line (`node c3d-mcp.js <args>`) and decodes its `--json` output.
public struct Engine: Sendable {
    public let locator: EngineLocator
    public var environment: [String: String]
    public var timeoutSeconds: Int

    public init(locator: EngineLocator, environment: [String: String] = [:], timeoutSeconds: Int = 120) {
        self.locator = locator
        self.environment = environment
        self.timeoutSeconds = timeoutSeconds
    }

    public func run(_ args: [String]) async throws -> ProcessOutput {
        let locator = locator, extra = environment, timeout = timeoutSeconds
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<ProcessOutput, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = locator.node
                process.arguments = [locator.script.path] + args
                process.environment = ProcessInfo.processInfo.environment.merging(extra) { _, new in new }
                process.standardInput = FileHandle.nullDevice
                let out = Pipe(), err = Pipe()
                process.standardOutput = out
                process.standardError = err
                let outBox = Collector(), errBox = Collector()
                let group = DispatchGroup()
                do { try process.run() } catch {
                    cont.resume(throwing: EngineError.launchFailed(error.localizedDescription))
                    return
                }
                for (pipe, box) in [(out, outBox), (err, errBox)] {
                    group.enter()
                    DispatchQueue.global().async {
                        box.append(pipe.fileHandleForReading.readDataToEndOfFile())
                        group.leave()
                    }
                }
                let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + .seconds(timeout), execute: killer)
                process.waitUntilExit()
                killer.cancel()
                group.wait()
                if process.terminationReason == .uncaughtSignal && process.terminationStatus == SIGTERM {
                    cont.resume(throwing: EngineError.timedOut(timeout))
                } else {
                    cont.resume(returning: ProcessOutput(status: process.terminationStatus, stdout: outBox.string, stderr: errBox.string))
                }
            }
        }
    }

    /// Runs `args + --json` and decodes stdout. A non-zero exit still decodes when the output is valid JSON (install, doctor and cleanup report problems that way).
    public func json<T: Decodable & Sendable>(_ type: T.Type, _ args: [String], acceptFailure: Bool = true) async throws -> (value: T, status: Int32) {
        let result = try await run(args + ["--json"])
        guard let data = result.stdout.data(using: .utf8), !data.isEmpty else {
            throw EngineError.failed(result.status, result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        do {
            let value = try JSONDecoder().decode(T.self, from: data)
            if result.status != 0 && !acceptFailure { throw EngineError.failed(result.status, result.stderr) }
            return (value, result.status)
        } catch let e as EngineError {
            throw e
        } catch {
            let message = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw message.isEmpty ? EngineError.badJSON("\(error)") : EngineError.failed(result.status, message)
        }
    }
}
