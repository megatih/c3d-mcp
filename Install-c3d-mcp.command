#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ -f ./install.sh ]; then bash ./install.sh "$@"; else curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh | bash -s -- "$@"; fi
read -r -p "Press Return to close this window..." _
