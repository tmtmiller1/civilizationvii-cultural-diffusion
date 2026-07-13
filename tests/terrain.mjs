// tests/terrain.mjs - water crossing in stepMods (diffuseAcrossWater).
//
// Culture crosses water only when strong enough: shallow coast has a lower gate than deep ocean,
// and with diffuseAcrossWater off, water stays hard-blocked (legacy land-only behaviour).
import assert from "node:assert/strict";

// --- stub the map: one coast tile, one ocean tile, everything else land ----------
const terrainAt = new Map(); // "x,y" -> "TERRAIN_COAST" | "TERRAIN_OCEAN" | "" (land)
const tk = (x, y) => `${x},${y}`;
globalThis.GameplayMap = {
  isWater: (x, y) => { const t = terrainAt.get(tk(x, y)); return t === "TERRAIN_COAST" || t === "TERRAIN_OCEAN"; },
  getTerrainType: (x, y) => (terrainAt.has(tk(x, y)) ? tk(x, y) : -1),
  getBiomeType: () => -1, getFeatureType: () => -1,
  getRiverType: () => 0, getRouteType: () => 0, isMountain: () => false
};
globalThis.GameInfo = { Terrains: { lookup: (k) => ({ TerrainType: terrainAt.get(k) || "" }) } };
globalThis.RiverTypes = { NO_RIVER: 0 };

const { stepMods } = await import("/cultural-diffusion/ui/cd-terrain.js");

const cfg = {
  diffuseAcrossWater: true,
  cultureThreshold: 100,
  terrainCoast: { malus: 0.55, max: 0.30, threshold: 3.5 }, // gate = 350
  terrainOcean: { malus: 0.80, max: 0.12, threshold: 6.5 }, // gate = 650
  // land knobs (unused by the water path, present so a land step wouldn't throw)
  roadBonus: 1, roadMax: 2.5, riverFollowBonus: 0.65, riverFollowMax: 1.8
};

const SRC = { x: 0, y: 0 };
const COAST = { x: 1, y: 0 };
const OCEAN = { x: 2, y: 0 };
terrainAt.set(tk(COAST.x, COAST.y), "TERRAIN_COAST");
terrainAt.set(tk(OCEAN.x, OCEAN.y), "TERRAIN_OCEAN");

// Coast: blocked below its gate (350), open above it with the coast malus/max.
assert.equal(stepMods(SRC, COAST, 300, cfg).blocked, true, "weak culture cannot cross even coast");
const coastOpen = stepMods(SRC, COAST, 400, cfg);
assert.equal(coastOpen.blocked, false, "strong-enough culture crosses coast");
assert.equal(coastOpen.malus, 0.55, "coast malus applied");
assert.equal(coastOpen.maxFactor, 0.30, "coast max applied");

// Ocean: needs much more culture. At 400 (crosses coast) ocean is still blocked; at 700 it opens.
assert.equal(stepMods(SRC, OCEAN, 400, cfg).blocked, true, "coast-crossing culture still cannot span open ocean");
const oceanOpen = stepMods(SRC, OCEAN, 700, cfg);
assert.equal(oceanOpen.blocked, false, "overwhelming culture spans deep ocean");
assert.equal(oceanOpen.malus, 0.80, "ocean malus applied");

// diffuseAcrossWater off => water is hard-blocked regardless of culture strength (legacy).
const landOnly = { ...cfg, diffuseAcrossWater: false };
assert.equal(stepMods(SRC, COAST, 100000, landOnly).blocked, true, "water blocked when diffuseAcrossWater is off");

// --- per-age water easing (waterEase) -------------------------------------------
// Age stubs for the ramp: currentAgeKey reads Game.age; ageProgress reads Game.turn/maxTurns.
let ageStr = "AGE_ANTIQUITY", turnNow = 0, maxTurnsNow = 100;
globalThis.Game = { get age() { return ageStr; }, get turn() { return turnNow; }, get maxTurns() { return maxTurnsNow; } };
const { __test } = await import("/cultural-diffusion/ui/cd-pass.js");
const { easeCrossing, effectiveWaterEase } = __test;
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");

// ease 0 leaves the gate untouched (Antiquity).
assert.deepEqual(easeCrossing(cfg.terrainOcean, 0), cfg.terrainOcean, "waterEase 0 = full ocean malus");

// ease 1 removes the water penalty entirely (Modern): no malus, no threshold, full cap.
assert.deepEqual(easeCrossing(cfg.terrainOcean, 1), { malus: 0, max: 1, threshold: 0 }, "waterEase 1 = free crossing");

// ease 0.65 (Exploration) drastically lessens the deep-water gate.
const exp = easeCrossing(cfg.terrainOcean, 0.65);
assert.ok(Math.abs(exp.threshold - 2.275) < 1e-9, "exploration ocean threshold eased 6.5 -> 2.275");
assert.ok(Math.abs(exp.malus - 0.28) < 1e-9, "exploration ocean malus eased 0.80 -> 0.28");

// Integration: with a fully-eased ocean, even the weakest culture crosses deep ocean.
const modernCfg = { ...cfg, terrainOcean: easeCrossing(cfg.terrainOcean, 1) };
const modernOcean = stepMods(SRC, OCEAN, 1, modernCfg);
assert.equal(modernOcean.blocked, false, "Modern (waterEase 1) crosses ocean at any strength");
assert.equal(modernOcean.malus, 0, "Modern has no ocean malus");

// --- continuous ramp of waterEase across an age (effectiveWaterEase) -------------
CONFIG.waterEaseRamp = true;
const A = CONFIG.byAge.ANTIQUITY.waterEase;   // 0.0
const E = CONFIG.byAge.EXPLORATION.waterEase; // 0.65
const M = CONFIG.byAge.MODERN.waterEase;      // 1.0
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Exploration ramps from its own anchor (0.65) toward Modern (1.0) over the age.
ageStr = "AGE_EXPLORATION"; maxTurnsNow = 100;
turnNow = 0;   assert.ok(near(effectiveWaterEase("EXPLORATION"), E), "Exploration start = its anchor");
turnNow = 50;  assert.ok(near(effectiveWaterEase("EXPLORATION"), E + (M - E) * 0.5), "Exploration mid ramps toward Modern");
turnNow = 100; assert.ok(near(effectiveWaterEase("EXPLORATION"), M), "Exploration end reaches Modern");

// Antiquity ramps from 0.0 toward Exploration (0.65): deep ocean near-impassable early, softening late.
ageStr = "AGE_ANTIQUITY";
turnNow = 0;   assert.ok(near(effectiveWaterEase("ANTIQUITY"), A), "Antiquity start = full malus");
turnNow = 100; assert.ok(near(effectiveWaterEase("ANTIQUITY"), E), "Antiquity end ramps to Exploration anchor");

// Modern has no next age -> stays flat at its anchor.
ageStr = "AGE_MODERN"; turnNow = 50;
assert.ok(near(effectiveWaterEase("MODERN"), M), "Modern stays flat (no next age)");

// Ramp off -> flat per-age step (ignores progress).
CONFIG.waterEaseRamp = false;
ageStr = "AGE_EXPLORATION"; turnNow = 100;
assert.ok(near(effectiveWaterEase("EXPLORATION"), E), "ramp off = flat anchor regardless of progress");
CONFIG.waterEaseRamp = true;

console.log("terrain.mjs OK");
