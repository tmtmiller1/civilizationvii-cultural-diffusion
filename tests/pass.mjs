// tests/pass.mjs - the per-turn pass ORCHESTRATION (runPass), off-engine.
//
// The pure modules (cd-field, cd-pressure, cd-cpi, cd-civ-tuning) are unit-tested in isolation and
// prove the MATH. This suite covers what only the pass can get wrong: the bail-out guards, the fixed
// step ORDER inside runPass, the flip DECISION gates, the bookkeeping that follows a flip, and the
// bounds on persisted state. A bug here doesn't produce a slightly wrong number - it takes a tile it
// must not, or oscillates the border every turn.
//
// SCOPE / HONEST LIMIT: this stubs the engine, so it tests the mod's MODEL of the engine, not the
// engine. Sentinels are mirrored from the probe (see cd-plots.js header: unowned => getOwner() -1
// and getOwningCityFromXY().id -1). Engine-contract drift still needs the probe mod + in-game runs.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

// --- controllable engine stub over an (x,y) -> {owner, city} tile map ------------
const tiles = new Map();
const water = new Set();
let savedState = null;
let multiplayer = false;
let purchaseNoOps = false; // simulate purchasePlot reporting ok but not actually changing owner
// deferWrites = the REAL engine (watched in-game, 1.4.2): purchasePlot's owner change lands after the call, so the
// same-tick read still shows the old owner. Queued writes apply when the test calls flushWrites().
let deferWrites = false;
const writeQueue = [];
const flushWrites = () => { while (writeQueue.length) writeQueue.shift()(); };
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const getTile = (x, y) => tiles.get(tk(x, y)) || { owner: -1, city: -1 };
function getTileMut(x, y) {
  if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1 });
  return tiles.get(tk(x, y));
}

const ME = 0, RIVAL = 3;
const CITY_ID = 42, RIVAL_CITY_ID = 77;
const CENTER = { x: 10, y: 10 };
const RIVAL_CENTER = { x: 22, y: 10 }; // far outside our fieldRadius-8 region

let localId = ME;
let atWarWithRival = false;
let unclaimed = [];

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameContext = { get localPlayerID() { return localId; } };
globalThis.YieldTypes = { YIELD_CULTURE: 1, YIELD_HAPPINESS: 2, YIELD_FOOD: 3, YIELD_PRODUCTION: 4, YIELD_GOLD: 5, YIELD_SCIENCE: 6 };
globalThis.Configuration = {
  getGame: () => ({
    get isAnyMultiplayer() { return multiplayer; },
    getValue: () => (savedState ? JSON.stringify({ v: 2, data: savedState }) : null)
  }),
  editGame: () => ({ setValue: (_k, v) => { savedState = JSON.parse(v).data; } })
};
let gridW = 200, gridH = 200; // shrunk in the map-bounds section below
globalThis.GameplayMap = {
  getOwner: (x, y) => getTile(x, y).owner,
  getOwningCityFromXY: (x, y) => ({ id: getTile(x, y).city }),
  isWater: (x, y) => water.has(tk(x, y)),
  getGridWidth: () => gridW, getGridHeight: () => gridH,
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  },
  getLocationFromIndex: (i) => dec(i)
};
globalThis.WorldBuilder = {
  MapPlots: {
    setOwnership: (pid, loc) => {
      const t = getTileMut(loc.x, loc.y);
      if (pid < 0) { unclaimed.push(tk(loc.x, loc.y)); t.owner = -1; t.city = -1; }
      else { t.owner = pid; t.city = -1; } // legacy verb: owner set, NO owning city => an orphan
    }
  }
};

/** A city stub with the yield/happiness surface cd-polity reads. */
function makeCity(id, location, owner, culture) {
  return {
    id, location, owner,
    Yields: { getNetYield: (e) => (e === YieldTypes.YIELD_CULTURE ? culture : e === YieldTypes.YIELD_FOOD ? 5 : 2) },
    Happiness: { netHappinessPerTurn: 4, isInGoldenAge: () => false },
    Constructibles: { getNumWonders: () => 0 },
    purchasePlot: (loc) => {
      if (purchaseNoOps) return; // reports nothing, changes nothing - the silent no-op case
      const apply = () => { const t = getTileMut(loc.x, loc.y); t.owner = owner; t.city = id; };
      if (deferWrites) writeQueue.push(apply); else apply();
    }
  };
}

let myCity = makeCity(CITY_ID, CENTER, ME, 40);
let rivalCity = makeCity(RIVAL_CITY_ID, RIVAL_CENTER, RIVAL, 30);
let myCities = [myCity];

const extraAlive = [];  // additional alive players a section needs (e.g. a city-state with a settlement)
globalThis.Players = {
  getAlive: () => [
    { id: ME, isAlive: true, isMajor: true, Cities: { getCities: () => myCities } },
    { id: RIVAL, isAlive: true, isMajor: true, Cities: { getCities: () => [rivalCity] } },
    ...extraAlive
  ],
  get: (pid) => ({
    id: pid,
    isMajor: !minorPlayers.has(pid),
    Treasury: { goldBalance: 100000, changeGoldBalance: () => {} },
    Happiness: { isInGoldenAge: () => false },
    Diplomacy: { isAtWarWith: (o) => atWarWithRival && ((pid === ME && o === RIVAL) || (pid === RIVAL && o === ME)) },
    isDistantLands: () => false
  })
};
globalThis.Game = { age: "AGE_ANTIQUITY", turn: 10, maxTurns: 90 };
// The units surface the strand guard reads (cd-units.js). Defined from the start but empty, so every
// section before 19 runs with no units on the map.
const minorPlayers = new Set();   // player ids the stub reports as isMajor === false
const centresOnMap = new Set(); // "x,y" of settlement centres the MAP reports (villages included)
globalThis.Cities = { getAtLocation: (x, y) => (centresOnMap.has(tk(x, y)) ? { id: 55 } : null), get: () => null };
const mapUnits = new Map(); // "x,y" -> [{owner}]
globalThis.MapUnits = { getUnits: (x, y) => (mapUnits.get(tk(x, y)) || []).map((_u, i) => ({ x, y, i })) };
globalThis.Units = { get: (cid) => (mapUnits.get(tk(cid.x, cid.y)) || [])[cid.i] };

const { runPass } = await import("/cultural-diffusion/ui/cd-pass.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");

// A deterministic, calibration-neutral baseline.
CONFIG.diffusionEnabled = true;
CONFIG.fusedModel = false;         // the CPI/ethnic legs have their own suites; keep the pass isolated
CONFIG.calibrateToGameSettings = false; // pace 1, mapSizeScale 1
CONFIG.growthBuffer = false;       // buffer.mjs covers claimBufferAt
CONFIG.repairOrphans = true;
CONFIG.baseGrowthRadius = 3;
CONFIG.fieldRadius = 8;
CONFIG.flipVerb = "purchasePlot";
CONFIG.claimOnlyUnowned = false;
CONFIG.requireAdjacency = true;
CONFIG.coreProtectRadius = 0;
CONFIG.maxFlipsPerTurn = 8;
CONFIG.maxDiffusionPlots = 80;
CONFIG.flipMaxDistance = 6;
CONFIG.flipCooldownTurns = 15;
CONFIG.minimumOwner = 300;
CONFIG.debug = false;

