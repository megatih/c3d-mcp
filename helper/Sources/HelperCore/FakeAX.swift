import Foundation

/// Scriptable element for tests and the self test. Records `press:`/`raise:` events on its owner.
public final class FakeElement: UIElement, @unchecked Sendable {
    public var role: String?
    public var subrole: String?
    public var title: String?
    public var stringValue: String?
    public var enabled = true
    /// Overrides `enabled` when set (evaluated at read time against the owning `FakeAX`).
    public var enabledRule: ((FakeAX) -> Bool)?
    public var isMain = false
    public var isFocused = false
    public var isMinimized = false
    public var documentPath: String?
    public var kids: [FakeElement] = []
    public var pressResult: AXActionResult = .success
    public var onPress: ((FakeAX) -> Void)?
    unowned let owner: FakeAX

    init(owner: FakeAX, role: String?, title: String? = nil) {
        self.owner = owner
        self.role = role
        self.title = title
    }

    public var isEnabled: Bool { enabledRule?(owner) ?? enabled }
    public var children: [any UIElement] { kids }

    public func press() -> AXActionResult {
        owner.events.append("press:\(title ?? "")")
        onPress?(owner)
        return pressResult
    }

    public func raise() -> AXActionResult {
        owner.events.append("raise:\(title ?? "")")
        for w in owner.windowList { w.isMain = (w === self) }
        return .success
    }

    @discardableResult
    public func add(_ role: String, _ title: String? = nil, value: String? = nil) -> FakeElement {
        let e = FakeElement(owner: owner, role: role, title: title)
        e.stringValue = value
        kids.append(e)
        return e
    }
}

/// In-memory Cheetah3D: menu tree, windows, frontmost-app switching and a virtual clock.
public final class FakeAX: AXProvider, @unchecked Sendable {
    public static let cheetahPID: Int32 = 4242
    public static let otherPID: Int32 = 100

    public var trusted = true
    public var screenGranted = true
    public var cheetahRunning = true
    public var frontmostPID: Int32 = FakeAX.otherPID
    public var responsive = true
    /// Virtual milliseconds; `sleep` advances it instantly.
    public var clock = 1_000
    public var events: [String] = []
    /// Clock value at the most recent activation of Cheetah.
    public var activatedAt: Int?
    /// Menu items governed by `bridgeEnableDelayMs` become enabled this long after activation.
    public var bridgeEnableDelayMs = 100
    public private(set) var menuBarElement: FakeElement!
    public private(set) var windowList: [FakeElement] = []
    public private(set) var bridgeItem: FakeElement!
    public private(set) var newItem: FakeElement!
    public var launchedPID: Int32 = FakeAX.cheetahPID

    public init(windowTitles: [String] = ["Untitled", "Untitled 2"]) {
        menuBarElement = FakeElement(owner: self, role: "AXMenuBar")
        let file = menuBarElement.add("AXMenuBarItem", "File").add("AXMenu")
        newItem = file.add("AXMenuItem", "New")
        newItem.enabledRule = { $0.cheetahActive }
        file.add("AXMenuItem", nil).enabled = false // separator: "missing value"
        file.add("AXMenuItem", "Open...")
        let macros = menuBarElement.add("AXMenuBarItem", "Tools").add("AXMenu")
            .add("AXMenuItem", "Script").add("AXMenu")
            .add("AXMenuItem", "Macro Script").add("AXMenu")
            .add("AXMenuItem", "C3D-MCP").add("AXMenu")
        bridgeItem = macros.add("AXMenuItem", "C3D-MCP Bridge.js")
        bridgeItem.enabledRule = { fake in
            fake.cheetahActive && fake.activatedAt.map { fake.clock - $0 >= fake.bridgeEnableDelayMs } == true
        }
        for t in windowTitles { addWindow(t) }
        windowList.first?.isMain = true
    }

    public var cheetahActive: Bool { frontmostPID == Self.cheetahPID }

    @discardableResult
    public func addWindow(_ title: String, subrole: String = "AXStandardWindow") -> FakeElement {
        let w = FakeElement(owner: self, role: "AXWindow", title: title)
        w.subrole = subrole
        windowList.append(w)
        return w
    }

    /// Adds an `AXDialog` window with static text and an OK button.
    @discardableResult
    public func addDialog(text: String, buttons: [String] = ["OK"]) -> FakeElement {
        let w = addWindow("", subrole: "AXDialog")
        w.add("AXStaticText", value: text)
        for b in buttons {
            w.add("AXButton", b).onPress = { fake in fake.windowList.removeAll { $0 === w } }
        }
        return w
    }

    // MARK: AXProvider

    public func isProcessTrusted() -> Bool { trusted }
    public func screenRecordingGranted() -> Bool { screenGranted }

    public func cheetahApp() -> RunningApp? {
        cheetahRunning ? RunningApp(pid: Self.cheetahPID, name: "Cheetah3D", version: "8.1.3", isFrontmost: cheetahActive) : nil
    }

    public func frontmostApp() -> RunningApp? {
        frontmostPID == Self.cheetahPID ? cheetahApp()
            : RunningApp(pid: frontmostPID, name: "Terminal", version: nil, isFrontmost: true)
    }

    public func activate(pid: Int32) -> Bool {
        events.append("activate:\(pid)")
        frontmostPID = pid
        if pid == Self.cheetahPID { activatedAt = clock }
        return true
    }

    public func isResponsive(pid: Int32) -> Bool { responsive }
    public func menuBar(pid: Int32) -> (any UIElement)? { cheetahRunning ? menuBarElement : nil }
    public func windows(pid: Int32) -> [any UIElement] { cheetahRunning ? windowList : [] }

    public func launchCheetah() async throws -> Int32 {
        events.append("launch")
        cheetahRunning = true
        return launchedPID
    }

    public func nowMs() -> Int { clock }

    public func sleep(ms: Int) async { clock += ms }
}
