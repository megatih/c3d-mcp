import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct PostProcessResult: Codable, Sendable, Equatable {
    public var outPath: String
    public var width: Int
    public var height: Int
    public var bytes: Int
    public var applied: [String]
}

/// Stylisation passes (grade -> posterize -> outline -> bloom -> vignette) on CoreImage, GPU first, CPU fallback.
enum PostProcess {
    static let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

    static func run(_ req: PostProcessRequest) throws -> PostProcessResult {
        let src = try Imaging.source(at: req.path)
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
        let w = (props?[kCGImagePropertyPixelWidth] as? Int) ?? 0
        let h = (props?[kCGImagePropertyPixelHeight] as? Int) ?? 0
        guard w > 0, h > 0 else { throw HelperError(.invalidArgument, "image has no pixels: \(req.path)") }
        guard w * h <= PostProcessRequest.maxPixels else {
            throw HelperError(.invalidArgument, "image is \(w)x\(h); the limit is 64 megapixels")
        }
        guard let cg = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
            throw HelperError(.internalError, "image decode failed")
        }
        var image = CIImage(cgImage: cg, options: [.colorSpace: srgb]).settingAlphaOne(in: CIImage(cgImage: cg).extent)
        let extent = image.extent
        if let g = req.grade { image = grade(image, g) }
        if let p = req.posterize { image = posterize(image, p.levels) }
        if let o = req.outline { image = outline(image, o, extent: extent) }
        if let b = req.bloom { image = bloom(image, b, extent: extent) }
        if let v = req.vignette { image = vignette(image, v) }
        image = image.cropped(to: extent)

