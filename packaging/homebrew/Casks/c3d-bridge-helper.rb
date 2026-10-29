cask "c3d-bridge-helper" do
  version "0.1.2"
  sha256 "513cbb806b8ad1117366e0314ca950f35e08351c5a437b57936da1dc9f49978b"

  url "https://github.com/megatih/c3d-mcp/releases/download/v#{version}/C3D-Bridge-Helper-#{version}.zip"
  name "C3D Bridge Helper"
  desc "Accessibility helper for the c3d-mcp Cheetah3D MCP server"
  homepage "https://github.com/megatih/c3d-mcp"

  depends_on macos: ">= :sonoma"

  app "C3D Bridge Helper.app"

  zap trash: [
    "~/Library/Logs/c3d-mcp",
    "~/Library/LaunchAgents/dev.c3dmcp.helper.plist",
  ]

  caveats <<~EOS
    The helper needs Accessibility (and optionally Screen Recording) permission:
      System Settings > Privacy & Security > Accessibility > enable "C3D Bridge Helper".
    The app is ad-hoc signed (not notarized). If macOS blocks it, run:
      xattr -dr com.apple.quarantine "/Applications/C3D Bridge Helper.app"
    After upgrading the helper, macOS may ask you to grant the permissions again.
  EOS
end
