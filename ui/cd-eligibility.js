// cd-eligibility.js
//
// The ONE answer to "may the pass claim this plot right now?", asked by the pass, the Cultural Pressure
// lens and the hover readout alike.
//
// This exists for the same reason `passCanAct` does (docs/current-model.md §5): what the map SHOWS and what
// the pass DOES cannot drift if they ask the same question. `passCanAct` only ever covered "whose culture
// leads and can the pass move this tile at all" - every other gate lived privately inside the pass, so the
// lens happily tinted, and the tooltip counted down turns on, tiles the pass would never take: a rival's
// protected core, a war front, a tile beyond `flipMaxDistance`, a tile still on cooldown. Adding the minor
// settlement floor made that worse, because a city-state's ring-1 would have shown capture progress that
// never resolves.
//
// Order matters: the cheap map reads come first and the UNIT read last, exactly as in the pass, so the
// expensive check only runs for a tile that has already won everything else.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { plotsInRadius, ownerAt, isDistantLands, cityLoc, cityIdOf, allSettlements } from "/cultural-diffusion/ui/cd-plots.js";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { rivalClaimAllowed } from "/cultural-diffusion/ui/cd-borders.js";
import { wouldStrandForeignUnit } from "/cultural-diffusion/ui/cd-units.js";
import { isPending } from "/cultural-diffusion/ui/cd-pending.js";

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
 * True when a plot lies within any LOCAL city's base-game growth ring, which the base game owns and assigns
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
 * True when claiming this plot is forbidden because it is in the local player's DISTANT LANDS before the
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
 * Whether the plot is even in scope for a claim this turn: not already ours, not inside our base-game
 * rings, within `flipMaxDistance` of one of our cities, not on cooldown, and not awaiting a verb.
 * @param {{x:number,y:number}} loc Plot.
 * @param {{me:number, cities:*[], state:*, cfg:*}} ctx Pass/lens context.
 * @returns {boolean} True when the plot is a live candidate.
 */
export function claimInScope(loc, ctx) {
  const { me, cities, state, cfg } = ctx;
  if (ownerAt(loc) === me) return false;
  if (withinOwnNaturalRing(loc, cities)) return false;
  const near = nearestCity(loc, cities);
  if (!near || near.d > Math.max(1, cfg.flipMaxDistance)) return false;
  const k = key(loc.x, loc.y);
  if (state && state.locked && state.locked[k] > 0) return false;
  return !(state && isPending(state, k));
}

/**
 * Whether a plot our culture has WON is nevertheless blocked from being claimed: distant lands, the owner's
 * protection (safety mode, war, core protection including the minor-settlement floor), adjacency, or a
 * foreign unit this claim would strand. The per-city `maxDiffusionPlots` cap is the caller's, because only
 * the pass tracks claims in flight per city.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} owner Current owner (-1 = unowned).
 * @param {number} me Local player id.
 * @param {*} cfg Live (age-adjusted) config.
 * @param {Set<string>|null} [inFlight] Plot keys already claimed this pass.
 * @returns {string|null} A short reason, or null when the claim may go ahead.
 */
export function claimGateBlocked(loc, owner, me, cfg, inFlight) {
  if (distantLandsGated(loc, me)) return "distant-lands";
  if (owner >= 0 && !rivalClaimAllowed(loc, owner, me, cfg)) return "protected-or-at-war";
  if (cfg.requireAdjacency && !adjacentToMe(loc, me)) return "not-adjacent";
  if (wouldStrandForeignUnit(loc, me, inFlight)) return "would-strand-a-unit";
  return null;
}
