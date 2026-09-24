// tests/units.mjs - never close the last way out on a foreign unit (cd-units.js).
//
// The rule exists because it was WATCHED failing: harness run 17 (1.5.0, 2026-09-24) claimed the whole
// ring around a peaceful major's Scout and it sat frozen on that plot for five consecutive turns,
// having moved every turn before. Moving the unit is engine-closed, so the claim is the only lever.
//
// Three properties this suite pins, all learned in game:
//   * the test is IMMOBILITY, not confinement: a unit that can still step somewhere legal is fine even
//     inside a small pocket. An earlier draft asked whether it could reach a REGION bigger than a cap,
//     which read "already trapped" for any small pocket and let the culpable claim through - watched
//     failing in harness runs 19 and 20 with the guard enabled;
//   * a unit whose owner is AT WAR with us (which includes every Independent Power) is never protected,
//     because it crosses our territory freely - run 17's first two fixtures were void for this reason;
//   * a claim is refused only when IT takes the last legal destination, so a unit that was already
//     immobile does not block anything.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

// --- engine stub ----------------------------------------------------------------
const tiles = new Map();     // "x,y" -> owner id
const water = new Set();
const units = new Map();     // "x,y" -> [{owner}]
const wars = new Set();      // player ids we are at war with
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });

const ME = 0, PEACEFUL = 4, HOSTILE = 3, INDEPENDENT = 33;

const impassable = new Set();   // "x,y" of mountains / impassable plots
globalThis.GameplayMap = {
  getOwner: (x, y) => (tiles.has(tk(x, y)) ? tiles.get(tk(x, y)) : -1),
  isImpassable: (x, y) => impassable.has(tk(x, y)),
  getOwningCityFromXY: () => ({ id: -1 }),
  isWater: (x, y) => water.has(tk(x, y)),
  getGridWidth: () => 200, getGridHeight: () => 200,
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  },
  getLocationFromIndex: (i) => dec(i)
};
globalThis.MapUnits = { getUnits: (x, y) => (units.get(tk(x, y)) || []).map((_u, i) => ({ x, y, i })) };
globalThis.Units = { get: (cid) => (units.get(tk(cid.x, cid.y)) || [])[cid.i] };
// Domain comes from the unit definition, as in game: GameInfo.Units.lookup(unit.type).Domain.
globalThis.GameInfo = { Units: { lookup: (t) => ({ Domain: t === "SEA" ? "DOMAIN_SEA" : t === "AIR" ? "DOMAIN_AIR" : "DOMAIN_LAND" }) } };
// Independent Powers read as at war by default (engine-closed.md, watched run 17).
globalThis.Players = {
  get: (pid) => ({ id: pid, Diplomacy: { isAtWarWith: (o) => wars.has(o) } })
};

const { legalExits, wouldStrandForeignUnit, hasStrandableUnit, strandableUnitsAt, neighborsOf } =
  await import("/cultural-diffusion/ui/cd-units.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");

function reset() {
  tiles.clear(); water.clear(); units.clear(); wars.clear(); impassable.clear();
  wars.add(INDEPENDENT);                       // hostile-by-default, as in game
  CONFIG.protectTrappedUnits = true;
}
reset();

// ================================================================================
// 1. legalExits - how many plots the unit could actually move to.
// ================================================================================
reset();
const EXITS = { x: 10, y: 10 };
assert.equal(legalExits(EXITS, ME, null), 6, "open ground: all six neighbours are legal destinations");
for (const n of neighborsOf(EXITS).slice(0, 5)) tiles.set(tk(n.x, n.y), ME);
assert.equal(legalExits(EXITS, ME, null), 1, "five neighbours ours -> one destination left");
const LAST = neighborsOf(EXITS)[5];
assert.equal(legalExits(EXITS, ME, tk(LAST.x, LAST.y)), 0, "...and claiming that one leaves none");
reset();
for (const n of neighborsOf(EXITS)) water.add(tk(n.x, n.y));
assert.equal(legalExits(EXITS, ME, null), 0, "water counts as no destination for a land unit");

