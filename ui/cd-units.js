// cd-units.js
//
// The one thing the mod can do about a foreign unit in the path of an expanding border: not close the
// last way out. Civ VII's trespass rule leaves a peaceful civ's unit with no legal move once every
// neighboring plot is ours, until a war declaration ejects it; our own claims once froze a peaceful
// major's Scout on one plot for five turns that way. Moving the unit instead is engine-closed (no unit
// operation moves a unit we do not own, and UNITOPERATION_TELEPORT_TO is absent from the runtime enum;
// see civilization_vii_mods/engine-closed.md), so the only lever is the claim itself.
//
// The rules:
//   - only units of players we are at peace with can be stranded; Independent Powers and anyone at war
//     move through our territory freely, so refusing a claim on their account would cost tiles for nothing
//   - the test is immobility, not confinement: a unit that can still step somewhere legal is fine even
//     inside a small pocket; the symptom is a unit with no legal destination at all
//   - refuse only when we take the last legal destination; a unit already immobile before this claim was
//     not immobilised by it
//   - what blocks a unit depends on its element: a land unit ashore is stopped by water, a ship by land,
//     and an embarked land unit (DOMAIN_LAND standing on water) may use both; the pass can own water, so
//     treating water as blocked for everyone made every ship read as already immobile and never protected.
//     Impassable terrain blocks every element, and `GameplayMap.isImpassable` covers impassable features
//     (volcano, ice, natural wonders) as well as mountains
//   - in-flight claims count as ours: `purchasePlot` lands seconds after the call (cd-pending.js), so the
//     caller passes the keys of claims already sent this pass and they are treated as our territory
//
// Engine reads: MapUnits.getUnits(x, y) -> ComponentID[]; Units.get(cid).owner -> player id. They fail
// open (no unit seen), because a throw here would stall the whole pass, and failing open only restores
// the pre-guard behavior.

import { plotsInRadius, ownerAt, isWater, isImpassable } from "/cultural-diffusion/ui/cd-plots.js";
import { atWar } from "/cultural-diffusion/ui/cd-borders.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

/**
 * @param {()=>*} fn Thunk.
 * @param {*} fallback
 * @returns {*} fn() or fallback on throw.
 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {{x:number,y:number}} loc Plot. @returns {string} "x,y" key. */
function key(loc) {
  return `${loc.x},${loc.y}`;
}

/**
 * The six neighbors of a plot, with the plot itself removed (the engine's radius-1 query includes
 * the center).
 * @param {{x:number,y:number}} loc Center plot.
 * @returns {{x:number,y:number}[]} Neighbor plots.
 */
export function neighborsOf(loc) {
  return plotsInRadius(loc, 1).filter((p) => !(p.x === loc.x && p.y === loc.y));
}

/**
 * The player id owning a unit component id, or -1 when unreadable.
 * @param {*} cid Unit ComponentID.
 * @returns {number} Owner player id (-1 = none).
 */
function unitOwner(cid) {
  const unit = safe(() => Units?.get?.(cid), null);
  return unit && typeof unit.owner === "number" ? unit.owner : -1;
}

/**
 * Whether a plot holds a unit that our border can strand: owned by another player, and by one we are
 * at peace with. A hostile or Independent owner's unit crosses our territory freely, so it is not at
 * risk and never blocks a claim. Fails open (false) when the units API is unreadable.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Local player id.
 * @returns {boolean} True when a strandable foreign unit occupies the plot.
 */
export function hasStrandableUnit(loc, me) {
  return strandableUnitsAt(loc, me).length > 0;
}

/**
 * Every foreign unit on a plot that our border could strand, each with the elements it may move through.
 * A whole stack is reported, because one claim can strand any occupant. A unit whose owner is at war with
 * us (every Independent Power included) crosses our territory freely and is never at risk. Fails open
 * (empty) when the units API is unreadable.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Local player id.
 * @returns {{owner:number, domain:string, water:boolean, land:boolean}[]} Units at risk.
 */
