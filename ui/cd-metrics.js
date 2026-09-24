// cd-metrics.js
//
// Civilization-level cultural signals for the CPI (docs/current-model.md §3). Reads ONLY base-game
// engine surfaces, so the civ multiplier needs no other mod. Every read is defensive: an unreadable
// subsystem degrades to 0 for that dimension, and cd-cpi drops any dimension that is 0 across all civs.
//
// Dimensions (raw, un-normalized; cd-cpi turns them into shares vs the strongest civ):
//   legacy    - wonders built + great works displayed (cultural stock)
//   flow      - culture per turn
//   reach     - influence per turn + city-state suzerainties (soft power)
//   vitality  - happiness per turn + active golden age
//   prosperity- empire net yields (food+production+gold) + happiness (growth/wealth)
//   identity  - traditions slotted + age depth

import { NO_OWNER } from "/cultural-diffusion/ui/cd-plots.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";

/** @param {()=>*} fn @param {*} fallback @returns {*} */
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

/** Resolve a YieldTypes enum value by key (undefined when unavailable). */
function yEnum(key) {
  return safe(() => (typeof YieldTypes !== "undefined" ? YieldTypes[key] : undefined), undefined);
}

/** A civ-level net yield off Player.Stats (0 when unreadable). */
function civYield(player, key) {
  return safe(() => {
    const stats = player && player.Stats;
    if (!stats || typeof stats.getNetYield !== "function") return 0;
    const v = stats.getNetYield(yEnum(key));
    return typeof v === "number" && isFinite(v) ? v : 0;
  }, 0);
}

/** Sum wonders across a civ's cities (fallback when the Stats aggregate is unreadable). */
function wonderCountFromCities(player) {
  let sum = 0;
  const cities = player?.Cities?.getCities?.();
  if (Array.isArray(cities)) {
    for (const c of cities) sum += safe(() => c?.Constructibles?.getNumWonders?.() || 0, 0);
  }
  return sum;
}

/** Total wonders a civ has built (Player.Stats aggregate, else summed over cities). */
function wonderCount(player) {
  return safe(() => {
    const n = player?.Stats?.getNumWonders?.(false, false);
    if (typeof n === "number" && isFinite(n)) return n;
    return wonderCountFromCities(player);
  }, 0);
}

/** Great-work buildings displayed across a civ's cities (best-effort). */
function greatWorks(player) {
  return safe(() => {
    let sum = 0;
    const cities = player?.Cities?.getCities?.();
    if (Array.isArray(cities)) {
      for (const c of cities) {
        const gw = safe(() => c?.Constructibles?.getGreatWorkBuildings?.(), null);
        if (Array.isArray(gw)) sum += gw.length;
      }
    }
    return sum;
  }, 0);
}

/** Whether a civ is currently in a golden age / celebration. */
function inGoldenAge(player) {
  return safe(() => {
    const h = player && player.Happiness;
    if (!h) return false;
    if (typeof h.isInGoldenAge === "function") return !!h.isInGoldenAge();
    const t = typeof h.goldenAgeTurnsLeft === "number" ? h.goldenAgeTurnsLeft
      : typeof h.getGoldenAgeTurnsRemaining === "function" ? h.getGoldenAgeTurnsRemaining() : 0;
    return t > 0;
  }, false);
}

/** Count of city-states (minors) whose suzerain is `pid`. */
function suzerainties(pid, alive) {
  return safe(() => {
    let n = 0;
    for (const p of alive) {
      const isMinor = p && (p.isMinor === true || p.isMajor === false);
      if (!isMinor) continue;
      const suz = safe(() => p?.Influence?.getSuzerain?.(), null);
      if (typeof suz === "number" && suz === pid) n++;
    }
    return n;
  }, 0);
}

/** Number of traditions a civ currently has slotted (across whatever culture slots exist). */
function traditionsSlotted(player) {
  return safe(() => {
    const culture = player && player.Culture;
    if (!culture || typeof culture.getActiveTraditions !== "function") return 0;
    const slots = typeof CultureSlotTypes !== "undefined" ? CultureSlotTypes : null;
    const slotVals = slots
      ? [slots.POLICY_CULTURE_SLOT, slots.TRADITION_CULTURE_SLOT, slots.NORMAL_CULTURE_SLOT].filter((v) => v != null)
      : [];
    let n = 0;
    const seen = new Set();
    for (const slot of slotVals) {
      const arr = safe(() => culture.getActiveTraditions(slot), null);
      if (Array.isArray(arr)) for (const t of arr) { if (!seen.has(t)) { seen.add(t); n++; } }
    }
    return n;
  }, 0);
}

/** Ordinal age depth (antiquity 1 -> exploration 2 -> modern 3), via the hash-aware age reader. */
function ageDepth() {
  const key = currentAgeKey();
  if (key === "MODERN") return 3;
  if (key === "EXPLORATION") return 2;
  return 1;
}

/**
 * The eligible MAJOR-civ player id, or NO_OWNER when the player should be skipped (dead, minor,
 * idless, or absent from the alive-majors list).
 * @param {*} player Engine player.
 * @param {number[]|null} majorIds Alive-major id list (or null when unavailable).
 * @returns {number} Player id, or NO_OWNER.
 */
function majorPlayerId(player, majorIds) {
  if (!player || !player.isAlive) return NO_OWNER;
  if (player.isMinor === true || player.isMajor === false) return NO_OWNER;
  const pid = typeof player.id === "number" ? player.id : NO_OWNER;
  if (pid === NO_OWNER) return NO_OWNER;
  if (Array.isArray(majorIds) && !majorIds.includes(pid)) return NO_OWNER;
  return pid;
}

/**
 * Build the raw CPI dimension row for a single major civ.
 * @param {*} player Engine player.
 * @param {number} pid Player id.
 * @param {*[]} alive All alive players (for suzerainty scan).
 * @param {number} depth Ordinal age depth.
 * @returns {Record<string, number>} Raw dimension values.
 */
function civMetricRow(player, pid, alive, depth) {
  const culture = Math.max(0, civYield(player, "YIELD_CULTURE"));
  const influence = Math.max(0, civYield(player, "YIELD_DIPLOMACY"));
  const happiness = civYield(player, "YIELD_HAPPINESS");
  const food = civYield(player, "YIELD_FOOD");
  const production = civYield(player, "YIELD_PRODUCTION");
  const gold = civYield(player, "YIELD_GOLD");
  return {
    legacy: wonderCount(player) * 2 + greatWorks(player),
    flow: culture,
    reach: influence + suzerainties(pid, alive) * 3,
    vitality: Math.max(0, happiness) + (inGoldenAge(player) ? 5 : 0),
    prosperity: Math.max(0, food + production + gold) + Math.max(0, happiness),
    identity: traditionsSlotted(player) + depth
  };
}

/**
 * Gather raw CPI dimensions for every alive MAJOR civ. City-states are excluded (they do
 * not project diffusion pressure) but ARE scanned for suzerainty counts.
 * @returns {Map<number, Record<string, number>>} owner id -> raw dimension values.
 */
export function gatherCivMetrics() {
  return safe(() => {
    const alive = Players?.getAlive?.();
    if (!Array.isArray(alive)) return new Map();
    const majorIds = safe(() => Players?.getAliveMajorIds?.(), null);
    const depth = ageDepth();
    /** @type {Map<number, Record<string, number>>} */
    const out = new Map();
    for (const player of alive) {
      const pid = majorPlayerId(player, majorIds);
      if (pid === NO_OWNER) continue;
      out.set(pid, civMetricRow(player, pid, alive, depth));
    }
    return out;
  }, new Map());
}