const TARGET = { x: 14, y: 10 };        // ring-4: outside the base-game ring, adjacent to our ring-3
const INNER = { x: 12, y: 10 };         // ring-2: base game's, never ours to claim
assert.equal(hexDistance(CENTER, TARGET), 4, "fixture: TARGET is ring-4");
assert.equal(hexDistance(CENTER, INNER), 2, "fixture: INNER is ring-2");

/** Reset the world: we own rings 0..3 around CENTER; everything else is empty land. */
function reset() {
  tiles.clear(); water.clear();
  savedState = null; multiplayer = false; purchaseNoOps = false;
  deferWrites = false; writeQueue.length = 0;
  localId = ME; atWarWithRival = false; unclaimed = [];
  mapUnits.clear(); centresOnMap.clear(); minorPlayers.clear(); extraAlive.length = 0;
  gridW = 200; gridH = 200;
  myCity = makeCity(CITY_ID, CENTER, ME, 40);
  rivalCity = makeCity(RIVAL_CITY_ID, RIVAL_CENTER, RIVAL, 30);
  myCities = [myCity];
  for (let y = 0; y <= 20; y++) {
    for (let x = 0; x <= 20; x++) {
      if (hexDistance(CENTER, { x, y }) <= CONFIG.baseGrowthRadius) {
        const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID;
      }
    }
  }
  const r = getTileMut(RIVAL_CENTER.x, RIVAL_CENTER.y); r.owner = RIVAL; r.city = RIVAL_CITY_ID;
}

/** Seed persisted state directly - faster and far more deterministic than simulating 100 turns. */
function seedState(extra) {
  savedState = { field: {}, claims: {}, locked: {}, monoTurn: 5, ...extra };
}
/** A mature culture stock for ME on a tile, comfortably above minimumOwner after one decay step. */
const mature = (pid = ME) => ({ [String(pid)]: 5000 });

// ================================================================================
// 1. The bail-out guards. Each must return a zero summary AND change no ownership.
// ================================================================================
reset(); seedState();
CONFIG.diffusionEnabled = false;
let r = runPass();
assert.deepEqual({ flips: r.flips, tiles: r.tiles }, { flips: 0, tiles: 0 }, "disabled -> zero summary");
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "disabled -> no ownership change");
assert.equal(savedState.monoTurn, 5, "disabled -> state untouched (not even the turn tick)");
CONFIG.diffusionEnabled = true;

reset(); seedState();
localId = -1;
r = runPass();
assert.deepEqual({ flips: r.flips, tiles: r.tiles }, { flips: 0, tiles: 0 }, "no local player -> zero summary");
assert.equal(savedState.monoTurn, 5, "no local player -> state untouched");
localId = ME;

reset(); seedState();
myCities = [];
r = runPass();
assert.deepEqual({ flips: r.flips, tiles: r.tiles }, { flips: 0, tiles: 0 }, "no local cities -> zero summary");
assert.equal(savedState.monoTurn, 5, "no local cities -> state untouched");

// Multiplayer: cd-ownership's guardSP blocks every mutating verb. runPass has no MP check of its
// own (its JSDoc says it "bails in multiplayer" - it does not; it runs and simply cannot mutate).
// What matters is the SAFETY property, so that is what is asserted here.
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } });
multiplayer = true;
r = runPass();
assert.equal(r.flips, 0, "multiplayer -> no flips (guardSP blocks the verbs)");
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "multiplayer -> no ownership change");
multiplayer = false;

// ================================================================================
// 2. A flip happens, and for the RIGHT reason.
// ================================================================================
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } });
r = runPass();
assert.equal(r.flips, 1, "a mature culture stock on an eligible frontier tile flips exactly one tile");
assert.deepEqual(getTile(TARGET.x, TARGET.y), { owner: ME, city: CITY_ID },
  "the flipped tile is owned by us AND attached to the city (integrated, not an orphan)");
// The bookkeeping that follows a flip.
assert.ok(savedState.claims[tk(TARGET.x, TARGET.y)], "the flip is recorded as a claim");
assert.equal(savedState.claims[tk(TARGET.x, TARGET.y)].by, ME, "claim records the local player");
assert.equal(savedState.claims[tk(TARGET.x, TARGET.y)].city, CITY_ID, "claim attaches to the nearest city");
assert.equal(savedState.locked[tk(TARGET.x, TARGET.y)], CONFIG.flipCooldownTurns,
  "the flipped tile is locked for flipCooldownTurns (anti-flicker)");
// The flipped tile keeps a stock above the ownership bar, so the next pass does not immediately
// un-resolve it. NOTE: this does NOT pin commitFlip's `Math.max(..., ageCfg.minimumOwner)` seed
// line - that line is a provable no-op (a flip requires value > ageCfg.minimumOwner, and that
// value IS next[k][me], so the max never raises anything; instrumented over this suite: 14 flips,
// 14 no-ops, 0 raises). Documented in docs/BACKLOG.md rather than deleted from the flip path.
assert.ok(savedState.field[tk(TARGET.x, TARGET.y)][String(ME)] >= CONFIG.minimumOwner,
  "the flipped tile retains a stock above the bar, so it does not immediately flip back");

// The same tile, with culture BELOW the ownership bar, does not flip.
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 100 } } });
r = runPass();
assert.equal(r.flips, 0, "culture below minimumOwner does not flip the tile");
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "...and the tile stays unowned");

// ================================================================================
// 3. The base game's inner rings are never claimed.
// ================================================================================
// An inner (ring-2) tile with a huge stock must NOT be claimed by the mod, even though its culture
// dwarfs the bar: the base game owns and assigns those tiles (the "can't work my 3-ring" regression).
reset();
const innerT = getTileMut(INNER.x, INNER.y); innerT.owner = -1; innerT.city = -1; // pretend it is not yet grown
seedState({ field: { [tk(INNER.x, INNER.y)]: mature() } });
r = runPass();
assert.equal(r.flips, 0, "a tile inside our own natural growth ring is never flipped by the mod");
assert.equal(getTile(INNER.x, INNER.y).owner, -1, "...the base game keeps it");
assert.equal(savedState.claims[tk(INNER.x, INNER.y)], undefined, "...and no claim is recorded for it");

// ================================================================================
// 4. Eligibility gates on a RIVAL-owned tile.
// ================================================================================
/** Make TARGET a rival-owned tile with our culture dominant over theirs. */
function seedRivalTarget() {
  reset();
  const t = getTileMut(TARGET.x, TARGET.y); t.owner = RIVAL; t.city = RIVAL_CITY_ID;
  seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 5000, [String(RIVAL)]: 100 } } });
}