// A MOUNTAIN is not an escape (harness run 22): with it counted as traversable, a unit whose last
// neighbour was impassable read as mobile and the guard let the freezing claim through.
reset();
for (const n of neighborsOf(EXITS).slice(0, 5)) tiles.set(tk(n.x, n.y), ME);
impassable.add(tk(neighborsOf(EXITS)[5].x, neighborsOf(EXITS)[5].y));
assert.equal(legalExits(EXITS, ME, null), 0, "an impassable last neighbour is no destination at all");
reset();
units.set(tk(EXITS.x, EXITS.y), [{ owner: PEACEFUL }]);
const ex = neighborsOf(EXITS);
for (const n of ex.slice(1, 5)) tiles.set(tk(n.x, n.y), ME);
impassable.add(tk(ex[5].x, ex[5].y));
assert.equal(wouldStrandForeignUnit(ex[0], ME), true,
  "claiming the last passable neighbour is refused even when a mountain remains");

// ================================================================================
// 2. hasStrandableUnit - only a PEACEFUL foreign owner counts.
// ================================================================================
reset();
const P = { x: 10, y: 10 };
assert.equal(hasStrandableUnit(P, ME), false, "empty plot");
units.set(tk(P.x, P.y), [{ owner: ME }]);
assert.equal(hasStrandableUnit(P, ME), false, "our own unit is never at risk from us");
units.set(tk(P.x, P.y), [{ owner: PEACEFUL }]);
assert.equal(hasStrandableUnit(P, ME), true, "a peaceful civ's unit can be stranded");
units.set(tk(P.x, P.y), [{ owner: HOSTILE }]);
wars.add(HOSTILE);
assert.equal(hasStrandableUnit(P, ME), false, "a unit at war with us crosses our land freely");
units.set(tk(P.x, P.y), [{ owner: INDEPENDENT }]);
assert.equal(hasStrandableUnit(P, ME), false,
  "an Independent Power reads as at war, so it is never protected (run 17's void fixtures)");
units.set(tk(P.x, P.y), [{ owner: INDEPENDENT }, { owner: PEACEFUL }]);
assert.equal(hasStrandableUnit(P, ME), true, "a mixed stack is protected if ANY occupant is peaceful");
assert.equal(neighborsOf(P).length, 6, "six neighbours, centre excluded");

// The unit list is a real Array in game (measured, run 20: `isArray=true ctor=Array`), but the read
// iterates rather than type-checking, so an array-like would work too.
reset();
units.set(tk(P.x, P.y), [{ owner: PEACEFUL }]);
const realGetUnits = globalThis.MapUnits.getUnits;
globalThis.MapUnits = {
  getUnits: (x, y) => {
    const arr = realGetUnits(x, y);
    return { length: arr.length, [Symbol.iterator]: () => arr[Symbol.iterator]() };
  }
};
assert.equal(hasStrandableUnit(P, ME), true, "an array-LIKE unit list is read, not skipped");
globalThis.MapUnits = { getUnits: realGetUnits };

// ================================================================================
// 2b. ELEMENTS: what blocks a unit depends on which element it is in.
// ================================================================================
// Measured in run 26: 54 foreign ships read DOMAIN_SEA, and 40 LAND-domain units were standing ON water
// (embarked). Treating water as blocked for everyone made every ship and every embarked unit read as
// already immobile, so the guard never protected any of them - while the pass can own water.
const SEA_ONLY = { water: true, land: false };
const LAND_ONLY = { water: false, land: true };
const BOTH = { water: true, land: true };

reset();
const BAY = { x: 10, y: 10 };
const shipNbrs = neighborsOf(BAY);
for (const n of shipNbrs) water.add(tk(n.x, n.y));
water.add(tk(BAY.x, BAY.y));
assert.equal(legalExits(BAY, ME, null, null, SEA_ONLY), 6, "a ship's exits are the water around it");
assert.equal(legalExits(BAY, ME, null, null, LAND_ONLY), 0, "...and none of it is an exit for a land unit ashore");
assert.equal(legalExits(BAY, ME, null, null, BOTH), 6, "an embarked unit may use the water too");

// A ship is read as sea-going, and an embarked LAND unit as able to use both elements.
reset();
water.add(tk(BAY.x, BAY.y));
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "SEA" }]);
assert.deepEqual(strandableUnitsAt(BAY, ME).map((u) => ({ w: u.water, l: u.land })), [{ w: true, l: false }],
  "a ship: water yes, land no");
reset();
water.add(tk(BAY.x, BAY.y));
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "LAND" }]);   // standing ON water: embarked
assert.deepEqual(strandableUnitsAt(BAY, ME).map((u) => ({ w: u.water, l: u.land })), [{ w: true, l: true }],
  "an embarked land unit: both elements (run 26 found 40 of these)");
