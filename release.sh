#!/usr/bin/env bash
# release.sh: produce a clean zip + Steam Workshop manifest ready for upload.
# Mirrors the sibling emigration mod's release pipeline.
#
# Usage:  ./release.sh
# Output: dist/cultural-diffusion-vX.Y.Z.zip  (X.Y.Z from cultural-diffusion.modinfo <Version>)
#         dist/cultural-diffusion/            (the content folder steamcmd uploads)
#         dist/workshop_item.vdf              (steamcmd build manifest)
#
# What this does:
#   1. Runs the quality gate (npm run verify: lint + syntax + esm + tests).
#   2. Mirrors the mod source into dist/cultural-diffusion/, excluding all dev cruft
#      (tests, scripts, docs, node_modules, the probe, tooling configs).
#   3. Forces debug logging off in the shipped copy (source stays dev-friendly).
#   4. Ships readable JS (no minification; transparent source is a property of the mod).
#   5. Syntax-checks every shipped JS file.
#   6. Zips with cultural-diffusion/ as the content root (modinfo at its root).
#   7. Audits the zip against an allow-list so stray files can't silently ship.
#   8. Writes a Steam Workshop .vdf (change note pulled from CHANGELOG.md on updates).
#
# Run from the mod source directory.

set -euo pipefail
cd "$(dirname "$0")"

MOD="cultural-diffusion"
MODINFO="$MOD.modinfo"

# Quality gate: never package a red build. Set SKIP_VERIFY=1 to bypass (emergency only).
if [ "${SKIP_VERIFY:-0}" != "1" ]; then
  echo "release: running 'npm run verify' (set SKIP_VERIFY=1 to skip)..."
  npm run verify || { echo "release: 'npm run verify' FAILED - aborting."; exit 1; }
fi

[ -f "$MODINFO" ] || { echo "error: $MODINFO not found in $(pwd)"; exit 1; }

VERSION="$(grep -oE '<Version>[^<]+</Version>' "$MODINFO" | head -1 | sed -E 's|</?Version>||g')"
[ -n "$VERSION" ] || { echo "error: could not parse <Version> from modinfo"; exit 1; }

AUTHORS="$(grep -oE '<Authors>[^<]+</Authors>' "$MODINFO" | head -1 | sed -E 's|</?Authors>||g')"
case "$AUTHORS" in
    ""|"Your Name"|"TODO") echo "error: set a real <Authors> in the modinfo first (got '$AUTHORS')."; exit 1 ;;
esac

# -- Steam Workshop published file id -----------------------------------------
# The publishedfileid makes steamcmd UPDATE the existing item instead of creating a
# duplicate. It lives OUTSIDE dist/ (which is wiped below) in steam_workshop_id.txt.
WORKSHOP_ID_FILE="steam_workshop_id.txt"
PUBLISHED_FILE_ID="${WORKSHOP_PUBLISHED_FILE_ID:-}"
SAVED_ID=""
[ -f "$WORKSHOP_ID_FILE" ] && SAVED_ID="$(tr -dc '0-9' < "$WORKSHOP_ID_FILE")"
if [ -z "$PUBLISHED_FILE_ID" ] && [ -n "$SAVED_ID" ]; then PUBLISHED_FILE_ID="$SAVED_ID"; fi

DIST_DIR="dist"
TARGET_DIR="$DIST_DIR/$MOD"
ZIP_NAME="$MOD-v$VERSION.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

echo "==> Cleaning $DIST_DIR/"
rm -rf "$DIST_DIR"
mkdir -p "$TARGET_DIR"

echo "==> Mirroring ./ -> $TARGET_DIR/ (excluding dev cruft + the dev probe)"
rsync -a \
    --exclude='CHANGELOG.steam.txt' --exclude='.git' --exclude='.gitignore' --exclude='.DS_Store' --exclude='dist' \
    --exclude='release.sh' --exclude='*.bak' --exclude='node_modules' \
    --exclude='tsconfig.json' --exclude='jsconfig.json' --exclude='types' --exclude='docs' \
    --exclude='eslint.config.js' --exclude='package.json' --exclude='package-lock.json' \
    --exclude='*.d.ts' --exclude='tests' --exclude='steam_workshop_id.txt' \
    --exclude='CONTRIBUTING.md' --exclude='scripts' --exclude='probe' --exclude='devtools' \
    --exclude='coverage*' --exclude='reports' --exclude='.stryker-tmp' \
    --exclude='.c8rc.json' --exclude='stryker*.json' \
    ./ "$TARGET_DIR"/

echo "==> Forcing debug logging off in shipped JS"
# BSD/macOS sed needs the empty -i argument. No-op when already false.
[ -f "$TARGET_DIR/ui/cd-config.js" ] && sed -i '' -E 's/^  debug: true,/  debug: false,/' "$TARGET_DIR/ui/cd-config.js"

echo "==> Syntax-checking shipped JS"
find "$TARGET_DIR" -name '*.js' -type f -print0 | xargs -0 -n1 node -c

echo "==> Verifying modinfo at content root"
[ -f "$TARGET_DIR/$MODINFO" ] || { echo "error: $TARGET_DIR/$MODINFO missing"; exit 1; }