seedRivalTarget();
r = runPass();
assert.equal(r.flips, 1, "baseline: we out-culture the rival decisively and take the tile");
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "...the rival tile is ours");

seedRivalTarget();
CONFIG.claimOnlyUnowned = true;
r = runPass();
assert.equal(r.flips, 0, "claimOnlyUnowned (safety mode) -> a rival's tile is never taken");
assert.equal(getTile(TARGET.x, TARGET.y).owner, RIVAL, "...the rival keeps it");
CONFIG.claimOnlyUnowned = false;

seedRivalTarget();
atWarWithRival = true;
r = runPass();
assert.equal(r.flips, 0, "at war -> no peaceful diffusion across an active front");
assert.equal(getTile(TARGET.x, TARGET.y).owner, RIVAL, "...the rival keeps it");
atWarWithRival = false;

// Core protection: a rival's CITY CENTRE is protected at coreProtectRadius 0.
reset();
const NEAR_RIVAL = { x: 16, y: 10 }; // in our region (<= fieldRadius 8), beyond our ring-3
assert.ok(hexDistance(CENTER, NEAR_RIVAL) <= CONFIG.fieldRadius, "fixture: the rival outpost is in our region");
const outpost = makeCity(99, NEAR_RIVAL, RIVAL, 10);
rivalCity = outpost; // the rival's only city sits at NEAR_RIVAL
const nr = getTileMut(NEAR_RIVAL.x, NEAR_RIVAL.y); nr.owner = RIVAL; nr.city = 99;
// Make our land reach it so requireAdjacency is satisfied.
for (let x = 11; x <= 15; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; }
seedState({ field: { [tk(NEAR_RIVAL.x, NEAR_RIVAL.y)]: { [String(ME)]: 5000, [String(RIVAL)]: 10 } } });
r = runPass();
assert.equal(r.flips, 0, "a rival's city centre is core-protected and never flips");
assert.equal(getTile(NEAR_RIVAL.x, NEAR_RIVAL.y).owner, RIVAL, "...the rival keeps their centre");

// A VILLAGE centre is protected too, even though its owner reports no cities. Watched on 1.5.0 (harness
// runs 15-17): an Independent Power reads `cities: 0` through Players.Cities.getCities(), so the
// city-list route sees nothing and the MAP route is the only thing standing between diffusion and a
// settlement core. Here the owner has NO city object at all, exactly as in game.
reset();
const VILLAGE = { x: 16, y: 10 };
const INDEP = 33;
rivalCity = makeCity(98, RIVAL_CENTER, RIVAL, 10);       // the rival's city is elsewhere
const vt = getTileMut(VILLAGE.x, VILLAGE.y); vt.owner = INDEP; vt.city = 55;
centresOnMap.add(tk(VILLAGE.x, VILLAGE.y));              // the map says a settlement centre sits here
for (let x = 11; x <= 15; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; }
seedState({ field: { [tk(VILLAGE.x, VILLAGE.y)]: { [String(ME)]: 5000, [String(INDEP)]: 10 } } });
r = runPass();
assert.equal(r.flips, 0, "a village centre is core-protected even though its owner reports no cities");
assert.equal(getTile(VILLAGE.x, VILLAGE.y).owner, INDEP, "...the independent keeps its settlement");
// And with the map read blind (no centre reported) the same tile flips - so the test pins the MAP route,
// not some other gate.
reset();
const vt2 = getTileMut(VILLAGE.x, VILLAGE.y); vt2.owner = INDEP; vt2.city = 55;
for (let x = 11; x <= 15; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; }
seedState({ field: { [tk(VILLAGE.x, VILLAGE.y)]: { [String(ME)]: 5000, [String(INDEP)]: 10 } } });
r = runPass();
assert.equal(r.flips, 1, "without the map centre read the same village tile flips (pins the new route)");

// A MINOR's ring-1 is protected too, not just its centre plot. Watched in harness run 13: with
// coreProtectRadius 0 the pass took 89,41 and 90,42, both ring-1 of city-state 33's centre at 89,42,
// which strips a minor to the single plot it stands on and reads as the settlement being absorbed.
// minorProtectRadius (1) is the floor that stops it; a MAJOR's ring-1 is still claimable.
const MINOR = 18;
const MINOR_CENTRE = { x: 16, y: 10 };
const MINOR_RING1 = { x: 15, y: 10 };                  // ring-1 of the minor centre, ring-5 of ours
/** A live city-state holding MINOR_CENTRE + MINOR_RING1, with our land reaching it. */
function seedMinorNeighbour(ownerId, isMajorFlag) {
  reset();
  const city = makeCity(97, MINOR_CENTRE, ownerId, 10);
  if (!isMajorFlag) minorPlayers.add(ownerId);
  extraAlive.push({ id: ownerId, isAlive: true, isMajor: isMajorFlag, Cities: { getCities: () => [city] } });
  const mc = getTileMut(MINOR_CENTRE.x, MINOR_CENTRE.y); mc.owner = ownerId; mc.city = 97;
  const mr = getTileMut(MINOR_RING1.x, MINOR_RING1.y); mr.owner = ownerId; mr.city = 97;
  for (let x = 11; x <= 14; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; }
  seedState({ field: { [tk(MINOR_RING1.x, MINOR_RING1.y)]: { [String(ME)]: 5000, [String(ownerId)]: 10 } } });
}

seedMinorNeighbour(MINOR, false);
r = runPass();
assert.equal(r.flips, 0, "a minor's ring-1 tile is protected by minorProtectRadius");
assert.equal(getTile(MINOR_RING1.x, MINOR_RING1.y).owner, MINOR, "...the city-state keeps its last land");

// The same fixture with the floor off: the tile flips, so the test pins the floor and not another gate.
seedMinorNeighbour(MINOR, false);
CONFIG.minorProtectRadius = -1;
r = runPass();
assert.equal(r.flips, 1, "floor off -> the minor's ring-1 flips again (pins minorProtectRadius)");
CONFIG.minorProtectRadius = 1;

// A MAJOR's ring-1 is still claimable: the floor must not quietly protect everyone.
seedMinorNeighbour(7, true);
r = runPass();
assert.equal(r.flips, 1, "a MAJOR's ring-1 still flips at coreProtectRadius 0");

// requireAdjacency and flipMaxDistance must be pinned SEPARATELY. A tile that is both out of range
// AND non-adjacent proves neither gate: each one masks the other's removal. (Found exactly that way
// - the first draft of this suite passed with either gate deleted.)

