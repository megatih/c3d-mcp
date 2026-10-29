import AppKit
import Foundation
import HelperCore

let usage = "usage: C3DBridgeHelper --socket <path> | --version | --selftest"
let arguments = Array(CommandLine.arguments.dropFirst())

if arguments.contains("--version") {
    print(HelperVersion.current)
    exit(0)
}

if arguments.contains("--selftest") {
    let ok = await SelfTest.run()
    exit(ok ? 0 : 1)
}

guard let flag = arguments.firstIndex(of: "--socket"), arguments.indices.contains(flag + 1) else {
    FileHandle.standardError.write(Data((usage + "\n").utf8))
    exit(2)
}
let socketPath = arguments[flag + 1]

let log = HelperLog.standard()
let router = CommandRouter(ax: RealAX(), capturer: SCKWindowCapturer(), log: log)
let server = SocketServer(path: socketPath, router: router, log: log)
do {
    try server.start()
} catch let e as SocketError {
    log.error("cannot start: \(e)")
    if case .alreadyRunning = e { exit(3) }
    exit(1)
}

var terminationSources: [any DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
        log.info("signal \(sig): shutting down")
        server.stop()
        exit(0)
    }
    source.resume()
    terminationSources.append(source)
}

log.info("C3D Bridge Helper \(HelperVersion.current) started, socket \(socketPath)")
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.run()
