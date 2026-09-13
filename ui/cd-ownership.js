// cd-ownership.js
//
// The ONE place that MUTATES plot ownership. Every flip is single-player-guarded
// and routed through the configured verb (docs/current-model.md §4):
//   - purchasePlot - the INTEGRATED, city-attached path (default). Attaches the tile to the
//     nearest city so it becomes a real, workable city plot. Probe-proven to be effectively
//     free on contiguous frontier tiles; refundGold nets any cost to zero regardless.
//   - setOwnership - free but ORPHAN: the player owns the tile yet no city does, so it is not
//     workable/buildable AND it blocks the base game's own population/border growth from ever
//     acquiring that tile. Retained only for the "Free territory" option and for `unclaim`.
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
 * The player's current gold balance, or null when unreadable.
 * Accessor confirmed in game code + probe: Players.get(pid).Treasury.goldBalance.
 * @param {number} pid Player id.
 * @returns {number|null} Gold balance.
 */
export function playerGold(pid) {
  return safe(() => {
    const t = typeof Players !== "undefined" ? Players?.get?.(pid)?.Treasury : null;
    if (!t) return null;
    if (typeof t.goldBalance === "number") return t.goldBalance;
    if (typeof t.getGoldBalance === "function") return t.getGoldBalance();
    return null;
  }, null);
}

/**
 * Grant (amount>0) or deduct (amount<0) gold to a player - the WRITE twin of playerGold.
 * PREFERS Treasury.changeGoldBalance (a BALANCE-only poke) over Players.grantYield: grantYield
 * injects into the net-gold YIELD stat (would spike the demographics "Gold Per Turn" metric),
 * whereas changeGoldBalance only moves the balance. So the refund is invisible to both the
 * balance (nets zero) and the yield-rate metric. grantYield is only a last-resort fallback.
 * @param {number} pid Player id. @param {number} amount Gold delta.
 * @returns {{ok:boolean, reason:string}} Result.
 */
export function grantGold(pid, amount) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  if (!amount) return { ok: true, reason: "noop-zero" };
  return safe(() => writeGold(pid, amount), { ok: false, reason: "throw" });
}

/** @returns {*} The Players global, or null when absent. */
function playersApi() {
  return typeof Players !== "undefined" ? Players : null;
}

/** The write branch of grantGold: changeGoldBalance first, then grantYield. @returns {{ok:boolean, reason:string}} */
function writeGold(pid, amount) {
  const P = playersApi();
  const t = P?.get?.(pid)?.Treasury;
  if (typeof t?.changeGoldBalance === "function") {
    t.changeGoldBalance(amount);
    return { ok: true, reason: "changeGoldBalance" };
  }
  const yt = typeof YieldTypes !== "undefined" ? YieldTypes.YIELD_GOLD : null;
  if (yt != null && typeof P?.grantYield === "function") {
    P.grantYield(pid, yt, amount);
    return { ok: true, reason: "grantYield-fallback" };
  }
  return { ok: false, reason: "no-api" };
}

/**
 * purchasePlot with a same-tick gold refund, so an integrated claim nets zero gold. Measures the
 * balance around the buy and restores whatever was spent (proven net-free path, cd-probe-runner).
 * @param {number} playerId Player id (refund target).
 * @param {*} cityOrId Nearest owned city of the player.
 * @param {{x:number,y:number}} loc Plot.
 * @param {boolean} refund Whether to restore the spent gold.
 * @returns {{ok:boolean, reason:string, cost:number}} Result + gold spent (pre-refund).
 */
export function flipViaPurchasePlotRefunded(playerId, cityOrId, loc, refund) {
  const before = refund ? playerGold(playerId) : null;
  const r = flipViaPurchasePlot(cityOrId, loc);
  let cost = 0;
  if (refund && r.ok && before != null) {
    const after = playerGold(playerId);
    cost = (after != null) ? Math.max(0, before - after) : 0;
    if (cost > 0) grantGold(playerId, cost); // same-tick balance-only restore (no visible dip)
  }
  return { ...r, cost };
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
 * Perform a diffusion flip using the configured verb.
 *
 * For the default integrated verb (`purchasePlot`) there is deliberately NO setOwnership
 * fallback: falling back would re-introduce the orphan tile this design exists to avoid (owner
 * set but no owning city, unworkable AND blocking the base game's own border growth). A failed
 * purchase simply skips the tile this turn - the culture field keeps it and the pass retries.
 * @param {Object} args Flip arguments.
 * @param {number} args.playerId New owner.
 * @param {*} args.city Nearest owned city of the new owner (required for purchasePlot).
 * @param {{x:number,y:number}} args.loc Plot.
 * @param {string} args.verb "purchasePlot" | "setOwnership".
 * @param {boolean} [args.refund] Refund purchasePlot's gold cost the same tick (default true).
 * @returns {{ok:boolean, reason:string, verb:string, cost?:number}} Result.
 */
export function performFlip({ playerId, city, loc, verb, refund = true }) {
  if (verb === "setOwnership") {
    return { ...flipViaSetOwnership(playerId, loc), verb: "setOwnership" };
  }
  // Default: the integrated verb. No orphan-producing fallback (see above).
  if (!city) return { ok: false, reason: "no-city", verb: "purchasePlot" };
  return { ...flipViaPurchasePlotRefunded(playerId, city, loc, refund !== false), verb: "purchasePlot" };
}

export { log };
