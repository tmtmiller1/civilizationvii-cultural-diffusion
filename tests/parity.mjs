// tests/parity.mjs - the PURE parts of the Civ V parity build (docs/civ-v-parity-spec.md §2-§8), off-engine:
// passCanAct with the AI-flip flag, conversion arithmetic and rate table, capture transfer arithmetic, the
// occupation counter, and the mountain source threshold. The engine-facing halves are covered by tests/pass.mjs,
// tests/capture.mjs and tests/conversion.mjs.
import assert from "node:assert/strict";

const mountains = new Set();
globalThis.GameplayMap = {
  isMountain: (x, y) => mountains.has(`${x},${y}`),
  isWater: () => false, getTerrainType: () => -1, getBiomeType: () => -1, getFeatureType: () => -1,
  getRouteType: () => 0, getRiverType: () => -1, getRiverName: () => "", isNavigableRiver: () => false
};
globalThis.RiverTypes = { NO_RIVER: -1, RIVER_MINOR: 0, RIVER_NAVIGABLE: 1 };

const { passCanAct, convertCityCulture, applyCaptureTransfer } = await import("/cultural-diffusion/ui/cd-field.js");
const { conversionRateFor } = await import("/cultural-diffusion/ui/cd-conversion.js");
const { tickOccupation } = await import("/cultural-diffusion/ui/cd-conquest.js");
const { sourceThreshold } = await import("/cultural-diffusion/ui/cd-terrain.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- passCanAct: the AI-flip flag, and the legacy boolean still meaning recede -------------------------
const me = 0, ai = 3, other = 5;
assert.equal(passCanAct(ai, -1, me, false, { aiFlips: true }), true, "AI flips on: an AI leading unowned land can flip");
assert.equal(passCanAct(ai, other, me, false, { aiFlips: true }), true, "AI flips on: rival-to-rival flips happen");
assert.equal(passCanAct(ai, me, me, false, { aiFlips: true }), true, "AI flips on: an AI can take OUR tile");
assert.equal(passCanAct(ai, -1, me, false, { aiFlips: false }), false, "AI flips off: unchanged, an AI never flips");
assert.equal(passCanAct(ai, ai, me, false, { aiFlips: true }), false, "a leader that already owns the tile does nothing");
assert.equal(passCanAct(ai, me, me, true, true), true, "legacy boolean flag still means recede");
assert.equal(passCanAct(ai, me, me, true, { recede: true }), true, "object flag recede");
assert.equal(passCanAct(ai, me, me, false, { recede: true }), false, "recede still needs a mod-claimed tile");

// --- convertCityCulture: a share of every foreign stock moves to the owner, nothing is created ----------
{
  const row = { 0: 1000, 3: 400, 7: 100 };
  const moved = convertCityCulture(row, 0, 0.01);
  assert.ok(near(moved, 5), "1% of 500 foreign moves");
  assert.ok(near(row[3], 396) && near(row[7], 99), "each foreign group loses its share");
  assert.ok(near(row[0], 1005), "the owner gains exactly what the others lost");
  assert.equal(convertCityCulture({ 0: 50 }, 0, 0.5), 0, "no foreign stock, nothing moves");
  assert.equal(convertCityCulture({ 3: 50 }, 0, 0), 0, "rate 0 moves nothing");
  const r2 = { 3: 50 };
  assert.ok(near(convertCityCulture(r2, 0, 5), 50) && near(r2[0], 50) && r2[3] === 0, "rate clamps at 1 (all of it)");
}

// --- conversionRateFor: base + known bonuses, unknown names ignored, clamped ------------------------------
{
  const cfg = { convertBase: 0.005, convertBonuses: { BUILDING_LIBRARY: 0.0025, IDEOLOGY_FASCISM: 0.0175 } };
  assert.ok(near(conversionRateFor([], cfg), 0.005), "base alone");
  assert.ok(near(conversionRateFor(["BUILDING_LIBRARY", "BUILDING_GRANARY"], cfg), 0.0075), "one known bonus, one unknown");
  assert.ok(near(conversionRateFor(["BUILDING_LIBRARY", "IDEOLOGY_FASCISM"], cfg), 0.025), "bonuses add");
  assert.equal(conversionRateFor(["X"], { convertBase: 2, convertBonuses: { X: 3 } }), 1, "clamped to 1");
  assert.ok(near(conversionRateFor(["BUILDING_LIBRARY"], { convertBase: 0.005 }), 0.005), "a missing table is ignored");
  assert.ok(conversionRateFor(["BUILDING_SCHOOLHOUSE", "IDEOLOGY_DEMOCRACY"], CONFIG) > CONFIG.convertBase,
    "the shipped table knows the Modern school and an ideology");
}

// --- applyCaptureTransfer: everyone loses 55%, the conqueror gains 75% of the total lost ----------------
{
  const cfg = { captureLoss: 0.55, captureGain: 0.75 };
  const row = { 3: 1000, 5: 200 };
  const gained = applyCaptureTransfer(row, 0, cfg);
  assert.ok(near(row[3], 450) && near(row[5], 90), "each culture keeps 45%");
  assert.ok(near(gained, 660 * 0.75) && near(row[0], 495), "the conqueror gains 75% of the 660 lost");
  const own = { 0: 100 };
  applyCaptureTransfer(own, 0, cfg);
  assert.ok(near(own[0], 45 + 55 * 0.75), "the conqueror's own prior stock is cut and partly refunded too (Civ V)");
  assert.equal(applyCaptureTransfer({}, 0, cfg), 0, "an empty tile transfers nothing");
}

// --- tickOccupation: continuous hold counts up, leaving resets, a different occupier restarts ----------
{
  const occ = {};
  assert.equal(tickOccupation(occ, "1,1", [0], 3), -1, "turn 1 of 3: not yet");
  assert.equal(tickOccupation(occ, "1,1", [0], 3), -1, "turn 2 of 3: not yet");
  assert.equal(tickOccupation(occ, "1,1", [0], 3), 0, "turn 3 of 3: the occupier wins");
  assert.equal(tickOccupation(occ, "1,1", [], 3), -1, "vacated: cleared");
  assert.equal(occ["1,1"], undefined, "...and the counter is gone");
  tickOccupation(occ, "1,1", [0], 3); tickOccupation(occ, "1,1", [0], 3);
  assert.equal(tickOccupation(occ, "1,1", [4], 3), -1, "a different occupier restarts the count");
  assert.deepEqual(occ["1,1"], { by: 4, turns: 1 }, "...from one");
  tickOccupation(occ, "1,1", [0, 4], 3);
  assert.deepEqual(occ["1,1"], { by: 4, turns: 2 }, "a stack keeps counting for the incumbent occupier");
  assert.equal(tickOccupation({}, "2,2", [9], 0), 9, "buffer 0: flips on the first pass seen");
  assert.equal(tickOccupation({}, "2,2", [9], 1), 9, "buffer 1: also the first pass");
}

// --- sourceThreshold: a mountain source needs 7.5x before it leaks --------------------------------------
{
  const cfg = { cultureThreshold: 100, sourceThresholdMountain: 7.5 };
  assert.equal(sourceThreshold({ x: 1, y: 1 }, cfg), 100, "flat: the base threshold");
  mountains.add("2,2");
  assert.equal(sourceThreshold({ x: 2, y: 2 }, cfg), 750, "mountain: 7.5x");
  assert.equal(sourceThreshold({ x: 2, y: 2 }, { cultureThreshold: 100, sourceThresholdMountain: 0.5 }), 100,
    "the multiplier never lowers the threshold");
}

console.log("parity.mjs OK");
