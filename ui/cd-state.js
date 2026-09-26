// cd-state.js
//
// Persistence for the reaction-diffusion culture field (docs/current-model.md §2). State survives
// save/reload through GameConfiguration, wrapped in a versioned `{ v, data }` envelope and fully
// sanitized on load so a corrupt blob can never throw into the pass. The math lives in cd-field.js.

const STATE_KEY = "CulturalDiffusionState_v2"; // v2 = culture-field model
const STATE_SCHEMA_VERSION = 2;
const MAX_FIELD_ENTRIES = 20000;
const MAX_CLAIM_ENTRIES = 8192;
const MAX_LOCK_ENTRIES = 8192;
const MAX_PENDING_ENTRIES = 1024;
const MAX_OCCUPATION_ENTRIES = 2048;
const PENDING_KINDS = ["claim", "cede"];

/**
 * @typedef {Object} ClaimEntry
 * @property {number} by Player id that owns the plot by culture (the "soft halo").
 * @property {number} city City id (numeric) the plot is attached to, or -1.
 * @property {number} turn Monotonic turn the claim was made.
 */

/**
 * @typedef {Object} PendingEntry An ownership verb whose result had not landed on the same tick (cd-pending.js).
 * @property {"claim"|"cede"} kind What was asked for.
 * @property {number} by The player the tile should end up with.
 * @property {number} city City id the tile was attached to (claim), or -1.
 * @property {number} turn Monotonic turn the verb was sent.
 * @property {number} was Owner before the verb (for the claim notification), or -1.
 * @property {number} hold Lock length to apply once confirmed instead of flipCooldownTurns (0 = the default).
 */

/**
 * @typedef {Object} CdState
 * @property {Record<string, Record<string, number>>} field Per-tile culture stock: "x,y" -> { civId -> value }.
 * @property {Record<string, ClaimEntry>} claims Plots this mod has claimed (soft halo), keyed "x,y".
 * @property {Record<string, number>} locked Anti-flicker cooldown: "x,y" -> turns remaining before it may flip again.
 * @property {Record<string, PendingEntry>} pending Verbs awaiting confirmation on the next pass, keyed "x,y".
 * @property {Record<string, {by:number, turns:number}>} occupation Conquest counters (cd-conquest.js): "x,y" ->
 *   which player's combat unit has held the tile, and for how many consecutive passes.
 * @property {number} monoTurn Monotonic turn (never resets at age boundaries).
 */

/** @returns {CdState} A fresh empty state. */
function defaultState() {
  return { field: {}, claims: {}, locked: {}, pending: {}, occupation: {}, monoTurn: 0 };
}

/**
 * Normalize one occupation row.
 * @param {*} v Candidate.
 * @returns {{by:number, turns:number}|null} Normalized row, or null if unusable.
 */
function normalizeOccupation(v) {
  if (!v || typeof v !== "object") return null;
  const by = Math.floor(num(v.by, Number.NaN));
  const turns = Math.floor(num(v.turns, 0));
  if (!isFinite(by) || by < 0 || turns <= 0) return null;
  return { by, turns };
}

/**
 * Normalize one pending row.
 * @param {*} v Candidate.
 * @returns {PendingEntry|null} Normalized row, or null if unusable.
 */
function normalizePending(v) {
  if (!v || typeof v !== "object" || PENDING_KINDS.indexOf(v.kind) < 0) return null;
  const by = Math.floor(num(v.by, Number.NaN));
  if (!isFinite(by)) return null;
  return {
    kind: v.kind,
    by,
    city: Math.floor(num(v.city, -1)),
    turn: Math.max(0, Math.floor(num(v.turn, 0))),
    was: Math.floor(num(v.was, -1)),
    hold: Math.max(0, Math.floor(num(v.hold, 0)))
  };
}

