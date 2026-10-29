import Foundation

/// Rules for files the helper writes: absolute, no `..`, never an input, never an existing file unless allowed.
enum OutputPolicy {
    static func hasParentComponent(_ path: String) -> Bool {
        (path as NSString).pathComponents.contains("..")
    }

    static func exists(_ path: String) -> Bool {
        var st = stat()
        return lstat(path, &st) == 0
    }

    static func samePath(_ a: String, _ b: String) -> Bool {
        let ra = URL(fileURLWithPath: a).resolvingSymlinksInPath().standardizedFileURL.path
        let rb = URL(fileURLWithPath: b).resolvingSymlinksInPath().standardizedFileURL.path
        return ra == rb
    }

    /// Throws `INVALID_ARGUMENT` unless `outPath` may be written.
    static func check(outPath: String, overwrite: Bool, inputs: [String] = []) throws {
        guard outPath.hasPrefix("/"), !hasParentComponent(outPath) else {
            throw HelperError(.invalidArgument, "`outPath` must be an absolute path without `..`")
        }
        let dir = (outPath as NSString).deletingLastPathComponent
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue else {
            throw HelperError(.invalidArgument, "output directory does not exist: \(dir)")
        }
        if inputs.contains(where: { samePath($0, outPath) }) {
            throw HelperError(.invalidArgument, "`outPath` must differ from the input path")
        }
        if exists(outPath) {
            guard overwrite else {
                throw HelperError(.invalidArgument, "output file already exists: \(outPath)",
                                  hint: "Pass overwrite:true or choose another outPath.")
            }
            var st = stat()
            if lstat(outPath, &st) == 0, (st.st_mode & S_IFMT) != S_IFREG {
                throw HelperError(.invalidArgument, "refusing to overwrite a non-regular file: \(outPath)")
            }
        }
    }

    static func write(_ data: Data, to path: String, overwrite: Bool) throws {
        if overwrite {
            do { try data.write(to: URL(fileURLWithPath: path), options: .atomic) } catch {
                throw HelperError(.invalidArgument, "cannot write \(path): \(error.localizedDescription)")
            }
            return
        }
        // Exclusive create: fails if the file (or a symlink) appeared since the check.
        let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644)
        guard fd >= 0 else {
            throw HelperError(.invalidArgument, "cannot create \(path): \(String(cString: strerror(errno)))")
        }
        var ok = true
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(fd, raw.baseAddress! + offset, raw.count - offset)
                if n <= 0 { ok = false; return }
                offset += n
            }
        }
        close(fd)
        if !ok {
            unlink(path)
            throw HelperError(.invalidArgument, "cannot write \(path): \(String(cString: strerror(errno)))")
        }
    }
}
