// Creates the Ed25519 key that signs Sparkle updates. Usage: swift make-update-key.swift <private-key-file> <public-key-file>
// Private file: base64 of the 32-byte seed followed by the 32-byte public key (the format `sign_update <key-file>` reads).
import CryptoKit
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write(Data("usage: make-update-key.swift <private> <public>\n".utf8)); exit(2) }
let key = Curve25519.Signing.PrivateKey()
let pub = key.publicKey.rawRepresentation
try (key.rawRepresentation + pub).base64EncodedString().write(toFile: args[1], atomically: true, encoding: .utf8)
try pub.base64EncodedString().write(toFile: args[2], atomically: true, encoding: .utf8)
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: args[1])
print(pub.base64EncodedString())
