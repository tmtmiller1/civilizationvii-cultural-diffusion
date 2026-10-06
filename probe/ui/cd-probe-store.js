// cd-probe-store.js
//
// Q-PERSIST bookkeeping. Records what the probe flipped (plot, verb, run id) in a
// save-independent store so that after a reload the probe can re-read its own record and
// check whether the plot kept its new owner. The game's tile ownership is what is under
// test; this store only remembers what to re-check.
//
// Never write GameConfiguration via Configuration.editGame().setValue at runtime: it
// poisons the persisted config and crashes the game on the next launch. localStorage is
// shell-readable and safe, so the bookkeeping lives there.
//
// The game-scope isolate's localStorage does not round-trip reliably between ticks
// (probe-history.md §2: the state machine reset every turn and broke the flip-then-reload
// flow). globalThis does survive between ticks in one isolate, so every write is cached
// there and reads come from the cache; localStorage is still written for cross-session
// persistence and seeds the cache once per isolate.

const KEY = "cd-probe-flips-v1";
const META_KEY = "cd-probe-meta-v1";
const WORK_KEY = "cd-probe-work-v1";
const VERB_KEY = "cd-probe-verb-v1";

function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

// Within-session mirror, seeded from localStorage on the first read of each key.
function mirror() {
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  if (!g.__cdProbeStore) g.__cdProbeStore = {};
  return g.__cdProbeStore;
}

function ls() {
  if (typeof localStorage !== "undefined") return localStorage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

// Once a key is in the mirror it is authoritative, so stale or absent localStorage reads
// mid-session cannot reset the state machine. A cold isolate seeds the mirror from
// localStorage, which may have survived a reload: that is the cross-session signal.
function getRaw(key) {
  const m = mirror();
  if (Object.prototype.hasOwnProperty.call(m, key)) return m[key];
  const b = ls();
  const v = b ? safe(() => b.getItem(key), null) : null;
  m[key] = v; // seed (may be null)
  return v;
}

function setRaw(key, value) {
  mirror()[key] = value;
  const b = ls();
  if (b) safe(() => { b.setItem(key, value); return true; }, false);
}

function removeRaw(key) {
  mirror()[key] = null; // keep the key present so getRaw treats "cleared" as authoritative
  const b = ls();
  if (b) safe(() => { b.removeItem(key); return true; }, false);
}

// Read a `{ v, data:[...] }` envelope as its array, else [].
function readList(key) {
  return safe(() => {
    const raw = getRaw(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }, []);
}

function writeList(key, list) {
  return safe(() => { setRaw(key, JSON.stringify({ v: 1, data: list })); return true; }, false);
}

// Append to a bounded (<=50) list.
function appendList(key, entry) {
  const list = readList(key);
  list.push(entry);
  while (list.length > 50) list.shift();
  return writeList(key, list);
}

export function readFlips() { return readList(KEY); }
export function recordFlip(entry) { return appendList(KEY, entry); }
export function clearFlips() { removeRaw(KEY); return true; }

// phase meta
// The auto-runner's state machine lives here so it flips a plot once, not every turn, and
// knows on a later session to run the persistence re-check instead of flipping again.
//   phase: "init"    -> nothing flipped yet; keep trying each turn until it can
//          "flipped" -> flips done; waiting for a save/reload
//          "done"    -> persistence re-checked and reported
export function readMeta() {
  return safe(() => {
    const raw = getRaw(META_KEY);
    if (!raw) return { phase: "init" };
    const parsed = JSON.parse(raw);
    return (parsed && parsed.data) ? parsed.data : { phase: "init" };
  }, { phase: "init" });
}

export function writeMeta(meta) {
  return safe(() => { setRaw(META_KEY, JSON.stringify({ v: 1, data: meta })); return true; }, false);
}

export function clearAll() {
  removeRaw(KEY); removeRaw(META_KEY); removeRaw(WORK_KEY); removeRaw(VERB_KEY);
  return true;
}

// Q-WORK persistence markers (E)
// When the destructive confirm places a worker or rural district on a far tile, record
// what was placed (plus the session nonce) so a later session can re-read the tile and
// see whether the worked state, not just ownership, survived the reload.
export function readWork() { return readList(WORK_KEY); }
export function recordWork(entry) { return appendList(WORK_KEY, entry); }
export function clearWork() { removeRaw(WORK_KEY); return true; }

// Q-VERB markers (Phase 0)
// The verb probe claims a distinct tile per candidate verb (Growth.claimPlot,
// DISTRICT_RURAL) and records the gold read and verdict, so a later session can re-read
// whether a FREE-INTEGRATED claim survived the reload.
export function readVerb() { return readList(VERB_KEY); }
export function recordVerb(entry) { return appendList(VERB_KEY, entry); }
export function clearVerb() { removeRaw(VERB_KEY); return true; }

// Patch a recorded verb marker in place (matched by runId+verb+kind) once its deferred
// integration read resolves, so the reload re-check sees the final verdict.
export function updateVerb(runId, verb, kind, patch) {
  const list = readVerb();
  let changed = false;
  for (const e of list) {
    if (e.runId === runId && e.verb === verb && e.kind === kind) { Object.assign(e, patch); changed = true; }
  }
  if (changed) writeList(VERB_KEY, list);
  return changed;
}

export { KEY, META_KEY, WORK_KEY, VERB_KEY };
