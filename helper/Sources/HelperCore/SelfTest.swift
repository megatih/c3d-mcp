import CoreGraphics
import Foundation

/// Generates fixture images (also used by the XCTests).
public enum Fixtures {
    /// Writes an 8-bit gray PNG whose pixel values come from `value(x, y)`.
    public static func writeGrayPNG(to path: String, width: Int, height: Int, value: (Int, Int) -> UInt8) throws {
        var pixels = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height { for x in 0..<width { pixels[y * width + x] = value(x, y) } }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        guard let image = CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
            throw HelperError(.internalError, "fixture image creation failed")
        }
        _ = try Imaging.writePNG(image, to: path)
    }
}

/// `C3DBridgeHelper --selftest`: exercises the logic against FakeAX; never touches real apps.
public enum SelfTest {
    public static func run() async -> Bool {
        var failures = 0
        func check(_ name: String, _ ok: Bool) {
            print("\(ok ? "PASS" : "FAIL") \(name)")
            if !ok { failures += 1 }
        }

        let fake = FakeAX()
        let presser = Presser(ax: fake, modals: OwnModalRegistry())
        let outcome = try? await presser.press(PressRequest(path: Cheetah.defaultBridgeMenuPath))
        check("press sequence order", fake.events == ["activate:\(FakeAX.cheetahPID)", "raise:Untitled", "press:C3D-MCP Bridge.js", "activate:\(FakeAX.otherPID)"])
        check("press reports activation delay", outcome?.activatedMs == fake.bridgeEnableDelayMs)

        let blocked = FakeAX()
        blocked.addDialog(text: "Texture baking error!")
        do {
            _ = try await Presser(ax: blocked, modals: OwnModalRegistry()).press(PressRequest(path: Cheetah.defaultBridgeMenuPath))
            check("modal blocks press", false)
        } catch let e as HelperError {
            check("modal blocks press", e.code == .blockedByModal && blocked.events.isEmpty)
        } catch {
            check("modal blocks press", false)
        }

        let dir = NSTemporaryDirectory() + "c3d-selftest-\(getpid())"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let png = dir + "/black.png"
        if (try? Fixtures.writeGrayPNG(to: png, width: 32, height: 16, value: { _, _ in 0 })) != nil,
           let analysis = try? Imaging.analyze(path: png) {
            check("black image is blank", analysis.blank && analysis.width == 32 && analysis.height == 16)
        } else {
            check("black image is blank", false)
        }

        let socket = dir + "/s.sock"
        let router = CommandRouter(ax: FakeAX(), capturer: SCKWindowCapturer(), version: "selftest")
        let server = SocketServer(path: socket, router: router, log: .silent)
        do {
            try server.start()
            let reply = try SocketClient(path: socket).call(.ping)
            check("socket ping", reply.ok && reply.result?["version"]?.stringValue == "selftest")
            let bad = try SocketClient(path: socket).exchange(lines: [Data("{nope".utf8)])
            check("malformed JSON rejected", (try? JSONDecoder().decode(Response.self, from: bad[0]))?.error?.code == "INVALID_ARGUMENT")
        } catch {
            check("socket round trip (\(error))", false)
        }
        server.stop()

        print(failures == 0 ? "selftest OK" : "selftest FAILED (\(failures))")
        return failures == 0
    }
}
