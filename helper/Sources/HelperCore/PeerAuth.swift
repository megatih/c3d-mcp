import Darwin
import Foundation

/// Peer authentication for accepted connections: only the helper's own user may talk to it.
public enum PeerAuth {
    /// Returns the effective uid of the process on the other end of a connected Unix socket, or nil on failure.
    public static func peerUID(of fd: Int32) -> uid_t? {
        var uid: uid_t = 0
        var gid: gid_t = 0
        return getpeereid(fd, &uid, &gid) == 0 ? uid : nil
    }

    /// True when the peer uid is known and equals `expected`.
    public static func isAuthorized(fd: Int32, expected: uid_t = geteuid(),
                                    provider: @Sendable (Int32) -> uid_t? = PeerAuth.peerUID(of:)) -> Bool {
        provider(fd) == expected
    }
}
