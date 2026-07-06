#!/usr/bin/env node
// inventory.mjs
//
// Regenerates the file inventory for the monolith snapshot in one reproducible run, so the
// report stops drifting from the tree (stale rows, moved/split modules). Dependency-free
// (Node built-ins only). Mirrors emigration/scripts/inventory.mjs.
//
// Scope: every file under the mod root, excluding .git, node_modules, and the gitignored build
// artifacts (dist/, coverage/, reports/, .stryker-tmp/) - matching monoliths-analysis.md.
//
// Per file it reports: ext, raw line count, bytes, function-declaration count, class count, and
// the raw-line monolith flag (> 500). The monolith *gate* enforced in CI is eslint's CODE-line
// count (skipBlank + skipComments); this raw-line flag is the report's coarser screen.
//
// Usage:  node scripts/inventory.mjs [--md]    (--md prints the markdown table; default = totals)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AS_MD = process.argv.includes("--md");

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", "reports", ".stryker-tmp"]);
const CODE_EXT = new Set([".js", ".mjs", ".ts"]);

// Recursively list files relative to ROOT (posix), honoring the documented exclusions.
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...listFiles(join(dir, ent.name)));
      continue;
    }
    const rel = relative(ROOT, join(dir, ent.name)).split("\\").join("/");
    out.push(rel);
  }
  return out;
}

// Count top-level-ish function declarations and classes (a coarse screen, not a parser).
function symbolCounts(rel, src) {
  const ext = extname(rel);
  if (!CODE_EXT.has(ext)) return { fns: 0, classes: 0 };
  const fns = (src.match(/\bfunction\b/g) || []).length;
  const classes = (src.match(/\bclass\s+[A-Za-z_$]/g) || []).length;
  return { fns, classes };
}

function rowFor(rel) {
  const abs = join(ROOT, rel);
  const src = readFileSync(abs, "utf8");
  const lines = src.length ? src.split("\n").length : 0;
  const bytes = statSync(abs).size;
  const ext = extname(rel) || "(none)";
  const { fns, classes } = symbolCounts(rel, src);
  const isCode = CODE_EXT.has(extname(rel));
  const overRaw = isCode && lines > 500;
  const quality = !isCode
    ? "Info"
    : overRaw
      ? "Needs review: file_lines>500"
      : "Within quick thresholds";
  return { file: "cultural-diffusion/" + rel, ext, lines, bytes, fns, classes, isCode, overRaw, quality };
}

function main() {
  const files = listFiles(ROOT).sort();
  const rows = files.map(rowFor);
  const flagged = rows.filter((r) => r.overRaw);
  if (!AS_MD) {
    process.stdout.write(
      JSON.stringify(
        {
          totalFiles: rows.length,
          codeFiles: rows.filter((r) => r.isCode).length,
          flaggedOver500Raw: flagged.map((r) => r.file),
          totalFunctionDecls: rows.reduce((n, r) => n + r.fns, 0),
          totalClasses: rows.reduce((n, r) => n + r.classes, 0)
        },
        null,
        2
      ) + "\n"
    );
    return;
  }
  const lines = [
    `Generated: (regenerate with \`node scripts/inventory.mjs --md\`)`,
    `Scope: every file under cultural-diffusion/, excluding .git, node_modules, gitignored build`,
    `artifacts (dist/, coverage/, reports/, .stryker-tmp/)`,
    `Total files analyzed: ${rows.length}`,
    `Files flagged by quick monolith threshold (raw lines > 500): ${flagged.length}` +
      (flagged.length ? " (" + flagged.map((r) => basename(r.file)).join(", ") + ")" : ""),
    ``,
    `| File | Ext | Lines | Bytes | Fns | Classes | Threshold | Quality |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...rows.map(
      (r) =>
        `| ${r.file} | ${r.ext} | ${r.lines} | ${r.bytes} | ${r.fns} | ${r.classes} | ` +
        `${r.isCode ? "code_file_lines<=500" : "N/A"} | ${r.quality} |`
    )
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

main();
