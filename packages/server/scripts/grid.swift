// Dev: tiles labelled images into one PNG.  grid <out.png> <cols> <label=path>...
import AppKit
import ImageIO
let a = CommandLine.arguments; let out = a[1]; let cols = Int(a[2])!
let items = a.dropFirst(3).map { s -> (String, CGImage) in let p = s.split(separator: "=", maxSplits: 1).map(String.init); let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p[1]) as CFURL, nil)!; return (p[0], CGImageSourceCreateImageAtIndex(src, 0, nil)!) }
let tw = items[0].1.width, th = items[0].1.height, lab = 30, gap = 8, rows = (items.count + cols - 1) / cols
let W = cols * (tw + gap) + gap, H = rows * (th + lab + gap) + gap
let c = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
c.setFillColor(CGColor(red: 0.1, green: 0.1, blue: 0.14, alpha: 1)); c.fill(CGRect(x: 0, y: 0, width: W, height: H))
NSGraphicsContext.current = NSGraphicsContext(cgContext: c, flipped: false)
for (i, (t, im)) in items.enumerated() {
  let x = gap + (i % cols) * (tw + gap), y = H - (i / cols + 1) * (th + lab + gap)
  c.draw(im, in: CGRect(x: x, y: y, width: tw, height: th))
  (t as NSString).draw(at: NSPoint(x: x + 4, y: y + th + 4), withAttributes: [.font: NSFont.boldSystemFont(ofSize: 16), .foregroundColor: NSColor.white])
}
let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(d, c.makeImage()!, nil); CGImageDestinationFinalize(d)
