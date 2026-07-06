// cd-probe-emit.js
//
// Minimal log emitter for the Cultural Diffusion feasibility probe. console.error
// is the only console channel the Civ VII UI runtime captures into UI.log on
// macOS, so every line goes through it. We reuse the existing [Civ7Probe] fence
// format so scripts/extract_dump.js from the modding-probe toolchain can parse
// this probe's output too.

import { hud } from "./cd-probe-hud.js";

const TAG = "[Civ7Probe]";
const CHUNK_BYTES = 3500;

// Base64 section-transport lines (BEGIN/END + numbered chunks) are noise on screen;
// everything else is a human-readable status/verdict line worth showing in the overlay.
function isTransportLine(line) {
  return /^BEGIN /.test(line) || /^END /.test(line)
    || /^RUN_START /.test(line) || /^RUN_END /.test(line)
    || /^[a-z][a-z0-9_]* \d+\/\d+ /.test(line); // "cd_integration 1/2 <base64>"
}

function nowIso() {
  try { return new Date().toISOString(); } catch (_) { return "unknown"; }
}

function b64(str) {
  try {
    if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(str)));
  } catch (_) { /* fall through */ }
  return str;
}

// FNV-1a, matches persist-probe so the same extractor verifies integrity.
function sha(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function emitLine(line) {
  try { console.error(`${TAG} ${line}`); } catch (_) { /* give up */ }
  // Mirror meaningful lines to the on-screen overlay (the player has no console/log).
  try { if (!isTransportLine(line)) hud(line); } catch (_) { /* ignore */ }
}

function emitSection(runId, section, payload) {
  let json;
  try { json = JSON.stringify(payload); } catch (e) { json = JSON.stringify({ _err: String(e) }); }
  const enc = b64(json);
  const n = Math.max(1, Math.ceil(enc.length / CHUNK_BYTES));
  emitLine(`BEGIN ${section} ${runId}`);
  for (let i = 0; i < n; i += 1) {
    emitLine(`${section} ${i + 1}/${n} ${enc.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)}`);
  }
  emitLine(`END ${section} ${runId} sha=${sha(json)} bytes=${json.length}`);
}

function newRunId() {
  const t = Date.now ? Date.now() : 0;
  const r = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${t.toString(16)}-${r}`;
}

export { nowIso, emitLine, emitSection, newRunId };
