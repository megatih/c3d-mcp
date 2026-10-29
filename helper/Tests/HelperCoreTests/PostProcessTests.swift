import CoreGraphics
import ImageIO
import XCTest
@testable import HelperCore

final class PostProcessTests: XCTestCase {
    var dir = ""
    let w = 120, h = 80

    override func setUpWithError() throws { dir = try tempDir() }
    override func tearDown() { try? FileManager.default.removeItem(atPath: dir) }

    typealias RGB = (UInt8, UInt8, UInt8)

    func writeRGB(_ name: String, _ w: Int, _ h: Int, _ f: (Int, Int) -> RGB) throws -> String {
        var px = [UInt8](repeating: 255, count: w * h * 4)
        for y in 0..<h { for x in 0..<w { let c = f(x, y); let i = (y * w + x) * 4; px[i] = c.0; px[i + 1] = c.1; px[i + 2] = c.2 } }
        let img = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                          bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                          provider: CGDataProvider(data: Data(px) as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        let path = "\(dir)/\(name).png"
        _ = try Imaging.writePNG(img, to: path)
        return path
    }

    /// Black image with a bright rectangle x 40..<80, y 25..<55.
    func rect() throws -> String {
        try writeRGB("rect", w, h) { x, y in (40..<80).contains(x) && (25..<55).contains(y) ? (230, 230, 230) : (0, 0, 0) }
    }

    func pixels(_ path: String) throws -> (w: Int, h: Int, px: [UInt8]) {
        let src = try XCTUnwrap(CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil))
        let img = try XCTUnwrap(CGImageSourceCreateImageAtIndex(src, 0, nil))
        var px = [UInt8](repeating: 0, count: img.width * img.height * 4)
        let ctx = CGContext(data: &px, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
        return (img.width, img.height, px)
    }

    func at(_ p: (w: Int, h: Int, px: [UInt8]), _ x: Int, _ y: Int) -> (Int, Int, Int) {
        let i = (y * p.w + x) * 4
        return (Int(p.px[i]), Int(p.px[i + 1]), Int(p.px[i + 2]))
    }

    func run(_ src: String, _ name: String, _ args: [String: Any]) throws -> (PostProcessResult, (w: Int, h: Int, px: [UInt8])) {
        var a = args
        a["path"] = src
        a["outPath"] = "\(dir)/\(name).png"
        var reader = ArgReader(try JSONDecoder().decode([String: JSONValue].self, from: JSONSerialization.data(withJSONObject: a)))
        let req = try PostProcessRequest.parse(&reader)
        let r = try PostProcess.run(req)
        return (r, try pixels(r.outPath))
    }

    func testBloomRaisesLumaJustOutsideRectangle() throws {
        let src = try rect()
        XCTAssertEqual(at(try pixels(src), 36, 40).0, 0)
        let (r, out) = try run(src, "bloom", ["bloom": ["threshold": 0.5, "radius": 6, "intensity": 1.0]])
        XCTAssertEqual(r.applied, ["bloom"])
        XCTAssertGreaterThan(at(out, 36, 40).0, 10)
        XCTAssertEqual(at(out, 5, 5).0, 0, accuracy: 3)
    }

    func testOutlineDarkensEdgeNotFlatRegions() throws {
        let src = try writeRGB("grey", w, h) { x, y in (40..<80).contains(x) && (25..<55).contains(y) ? (230, 230, 230) : (90, 90, 90) }
        let (_, out) = try run(src, "outline", ["outline": ["strength": 1.0, "width": 2.0, "color": [0, 0, 0]]])
        let edge = min(at(out, 40, 40).0, at(out, 39, 40).0)
        XCTAssertLessThan(edge, 120, "edge pixel was \(edge)")
        XCTAssertEqual(at(out, 60, 40).0, 230, accuracy: 3)
        XCTAssertEqual(at(out, 10, 10).0, 90, accuracy: 3)
    }

    func testVignetteDarkensCornersMoreThanCentre() throws {
        let src = try writeRGB("flat", w, h) { _, _ in (200, 200, 200) }
        let (_, out) = try run(src, "vig", ["vignette": ["intensity": 1.0, "radius": 1.0]])
        XCTAssertLessThan(at(out, 1, 1).0, 150)
        XCTAssertEqual(at(out, w / 2, h / 2).0, 200, accuracy: 10)
    }

    func testGradeSaturationZeroIsGrey() throws {
        let src = try writeRGB("color", w, h) { _, _ in (220, 40, 90) }
        let (_, out) = try run(src, "grey", ["grade": ["saturation": 0]])
        let c = at(out, 10, 10)
        XCTAssertEqual(c.0, c.1, accuracy: 2)
        XCTAssertEqual(c.1, c.2, accuracy: 2)
    }

    func testGradeExposureAndSplitTone() throws {
        let src = try writeRGB("mid", w, h) { x, _ in x < 60 ? (40, 40, 40) : (210, 210, 210) }
        let (_, out) = try run(src, "tone", ["grade": ["shadowTint": [0, 0, 1], "highlightTint": [1, 0.5, 0], "tintAmount": 1.0]])
        let s = at(out, 10, 10), l = at(out, 100, 10)
        XCTAssertGreaterThan(s.2, s.0, "shadows lean blue")
        XCTAssertGreaterThan(l.0, l.2, "highlights lean warm")
        let (_, bright) = try run(src, "ev", ["grade": ["exposure": 1.0]])
        XCTAssertGreaterThan(at(bright, 10, 10).0, 40)
    }

    func testPosterizeReducesDistinctValues() throws {
        let src = try writeRGB("ramp", 256, 8) { x, _ in (UInt8(x), UInt8(x), UInt8(x)) }
        let (_, out) = try run(src, "post", ["posterize": ["levels": 4]])
        let distinct = Set((0..<256).map { at(out, $0, 3).0 })
        XCTAssertLessThanOrEqual(distinct.count, 4)
        XCTAssertGreaterThan(distinct.count, 1)
    }

    func testAllEffectsAndJPEGOutput() throws {
        let src = try rect()
        let args: [String: Any] = ["path": src, "outPath": dir + "/all.jpg",
            "grade": ["contrast": 1.2], "posterize": ["levels": 16], "outline": ["strength": 0.5, "width": 1.0],
            "bloom": ["threshold": 0.6, "radius": 4, "intensity": 0.5], "vignette": ["intensity": 0.5, "radius": 1]]
        var reader = ArgReader(try JSONDecoder().decode([String: JSONValue].self, from: JSONSerialization.data(withJSONObject: args)))
        let r = try PostProcess.run(try PostProcessRequest.parse(&reader))
        XCTAssertEqual(r.applied, ["grade", "posterize", "outline", "bloom", "vignette"])
        XCTAssertEqual([r.width, r.height], [w, h])
        let data = try Data(contentsOf: URL(fileURLWithPath: r.outPath))
        XCTAssertEqual(data.count, r.bytes)
        XCTAssertEqual(Array(data.prefix(2)), [0xFF, 0xD8])
    }

    func testPerformanceAtRenderSize() throws {
        let src = try writeRGB("big", 1456, 816) { x, y in ((x / 8 + y / 8) % 2 == 0 ? (240, 240, 240) : (20, 30, 40)) }
        let t0 = Date()
        _ = try run(src, "perf", ["grade": ["saturation": 1.2], "outline": ["strength": 0.8, "width": 1.5],
                                  "bloom": ["threshold": 0.7, "radius": 12, "intensity": 0.6], "vignette": ["intensity": 0.4, "radius": 1]])
        XCTAssertLessThan(Date().timeIntervalSince(t0), 2.0)
    }

    // MARK: router level

    func testRouterValidationAndCollision() async throws {
        let src = try rect()
        let router = makeRouter()
        let out = dir + "/r.png"
        let ok = try await send(router, "postProcessImage", ["path": src, "outPath": out, "vignette": ["intensity": 0.5, "radius": 1]])
        XCTAssertTrue(ok.ok, ok.error?.message ?? "")
        XCTAssertEqual(ok.result?["applied"]?.arrayValue?.compactMap(\.stringValue), ["vignette"])
        let again = try await send(router, "postProcessImage", ["path": src, "outPath": out, "vignette": ["intensity": 0.5, "radius": 1]])
        XCTAssertEqual(errorCode(again), "INVALID_ARGUMENT")
        let forced = try await send(router, "postProcessImage", ["path": src, "outPath": out, "overwrite": true, "vignette": ["intensity": 0.5, "radius": 1]])
        XCTAssertTrue(forced.ok)
        let same = try await send(router, "postProcessImage", ["path": src, "outPath": src, "overwrite": true, "vignette": ["intensity": 0.5, "radius": 1]])
        XCTAssertEqual(errorCode(same), "INVALID_ARGUMENT")
        XCTAssertEqual(try pixels(src).px[(40 * w + 36) * 4], 0, "input untouched")
    }

    func testRouterRejectsBadArguments() async throws {
        let src = try rect()
        let o = dir + "/bad.png"
        let v: [String: Any] = ["intensity": 0.5, "radius": 1]
        let bad: [[String: Any]] = [
            ["path": src, "outPath": o],
            ["path": src, "outPath": o, "bloom": ["threshold": 1.5, "radius": 5, "intensity": 1]],
            ["path": src, "outPath": o, "bloom": ["threshold": 0.5, "radius": 5]],
            ["path": src, "outPath": o, "bloom": ["threshold": 0.5, "radius": 5, "intensity": 3]],
            ["path": src, "outPath": o, "outline": ["strength": 1, "width": 9]],
            ["path": src, "outPath": o, "outline": ["strength": 1, "width": 1, "color": [0, 0]]],
            ["path": src, "outPath": o, "outline": ["strength": 1, "width": 1, "color": [0, 0, 2]]],
            ["path": src, "outPath": o, "vignette": ["intensity": -1, "radius": 1]],
            ["path": src, "outPath": o, "vignette": ["intensity": "x", "radius": 1]],
            ["path": src, "outPath": o, "vignette": v.merging(["extra": 1]) { a, _ in a }],
            ["path": src, "outPath": o, "grade": ["saturation": 3]],
            ["path": src, "outPath": o, "grade": ["contrast": 0.1]],
            ["path": src, "outPath": o, "grade": ["exposure": 5]],
            ["path": src, "outPath": o, "posterize": ["levels": 1]],
            ["path": src, "outPath": o, "posterize": ["levels": 4.5]],
            ["path": src, "outPath": o, "overwrite": "yes", "vignette": v],
            ["path": src, "outPath": o, "bogus": 1, "vignette": v],
            ["path": "rel.png", "outPath": o, "vignette": v],
            ["path": src, "outPath": "out.png", "vignette": v],
            ["path": src, "outPath": dir + "/../x.png", "vignette": v],
            ["path": src, "outPath": dir + "/out.gif", "vignette": v],
            ["path": src, "outPath": dir + "/nodir/out.png", "vignette": v],
            ["path": dir + "/missing.png", "outPath": o, "vignette": v],
            ["outPath": o, "vignette": v],
        ]
        for args in bad {
            let r = try await send(makeRouter(), "postProcessImage", args)
            XCTAssertEqual(errorCode(r), "INVALID_ARGUMENT", "\(args)")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: o))
    }

