import AppKit
import ApplicationServices
import Foundation

/// Wraps an `AXUIElement`. Reads never throw: a failed read yields nil / false.
final class RealElement: UIElement, @unchecked Sendable {
    static let messagingTimeout: Float = 1

    private let ref: AXUIElement

    init(_ ref: AXUIElement) {
        self.ref = ref
        AXUIElementSetMessagingTimeout(ref, Self.messagingTimeout)
    }

    private func copy(_ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(ref, attribute as CFString, &value) == .success ? value : nil
    }

    private func string(_ attribute: String) -> String? { copy(attribute) as? String }

    private func bool(_ attribute: String) -> Bool {
        guard let v = copy(attribute), CFGetTypeID(v) == CFBooleanGetTypeID() else { return false }
        return CFBooleanGetValue((v as! CFBoolean))
    }

    var role: String? { string(kAXRoleAttribute) }
    var subrole: String? { string(kAXSubroleAttribute) }
    var title: String? { string(kAXTitleAttribute) }
    var stringValue: String? { string(kAXValueAttribute) ?? string(kAXDescriptionAttribute) }
    var isEnabled: Bool { bool(kAXEnabledAttribute) }
    var isMain: Bool { bool(kAXMainAttribute) }
    var isFocused: Bool { bool(kAXFocusedAttribute) }
    var isMinimized: Bool { bool(kAXMinimizedAttribute) }
    var documentPath: String? { string(kAXDocumentAttribute) }

    var children: [any UIElement] {
        let raw = copy(kAXChildrenAttribute) as? [AXUIElement] ?? []
        return raw.map { RealElement($0) }
    }

    private static func result(_ e: AXError) -> AXActionResult {
        switch e {
        case .success: .success
        case .cannotComplete: .cannotComplete
        default: .failed(e.rawValue)
        }
    }

    func press() -> AXActionResult { Self.result(AXUIElementPerformAction(ref, kAXPressAction as CFString)) }
    func raise() -> AXActionResult { Self.result(AXUIElementPerformAction(ref, kAXRaiseAction as CFString)) }
}

/// Production provider backed by AppKit and the Accessibility API.
public struct RealAX: AXProvider {
    public init() {}

    public func isProcessTrusted() -> Bool { AXIsProcessTrusted() }
    public func screenRecordingGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    private func describe(_ app: NSRunningApplication) -> RunningApp {
        var version: String?
        if let url = app.bundleURL {
            version = Bundle(url: url)?.infoDictionary?["CFBundleShortVersionString"] as? String
        }
        return RunningApp(pid: app.processIdentifier, name: app.localizedName, version: version, isFrontmost: app.isActive)
    }

    public func cheetahApp() -> RunningApp? {
        NSRunningApplication.runningApplications(withBundleIdentifier: Cheetah.bundleID)
            .first { !$0.isTerminated }.map(describe)
    }

    public func frontmostApp() -> RunningApp? {
        NSWorkspace.shared.frontmostApplication.map(describe)
    }

    public func activate(pid: Int32) -> Bool {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, RealElement.messagingTimeout)
        let viaAX = AXUIElementSetAttributeValue(element, kAXFrontmostAttribute as CFString, kCFBooleanTrue) == .success
        let viaApp = NSRunningApplication(processIdentifier: pid)?.activate() ?? false
        return viaAX || viaApp
    }

    public func isResponsive(pid: Int32) -> Bool {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, RealElement.messagingTimeout)
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success
    }

    public func menuBar(pid: Int32) -> (any UIElement)? {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, RealElement.messagingTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXMenuBarAttribute as CFString, &value) == .success,
              let bar = value, CFGetTypeID(bar) == AXUIElementGetTypeID() else { return nil }
        return RealElement(bar as! AXUIElement)
    }

    public func windows(pid: Int32) -> [any UIElement] {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, RealElement.messagingTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value) == .success,
              let raw = value as? [AXUIElement] else { return [] }
        return raw.map { RealElement($0) }
    }

    public func launchCheetah() async throws -> Int32 {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Cheetah.bundleID) else {
            throw HelperError(.appNotRunning, "Cheetah3D is not installed (bundle \(Cheetah.bundleID) not found)")
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        return try await withCheckedThrowingContinuation { cont in
            NSWorkspace.shared.openApplication(at: url, configuration: config) { app, error in
                if let app { cont.resume(returning: app.processIdentifier) }
                else { cont.resume(throwing: error ?? HelperError(.internalError, "openApplication returned nothing")) }
            }
        }
    }

    public func nowMs() -> Int { Int(DispatchTime.now().uptimeNanoseconds / 1_000_000) }

    public func sleep(ms: Int) async {
        try? await Task.sleep(for: .milliseconds(ms))
    }
}