// requireAdjacency: a dominated tile IN range but NOT touching our land is skipped...
const NOTADJ = { x: 15, y: 10 }; // ring-5: inside flipMaxDistance 6, but no tile of ours adjacent
assert.equal(hexDistance(CENTER, NOTADJ), 5, "fixture: NOTADJ is ring-5, within flipMaxDistance 6");
reset(); seedState({ field: { [tk(NOTADJ.x, NOTADJ.y)]: mature() } });
runPass();
assert.equal(getTile(NOTADJ.x, NOTADJ.y).owner, -1,
  "requireAdjacency: an in-range tile not touching our land is not flipped (the contiguous front)");
// ...and with adjacency off, that SAME tile is taken (enclaves allowed) - proving the gate is
// conditional, not a blanket refusal.
reset(); seedState({ field: { [tk(NOTADJ.x, NOTADJ.y)]: mature() } });
CONFIG.requireAdjacency = false;
runPass();
assert.equal(getTile(NOTADJ.x, NOTADJ.y).owner, ME, "requireAdjacency off -> the same tile IS taken (enclave)");
CONFIG.requireAdjacency = true;

// flipMaxDistance: a tile ADJACENT to our land but beyond the distance cap is not a candidate.
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } }); // ring-4, adjacent to our ring-3
CONFIG.flipMaxDistance = 3;
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "a tile beyond flipMaxDistance is not a flip candidate");
CONFIG.flipMaxDistance = 6;

// ================================================================================
// 5. The silent no-op guard: performFlip "succeeding" without a real owner change
//    must book NOTHING (no claim, no lock, no budget spend, no toast).
// ================================================================================
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } });
purchaseNoOps = true;
r = runPass();
assert.equal(r.flips, 0, "a purchasePlot that silently no-ops is NOT counted as a flip");
assert.equal(savedState.claims[tk(TARGET.x, TARGET.y)], undefined, "...no phantom claim is recorded");
assert.equal(savedState.locked[tk(TARGET.x, TARGET.y)], undefined, "...and the tile is not locked");
purchaseNoOps = false;

// ================================================================================
// 6. Anti-flicker: a locked tile does not flip, and prepareState ticks locks down.
// ================================================================================
// NOTE: assert on the LOCKED TILE, not on the pass-wide flip count. A mature seed diffuses ~40% of
// its stock to each neighbour in one pass, so those neighbours legitimately flip on later passes.
reset();
seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() }, locked: { [tk(TARGET.x, TARGET.y)]: 3 } });
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "a cooldown-locked tile does not flip");
assert.equal(savedState.locked[tk(TARGET.x, TARGET.y)], 2, "the lock ticks down by one each pass");
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "still locked -> still not ours");
assert.equal(savedState.locked[tk(TARGET.x, TARGET.y)], 1, "...and it keeps ticking");
// On this pass prepareState ticks the lock to 0 and removes it, so the tile becomes flippable
// again in the SAME pass - and the fresh flip immediately re-locks it.
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "once the lock expires the tile flips");
assert.equal(savedState.locked[tk(TARGET.x, TARGET.y)], CONFIG.flipCooldownTurns,
  "...and the fresh flip re-locks it for a full cooldown");

// A lock on a tile with no culture is removed once it reaches 0 (it must not linger in state).
reset(); seedState({ locked: { "5,5": 1 } });
runPass();
assert.equal(savedState.locked["5,5"], undefined, "a lock reaching 0 is deleted from persisted state");

// ================================================================================
// 7. Caps: maxFlipsPerTurn and the per-city maxDiffusionPlots budget.
// ================================================================================
/** Seed N mature ring-4/5 tiles that are all individually eligible. */
function seedManyTargets() {
  reset();
  const field = {};
  const spots = [];
  for (let y = 6; y <= 14; y++) {
    for (let x = 6; x <= 14; x++) {
      const d = hexDistance(CENTER, { x, y });
      if (d === 4 && getTile(x, y).owner < 0) { field[tk(x, y)] = { [String(ME)]: 5000 }; spots.push({ x, y }); }
    }
  }
  seedState({ field });
  return spots;
}
const spots = seedManyTargets();
assert.ok(spots.length > 3, `fixture: several eligible ring-4 tiles (${spots.length})`);
CONFIG.maxFlipsPerTurn = 2;
r = runPass();
assert.equal(r.flips, 2, "maxFlipsPerTurn caps the number of flips in a single pass");
CONFIG.maxFlipsPerTurn = 8;

seedManyTargets();
CONFIG.maxDiffusionPlots = 1;
r = runPass();
assert.equal(r.flips, 1, "the per-city maxDiffusionPlots budget caps claims for that city");
// The budget counts EXISTING claims, so a second pass adds nothing.
const before = Object.keys(savedState.claims).length;
runPass();
assert.equal(Object.keys(savedState.claims).length, before, "an exhausted per-city budget blocks further claims");
CONFIG.maxDiffusionPlots = 80;

// ================================================================================
// 8. Sequencing + state hygiene inside runPass.
// ================================================================================
// releaseInnerClaims: a stale claim inside our natural ring is handed back to the base game.
reset();
seedState({ claims: { [tk(INNER.x, INNER.y)]: { by: ME, city: CITY_ID, turn: 1 } } });
r = runPass();
assert.equal(r.released, 1, "a mod claim inside the natural ring is released back to the base game");
assert.equal(savedState.claims[tk(INNER.x, INNER.y)], undefined, "...and its claim record is dropped");
assert.ok(unclaimed.includes(tk(INNER.x, INNER.y)), "...via a real unclaim on the tile");

// repairOrphans: owner==me but no owning city => released or re-integrated, never left an orphan.
reset();
const ORPHAN = { x: 15, y: 10 }; // ring-5 frontier, beyond the natural ring
const ot = getTileMut(ORPHAN.x, ORPHAN.y); ot.owner = ME; ot.city = -1; // the legacy-verb orphan shape
seedState();
r = runPass();
assert.equal(r.healed, 1, "a frontier orphan (owner=me, no owning city) is healed");
assert.equal(getTile(ORPHAN.x, ORPHAN.y).city, CITY_ID, "...by re-integrating it into the nearest city");

// pruneFarField: field entries far outside the region do not persist forever.
reset();
const FAR = tk(60, 60);
seedState({ field: { [FAR]: mature(), [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 400 } } });
runPass();
assert.equal(savedState.field[FAR], undefined, "field tiles far outside the region are pruned from persisted state");
assert.ok(savedState.field[tk(TARGET.x, TARGET.y)], "...while in-region tiles are kept");

// The monotonic turn advances and the pass persists its state every run.
reset(); seedState();
const t0 = savedState.monoTurn;
runPass();
assert.ok(savedState.monoTurn > t0, "the pass advances the monotonic turn and saves state");

// ================================================================================
// 9. Field MECHANICS at pass level (values, not just decisions).
// ================================================================================
// cd-field unit-tests the formulas; this pins that the pass WIRES them to the right tiles with the
// right operands. Everything above asserts decisions (flips/ownership/bookkeeping), which leaves the
// arithmetic free to be wrong in ways no flip assertion would notice.
const CITY_K = tk(CENTER.x, CENTER.y);
const NB = { x: 15, y: 10 }; // a neighbour of TARGET(14,10), in-region, not adjacent to our land

