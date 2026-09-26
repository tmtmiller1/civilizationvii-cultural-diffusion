// tests/rivers.mjs - rivers in stepMods: a highway ALONG a river, a wall ACROSS it (docs/civ-v-parity-spec.md §1).
//
// Both Civ VII river kinds are tiles. Tile to tile down the same river FOLLOWS it (bigger bonus on a navigable
// river); stepping onto a river from anywhere else CROSSES into it (gated malus); stepping off a river is free.
import assert from "node:assert/strict";

// --- stub map: per-tile terrain, biome, river kind and river name ------------------
const tiles = new Map(); // "x,y" -> { terrain, biome, river: 0|1|2, name, water }
const tk = (x, y) => `${x},${y}`;
const RT = { NO_RIVER: 0, RIVER_MINOR: 1, RIVER_NAVIGABLE: 2 };
let navigableApi = true;   // GameplayMap.isNavigableRiver present
let waterSaysNavIsWet = false; // a build where isWater is true on a navigable channel
const at = (x, y) => tiles.get(tk(x, y)) || {};
globalThis.RiverTypes = RT;
globalThis.GameplayMap = {
  isWater: (x, y) => !!at(x, y).water || (waterSaysNavIsWet && at(x, y).river === RT.RIVER_NAVIGABLE),
  getTerrainType: (x, y) => (at(x, y).terrain ? tk(x, y) : -1),
  getBiomeType: (x, y) => (at(x, y).biome ? tk(x, y) : -1),
  getFeatureType: () => -1,
  getRouteType: () => 0,
  isMountain: () => false,
  getRiverType: (x, y) => at(x, y).river || RT.NO_RIVER,
  getRiverName: (x, y) => at(x, y).name || "",
  get isNavigableRiver() {
    return navigableApi ? (x, y) => at(x, y).river === RT.RIVER_NAVIGABLE : undefined;
  }
};
globalThis.GameInfo = {
  Terrains: { lookup: (k) => ({ TerrainType: (tiles.get(k) || {}).terrain || "" }) },
  Biomes: { lookup: (k) => ({ BiomeType: (tiles.get(k) || {}).biome || "" }) }
};

