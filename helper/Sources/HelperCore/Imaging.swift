import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct ImageAnalysis: Codable, Sendable, Equatable {
    public var width: Int
    public var height: Int
    public var blank: Bool
    /// Mean luma in 0...1.
    public var meanLuma: Double
    public var stdDev: Double
    /// 16 equal-width luma bins over 0...255 counting pixels (of the analysed raster).
    public var histogram: [Int]
}

public struct DownscaleResult: Codable, Sendable, Equatable {
    public var path: String
    public var width: Int
    public var height: Int
    public var bytes: Int
    public var format: String
}

public enum Imaging {
    static let analysisMaxDim = 1024
    /// A spread of at most this many luma levels (of 255) counts as blank.
    static let blankSpread = 2

    static func source(at path: String) throws -> CGImageSource {
        guard FileManager.default.isReadableFile(atPath: path) else {
            throw HelperError(.invalidArgument, "image not readable: \(path)")
        }
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              CGImageSourceGetCount(src) > 0 else {
            throw HelperError(.invalidArgument, "not a decodable image: \(path)")
        }
        return src
    }

    static func thumbnail(_ src: CGImageSource, maxDim: Int) throws -> CGImage {
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxDim,
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else {
            throw HelperError(.internalError, "image decode failed")
        }
        return img
    }

    public static func analyze(path: String) throws -> ImageAnalysis {
        let src = try source(at: path)
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
        let fullW = (props?[kCGImagePropertyPixelWidth] as? Int) ?? 0
        let fullH = (props?[kCGImagePropertyPixelHeight] as? Int) ?? 0
        let img = try thumbnail(src, maxDim: analysisMaxDim)
        let w = img.width, h = img.height
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        let drawn = rgba.withUnsafeMutableBytes { buf -> Bool in
            guard let ctx = CGContext(
                data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { throw HelperError(.internalError, "could not create bitmap context") }

        var hist = [Int](repeating: 0, count: 16)
        var sum = 0.0, sumSq = 0.0
        var lo = 255, hi = 0
        for i in stride(from: 0, to: rgba.count, by: 4) {
            let luma = 0.2126 * Double(rgba[i]) + 0.7152 * Double(rgba[i + 1]) + 0.0722 * Double(rgba[i + 2])
            let l = Int(luma.rounded())
            lo = min(lo, l)
            hi = max(hi, l)
            sum += luma
            sumSq += luma * luma
            hist[min(15, l >> 4)] += 1
        }
        let n = Double(w * h)
        let mean = sum / n
        let variance = max(0, sumSq / n - mean * mean)
        return ImageAnalysis(
            width: fullW > 0 ? fullW : w, height: fullH > 0 ? fullH : h,
            blank: hi - lo <= blankSpread, meanLuma: mean / 255, stdDev: variance.squareRoot() / 255, histogram: hist)
    }

    static func encode(_ img: CGImage, type: UTType, quality: Double?) throws -> Data {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else {
            throw HelperError(.internalError, "cannot create image encoder for \(type.identifier)")
        }
        var props: [CFString: Any] = [:]
        if let quality { props[kCGImageDestinationLossyCompressionQuality] = quality }
        CGImageDestinationAddImage(dest, img, props as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw HelperError(.internalError, "image encode failed") }
        return data as Data
    }

    public static func writePNG(_ img: CGImage, to path: String, overwrite: Bool = true) throws -> Int {
        let data = try encode(img, type: .png, quality: nil)
        try OutputPolicy.write(data, to: path, overwrite: overwrite)
        return data.count
    }

    /// Fits the image into `maxDim` and `maxBytes`: PNG first, then JPEG with falling quality,
    /// shrinking by 20 % per round when even the lowest quality is too large.
    public static func downscale(path: String, outPath: String, maxDim: Int, maxBytes: Int,
                                 overwrite: Bool = false) throws -> DownscaleResult {
        let src = try source(at: path)
        try OutputPolicy.check(outPath: outPath, overwrite: overwrite, inputs: [path])
        var dim = maxDim
        while dim >= 16 {
            let img = try thumbnail(src, maxDim: dim)
            let png = try encode(img, type: .png, quality: nil)
            if png.count <= maxBytes {
                return try finish(png, img, outPath, input: path, overwrite: overwrite, ext: "png", format: "png")
            }
            for q in stride(from: 0.9, through: 0.3, by: -0.2) {
                let jpg = try encode(img, type: .jpeg, quality: q)
                if jpg.count <= maxBytes { return try finish(jpg, img, outPath, input: path, overwrite: overwrite, ext: "jpg", format: "jpeg") }
            }
            dim = Int(Double(max(img.width, img.height)) * 0.8)
        }
        throw HelperError(.invalidArgument, "cannot fit image into \(maxBytes) bytes")
    }

    private static func finish(_ data: Data, _ img: CGImage, _ outPath: String, input: String, overwrite: Bool,
                               ext: String, format: String) throws -> DownscaleResult {
        let url = URL(fileURLWithPath: outPath)
        let target = url.pathExtension.lowercased() == ext ? url : url.deletingPathExtension().appendingPathExtension(ext)
        try OutputPolicy.check(outPath: target.path, overwrite: overwrite, inputs: [input])
        try OutputPolicy.write(data, to: target.path, overwrite: overwrite)
        return DownscaleResult(path: target.path, width: img.width, height: img.height, bytes: data.count, format: format)
    }
}
