// readme_pdf_source.mjs
//
// Turn README.md into the markdown the PDF is built from, following the demographics and emigration
// builds. Two things need changing for print:
//   * The before/after pair is a two-column markdown table. In LaTeX a picture inside a table cell
//     overruns the column, so the pair becomes two figures, stacked, each with its own caption.
//   * Every screenshot is copied at PDF width, so the file stays a few megabytes instead of tens.
// The remaining captures (the ones the README does not show inline) are appended as a gallery, so the
// PDF carries the whole suite.
//
// Usage: node scripts/readme_pdf_source.mjs <out-dir>   (writes <out-dir>/README.pdf.md + img/)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const outDir = process.argv[2];
if (!outDir) throw new Error("usage: readme_pdf_source.mjs <out-dir>");
const imgDir = path.join(outDir, "img");
fs.mkdirSync(imgDir, { recursive: true });

/** Longest edge of a picture in the PDF, in pixels. */
const IMAGE_WIDTH = 1400;

/** Captures the README does not show inline, appended as a gallery. */
const EXTRA = [
  ["gallery/02-contested-frontier-close.jpg",
    "The same front close in, so the shading reads tile by tile against the terrain."],
  ["gallery/03-lens-in-the-lens-list.jpg",
    "Cultural Pressure is a real entry in the game's own Lenses panel, not an overlay bolted on."],
];

/**
 * Copy a picture into the build directory, scaled down for print.
 * @param {string} src Path relative to the repository root.
 * @returns {string} Path relative to the build directory.
 */
function stage(src) {
  const from = path.join(ROOT, src);
  if (!fs.existsSync(from)) throw new Error("missing image: " + src);
  const name = src.replace(/[^\w.-]+/g, "-");
  const to = path.join(imgDir, name);
  if (!fs.existsSync(to)) {
    execFileSync("sips", ["-Z", String(IMAGE_WIDTH), from, "--out", to], { stdio: "ignore" });
  }
  return path.posix.join("img", name);
}

/**
 * Escape the characters pandoc reads as markup inside a caption.
 * @param {string} s Caption text.
 * @returns {string} Caption.
 */
function caption(s) {
  return s.replace(/([[\]*_])/g, "\\$1").replace(/\s+/g, " ").trim();
}

/**
 * One markdown figure.
 * @param {string} src Path relative to the repository root.
 * @param {string} alt Caption text.
 * @returns {string} Markdown.
 */
function figure(src, alt) {
  return "![" + caption(alt) + "](" + stage(src) + ")";
}

/**
 * The before/after pair as ONE figure with two panels. Stacked as separate figures they can land on
 * different pages, and a pair the reader cannot see at once is not a comparison.
 * @param {{alt:string,src:string}[]} panels The two staged pictures, in order.
 * @returns {string} A `{=latex}` raw block (gfm carries raw LaTeX through +raw_attribute).
 */
function pairFigure(panels) {
  // Raw LaTeX is NOT resolved through pandoc's --resource-path, so these paths must be absolute or
  // tectonic cannot find the pictures ("Unable to load picture or PDF file").
  const panel = (p, label) =>
    "\\begin{minipage}[t]{0.49\\linewidth}\\centering\n" +
    "\\includegraphics[width=\\linewidth,height=0.30\\textheight,keepaspectratio]{" +
    path.join(outDir, p.src) + "}\\\\[2pt]\n" +
    "{\\small\\textbf{" + label + "}}\n\\end{minipage}";
  return [
    "```{=latex}",
    "\\begin{figure}[H]", "\\centering",
    panel(panels[0], "Before"), "\\hfill", panel(panels[1], "After"),
    "\\caption{" + panels[0].alt.replace(/[&%$#_{}]/g, "").replace(/\bbefore\b/, "before and after") + "}",
    "\\end{figure}",
    "```",
  ].join("\n");
}

let md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

// The before/after table: `| ![alt](src) | ![alt](src) |` with its header rows. Becomes two figures.
md = md.replace(
  /\|\s*Before\s*\|\s*After\s*\|\r?\n\|[\s|:-]+\r?\n\|(.+?)\|\r?\n/s,
  (_all, row) => {
    const cells = [...row.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    if (cells.length !== 2) throw new Error("before/after row: expected 2 images, got " + cells.length);
    return pairFigure(cells.map(([, alt, src]) => ({ alt, src: stage(src) }))) + "\n";
  },
);

// Every remaining inline picture, staged at print width.
md = md.replace(/!\[([^\]]*)\]\((gallery\/[^)]+)\)/g, (_all, alt, src) => figure(src, alt));

// Links to other mods in the repo, and to the gallery folder, go nowhere from a PDF.
md = md.replace(/\[([^\]]+)\]\((?:\.\.\/[^)]+|gallery\/)\)/g, "$1");

md += "\n\n## Gallery\n\n" + EXTRA.map(([src, alt]) => figure(src, alt)).join("\n\n") + "\n";

fs.writeFileSync(path.join(outDir, "README.pdf.md"), md);
console.log("staged", fs.readdirSync(imgDir).length, "images");