export function strandableUnitsAt(loc, me) {
  const ids = safe(() => MapUnits?.getUnits?.(loc.x, loc.y), null);
  if (!ids) return [];
  // Iterate, never `Array.isArray`. The engine's unit list is array-like, not an Array: guarding with
  // Array.isArray made this whole gate a no-op in game while the stubbed tests passed, and the mod
  // trapped a unit anyway. Wrapped, because a non-iterable would throw here.
  const afloat = isWater(loc);
  return safe(() => {
    const out = [];
    for (const cid of ids) {
      const owner = unitOwner(cid);
      if (owner < 0 || owner === me) continue;
      if (atWar(me, owner)) continue; // at war (and every Independent Power): free to walk through us
      const domain = unitDomain(cid);
      if (domain === "DOMAIN_AIR") continue;        // not bound by plots at all
      // A ship uses water. A land unit ashore uses land. A land unit on water is embarked: it may sail on
      // or come ashore, so both count; without this it reads as immobile and is never protected.
      const sea = domain === "DOMAIN_SEA";
      out.push({ owner, domain, water: sea || afloat, land: !sea });
    }
    return out;
  }, []);
}

/**
 * A unit's movement domain ("DOMAIN_LAND" / "DOMAIN_SEA" / "DOMAIN_AIR"), defaulting to land when
 * unreadable, the conservative choice, since a land reading protects the unit rather than skipping it.
 * @param {*} cid Unit ComponentID.
 * @returns {string} Domain name.
 */
function unitDomain(cid) {
  return safe(() => {
    const unit = Units?.get?.(cid);
    const def = unit && GameInfo?.Units?.lookup?.(unit.type);
    return (def && def.Domain) || "DOMAIN_LAND";
  }, "DOMAIN_LAND");
}

/**
 * Whether a plot is somewhere a foreign land unit at peace with us may not go: our own territory
 * (trespass), water, or impassable terrain. Mountains must count as blocked: an earlier draft left them
 * traversable, so a unit whose only remaining neighbor was a mountain read as still mobile and the guard
 * permitted the claim that froze it.
 * @param {{x:number,y:number}} loc Plot to test.
 * @param {number} me Local player id.
 * @param {string|null} claimedKey Plot key to additionally treat as ours (the claim under test).
 * @param {Set<string>|null} inFlight Plot keys this pass has already claimed but the engine has not applied.
 * @returns {boolean} True when the plot blocks movement.
 */
function blockedFor(loc, me, claimedKey, inFlight, can) {
  const k = key(loc);
  if (claimedKey && k === claimedKey) return true;
  if (inFlight && inFlight.has(k)) return true;  // a claim already sent this pass: ours within seconds
  if (ownerAt(loc) === me) return true;          // trespass applies to territorial waters too
  if (isImpassable(loc)) return true;            // mountain, volcano, ice, natural wonder
  const wet = isWater(loc);
  const allow = can || { water: false, land: true };
  return wet ? !allow.water : !allow.land;       // the wrong element for this unit
}

/**
 * How many plots a foreign unit standing at `loc` could legally move to: neighbors that are neither
 * ours nor impassable. Zero means it cannot move at all, which is the reported symptom.
 * @param {{x:number,y:number}} loc Plot the unit stands on.
 * @param {number} me Local player id.
 * @param {string|null} claimedKey Plot key to additionally treat as ours (the claim under test).
 * @param {Set<string>|null} [inFlight] Keys already claimed this pass (treated as ours).
 * @param {{water:boolean, land:boolean}} [can] Elements this unit may move through.
 * @returns {number} Count of legal destinations.
 */
export function legalExits(loc, me, claimedKey, inFlight, can) {
  let n = 0;
  for (const p of neighborsOf(loc)) if (!blockedFor(p, me, claimedKey, inFlight, can)) n += 1;
  return n;
}

/**
 * Whether claiming `loc` would strand a foreign unit at peace with us: one stands beside it and can
 * leave now, but could not once this plot is ours. The unit on the plot itself is not a case; see the
 * comment in the body.
 * @param {{x:number,y:number}} loc Plot about to be claimed.
 * @param {number} me Local player id.
 * @param {Set<string>|null} [inFlight] Keys already claimed this pass, which the engine has not applied yet.
 * @returns {boolean} True when the claim must wait.
 */
export function wouldStrandForeignUnit(loc, me, inFlight) {
  if (!CONFIG.protectTrappedUnits || me < 0) return false;
  const claimedKey = key(loc);
  // Only the neighbors matter. Taking the ground a unit stands on cannot newly strand it: what it may
  // move to is its own neighbors, and this claim does not change those. A unit whose whole ring is
  // already ours was immobilised by whichever ring claim took its last destination, the case below.
  for (const n of neighborsOf(loc)) {
    for (const unit of strandableUnitsAt(n, me)) {
      if (legalExits(n, me, null, inFlight, unit) === 0) continue;          // already immobile, not our doing
      if (legalExits(n, me, claimedKey, inFlight, unit) === 0) return true; // takes its last destination
    }
  }
  return false;
}
