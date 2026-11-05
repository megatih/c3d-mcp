import AppCore
import Foundation
import XCTest
@testable import C3DMCPApp

/// The bug of 0.4.1: the health check ran once at start-up (before Cheetah3D was running) and never again, so the page stayed red.
/// `/bin/sh fake.sh` stands in for `node c3d-mcp.js`; the first doctor run reports a failure, later ones pass.
@MainActor
final class HealthRefreshTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("health-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    private func model(failFirst: Int) throws -> AppModel {
        let script = dir.appendingPathComponent("fake.sh")
        try """
        case "$1" in
          status) echo '{"kind":"current","components":[],"recommended":"none","summary":"ok"}' ;;
          doctor)
            echo "$@" >> "$FAKE_LOG"
            n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FAKE_COUNT"
            if [ "$n" -le "$FAKE_FAIL" ]; then echo '{"ok":false,"summary":"1 failure","checks":[{"name":"cheetah-running","status":"fail","detail":"","fix":""}]}'
            else echo '{"ok":true,"summary":"All checks passed","checks":[{"name":"cheetah-running","status":"ok","detail":"","fix":""},{"name":"menu-item","status":"ok","detail":"","fix":""}]}'; fi ;;
          *) echo '[]' ;;
        esac
        """.write(to: script, atomically: true, encoding: .utf8)
        let env = ["FAKE_LOG": dir.appendingPathComponent("log").path, "FAKE_COUNT": dir.appendingPathComponent("count").path, "FAKE_FAIL": String(failFirst)]
        let engine = Engine(locator: EngineLocator(node: URL(fileURLWithPath: "/bin/sh"), script: script), environment: env, timeoutSeconds: 20)
        let m = AppModel(engine: engine)
        m.healthPolicy = HealthRefreshPolicy(activationThrottle: 0, launchGaps: [0.05, 0.05, 0.05])
        m.pause = { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        return m
    }

    private func runs() -> Int { Int((try? String(contentsOf: dir.appendingPathComponent("count"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "0") ?? 0 }
    private func logLines() -> [String] { ((try? String(contentsOf: dir.appendingPathComponent("log"), encoding: .utf8)) ?? "").split(separator: "\n").map(String.init) }

    private func wait(_ what: String, timeout: TimeInterval = 10, _ condition: () -> Bool) async {
        let end = Date().addingTimeInterval(timeout)
        while !condition() && Date() < end { try? await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertTrue(condition(), what)
    }

    func testAStaleRedResultTurnsGreenByItselfAfterCheetahStarts() async throws {
        let m = try model(failFirst: 1)
        await m.refreshHealth(passive: false) // the start-up check, before Cheetah3D exists
        XCTAssertEqual(m.doctor?.ok, false)
        XCTAssertNotNil(m.lastChecked)
        XCTAssertFalse(m.checklist[1].done)
        m.cheetahLaunched() // the NSWorkspace launch notification
        await wait("the page turns green without anyone pressing Refresh") { m.doctor?.ok == true }
        XCTAssertTrue(m.checklist[1].done)
        XCTAssertEqual(runs(), 2)
        XCTAssertEqual(logLines().first?.contains("--passive"), false, "the explicit start-up check is the full one")
        XCTAssertTrue(logLines().dropFirst().allSatisfy { $0.contains("--passive") }, "automatic re-checks must not run the live ping round trip")
    }

    func testItKeepsLookingWhileRedAndStopsOnceGreen() async throws {
        let m = try model(failFirst: 2) // the menu bar is not ready for the first two looks
        m.cheetahLaunched()
        await wait("green on the third look") { m.doctor?.ok == true }
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(runs(), 3, "no further runs after the first green result")
    }

    func testAHealthySetupIsCheckedOnceAfterALaunchAndThenLeftAlone() async throws {
        let m = try model(failFirst: 0)
        m.cheetahLaunched()
        await wait("one check") { self.runs() >= 1 }
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(runs(), 1)
    }

    func testCheetahQuittingShowsRedAtOnceAndCancelsPendingLooks() async throws {
        let m = try model(failFirst: 5)
        m.cheetahLaunched()
        m.cheetahTerminated()
        await wait("one passive check for the quit") { self.runs() >= 1 }
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(runs(), 1, "the pending post-launch looks were cancelled")
        XCTAssertEqual(m.doctor?.ok, false)
    }

    func testReturningToTheWindowRechecksButNotWhileBusyOrTooSoon() async throws {
        let m = try model(failFirst: 0)
        m.healthPolicy = HealthRefreshPolicy(activationThrottle: 60, launchGaps: [0.05])
        m.appBecameActive()
        await wait("first activation checks") { self.runs() == 1 }
        m.appBecameActive() // inside the 60 s throttle window
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(runs(), 1)
        m.healthPolicy = HealthRefreshPolicy(activationThrottle: 0, launchGaps: [0.05])
        m.busy = "Installing…"
        m.appBecameActive() // an action is running
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(runs(), 1)
        m.busy = nil
        m.appBecameActive()
        await wait("checks again once idle") { self.runs() == 2 }
    }
}
