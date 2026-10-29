// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "C3DBridgeHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "C3DBridgeHelper", targets: ["C3DBridgeHelper"]),
        .executable(name: "c3d-helper-ctl", targets: ["c3d-helper-ctl"]),
    ],
    targets: [
        .target(name: "HelperCore"),
        .executableTarget(name: "C3DBridgeHelper", dependencies: ["HelperCore"]),
        .executableTarget(name: "c3d-helper-ctl", dependencies: ["HelperCore"]),
        .testTarget(name: "HelperCoreTests", dependencies: ["HelperCore"]),
    ],
    swiftLanguageModes: [.v6]
)
