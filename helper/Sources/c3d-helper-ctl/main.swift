import Foundation
import HelperCore

let usage = """
usage: c3d-helper-ctl --socket <path> <command> [args]
  read-only:  ping | status | permissions | windows | listMenus | modalState
  with --yes-press (changes Cheetah3D state):
    pressBridge | pressMenu <title>... | raiseWindow <title> | newDocument | launchApp
"""

func fail(_ message: String, code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

var rest = Array(CommandLine.arguments.dropFirst())
let pressAllowed = rest.contains("--yes-press")
rest.removeAll { $0 == "--yes-press" }
guard let flag = rest.firstIndex(of: "--socket"), rest.indices.contains(flag + 1) else { fail(usage) }
let socketPath = rest[flag + 1]
rest.removeSubrange(flag...(flag + 1))
guard let name = rest.first, let cmd = Command(rawValue: name) else { fail(usage) }
let extra = Array(rest.dropFirst())

let readOnly: Set<Command> = [.ping, .status, .permissions, .windows, .listMenus, .modalState]
if !readOnly.contains(cmd) {
    guard [.pressBridge, .pressMenu, .raiseWindow, .newDocument, .launchApp].contains(cmd) else {
        fail("command `\(name)` is not exposed by c3d-helper-ctl")
    }
    guard pressAllowed else { fail("`\(name)` changes Cheetah3D state; pass --yes-press to confirm") }
}

var args: [String: JSONValue] = [:]
switch cmd {
case .pressMenu:
    guard !extra.isEmpty else { fail("pressMenu needs a menu path, e.g. File New") }
    args["path"] = .array(extra.map(JSONValue.string))
case .raiseWindow:
    guard extra.count == 1 else { fail("raiseWindow needs exactly one window title") }
    args["title"] = .string(extra[0])
default:
    guard extra.isEmpty else { fail("unexpected arguments: \(extra.joined(separator: " "))") }
}

do {
    let response = try SocketClient(path: socketPath).call(cmd, args: args)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(decoding: try encoder.encode(response), as: UTF8.self))
    exit(response.ok ? 0 : 1)
} catch {
    fail("cannot talk to helper at \(socketPath): \(error)", code: 3)
}
