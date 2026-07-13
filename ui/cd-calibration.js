// cd-calibration.js
//
// Calibrates the field's per-turn pace to the GAME SETTINGS (docs/cultural-diffusion-spec.md
// 3d) - the Civ V mod's SetDiffusionFactorFromGameSetting, redone for Civ VII's structure.
//
// Civ VII differs from Civ V: instead of one continuous ~500-turn game, it plays THREE discrete
// ages, and `Game.maxTurns` is the CURRENT AGE's turn budget (the radial menu shows
// `Game.turn / Game.maxTurns` as age progress). That budget varies by game speed
// (Standard ~80-120, Marathon ~280-320, Quick ~41-92 per age). So:
//
//   - AGE PACE - scale the per-turn field advance (diffusion + decay + injection) by
//     `referenceTurns / Game.maxTurns`, so the border arc spans THIS age consistently no matter
//     the speed (on Marathon it advances slower per turn; on Quick, faster) - same reach extent,
//     just re-timed. (Scaling all three uniformly leaves the diffusion/decay equilibrium - and
//     thus the reach extent - unchanged; only the speed of approach changes.)
//   - MAP SIZE - a per-city culture field's reach is map-independent (unlike Civ V's whole-map
//     sweep), so the diffusion RATE is NOT scaled by map size. Instead injection is nudged mildly
//     by `GameInfo.Maps` size so a cramped Tiny map isn't steamrolled and a Huge map still grows.
//
// Reads confirmed against base-standard (maps/map-utilities.js, core/ui/save-load, radial-menu).
// Fully defensive: unreadable settings -> neutral 1 (Standard-tuned behaviour).

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

/** @param {()=>*} fn @param {*} fallback @returns {*} */
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

/** Read the current age's turn budget, or 0 when unreadable. */
function readMaxTurns() {
  const maxTurns = typeof Game !== "undefined" ? Game.maxTurns : 0;
  return typeof maxTurns === "number" && maxTurns > 0 ? maxTurns : 0;
}

/**
 * Progress through the CURRENT age in [0,1] - the same `Game.turn / Game.maxTurns` the radial menu
 * shows as age progress. 0 when unreadable (treated as the start of the age).
 * @returns {number} Age-progress fraction.
 */
export function ageProgress() {
  return safe(() => {
    const maxTurns = readMaxTurns();
    if (!maxTurns) return 0;
    const turn = typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : 0;
    return Math.min(1, Math.max(0, turn / maxTurns));
  }, 0);
}

/**
 * The per-turn pace multiplier from the current age's length (game speed). `< 1` on long-age
 * speeds (Marathon) slows the field so borders don't finish growing in the first fraction of
 * the age; `> 1` on short ages (Quick) speeds it up. Clamped; 1 when unreadable/disabled.
 * @returns {number} Pace multiplier.
 */
export function agePace() {
  if (!CONFIG.calibrateToGameSettings) return 1;
  return safe(() => {
    const maxTurns = readMaxTurns();
    if (!maxTurns) return 1;
    const ref = Math.max(1, CONFIG.paceReferenceTurns || 90);
    const bounds = Array.isArray(CONFIG.paceBounds) ? CONFIG.paceBounds : [0.25, 3];
    const k = ref / maxTurns;
    return Math.min(bounds[1], Math.max(bounds[0], k));
  }, 1);
}

/** The map-size type string read from the live Configuration, or "" when unreadable. */
function mapSizeTypeFromConfig() {
  const name = Configuration?.getMap?.()?.mapSizeTypeName;
  return typeof name === "string" && name ? name : "";
}

/** The map-size type string read from the GameInfo.Maps lookup, or "" when unreadable. */
function mapSizeTypeFromGameInfo() {
  const t = GameInfo?.Maps?.lookup?.(GameplayMap?.getMapSize?.())?.MapSizeType;
  return typeof t === "string" ? t : "";
}

/** The current map's `MAPSIZE_*` type string, or null. */
function mapSizeType() {
  return safe(() => {
    const fromConfig = mapSizeTypeFromConfig();
    if (fromConfig) return fromConfig;
    return mapSizeTypeFromGameInfo() || null;
  }, null);
}

/**
 * A mild injection multiplier from map size: smaller maps damp (don't steamroll cramped land),
 * larger maps grow a touch more. 1 when unreadable/disabled or the size isn't in the table.
 * @returns {number} Injection multiplier.
 */
export function mapSizeScale() {
  if (!CONFIG.calibrateToGameSettings) return 1;
  const table = CONFIG.mapSizeScale || {};
  const name = mapSizeType();
  const v = name ? table[name] : null;
  return typeof v === "number" && v > 0 ? v : 1;
}
