#!/usr/bin/env node
// hotspot-score.mjs
//
// Churn x complexity hotspot scoring for the Cultural Diffusion ui/ tree. Dependency-free
// (Node built-ins + git). Prioritizes files that combine frequent change (churn) with
// structural risk (complexity). Mirrors emigration/scripts/hotspot-score.mjs.
//
// GIT-AWARE: this mod folder is not always a git working tree. When git history is
// available, churn(f) = commits touching f in the sample window. When it is NOT (no .git
// above this folder), churn is reported as unavailable and files are ranked by complexity
// alone, with an explicit note - so the tool still produces a usable hotspot ordering and
// degrades honestly rather than failing.
//
// Definitions
//   churn(f)      = commits in the sample window that touched f (git log), or 0 if no git.
//   complexity(f) = 1 + count of control-flow decision points in f (file-level cyclomatic
//                   proxy: if / for / while / case / catch / ternary ? / && / || / ??).
//   hotspot(f)    = (churn(f)/maxChurn) * (complexity(f)/maxComplexity) when churn is
//                   available; otherwise complexity(f)/maxComplexity.
//
// Repo-level score: max over f of hotspot(f), rounded to 3 dp (0..1; lower is healthier).
//
// Usage:  node scripts/hotspot-score.mjs [--window N] [--top N] [--json]

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = join(ROOT, "ui");

const argv = process.argv.slice(2);
const argVal = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const WINDOW = Number(argVal("--window", "120"));
const TOP = Number(argVal("--top", "15"));
const AS_JSON = argv.includes("--json");

// Recursively list every ui/ .js path relative to ROOT (posix-style).
function listUiJs() {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(UI_DIR, { recursive: true, withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith(".js")) continue;
    const abs = join(ent.parentPath || ent.path, ent.name);
    const rel = relative(ROOT, abs).split("\\").join("/");
    out.push(rel);
  }
  return out;
}

// True when ROOT is inside a git working tree WITH at least one commit (git log needs a HEAD).
function gitAvailable() {
  try {
    const inTree = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (inTree.trim() !== "true") return false;
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Map of file -> commit count over the last WINDOW commits, path-filtered to ui/. Returns an
// empty map (churn unavailable) if git log fails for any reason.
function churnByFile() {
  let raw;
  try {
    raw = execFileSync(
      "git",
      ["log", `-n${WINDOW}`, "--name-only", "--pretty=format:", "--", "ui"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch (_) {
    return new Map();
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of raw.split("\n")) {
    const f = line.trim();
    if (!f || !f.startsWith("ui/") || !f.endsWith(".js")) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return counts;
}

const DECISION_RE = /\b(if|for|while|case|catch)\b|\?(?!\.)|&&|\|\||(\?\?)/g;

// A file-level cyclomatic proxy: 1 + decision-point count.
function complexityOf(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  const m = src.match(DECISION_RE);
  return 1 + (m ? m.length : 0);
}

function main() {
  const files = listUiJs();
  const hasGit = gitAvailable();
  const churn = hasGit ? churnByFile() : new Map();
  const rows = files.map((f) => ({
    file: f,
    churn: churn.get(f) || 0,
    complexity: complexityOf(f)
  }));
  const maxChurn = Math.max(1, ...rows.map((r) => r.churn));
  const maxCx = Math.max(1, ...rows.map((r) => r.complexity));
  for (const r of rows) {
    const normCx = r.complexity / maxCx;
    r.hotspot = Number((hasGit ? (r.churn / maxChurn) * normCx : normCx).toFixed(4));
  }
  rows.sort((a, b) => b.hotspot - a.hotspot || b.complexity - a.complexity);
  const score = rows.length ? Number(rows[0].hotspot.toFixed(3)) : 0;

  if (AS_JSON) {
    process.stdout.write(
      JSON.stringify(
        { churnAvailable: hasGit, window: WINDOW, maxChurn, maxComplexity: maxCx, score, top: rows.slice(0, TOP) },
        null,
        2
      ) + "\n"
    );
    return;
  }
  const top = rows.slice(0, TOP);
  const churnNote = hasGit
    ? `Window: last ${WINDOW} commits (path-filtered to ui/). maxChurn=${maxChurn}, maxComplexity=${maxCx}.`
    : `CHURN UNAVAILABLE (not a git working tree) - ranked by complexity alone. maxComplexity=${maxCx}.`;
  const lines = [
    `# Hotspot score (churn x complexity)`,
    ``,
    churnNote,
    `Repo hotspot score (max) = ${score}`,
    ``,
    `| Rank | File | Churn | Complexity | Hotspot |`,
    `| --- | --- | --- | --- | --- |`,
    ...top.map(
      (r, i) =>
        `| ${i + 1} | ${r.file} | ${hasGit ? r.churn : "n/a"} | ${r.complexity} | ${r.hotspot} |`
    )
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

main();
