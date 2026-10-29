import ImageIO
import XCTest
@testable import HelperCore

final class ImagingTests: XCTestCase {
    var dir = ""

    override func setUpWithError() throws { dir = try tempDir() }
    override func tearDown() { try? FileManager.default.removeItem(atPath: dir) }

    func png(_ name: String, _ w: Int, _ h: Int, _ value: @escaping (Int, Int) -> UInt8) throws -> String {
        let path = "\(dir)/\(name).png"
        try Fixtures.writeGrayPNG(to: path, width: w, height: h, value: value)
        return path
    }

    func testSolidBlackIsBlank() throws {
        let a = try Imaging.analyze(path: png("black", 64, 32) { _, _ in 0 })
        XCTAssertTrue(a.blank)
        XCTAssertEqual(a.width, 64)
        XCTAssertEqual(a.height, 32)
        XCTAssertEqual(a.meanLuma, 0, accuracy: 0.001)
        XCTAssertEqual(a.histogram.count, 16)
        XCTAssertEqual(a.histogram[0], 64 * 32)
        XCTAssertEqual(a.histogram.reduce(0, +), 64 * 32)
    }

    func testSolidMidGrayIsBlankWithMatchingMean() throws {
        let a = try Imaging.analyze(path: png("gray", 16, 16) { _, _ in 128 })
        XCTAssertTrue(a.blank)
        XCTAssertEqual(a.meanLuma, 128.0 / 255, accuracy: 0.01)
        XCTAssertEqual(a.histogram[8], 256)
    }

    func testGradientIsNotBlank() throws {
        let a = try Imaging.analyze(path: png("grad", 256, 8) { x, _ in UInt8(x) })
        XCTAssertFalse(a.blank)
        XCTAssertEqual(a.meanLuma, 0.5, accuracy: 0.02)
        XCTAssertGreaterThan(a.stdDev, 0.2)
        XCTAssertEqual(a.histogram, [Int](repeating: 16 * 8, count: 16))
    }

    func testReportsFullSizeEvenWhenAnalysedOnThumbnail() throws {
        let a = try Imaging.analyze(path: png("big", 2000, 10) { _, _ in 200 })
        XCTAssertEqual(a.width, 2000)
        XCTAssertEqual(a.height, 10)
    }

    func testUnreadableAndGarbageFilesAreInvalidArguments() throws {
        XCTAssertThrowsError(try Imaging.analyze(path: dir + "/missing.png")) {
            XCTAssertEqual(($0 as? HelperError)?.code, .invalidArgument)
        }
        let junk = dir + "/junk.png"
        try Data("not an image".utf8).write(to: URL(fileURLWithPath: junk))
        XCTAssertThrowsError(try Imaging.analyze(path: junk))
    }

    func testDownscaleHonoursMaxDimAndKeepsPNG() throws {
        let src = try png("src", 800, 400) { x, y in UInt8((x + y) % 256) }
        let r = try Imaging.downscale(path: src, outPath: dir + "/out.png", maxDim: 200, maxBytes: 10_000_000)
        XCTAssertEqual(r.format, "png")
        XCTAssertEqual(r.width, 200)
        XCTAssertEqual(r.height, 100)
        XCTAssertEqual(r.path, dir + "/out.png")
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: r.path)).count, r.bytes)
    }

    func testDownscaleNeverUpscales() throws {
        let src = try png("small", 50, 20) { _, _ in 9 }
        let r = try Imaging.downscale(path: src, outPath: dir + "/o.png", maxDim: 1000, maxBytes: 10_000_000)
        XCTAssertEqual(r.width, 50)
    }

    func testDownscaleFallsBackToJPEGWhenPNGTooLarge() throws {
        var seed: UInt64 = 1
        let noisy = try png("noise", 400, 400) { _, _ in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return UInt8(truncatingIfNeeded: seed >> 56)
        }
        let r = try Imaging.downscale(path: noisy, outPath: dir + "/n.png", maxDim: 400, maxBytes: 60_000)
        XCTAssertEqual(r.format, "jpeg")
        XCTAssertTrue(r.path.hasSuffix(".jpg"))
        XCTAssertLessThanOrEqual(r.bytes, 60_000)
        XCTAssertLessThanOrEqual(max(r.width, r.height), 400)
        XCTAssertTrue(FileManager.default.fileExists(atPath: r.path))
    }

    func testDownscaleImpossibleBudgetFails() throws {
        var seed: UInt64 = 7
        let noisy = try png("noise2", 300, 300) { _, _ in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return UInt8(truncatingIfNeeded: seed >> 56)
        }
        XCTAssertThrowsError(try Imaging.downscale(path: noisy, outPath: dir + "/z.png", maxDim: 300, maxBytes: 100)) {
            XCTAssertEqual(($0 as? HelperError)?.code, .invalidArgument)
        }
    }
}