reset();
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "LAND" }]);   // ashore
assert.deepEqual(strandableUnitsAt(BAY, ME).map((u) => ({ w: u.water, l: u.land })), [{ w: false, l: true }],
  "a land unit ashore: land only");

// Closing a ship's last open water is refused.
reset();
for (const n of shipNbrs) water.add(tk(n.x, n.y));
water.add(tk(BAY.x, BAY.y));
for (const n of shipNbrs.slice(1)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "SEA" }]);
assert.equal(wouldStrandForeignUnit(shipNbrs[0], ME), true, "claiming a ship's last open water is refused");

// The same for an EMBARKED unit mid-water: before the fix it read as immobile and was skipped.
reset();
for (const n of shipNbrs) water.add(tk(n.x, n.y));
water.add(tk(BAY.x, BAY.y));
for (const n of shipNbrs.slice(1)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "LAND" }]);
assert.equal(wouldStrandForeignUnit(shipNbrs[0], ME), true, "an embarked unit's last open water is protected too");

// A land unit ASHORE ringed by water was already immobile: it blocks nothing.
reset();
for (const n of shipNbrs) water.add(tk(n.x, n.y));
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "LAND" }]);
assert.equal(wouldStrandForeignUnit(shipNbrs[0], ME), false,
  "a land unit ashore ringed by water was already immobile - not this claim's doing");

// An AIR unit is never at risk.
reset();
for (const n of shipNbrs.slice(1)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "AIR" }]);
assert.deepEqual(strandableUnitsAt(BAY, ME), [], "an air unit is not bound by plots");
assert.equal(wouldStrandForeignUnit(shipNbrs[0], ME), false, "...so it never blocks a claim");

// A STACK is judged per occupant: the ship is fine on open water, the embarked unit is not.
reset();
for (const n of shipNbrs) water.add(tk(n.x, n.y));
water.add(tk(BAY.x, BAY.y));
for (const n of shipNbrs.slice(1)) impassable.add(tk(n.x, n.y));   // pack ice all round but one
units.set(tk(BAY.x, BAY.y), [{ owner: PEACEFUL, type: "SEA" }, { owner: PEACEFUL, type: "LAND" }]);
assert.equal(strandableUnitsAt(BAY, ME).length, 2, "both occupants of a stack are considered");
assert.equal(wouldStrandForeignUnit(shipNbrs[0], ME), true, "claiming the last ice-free water is refused");

// ================================================================================
// 3. wouldStrandForeignUnit - the claim decision.
// ================================================================================
reset();
assert.equal(wouldStrandForeignUnit(P, ME), false, "open land, no units: claim allowed");

// THE RUN-17 PREVENTION CASE. The pen that trapped player 4's Scout in game was five plots bought in
// one batch, outside the mod. Through the mod, each plot passes this gate, and the one that would close
// the LAST gap in the ring is the culpable claim - so that is the one that must be refused.
reset();
const CENTRE = { x: 10, y: 10 };
const ring = neighborsOf(CENTRE);
const LASTGAP = ring[0];
for (const n of ring) if (!(n.x === LASTGAP.x && n.y === LASTGAP.y)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(CENTRE.x, CENTRE.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), true,
  "run 17 prevention: the claim that closes the last gap in the ring is refused");

// The same last gap, hostile occupant: nothing to protect, so the tile is claimable.
reset();
for (const n of ring) if (!(n.x === LASTGAP.x && n.y === LASTGAP.y)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(CENTRE.x, CENTRE.y), [{ owner: INDEPENDENT }]);
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), false,
  "the same pen around an Independent's unit does not block us - it walks through our land");