// Injection: an empty field gains a stock on the CITY tile, and it accumulates across passes.
reset(); seedState();
runPass();
const inj1 = savedState.field[CITY_K][String(ME)];
assert.ok(inj1 > 0, `the city tile is injected on the first pass (got ${inj1})`);
runPass(); runPass();
assert.ok(savedState.field[CITY_K][String(ME)] > inj1, "the city stock accumulates across passes");
// It injects for the CITY's owner, not some other civ.
assert.deepEqual(Object.keys(savedState.field[CITY_K]), [String(ME)], "the city injects only its own civ's culture");

// Diffusion: a mature source delivers sourceValue * diffusionRate to a fresh neighbour on step one.
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 5000 } } });
runPass();
const delivered = savedState.field[tk(NB.x, NB.y)][String(ME)];
assert.ok(Math.abs(delivered - 5000 * CONFIG.diffusionRate) < 1e-6,
  `a fresh neighbour receives sourceValue * diffusionRate (expected ${5000 * CONFIG.diffusionRate}, got ${delivered})`);

// Diffusion ACCUMULATES onto the neighbour's decayed stock - it does not overwrite it.
// (A fresh neighbour cannot show this: with prev = 0, `= add` and `+= add` are identical. That is
// exactly how the first draft of this assertion passed with the accumulation deleted.)
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 5000 }, [tk(NB.x, NB.y)]: { [String(ME)]: 100 } } });
runPass();
const decayedNb = 100 - (100 * CONFIG.decayRate + CONFIG.decayFlat);   // decayStep runs first
const expected = decayedNb + 5000 * CONFIG.diffusionRate;              // then diffusion adds on top
const got = savedState.field[tk(NB.x, NB.y)][String(ME)];
assert.ok(Math.abs(got - expected) < 1e-6,
  `diffusion adds to the neighbour's decayed stock (expected ${expected}, got ${got})`);

// Threshold: a source AT cultureThreshold diffuses nothing (the guard is >, not >=).
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: CONFIG.cultureThreshold } } });
runPass();
assert.equal(savedState.field[tk(NB.x, NB.y)], undefined,
  "a source at exactly cultureThreshold delivers nothing to its neighbours");

// Decay: an isolated stock (no injector) shrinks every pass and is eventually pruned away.
reset(); seedState({ field: { [tk(NOTADJ.x, NOTADJ.y)]: { [String(ME)]: 200 } } });
runPass();
const d1 = savedState.field[tk(NOTADJ.x, NOTADJ.y)][String(ME)];
assert.ok(d1 < 200, `an isolated stock decays (200 -> ${d1})`);
runPass();
assert.ok(savedState.field[tk(NOTADJ.x, NOTADJ.y)][String(ME)] < d1, "...and keeps decaying");

// ================================================================================
// 10. Map bounds: the region never leaves the grid.
// ================================================================================
// fieldRadius (8) reaches past the edge of a small map. Region building must drop out-of-bounds
// plots - otherwise the pass reads/writes tiles that do not exist. Both halves of the bounds test
// are exercised: the upper rail (x < w) and the lower rail (x >= 0).
reset();
gridW = 12; gridH = 12; // CENTER(10,10) + radius 8 would otherwise reach x,y = 18
seedState({ field: { [tk(11, 10)]: { [String(ME)]: 5000 } } });
runPass();
for (const k of Object.keys(savedState.field)) {
  const [x, y] = k.split(",").map(Number);
  assert.ok(x < gridW && y < gridH, `field tile ${k} is inside the ${gridW}x${gridH} grid (upper rail)`);
}
assert.equal(savedState.field[tk(12, 10)], undefined, "a plot at x === gridWidth is out of bounds and never enters the field");

// Lower rail: a source ON the origin edge must not diffuse into negative coordinates.
// The source has to sit AT x=0 - a source at x=1 only ever reaches x>=0 anyway, so it proves
// nothing (the first draft did exactly that and passed with the `p.x >= 0` rail deleted).
reset();
myCity = makeCity(CITY_ID, { x: 2, y: 2 }, ME, 40);
myCities = [myCity];
for (let y = 0; y <= 5; y++) for (let x = 0; x <= 5; x++) {
  if (hexDistance({ x: 2, y: 2 }, { x, y }) <= CONFIG.baseGrowthRadius) { const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID; }
}
seedState({ field: { [tk(0, 2)]: { [String(ME)]: 5000 } } }); // ON the west edge; its neighbours include x = -1
runPass();
for (const k of Object.keys(savedState.field)) {
  const [x, y] = k.split(",").map(Number);
  assert.ok(x >= 0 && y >= 0, `field tile ${k} has no negative coordinate (lower rail)`);
}
assert.equal(savedState.field[tk(-1, 2)], undefined, "a plot at x === -1 is out of bounds and never enters the field");

// ================================================================================
// 11. Per-age scaling (byAge): the ownership bar and injection both move with the age.
// ================================================================================
// A stock that clears the ANTIQUITY bar (300) must NOT clear EXPLORATION's (300 * ownerBar 1.25 =
// 375). This is the anti-snowball damping, and nothing above exercises it - every earlier case runs
// in ANTIQUITY with a stock so large the bar is irrelevant.
const MID = 350; // decays to ~331.5: over the ANTIQUITY bar, under EXPLORATION's
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: MID } } });
globalThis.Game = { age: "AGE_ANTIQUITY", turn: 10, maxTurns: 90 };
assert.equal(runPass().flips, 1, "a mid stock clears the ANTIQUITY ownership bar");

reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: MID } } });
globalThis.Game = { age: "AGE_EXPLORATION", turn: 10, maxTurns: 90 };
assert.equal(runPass().flips, 0, "the same stock does NOT clear EXPLORATION's raised bar (ownerBar 1.25)");
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "...so the tile stays unowned");

// The real engine exposes Game.age as a numeric HASH (watched in-game, 1.4.2), resolved via
// GameInfo.Ages.lookup(...).AgeType. A hashed EXPLORATION must raise the bar exactly like the string form -
// before the fix every hashed age read as ANTIQUITY, so this stock flipped in every age.
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: MID } } });
const AGE_HASH = 2077444219;
globalThis.GameInfo = { Ages: { lookup: (h) => (h === AGE_HASH ? { AgeType: "AGE_EXPLORATION" } : null) } };
globalThis.Game = { age: AGE_HASH, turn: 10, maxTurns: 90 };
assert.equal(runPass().flips, 0, "a HASHED Exploration age (GameInfo.Ages lookup) raises the bar like the string form");
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: MID } } });
globalThis.Game = { age: 987654321, turn: 10, maxTurns: 90 };
assert.equal(runPass().flips, 1, "an unresolvable age hash falls back to ANTIQUITY (neutral bar), not a crash");
delete globalThis.GameInfo;

