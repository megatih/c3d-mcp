import XCTest
@testable import AppCore

final class AppCoreTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("appcore-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    /// `/bin/sh <script> args...` stands in for `node c3d-mcp.js args...`.
    func engine(_ script: String, timeout: Int = 20) throws -> Engine {
        let url = dir.appendingPathComponent("fake.sh")
        try script.write(to: url, atomically: true, encoding: .utf8)
        return Engine(locator: EngineLocator(node: URL(fileURLWithPath: "/bin/sh"), script: url), timeoutSeconds: timeout)
    }

    func testDecodesStatusJSON() async throws {
        let e = try engine(#"echo '{"kind":"current","components":[{"name":"runtime","status":"ok","detail":"1.0.1"}],"installed":{},"recommended":"none","summary":"current"}'"#)
        let (s, code) = try await e.json(InstallStatus.self, ["status"])
        XCTAssertEqual(code, 0)
        XCTAssertEqual(s.kind, "current")
        XCTAssertEqual(s.components.first?.name, "runtime")
    }

    func testPassesArgumentsAndAddsJSONFlag() async throws {
        let e = try engine(#"echo "[\"$1\",\"$2\",\"$3\"]""#)
        let (a, _) = try await e.json([String].self, ["clients", "list"])
        XCTAssertEqual(a, ["clients", "list", "--json"])
    }

    func testNonZeroExitStillDecodesReports() async throws {
        let e = try engine(#"echo '{"ok":false,"steps":[{"name":"x","status":"fail","detail":"boom"}],"guidance":[]}'; exit 1"#)
        let (r, code) = try await e.json(InstallResult.self, ["install"])
        XCTAssertEqual(code, 1)
        XCTAssertFalse(r.ok)
        XCTAssertEqual(r.steps.first?.detail, "boom")
    }

    func testEmptyOutputReportsStderr() async throws {
        let e = try engine(#"echo "no such thing" >&2; exit 2"#)
        do {
            _ = try await e.json(InstallStatus.self, ["x"])
            XCTFail("should throw")
        } catch let err as EngineError {
            XCTAssertTrue("\(err)".contains("no such thing"))
        }
    }

    func testTimeoutKillsTheProcess() async throws {
        let e = try engine("sleep 30", timeout: 1)
        do {
            _ = try await e.run(["x"])
            XCTFail("should time out")
        } catch let err as EngineError {
            guard case .timedOut = err else { return XCTFail("\(err)") }
        }
    }

    func testLargeOutputDoesNotDeadlock() async throws {
        let e = try engine(#"i=0; while [ $i -lt 20000 ]; do echo "line $i of padding padding padding padding"; echo "err $i" >&2; i=$((i+1)); done"#)
        let out = try await e.run([])
        XCTAssertGreaterThan(out.stdout.count, 500_000)
        XCTAssertGreaterThan(out.stderr.count, 100_000)
    }

    func testLocatorNeedsBothFiles() throws {
        XCTAssertNil(EngineLocator.bundled(resources: dir))
        let bin = dir.appendingPathComponent("node/bin"), server = dir.appendingPathComponent("server/bin")
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: server, withIntermediateDirectories: true)
        try "#!/bin/sh".write(to: bin.appendingPathComponent("node"), atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: bin.appendingPathComponent("node").path)
        XCTAssertNil(EngineLocator.bundled(resources: dir))
        try "".write(to: server.appendingPathComponent("c3d-mcp.js"), atomically: true, encoding: .utf8)
        XCTAssertNotNil(EngineLocator.bundled(resources: dir))
        XCTAssertEqual(EngineLocator.fromEnvironment(["C3D_APP_NODE": "/n", "C3D_APP_SERVER": "/s"])?.script.path, "/s")
        XCTAssertNil(EngineLocator.fromEnvironment([:]))
    }

    func testDecodesLegacyFindingsAndClients() throws {
        let findings = #"[{"id":"client:cursor","kind":"client","label":"x","installedBy":"y","paths":["/p"],"evidence":"e","removable":true,"needsQuit":"Claude Desktop","data":{"client":"cursor"}},{"id":"skills:unmarked","kind":"unmarked-skills","label":"s","installedBy":"hand","paths":[],"evidence":"","removable":false}]"#
        let f = try JSONDecoder().decode([LegacyFinding].self, from: Data(findings.utf8))
        XCTAssertEqual(f.map(\.removable), [true, false])
        XCTAssertEqual(f.first?.needsQuit, "Claude Desktop")
        XCTAssertNil(f.last?.needsQuit)
        let clients = #"[{"client":"cursor","label":"Cursor","detected":true,"state":"legacy","detail":"/x"}]"#
        XCTAssertEqual(try JSONDecoder().decode([ClientRow].self, from: Data(clients.utf8)).first?.state, "legacy")
        let out = #"{"results":[{"id":"a","kind":"client","status":"removed","detail":"d"}],"report":"/r.txt"}"#
        XCTAssertEqual(try JSONDecoder().decode(LegacyRemoveOutput.self, from: Data(out.utf8)).report, "/r.txt")
    }

    func testSettingsFileRoundTripKeepsOtherKeys() throws {
        let url = dir.appendingPathComponent("MCP/settings.json")
        XCTAssertEqual(SettingsFile.read(at: url), .session)
        try SettingsFile.write(.trusted, at: url)
        XCTAssertEqual(SettingsFile.read(at: url), .trusted)
        try #"{"approval":"x","other":1}"#.write(to: url, atomically: true, encoding: .utf8)
        XCTAssertEqual(SettingsFile.read(at: url), .session) // invalid value falls back
        try SettingsFile.write(.strict, at: url)
        let obj = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        XCTAssertEqual(obj?["other"] as? Int, 1)
        XCTAssertEqual(obj?["approval"] as? String, "strict")
    }
}

final class HealthRefreshPolicyTests: XCTestCase {
    func testActivationIsThrottledAndNeverOverlapsAnAction() {
        let p = HealthRefreshPolicy()
        let t0 = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(p.shouldCheckOnActivation(lastChecked: nil, now: t0, busy: false), "no check yet: run one")
        XCTAssertFalse(p.shouldCheckOnActivation(lastChecked: t0, now: t0.addingTimeInterval(4.9), busy: false), "inside the throttle window")
        XCTAssertTrue(p.shouldCheckOnActivation(lastChecked: t0, now: t0.addingTimeInterval(5), busy: false))
        XCTAssertFalse(p.shouldCheckOnActivation(lastChecked: nil, now: t0, busy: true), "an install or refresh is running")
    }

    func testLaunchRunsStopOnceHealthyAndEndWithTheSchedule() {
        let p = HealthRefreshPolicy()
        XCTAssertEqual(p.gapBeforeLaunchRun(0, previousHealthy: nil), 4, "the first run after a launch always happens")
        XCTAssertEqual(p.gapBeforeLaunchRun(0, previousHealthy: true), 4)
        XCTAssertEqual(p.gapBeforeLaunchRun(1, previousHealthy: false), 8, "still red: look again")
        XCTAssertNil(p.gapBeforeLaunchRun(1, previousHealthy: true), "green: stop")
        XCTAssertEqual(p.gapBeforeLaunchRun(2, previousHealthy: false), 18)
        XCTAssertNil(p.gapBeforeLaunchRun(3, previousHealthy: false), "schedule exhausted")
        XCTAssertEqual(p.launchGaps.reduce(0, +), 30, "the last run is 30 s after the launch")
    }
}

final class SetupChecklistTests: XCTestCase {
    private func report(_ checks: [(String, String)]) -> DoctorReport {
        DoctorReport(ok: !checks.contains { $0.1 == "fail" }, summary: "", checks: checks.map { DoctorCheck(name: $0.0, status: $0.1, detail: "", fix: "") })
    }
    private func client(_ state: String) -> ClientRow { ClientRow(client: "cursor", label: "Cursor", detected: true, state: state, detail: "") }

    func testTheStaleStartupReportShowsCheetahAsTheOnlyOpenStep() {
        let stale = report([("bridge-installed", "ok"), ("cheetah-running", "fail"), ("menu-item", "warn")])
        let items = SetupChecklist.build(doctor: stale, accessibilityGranted: true, clients: [client("current")])
        XCTAssertEqual(items.map(\.done), [true, false, true, true])
        XCTAssertTrue(items[1].next.contains("Start Cheetah3D"))
        XCTAssertTrue(items[1].next.contains("by itself"))
    }

    func testRunningWithoutTheMenuAsksForOneRestart() {
        let items = SetupChecklist.build(doctor: report([("bridge-installed", "ok"), ("cheetah-running", "ok"), ("menu-item", "fail")]), accessibilityGranted: true, clients: [])
        XCTAssertFalse(items[1].done)
        XCTAssertTrue(items[1].next.contains("Restart Cheetah3D"))
    }

    func testEverythingDoneAndActionsForTheOthers() {
        let ok = report([("bridge-installed", "ok"), ("cheetah-running", "ok"), ("menu-item", "ok")])
        XCTAssertTrue(SetupChecklist.build(doctor: ok, accessibilityGranted: true, clients: [client("current")]).allSatisfy(\.done))
        let none = SetupChecklist.build(doctor: report([("bridge-installed", "fail")]), accessibilityGranted: false, clients: [client("legacy")])
        XCTAssertEqual(none.map(\.action), [.installBridge, .none, .grantAccessibility, .openClients])
        XCTAssertEqual(SetupChecklist.build(doctor: nil, accessibilityGranted: false, clients: [])[1].next, "Checking…")
    }
}
