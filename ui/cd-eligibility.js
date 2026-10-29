// cd-eligibility.js
//
// The one answer to "may the pass claim this plot right now?", asked by the pass, the Cultural Pressure
// lens and the hover readout alike.
//
// This exists for the same reason `passCanAct` does (docs/current-model.md §5): what the map shows and what
// the pass does cannot drift if they ask the same question. `passCanAct` only ever covered "whose culture
// leads and can the pass move this tile at all"; every other gate lived privately inside the pass, so the
// lens happily tinted, and the tooltip counted down turns on, tiles the pass would never take: a rival's
// protected core, a war front, a tile beyond `flipMaxDistance`, a tile still on cooldown. Adding the minor
// settlement floor made that worse, because a city-state's ring-1 would have shown capture progress that
// never resolves.
//
// Order matters: the cheap map reads come first and the unit read last, exactly as in the pass, so the
// expensive check only runs for a tile that has already won everything else.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import {
  plotsInRadius, ownerAt, isDistantLands, isWater, isImpassable, cityLoc, cityIdOf, allSettlements
} from "/cultural-diffusion/ui/cd-plots.js";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { terrainCap, isMountainAt } from "/cultural-diffusion/ui/cd-terrain.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { rivalClaimAllowed } from "/cultural-diffusion/ui/cd-borders.js";
import { wouldStrandForeignUnit } from "/cultural-diffusion/ui/cd-units.js";
import { isPending } from "/cultural-diffusion/ui/cd-pending.js";
import { districtTransferPaused } from "/cultural-diffusion/ui/cd-age-guard.js";
import { plotInventory, flipRefusedFor } from "/cultural-diffusion/ui/cd-teardown.js";

/** @param {number} x @param {number} y @returns {string} Plot key. */
function key(x, y) {
  return `${x},${y}`;
}

/**
 * A player's cities as {city, id, loc}. The claim gates are written in terms of a claimant `me`; with AI flips
 * the claimant is whichever major leads the tile, so the same list is built for that player.
 * @param {number} pid Player id.
 * @returns {{city:*, id:number, loc:{x:number,y:number}}[]} Cities.
 */
export function cityListOf(pid) {
  const out = [];
  for (const { city, owner } of allSettlements(false)) {
    if (owner !== pid) continue;
    const loc = cityLoc(city);
    if (loc) out.push({ city, id: cityIdOf(city), loc });
  }
  return out;
}

/**
 * The local player's own cities as {city, id, loc}.
 * @param {number} me Local player id.
 * @returns {{city:*, id:number, loc:{x:number,y:number}}[]} Cities.
 */
export function localCityList(me) {
  return cityListOf(me);
}

/**
 * The nearest local city to a plot (for attachment + distance checks).
 * @param {{x:number,y:number}} plot Plot.
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities Local cities.
 * @returns {{city:*, id:number, loc:{x:number,y:number}, d:number}|null} Nearest city + distance.
 */
