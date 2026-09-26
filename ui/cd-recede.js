// cd-recede.js
//
// Borders RECEDE (opt-in, CONFIG.recedeBorders). Once per pass, after the flips, it walks only the tiles this mod
// CLAIMED (state.claims) and CEDES a claim to a rival whose culture beat ours past resolveOwner's gates, via that
// rival's nearest city's refunded purchasePlot; peace, flipMaxDistance, requireAdjacency, the cooldown lock and
// maxFlipsPerTurn all apply. Cession is the ONLY way a claimed tile leaves (setOwnership(NO_PLAYER) never un-owns a
// city-attached tile; see docs/wont-build-with-justifications.md); an unlanded cession is confirmed next pass.
// Free of any import from cd-pass.js: a UIScript module cycle can take down the whole graph in GameFace.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";
import { allSettlements, cityLoc, cityIdOf, ownerAt, plotsInRadius } from "/cultural-diffusion/ui/cd-plots.js";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { resolveOwner, passCanAct } from "/cultural-diffusion/ui/cd-field.js";
import { atWar } from "/cultural-diffusion/ui/cd-borders.js";
import { performFlip } from "/cultural-diffusion/ui/cd-ownership.js";
import { markPending, isPending } from "/cultural-diffusion/ui/cd-pending.js";

/** @param {string} k Plot key. @returns {{x:number,y:number}} Location. */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/**
 * @param {{x:number,y:number}} loc Plot. @param {{loc:{x:number,y:number}}[]} rows City rows.
 * @returns {*} The nearest row with its distance `d`, or null.
 */
function nearest(loc, rows) {
  let best = null;
  let bestD = Infinity;
  for (const r of rows) {
    const d = hexDistance(r.loc, loc);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? { ...best, d: bestD } : null;
}

/** @returns {boolean} True when any neighbor of the plot is owned by `owner`. */
function touchesOwner(loc, owner) {
  for (const n of plotsInRadius(loc, 1)) {
    if (n.x === loc.x && n.y === loc.y) continue;
    if (ownerAt(n) === owner) return true;
  }
  return false;
}

/** Rival MAJOR settlements as {city, id, loc, owner} rows. City-states never take tiles. */
function rivalCityRows(me) {
  const out = [];
  for (const { city, owner } of allSettlements(false)) {
    if (owner === me) continue;
    const loc = cityLoc(city);
    if (loc) out.push({ city, id: cityIdOf(city), loc, owner });
  }
  return out;
}

/**
 * Cede one claimed tile to the rival whose culture decisively won it. The rival city's purchasePlot lands after the
 * call, so an unlanded write is recorded as pending and confirmed next pass.
 * @returns {"ceded"|"pending"|null} ceded now, sent and awaiting confirmation, or not attempted/failed.
 */
function cedeToRival(state, k, loc, rival, ctx) {
  const { rivals, me } = ctx;
  if (atWar(me, rival)) return null;
  const near = nearest(loc, rivals.filter((c) => c.owner === rival));
  if (!near || near.d > Math.max(1, CONFIG.flipMaxDistance)) return null;
  if (CONFIG.requireAdjacency && !touchesOwner(loc, rival)) return null;
  const res = performFlip({ playerId: rival, city: near.city, loc, verb: "purchasePlot", refund: CONFIG.refundGold });
  if (!res.ok) {
    dlog(`recede ${k}: cede to player ${rival} NOT APPLIED reason=${res.reason || "call-failed"}`);
    return null;
  }
  if (ownerAt(loc) !== rival) {
    markPending(state, k, { kind: "cede", by: rival });
    dlog(`recede ${k}: cede to player ${rival} sent; pending confirmation next pass`);
    return "pending";
  }
  delete state.claims[k];
  state.locked[k] = Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
  dlog(`recede ${k}: ceded to player ${rival} city ${near.id}`);
  return "ceded";
}

/** Decide one claimed tile: cede it when a rival's culture has decisively won it; otherwise it stays ours. */
function recedeOne(state, k, row, ctx) {
  const { me, ageCfg, deadOwners } = ctx;
  const loc = unkey(k);
  if (ownerAt(loc) !== me) return null;
  const verdict = resolveOwner(row, me, deadOwners, ageCfg);
  const cede = verdict.flip && passCanAct(verdict.owner, me, me, true, CONFIG.recedeBorders);
  return cede ? cedeToRival(state, k, loc, verdict.owner, ctx) : null;
}

/** @returns {boolean} Whether a claim is ours, in this pass's region, and free to recede (not locked or landing). */
function recedeEligible(state, k, me, region) {
  const c = state.claims[k];
  if (!c || c.by !== me || !region.has(k)) return false;
  return !(state.locked[k] > 0) && !isPending(state, k);
}

/**
 * Run the recede step over this pass's field.
 * @param {{state:*, region:Set<string>, next:*, me:number, ageCfg:*, deadOwners:number[]}} p Pass state.
 * @returns {{ceded:number, pending:number}} Claims ceded this pass, and cessions sent but not yet landed.
 */
export function recedeOwnership({ state, region, next, me, ageCfg, deadOwners }) {
  if (!CONFIG.recedeBorders) return { ceded: 0, pending: 0 };
  const cap = Math.max(0, CONFIG.maxFlipsPerTurn);
  const ctx = { me, ageCfg, deadOwners, rivals: rivalCityRows(me) };
  const out = { ceded: 0, pending: 0 };
  for (const k of Object.keys(state.claims)) {
    if (out.ceded + out.pending >= cap) break;
    if (!recedeEligible(state, k, me, region)) continue;
    const result = recedeOne(state, k, next[k] || {}, ctx);
    if (result) out[result]++;
  }
  return out;
}
