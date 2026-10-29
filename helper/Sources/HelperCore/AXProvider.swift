import Foundation

public enum AXActionResult: Sendable, Equatable {
    case success
    /// `kAXErrorCannotComplete`: the target did not answer in time (usually busy running the action).
    case cannotComplete
    case failed(Int32)
}

/// One accessibility element (menu bar, menu item, window, button, static text ...).
public protocol UIElement: AnyObject, Sendable {
    var role: String? { get }
    var subrole: String? { get }
    /// `nil` models the AX "missing value" returned for menu separators.
    var title: String? { get }
    var stringValue: String? { get }
    var isEnabled: Bool { get }
    var isMain: Bool { get }
    var isFocused: Bool { get }
    var isMinimized: Bool { get }
    var documentPath: String? { get }
    var children: [any UIElement] { get }
    func press() -> AXActionResult
    func raise() -> AXActionResult
}

public struct RunningApp: Sendable, Equatable {
    public var pid: Int32
    public var name: String?
    public var version: String?
    public var isFrontmost: Bool

    public init(pid: Int32, name: String? = nil, version: String? = nil, isFrontmost: Bool = false) {
        self.pid = pid
        self.name = name
        self.version = version
        self.isFrontmost = isFrontmost
    }
}

/// Everything the helper needs from the OS. `RealAX` talks to macOS, `FakeAX` scripts it for tests.
public protocol AXProvider: Sendable {
    func isProcessTrusted() -> Bool
    func screenRecordingGranted() -> Bool
    func cheetahApp() -> RunningApp?
    func frontmostApp() -> RunningApp?
    /// Best-effort activation; returns whether a request was issued.
    func activate(pid: Int32) -> Bool
    /// True when the app answers a trivial AX query within the messaging timeout.
    func isResponsive(pid: Int32) -> Bool
    func menuBar(pid: Int32) -> (any UIElement)?
    func windows(pid: Int32) -> [any UIElement]
    func launchCheetah() async throws -> Int32
    func nowMs() -> Int
    func sleep(ms: Int) async
}

/// Constants shared by the real and fake implementations.
public enum Cheetah {
    public static let bundleID = "de.wengenmayer.Cheetah3D"
    public static let defaultBridgeMenuPath = ["Tools", "Script", "Macro Script", "C3D-MCP", "C3D-MCP Bridge.js"]
    public static let newDocumentMenuPath = ["File", "New"]
    /// Auxiliary windows that are never valid targets for a document raise.
    public static let nonDocumentWindowTitles: Set<String> = ["Render Manager"]
}