echo "==> Zipping $ZIP_PATH"
( cd "$DIST_DIR" && zip -qr "$ZIP_NAME" "$MOD" )

echo "==> Verifying zip contents against allow-list"
ALLOW="^$MOD/($MOD\\.modinfo|README\\.md|LICENSE|CHANGELOG\\.md)\$"
ALLOW="$ALLOW"'|^'"$MOD"'/ui/.+\.(js|html|css)$'
ALLOW="$ALLOW"'|^'"$MOD"'/images/.+\.(svg|png)$'
ALLOW="$ALLOW"'|^'"$MOD"'/text/[a-z_]+/ModText\.xml$'
UNEXPECTED="$(unzip -Z1 "$ZIP_PATH" | grep -vE '/$' | grep -vE "$ALLOW" || true)"
if [ -n "$UNEXPECTED" ]; then
    echo "error: zip contains entries not on the allow-list:"
    echo "$UNEXPECTED" | sed 's/^/    /'
    echo "  -> tighten the rsync --exclude list, or update ALLOW in release.sh if intended."
    exit 1
fi
echo "    OK: every shipped entry matches the allow-list."

echo "==> Zip contents:"
unzip -l "$ZIP_PATH" | head -40 || true
SIZE="$(du -h "$ZIP_PATH" | cut -f1)"

# -- Workshop preview card (optional) -----------------------------------------
# If docs/workshop-preview.svg exists and rsvg-convert is installed, render a
# 1024x1024 preview.png (uploaded separately via the .vdf, so it never ships in the zip).
PREVIEW_SRC="docs/workshop-preview.svg"
PREVIEW_OUT="$DIST_DIR/preview.png"
ABS_PREVIEW=""
if [ -f "$PREVIEW_SRC" ] && command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 1024 -h 1024 "$PREVIEW_SRC" -o "$PREVIEW_OUT"
    ABS_PREVIEW="$(cd "$DIST_DIR" && pwd)/preview.png"
    echo "==> Workshop preview rendered: $PREVIEW_OUT"
else
    echo "==> No workshop preview (add docs/workshop-preview.svg + 'brew install librsvg', or set one on the Workshop page)."
fi

# -- Steam Workshop manifest (.vdf) -------------------------------------------
VDF_PATH="$DIST_DIR/workshop_item.vdf"
VDF_NO_PREVIEW_PATH="$DIST_DIR/workshop_item_no_preview.vdf"
ABS_CONTENT="$(cd "$TARGET_DIR" && pwd)"

# Change note: this release's block from CHANGELOG.steam.txt, which scripts/steam-changelog.mjs keeps in step with
# CHANGELOG.md (that script documents Steam's change-note formatting rules). The block is VDF-safe: no straight
# double quotes, no backslashes. Edit CHANGELOG.steam.txt to reword a note; a hand-edited block is kept.
CHANGENOTE="Initial release."
if [ -n "$PUBLISHED_FILE_ID" ]; then
    CHANGENOTE="$(node scripts/steam-changelog.mjs note "$VERSION")" \
        || { echo "error: could not build the Steam change note (see above)"; exit 1; }
fi

{
    echo '"workshopitem"'
    echo '{'
    echo '    "appid"          "1295660"'
    [ -n "$PUBLISHED_FILE_ID" ] && echo "    \"publishedfileid\" \"$PUBLISHED_FILE_ID\""
    echo "    \"contentfolder\"  \"$ABS_CONTENT\""
    [ -n "$ABS_PREVIEW" ] && echo "    \"previewfile\"    \"$ABS_PREVIEW\""
    echo '    "visibility"     "0"'
    echo '    "title"          "Cultural Diffusion"'
    # "description" intentionally omitted so steamcmd keeps the Workshop page description.
    echo "    \"changenote\"     \"${CHANGENOTE}\""
    echo '}'
} > "$VDF_PATH"

grep -v '"previewfile"' "$VDF_PATH" > "$VDF_NO_PREVIEW_PATH"

echo "==> Workshop manifest written: $VDF_PATH"
echo "==> No-preview fallback manifest written: $VDF_NO_PREVIEW_PATH"
echo ""
echo "Release built:  $ZIP_PATH  ($SIZE)"
echo "  Version:      $VERSION"
echo "  Authors:      $AUTHORS"
if [ -n "$PUBLISHED_FILE_ID" ]; then
    echo "  UPDATE mode:  publishedfileid $PUBLISHED_FILE_ID (existing item)"
else
    echo "  NEW-ITEM mode: no publishedfileid yet. The first upload creates one;"
    echo "                 then run: echo <publishedfileid> > steam_workshop_id.txt"
fi
echo ""
echo "-- Upload (from Mac, needs steamcmd) --"
echo "  ~/steamcmd/steamcmd.sh +login <yourSteamLogin> \\"
echo "      +workshop_build_item $(cd "$DIST_DIR" && pwd)/workshop_item.vdf +quit"
echo "  (If preview upload is denied, use workshop_item_no_preview.vdf.)"
