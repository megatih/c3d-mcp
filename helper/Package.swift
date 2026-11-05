// swift-tools-version: 6.0
import Foundation
import PackageDescription

// Sparkle (the update engine) is a prebuilt framework fetched by scripts/fetch-sparkle.sh into .sparkle/. Without it the app target still
// builds, just without in-app updates (`#if canImport(Sparkle)` in the sources).
let sparkleDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent(".sparkle/Sparkle.xcframework").path
let hasSparkle = FileManager.default.fileExists(atPath: sparkleDir)

let package = Package(
    name: "C3DMCP",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "c3d-helper-ctl", targets: ["c3d-helper-ctl"]),
        .executable(name: "C3DMCP", targets: ["C3DMCPApp"]),
    ],
    targets: [
        .target(name: "HelperCore"),
        .executableTarget(name: "c3d-helper-ctl", dependencies: ["HelperCore"]),
        .target(name: "AppCore"),
    ] + (hasSparkle ? [.binaryTarget(name: "Sparkle", path: ".sparkle/Sparkle.xcframework")] : []) + [
        .executableTarget(name: "C3DMCPApp", dependencies: ["HelperCore", "AppCore"] + (hasSparkle ? ["Sparkle"] : [])),
        .testTarget(name: "HelperCoreTests", dependencies: ["HelperCore"]),
        .testTarget(name: "AppCoreTests", dependencies: ["AppCore"]),
    ],
    swiftLanguageModes: [.v6]
)
