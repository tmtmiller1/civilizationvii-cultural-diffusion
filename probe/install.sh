#!/usr/bin/env bash
# install.sh - copy the cultural-diffusion probe into the Civ VII Mods directory (macOS).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODS="$HOME/Library/Application Support/Civilization VII/Mods"
DEST="$MODS/cultural-diffusion-probe"

if [ ! -d "$MODS" ]; then
  echo "Civ VII Mods directory not found at: $MODS" >&2
  echo "Launch the game once before installing." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$HERE/cultural-diffusion-probe.modinfo" "$DEST/"
cp -R "$HERE/ui" "$DEST/"
echo "installed -> $DEST"
echo "Enable 'Cultural Diffusion Probe' in Add-Ons, load a single-player game, then just PLAY."
echo "It runs automatically - no dev console needed:"
echo "  1) Play a turn or two - it auto-flips one empty frontier tile (watch a border change owner)."
echo "  2) When the log says so, SAVE then RELOAD - it auto-reports whether the flip persisted."
echo "Read results in ~/Library/Application Support/Civilization VII/Logs/UI.log ([Civ7Probe] lines)."
