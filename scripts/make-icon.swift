// Draws the app icon (a Cheetah-orange rounded square with a wireframe cube) into an .iconset folder. Usage: swift make-icon.swift <out.iconset>
import AppKit

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let rect = NSRect(x: s * 0.06, y: s * 0.06, width: s * 0.88, height: s * 0.88)
    let bg = NSBezierPath(roundedRect: rect, xRadius: s * 0.2, yRadius: s * 0.2)
    NSGradient(colors: [NSColor(red: 1.0, green: 0.62, blue: 0.20, alpha: 1), NSColor(red: 0.86, green: 0.30, blue: 0.10, alpha: 1)])!.draw(in: bg, angle: -90)
    // isometric cube
    let c = CGPoint(x: s / 2, y: s / 2), r = s * 0.27
    func p(_ a: CGFloat, _ k: CGFloat = 1) -> CGPoint { CGPoint(x: c.x + cos(a) * r * k, y: c.y + sin(a) * r * k) }
    let top = (0..<6).map { p(CGFloat($0) * .pi / 3 + .pi / 6) }
    NSColor.white.withAlphaComponent(0.95).setStroke()
    let hex = NSBezierPath()
    hex.move(to: top[0]); for v in top.dropFirst() { hex.line(to: v) }; hex.close()
    hex.lineWidth = s * 0.035; hex.lineJoinStyle = .round; hex.stroke()
    let spokes = NSBezierPath()
    for i in [1, 3, 5] { spokes.move(to: c); spokes.line(to: top[i]) }
    spokes.lineWidth = s * 0.035; spokes.lineCapStyle = .round; spokes.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let out = CommandLine.arguments.dropFirst().first ?? "AppIcon.iconset"
try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    try render(px).write(to: URL(fileURLWithPath: "\(out)/icon_\(name).png"))
}
