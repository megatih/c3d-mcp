import XCTest
@testable import HelperCore

final class PressSequenceTests: XCTestCase {
    let bridge = Cheetah.defaultBridgeMenuPath
    let cheetah = FakeAX.cheetahPID
    let other = FakeAX.otherPID

    func presser(_ fake: FakeAX, _ reg: OwnModalRegistry = OwnModalRegistry()) -> Presser {
        Presser(ax: fake, modals: reg)
    }

    func testHappyPathOrderAndTiming() async throws {
        let fake = FakeAX()
        let outcome = try await presser(fake).press(PressRequest(path: bridge))
        XCTAssertEqual(fake.events, ["activate:\(cheetah)", "raise:Untitled", "press:C3D-MCP Bridge.js", "activate:\(other)"])
        XCTAssertEqual(outcome.activatedMs, 100)
        XCTAssertEqual(outcome.activatedMs % Presser.pollMs, 0)
        XCTAssertFalse(outcome.busy)
        XCTAssertEqual(fake.frontmostPID, other)
    }

    func testRaiseHappensBeforePressAndAfterActivate() async throws {
        let fake = FakeAX()
        _ = try await presser(fake).press(PressRequest(path: bridge))
        let i = fake.events.firstIndex
        XCTAssertLessThan(i("activate:\(cheetah)")!, i("raise:Untitled")!)
        XCTAssertLessThan(i("raise:Untitled")!, i("press:C3D-MCP Bridge.js")!)
    }

