// cd-emigration.js
//
// The OPTIONAL bridge to the emigration mod, which enriches the fused model with ethnic affinity.
// Import-free: it reads the data emigration PERSISTS to the shared game-config store and
// feature-detects its console surface. Every path degrades to null/neutral when emigration is absent.
//
// Data channels:
//   - Configuration.getGame().getValue("EmigrationEthnos_v1")
//       -> JSON { cities: { "x,y": { owner, byCiv: { <civId>: pts }, total, name } } }
//       keyed by the city-center plot "x,y" (emigration-composition.js locKey).
//   - globalThis.EmigrationData - per-player migration stats (presence signal / future use).

const COMPOSITION_KEY = "EmigrationEthnos_v1";

/** @param {()=>*} fn @param {*} fallback @returns {*} */
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

/**
 * Whether the emigration mod appears to be present at runtime (either its console API is
 * installed or it has persisted composition data). Cheap, defensive.
 * @returns {boolean} True when emigration data is likely available.
 */
export function emigrationPresent() {
  return safe(() => {
    const g = /** @type {*} */ (globalThis);
    if (g && (g.EmigrationData || g.emigration)) return true;
    return readRawComposition() != null;
  }, false);
}

/** Read the raw persisted composition JSON string, or null. @returns {string|null} */
function readRawComposition() {
  return safe(() => {
    const g = Configuration?.getGame?.();
    const v = g && typeof g.getValue === "function" ? g.getValue(COMPOSITION_KEY) : null;
    return typeof v === "string" && v.length ? v : null;
  }, null);
}

/** Sanitize a raw byCiv map to positive finite numbers; returns the cleaned map + its sum. */
function sanitizeByCiv(rawByCiv) {
  const byCiv = {};
  let sum = 0;
  for (const c of Object.keys(rawByCiv)) {
    const v = rawByCiv[c];
    if (typeof v === "number" && isFinite(v) && v > 0) { byCiv[c] = v; sum += v; }
  }
  return { byCiv, sum };
}

/**
 * Parse one raw composition entry into `{owner, total, byCiv}`, or null when it carries no
 * positive population. Kept separate so loadComposition stays flat.
 * @param {*} e Raw per-city entry.
 * @returns {{owner:number, total:number, byCiv:Record<string,number>}|null} Parsed entry.
 */
function parseCompositionEntry(e) {
  if (!e || typeof e !== "object" || !e.byCiv || typeof e.byCiv !== "object") return null;
  const { byCiv, sum } = sanitizeByCiv(e.byCiv);
  if (sum <= 0) return null;
  const rawTotal = typeof e.total === "number" && isFinite(e.total) ? e.total : 0;
  const total = rawTotal > 0 ? rawTotal : sum; // trust the buckets if total is missing
  return { owner: typeof e.owner === "number" ? e.owner : -1, total, byCiv };
}

/**
 * Load emigration's population composition as a plot-keyed lookup. Each entry gives, for a
 * settlement center "x,y", the share of population descended from each origin civ.
 * @returns {Map<string, {owner:number, total:number, byCiv:Record<string,number>}>|null}
 *   "x,y" -> composition, or null when unavailable/unreadable.
 */
export function loadComposition() {
  const raw = readRawComposition();
  if (!raw) return null;
  return safe(() => {
    const parsed = JSON.parse(raw);
    const cities = parsed && parsed.cities;
    if (!cities || typeof cities !== "object") return null;
    /** @type {Map<string, {owner:number, total:number, byCiv:Record<string,number>}>} */
    const map = new Map();
    for (const key of Object.keys(cities)) {
      const entry = parseCompositionEntry(cities[key]);
      if (entry) map.set(key, entry);
    }
    return map.size ? map : null;
  }, null);
}

/**
 * The diaspora share in [0,1] of origin-civ `civId` within a composition entry.
 * @param {{total:number, byCiv:Record<string,number>}} entry Composition entry.
 * @param {number} civId Origin civ id.
 * @returns {number} Share in [0,1] (0 when absent).
 */
export function shareOfCiv(entry, civId) {
  if (!entry || !(entry.total > 0)) return 0;
  const pts = entry.byCiv[civId] != null ? entry.byCiv[civId] : entry.byCiv[String(civId)];
  const v = typeof pts === "number" && isFinite(pts) ? pts : 0;
  const share = v / entry.total;
  return share > 0 ? Math.min(1, share) : 0;
}
