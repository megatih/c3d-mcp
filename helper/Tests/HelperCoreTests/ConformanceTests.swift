import XCTest
@testable import HelperCore

/// Every command's request and response shape against `contracts/helper-ipc.schema.json` and PROTOCOL section 6.
final class ConformanceTests: XCTestCase {
    var dir = ""

    override func setUpWithError() throws { dir = try tempDir() }
    override func tearDown() { try? FileManager.default.removeItem(atPath: dir) }

    func testCommandEnumMatchesContract() throws {
        let cmds = (((try MiniSchema.defs("request")["properties"]) as! [String: Any])["cmd"] as! [String: Any])["enum"] as! [String]
        XCTAssertEqual(Set(cmds), Set(Command.allCases.map(\.rawValue)))
    }

    /// Runs a request through the router, validating request + encoded response against the contract.
    func call(_ router: CommandRouter, _ cmd: String, _ args: [String: Any]? = nil) async throws -> Response {
        var object: [String: Any] = ["id": "c", "cmd": cmd]
        if let args { object["args"] = args }
        XCTAssertEqual(MiniSchema.validate(object, against: try MiniSchema.defs("request")), [])
        let r = try await send(router, cmd, args, id: "c")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(r))
        XCTAssertEqual(MiniSchema.validate(encoded, against: try MiniSchema.defs("response")), [], cmd)
        XCTAssertEqual(r.id, "c")
        if r.ok { XCTAssertNotNil(r.result); XCTAssertNil(r.error) } else { XCTAssertNil(r.result) }
        return r
    }

    func code(_ router: CommandRouter, _ cmd: String, _ args: [String: Any]? = nil) async throws -> String? {
        errorCode(try await call(router, cmd, args))
    }

    func assertShape(_ v: JSONValue?, _ expected: [String: String], file: StaticString = #filePath, line: UInt = #line) {
        guard case .object(let o)? = v else { return XCTFail("not an object: \(String(describing: v))", file: file, line: line) }
        for (key, kind) in expected {
            let ok: Bool
            switch (o[key], kind) {
            case (.string?, "string"), (.bool?, "bool"), (.int?, "int"), (.array?, "array"), (.object?, "object"),
                 (.double?, "number"), (.int?, "number"), (.null?, "null"): ok = true
            case (.some(.null), "string?"), (.some(.string), "string?"), (.some(.null), "int?"), (.some(.int), "int?"),
                 (.some(.null), "object?"), (.some(.object), "object?"): ok = true
            default: ok = false
            }
            XCTAssertTrue(ok, "key `\(key)` expected \(kind), got \(String(describing: o[key]))", file: file, line: line)
        }
    }

    func testPingAndStatusAndPermissions() async throws {
        let router = makeRouter()
        assertShape(try await call(router, "ping").result, ["version": "string", "pid": "int"])
        let s = try await call(router, "status").result
        assertShape(s, ["cheetah": "object", "bridgeMenuPresent": "bool", "modal": "null", "windows": "array", "permissions": "object"])
        assertShape(s?["cheetah"], ["running": "bool", "pid": "int?", "frontmost": "bool", "version": "string?", "responsive": "bool"])
        XCTAssertEqual(s?["cheetah"]?["version"]?.stringValue, "8.1.3")
        XCTAssertEqual(s?["bridgeMenuPresent"]?.boolValue, true)
        assertShape(s?["permissions"], ["accessibility": "bool", "screenRecording": "bool"])
        assertShape(try await call(router, "permissions").result, ["accessibility": "bool", "screenRecording": "bool"])
    }

    func testStatusWhenAppNotRunningAndWithModal() async throws {
        let fake = FakeAX()
        fake.cheetahRunning = false
        var s = try await call(makeRouter(fake), "status").result
        XCTAssertEqual(s?["cheetah"]?["running"]?.boolValue, false)
        XCTAssertEqual(s?["cheetah"]?["pid"], .null)
        XCTAssertEqual(s?["windows"], .array([]))

        let busy = FakeAX()
        busy.addDialog(text: "Oops")
        s = try await call(makeRouter(busy), "status").result
        assertShape(s?["modal"], ["title": "string", "text": "string", "buttons": "array", "own": "bool"])
    }

    func testWindowsShape() async throws {
        let r = try await call(makeRouter(), "windows")
        let first = r.result?.arrayValue?.first
        assertShape(first, ["title": "string", "role": "string", "subrole": "string", "main": "bool", "focused": "bool", "minimized": "bool"])
        XCTAssertEqual(r.result?.arrayValue?.count, 2)
        XCTAssertEqual(first?["main"]?.boolValue, true)
    }

    func testModalStateShape() async throws {
        let fake = FakeAX()
        var r = try await call(makeRouter(fake), "modalState")
        assertShape(r.result, ["open": "bool", "dialogs": "array"])
        XCTAssertEqual(r.result?["open"]?.boolValue, false)
        fake.addDialog(text: "x")
        r = try await call(makeRouter(fake), "modalState")
        XCTAssertEqual(r.result?["open"]?.boolValue, true)
        assertShape(r.result?["dialogs"]?.arrayValue?.first, ["title": "string", "text": "string", "buttons": "array", "own": "bool"])
    }

    func testListMenusMatchesMenusJSONShape() async throws {
        let r = try await call(makeRouter(), "listMenus")
        assertShape(r.result, ["title": "string", "role": "string", "enabled": "bool", "children": "array"])
        let sub = try await call(makeRouter(), "listMenus", ["path": ["Tools", "Script"], "depth": 2])
        XCTAssertEqual(sub.result?["title"]?.stringValue, "Script")
        let missing = try await call(makeRouter(), "listMenus", ["path": ["Nope"]])
        XCTAssertEqual(errorCode(missing), "TRIGGER_FAILED")
    }

    func testPressBridgeShape() async throws {
        let r = try await call(makeRouter(), "pressBridge", ["timeoutMs": 2000])
        assertShape(r.result, ["pressed": "bool", "activatedMs": "int", "busy": "bool"])
        XCTAssertEqual(r.result?["pressed"]?.boolValue, true)
    }

    func testPressMenuAndRaiseWindowAndNewDocument() async throws {
        let fake = FakeAX()
        fake.newItem.onPress = { $0.addWindow("Untitled 3") }
        let router = makeRouter(fake)
        assertShape(try await call(router, "pressMenu", ["path": ["File", "New"], "timeoutMs": 500]).result, ["pressed": "bool"])
        assertShape(try await call(router, "raiseWindow", ["title": "Untitled 2"]).result, ["raised": "bool"])
        let notFound = try await code(router, "raiseWindow", ["title": "Nope"])
        XCTAssertEqual(notFound, "TRIGGER_FAILED")
        assertShape(try await call(router, "newDocument").result, ["title": "string"])
        assertShape(try await call(makeRouter(), "launchApp").result, ["pid": "int"])
    }

    func testStructuredErrors() async throws {
        let off = FakeAX()
        off.cheetahRunning = false
        let offPress = try await code(makeRouter(off), "pressBridge")
        let offWindows = try await code(makeRouter(off), "windows")
        XCTAssertEqual([offPress, offWindows], ["APP_NOT_RUNNING", "APP_NOT_RUNNING"])
        let denied = FakeAX()
        denied.trusted = false
        let denial = try await call(makeRouter(denied), "pressBridge")
        XCTAssertEqual(errorCode(denial), "PERMISSION_MISSING")
        XCTAssertNotNil(denial.error?.hint)
        let modal = FakeAX()
        modal.addDialog(text: "Texture baking error!")
        let blocked = try await call(makeRouter(modal), "pressBridge")
        XCTAssertEqual(errorCode(blocked), "BLOCKED_BY_MODAL")
        XCTAssertEqual(blocked.error?.details?["dialogs"]?.arrayValue?.first?["text"]?.stringValue, "Texture baking error!")
    }

    func testImageCommandsShapes() async throws {
        let src = dir + "/g.png"
        try Fixtures.writeGrayPNG(to: src, width: 300, height: 100) { x, _ in UInt8(x % 256) }
        let router = makeRouter()
        let a = try await call(router, "analyzeImage", ["path": src]).result
        assertShape(a, ["width": "int", "height": "int", "blank": "bool", "meanLuma": "number", "histogram": "array"])
        XCTAssertEqual(a?["histogram"]?.arrayValue?.count, 16)
        let d = try await call(router, "downscaleImage", ["path": src, "outPath": dir + "/s.png", "maxDim": 100, "maxBytes": 1_000_000]).result
        assertShape(d, ["path": "string", "width": "int", "height": "int", "bytes": "int", "format": "string"])
        XCTAssertEqual(d?["width"]?.intValue, 100)
        let c = try await call(router, "captureWindow", ["outPath": dir + "/cap.png"]).result
        assertShape(c, ["path": "string", "width": "int", "height": "int", "bytes": "int"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir + "/cap.png"))
    }

    func testCaptureNeedsScreenRecording() async throws {
        let fake = FakeAX()
        fake.screenGranted = false
        let r = try await call(makeRouter(fake), "captureWindow", ["outPath": dir + "/c.png"])
        XCTAssertEqual(errorCode(r), "PERMISSION_MISSING")
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir + "/c.png"))
    }

    func testArgumentValidation() async throws {
        let router = makeRouter()
        let bad: [(String, [String: Any]?)] = [
            ("ping", ["x": 1]),
            ("status", ["x": 1]),
            ("pressBridge", ["timeoutMs": "fast"]),
            ("pressBridge", ["timeoutMs": 5]),
            ("pressBridge", ["timeoutMs": 999_999]),
            ("pressBridge", ["menuPath": []]),
            ("pressBridge", ["menuPath": ["ok", 3]]),
            ("pressBridge", ["requireDocTitle": ""]),
            ("pressBridge", ["bogus": true]),
            ("pressMenu", nil),
            ("pressMenu", ["path": "File"]),
            ("pressMenu", ["path": ["File"], "requireDocument": "yes"]),
            ("raiseWindow", nil),
            ("raiseWindow", ["title": 3]),
            ("raiseWindow", ["title": "a", "extra": 1]),
            ("dismissOwnModal", nil),
            ("dismissOwnModal", ["text": ""]),
            ("listMenus", ["depth": 0]),
            ("listMenus", ["path": "Tools"]),
            ("analyzeImage", nil),
            ("analyzeImage", ["path": "relative.png"]),
            ("analyzeImage", ["path": dir + "/missing.png"]),
            ("downscaleImage", ["path": "/a.png", "outPath": "/b.png", "maxDim": 100]),
            ("downscaleImage", ["path": "/a.png", "outPath": "/b.png", "maxDim": 1, "maxBytes": 5000]),
            ("downscaleImage", ["path": "/a.png", "outPath": "b.png", "maxDim": 100, "maxBytes": 5000]),
            ("captureWindow", nil),
            ("captureWindow", ["outPath": dir + "/c.png", "crop": ["x": 0]]),
            ("captureWindow", ["outPath": dir + "/c.png", "crop": ["x": 0, "y": 0, "width": 0, "height": 5]]),
            ("captureWindow", ["outPath": dir + "/nodir/c.png"]),
            ("newDocument", ["x": 1]),
            ("launchApp", ["x": 1]),
        ]
        for (cmd, args) in bad {
            let r = try await call(router, cmd, args)
            XCTAssertEqual(errorCode(r), "INVALID_ARGUMENT", "\(cmd) \(String(describing: args))")
            XCTAssertFalse(r.error?.message.isEmpty ?? true)
        }
    }

    func testOnlyContractedErrorCodesAreEmitted() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: repo.appendingPathComponent("contracts/errors.json"))
        let codes = Set((((try JSONSerialization.jsonObject(with: data)) as! [String: Any])["codes"] as! [String: Any]).keys)
        for c in [ErrorCode.appNotRunning, .triggerFailed, .blockedByModal, .permissionMissing, .invalidArgument, .internalError, .timeout] {
            XCTAssertTrue(codes.contains(c.rawValue), c.rawValue)
        }
    }
}
