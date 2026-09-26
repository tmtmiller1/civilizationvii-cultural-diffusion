// cd-conquest.js
//
// Unit CONQUEST (opt-in, CONFIG.conquestFlip; docs/civ-v-parity-spec.md §6, potential-future-features.md §2). During a
// war between two majors, a combat unit that holds an enemy tile for `conquestBufferTurns` consecutive passes takes
// it for its owner, ignoring culture. The buffer is what keeps armies marching through from flickering the border,
// which Civ V's instant flip caused; leaving the tile resets the count. City centers and urban districts are never
// taken this way, because capturing a city is the engine's job.
//
// The conquered tile is then HELD for `conquestHoldTurns` (the same lock map culture flips honor): culture cannot
// flip it back during the hold, but the sweep itself never looks at the lock, so another army that holds the tile
// through the buffer takes it at any time. After the hold the tile works the normal way.
//
// Runs LAST in the pass, after the culture flips and the recede step, so occupation is the final territorial word.
// The flip itself is the integrated verb (purchasePlot through the conqueror's nearest city), which lands after the
// call and is confirmed next pass like every other claim. For the LOCAL player's units this stands alone; for
// another civ's units it also requires aiCultureFlips, since that is the toggle that lets the mod move AI borders.
//
// Engine reads (all watched 2026-09-25): MapUnits.getUnits(x, y) -> array-LIKE ComponentID list (iterate),
// Units.get(cid).owner, Units.get(cid).Combat.isCombat (scouts and commanders read true, civilians false),
// Players.get(pid).Diplomacy.isAtWarWith - restricted to majors because every Independent Power reads at war.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";
import {
  ownerAt, plotsInRadius, districtTypeNameAt, isCityCenterAt, allSettlements, cityLoc, cityIdOf
} from "/cultural-diffusion/ui/cd-plots.js";
import { atWar, isMajorPlayer } from "/cultural-diffusion/ui/cd-borders.js";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { performFlip } from "/cultural-diffusion/ui/cd-ownership.js";
import { markPending, isPending } from "/cultural-diffusion/ui/cd-pending.js";
import { notifyFlip } from "/cultural-diffusion/ui/cd-notifications.js";

/** @param {()=>*} fn Thunk. @param {*} fallback Fallback. @returns {*} fn() or fallback. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {string} k Plot key. @returns {{x:number,y:number}} Location. */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/**
 * The owners (majors, at war with the tile's owner) of the COMBAT units standing on a plot. Civilians never
 * conquer; a unit whose owner is not a major, or not at war with the owner, is not an occupier.
 * @param {{x:number,y:number}} loc Plot. @param {number} owner The plot's owner.
 * @returns {number[]} Distinct occupier player ids.
 */
export function hostileCombatOccupants(loc, owner) {
  const ids = safe(() => MapUnits?.getUnits?.(loc.x, loc.y), null);
  if (!ids) return [];
  return safe(() => {
    /** @type {number[]} */
    const out = [];
    for (const cid of ids) {
      const unit = safe(() => Units?.get?.(cid), null);
      const u = unit && typeof unit.owner === "number" ? unit.owner : -1;
      if (u < 0 || u === owner || out.indexOf(u) >= 0) continue;
      if (safe(() => unit.Combat?.isCombat, false) !== true) continue;
      if (!isMajorPlayer(u) || !atWar(u, owner)) continue;
      out.push(u);
    }
    return out;
  }, []);
}

/**
 * Whether a tile may change hands by conquest at all: owned by a living major, and neither a settlement center nor
 * an urban district (rural improvements and wilderness are fine).
 * @param {{x:number,y:number}} loc Plot. @param {number} owner The plot's owner.
 * @returns {boolean} True when conquest may apply.
 */
export function conquerable(loc, owner) {
  if (owner < 0 || !isMajorPlayer(owner)) return false;
  if (isCityCenterAt(loc)) return false;
  const d = districtTypeNameAt(loc);
  return !d || /RURAL|WILDERNESS/.test(d);
}

/**
 * PURE: advance one tile's occupation counter. A continuous hold by the same occupier counts up; a different
 * occupier, or none, restarts or clears it.
 * @param {Record<string, {by:number, turns:number}>} occupation state.occupation (mutated).
 * @param {string} k Plot key.
 * @param {number[]} occupants Occupier ids this pass.
 * @param {number} buffer Passes a hold must last before it flips.
 * @returns {number} The occupier whose hold has reached the buffer, or -1.
 */