// A missing byAge table falls back to neutral (injectionScale 1, ownerBar 1), it does not crash or
// zero the bar.
const savedByAge = CONFIG.byAge;
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: MID } } });
CONFIG.byAge = null;
assert.equal(runPass().flips, 1, "a missing byAge table -> neutral ownerBar 1 -> the mid stock flips again");
CONFIG.byAge = {};
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: MID } } });
assert.equal(runPass().flips, 1, "a byAge table with no entry for this age -> the same neutral fallback");
CONFIG.byAge = savedByAge;

// injectionScale damps later-age injection: the same city builds stock more slowly in MODERN (0.65)
// than in ANTIQUITY (1.0). (Pass one is identical either way - injectionAmount is strength-
// independent at zero stock - so this needs several passes.)
const stockAfter3 = (age) => {
  reset(); seedState();
  globalThis.Game = { age, turn: 10, maxTurns: 90 };
  runPass(); runPass(); runPass();
  return savedState.field[CITY_K][String(ME)];
};
const antiquityStock = stockAfter3("AGE_ANTIQUITY");
const modernStock = stockAfter3("AGE_MODERN");
assert.ok(modernStock < antiquityStock,
  `MODERN injectionScale 0.65 damps injection vs ANTIQUITY 1.0 (${modernStock} < ${antiquityStock})`);
globalThis.Game = { age: "AGE_ANTIQUITY", turn: 10, maxTurns: 90 };

// ================================================================================
// 12. Region membership: water and unreadable map dimensions.
// ================================================================================
// diffuseAcrossWater off -> water tiles are not in the region and receive no culture.
reset();
water.add(tk(NB.x, NB.y));
CONFIG.diffuseAcrossWater = false;
seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 5000 } } });
runPass();
assert.equal(savedState.field[tk(NB.x, NB.y)], undefined,
  "with diffuseAcrossWater off, a water neighbour is excluded from the region entirely");
// ...and with it on, that same water tile does take culture (coastal spread).
reset();
water.add(tk(NB.x, NB.y));
CONFIG.diffuseAcrossWater = true;
seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 5000 } } });
runPass();
assert.ok(savedState.field[tk(NB.x, NB.y)], "with diffuseAcrossWater on, culture reaches the water tile");

// Unreadable map dimensions (0x0) must disable the bounds test, not reject every plot.
reset();
gridW = 0; gridH = 0;
seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 5000 } } });
r = runPass();
assert.equal(r.flips, 1, "unreadable grid dims (0x0) -> the bounds test is skipped, the pass still runs");

// ================================================================================
// 13. Claim budget counts OUR claims only; dead civs' culture is ignored.
// ================================================================================
// Another player's claim record must not consume our city's maxDiffusionPlots budget.
reset();
seedState({
  field: { [tk(TARGET.x, TARGET.y)]: mature() },
  claims: { "99,99": { by: RIVAL, city: CITY_ID, turn: 1 } } // a rival claim naming OUR city id
});
CONFIG.maxDiffusionPlots = 1;
assert.equal(runPass().flips, 1, "a rival's claim does not count against our city's plot budget (by === me filter)");
CONFIG.maxDiffusionPlots = 80;

// A civ with no living settlements is a dead owner: its culture is skipped when resolving the tile,
// so OUR weaker stock still wins the plot.
const DEAD = 7; // never appears in Players.getAlive()
reset();
seedState({ field: { [tk(TARGET.x, TARGET.y)]: { [String(ME)]: 400, [String(DEAD)]: 5000 } } });
r = runPass();
assert.equal(r.flips, 1, "a dead civ's dominant culture is ignored, so our weaker stock wins the tile");
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "...and the tile becomes ours");

// ================================================================================
// 14. The FUSED model (the shipped default) drives a pass end-to-end.
// ================================================================================
// Everything above runs with fusedModel off to isolate the orchestration. But fusedModel:true is
// the DEFAULT, and it swaps the injection-strength function for the CPI/prosperity/ethnic stack
// (cd-metrics -> cd-cpi -> powerMultipliers, plus buildEthnicContext). That path has to survive a
// real pass over the stub engine, not just its own unit tests.
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } });
CONFIG.fusedModel = true;
r = runPass();
assert.equal(r.flips, 1, "the fused model (default) drives a pass to a flip, same as the raw model");
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "...and the tile is integrated");
// The fused stack must not poison the field with NaN when a civ's metrics are thin.
for (const [k, row] of Object.entries(savedState.field)) {
  for (const [civ, v] of Object.entries(row)) {
    assert.ok(typeof v === "number" && isFinite(v) && v >= 0, `fused pass leaves a finite stock at ${k}/${civ} (got ${v})`);
  }
}
// It also survives an engine with NO metrics to read (gatherCivMetrics -> empty -> no multiplier).
const savedGetAlive = globalThis.Players.getAlive;
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } });
globalThis.Players = { ...globalThis.Players, getAlive: () => [] };
assert.doesNotThrow(() => runPass(), "the fused model degrades cleanly when no players are readable");
globalThis.Players = { ...globalThis.Players, getAlive: savedGetAlive };
CONFIG.fusedModel = false;

// ================================================================================
// 15. No churn on an already-owned tile.
// ================================================================================
// The field is FROZEN here (no diffusion, no decay) so the board genuinely settles. With a live
// field it never would - and should not: the culture wave is meant to keep travelling outward,
// so "no flips on the next pass" is NOT a property of a healthy pass.
const liveRates = { d: CONFIG.diffusionRate, r: CONFIG.decayRate, f: CONFIG.decayFlat };
CONFIG.diffusionRate = 0; CONFIG.decayRate = 0; CONFIG.decayFlat = 0;
reset(); seedState({ field: { [tk(TARGET.x, TARGET.y)]: mature() } });
assert.equal(runPass().flips, 1, "first pass takes the tile");
const claimTurn = savedState.claims[tk(TARGET.x, TARGET.y)].turn;
const second = runPass();
assert.equal(second.flips, 0, "with the field frozen, an already-owned tile is not re-flipped");
assert.equal(second.healed, 0, "...nothing to heal (the flip integrated the tile, no orphan)");
assert.equal(second.released, 0, "...and nothing to release (it is beyond the natural ring)");
assert.equal(savedState.claims[tk(TARGET.x, TARGET.y)].turn, claimTurn,
  "...and the original claim record is not rewritten");
CONFIG.diffusionRate = liveRates.d; CONFIG.decayRate = liveRates.r; CONFIG.decayFlat = liveRates.f;

