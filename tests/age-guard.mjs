// tests/age-guard.mjs: district tiles hold still either side of an age transition (cd-age-guard.js).
//
// Watched 2026-10-05/06 on 1.5.0: moving owned district tiles to another civilization on the last Antiquity turns,
// or on the first turn of the new age, crashed the game on the AI's AsyncWorker1 thread; the same moves of tiles
// with no district did not, and district moves mid-age never did.
import assert from "node:assert/strict";

const districts = new Map();
globalThis.DistrictTypes = { CITY_CENTER: 10, URBAN: 11, RURAL: 12, WILDERNESS: 13 };
globalThis.Districts = { getAtLocation: (l) => (districts.has(`${l.x},${l.y}`) ? { type: districts.get(`${l.x},${l.y}`) } : null) };
globalThis.GameplayMap = {};
let ageType = "AGE_ANTIQUITY";
globalThis.GameInfo = { Ages: { lookup: () => ({ AgeType: ageType }) } };
const mgr = { ageCountdownStarted: false, isAgeOver: false, cur: 0, max: 100,
  getCurrentAgeProgressionPoints() { return this.cur; }, getMaxAgeProgressionPoints() { return this.max; } };
globalThis.Game = { turn: 50, age: 1, AgeProgressManager: mgr };

const { transitionWindowOpen, districtTransferPaused, TRANSITION_GUARD_TURNS } = await import("/cultural-diffusion/ui/cd-age-guard.js");
const { claimGateBlocked } = await import("/cultural-diffusion/ui/cd-eligibility.js");

// 1. The pure window.
const base = { countdownStarted: false, ageOver: false, turnsRemaining: null, ageKey: "ANTIQUITY", turn: 50 };
assert.equal(TRANSITION_GUARD_TURNS, 2);
assert.equal(transitionWindowOpen(base), false, "mid-age");
// The whole countdown holds: one turn can add 5, 10 or 20 progression points (milestones, Future Tech or Civic), so
// an age can end from several points out. A guard that waited for 2 points left would miss that last turn.
assert.equal(transitionWindowOpen({ ...base, countdownStarted: true, turnsRemaining: 10 }), true, "countdown, 10 points left");
assert.equal(transitionWindowOpen({ ...base, countdownStarted: true, turnsRemaining: 8 }), true, "countdown, 8 left: a 20-point milestone ends the age this turn");
assert.equal(transitionWindowOpen({ ...base, countdownStarted: true, turnsRemaining: null }), true, "countdown with points unreadable");
assert.equal(transitionWindowOpen({ ...base, countdownStarted: true, turnsRemaining: 2 }), true, "last two turns");
assert.equal(transitionWindowOpen({ ...base, countdownStarted: true, turnsRemaining: 0 }), true, "final turn");
assert.equal(transitionWindowOpen({ ...base, turnsRemaining: 1 }), false, "no countdown: points alone do not open it");
assert.equal(transitionWindowOpen({ ...base, ageOver: true }), true, "age over");
assert.equal(transitionWindowOpen({ ...base, ageKey: "EXPLORATION", turn: 1 }), true, "new age, turn 1");
assert.equal(transitionWindowOpen({ ...base, ageKey: "EXPLORATION", turn: 2 }), true, "new age, turn 2");
assert.equal(transitionWindowOpen({ ...base, ageKey: "EXPLORATION", turn: 3 }), false, "new age, turn 3");
assert.equal(transitionWindowOpen({ ...base, ageKey: "ANTIQUITY", turn: 1 }), false, "the first age has no transition before it");
assert.equal(transitionWindowOpen(null), false);

// 2. The live guard: only owned tiles that carry a district, only inside the window.
districts.set("5,5", DistrictTypes.RURAL);
districts.set("6,5", DistrictTypes.URBAN);
assert.equal(districtTransferPaused({ x: 5, y: 5 }, 3), false, "mid-age: never paused");
mgr.ageCountdownStarted = true; mgr.cur = 99; mgr.max = 100; // one turn left
assert.equal(districtTransferPaused({ x: 5, y: 5 }, 3), true, "rural district, last turns");
assert.equal(districtTransferPaused({ x: 6, y: 5 }, 3), true, "urban district, last turns");
assert.equal(districtTransferPaused({ x: 7, y: 5 }, 3), false, "no district: still moves");
assert.equal(districtTransferPaused({ x: 5, y: 5 }, -1), false, "unowned land is never paused");
mgr.ageCountdownStarted = false; ageType = "AGE_EXPLORATION"; Game.turn = 1;
assert.equal(districtTransferPaused({ x: 5, y: 5 }, 3), true, "first turn of the new age");
Game.turn = 3;
assert.equal(districtTransferPaused({ x: 5, y: 5 }, 3), false, "third turn of the new age");

// 3. An unreadable age manager never pauses (the guard must not stop the mod on a build without it).
globalThis.Game = { turn: 50 };
ageType = "AGE_ANTIQUITY";
assert.equal(districtTransferPaused({ x: 5, y: 5 }, 3), false);

// 4. The shared gate reports it, so the pass, AI flips, the lens and the tooltip all agree.
globalThis.Game = { turn: 1, age: 1, AgeProgressManager: { ...mgr, ageCountdownStarted: false } };
ageType = "AGE_EXPLORATION";
globalThis.Players = { get: (id) => ({ id, isMajor: true, isAlive: true, Diplomacy: { isAtWarWith: () => false }, Cities: { getCities: () => [] } }), getAlive: () => [] };
globalThis.GameplayMap = { getOwner: () => 3, getOwningCityFromXY: () => null, getPlotIndicesInRadius: () => [], getLocationFromIndex: () => ({ x: 0, y: 0 }) };
globalThis.Cities = { getAtLocation: () => null, get: () => null };
const cfg = { claimOnlyUnowned: false, coreProtectRadius: 0, minorProtectRadius: -1, requireAdjacency: false, blockDistantLandsBeforeExploration: false };
assert.equal(claimGateBlocked({ x: 5, y: 5 }, 3, 0, cfg, null), "age-transition");

console.log("age-guard.mjs OK");
