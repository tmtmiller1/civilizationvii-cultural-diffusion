// cd-ownership.js
//
// The ONE place that MUTATES plot ownership. Every flip is single-player-guarded
// and routed through the configured verb (docs/cultural-diffusion-spec.md 3.6):
//   - setOwnership - free cultural territory (default); the player earns yields by
//     developing the tile through normal population/building growth.
//   - purchasePlot - the integrated, city-attached path (spends gold); optional.
// Isolating the writes here keeps the pass readable and makes the safety guard
// impossible to bypass.

import { isMultiplayer } from "/cultural-diffusion/ui/cd-plots.js";
import { log } from "/cultural-diffusion/ui/cd-log.js";

/**
 * @param {()=>*} fn Thunk. @param {*} fallback Fallback. @returns {*} fn() or fallback.
 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * Single-player guard for every mutation. WorldBuilder / local-player ownership
 * writes are not safe in multiplayer.
 * @returns {boolean} True when it is safe to mutate.
 */
export function guardSP() {
  return !isMultiplayer();
}

/**
 * Flip a plot to a player via WorldBuilder.MapPlots.setOwnership (free territory).
 * @param {number} playerId New owner.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {{ok:boolean, reason:string}} Result.
 */
export function flipViaSetOwnership(playerId, loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    if (typeof WorldBuilder === "undefined" || typeof WorldBuilder.MapPlots?.setOwnership !== "function") {
      return { ok: false, reason: "no-api" };
    }
    WorldBuilder.MapPlots.setOwnership(playerId, loc);
    return { ok: true, reason: "setOwnership" };
  }, { ok: false, reason: "throw" });
}

/**
 * Flip a plot to a city via city.purchasePlot (integrated, spends gold).
 * @param {*} cityOrId City object or id.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {{ok:boolean, reason:string}} Result.
 */
export function flipViaPurchasePlot(cityOrId, loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const city = cityOrId && typeof cityOrId.purchasePlot === "function"
      ? cityOrId
      : safe(() => Cities?.get?.(cityOrId), null);
    if (!city || typeof city.purchasePlot !== "function") return { ok: false, reason: "no-api" };
    city.purchasePlot(loc);
    return { ok: true, reason: "purchasePlot" };
  }, { ok: false, reason: "throw" });
}

/**
 * Return a plot to nobody (un-claim). Used to release a soft claim.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {{ok:boolean, reason:string}} Result.
 */
export function unclaim(loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const NO_PLAYER = typeof PlayerIds !== "undefined" && PlayerIds.NO_PLAYER != null ? PlayerIds.NO_PLAYER : -1;
    if (typeof WorldBuilder?.MapPlots?.setOwnership !== "function") return { ok: false, reason: "no-api" };
    WorldBuilder.MapPlots.setOwnership(NO_PLAYER, loc);
    return { ok: true, reason: "unclaim" };
  }, { ok: false, reason: "throw" });
}

/**
 * Perform a diffusion flip using the configured verb, with a setOwnership fallback
 * if purchasePlot is unavailable. Logs the outcome.
 * @param {Object} args Flip arguments.
 * @param {number} args.playerId New owner.
 * @param {*} args.city Nearest owned city of the new owner (for purchasePlot).
 * @param {{x:number,y:number}} args.loc Plot.
 * @param {string} args.verb "setOwnership" | "purchasePlot".
 * @returns {{ok:boolean, reason:string, verb:string}} Result.
 */
export function performFlip({ playerId, city, loc, verb }) {
  if (verb === "purchasePlot" && city) {
    const r = flipViaPurchasePlot(city, loc);
    if (r.ok) return { ...r, verb: "purchasePlot" };
    // Fall back to the free verb if the gold path fails (no gold / no API).
  }
  const r = flipViaSetOwnership(playerId, loc);
  return { ...r, verb: "setOwnership" };
}

export { log };
