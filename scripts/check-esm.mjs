// scripts/check-esm.mjs
//
// Two static checks that `node --check` alone does NOT catch:
//   1. Duplicate ESM named exports within a single module (e.g. `export function
//      foo` plus a later `export { foo }`) - this is a load-time SyntaxError in the
//      GameFace engine but slips past a per-file `node --check`.
//   2. Unresolved intra-mod import specifiers - an `import ... from
//      "/cultural-diffusion/ui/xyz.js"` whose target file does not exist on disk.
//
// Exits non-zero (with a report) on any violation so it can gate CI / verify.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const uiDir = path.join(root, "ui");
const MODULE_PREFIX = "/cultural-diffusion/";

/** @type {string[]} */
const errors = [];

/** Collect the set of names exported by a module (named exports only). */
function collectExports(src, file) {
  const seen = new Set();
  const add = (name) => {
    if (!name || name === "default") return;
    if (seen.has(name)) errors.push(`${file}: duplicate export of "${name}"`);
    seen.add(name);
  };
  // export function/const/let/var/class NAME
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    add(m[1]);
  }
  // export { a, b as c, ... }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const asMatch = t.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      add(asMatch ? asMatch[1] : t.split(/\s+/)[0]);
    }
  }
}

/** Verify every intra-mod import specifier resolves to a real file. */
function checkImports(src, file) {
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith(MODULE_PREFIX)) continue; // engine-served (/core, /base-standard) - skip
    const target = path.join(root, spec.slice(MODULE_PREFIX.length));
    if (!fs.existsSync(target)) errors.push(`${file}: import target not found -> ${spec}`);
  }
}

const files = fs.readdirSync(uiDir).filter((f) => f.endsWith(".js"));
for (const f of files) {
  const abs = path.join(uiDir, f);
  const src = fs.readFileSync(abs, "utf8");
  collectExports(src, `ui/${f}`);
  checkImports(src, `ui/${f}`);
}

if (errors.length) {
  console.error("ESM integrity check FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`ESM integrity OK (${files.length} modules)`);
