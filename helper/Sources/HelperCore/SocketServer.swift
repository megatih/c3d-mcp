import Darwin
import Dispatch
import Foundation

public enum SocketError: Error, CustomStringConvertible {
    case alreadyRunning(String)
    case notASocket(String)
    case pathTooLong(String)
    case system(String, Int32)

    public var description: String {
        switch self {
        case .alreadyRunning(let p): "another helper instance is already serving \(p)"
        case .notASocket(let p): "\(p) exists and is not a socket; refusing to remove it"
        case .pathTooLong(let p): "socket path too long (max \(SocketServer.maxPathLength) bytes): \(p)"
        case .system(let what, let errno): "\(what) failed: \(String(cString: strerror(errno)))"
        }
    }
}

func makeAddress(_ path: String) throws -> sockaddr_un {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < SocketServer.maxPathLength else { throw SocketError.pathTooLong(path) }
    withUnsafeMutableBytes(of: &addr.sun_path) { dst in
        dst.copyBytes(from: bytes)
        dst[bytes.count] = 0
    }
    return addr
}

func connectFD(to path: String) throws -> Int32 {
    var addr = try makeAddress(path)
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw SocketError.system("socket", errno) }
    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard rc == 0 else {
        let e = errno
        close(fd)
        throw SocketError.system("connect", e)
    }
    var on: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    return fd
}

/// Unix-domain-socket JSON-lines server: one request per line, one response line per request.
public final class SocketServer: @unchecked Sendable {
    public static let maxPathLength = MemoryLayout.size(ofValue: sockaddr_un().sun_path)
    static let maxLineBytes = 4 * 1024 * 1024

    private let path: String
    private let router: CommandRouter
    private let log: HelperLog
    private let expectedUID: uid_t
    private let peerUID: @Sendable (Int32) -> uid_t?
    private let queue = DispatchQueue(label: "c3d.helper.accept")
    private var listenFD: Int32 = -1
    private var acceptSource: (any DispatchSourceRead)?
    private let lock = NSLock()
    private var connections: [ObjectIdentifier: Connection] = [:]

    /// `peerUID` is injectable for tests; production reads `getpeereid` and requires the helper's own euid.
    public init(path: String, router: CommandRouter, log: HelperLog, expectedUID: uid_t = geteuid(),
                peerUID: @escaping @Sendable (Int32) -> uid_t? = PeerAuth.peerUID(of:)) {
        self.path = path
        self.router = router
        self.log = log
        self.expectedUID = expectedUID
        self.peerUID = peerUID
    }

    public func start() throws {
        try prepareSocketPath()
        var addr = try makeAddress(path)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError.system("socket", errno) }
        let oldMask = umask(0o177)
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        let bindErrno = errno
        umask(oldMask)
        guard rc == 0 else { close(fd); throw SocketError.system("bind", bindErrno) }
        chmod(path, 0o600)
        guard listen(fd, 16) == 0 else { close(fd); throw SocketError.system("listen", errno) }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        listenFD = fd

        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptPending() }
        source.resume()
        acceptSource = source
        log.info("listening on \(path)")
    }

    public func stop() {
        acceptSource?.cancel()
        acceptSource = nil
        if listenFD >= 0 { close(listenFD); listenFD = -1; unlink(path) }
        let open = lock.withLock { Array(connections.values) }
        open.forEach { $0.close() }
        log.info("stopped")
    }

    /// Removes a stale socket; refuses when a live instance answers or the path is not a socket.
    private func prepareSocketPath() throws {
        var st = stat()
        guard lstat(path, &st) == 0 else { return }
        guard (st.st_mode & S_IFMT) == S_IFSOCK else { throw SocketError.notASocket(path) }
        if let fd = try? connectFD(to: path) {
            close(fd)
            throw SocketError.alreadyRunning(path)
        }
        unlink(path)
    }

    private func acceptPending() {
        while true {
            let fd = accept(listenFD, nil, nil)
            if fd < 0 { return }
            guard PeerAuth.isAuthorized(fd: fd, expected: expectedUID, provider: peerUID) else {
                log.error("dropped connection from unauthorized peer uid \(peerUID(fd).map(String.init) ?? "unknown") (expected \(expectedUID))")
                close(fd)
                continue
            }
            _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) & ~O_NONBLOCK)
            var on: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            let connection = Connection(fd: fd, router: router) { [weak self] c in
                self?.lock.withLock { _ = self?.connections.removeValue(forKey: ObjectIdentifier(c)) }
            }
            lock.withLock { connections[ObjectIdentifier(connection)] = connection }
            connection.start()
        }
    }
}

/// One client: reads lines, runs each request concurrently, writes responses in completion order.
final class Connection: @unchecked Sendable {
    private let fd: Int32
    private let router: CommandRouter
    private let queue: DispatchQueue
    private let onClose: @Sendable (Connection) -> Void
    private var source: (any DispatchSourceRead)?
    private var buffer = Data()
    /// Bytes at the start of `buffer` already known to contain no newline.
    private var scanned = 0
    private var closed = false

    init(fd: Int32, router: CommandRouter, onClose: @escaping @Sendable (Connection) -> Void) {
        self.fd = fd
        self.router = router
        self.onClose = onClose
        queue = DispatchQueue(label: "c3d.helper.conn.\(fd)")
    }

    func start() {
        let s = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        s.setEventHandler { [self] in readAvailable() }
        s.resume()
        source = s
    }

    func close() { queue.async { [self] in closeLocked() } }

    private func closeLocked() {
        guard !closed else { return }
        closed = true
        source?.cancel()
        source = nil
        Darwin.close(fd)
        onClose(self)
    }

    private func readAvailable() {
        var chunk = [UInt8](repeating: 0, count: 65_536)
        let n = read(fd, &chunk, chunk.count)
        if n <= 0 { closeLocked(); return }
        buffer.append(contentsOf: chunk[0..<n])
        while let newline = buffer[(buffer.startIndex + scanned)...].firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: buffer.startIndex..<newline)
            buffer.removeSubrange(buffer.startIndex...newline)
            scanned = 0
            if line.allSatisfy({ $0 == 0x20 || $0 == 0x0D || $0 == 0x09 }) { continue }
            dispatch(line)
        }
        scanned = buffer.count
        if buffer.count > SocketServer.maxLineBytes {
            send(Response.failure(id: "", HelperError(.invalidArgument, "request line exceeds \(SocketServer.maxLineBytes) bytes")))
            closeLocked()
        }
    }

    private func dispatch(_ line: Data) {
        let router = router
        Task { [self] in
            let response = await router.handle(line: line)
            queue.async { self.send(response) }
        }
    }

    /// Must run on `queue`.
    private func send(_ response: Response) {
        guard !closed, var data = try? JSONEncoder().encode(response) else { return }
        data.append(0x0A)
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = write(fd, raw.baseAddress! + offset, raw.count - offset)
                if n <= 0 { closeLocked(); return }
                offset += n
            }
        }
    }
}
