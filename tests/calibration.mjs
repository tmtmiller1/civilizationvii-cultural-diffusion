// tests/calibration.mjs - game-settings calibration (age length + map size).
import assert from "node:assert/strict";

// Stubs (mutated per case).
let maxTurns = 90;
let turn = 0;
let mapSizeName = "MAPSIZE_STANDARD";
globalThis.Game = { get maxTurns() { return maxTurns; }, get turn() { return turn; } };
globalThis.Configuration = { getMap: () => ({ mapSizeTypeName: mapSizeName }) };

const { agePace, mapSizeScale, ageProgress } = await import("/cultural-diffusion/ui/cd-calibration.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");

// Age pace: normalizes to referenceTurns. A long age (Marathon) slows the field (< 1); a short
// age (Quick) speeds it up (> 1); Standard-length ~ 1.
maxTurns = CONFIG.paceReferenceTurns;
assert.ok(Math.abs(agePace() - 1) < 1e-9, "reference-length age paces at 1");
maxTurns = 300; // Marathon-ish
assert.ok(agePace() < 1, "long age slows the per-turn field advance");
maxTurns = 45; // Quick-ish
assert.ok(agePace() > 1, "short age speeds it up");

// Clamped to paceBounds.
maxTurns = 10000;
assert.ok(agePace() >= CONFIG.paceBounds[0] - 1e-9, "pace floored");
maxTurns = 1;
assert.ok(agePace() <= CONFIG.paceBounds[1] + 1e-9, "pace ceilinged");

// Unreadable maxTurns -> neutral.
maxTurns = 0;
assert.equal(agePace(), 1, "no age length -> neutral pace");
maxTurns = CONFIG.paceReferenceTurns;

// Map size: smaller damps, larger grows, unknown -> 1.
mapSizeName = "MAPSIZE_TINY";
assert.ok(mapSizeScale() < 1, "tiny map damps injection");
mapSizeName = "MAPSIZE_HUGE";
assert.ok(mapSizeScale() > 1, "huge map grows a touch");
mapSizeName = "MAPSIZE_STANDARD";
assert.equal(mapSizeScale(), 1, "standard map is neutral");
mapSizeName = "MAPSIZE_NONSENSE";
assert.equal(mapSizeScale(), 1, "unknown size -> neutral");

// Master toggle off -> both neutral, no reads matter.
CONFIG.calibrateToGameSettings = false;
maxTurns = 300; mapSizeName = "MAPSIZE_TINY";
assert.equal(agePace(), 1, "disabled -> neutral pace");
assert.equal(mapSizeScale(), 1, "disabled -> neutral map scale");
CONFIG.calibrateToGameSettings = true;

// Age progress: Game.turn / Game.maxTurns, clamped to [0,1]; 0 when unreadable.
maxTurns = 100;
turn = 0;   assert.equal(ageProgress(), 0, "start of age -> 0");
turn = 50;  assert.equal(ageProgress(), 0.5, "half the age budget -> 0.5");
turn = 100; assert.equal(ageProgress(), 1, "end of age -> 1");
turn = 130; assert.equal(ageProgress(), 1, "past budget clamps to 1");
maxTurns = 0; turn = 40;
assert.equal(ageProgress(), 0, "unreadable age length -> 0");
maxTurns = 90; turn = 0;

console.log("calibration.mjs OK");
