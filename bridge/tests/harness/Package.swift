// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "c3d-harness",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "c3d-harness",
            path: "Sources/c3d-harness",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
