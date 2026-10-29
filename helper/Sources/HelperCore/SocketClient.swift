import Darwin
import Foundation

/// Blocking JSON-lines client (used by `c3d-helper-ctl`, the self test and tests).
public struct SocketClient: Sendable {
    public let path: String

    public init(path: String) { self.path = path }

    /// Sends raw lines and returns `expected` response lines (default one per request line; order is completion order).
    public func exchange(lines: [Data], expecting expected: Int? = nil, timeoutSeconds: Int = 60) throws -> [Data] {
        let expected = expected ?? lines.count
        let fd = try connectFD(to: path)
        defer { close(fd) }
        var tv = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var out = Data()
        for l in lines { out.append(l); out.append(0x0A) }
        try out.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = write(fd, raw.baseAddress! + offset, raw.count - offset)
                guard n > 0 else { throw SocketError.system("write", errno) }
                offset += n
            }
        }
        var buffer = Data()
        var responses: [Data] = []
        var chunk = [UInt8](repeating: 0, count: 65_536)
        while responses.count < expected {
            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else { throw SocketError.system("read", n == 0 ? ECONNRESET : errno) }
            buffer.append(contentsOf: chunk[0..<n])
            while let nl = buffer.firstIndex(of: 0x0A) {
                responses.append(buffer.subdata(in: buffer.startIndex..<nl))
                buffer.removeSubrange(buffer.startIndex...nl)
            }
        }
        return responses
    }

    public func call(_ cmd: Command, args: [String: JSONValue] = [:], id: String = "ctl") throws -> Response {
        var object: [String: JSONValue] = ["id": .string(id), "cmd": .string(cmd.rawValue)]
        if !args.isEmpty { object["args"] = .object(args) }
        let line = try JSONEncoder().encode(JSONValue.object(object))
        guard let reply = try exchange(lines: [line]).first else { throw SocketError.system("read", ECONNRESET) }
        return try JSONDecoder().decode(Response.self, from: reply)
    }
}
