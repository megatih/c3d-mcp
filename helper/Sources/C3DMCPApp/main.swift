import AppKit
import AppCore
import Foundation
import HelperCore

// C3D MCP.app: with no arguments it opens the control panel and runs the helper socket server in-process.
// The MCP server starts it as `C3DMCP --socket <path>` (headless helper, no window, no Dock icon).
let arguments = Array(CommandLine.arguments.dropFirst())

if arguments.contains("--version") {
    print(HelperVersion.current)
    exit(0)
}

if arguments.contains("--selftest") {
    let ok = await SelfTest.run()
    exit(ok ? 0 : 1)
}

if let flag = arguments.firstIndex(of: "--socket"), arguments.indices.contains(flag + 1) {
    let host = HelperHost()
    host.start(socketPath: arguments[flag + 1])
    if case .otherInstance = host.state { exit(3) }
    if case .failed = host.state { exit(1) }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.run()
    exit(0)
}

let delegate = AppDelegate()
let app = NSApplication.shared
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
