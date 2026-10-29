import Foundation
import JavaScriptCore

/// One JSContext carrying the strict Cheetah3D mocks plus byte-exact filesystem natives restricted to allowed roots.
final class Sandbox {
    let context: JSContext
    let bridgeDir: String
    private let readRoots: [String]
    private let writeRoots: [String]
    var jsErrors: [String] = []

    static let mockOrder = ["paramdata.js", "constants.js", "math.js", "fs.js", "app.js"]

    init(bridgeDir: String, writeRoots: [String]) throws {
        self.bridgeDir = bridgeDir
        self.writeRoots = writeRoots.map { Sandbox.canonical($0) }
        self.readRoots = self.writeRoots + [Sandbox.canonical(bridgeDir)]
        guard let ctx = JSContext() else { throw HarnessError.message("cannot create JSContext") }
        context = ctx
        ctx.exceptionHandler = { [unowned self] _, exc in
            let line = exc?.objectForKeyedSubscript("line")?.toString() ?? "?"
            self.jsErrors.append("\(exc?.toString() ?? "unknown JS exception") (line \(line))")
        }
        installNatives()
        for file in Sandbox.mockOrder { try load("\(bridgeDir)/tests/mocks/\(file)") }
    }

    static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
    }

    private func readable(_ path: String) -> Bool {
        let p = Sandbox.canonical(path)
        return readRoots.contains { p == $0 || p.hasPrefix($0 + "/") }
    }

    private func writable(_ path: String) -> Bool {
        let p = Sandbox.canonical(path)
        return writeRoots.contains { p == $0 || p.hasPrefix($0 + "/") }
    }

    func load(_ path: String) throws {
        guard let src = try? String(contentsOfFile: path, encoding: .utf8) else { throw HarnessError.message("cannot read \(path)") }
        jsErrors.removeAll()
        context.evaluateScript(src, withSourceURL: URL(fileURLWithPath: path))
        if let first = jsErrors.first { throw HarnessError.message("loading \(path): \(first)") }
    }

    func eval(_ code: String) -> JSValue? { context.evaluateScript(code) }

    private func installNatives() {
        let native = JSValue(newObjectIn: context)!
        let fm = FileManager.default

        let exists: @convention(block) (String) -> Bool = { [unowned self] p in self.readable(p) && fm.fileExists(atPath: p) }
        let isDir: @convention(block) (String) -> Bool = { [unowned self] p in
            var d: ObjCBool = false
            return self.readable(p) && fm.fileExists(atPath: p, isDirectory: &d) && d.boolValue
        }
        let size: @convention(block) (String) -> Double = { [unowned self] p in
            guard self.readable(p), let a = try? fm.attributesOfItem(atPath: p), let n = a[.size] as? NSNumber else { return 0 }
            return n.doubleValue
        }
        let readLatin1: @convention(block) (String) -> Any = { [unowned self] p in
            guard self.readable(p), let data = fm.contents(atPath: p) else { return NSNull() }
            var s = String.UnicodeScalarView()
            for b in data { s.append(Unicode.Scalar(b)) }
            return String(s)
        }
        let writeLatin1: @convention(block) (String, String, Bool) -> Bool = { [unowned self] p, text, append in
            guard self.writable(p) else { return false }
            let parent = (p as NSString).deletingLastPathComponent
            var d: ObjCBool = false
            guard fm.fileExists(atPath: parent, isDirectory: &d), d.boolValue else { return false }
            let bytes = Data(text.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) })
            if append, let h = FileHandle(forWritingAtPath: p) {
                defer { try? h.close() }
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: bytes)
                return true
            }
            return fm.createFile(atPath: p, contents: bytes)
        }
        let list: @convention(block) (String) -> Any = { [unowned self] p in
            guard self.readable(p), let names = try? fm.contentsOfDirectory(atPath: p) else { return NSNull() }
            return names.sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
        }
        let copy: @convention(block) (String, String) -> Bool = { [unowned self] a, b in
            guard self.readable(a), self.writable(b), fm.fileExists(atPath: a) else { return false }
            try? fm.removeItem(atPath: b)
            return (try? fm.copyItem(atPath: a, toPath: b)) != nil
        }
        // Real File.mkDir deletes an existing path first (research/02); the mock reproduces that so a stray call is visible.
        let mkdirWipe: @convention(block) (String) -> Bool = { [unowned self] p in
            guard self.writable(p) else { return false }
            try? fm.removeItem(atPath: p)
            return (try? fm.createDirectory(atPath: p, withIntermediateDirectories: false)) != nil
        }
        let remove: @convention(block) (String) -> Bool = { [unowned self] p in
            guard self.writable(p) else { return false }
            return (try? fm.removeItem(atPath: p)) != nil
        }

        native.setObject(exists, forKeyedSubscript: "exists" as NSString)
        native.setObject(isDir, forKeyedSubscript: "isDir" as NSString)
        native.setObject(size, forKeyedSubscript: "size" as NSString)
        native.setObject(readLatin1, forKeyedSubscript: "readLatin1" as NSString)
        native.setObject(writeLatin1, forKeyedSubscript: "writeLatin1" as NSString)
        native.setObject(list, forKeyedSubscript: "list" as NSString)
        native.setObject(copy, forKeyedSubscript: "copy" as NSString)
        native.setObject(mkdirWipe, forKeyedSubscript: "mkdirWipe" as NSString)
        native.setObject(remove, forKeyedSubscript: "remove" as NSString)
        context.setObject(native, forKeyedSubscript: "__native" as NSString)
    }
}

enum HarnessError: Error, CustomStringConvertible {
    case message(String)
    var description: String { if case let .message(m) = self { return m }; return "error" }
}
