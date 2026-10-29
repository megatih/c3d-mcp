import Foundation
import JavaScriptCore

setvbuf(stdout, nil, _IOLBF, 0)

func usage() -> Never {
    FileHandle.standardError.write(Data("""
    usage:
      c3d-harness cases [--bridge DIR] [--filter TEXT] [--dump DIR]
      c3d-harness run MCPDIR [--bridge DIR] [--setup FILE.js] [--presses N] [--file-name NAME]

    """.utf8))
    exit(2)
}

func findBridge(_ explicit: String?) -> String {
    if let e = explicit { return Sandbox.canonical(e) }
    var dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    for _ in 0..<8 {
        let candidate = dir.appendingPathComponent("bridge/dist/runtime.js").path
        if FileManager.default.fileExists(atPath: candidate) { return dir.appendingPathComponent("bridge").path }
        dir = dir.deletingLastPathComponent()
    }
    FileHandle.standardError.write(Data("cannot locate bridge/dist/runtime.js; pass --bridge DIR\n".utf8))
    exit(2)
}

func option(_ name: String, in args: [String]) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func jsLiteral(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s], options: [.withoutEscapingSlashes])
    var text = String(data: data, encoding: .utf8)!
    text.removeFirst()
    text.removeLast()
    return text
}

func renderMacro(bridge: String, mcpDir: String) throws -> (source: String, runtimePath: String) {
    let runtimePath = "\(bridge)/dist/runtime.js"
    guard let template = try? String(contentsOfFile: "\(bridge)/macro/C3D-MCP Bridge.js.template", encoding: .utf8),
          let metaData = FileManager.default.contents(atPath: "\(bridge)/dist/runtime.meta.json"),
          let meta = try? JSONSerialization.jsonObject(with: metaData) as? [String: Any],
          let version = meta["version"] as? String
    else { throw HarnessError.message("macro template or runtime.meta.json missing; run scripts/build-runtime.mjs") }
    func quoted(_ v: String) -> String { let l = jsLiteral(v); return String(l.dropFirst().dropLast()).replacingOccurrences(of: "'", with: "\\'") }
    let source = template
        .replacingOccurrences(of: "{{RUNTIME_PATH}}", with: quoted(runtimePath))
        .replacingOccurrences(of: "{{MCP_DIR}}", with: quoted(mcpDir))
        .replacingOccurrences(of: "{{VERSION}}", with: quoted(version))
    return (source, runtimePath)
}

func makeMcpDir(_ root: String, _ name: String) throws -> String {
    let dir = "\(root)/\(name)"
    let fm = FileManager.default
    for sub in ["inbox", "outbox", "cancel", "runtime", "log", "tmp"] {
        try fm.createDirectory(atPath: "\(dir)/\(sub)", withIntermediateDirectories: true)
    }
    return dir
}

// MARK: - cases

struct CaseResult { var ok: Bool; var lines: [String] }

// The suite text is parsed inside the JS context so object key order (parameter application order) is preserved.
func runCase(suiteText: String, caseIndex: Int, name: String, suite: String, bridge: String, tmpRoot: String, index: Int, dump: String?) -> CaseResult {
    do {
        let mcpDir = try makeMcpDir(tmpRoot, "case\(index)")
        let sandbox = try Sandbox(bridgeDir: bridge, writeRoots: [mcpDir, tmpRoot])
        try sandbox.load("\(bridge)/tests/runner.js")
        let secret = "test-secret-0123456789abcdef"
        FileManager.default.createFile(atPath: "\(mcpDir)/secret", contents: Data(secret.utf8), attributes: [.posixPermissions: 0o600])
        let (macro, runtimePath) = try renderMacro(bridge: bridge, mcpDir: mcpDir)
        let env: [String: Any] = ["mcpDir": mcpDir, "macroSource": macro, "runtimePath": runtimePath]
        let envJSON = String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
        let script = "JSON.stringify(__h.runCase(JSON.parse(\(jsLiteral(suiteText))).cases[\(caseIndex)], JSON.parse(\(jsLiteral(envJSON)))))"
        sandbox.jsErrors.removeAll()
        let out = sandbox.eval(script)
        guard let text = out?.toString(), out?.isString == true, let data = text.data(using: .utf8),
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return CaseResult(ok: false, lines: ["runner failed: \(sandbox.jsErrors.joined(separator: "; "))"]) }
        var failures = (result["failures"] as? [String]) ?? []
        failures.append(contentsOf: sandbox.jsErrors.map { "uncaught JS error: \($0)" })
        if let dump = dump, let dumps = result["dumps"] as? [[String: String]] {
            let dir = "\(dump)/\(suite)/\(name.replacingOccurrences(of: "/", with: "_"))"
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            for d in dumps { try d["text"]!.write(toFile: "\(dir)/\(d["rel"]!)", atomically: true, encoding: .utf8) }
        }
        return CaseResult(ok: failures.isEmpty, lines: failures)
    } catch {
        return CaseResult(ok: false, lines: ["harness error: \(error)"])
    }
}

