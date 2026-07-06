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

const KEY = "cd-probe-flips-v1";
const META_KEY = "cd-probe-meta-v1";

function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

function backend() {
  if (typeof localStorage !== "undefined") return localStorage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

export function readFlips() {
  const b = backend();
  if (!b) return [];
  return safe(() => {
    const raw = b.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }, []);
}

export function recordFlip(entry) {
  const b = backend();
  if (!b) return false;
  return safe(() => {
    const list = readFlips();
    list.push(entry);
    // Bound the log so a long probing session can't grow unbounded.
    while (list.length > 50) list.shift();
    b.setItem(KEY, JSON.stringify({ v: 1, data: list }));
    return true;
  }, false);
}

export function clearFlips() {
  const b = backend();
  if (!b) return false;
  return safe(() => { b.removeItem(KEY); return true; }, false);
}

// --- Phase / bookkeeping meta -----------------------------------------------
// The auto-runner is a small state machine persisted here so it flips a plot
// exactly ONCE (not every turn) and knows, on a later session, that it should be
// running the persistence re-check instead of flipping again.
//   phase: "init"    -> nothing flipped yet; keep trying each turn until it can
//          "flipped" -> flips done; awaiting a save/reload to prove persistence
//          "done"    -> persistence re-checked and reported
export function readMeta() {
  const b = backend();
  if (!b) return { phase: "init" };
  return safe(() => {
    const raw = b.getItem(META_KEY);
    if (!raw) return { phase: "init" };
    const parsed = JSON.parse(raw);
    return (parsed && parsed.data) ? parsed.data : { phase: "init" };
  }, { phase: "init" });
}

export function writeMeta(meta) {
  const b = backend();
  if (!b) return false;
  return safe(() => { b.setItem(META_KEY, JSON.stringify({ v: 1, data: meta })); return true; }, false);
}

export function clearAll() {
  const b = backend();
  if (!b) return false;
  return safe(() => { b.removeItem(KEY); b.removeItem(META_KEY); return true; }, false);
}

export { KEY, META_KEY };
