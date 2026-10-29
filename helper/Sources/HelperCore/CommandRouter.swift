import Foundation

struct WindowInfo: Codable {
    var title: String
    var role: String
    var subrole: String
    var main: Bool
    var focused: Bool
    var minimized: Bool
    var document: String?

    init(_ w: any UIElement) {
        title = w.title ?? ""
        role = w.role ?? ""
        subrole = w.subrole ?? ""
        main = w.isMain
        focused = w.isFocused
        minimized = w.isMinimized
        document = w.documentPath
    }
}

/// Validates and executes one command. Pure with respect to I/O: the socket layer only moves bytes.
public final class CommandRouter: Sendable {
    let ax: any AXProvider
    let capturer: any WindowCapturing
    let version: String
    let log: HelperLog
    let modals: OwnModalRegistry
    let presser: Presser
    let lifecycle: Lifecycle
    private let gate = AsyncGate()

    public init(ax: any AXProvider, capturer: any WindowCapturing, version: String = HelperVersion.current,
                log: HelperLog = .silent, modals: OwnModalRegistry = OwnModalRegistry()) {
        self.ax = ax
        self.capturer = capturer
        self.version = version
        self.log = log
        self.modals = modals
        presser = Presser(ax: ax, modals: modals)
        lifecycle = Lifecycle(ax: ax, presser: presser)
    }