export function tickOccupation(occupation, k, occupants, buffer) {
  if (!occupants.length) {
    delete occupation[k];
    return -1;
  }
  const cur = occupation[k];
  const by = cur && occupants.indexOf(cur.by) >= 0 ? cur.by : occupants[0];
  const turns = cur && cur.by === by ? cur.turns + 1 : 1;
  occupation[k] = { by, turns };
  return turns >= Math.max(0, buffer) ? by : -1;
}

/** @returns {boolean} Whether any neighbor of the plot is owned by `pid`. */
function touches(loc, pid) {
  for (const n of plotsInRadius(loc, 1)) {
    if (n.x === loc.x && n.y === loc.y) continue;
    if (ownerAt(n) === pid) return true;
  }
  return false;
}

/** The conqueror's nearest city, as {city, id, d}, or null. */
function nearestCityOf(loc, pid) {
  let best = null;
  let bestD = Infinity;
  for (const { city, owner } of allSettlements(false)) {
    if (owner !== pid) continue;
    const cl = cityLoc(city);
    if (!cl) continue;
    const d = hexDistance(cl, loc);
    if (d < bestD) { bestD = d; best = { city, id: cityIdOf(city), d }; }
  }
  return best;
}

/**
 * Take one tile for its occupier through the integrated verb; book it, or leave it pending until the map shows it.
 * @returns {"flipped"|"pending"|null} What happened.
 */
function conquer(state, k, loc, owner, winner) {
  const near = nearestCityOf(loc, winner);
  if (!near) return null;
  const res = performFlip({ playerId: winner, city: near.city, loc, verb: "purchasePlot", refund: CONFIG.refundGold });
  if (!res.ok) {
    dlog(`conquest ${k}: flip to player ${winner} NOT APPLIED reason=${res.reason || "call-failed"}`);
    return null;
  }
  delete state.occupation[k];
  const hold = Math.max(0, Math.floor(CONFIG.conquestHoldTurns));
  if (ownerAt(loc) !== winner) {
    markPending(state, k, { kind: "claim", by: winner, city: near.id, was: owner, hold });
    dlog(`conquest ${k}: taken from player ${owner} by player ${winner}'s unit; pending confirmation next pass`);
    return "pending";
  }
  state.claims[k] = { by: winner, city: near.id, turn: state.monoTurn };
  state.locked[k] = hold;
  dlog(`conquest ${k}: taken from player ${owner} by player ${winner}'s unit; held against culture for ${hold} turns`);
  notifyFlip({ x: loc.x, y: loc.y, wasOwner: owner, newOwner: winner });
  return "flipped";
}

/**
 * One region tile of the sweep: keep or clear its counter, and flip it when a hold has lasted the buffer and the
 * remaining gates pass (safety mode off, the conqueror's land touching the tile when adjacency is required).
 * @returns {"flipped"|"pending"|"held"|null} What happened on this tile.
 */
function sweepTile(k, ctx) {
  const { state, me, buffer, out } = ctx;
  const loc = unkey(k);
  const owner = ownerAt(loc);
  if (!conquerable(loc, owner)) {
    delete state.occupation[k];
    return null;
  }
  if (isPending(state, k)) return null;
  const occupants = hostileCombatOccupants(loc, owner).filter((u) => u === me || CONFIG.aiCultureFlips);
  const winner = tickOccupation(state.occupation, k, occupants, buffer);
  if (winner < 0) return state.occupation[k] ? "held" : null;
  if (out.flips + out.pending >= Math.max(0, CONFIG.maxFlipsPerTurn)) return "held";
  if (CONFIG.claimOnlyUnowned) return "held";                                  // safety mode: owned land never flips
  if (CONFIG.requireAdjacency && !touches(loc, winner)) return "held";         // Civ V: adjacent to the unit owner's land
  return conquer(state, k, loc, owner, winner);
}

/**
 * The conquest sweep over this pass's region: advance every occupation counter and flip the tiles whose hold has
 * lasted the buffer. Counters for tiles outside the region are dropped.
 * @param {{state:*, region:Set<string>, me:number}} p Pass state.
 * @returns {{flips:number, pending:number, held:number}} Tiles taken now, sent and awaiting the map, still counting.
 */
export function conquestSweep({ state, region, me }) {
  const out = { flips: 0, pending: 0, held: 0 };
  if (!CONFIG.conquestFlip) return out;
  if (!state.occupation) state.occupation = {};
  for (const k of Object.keys(state.occupation)) if (!region.has(k)) delete state.occupation[k];
  const ctx = { state, me, buffer: Math.max(0, Math.floor(CONFIG.conquestBufferTurns)), out };
  for (const k of region) {
    const r = sweepTile(k, ctx);
    if (r === "flipped") out.flips++;
    else if (r === "pending") out.pending++;
    else if (r === "held") out.held++;
  }
  return out;
}
