// cd-state.js
//
// Persistence for the reaction-diffusion culture field (docs/cultural-diffusion-spec.md 3b).
// State survives save/reload through GameConfiguration (the same store the emigration mod
// uses), wrapped in a versioned `{ v, data }` envelope and fully sanitized on load so a
// corrupt blob can never throw into the pass. The heavy per-tile MATH lives in cd-field.js
// (pure); this file only stores and normalizes.

const STATE_KEY = "CulturalDiffusionState_v2"; // v2 = culture-field model (v1 was the charge model)
const STATE_SCHEMA_VERSION = 2;
const MAX_FIELD_ENTRIES = 20000;
const MAX_CLAIM_ENTRIES = 8192;
const MAX_LOCK_ENTRIES = 8192;

/**
 * @typedef {Object} ClaimEntry
 * @property {number} by Player id that owns the plot by culture (the "soft halo").
 * @property {number} city City id (numeric) the plot is attached to, or -1.
 * @property {number} turn Monotonic turn the claim was made.
 */

/**
 * @typedef {Object} CdState
 * @property {Record<string, Record<string, number>>} field Per-tile culture stock: "x,y" -> { civId -> value }.
 * @property {Record<string, ClaimEntry>} claims Plots this mod has claimed (soft halo), keyed "x,y".
 * @property {Record<string, number>} locked Anti-flicker cooldown: "x,y" -> turns remaining before it may flip again.
 * @property {number} monoTurn Monotonic turn (never resets at age boundaries).
 */

/** @returns {CdState} A fresh empty state. */
function defaultState() {
  return { field: {}, claims: {}, locked: {}, monoTurn: 0 };
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
 */
export function saveState(state) {
  try {
    const normalized = normalizeState(state);
    const e = Configuration?.editGame?.();
    if (e && typeof e.setValue === "function") {
      e.setValue(STATE_KEY, JSON.stringify({ v: STATE_SCHEMA_VERSION, data: normalized }));
    }
  } catch (_) {
    /* ignore */
  }
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