    func testOversizedInputRejected() throws {
        let big = dir + "/huge.png"
        try Fixtures.writeGrayPNG(to: big, width: 8100, height: 8100) { _, _ in 0 }
        var req = PostProcessRequest(path: big, outPath: dir + "/o.png")
        req.vignette = VignetteParams(intensity: 0.5, radius: 1)
        XCTAssertThrowsError(try PostProcess.run(req)) { XCTAssertEqual(($0 as? HelperError)?.code, .invalidArgument) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: req.outPath))
    }

    func testResponseConformsToContractShape() async throws {
        let src = try rect()
        let r = try await send(makeRouter(), "postProcessImage", ["path": src, "outPath": dir + "/c.png", "posterize": ["levels": 8]])
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(r))
        XCTAssertEqual(MiniSchema.validate(encoded, against: try MiniSchema.defs("response")), [])
        let res = try XCTUnwrap(r.result)
        XCTAssertEqual(res["outPath"]?.stringValue, dir + "/c.png")
        XCTAssertEqual(res["width"]?.intValue, w)
        XCTAssertEqual(res["height"]?.intValue, h)
        XCTAssertGreaterThan(res["bytes"]?.intValue ?? 0, 0)
        XCTAssertEqual(res["applied"]?.arrayValue?.count, 1)
        let cmds = (((try MiniSchema.defs("request")["properties"]) as! [String: Any])["cmd"] as! [String: Any])["enum"] as! [String]
        XCTAssertTrue(cmds.contains("postProcessImage"))
    }

    // MARK: output path policy for the other commands

    func testDownscaleRefusesExistingAndDotDot() async throws {
        let src = try rect()
        let out = dir + "/d.png"
        let a: [String: Any] = ["path": src, "outPath": out, "maxDim": 64, "maxBytes": 1_000_000]
        let first = try await send(makeRouter(), "downscaleImage", a)
        XCTAssertTrue(first.ok)
        let second = try await send(makeRouter(), "downscaleImage", a)
        XCTAssertEqual(errorCode(second), "INVALID_ARGUMENT")
        var forced = a
        forced["overwrite"] = true
        let third = try await send(makeRouter(), "downscaleImage", forced)
        XCTAssertTrue(third.ok)
        var dd = a
        dd["outPath"] = dir + "/sub/../e.png"
        let fourth = try await send(makeRouter(), "downscaleImage", dd)
        XCTAssertEqual(errorCode(fourth), "INVALID_ARGUMENT")
        var onto = a
        onto["outPath"] = src
        onto["overwrite"] = true
        let fifth = try await send(makeRouter(), "downscaleImage", onto)
        XCTAssertEqual(errorCode(fifth), "INVALID_ARGUMENT")
    }

    func testCaptureRefusesExistingOutPath() async throws {
        let out = dir + "/cap.png"
        let first = try await send(makeRouter(), "captureWindow", ["outPath": out])
        XCTAssertTrue(first.ok)
        let second = try await send(makeRouter(), "captureWindow", ["outPath": out])
        XCTAssertEqual(errorCode(second), "INVALID_ARGUMENT")
        let forced = try await send(makeRouter(), "captureWindow", ["outPath": out, "overwrite": true])
        XCTAssertTrue(forced.ok)
        let dd = try await send(makeRouter(), "captureWindow", ["outPath": dir + "/a/../b.png"])
        XCTAssertEqual(errorCode(dd), "INVALID_ARGUMENT")
    }
}
