// cd-probe-store.js
//
// Q-PERSIST helper. Records what the probe flipped (plot + verb + run id) into a
// SHELL-READABLE, save-independent store so that after a save->reload (or a menu
// round-trip) the probe can re-read its own record and re-inspect whether the
// flipped plot kept its new owner.
//
// IMPORTANT (repo crash gotcha): we must NEVER write GameConfiguration via
// Configuration.editGame().setValue at runtime - it poisons the persisted config
// and crashes the game on next launch. localStorage is confirmed shell-readable
// and safe, so the probe's own bookkeeping lives there. The GAME's tile ownership
// itself is what we are testing for persistence; this store only remembers what to
// re-check.
//
// THRASH FIX (probe-history.md §2): the game-scope isolate's localStorage was
// observed NOT to round-trip between ticks ("schema changed x107" - the state machine
// reset every turn and destroyed the flip->reload flow). globalThis DOES survive
// between ticks within a session (same isolate), so every write is cached there and
// reads are served from it; localStorage is still written best-effort for CROSS-session
// persistence (the actual Q-PERSIST signal) and seeds the mirror once per isolate.

const KEY = "cd-probe-flips-v1";
const META_KEY = "cd-probe-meta-v1";
const WORK_KEY = "cd-probe-work-v1";
const VERB_KEY = "cd-probe-verb-v1";

function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

// Within-session mirror. Survives between ticks in one isolate even when localStorage
// silently fails to round-trip; seeded from localStorage on the first read of each key.
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

// Mirror-first read: once a key is in the session mirror it is authoritative (prevents the
// per-tick reset thrash if localStorage returns stale/absent data mid-session). On a cold
// isolate the mirror is empty, so we seed it from localStorage - which may have survived a
// save/reload, exactly the cross-session persistence we want to detect.
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

// --- Phase / bookkeeping meta -----------------------------------------------
// The auto-runner is a small state machine persisted here so it flips a plot
// exactly ONCE (not every turn) and knows, on a later session, that it should be
// running the persistence re-check instead of flipping again.
//   phase: "init"    -> nothing flipped yet; keep trying each turn until it can
//          "flipped" -> flips done; awaiting a save/reload to prove persistence
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

// --- Q-WORK persistence markers (E) -----------------------------------------
// When the destructive confirm places a worker / rural district on a far tile, we
// record what we placed (+ the session nonce) so a later session can re-read the tile
// and prove the WORKED state - not just ownership - survived the save/reload.
export function readWork() { return readList(WORK_KEY); }
export function recordWork(entry) { return appendList(WORK_KEY, entry); }
export function clearWork() { removeRaw(WORK_KEY); return true; }

// --- Q-VERB markers (Phase 0) -----------------------------------------------
// The verb probe claims a DISTINCT tile per candidate verb (Growth.claimPlot /
// DISTRICT_RURAL) and records the gold read + resolved verdict, so a later session can
// re-read whether the FREE-INTEGRATED claim survived the save/reload.
export function readVerb() { return readList(VERB_KEY); }
export function recordVerb(entry) { return appendList(VERB_KEY, entry); }
export function clearVerb() { removeRaw(VERB_KEY); return true; }

// Patch an already-recorded verb marker in place (matched by runId+verb+kind) once its
// deferred integration read resolves. Keeps the persisted verdict for the reload re-check.
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
