// Dev: builds comparison montages + palette stats for the cyberpunk benchmark.  swiftc -O montage.swift -o /tmp/montage
import AppKit
import CoreGraphics
import ImageIO

func load(_ p: String) -> CGImage { let s = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil)!; return CGImageSourceCreateImageAtIndex(s, 0, nil)! }
func crop(_ i: CGImage, _ r: CGRect) -> CGImage { i.cropping(to: r)! }
func rgba(_ i: CGImage) -> [UInt8] {
  var d = [UInt8](repeating: 0, count: i.width * i.height * 4)
  let c = CGContext(data: &d, width: i.width, height: i.height, bitsPerComponent: 8, bytesPerRow: i.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  c.draw(i, in: CGRect(x: 0, y: 0, width: i.width, height: i.height)); return d
}
/// Top quantised colours (4 bits/channel) ignoring the single most common bin (the flat background).
func palette(_ i: CGImage, skipBackground: Bool) -> [(String, Double)] {
  let d = rgba(i); var bins = [Int: Int](); let n = i.width * i.height
  for p in 0..<n { let k = (Int(d[p*4] >> 4) << 8) | (Int(d[p*4+1] >> 4) << 4) | Int(d[p*4+2] >> 4); bins[k, default: 0] += 1 }
  var sorted = bins.sorted { $0.value > $1.value }
  if skipBackground { sorted.removeFirst(min(3, sorted.count)) }  // drop the background gradient bins
  let total = Double(sorted.reduce(0) { $0 + $1.value })
  return sorted.prefix(8).map { (String(format: "#%02X%02X%02X", ($0.key >> 8) * 17, (($0.key >> 4) & 15) * 17, ($0.key & 15) * 17), Double($0.value) / total * 100) }
}
func meanRGB(_ i: CGImage) -> (Double, Double, Double) { let d = rgba(i); var r = 0.0, g = 0.0, b = 0.0; let n = i.width * i.height; for p in 0..<n { r += Double(d[p*4]); g += Double(d[p*4+1]); b += Double(d[p*4+2]) }; return (r/Double(n), g/Double(n), b/Double(n)) }
func fitted(_ i: CGImage, height: Int) -> CGImage {
  let w = Int(Double(i.width) * Double(height) / Double(i.height))
  let c = CGContext(data: nil, width: w, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  c.interpolationQuality = .high; c.draw(i, in: CGRect(x: 0, y: 0, width: w, height: height)); return c.makeImage()!
}
func montage(_ panels: [(String, CGImage)], height: Int, out: String) {
  let ps = panels.map { ($0.0, fitted($0.1, height: height)) }; let gap = 12, label = 34
  let W = ps.reduce(0) { $0 + $1.1.width } + gap * (ps.count + 1), H = height + label + gap * 2
  let c = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  c.setFillColor(CGColor(red: 0.08, green: 0.07, blue: 0.12, alpha: 1)); c.fill(CGRect(x: 0, y: 0, width: W, height: H))
  var x = gap
  for (t, im) in ps {
    c.draw(im, in: CGRect(x: x, y: gap, width: im.width, height: height))
    let ctx = NSGraphicsContext(cgContext: c, flipped: false); NSGraphicsContext.current = ctx
    (t as NSString).draw(at: NSPoint(x: x, y: height + gap + 6), withAttributes: [.font: NSFont.boldSystemFont(ofSize: 20), .foregroundColor: NSColor.white])
    x += im.width + gap
  }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, c.makeImage()!, nil); CGImageDestinationFinalize(dest)
}

let a = CommandLine.arguments  // ref, blender, cheetah, outdir
let ref = load(a[1]), bl = load(a[2]), ch = load(a[3]); let out = a[4]
let blOpus = crop(bl, CGRect(x: 1050, y: 90, width: 620, height: 760))      // right-hand "OPUS" building in the Blender thumbnail
let region = CGRect(x: 560, y: 0, width: 760, height: 816)                   // building region in the 1456x816 frames
montage([("REFERENCE", crop(ref, region)), ("BLENDER MCP / OPUS 5.5", blOpus), ("CHEETAH3D + C3D MCP / OPUS 5.5", crop(ch, region))], height: 640, out: out + "/montage.png")
montage([("REFERENCE (full frame)", ref), ("CHEETAH3D + C3D MCP / OPUS 5.5 (full frame)", ch)], height: 540, out: out + "/montage-fullframe.png")
for (n, im) in [("reference", crop(ref, region)), ("blender-opus", blOpus), ("cheetah", crop(ch, region))] {
  let m = meanRGB(im); print("\(n): mean RGB (\(Int(m.0)),\(Int(m.1)),\(Int(m.2)))  palette:", palette(im, skipBackground: true).map { "\($0.0) \(String(format: "%.1f", $0.1))%" }.joined(separator: ", "))
}
