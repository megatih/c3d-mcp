import XCTest
@testable import HelperCore

final class MenuAndModalTests: XCTestCase {
    func testResolvesFullPathThroughAXMenuWrappers() throws {
        let fake = FakeAX()
        let item = try MenuWalker.resolve(menuBar: fake.menuBarElement, path: Cheetah.defaultBridgeMenuPath)
        XCTAssertTrue(item === fake.bridgeItem)
    }

    func testMissingItemReportsFailurePointAndAlternatives() {
        let fake = FakeAX()
        XCTAssertThrowsError(try MenuWalker.resolve(menuBar: fake.menuBarElement, path: ["Tools", "Script", "Nope"])) {
            let e = $0 as? HelperError
            XCTAssertEqual(e?.code, .triggerFailed)
            XCTAssertEqual(e?.details?["failedAt"]?.intValue, 2)
            XCTAssertEqual(e?.details?["available"]?.arrayValue, [.string("Macro Script")])
        }
    }

    func testSeparatorsWithMissingValueAreSkipped() throws {
        let fake = FakeAX()
        XCTAssertThrowsError(try MenuWalker.resolve(menuBar: fake.menuBarElement, path: ["File", ""]))
        let open = try MenuWalker.resolve(menuBar: fake.menuBarElement, path: ["File", "Open..."])
        XCTAssertEqual(open.title, "Open...")
        let tree = MenuWalker.tree(of: fake.menuBarElement, depth: 2)
        let file = tree["children"]?.arrayValue?.first
        let titles = file?["children"]?.arrayValue?.compactMap { $0["title"]?.stringValue }
        XCTAssertEqual(titles, ["New", "", "Open..."])
    }

    func testEllipsisVariantsMatch() throws {
        let fake = FakeAX()
        let open = try MenuWalker.resolve(menuBar: fake.menuBarElement, path: ["File", "Open\u{2026}"])
        XCTAssertEqual(open.title, "Open...")
    }

    func testTreeDepthLimit() {
        let tree = MenuWalker.tree(of: FakeAX().menuBarElement, depth: 1)
        XCTAssertNil(tree["children"]?.arrayValue?.first?["children"]?.arrayValue?.first?["children"])
    }

    func testModalDetectionCollectsTitleTextAndButtons() {
        let fake = FakeAX()
        fake.addDialog(text: "Texture baking error!", buttons: ["OK", "Cancel"])
        let found = ModalDetector.detect(windows: fake.windowList, registry: OwnModalRegistry(), nowMs: 0)
        XCTAssertEqual(found.count, 1)
        XCTAssertEqual(found[0].info.text, "Texture baking error!")
        XCTAssertEqual(found[0].info.buttons, ["OK", "Cancel"])
        XCTAssertFalse(found[0].info.own)
    }

    func testStandardWindowsAreNotModals() {
        XCTAssertTrue(ModalDetector.detect(windows: FakeAX().windowList, registry: OwnModalRegistry(), nowMs: 0).isEmpty)
    }

    func testDismissOwnModalClicksOKOnlyForRegisteredDialogs() async throws {
        let fake = FakeAX()
        let router = makeRouter(fake)
        fake.addDialog(text: "Import settings")
        var r = try await send(router, "dismissOwnModal", ["text": "Import"])
        XCTAssertEqual(r.result?["dismissed"]?.boolValue, false, "unregistered dialogs are never dismissed")
        router.modals.register("Import settings", nowMs: fake.clock)
        r = try await send(router, "dismissOwnModal", ["text": "Nonmatching"])
        XCTAssertEqual(r.result?["dismissed"]?.boolValue, false)
        r = try await send(router, "dismissOwnModal", ["text": "Import"])
        XCTAssertEqual(r.result?["dismissed"]?.boolValue, true)
        XCTAssertTrue(fake.events.contains("press:OK"))
        XCTAssertEqual(fake.windowList.count, 2)
    }
}