    public func handle(line: Data) async -> Response {
        switch Request.parse(line) {
        case .rejected(let response):
            log.error("rejected request: \(response.error?.message ?? "")")
            return response
        case .accepted(let request):
            let started = DispatchTime.now().uptimeNanoseconds
            let response: Response
            do {
                response = .success(id: request.id, try await run(request))
            } catch let e as HelperError {
                response = .failure(id: request.id, e)
            } catch {
                response = .failure(id: request.id, HelperError(.internalError, "\(error)"))
            }
            let ms = (DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
            log.info("\(request.cmd.rawValue) id=\(request.id) ok=\(response.ok)\(response.error.map { " code=\($0.code)" } ?? "") \(ms)ms")
            return response
        }
    }

    private func exclusive<T: Sendable>(_ body: @Sendable () async throws -> T) async throws -> T {
        await gate.acquire()
        do {
            let value = try await body()
            await gate.release()
            return value
        } catch {
            await gate.release()
            throw error
        }
    }

    private func run(_ req: Request) async throws -> JSONValue {
        var args = ArgReader(req.args)
        switch req.cmd {
        case .ping:
            try args.finish()
            return .object(["version": .string(version), "pid": .int(Int(getpid()))])
        case .status:
            try args.finish()
            return status()
        case .permissions:
            try args.finish()
            return permissions()
        case .windows:
            try args.finish()
            let app = try presser.requireRunning()
            return try JSONValue(encoding: ax.windows(pid: app.pid).map(WindowInfo.init))
        case .modalState:
            try args.finish()
            let app = try presser.requireRunning()
            let dialogs = ModalDetector.detect(windows: ax.windows(pid: app.pid), registry: modals, nowMs: ax.nowMs()).map(\.info)
            return .object(["open": .bool(!dialogs.isEmpty), "dialogs": try JSONValue(encoding: dialogs)])
        case .listMenus:
            let path = try args.stringArray("path")
            let depth = try args.int("depth", in: 1...12, default: 8)
            try args.finish()
            let app = try presser.requireRunning()
            guard let bar = ax.menuBar(pid: app.pid) else { throw HelperError(.triggerFailed, "no accessible menu bar") }
            return MenuWalker.tree(of: try path.map { try MenuWalker.resolve(menuBar: bar, path: $0) } ?? bar, depth: depth)
        case .pressBridge:
            let title = try args.string("requireDocTitle")
            let timeout = try args.int("timeoutMs", in: 100...30_000, default: 2000)
            let path = try args.stringArray("menuPath") ?? Cheetah.defaultBridgeMenuPath
            try args.finish()
            return try await press(PressRequest(path: path, timeoutMs: timeout, docTitle: title))
        case .pressMenu:
            let path = try args.stringArray("path", required: true) ?? []
            let timeout = try args.int("timeoutMs", in: 100...30_000, default: 2000)
            let title = try args.string("requireDocTitle")
            let needsDoc = try args.bool("requireDocument", default: true)
            let own = try args.string("ownModalText")
            try args.finish()
            return try await press(PressRequest(path: path, timeoutMs: timeout, docTitle: title,
                                                requireDocumentWindow: needsDoc, ownModalText: own))
        case .raiseWindow:
            let title = try args.requiredString("title")
            try args.finish()
            return try await exclusive { [self] in
                let app = try presser.preflight()
                guard let window = ax.windows(pid: app.pid).first(where: { $0.title == title }) else {
                    throw HelperError(.triggerFailed, "window `\(title)` not found",
                                      details: .object(["windows": .array(ax.windows(pid: app.pid).map { .string($0.title ?? "") })]))
                }
                if window.raise() != .success { throw HelperError(.triggerFailed, "AXRaise failed for `\(title)`") }
                return .object(["raised": .bool(true), "title": .string(title)])
            }
        case .launchApp:
            try args.finish()
            let pid = try await exclusive { [self] in try await lifecycle.launchApp() }
            return .object(["pid": .int(Int(pid))])
        case .newDocument:
            try args.finish()
            let title = try await exclusive { [self] in try await lifecycle.newDocument() }
            return .object(["title": .string(title)])
        case .dismissOwnModal:
            let text = try args.requiredString("text")
            try args.finish()
            return try await dismissOwnModal(text)
        case .analyzeImage:
            let path = try args.absolutePath("path") ?? ""
            try args.finish()
            return try JSONValue(encoding: Imaging.analyze(path: path))
        case .downscaleImage:
            let path = try args.absolutePath("path") ?? ""
            let out = try args.absolutePath("outPath") ?? ""
            let maxDim = try args.int("maxDim", in: 16...16_384)
            let maxBytes = try args.int("maxBytes", in: 1024...1_000_000_000)
            try args.finish()
            return try JSONValue(encoding: Imaging.downscale(path: path, outPath: out, maxDim: maxDim, maxBytes: maxBytes))
        case .captureWindow:
            let title = try args.string("title")
            let out = try args.absolutePath("outPath") ?? ""
            let crop = try args.object("crop").map(Self.parseCrop)
            try args.finish()
            return try await capture(title: title, outPath: out, crop: crop)
        }
    }

    private func press(_ request: PressRequest) async throws -> JSONValue {
        let outcome = try await exclusive { [presser] in try await presser.press(request) }
        return .object(["pressed": .bool(true), "activatedMs": .int(outcome.activatedMs), "busy": .bool(outcome.busy)])
    }

    private func permissions() -> JSONValue {
        .object(["accessibility": .bool(ax.isProcessTrusted()), "screenRecording": .bool(ax.screenRecordingGranted())])
    }

    private func status() -> JSONValue {
        let app = ax.cheetahApp()
        var windows: [any UIElement] = []
        var modal: JSONValue = .null
        var bridgePresent = false
        if let app {
            windows = ax.windows(pid: app.pid)
            let dialogs = ModalDetector.detect(windows: windows, registry: modals, nowMs: ax.nowMs())
            if let first = dialogs.first(where: { !$0.info.own }) ?? dialogs.first {
                modal = (try? JSONValue(encoding: first.info)) ?? .null
            }
            if let bar = ax.menuBar(pid: app.pid) {
                bridgePresent = (try? MenuWalker.resolve(menuBar: bar, path: Cheetah.defaultBridgeMenuPath)) != nil
            }
        }
        let cheetah: JSONValue = .object([
            "running": .bool(app != nil),
            "pid": app.map { .int(Int($0.pid)) } ?? .null,
            "frontmost": .bool(app?.isFrontmost ?? false),
            "version": app?.version.map(JSONValue.string) ?? .null,
            "responsive": .bool(app.map { ax.isResponsive(pid: $0.pid) } ?? false),
        ])
        return .object([
            "cheetah": cheetah,
            "bridgeMenuPresent": .bool(bridgePresent),
            "modal": modal,
            "windows": (try? JSONValue(encoding: windows.map(WindowInfo.init))) ?? .array([]),
            "permissions": permissions(),
        ])
    }

    private func dismissOwnModal(_ text: String) async throws -> JSONValue {
        let app = try presser.requireRunning()
        let own = ModalDetector.detect(windows: ax.windows(pid: app.pid), registry: modals, nowMs: ax.nowMs())
            .first { $0.info.own && ($0.info.text.contains(text) || $0.info.title.contains(text)) }
        guard let own, let ok = ModalDetector.button(named: "OK", in: own.window) else {
            return .object(["dismissed": .bool(false)])
        }
        if case .failed = ok.press() { return .object(["dismissed": .bool(false)]) }
        modals.remove(matching: own.info.title + "\n" + own.info.text)
        return .object(["dismissed": .bool(true)])
    }

    private func capture(title: String?, outPath: String, crop: CropRect?) async throws -> JSONValue {
        guard ax.screenRecordingGranted() else {
            throw HelperError(.permissionMissing, "Screen Recording permission is not granted to the helper",
                              hint: "System Settings > Privacy & Security > Screen & System Audio Recording: enable C3D Bridge Helper.")
        }
        guard ax.cheetahApp() != nil else { throw HelperError(.appNotRunning, "Cheetah3D is not running") }
        let dir = (outPath as NSString).deletingLastPathComponent
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue else {
            throw HelperError(.invalidArgument, "output directory does not exist: \(dir)")
        }
        let image = try await capturer.capture(bundleID: Cheetah.bundleID, title: title, crop: crop)
        let bytes = try Imaging.writePNG(image, to: outPath)
        return .object(["path": .string(outPath), "width": .int(image.width), "height": .int(image.height), "bytes": .int(bytes)])
    }

    static func parseCrop(_ o: [String: JSONValue]) throws -> CropRect {
        func number(_ k: String) -> Double? {
            switch o[k] {
            case .int(let i): Double(i)
            case .double(let d): d
            default: nil
            }
        }
        guard Set(o.keys) == ["x", "y", "width", "height"],
              let x = number("x"), let y = number("y"), let w = number("width"), let h = number("height"),
              x >= 0, y >= 0, w > 0, h > 0 else {
            throw HelperError(.invalidArgument, "`crop` must be {x>=0, y>=0, width>0, height>0} in window points")
        }
        return CropRect(x: x, y: y, width: w, height: h)
    }
}
