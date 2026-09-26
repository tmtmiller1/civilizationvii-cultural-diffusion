// cd-units.js
//
// The one thing the mod CAN do about a foreign unit in the path of an expanding border: not close the
// last way out. WATCHED in game (harness run 17, 1.5.0, 2026-09-24): our claims took the whole ring
// around player 4's Scout - a major we were at PEACE with - and it froze on that plot for five
// consecutive turns, having moved every turn before. That is the v1.1.0 field report reproduced, and
// caused by us: Civ VII's trespass rule leaves a peaceful civ's unit with no legal move once every
// neighboring plot is ours, until a war declaration ejects it.
//
// Moving the unit instead is ENGINE-CLOSED, not merely unbuilt (harness runs 13 and 16): no unit
// operation moves a unit we do not own, none moves even our own, and UNITOPERATION_TELEPORT_TO is
// absent from the runtime UnitOperationTypes enum despite existing in the gameplay DB. See
// civilization_vii_mods/engine-closed.md. So the only lever is the claim itself.
//
// Three rules, all from what was watched:
//   1. Only units of players we are AT PEACE with can be stranded. Independent Powers and anyone at
//      war move through our territory freely (run 17: an Independent reads isAtWarWith true by
//      default), so refusing a claim on their account would cost frontier tiles for nothing.
//   2. The test is IMMOBILITY, not confinement. A unit that can still step somewhere legal is fine
//      even if it is shut inside a small pocket; the reported symptom was a unit with NO legal
//      destination at all (`escapes: 0`, frozen for five turns). An earlier draft asked whether the
//      unit could reach a REGION of more than `escapeSearchPlots` plots, which read "already trapped"
//      for any small pocket and waved the culpable claim through - watched failing in harness runs 19
//      and 20, where the guard saw the unit and permitted the claim anyway.
//   3. Refuse only when WE take the last legal destination: a unit already immobile before this claim
//      was not immobilised by it.
//   4. WHAT BLOCKS A UNIT DEPENDS ON WHICH ELEMENT IT IS IN. A land unit ashore is stopped by water; a
//      SHIP is stopped by land; and an EMBARKED land unit - measured on the map, 40 of them, reading
//      DOMAIN_LAND while standing on water - may use both. Treating water as blocked for everyone made
//      every ship and every embarked unit read as already immobile and therefore never protected, while
//      the pass CAN own water (`diffuseAcrossWater` is on by default and the +1 buffer claims unowned
//      water for coastal borders). Impassable terrain blocks every element: `GameplayMap.isImpassable`
//      was measured (run 25) to cover impassable FEATURES too - volcano, ice and the sixteen natural
//      wonders - not just TERRAIN_MOUNTAIN, so those need no special case.
//   5. IN-FLIGHT CLAIMS COUNT AS OURS. `purchasePlot`'s ownership change lands seconds after the call
//      (cd-pending.js exists for exactly that), so a second claim in the same pass still reads the first
//      plot as unowned. Watched in harness run 21: a Scout with TWO exits kept both counted, the pass took
//      them both in one pass, and the unit ended with zero. The caller therefore passes the keys of claims
//      already sent this pass, and they are treated as our territory.
//
// Engine reads: MapUnits.getUnits(x, y) -> ComponentID[] (measured: a real Array) ; Units.get(cid).owner
// -> player id. They fail OPEN (no unit seen), because a silent throw here would stall the whole pass,
// and failing open only restores the pre-guard behavior.

import { plotsInRadius, ownerAt, isWater, isImpassable } from "/cultural-diffusion/ui/cd-plots.js";
import { atWar } from "/cultural-diffusion/ui/cd-borders.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

/**
 * @param {()=>*} fn Thunk.
 * @param {*} fallback Fallback.
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
 * Whether a plot holds a unit that OUR BORDER CAN STRAND: owned by another player, and by one we are
 * at peace with. A hostile or Independent owner's unit crosses our territory freely, so it is not at
 * risk and never blocks a claim. Fails OPEN (false) when the units API is unreadable.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Local player id.
 * @returns {boolean} True when a strandable foreign unit occupies the plot.
 */
