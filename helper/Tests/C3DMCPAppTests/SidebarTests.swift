import AppKit
import SwiftUI
import XCTest
@testable import C3DMCPApp

/// Regression test for "nothing happens when I click the sidebar": a click selects a row of the sidebar's table view, and the SwiftUI
/// selection binding must follow. (It did not while the rows were tagged with their String id but the binding held a Section.)
@MainActor
final class SidebarTests: XCTestCase {
    private func pump(_ seconds: TimeInterval = 0.3) {
        RunLoop.main.run(until: Date().addingTimeInterval(seconds))
    }

    private func firstTable(in view: NSView) -> NSTableView? {
        if let t = view as? NSTableView { return t }
        for sub in view.subviews { if let t = firstTable(in: sub) { return t } }
        return nil
    }

    func testClickingEachSidebarRowSelectsThatSection() throws {
        let model = AppModel(engine: nil)
        let host = NSHostingView(rootView: ContentView(model: model, updates: UpdateController()))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 600), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false // ARC owns the window; the default would release it a second time on close()
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        pump(1.0)
        let table = try XCTUnwrap(firstTable(in: host), "the sidebar list is not a table view")
        XCTAssertEqual(table.numberOfRows, Section.allCases.count)
        for (row, section) in Section.allCases.enumerated().reversed() {
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            pump()
            XCTAssertEqual(model.selectedSection, section, "selecting sidebar row \(row) did not select \(section)")
        }
        window.close()
    }
}
