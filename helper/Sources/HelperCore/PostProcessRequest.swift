import Foundation

struct BloomParams: Equatable { var threshold: Double, radius: Double, intensity: Double }
struct OutlineParams: Equatable { var strength: Double, width: Double, color: [Double] }
struct VignetteParams: Equatable { var intensity: Double, radius: Double }
struct GradeParams: Equatable {
    var saturation = 1.0, contrast = 1.0, exposure = 0.0
    var shadowTint: [Double]?, highlightTint: [Double]?, tintAmount = 0.5
}
struct PosterizeParams: Equatable { var levels: Int }

/// Validated arguments of `postProcessImage`.
struct PostProcessRequest: Equatable {
    static let maxPixels = 64_000_000
    static let allowedExtensions: Set<String> = ["png", "jpg", "jpeg", "tif", "tiff"]

    var path: String
    var outPath: String
    var overwrite = false
    var bloom: BloomParams?
    var outline: OutlineParams?
    var vignette: VignetteParams?
    var grade: GradeParams?
    var posterize: PosterizeParams?

    static func parse(_ args: inout ArgReader) throws -> PostProcessRequest {
        let path = try args.absolutePath("path") ?? ""
        let out = try args.absolutePath("outPath") ?? ""
        var r = PostProcessRequest(path: path, outPath: out)
        r.overwrite = try args.bool("overwrite", default: false)
        for p in [("path", path), ("outPath", out)] {
            let ext = (p.1 as NSString).pathExtension.lowercased()
            guard allowedExtensions.contains(ext) else {
                throw HelperError(.invalidArgument, "`\(p.0)` must end in .png, .jpg or .tiff")
            }
        }
        if let o = try args.object("bloom") {
            var f = Fields("bloom", o)
            r.bloom = BloomParams(threshold: try f.number("threshold", 0...1), radius: try f.number("radius", 0...500),
                                  intensity: try f.number("intensity", 0...2))
            try f.finish()
        }
        if let o = try args.object("outline") {
            var f = Fields("outline", o)
            r.outline = OutlineParams(strength: try f.number("strength", 0...1), width: try f.number("width", 0.5...4),
                                      color: try f.color("color", default: [0, 0, 0]))
            try f.finish()
        }
        if let o = try args.object("vignette") {
            var f = Fields("vignette", o)
            r.vignette = VignetteParams(intensity: try f.number("intensity", 0...1), radius: try f.number("radius", 0...2))
            try f.finish()
        }
        if let o = try args.object("grade") {
            var f = Fields("grade", o)
            var g = GradeParams()
            g.saturation = try f.number("saturation", 0...2, default: 1)
            g.contrast = try f.number("contrast", 0.5...1.5, default: 1)
            g.exposure = try f.number("exposure", -2...2, default: 0)
            g.shadowTint = try f.color("shadowTint", default: nil)
            g.highlightTint = try f.color("highlightTint", default: nil)
            g.tintAmount = try f.number("tintAmount", 0...1, default: 0.5)
            try f.finish()
            r.grade = g
        }
        if let o = try args.object("posterize") {
            var f = Fields("posterize", o)
            r.posterize = PosterizeParams(levels: try f.integer("levels", 2...32))
            try f.finish()
        }
        try args.finish()
        guard r.applied.isEmpty == false else {
            throw HelperError(.invalidArgument, "at least one of bloom, outline, vignette, grade, posterize is required")
        }
        if OutputPolicy.samePath(path, out) { throw HelperError(.invalidArgument, "`outPath` must differ from `path`") }
        try OutputPolicy.check(outPath: out, overwrite: r.overwrite, inputs: [path])
        return r
    }

    /// Effect names in application order.
    var applied: [String] {
        var names: [String] = []
        if grade != nil { names.append("grade") }
        if posterize != nil { names.append("posterize") }
        if outline != nil { names.append("outline") }
        if bloom != nil { names.append("bloom") }
        if vignette != nil { names.append("vignette") }
        return names
    }
}

/// Strict reader for the fields of one effect object.
private struct Fields {
    let name: String
    var rest: [String: JSONValue]

    init(_ name: String, _ o: [String: JSONValue]) { self.name = name; rest = o }

    private func bad(_ key: String, _ what: String) -> HelperError {
        HelperError(.invalidArgument, "`\(name).\(key)` must be \(what)")
    }

    private static func double(_ v: JSONValue) -> Double? {
        switch v {
        case .int(let i): Double(i)
        case .double(let d): d.isFinite ? d : nil
        default: nil
        }
    }

    mutating func number(_ key: String, _ range: ClosedRange<Double>, default def: Double? = nil) throws -> Double {
        guard let v = rest.removeValue(forKey: key) else {
            if let def { return def }
            throw HelperError(.invalidArgument, "missing required field `\(name).\(key)`")
        }
        guard let d = Self.double(v), range.contains(d) else { throw bad(key, "a number in \(range.lowerBound)...\(range.upperBound)") }
        return d
    }

    mutating func integer(_ key: String, _ range: ClosedRange<Int>) throws -> Int {
        guard let v = rest.removeValue(forKey: key) else {
            throw HelperError(.invalidArgument, "missing required field `\(name).\(key)`")
        }
        guard let i = v.intValue, range.contains(i) else { throw bad(key, "an integer in \(range.lowerBound)...\(range.upperBound)") }
        return i
    }

    mutating func color(_ key: String, default def: [Double]?) throws -> [Double]? {
        guard let v = rest.removeValue(forKey: key) else { return def }
        guard let a = v.arrayValue, a.count == 3 else { throw bad(key, "[r,g,b] with components in 0...1") }
        let c = a.compactMap(Self.double)
        guard c.count == 3, c.allSatisfy({ (0.0...1.0).contains($0) }) else { throw bad(key, "[r,g,b] with components in 0...1") }
        return c
    }

    mutating func color(_ key: String, default def: [Double]) throws -> [Double] {
        try color(key, default: Optional(def)) ?? def
    }

    func finish() throws {
        if let k = rest.keys.sorted().first { throw HelperError(.invalidArgument, "unknown field `\(name).\(k)`") }
    }
}
