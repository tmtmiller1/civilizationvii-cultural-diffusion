#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# The README's before/after pair is a two-column table, which LaTeX cannot hold a full-width picture
# in, so the PDF is built from a copy where each screenshot is a figure (scaled for print).
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
node "$ROOT_DIR/scripts/readme_pdf_source.mjs" "$BUILD_DIR"

pandoc "$BUILD_DIR/README.pdf.md" \
  --from gfm+implicit_figures+raw_attribute \
  --resource-path="$BUILD_DIR" \
  --lua-filter="$ROOT_DIR/scripts/table_wrap.lua" \
  --toc \
  --toc-depth=2 \
  --pdf-engine=tectonic \
  -V title="Cultural Diffusion - a culture-field border mod for Civilization VII" \
  -V author="" \
  -V date="" \
  -V geometry:margin=0.65in \
  -V fontsize=10pt \
  -V linestretch=1.03 \
  --include-in-header="$ROOT_DIR/scripts/pdf_header.tex" \
  -o "$ROOT_DIR/README.pdf"

shasum "$ROOT_DIR/README.pdf"
