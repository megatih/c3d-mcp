# Homebrew tap

Create a repo `homebrew-c3d-mcp` containing `Casks/c3d-bridge-helper.rb`, then:

    brew tap megatih/c3d-mcp
    brew install --cask c3d-bridge-helper

Update `version` and `sha256` for every helper release (`shasum -a 256 C3D-Bridge-Helper-<v>.zip`).