/** @param {*} v @param {number} fallback @returns {number} */
function num(v, fallback) {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

/**
 * Normalize one field row: { civId -> value } with finite non-negative values.
 * @param {*} v Candidate.
 * @returns {Record<string, number>|null} Clean row, or null if empty/unusable.
 */
function normalizeFieldRow(v) {
  if (!v || typeof v !== "object") return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const key of Object.keys(v)) {
    if (!/^-?\d+$/.test(key)) continue; // civ ids only
    const val = num(v[key], 0);
    if (val > 0) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Normalize one claim row.
 * @param {*} v Candidate.
 * @returns {ClaimEntry|null} Normalized row, or null if unusable.
 */
function normalizeClaim(v) {
  if (!v || typeof v !== "object") return null;
  const by = Math.floor(num(v.by, Number.NaN));
  if (!isFinite(by)) return null;
  return { by, city: Math.floor(num(v.city, -1)), turn: Math.max(0, Math.floor(num(v.turn, 0))) };
}

/**
 * Normalize a keyed map with a per-row normalizer and a hard entry cap.
 * @param {*} src Candidate map.
 * @param {(v:*)=>*} fn Per-row normalizer (null return drops the row).
 * @param {number} cap Max entries.
 * @returns {Record<string, *>} Normalized map.
 */
function normalizeMap(src, fn, cap) {
  /** @type {Record<string, *>} */
  const out = {};
  if (!src || typeof src !== "object") return out;
  let n = 0;
  for (const [key, value] of Object.entries(src)) {
    if (n >= cap) break;
    if (!key.length) continue; // Object.entries always yields string keys, so only "" can fail here
    const row = fn(value);
    if (row == null) continue;
    out[key] = row;
    n++;
  }
  return out;
}

/**
 * Coerce a parsed blob (legacy raw or `{v,data}` envelope) into canonical state.
 * @param {*} s Parsed value.
 * @returns {CdState} Normalized state (default if unusable).
 */
export function normalizeState(s) {
  const payload = s && typeof s === "object"
    ? (typeof s.v === "number" && s.data && typeof s.data === "object" ? s.data : s)
    : null;
  const out = defaultState();
  if (!payload || typeof payload !== "object") return out;
  out.monoTurn = Math.max(0, Math.floor(num(payload.monoTurn, 0)));
  out.field = normalizeMap(payload.field, normalizeFieldRow, MAX_FIELD_ENTRIES);
  out.claims = normalizeMap(payload.claims, normalizeClaim, MAX_CLAIM_ENTRIES);
  out.locked = normalizeMap(
    payload.locked,
    (v) => { const n = Math.floor(num(v, 0)); return n > 0 ? n : null; },
    MAX_LOCK_ENTRIES
  );
  out.pending = normalizeMap(payload.pending, normalizePending, MAX_PENDING_ENTRIES);
  out.occupation = normalizeMap(payload.occupation, normalizeOccupation, MAX_OCCUPATION_ENTRIES);
  return out;
}

/** @returns {number} Game.turn or 0. */
function gameTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : 0;
  } catch (_) {
    return 0;
  }
}

/** @returns {string|null} The stored JSON string, or null. */
function readStateRaw() {
  try {
    const g = Configuration?.getGame?.();
    if (!g || typeof g.getValue !== "function") return null;
    const v = g.getValue(STATE_KEY);
    return typeof v === "string" && v.length ? v : null;
  } catch (_) {
    return null;
  }
}

/**
 * Load persisted diffusion state.
 * @returns {CdState} The state.
 */
export function loadState() {
  try {
    const raw = readStateRaw();
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (_) {
    /* ignore */
  }
  return defaultState();
}

/**
 * Persist diffusion state (versioned envelope, sanitized).
 * @param {*} state State object.
 * @returns {number} Length of the persisted JSON string (0 when nothing was written), so the pass can
 *   log how large the save blob has grown.
 */
export function saveState(state) {
  try {
    const normalized = normalizeState(state);
    const blob = JSON.stringify({ v: STATE_SCHEMA_VERSION, data: normalized });
    const e = Configuration?.editGame?.();
    if (e && typeof e.setValue === "function") {
      e.setValue(STATE_KEY, blob);
      return blob.length;
    }
  } catch (_) {
    /* ignore */
  }
  return 0;
}

/**
 * Advance the monotonic turn and tick every locked tile's cooldown down by one.
 * @param {CdState} state Loaded state.
 */
export function prepareState(state) {
  state.monoTurn = Math.max(state.monoTurn + 1, gameTurn());
  if (!state.locked) state.locked = {};
  for (const key of Object.keys(state.locked)) {
    const t = state.locked[key] - 1;
    if (t > 0) state.locked[key] = t;
    else delete state.locked[key];
  }
}

/**
 * Prune empty field rows (all stocks decayed away) so the persisted map stays bounded as the
 * front moves.
 * @param {CdState} state Loaded state.
 */
export function pruneState(state) {
  for (const key of Object.keys(state.field)) {
    const row = state.field[key];
    let any = false;
    for (const civ of Object.keys(row)) {
      if (row[civ] > 0) { any = true; } else { delete row[civ]; }
    }
    if (!any) delete state.field[key];
  }
}

/** Test/introspection helpers. */
export const __test = { defaultState, normalizeFieldRow, normalizeClaim, STATE_KEY };
