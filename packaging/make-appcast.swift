// Writes the Sparkle appcast for one release. Usage:
//   swift make-appcast.swift <zip> <private-key-file> <version> <download-url> <out.xml>
// The EdDSA signature is a plain Ed25519 signature over the zip's bytes (what Sparkle verifies), base64 encoded.
import CryptoKit
import Foundation

let a = CommandLine.arguments
guard a.count == 6 else { FileHandle.standardError.write(Data("usage: make-appcast.swift <zip> <private-key-file> <version> <download-url> <out.xml>\n".utf8)); exit(2) }
let zip = try Data(contentsOf: URL(fileURLWithPath: a[1]))
let keyText = try String(contentsOfFile: a[2], encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
guard let keyData = Data(base64Encoded: keyText), keyData.count == 64 else { FileHandle.standardError.write(Data("bad key file\n".utf8)); exit(1) }
let key = try Curve25519.Signing.PrivateKey(rawRepresentation: keyData.prefix(32))
let signature = try key.signature(for: zip).base64EncodedString()
let version = a[3]
let date = DateFormatter()
date.locale = Locale(identifier: "en_US_POSIX"); date.timeZone = TimeZone(identifier: "UTC"); date.dateFormat = "EEE, dd MMM yyyy HH:mm:ss +0000"
let xml = """
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>C3D MCP</title>
    <item>
      <title>Version \(version)</title>
      <pubDate>\(date.string(from: Date()))</pubDate>
      <sparkle:version>\(version)</sparkle:version>
      <sparkle:shortVersionString>\(version)</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <enclosure url="\(a[4])" length="\(zip.count)" type="application/octet-stream" sparkle:edSignature="\(signature)"/>
    </item>
  </channel>
</rss>

"""
try xml.write(toFile: a[5], atomically: true, encoding: .utf8)