export function nearestCity(plot, cities) {
  let best = null;
  let bestD = Infinity;
  for (const c of cities) {
    const d = hexDistance(c.loc, plot);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { ...best, d: bestD } : null;
}

/**
 * True when a plot lies within any local city's base-game growth ring, which the base game owns and assigns
 * to the city that can work it. The mod only ever claims beyond them.
 * @param {{x:number,y:number}} loc Plot.
 * @param {{loc:{x:number,y:number}}[]} cities Local cities.
 * @returns {boolean} True when the base game, not the mod, should own this tile.
 */
export function withinOwnNaturalRing(loc, cities) {
  const r = Math.max(1, Math.floor(CONFIG.baseGrowthRadius));
  for (const c of cities) if (hexDistance(c.loc, loc) <= r) return true;
  return false;
}

/**
 * True when the base game, not the mod, should hand out this plot: an unowned tile inside the growth rings of two or
 * more of the claimant's settlements. Only the base game knows which of them should have it; buying it for the nearest
 * once locked a city out of its own ring (1.0.7). Everywhere else inside the rings culture claims as it does outside:
 * one settlement's ring has only one place to go, and the base game never takes a tile back from another owner.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} owner Current owner (-1 = unowned).
 * @param {{loc:{x:number,y:number}}[]} cities The claimant's cities.
 * @returns {boolean} True when the mod leaves this tile alone.
 */
export function leftToBaseGame(loc, owner, cities) {
  if (owner >= 0) return false;
  const r = Math.max(1, Math.floor(CONFIG.baseGrowthRadius));
  let within = 0;
  for (const c of cities) if (hexDistance(c.loc, loc) <= r && ++within > 1) return true;
  return false;
}

/**
 * True when any neighbor of the plot is owned by `me` (Civ V IsAdjacentToOwner).
 * @param {{x:number,y:number}} plot Plot.
 * @param {number} me Local player id.
 * @returns {boolean} True when our land touches it.
 */
export function adjacentToMe(plot, me) {
  for (const n of plotsInRadius(plot, 1)) {
    if (n.x === plot.x && n.y === plot.y) continue;
    if (ownerAt(n) === me) return true;
  }
  return false;
}

/**
 * True when claiming this plot would leave a hole behind it. Only the inward neighbours are read: the one or two
 * that are closer to the claimant's nearest settlement, i.e. the tiles between this plot and the city. Each has to be
 * the claimant's already (or claimed this pass), or a tile culture won't ever fill (filledBehind), so borders fill in
 * as a growing blob instead of reaching out in arms with unclaimed tiles behind them.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Claimant id.
 * @param {{loc:{x:number,y:number}}[]} cities The claimant's cities.
 * @param {Set<string>|null} inFlight Plot keys already claimed this pass.
 * @param {*} cfg Live (age-adjusted) config.
 * @returns {boolean} True when an inward neighbour is still land culture could claim first.
 */
export function leavesGapBehind(loc, me, cities, inFlight, cfg) {
  const here = nearestCity(loc, cities);
  if (!here) return false;
  for (const n of plotsInRadius(loc, 1)) {
    if (n.x === loc.x && n.y === loc.y) continue;
    const inward = nearestCity(n, cities);
    if (inward && inward.d < here.d && !filledBehind(n, me, { cities, inFlight, cfg })) return true;
  }
  return false;
}

/**
 * Whether an inward neighbour counts as filled for leavesGapBehind. The claimant's own tile is, and so is every tile
 * culture won't fill, or fills only after the land behind it; otherwise one would hold back a widening wedge of land:
 * open water, an impassable tile (mountain, volcano, natural wonder), rough ground that lets in less culture than open
 * ground carries one ring further out (terrain cap under normalMax: marsh, rainforest, desert, mountain), an unowned
 * tile left to the base game, and another owner's tile the claim gates refuse (a city-state, a protected core, a war
 * front, an urban district or a center). Other unowned land, and another owner's land culture can still win, go first.
 * @param {{x:number,y:number}} n Inward neighbour.
 * @param {number} me Claimant id.
 * @param {{cities:*[], inFlight:Set<string>|null, cfg:*}} ctx Claimant's cities, this pass's claims, live config.
 * @returns {boolean} True when it isn't a gap.
 */
function filledBehind(n, me, ctx) {
  return terrainCap(n, ctx.cfg) < ctx.cfg.normalMax || nothingToClaim(n, me, ctx);
}

/**
 * Whether culture has nothing left to take on a plot: it's the claimant's or claimed this pass, open water, impassable,
 * an unowned tile left to the base game, or another owner's tile the claim gates refuse.
 * @param {{x:number,y:number}} n Plot.
 * @param {number} me Claimant id.
 * @param {{cities:*[], inFlight:Set<string>|null, cfg:*}} ctx Claimant's cities, this pass's claims, live config.
 * @returns {boolean} True when there's nothing to claim there.
 */
function nothingToClaim(n, me, ctx) {
  const owner = ownerAt(n);
  if (owner === me || (ctx.inFlight && ctx.inFlight.has(key(n.x, n.y)))) return true;
  if (isWater(n) || isImpassable(n)) return true;
  if (owner < 0) return leftToBaseGame(n, owner, ctx.cities);
  return !rivalClaimAllowed(n, owner, me, ctx.cfg) || !!flipRefusedFor(plotInventory(n));
}

/**
 * True when a mountain still has land around it that culture could claim first. A mountain goes after every
 * neighbouring tile within the claimant's reach (flipMaxDistance) that culture can still take, marsh and desert
 * included, so a range can end up as a hole in a border or split between two neighbours.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Claimant id.
 * @param {{loc:{x:number,y:number}}[]} cities The claimant's cities.
 * @param {Set<string>|null} inFlight Plot keys already claimed this pass.
 * @param {*} cfg Live (age-adjusted) config.
 * @returns {boolean} True when the mountain has to wait.
 */
export function mountainWaits(loc, me, cities, inFlight, cfg) {
  if (!isMountainAt(loc.x, loc.y)) return false;
  const reach = Math.max(1, cfg.flipMaxDistance);
  for (const n of plotsInRadius(loc, 1)) {
    if (n.x === loc.x && n.y === loc.y) continue;
    const near = nearestCity(n, cities);
    if (!near || near.d > reach) continue;
    if (!nothingToClaim(n, me, { cities, inFlight, cfg })) return true;
  }
  return false;
}

/**
 * True when claiming this plot is forbidden because it is in the local player's distant lands before the
 * Exploration age (the base game's own ocean gating).
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Local player id.
 * @returns {boolean} True when the plot is gated.
 */
export function distantLandsGated(loc, me) {
  if (!CONFIG.blockDistantLandsBeforeExploration) return false;
  if (currentAgeKey() !== "ANTIQUITY") return false; // Exploration+ may claim distant lands
  return isDistantLands(me, loc);
}

/**
 * Whether the plot is even in scope for a claim this turn: not already ours, not left to the base game
 * (leftToBaseGame), within `flipMaxDistance` of one of our cities, not on cooldown, and not awaiting a verb.
 * @param {{x:number,y:number}} loc Plot.
 * @param {{me:number, cities:*[], state:*, cfg:*}} ctx Pass/lens context.
 * @returns {boolean} True when the plot is a live candidate.
 */
export function claimInScope(loc, ctx) {
  const { me, cities, state, cfg } = ctx;
  const owner = ownerAt(loc);
  if (owner === me) return false;
  if (leftToBaseGame(loc, owner, cities)) return false;
  const near = nearestCity(loc, cities);
  if (!near || near.d > Math.max(1, cfg.flipMaxDistance)) return false;
  const k = key(loc.x, loc.y);
  if (state && state.locked && state.locked[k] > 0) return false;
  return !(state && isPending(state, k));
}

/**
 * Whether a plot our culture has won is nevertheless blocked from being claimed: distant lands, the owner's
 * protection (safety mode, war, core protection including the minor-settlement floor), adjacency, a gap it would
 * leave behind, a mountain with land still to take around it, or a foreign unit this claim would strand. The per-city
 * `maxDiffusionPlots` cap is the caller's, because only the pass tracks claims in flight per city.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} owner Current owner (-1 = unowned).
 * @param {number} me Local player id.
 * @param {*} cfg Live (age-adjusted) config.
 * @param {{inFlight?:Set<string>|null, cities?:*[]}|null} [around] Plot keys already claimed this pass, and the
 *   claimant's cities; without the cities the gap and mountain tests are skipped.
 * @returns {string|null} A short reason, or null when the claim may go ahead.
 */
export function claimGateBlocked(loc, owner, me, cfg, around) {
  if (distantLandsGated(loc, me)) return "distant-lands";
  if (owner >= 0 && !rivalClaimAllowed(loc, owner, me, cfg)) return "protected-or-at-war";
  // Culture moves rural land: an urban district, a city center or a wonder stays with its city. The same test
  // performFlip applies last, read here so the pass, the lens and the hover readout never offer such a tile.
  if (owner >= 0) {
    const refused = flipRefusedFor(plotInventory(loc));
    if (refused) return refused;
  }
  if (districtTransferPaused(loc, owner)) return "age-transition";
  const shape = shapeBlocked(loc, me, cfg, around);
  if (shape) return shape;
  if (wouldStrandForeignUnit(loc, me, around ? around.inFlight : null)) return "would-strand-a-unit";
  return null;
}

/**
 * The gates on the border's shape. With Contiguous border on, the tile touches the claimant's land and leaves no gap
 * behind it (leavesGapBehind). Always, a mountain waits for the land around it (mountainWaits).
 * @returns {string|null} A short reason, or null.
 */
function shapeBlocked(loc, me, cfg, around) {
  const cities = around && around.cities;
  const inFlight = (around && around.inFlight) || null;
  if (cfg.requireAdjacency) {
    if (!adjacentToMe(loc, me)) return "not-adjacent";
    if (cities && leavesGapBehind(loc, me, cities, inFlight, cfg)) return "gap-behind";
  }
  if (cities && mountainWaits(loc, me, cities, inFlight, cfg)) return "mountain-waits";
  return null;
}
