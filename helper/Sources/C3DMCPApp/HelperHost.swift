import AppKit
import Foundation
import HelperCore

/// Runs the helper socket server (the part that presses Cheetah3D menu items for the MCP server) inside this app, so that one app holds the
/// Accessibility and Screen Recording permissions.
@MainActor
final class HelperHost {
    enum State: Equatable { case running, otherInstance, failed(String) }

    static let defaultSocket: String = {
        let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cheetah3D/MCP")
        return base.appendingPathComponent("helper.sock").path
    }()

    private(set) var state: State = .failed("not started")
    private var server: SocketServer?
    private let log = HelperLog.standard()
    private var signals: [any DispatchSourceSignal] = []

    func start(socketPath: String = HelperHost.defaultSocket) {
        let dir = (socketPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let router = CommandRouter(ax: RealAX(), capturer: SCKWindowCapturer(), log: log)
        let server = SocketServer(path: socketPath, router: router, log: log)
        do {
            try server.start()
            self.server = server
            state = .running
            log.info("C3D MCP \(HelperVersion.current) helper started, socket \(socketPath)")
        } catch let e as SocketError {
            if case .alreadyRunning = e { state = .otherInstance } else { state = .failed("\(e)") }
            log.error("cannot start helper socket: \(e)")
        } catch {
            state = .failed("\(error)")
        }
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { [weak self] in
                self?.stop()
                exit(0)
            }
            source.resume()
            signals.append(source)
        }
    }

    func stop() { server?.stop() }
}
