cask "c3d-bridge-helper" do
  version "0.1.0"
  sha256 "950ed19d8bcf16e2e3e824444b53a2b6755cb94e32b46746647dcb3543b2de9e"

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