    func testEnabledPollTimeoutRestoresPreviousApp() async {
        let fake = FakeAX()
        fake.bridgeEnableDelayMs = 60_000
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge, timeoutMs: 200))
            XCTFail("expected TRIGGER_FAILED")
        } catch let e as HelperError {
            XCTAssertEqual(e.code, .triggerFailed)
            XCTAssertGreaterThanOrEqual(e.details?["waitedMs"]?.intValue ?? 0, 200)
            XCTAssertLessThan(e.details?["waitedMs"]?.intValue ?? 0, 260)
        } catch { XCTFail("\(error)") }
        XCTAssertFalse(fake.events.contains("press:C3D-MCP Bridge.js"))
        XCTAssertEqual(fake.events.last, "activate:\(other)")
    }

    func testPressFailureStillRestores() async {
        let fake = FakeAX()
        fake.bridgeItem.pressResult = .failed(-25205)
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError {
            XCTAssertEqual(e.code, .triggerFailed)
            XCTAssertEqual(e.details?["axError"]?.intValue, -25205)
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(fake.events.last, "activate:\(other)")
    }

    func testCannotCompleteMeansDispatchedBusy() async throws {
        let fake = FakeAX()
        fake.bridgeItem.pressResult = .cannotComplete
        let outcome = try await presser(fake).press(PressRequest(path: bridge))
        XCTAssertTrue(outcome.busy)
        XCTAssertEqual(fake.events.last, "activate:\(other)")
    }

    func testAlreadyFrontmostNeitherActivatesNorRestores() async throws {
        let fake = FakeAX()
        fake.frontmostPID = cheetah
        fake.activatedAt = fake.clock - 10_000
        _ = try await presser(fake).press(PressRequest(path: bridge))
        XCTAssertEqual(fake.events, ["raise:Untitled", "press:C3D-MCP Bridge.js"])
    }

    func testRaisesWindowByTitle() async throws {
        let fake = FakeAX()
        _ = try await presser(fake).press(PressRequest(path: bridge, docTitle: "Untitled 2"))
        XCTAssertTrue(fake.events.contains("raise:Untitled 2"))
        XCTAssertFalse(fake.events.contains("raise:Untitled"))
    }

    func testMissingTitledWindowFailsWithoutActivating() async {
        let fake = FakeAX()
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge, docTitle: "Nope"))
            XCTFail("expected error")
        } catch let e as HelperError {
            XCTAssertEqual(e.code, .triggerFailed)
            XCTAssertEqual(e.details?["windows"]?.arrayValue?.count, 2)
        } catch { XCTFail("\(error)") }
        XCTAssertTrue(fake.events.isEmpty)
    }

    func testRenderManagerIsNeverTheTarget() async throws {
        let fake = FakeAX(windowTitles: ["Render Manager", "Scene"])
        _ = try await presser(fake).press(PressRequest(path: bridge))
        XCTAssertTrue(fake.events.contains("raise:Scene"))
    }

    func testPrefersMainDocumentWindow() async throws {
        let fake = FakeAX(windowTitles: ["A", "B"])
        _ = fake.windowList[1].raise()
        fake.events.removeAll()
        _ = try await presser(fake).press(PressRequest(path: bridge))
        XCTAssertTrue(fake.events.contains("raise:B"))
    }

    func testNoDocumentWindow() async {
        let fake = FakeAX(windowTitles: [])
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError { XCTAssertEqual(e.code, .triggerFailed) } catch { XCTFail("\(error)") }
    }

    func testAppNotRunning() async {
        let fake = FakeAX()
        fake.cheetahRunning = false
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError { XCTAssertEqual(e.code, .appNotRunning) } catch { XCTFail("\(error)") }
    }

    func testPermissionMissing() async {
        let fake = FakeAX()
        fake.trusted = false
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError { XCTAssertEqual(e.code, .permissionMissing) } catch { XCTFail("\(error)") }
    }

    func testForeignModalBlocksWithDetails() async {
        let fake = FakeAX()
        fake.addDialog(text: "Fileformat .X is not supported.", buttons: ["OK"])
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError {
            XCTAssertEqual(e.code, .blockedByModal)
            let dialog = e.details?["dialogs"]?.arrayValue?.first
            XCTAssertEqual(dialog?["text"]?.stringValue, "Fileformat .X is not supported.")
            XCTAssertEqual(dialog?["buttons"]?.arrayValue, [.string("OK")])
        } catch { XCTFail("\(error)") }
        XCTAssertTrue(fake.events.isEmpty, "must not touch focus when blocked")
    }

    func testSheetRoleAlsoBlocks() async {
        let fake = FakeAX()
        let sheet = fake.addWindow("", subrole: "")
        sheet.role = "AXSheet"
        do {
            _ = try await presser(fake).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError { XCTAssertEqual(e.code, .blockedByModal) } catch { XCTFail("\(error)") }
    }

    func testOwnModalIsAllowed() async throws {
        let fake = FakeAX()
        let reg = OwnModalRegistry()
        reg.register("Import settings", nowMs: fake.clock)
        fake.addDialog(text: "Import settings for model.fbx")
        _ = try await presser(fake, reg).press(PressRequest(path: bridge))
        XCTAssertTrue(fake.events.contains("press:C3D-MCP Bridge.js"))
    }

    func testOwnModalRegistrationExpires() async {
        let fake = FakeAX()
        let reg = OwnModalRegistry()
        reg.register("Import settings", nowMs: fake.clock - OwnModalRegistry.ttlMs - 1)
        fake.addDialog(text: "Import settings for model.fbx")
        do {
            _ = try await presser(fake, reg).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError { XCTAssertEqual(e.code, .blockedByModal) } catch { XCTFail("\(error)") }
    }

    func testOnlyForeignDialogsBlockWhenOwnOnePresent() async {
        let fake = FakeAX()
        let reg = OwnModalRegistry()
        reg.register("Import settings", nowMs: fake.clock)
        fake.addDialog(text: "Import settings")
        fake.addDialog(text: "Texture baking error!")
        do {
            _ = try await presser(fake, reg).press(PressRequest(path: bridge))
            XCTFail("expected error")
        } catch let e as HelperError {
            XCTAssertEqual(e.details?["dialogs"]?.arrayValue?.count, 1)
        } catch { XCTFail("\(error)") }
    }

    func testOwnModalTextRegisteredAfterPress() async throws {
        let fake = FakeAX()
        let reg = OwnModalRegistry()
        _ = try await presser(fake, reg).press(PressRequest(path: Cheetah.newDocumentMenuPath, ownModalText: "Merge"))
        XCTAssertTrue(reg.matches("Merge options", nowMs: fake.clock))
    }

    func testNewDocumentReportsFreshWindowTitle() async throws {
        let fake = FakeAX()
        fake.newItem.onPress = { $0.addWindow("Untitled 3") }
        let ax = fake
        let title = try await Lifecycle(ax: ax, presser: presser(ax)).newDocument()
        XCTAssertEqual(title, "Untitled 3")
        XCTAssertEqual(fake.events.last, "activate:\(other)")
    }

    func testNewDocumentFailsWhenNoWindowAppears() async {
        let fake = FakeAX()
        do {
            _ = try await Lifecycle(ax: fake, presser: presser(fake)).newDocument()
            XCTFail("expected error")
        } catch let e as HelperError { XCTAssertEqual(e.code, .triggerFailed) } catch { XCTFail("\(error)") }
    }

    func testLaunchAppStartsAndWaitsForMenuBar() async throws {
        let fake = FakeAX()
        fake.cheetahRunning = false
        fake.launchedPID = 777
        let pid = try await Lifecycle(ax: fake, presser: presser(fake)).launchApp()
        XCTAssertEqual(pid, 777)
        XCTAssertEqual(fake.events, ["launch"])
    }
}