// ================================================================================
// 16. Borders RECEDE (opt-in): a mod-claimed tile can be ceded to a rival.
// ================================================================================
// Only tiles recorded in state.claims are ever touched. A rival must beat our stock on the tile by the
// same decisive margin a claim needs (resolveOwner), be at peace with us, have a city within
// flipMaxDistance, and (with requireAdjacency) own land touching the tile. There is no release to no one:
// setOwnership(NO_PLAYER) never un-owns a city-attached tile on the real engine (harness runs 1-2).
const OUTPOST = { x: 18, y: 10 };    // a rival city 4 tiles from TARGET, inside our region
const OUTPOST_ID = 88;
const RIVAL_EDGE = { x: 15, y: 10 }; // rival land touching TARGET
assert.equal(hexDistance(OUTPOST, TARGET), 4, "fixture: the rival outpost is within flipMaxDistance of TARGET");

/** TARGET is our CLAIMED ring-4 tile; a rival outpost sits nearby with land touching it. */
function seedRecede(fieldRow, extra = {}) {
  reset();
  rivalCity = makeCity(OUTPOST_ID, OUTPOST, RIVAL, 10);
  const o = getTileMut(OUTPOST.x, OUTPOST.y); o.owner = RIVAL; o.city = OUTPOST_ID;
  const e = getTileMut(RIVAL_EDGE.x, RIVAL_EDGE.y); e.owner = RIVAL; e.city = OUTPOST_ID;
  const t = getTileMut(TARGET.x, TARGET.y); t.owner = ME; t.city = CITY_ID;
  seedState({
    field: { [tk(TARGET.x, TARGET.y)]: fieldRow },
    claims: { [tk(TARGET.x, TARGET.y)]: { by: ME, city: CITY_ID, turn: 1 } },
    ...extra
  });
}
// The rival wins decisively; our own stock stays well above the release floor, so only cession can fire.
const rivalWins = () => ({ [String(ME)]: 1000, [String(RIVAL)]: 5000 });
const TK = tk(TARGET.x, TARGET.y);

assert.equal(CONFIG.recedeBorders, false, "recedeBorders ships OFF (unobserved verbs)");
seedRecede(rivalWins());
r = runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "recedeBorders off -> a claimed tile is kept even when out-cultured");
assert.equal(r.ceded, 0, "...and nothing is reported as ceded");

CONFIG.recedeBorders = true;
seedRecede(rivalWins());
r = runPass();
assert.equal(r.ceded, 1, "a claimed tile the rival decisively out-cultures is ceded");
assert.deepEqual(getTile(TARGET.x, TARGET.y), { owner: RIVAL, city: OUTPOST_ID },
  "...to the rival's nearest city (integrated, not an orphan)");
assert.equal(savedState.claims[TK], undefined, "...its claim record is dropped");
assert.equal(savedState.locked[TK], CONFIG.flipCooldownTurns, "...and it is locked against an immediate flip back");
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, RIVAL, "the lock holds the ceded tile on the next pass");

seedRecede(rivalWins());
atWarWithRival = true;
r = runPass();
assert.equal(r.ceded, 0, "at war -> no peaceful cession across an active front");
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "...we keep the tile");
atWarWithRival = false;

seedRecede({ [String(ME)]: 1000, [String(RIVAL)]: 1200 }); // the rival leads, but short of flipRatio
r = runPass();
assert.equal(r.ceded, 0, "a rival lead short of the decisive flipRatio margin does not cede the tile");
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "...we keep it");

seedRecede(rivalWins());
Object.assign(getTileMut(RIVAL_EDGE.x, RIVAL_EDGE.y), { owner: -1, city: -1 });
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "requireAdjacency: a rival with no land touching the tile cannot take it");
seedRecede(rivalWins());
Object.assign(getTileMut(RIVAL_EDGE.x, RIVAL_EDGE.y), { owner: -1, city: -1 });
CONFIG.requireAdjacency = false;
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, RIVAL, "requireAdjacency off -> the same tile IS ceded");
CONFIG.requireAdjacency = true;

seedRecede(rivalWins());
CONFIG.flipMaxDistance = 3;
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "a rival city beyond flipMaxDistance cannot take the tile");
CONFIG.flipMaxDistance = 6;

seedRecede(rivalWins());
purchaseNoOps = true;
r = runPass();
assert.equal(r.ceded, 0, "a cession purchasePlot that silently no-ops is not counted");
assert.ok(savedState.claims[TK], "...the claim is kept");
assert.equal(savedState.locked[TK], undefined, "...and the tile is not locked");
purchaseNoOps = false;

// A claim whose own culture has faded, with no decisive rival, simply stays ours: no release verb exists.
seedRecede({ [String(ME)]: 100 });
r = runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "a faded claim with no decisive rival stays ours (no release verb)");
assert.ok(savedState.claims[TK], "...its claim is kept");
assert.equal(savedState.pending[TK], undefined, "...nothing is sent for it");
assert.ok(!unclaimed.includes(TK), "...not even an unclaim attempt");

seedRecede(rivalWins(), { locked: { [TK]: 3 } });
runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "a cooldown-locked claim is not ceded, even when out-cultured");

seedRecede(rivalWins());
savedState.claims = {}; // the same out-cultured tile, but owned without ever being claimed by the mod
r = runPass();
assert.equal(r.ceded, 0, "a tile the mod never claimed is never ceded (base-game tiles are untouched)");
assert.equal(getTile(TARGET.x, TARGET.y).owner, ME, "...still ours");

// Cap: several out-cultured claims near the rival outpost, with rival land on every ring-5 tile.
reset();
rivalCity = makeCity(OUTPOST_ID, OUTPOST, RIVAL, 10);
Object.assign(getTileMut(OUTPOST.x, OUTPOST.y), { owner: RIVAL, city: OUTPOST_ID });
const cedeClaims = {};
const cedeField = {};
for (let y = 0; y <= 20; y++) {
  for (let x = 0; x <= 24; x++) {
    const d = hexDistance(CENTER, { x, y });
    if (d >= 5) Object.assign(getTileMut(x, y), { owner: RIVAL, city: OUTPOST_ID });
    if (d !== 4 || hexDistance(OUTPOST, { x, y }) > 6) continue;
    Object.assign(getTileMut(x, y), { owner: ME, city: CITY_ID });
    cedeClaims[tk(x, y)] = { by: ME, city: CITY_ID, turn: 1 };
    cedeField[tk(x, y)] = { [String(ME)]: 1000, [String(RIVAL)]: 5000 };
  }
}
assert.ok(Object.keys(cedeClaims).length > 2, "fixture: several out-cultured claims near the rival outpost");
seedState({ field: cedeField, claims: cedeClaims });
CONFIG.maxFlipsPerTurn = 2;
r = runPass();
assert.equal(r.ceded, 2, "cession is capped by maxFlipsPerTurn");
CONFIG.maxFlipsPerTurn = 8;
CONFIG.recedeBorders = false;