// Two gaps left: this claim still leaves it a way out.
reset();
for (const n of ring.slice(2)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(CENTRE.x, CENTRE.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(ring[0], ME), false, "closing one of TWO gaps is allowed");

// Claiming the ground UNDER a unit is never the culpable claim: its options are its neighbours, which
// this claim does not change. With the ring already ours the unit was stuck before we touched its plot.
reset();
units.set(tk(P.x, P.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(P, ME), false, "a unit on the plot with open ground around it: allowed");
reset();
for (const n of neighborsOf(P)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(P.x, P.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(P, ME), false,
  "ring already ours: the trap pre-existed this claim, so taking the plot under it changes nothing");

// The neighbour case with the unit beside the claim rather than at its centre.
reset();
const SIDE = neighborsOf(P)[0];
for (const n of neighborsOf(SIDE)) {
  if (n.x === P.x && n.y === P.y) continue;
  tiles.set(tk(n.x, n.y), ME);
}
units.set(tk(SIDE.x, SIDE.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(P, ME), true, "closing a neighbour's last way out is refused");

// Do no new harm: already penned in before this claim -> not our doing.
reset();
tiles.set(tk(SIDE.x, SIDE.y), ME);
units.set(tk(SIDE.x, SIDE.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(P, ME), false, "a unit already inside our borders does not block the claim");
reset();
for (const n of neighborsOf(SIDE)) {
  if (n.x === P.x && n.y === P.y) continue;
  water.add(tk(n.x, n.y));
}
water.add(tk(P.x, P.y));
units.set(tk(SIDE.x, SIDE.y), [{ owner: PEACEFUL }]);
assert.equal(wouldStrandForeignUnit(P, ME), false, "a unit already penned in by water does not block the claim");

// IN-FLIGHT CLAIMS (harness run 21): a claim already sent this pass is not on the live map yet, so
// without counting it the guard re-counts an exit the mod has already taken and lets the second claim
// through - which is how a Scout with two exits ended up with none in one pass.
reset();
const TWOEXIT = { x: 10, y: 10 };
const exits = neighborsOf(TWOEXIT);
for (const n of exits.slice(2)) tiles.set(tk(n.x, n.y), ME);   // four ours, two exits left
units.set(tk(TWOEXIT.x, TWOEXIT.y), [{ owner: PEACEFUL }]);
const firstExit = exits[0], secondExit = exits[1];
assert.equal(wouldStrandForeignUnit(firstExit, ME), false, "two exits: taking the first is allowed");
// The engine has not applied that claim yet, so the live map still shows it unowned...
assert.equal(wouldStrandForeignUnit(secondExit, ME, null), false,
  "...and without the in-flight set the second claim looks harmless too (the run-21 bug)");
// ...but with the first claim in flight, taking the second is refused.
const inFlight = new Set([tk(firstExit.x, firstExit.y)]);
assert.equal(wouldStrandForeignUnit(secondExit, ME, inFlight), true,
  "with the first claim counted as ours, the second is refused");
assert.equal(legalExits(TWOEXIT, ME, null, inFlight), 1, "the in-flight claim reduces the exit count");

// The flag, and no local player.
reset();
for (const n of neighborsOf(P)) tiles.set(tk(n.x, n.y), ME);
units.set(tk(P.x, P.y), [{ owner: PEACEFUL }]);
CONFIG.protectTrappedUnits = false;
assert.equal(wouldStrandForeignUnit(P, ME), false, "protectTrappedUnits off -> never refuses");
CONFIG.protectTrappedUnits = true;
assert.equal(wouldStrandForeignUnit(P, -1), false, "no local player -> inert");

// ================================================================================
// 4. FAIL OPEN: an unreadable engine must not stall the pass.
// ================================================================================
// The last-gap shape again, so there is something for the guard to refuse when it CAN read the map.
function lastGapFixture() {
  reset();
  for (const n of ring) if (!(n.x === LASTGAP.x && n.y === LASTGAP.y)) tiles.set(tk(n.x, n.y), ME);
  units.set(tk(CENTRE.x, CENTRE.y), [{ owner: PEACEFUL }]);
  }
lastGapFixture();
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), true, "fixture: the guard refuses the last gap");
const savedMapUnits = globalThis.MapUnits;
globalThis.MapUnits = undefined;
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), false, "no MapUnits API -> no unit seen -> claim allowed");
globalThis.MapUnits = { getUnits: () => { throw new Error("engine says no"); } };
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), false, "a throwing units API -> claim allowed, no throw into the pass");
globalThis.MapUnits = savedMapUnits;
const savedUnits = globalThis.Units;
globalThis.Units = { get: () => { throw new Error("engine says no"); } };
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), false, "a throwing Units.get -> owner unreadable -> claim allowed");
globalThis.Units = savedUnits;
// A throwing Diplomacy read must not make every unit look protected either.
const savedPlayers = globalThis.Players;
globalThis.Players = { get: () => { throw new Error("engine says no"); } };
assert.equal(typeof wouldStrandForeignUnit(LASTGAP, ME), "boolean", "a throwing Diplomacy read still returns a verdict");
globalThis.Players = savedPlayers;
lastGapFixture();
assert.equal(wouldStrandForeignUnit(LASTGAP, ME), true, "...and the guard works again once the APIs are back");

console.log("units.mjs OK");
