import CoreGraphics
import Foundation
import ScreenCaptureKit

public struct CropRect: Sendable, Equatable {
    public var x: Double, y: Double, width: Double, height: Double
}

/// Window screenshot source (ScreenCaptureKit in production, stubbed in tests).
public protocol WindowCapturing: Sendable {
    func capture(bundleID: String, title: String?, crop: CropRect?) async throws -> CGImage
}

public struct SCKWindowCapturer: WindowCapturing {
    public init() {}

    public func capture(bundleID: String, title: String?, crop: CropRect?) async throws -> CGImage {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        } catch {
            throw HelperError(.permissionMissing, "ScreenCaptureKit denied access: \(error.localizedDescription)")
        }
        let windows = content.windows.filter {
            $0.owningApplication?.bundleIdentifier == bundleID && $0.windowLayer == 0
        }
        let picked: SCWindow?
        if let title {
            picked = windows.first { $0.title == title }
        } else {
            picked = windows.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
        }
        guard let window = picked else {
            throw HelperError(.triggerFailed, "no matching on-screen Cheetah3D window",
                              details: .object(["windows": .array(windows.map { .string($0.title ?? "") })]))
        }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = Double(filter.pointPixelScale)
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        guard let crop else { return image }
        let rect = CGRect(x: crop.x * scale, y: crop.y * scale, width: crop.width * scale, height: crop.height * scale)
        guard let cropped = image.cropping(to: rect.integral) else {
            throw HelperError(.invalidArgument, "crop rectangle lies outside the window")
        }
        return cropped
    }
}