func runCases(_ args: [String]) -> Int32 {
    let bridge = findBridge(option("--bridge", in: args))
    let filter = option("--filter", in: args)
    let dump = option("--dump", in: args)
    let fm = FileManager.default
    let tmpRoot = Sandbox.canonical(NSTemporaryDirectory()) + "/c3d-harness-\(getpid())"
    try? fm.removeItem(atPath: tmpRoot)
    try! fm.createDirectory(atPath: tmpRoot, withIntermediateDirectories: true)
    defer { try? fm.removeItem(atPath: tmpRoot) }
    if let dump = dump { try? fm.removeItem(atPath: dump); try? fm.createDirectory(atPath: dump, withIntermediateDirectories: true) }

    let files = ((try? fm.contentsOfDirectory(atPath: "\(bridge)/tests/cases")) ?? []).filter { $0.hasSuffix(".json") }.sorted()
    var n = 0, pass = 0, failed = 0
    var tap: [String] = []
    for file in files {
        guard let data = fm.contents(atPath: "\(bridge)/tests/cases/\(file)"), let suiteText = String(data: data, encoding: .utf8),
              let suiteObj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cases = suiteObj["cases"] as? [[String: Any]]
        else { print("not ok - \(file): cannot parse suite"); failed += 1; continue }
        let suite = (file as NSString).deletingPathExtension
        for (caseIndex, c) in cases.enumerated() {
            let name = (c["name"] as? String) ?? "unnamed"
            if let f = filter, !"\(suite)/\(name)".contains(f) { continue }
            n += 1
            let r = runCase(suiteText: suiteText, caseIndex: caseIndex, name: name, suite: suite, bridge: bridge, tmpRoot: tmpRoot, index: n, dump: dump)
            if r.ok { pass += 1; tap.append("ok \(n) - \(suite)/\(name)") }
            else {
                failed += 1
                tap.append("not ok \(n) - \(suite)/\(name)")
                for l in r.lines { tap.append("  # \(l)") }
            }
            print(tap.removeFirst())
            while !tap.isEmpty { print(tap.removeFirst()) }
        }
    }
    print("1..\(n)")
    print("# pass \(pass)")
    print("# fail \(failed)")
    return failed == 0 && n > 0 ? 0 : 1
}

// MARK: - run (single press against a directory, used by Node integration tests)

func runOnce(_ args: [String]) -> Int32 {
    guard args.count >= 2 else { usage() }
    let mcpDir = Sandbox.canonical(args[1])
    let bridge = findBridge(option("--bridge", in: args))
    let presses = Int(option("--presses", in: args) ?? "1") ?? 1
    do {
        let tmp = Sandbox.canonical(NSTemporaryDirectory())
        let sandbox = try Sandbox(bridgeDir: bridge, writeRoots: [mcpDir, tmp])
        if let name = option("--file-name", in: args) { _ = sandbox.eval("__app.fileName = \(jsLiteral(name))") }
        if let setup = option("--setup", in: args) { try sandbox.load(Sandbox.canonical(setup)) }
        let (macro, _) = try renderMacro(bridge: bridge, mcpDir: mcpDir)
        _ = sandbox.eval(macro)
        for _ in 0..<presses { _ = sandbox.eval("main(__app.doc)") }
        let summary = sandbox.eval("JSON.stringify({ fatal: __app.fatal, modal: __app.modal, console: __app.console, stats: __stats, scene: __dumpScene() })")
        print(summary?.toString() ?? "{}")
        if !sandbox.jsErrors.isEmpty {
            FileHandle.standardError.write(Data((sandbox.jsErrors.joined(separator: "\n") + "\n").utf8))
            return 1
        }
        return 0
    } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        return 1
    }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "cases": exit(runCases(args))
case "run": exit(runOnce(args))
default: usage()
}