const { stepMods } = await import("/cultural-diffusion/ui/cd-terrain.js");
const { diffusionDelivered } = await import("/cultural-diffusion/ui/cd-field.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
const cfg = { ...CONFIG };

// Layout (x, y): a row of plain land, a minor river "LOC_RIVER_A" at (1..3, 0), a second minor river "B" at
// (1, 5), a navigable river "N" at (1..3, 2) running through a desert, and hills at (4, 0).
const land = (x, y, extra = {}) => tiles.set(tk(x, y), { terrain: "TERRAIN_FLAT", ...extra });
for (let x = 0; x <= 5; x++) for (let y = 0; y <= 6; y++) land(x, y);
for (const x of [1, 2, 3]) land(x, 0, { river: RT.RIVER_MINOR, name: "LOC_RIVER_A" });
land(4, 0, { terrain: "TERRAIN_HILL", river: RT.RIVER_MINOR, name: "LOC_RIVER_A" });
land(1, 5, { river: RT.RIVER_MINOR, name: "LOC_RIVER_B" });
for (const x of [1, 2, 3]) {
  tiles.set(tk(x, 2), { terrain: "TERRAIN_NAVIGABLE_RIVER", biome: "BIOME_DESERT", river: RT.RIVER_NAVIGABLE, name: "LOC_RIVER_N" });
}
tiles.set(tk(5, 6), { terrain: "TERRAIN_COAST", water: true });
const P = (x, y) => ({ x, y });
const STRONG = 1000; // above every river gate (200)
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- following: tile to tile down the same river -----------------------------------
const minorFollow = stepMods(P(1, 0), P(2, 0), STRONG, cfg);
assert.deepEqual(minorFollow, { blocked: false, bonus: 0.65, malus: 0, maxFactor: 1.8 }, "minor river follow = Civ V river values");
const navFollow = stepMods(P(1, 2), P(2, 2), STRONG, cfg);
assert.deepEqual(navFollow, { blocked: false, bonus: 1.0, malus: 0, maxFactor: 2.5 }, "navigable follow = road strength");
assert.ok(navFollow.bonus > minorFollow.bonus && navFollow.maxFactor > minorFollow.maxFactor,
  "the navigable highway is stronger than the minor one");
assert.equal(navFollow.malus, 0, "a navigable channel takes none of its desert biome's malus");

// --- crossing: onto a river from a bank ---------------------------------------------
// Regression for the old rule, which gave the follow bonus to ANY step onto a river tile.
for (const [label, dst] of [["minor", P(2, 0)], ["navigable", P(2, 2)]]) {
  const gate = cfg.cultureThreshold * 2.0;
  assert.equal(stepMods(P(2, 1), dst, gate, cfg).blocked, true, `${label}: culture at the gate cannot cross`);
  const cross = stepMods(P(2, 1), dst, gate + 1, cfg);
  assert.deepEqual(cross, { blocked: false, bonus: 0, malus: 0.5, maxFactor: 0.35 }, `${label}: bank onto river pays the crossing`);
}

// A crossing stacks with the destination's own terrain: onto a minor river on hills pays both.
const ontoHillRiver = stepMods(P(4, 1), P(4, 0), STRONG, cfg);
assert.equal(ontoHillRiver.malus, 0.5 + 0.15, "river crossing + hills malus stack");
assert.ok(near(ontoHillRiver.maxFactor, 0.35 * 0.6), "river crossing + hills caps multiply");
assert.equal(stepMods(P(4, 1), P(4, 0), cfg.cultureThreshold * 1.9, cfg).blocked, true,
  "hills gate (1.5x) passes but the river gate (2x) still blocks");
// Following the same river onto the hill tile pays the hills but not the crossing.
const followUpHill = stepMods(P(3, 0), P(4, 0), STRONG, cfg);
assert.deepEqual(followUpHill, { blocked: false, bonus: 0.65, malus: 0.15, maxFactor: 1.8 * 0.6 }, "follow onto hills: bonus and hills");

// --- leaving a river: no river modifier ----------------------------------------------
const offMinor = stepMods(P(2, 0), P(2, 1), 1, cfg);
assert.deepEqual(offMinor, { blocked: false, bonus: 0, malus: 0, maxFactor: 1 }, "off a minor river: plain land step");
const offNav = stepMods(P(2, 2), P(2, 3), 1, cfg);
assert.deepEqual(offNav, { blocked: false, bonus: 0, malus: 0, maxFactor: 1 }, "off a navigable river: plain land step");

// --- confluences and different rivers are crossings, not follows ---------------------
tiles.get(tk(1, 4)).river = RT.RIVER_MINOR; tiles.get(tk(1, 4)).name = "LOC_RIVER_A";
assert.equal(stepMods(P(1, 4), P(1, 5), STRONG, cfg).malus, 0.5, "minor A onto minor B = crossing");
tiles.get(tk(1, 4)).name = "";
assert.equal(stepMods(P(1, 4), P(1, 5), STRONG, cfg).bonus, 0.65, "an unnamed tile is taken as the same river");
tiles.get(tk(1, 4)).river = 0;
tiles.get(tk(1, 1)).river = RT.RIVER_MINOR; tiles.get(tk(1, 1)).name = "LOC_RIVER_A";
assert.deepEqual(stepMods(P(1, 1), P(1, 2), STRONG, cfg), { blocked: false, bonus: 0, malus: 0.5, maxFactor: 0.35 },
  "a minor river into a navigable one pays the navigable crossing");
assert.deepEqual(stepMods(P(1, 2), P(1, 1), STRONG, cfg), { blocked: false, bonus: 0, malus: 0.5, maxFactor: 0.35 },
  "a navigable river into a minor one pays the minor crossing");
cfg.terrainNavigableCross = { malus: 0.9, max: 0.2, threshold: 5 };
assert.equal(stepMods(P(1, 1), P(1, 2), STRONG, cfg).malus, 0.9, "the two crossings are tuned separately");
cfg.terrainNavigableCross = CONFIG.terrainNavigableCross;
tiles.get(tk(1, 1)).river = 0;

// --- navigable detection survives a missing API or a wet isWater ---------------------
navigableApi = false;
assert.equal(stepMods(P(1, 2), P(2, 2), STRONG, cfg).bonus, 1.0, "navigable read from RiverTypes without isNavigableRiver");
navigableApi = true;
waterSaysNavIsWet = true;
assert.equal(stepMods(P(2, 1), P(2, 2), STRONG, cfg).malus, 0.5, "a channel isWater calls wet is still a river, not coast");
waterSaysNavIsWet = false;
assert.equal(stepMods(P(5, 5), P(5, 6), 400, { ...cfg, diffuseAcrossWater: true }).malus, cfg.terrainCoast.malus,
  "real water keeps the water path");

// --- end to end: along a river delivers more than land, across delivers less -------------
const deliver = (src, dst, value) => diffusionDelivered(value, 0, stepMods(src, dst, value, cfg), cfg);
const v = 500;
const plain = deliver(P(0, 4), P(0, 5), v);
const alongMinor = deliver(P(1, 0), P(2, 0), v);
const alongNav = deliver(P(1, 2), P(2, 2), v);
const acrossMinor = deliver(P(2, 1), P(2, 0), v);
const acrossNav = deliver(P(2, 1), P(2, 2), v);
assert.ok(alongNav > alongMinor && alongMinor > plain, `navigable ${alongNav} > minor ${alongMinor} > land ${plain}`);
assert.ok(acrossNav < plain && acrossMinor < plain, `crossing (${acrossMinor}, ${acrossNav}) < land ${plain}`);

console.log("rivers.mjs OK");
