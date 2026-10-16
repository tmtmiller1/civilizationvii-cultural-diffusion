// cd-reparent.js
//
// Moves a tile stuck on a settlement that can't work it to another settlement of the same civilization that can, for
// you and for every AI major civilization (never a city-state or an independent). A settlement works only
// tiles within 3 of its centre, and a tile attached to a settlement can't be expanded onto by another one (watched
// 2026-10-16: a town 2 from such a tile had it missing from its EXPAND list, and a direct EXPAND placed nothing). So
// a tile attached to a settlement more than baseGrowthRadius away, while another of yours is within it, is dead land
// until it's re-bought by the near one, which moves it (watched 2026-10-16, engine-closed.md). 1.0.6 left inner
// tiles like this, and a frontier claim does it today when a settlement is founded beside it; an AI's culture claims
// get stuck the same way. The scan reads each settlement's own plots, not the mod's claim records, so it also finds
// tiles the records lost.
//
// A tile only ever moves between two settlements of its own owner, so the core-protection rules (which guard one
// player's core from another) have nothing to check here.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { moveBetweenOwnSettlements } from "/cultural-diffusion/ui/cd-ownership.js";
import { districtTransferPaused } from "/cultural-diffusion/ui/cd-age-guard.js";
import { pendingClaimKeys } from "/cultural-diffusion/ui/cd-pending.js";
import { allSettlements, cityIdOf, cityLoc } from "/cultural-diffusion/ui/cd-plots.js";

/** @param {()=>*} fn Thunk. @param {*} fallback @returns {*} fn() or fallback. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * The settlement within `radius` of a plot that should take it: the nearest, then the lowest id, so the choice never
 * changes between passes.
 * @param {{x:number,y:number}} loc Plot.
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities Your settlements.
 * @param {*} from The settlement the tile is attached to (never chosen).
 * @param {number} radius Workable range.
 * @returns {{city:*, id:number, loc:{x:number,y:number}}|null} The settlement, or null when none is in range.
 */
function takerFor(loc, cities, from, radius) {
  let best = null;
  let bestD = Infinity;
  for (const c of cities) {
    if (c === from) continue;
    const d = hexDistance(c.loc, loc);
    if (d > radius) continue;
    if (d < bestD || (d === bestD && c.id < best.id)) { best = c; bestD = d; }
  }
  return best;
}

/**
 * Your tiles attached to a settlement farther than `radius` while another of yours is within it.
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities Your settlements.
 * @param {number} radius Workable range (baseGrowthRadius).
 * @returns {{loc:{x:number,y:number}, from:*, to:*}[]} Stuck tiles and where each goes.
 */
export function stuckTiles(cities, radius) {
  const out = [];
  for (const c of cities) {
    for (const i of safe(() => c.city.getPurchasedPlots() || [], [])) {
      const loc = safe(() => GameplayMap.getLocationFromIndex(i), null);
      if (!loc || hexDistance(c.loc, loc) <= radius) continue;
      const to = takerFor(loc, cities, c, radius);
      if (to) out.push({ loc: { x: loc.x, y: loc.y }, from: c, to });
    }
  }
  return out;
}

/**
 * One pass of the heal: move each stuck tile to the settlement that can work it, up to maxFlipsPerTurn. Tiles of a
 * settlement about to change hands whole, tiles with a claim in flight, and district tiles inside an age-transition
 * window wait. A move that doesn't land is found again next pass.
 * @param {*} state Persisted state (read only: pending claims).
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities The owner's settlements.
 * @param {number} me The owner whose tiles move.
 * @param {Set<string>} busy Plot keys of settlements that may flip this pass.
 * @returns {number} Moves sent this pass.
 */
export function reparentStuck(state, cities, me, busy) {
  const cap = Math.max(0, CONFIG.maxFlipsPerTurn);
  const radius = Math.max(1, Math.floor(CONFIG.baseGrowthRadius));
  const pending = pendingClaimKeys(state, me);
  let moved = 0;
  for (const s of stuckTiles(cities, radius)) {
    if (moved >= cap) break;
    const k = `${s.loc.x},${s.loc.y}`;
    if ((busy && busy.has(k)) || pending.has(k) || districtTransferPaused(s.loc, me)) continue;
    const res = moveBetweenOwnSettlements({ playerId: me, city: s.to.city, loc: s.loc, refund: CONFIG.refundGold });
    if (!res.ok) continue;
    moved++;
    dlog(`reparent ${k}: settlement ${s.from.id} -> ${s.to.id} (${res.reason})`);
  }
  return moved;
}

/**
 * The heal for every living major civilization, each with its own cap and its own claims in flight, so no one
 * civilization's backlog holds up another's. City-states and independents are left out (allSettlements(false)).
 * @param {*} state Persisted state (read only: pending claims).
 * @param {Set<string>} busy Plot keys of settlements that may flip this pass.
 * @returns {number} Moves sent this pass, all civilizations together.
 */
export function reparentAll(state, busy) {
  /** @type {Map<number, {city:*, id:number, loc:{x:number,y:number}}[]>} */
  const byOwner = new Map();
  for (const { city, owner } of allSettlements(false)) {
    const loc = cityLoc(city);
    if (!loc || owner < 0) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push({ city, id: cityIdOf(city), loc });
  }
  let moved = 0;
  for (const [owner, cities] of byOwner) moved += reparentStuck(state, cities, owner, busy);
  return moved;
}
