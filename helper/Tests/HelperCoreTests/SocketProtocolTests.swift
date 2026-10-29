import XCTest
@testable import HelperCore

final class SocketProtocolTests: XCTestCase {
    var dir = ""
    var server: SocketServer?
    var socket: String { dir + "/h.sock" }

    override func setUpWithError() throws {
        dir = try tempDir()
        let s = SocketServer(path: socket, router: makeRouter(), log: .silent)
        try s.start()
        server = s
    }

    override func tearDown() {
        server?.stop()
        try? FileManager.default.removeItem(atPath: dir)
    }

    func raw(_ lines: [String], expecting: Int? = nil) throws -> [Response] {
        try SocketClient(path: socket).exchange(lines: lines.map { Data($0.utf8) }, expecting: expecting)
            .map { try JSONDecoder().decode(Response.self, from: $0) }
    }

    func testSocketIsOwnerOnly() throws {
        var st = stat()
        XCTAssertEqual(lstat(socket, &st), 0)
        XCTAssertEqual(st.st_mode & 0o777, 0o600)
    }

    func testPingRoundTripAndIdEcho() throws {
        let r = try raw([#"{"id":"abc","cmd":"ping"}"#])[0]
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.id, "abc")
        XCTAssertEqual(r.result?["version"]?.stringValue, "test")
        XCTAssertEqual(r.result?["pid"]?.intValue, Int(getpid()))
    }

    func testMultipleRequestsInOneWriteGetOneResponseEach() throws {
        let rs = try raw((0..<20).map { #"{"id":"r\#($0)","cmd":"ping"}"# })
        XCTAssertEqual(Set(rs.map(\.id)), Set((0..<20).map { "r\($0)" }))
        XCTAssertTrue(rs.allSatisfy(\.ok))
    }

    func testRequestSplitAcrossWrites() throws {
        let fd = try connectFD(to: socket)
        defer { close(fd) }
        for part in [#"{"id":"s","c"#, #"md":"ping"}"#, "\n"] {
            _ = Array(part.utf8).withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
            usleep(30_000)
        }
        var buf = [UInt8](repeating: 0, count: 4096)
        let n = read(fd, &buf, buf.count)
        let r = try JSONDecoder().decode(Response.self, from: Data(buf[0..<n].dropLast()))
        XCTAssertEqual(r.id, "s")
        XCTAssertTrue(r.ok)
    }

    func testMalformedJSONGetsInvalidArgumentAndConnectionSurvives() throws {
        let rs = try raw(["{not json", #"{"id":"after","cmd":"ping"}"#])
        let bad = try XCTUnwrap(rs.first { $0.id == "" })
        XCTAssertEqual(bad.error?.code, "INVALID_ARGUMENT")
        XCTAssertFalse(bad.ok)
        XCTAssertTrue(try XCTUnwrap(rs.first { $0.id == "after" }).ok)
    }

    func testUnknownCommandAndFields() throws {
        let rs = try raw([
            #"{"id":"u1","cmd":"explode"}"#,
            #"{"id":"u2","cmd":"ping","extra":1}"#,
            #"{"cmd":"ping"}"#,
            #"{"id":"u4"}"#,
            #"{"id":"u5","cmd":"ping","args":[1]}"#,
            #"[1,2]"#,
        ])
        XCTAssertEqual(rs.map { $0.error?.code }, Array(repeating: "INVALID_ARGUMENT", count: 6))
        XCTAssertTrue(Set(rs.map(\.id)).isSuperset(of: ["u1", "u2", "u4"]), "id is echoed when readable")
    }

    func testBlankLinesIgnored() throws {
        let rs = try raw(["", "  ", #"{"id":"x","cmd":"ping"}"#], expecting: 1)
        XCTAssertEqual(rs.count, 1)
    }

    func testConcurrentClients() async throws {
        let path = socket
        let ids = try await withThrowingTaskGroup(of: [String].self) { group in
            for c in 0..<12 {
                group.addTask {
                    let lines = (0..<10).map { Data(#"{"id":"c\#(c)-\#($0)","cmd":"status"}"#.utf8) }
                    return try SocketClient(path: path).exchange(lines: lines).map {
                        let r = try JSONDecoder().decode(Response.self, from: $0)
                        XCTAssertTrue(r.ok)
                        return r.id
                    }
                }
            }
            return try await group.reduce(into: [String]()) { $0 += $1 }
        }
        XCTAssertEqual(Set(ids).count, 120)
    }

    func testOversizedLineClosesConnection() throws {
        let fd = try connectFD(to: socket)
        defer { close(fd) }
        let chunk = [UInt8](repeating: 0x41, count: 1 << 20)
        for _ in 0..<5 { if write(fd, chunk, chunk.count) <= 0 { break } }
        var buf = [UInt8](repeating: 0, count: 4096)
        var tv = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        let n = read(fd, &buf, buf.count)
        XCTAssertGreaterThan(n, 0)
        let r = try JSONDecoder().decode(Response.self, from: Data(buf[0..<n].dropLast()))
        XCTAssertEqual(r.error?.code, "INVALID_ARGUMENT")
    }

    func testSecondInstanceRefusedWhileFirstIsAlive() {
        let second = SocketServer(path: socket, router: makeRouter(), log: .silent)
        XCTAssertThrowsError(try second.start()) {
            guard case SocketError.alreadyRunning = $0 else { return XCTFail("\($0)") }
        }
        XCTAssertNoThrow(try SocketClient(path: socket).call(.ping), "first instance still serves")
    }

    func testStaleSocketIsReplaced() throws {
        server?.stop()
        // Leave a dead socket file behind (bound, never unlinked, nobody listening).
        var addr = try makeAddress(socket)
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        _ = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        close(fd)
        let fresh = SocketServer(path: socket, router: makeRouter(), log: .silent)
        try fresh.start()
        server = fresh
        XCTAssertTrue(try SocketClient(path: socket).call(.ping).ok)
    }

    func testRefusesToRemoveNonSocketFile() throws {
        server?.stop()
        FileManager.default.createFile(atPath: socket, contents: Data("precious".utf8))
        let s = SocketServer(path: socket, router: makeRouter(), log: .silent)
        XCTAssertThrowsError(try s.start()) {
            guard case SocketError.notASocket = $0 else { return XCTFail("\($0)") }
        }
        XCTAssertEqual(try String(contentsOfFile: socket, encoding: .utf8), "precious")
    }

    func testStopRemovesSocketFile() {
        server?.stop()
        XCTAssertFalse(FileManager.default.fileExists(atPath: socket))
    }
}
