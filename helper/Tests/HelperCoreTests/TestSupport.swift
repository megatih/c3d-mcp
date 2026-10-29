import CoreGraphics
import Foundation
import XCTest
@testable import HelperCore

struct StubCapturer: WindowCapturing {
    func capture(bundleID: String, title: String?, crop: CropRect?) async throws -> CGImage {
        let ctx = CGContext(data: nil, width: 20, height: 10, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: 20, height: 10))
        return ctx.makeImage()!
    }
}

func makeRouter(_ ax: FakeAX = FakeAX()) -> CommandRouter {
    CommandRouter(ax: ax, capturer: StubCapturer(), version: "test")
}

func tempDir() throws -> String {
    let dir = NSTemporaryDirectory() + "c3dh-\(UUID().uuidString.prefix(8))"
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return dir
}

/// Sends one request through the router and returns the decoded response.
func send(_ router: CommandRouter, _ cmd: String, _ args: [String: Any]? = nil, id: String = "t1") async throws -> Response {
    var object: [String: Any] = ["id": id, "cmd": cmd]
    if let args { object["args"] = args }
    let line = try JSONSerialization.data(withJSONObject: object)
    return await router.handle(line: line)
}

func errorCode(_ r: Response) -> String? { r.error?.code }

/// Subset JSON-schema validator (type, enum, required, properties, additionalProperties:false, items).
enum MiniSchema {
    static func validate(_ value: Any, against schema: [String: Any], path: String = "$") -> [String] {
        var errors: [String] = []
        if let type = schema["type"] as? String, !matches(value, type) {
            return ["\(path): expected \(type)"]
        }
        if let allowed = schema["enum"] as? [String], !allowed.contains(value as? String ?? "") {
            errors.append("\(path): \(value) not in enum")
        }
        if let obj = value as? [String: Any] {
            for key in schema["required"] as? [String] ?? [] where obj[key] == nil { errors.append("\(path): missing \(key)") }
            let props = schema["properties"] as? [String: Any] ?? [:]
            if schema["additionalProperties"] as? Bool == false {
                for key in obj.keys where props[key] == nil { errors.append("\(path): unexpected \(key)") }
            }
            for (key, sub) in props {
                if let v = obj[key], let s = sub as? [String: Any] { errors += validate(v, against: s, path: "\(path).\(key)") }
            }
        }
        return errors
    }

    static func matches(_ value: Any, _ type: String) -> Bool {
        switch type {
        case "object": value is [String: Any]
        case "array": value is [Any]
        case "string": value is String
        case "boolean": (value as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false
        case "integer", "number": value is NSNumber
        default: true
        }
    }

    static func contract() throws -> [String: Any] {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: repo.appendingPathComponent("contracts/helper-ipc.schema.json"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    static func defs(_ name: String) throws -> [String: Any] {
        ((try contract())["$defs"] as! [String: Any])[name] as! [String: Any]
    }
}
