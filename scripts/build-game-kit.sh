#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-blender}"
if ! command -v "$BLENDER" >/dev/null 2>&1; then
  echo "Blender not found. Install Blender, then run: BLENDER=/path/to/blender scripts/build-game-kit.sh"
  exit 1
fi
"$BLENDER" -b -P blender/game_kit.py
echo "Game kit written to public/game-kit.glb"