        let rendered = try render(image, extent: extent)
        let ext = (req.outPath as NSString).pathExtension.lowercased()
        let data: Data
        switch ext {
        case "jpg", "jpeg": data = try Imaging.encode(rendered, type: .jpeg, quality: 0.92)
        case "tif", "tiff": data = try Imaging.encode(rendered, type: .tiff, quality: nil)
        default: data = try Imaging.encode(rendered, type: .png, quality: nil)
        }
        try OutputPolicy.write(data, to: req.outPath, overwrite: req.overwrite)
        return PostProcessResult(outPath: req.outPath, width: rendered.width, height: rendered.height,
                                 bytes: data.count, applied: req.applied)
    }

    // MARK: rendering

    private static func render(_ image: CIImage, extent: CGRect) throws -> CGImage {
        let options: [[CIContextOption: Any]] = [
            [.workingColorSpace: srgb, .outputColorSpace: srgb],
            [.workingColorSpace: srgb, .outputColorSpace: srgb, .useSoftwareRenderer: true],
        ]
        for o in options {
            let ctx = CIContext(options: o)
            if let out = ctx.createCGImage(image, from: extent, format: .RGBA8, colorSpace: srgb) { return out }
        }
        throw HelperError(.internalError, "image render failed")
    }

    // MARK: filters

    private static func filter(_ name: String, _ image: CIImage?, _ params: [String: Any] = [:]) -> CIImage {
        guard let f = CIFilter(name: name) else { return image ?? CIImage.empty() }
        if let image { f.setValue(image, forKey: kCIInputImageKey) }
        for (k, v) in params { f.setValue(v, forKey: k) }
        return f.outputImage ?? image ?? CIImage.empty()
    }

    private static func matrix(_ image: CIImage, r: [CGFloat], g: [CGFloat], b: [CGFloat], bias: [CGFloat] = [0, 0, 0, 0]) -> CIImage {
        filter("CIColorMatrix", image, [
            "inputRVector": CIVector(values: r, count: 4), "inputGVector": CIVector(values: g, count: 4),
            "inputBVector": CIVector(values: b, count: 4), "inputAVector": CIVector(values: [0, 0, 0, 1], count: 4),
            "inputBiasVector": CIVector(values: bias, count: 4),
        ])
    }

    private static func scale(_ image: CIImage, _ s: Double, bias: Double = 0) -> CIImage {
        let k = CGFloat(s), b = CGFloat(bias)
        return matrix(image, r: [k, 0, 0, 0], g: [0, k, 0, 0], b: [0, 0, k, 0], bias: [b, b, b, 0])
    }

    /// Opaque grey image holding Rec.709 luma in all channels.
    private static func luma(_ image: CIImage) -> CIImage {
        let row: [CGFloat] = [0.2126, 0.7152, 0.0722, 0]
        return matrix(image, r: row, g: row, b: row)
    }

    private static func solid(_ rgb: [Double], _ extent: CGRect) -> CIImage {
        CIImage(color: CIColor(red: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1, colorSpace: srgb) ?? CIColor(red: rgb[0], green: rgb[1], blue: rgb[2]))
            .cropped(to: extent)
    }

    private static func opaque(_ image: CIImage) -> CIImage { image.settingAlphaOne(in: image.extent) }

    /// `a * (1 - m) + b * m` for an opaque grey mask `m` (0...1).
    private static func mix(_ a: CIImage, _ b: CIImage, mask m: CIImage) -> CIImage {
        let inv = scale(m, -1, bias: 1)
        let keep = filter("CIMultiplyCompositing", a, ["inputBackgroundImage": inv])
        let add = filter("CIMultiplyCompositing", b, ["inputBackgroundImage": m])
        return opaque(filter("CIAdditionCompositing", keep, ["inputBackgroundImage": add]))
    }

    static func grade(_ input: CIImage, _ g: GradeParams) -> CIImage {
        var image = input
        if g.exposure != 0 { image = filter("CIExposureAdjust", image, [kCIInputEVKey: g.exposure]) }
        image = filter("CIColorControls", image, [kCIInputSaturationKey: g.saturation, kCIInputContrastKey: g.contrast])
        guard g.shadowTint != nil || g.highlightTint != nil, g.tintAmount > 0 else { return image }
        let extent = input.extent
        let l = luma(image)
        if let t = g.shadowTint {
            let tinted = filter("CISoftLightBlendMode", solid(t, extent), ["inputBackgroundImage": image])
            image = mix(image, opaque(tinted), mask: scale(scale(l, -1, bias: 1), g.tintAmount))
        }
        if let t = g.highlightTint {
            let tinted = filter("CISoftLightBlendMode", solid(t, extent), ["inputBackgroundImage": image])
            image = mix(image, opaque(tinted), mask: scale(l, g.tintAmount))
        }
        return image
    }

    static func posterize(_ image: CIImage, _ levels: Int) -> CIImage {
        filter("CIColorPosterize", image, ["inputLevels": levels])
    }

    static func outline(_ image: CIImage, _ o: OutlineParams, extent: CGRect) -> CIImage {
        let edges = filter("CIEdges", luma(image.clampedToExtent()), [kCIInputIntensityKey: 6.0])
        var mask = edges
        if o.width > 1 { mask = filter("CIMorphologyMaximum", mask, [kCIInputRadiusKey: (o.width - 1) * 0.75]) }
        let gain = o.strength * min(1, o.width)
        let clamped = filter("CIColorClamp", scale(mask, gain), [
            "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0), "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)])
        return mix(image, solid(o.color, extent), mask: opaque(clamped.cropped(to: extent)))
    }

    static func bloom(_ image: CIImage, _ b: BloomParams, extent: CGRect) -> CIImage {
        let span = max(0.001, 1 - b.threshold)
        let bright = filter("CIColorClamp", scale(image, 1 / span, bias: -b.threshold / span), [
            "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0), "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)])
        let blurred = b.radius > 0
            ? filter("CIGaussianBlur", bright.clampedToExtent(), [kCIInputRadiusKey: b.radius]).cropped(to: extent)
            : bright
        let glow = opaque(scale(blurred, b.intensity))
        return opaque(filter("CIAdditionCompositing", glow, ["inputBackgroundImage": image]))
    }

    static func vignette(_ image: CIImage, _ v: VignetteParams) -> CIImage {
        filter("CIVignette", image, [kCIInputIntensityKey: v.intensity, kCIInputRadiusKey: v.radius])
    }
}