export function hasStrandableUnit(loc, me) {
  return strandableUnitsAt(loc, me).length > 0;
}

/**
 * EVERY foreign unit on a plot that our border could strand, each with the elements it may move through.
 * A whole stack is reported, because one claim can strand any occupant. A unit whose owner is at war with
 * us (every Independent Power included) crosses our territory freely and is never at risk. Fails OPEN
 * (empty) when the units API is unreadable.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} me Local player id.
 * @returns {{owner:number, domain:string, water:boolean, land:boolean}[]} Units at risk.
 */
export function strandableUnitsAt(loc, me) {
  const ids = safe(() => MapUnits?.getUnits?.(loc.x, loc.y), null);
  if (!ids) return [];
  // ITERATE, never `Array.isArray`. The engine's unit list is array-LIKE, not an Array: guarding with
  // Array.isArray made this whole gate a no-op in game while the stubbed tests passed, and the mod
  // trapped a unit anyway (harness run 19). The emigration mod and the probe both iterate for the same
  // reason. Wrapped, because a non-iterable would throw here.
  const afloat = isWater(loc);
  return safe(() => {
    const out = [];
    for (const cid of ids) {
      const owner = unitOwner(cid);
      if (owner < 0 || owner === me) continue;
      if (atWar(me, owner)) continue; // at war (and every Independent Power) - free to walk through us
      const domain = unitDomain(cid);
      if (domain === "DOMAIN_AIR") continue;        // not bound by plots at all
      // A ship uses water. A land unit ashore uses land. A land unit ON water is embarked: it may sail on
      // or come ashore, so both count - without this it reads as immobile and is never protected.
      const sea = domain === "DOMAIN_SEA";
      out.push({ owner, domain, water: sea || afloat, land: !sea });
    }
    return out;
  }, []);
}

/**
 * A unit's movement domain ("DOMAIN_LAND" / "DOMAIN_SEA" / "DOMAIN_AIR"), defaulting to land when
 * unreadable - the conservative choice, since a land reading protects the unit rather than skipping it.
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
 * Whether a plot is somewhere a foreign land unit at peace with us may NOT go: our own territory
 * (trespass), water, or impassable terrain. Mountains MUST count as blocked: an earlier draft left them
 * traversable, so a unit whose only remaining neighbor was a mountain read as still mobile and the guard
 * permitted the claim that froze it - watched in harness run 22, where the mod counted one exit and the
 * unit had none.
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
  if (isImpassable(loc)) return true;            // mountain, volcano, ice, natural wonder (run 25: covered)
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
 * leave now, but could not once this plot is ours. The unit on the plot itself is not a case - see the
 * comment in the body.
 * @param {{x:number,y:number}} loc Plot about to be claimed.
 * @param {number} me Local player id.
 * @param {Set<string>|null} [inFlight] Keys already claimed this pass, which the engine has not applied yet.
 * @returns {boolean} True when the claim must wait.
 */
export function wouldStrandForeignUnit(loc, me, inFlight) {
  if (!CONFIG.protectTrappedUnits || me < 0) return false;
  const claimedKey = key(loc);
  // Only the NEIGHBORS matter. Taking the ground a unit stands on cannot newly strand it: what it may
  // move to is its own neighbors, and this claim does not change those. A unit whose whole ring is
  // already ours was immobilised by whichever RING claim took its last destination - the case below.
  for (const n of neighborsOf(loc)) {
    for (const unit of strandableUnitsAt(n, me)) {
      if (legalExits(n, me, null, inFlight, unit) === 0) continue;          // already immobile - not our doing
      if (legalExits(n, me, claimedKey, inFlight, unit) === 0) return true; // takes its last destination
    }
  }
  return false;
}