// ================================================================================
// 17. Debug diagnostics run on a live pass without disturbing it.
// ================================================================================
// In-game, cd-bootstrap mirrors CONFIG.debug into cd-log's own gate (setLogDebug) before each pass, so
// both switches must be on here: CONFIG.debug gates the diagnostics work, cd-log gates the output.
const { setDebug: setLogDebug } = await import("/cultural-diffusion/ui/cd-log.js");
reset(); seedState({ field: { [TK]: mature() } });
CONFIG.debug = true;
setLogDebug(true);
const quiet = console.error;
const lines = [];
console.error = (m) => lines.push(String(m));
try {
  r = runPass();
} finally {
  console.error = quiet;
  CONFIG.debug = false;
  setLogDebug(false);
}
assert.equal(r.flips, 1, "debug logging does not change the pass outcome");
assert.ok(lines.some((l) => /inject 10,10 civ=0 .*strength=/.test(l)), "debug logs each injector's strength");
assert.ok(lines.some((l) => /frontier city=42 ring=4 best=\S+ bar=300 over=\d+\/\d+/.test(l)),
  "debug logs the first claimable ring's best stock against the bar");
assert.ok(lines.some((l) => /state bytes=[1-9]\d* field=\d+ claims=1 locked=1 passMs=\d+/.test(l)),
  "debug logs the persisted state size after the flip");

// ================================================================================
// 18. Deferred ownership writes - how the real engine behaves (watched in-game on 1.4.2).
// ================================================================================
// purchasePlot's owner change lands AFTER the call. Before cd-pending.js the pass booked a flip only on the
// same-tick read, so every real flip was logged NOT APPLIED and nothing was ever recorded.
reset(); seedState({ field: { [TK]: mature() } });
deferWrites = true;
r = runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "fixture: the engine has not applied the write on this tick");
assert.equal(r.flips, 0, "a flip whose write has not landed is not booked as a flip on the same tick");
assert.equal(r.pending, 1, "...it is recorded as pending instead");
assert.equal(savedState.claims[TK], undefined, "...with no claim yet");
assert.equal(savedState.pending[TK] && savedState.pending[TK].kind, "claim", "...and a persisted pending claim");
flushWrites();
r = runPass();
assert.equal(r.confirmed, 1, "the next pass confirms the landed write from the live map");
assert.equal(savedState.claims[TK] && savedState.claims[TK].by, ME, "...books the claim for us");
assert.equal(savedState.claims[TK].city, CITY_ID, "...attached to the city that bought it");
assert.equal(savedState.locked[TK], CONFIG.flipCooldownTurns, "...locks it for the cooldown");
assert.equal(savedState.pending[TK], undefined, "...and clears the pending entry");

// A pending claim the live map never shows is dropped, and the tile is simply retried.
reset(); seedState({ field: { [TK]: mature() } });
deferWrites = true;
runPass();
writeQueue.length = 0; // this write never lands
r = runPass();
assert.equal(r.confirmed, 0, "a pending claim the live map does not show is not confirmed");
assert.equal(savedState.claims[TK], undefined, "...no claim is booked");
assert.ok(savedState.pending[TK], "...and the still-dominated tile is sent again, pending once more");

// Unconfirmed flips still count toward maxFlipsPerTurn - no runaway while writes are in flight.
seedManyTargets();
deferWrites = true;
CONFIG.maxFlipsPerTurn = 2;
r = runPass();
assert.equal(r.flips + r.pending, 2, "pending flips count toward maxFlipsPerTurn");
assert.equal(r.pending, 2, "...and on the deferred engine they are all pending");
CONFIG.maxFlipsPerTurn = 8;

// A deferred cession: pending first, then confirmed from the live map - and never also released.
CONFIG.recedeBorders = true;
seedRecede(rivalWins());
deferWrites = true;
r = runPass();
assert.equal(r.ceded, 0, "a cession whose write has not landed is not booked on the same tick");
assert.equal(savedState.pending[TK] && savedState.pending[TK].kind, "cede", "...it is pending");
assert.ok(savedState.claims[TK], "...and our claim stays until the live map confirms");
flushWrites();
r = runPass();
assert.equal(getTile(TARGET.x, TARGET.y).owner, RIVAL, "fixture: the cession landed");
assert.equal(r.confirmedCede, 1, "the next pass confirms the cession");
assert.equal(savedState.claims[TK], undefined, "...and drops our claim");
assert.equal(savedState.locked[TK], CONFIG.flipCooldownTurns, "...locking the tile against an immediate flip back");
CONFIG.recedeBorders = false;

// ================================================================================
// 19. The strand guard: the pass must not close the last way out on a peaceful civ's unit.
// ================================================================================
// Watched in game (harness run 17): claims closed every exit around a peaceful major's Scout and it sat
// frozen for five turns. The engine cannot move a unit we do not own, so the claim is the only lever.
const nbrs = (loc) => {
  const out = [];
  for (let y = loc.y - 1; y <= loc.y + 1; y++) {
    for (let x = loc.x - 1; x <= loc.x + 1; x++) if (hexDistance(loc, { x, y }) === 1) out.push({ x, y });
  }
  return out;
};
/** A unit on a neighbour of TARGET whose only legal destination IS target. */
function seedLastGap(unitOwner) {
  reset(); seedState({ field: { [TK]: mature() } });
  const pen = nbrs(TARGET).find((n) => hexDistance(CENTER, n) > CONFIG.baseGrowthRadius);
  for (const p of nbrs(pen)) {
    if (p.x === TARGET.x && p.y === TARGET.y) continue;
    const t = getTileMut(p.x, p.y); t.owner = ME; t.city = CITY_ID;
  }
  mapUnits.set(tk(pen.x, pen.y), [{ owner: unitOwner }]);
  return pen;
}

seedLastGap(RIVAL);                      // RIVAL is at peace in this fixture (atWarWithRival = false)
r = runPass();
assert.equal(r.flips, 0, "the claim that would close a peaceful civ's last way out is refused");
assert.equal(getTile(TARGET.x, TARGET.y).owner, -1, "...the tile stays unowned");
assert.equal(savedState.claims[TK], undefined, "...nothing is booked");
assert.equal(savedState.locked[TK], undefined, "...and no cooldown is spent on a tile we did not take");

// At war with that civ: its units cross our land freely, so the tile is claimable after all.
seedLastGap(RIVAL);
atWarWithRival = true;
r = runPass();
assert.equal(r.flips, 1, "a unit at war with us never blocks a claim");
atWarWithRival = false;

// Our own unit in the same spot is not a foreign unit.
seedLastGap(ME);
r = runPass();
assert.equal(r.flips, 1, "our own unit does not block the claim");

// The flag keeps it reversible.
seedLastGap(RIVAL);
CONFIG.protectTrappedUnits = false;
r = runPass();
assert.equal(r.flips, 1, "protectTrappedUnits off -> the claim goes ahead (pre-guard behaviour)");
CONFIG.protectTrappedUnits = true;

console.log("pass.mjs OK");
