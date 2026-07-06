// tests/config.mjs - presets and defaults integrity.
import assert from "node:assert/strict";
import { CONFIG, CONFIG_DEFAULTS, PRESETS, PRESET_NAMES } from "/cultural-diffusion/ui/cd-config.js";

// Defaults are frozen and match CONFIG at load.
assert.ok(Object.isFrozen(CONFIG_DEFAULTS), "CONFIG_DEFAULTS is frozen");
assert.equal(CONFIG_DEFAULTS.flipThreshold, CONFIG.flipThreshold);

// The four intensity presets exist in order, Custom first.
assert.deepEqual(PRESET_NAMES.slice(0, 1), ["Custom"]);
for (const name of ["Custom", "Low", "Medium", "High"]) {
  assert.ok(PRESET_NAMES.includes(name), `preset ${name} present`);
}

// Custom applies no overrides; the others are partial profiles of known keys.
assert.deepEqual(PRESETS.Custom, {}, "Custom applies nothing");
const validKeys = new Set(Object.keys(CONFIG));
for (const name of PRESET_NAMES) {
  for (const key of Object.keys(PRESETS[name])) {
    assert.ok(validKeys.has(key), `preset ${name} key ${key} is a real config field`);
    assert.equal(typeof PRESETS[name][key], typeof CONFIG[key], `preset ${name}.${key} type matches`);
  }
}

// Intensity should scale: Low diffuses SLOWER, decays FASTER, and needs MORE culture to own
// a tile than High - so Low reaches less far, less quickly.
assert.ok(PRESETS.Low.diffusionRate < PRESETS.High.diffusionRate, "Low diffuses slower than High");
assert.ok(PRESETS.Low.decayRate > PRESETS.High.decayRate, "Low decays faster than High");
assert.ok(PRESETS.Low.minimumOwner > PRESETS.High.minimumOwner, "Low has a higher ownership bar");
assert.ok(PRESETS.Low.flipMaxDistance <= PRESETS.High.flipMaxDistance, "Low reaches no farther than High");

// Per-age tuning damps later ages: injection falls and the ownership bar rises Antiquity->Modern.
const { ANTIQUITY, EXPLORATION, MODERN } = CONFIG.byAge;
assert.ok(ANTIQUITY.injectionScale >= EXPLORATION.injectionScale && EXPLORATION.injectionScale >= MODERN.injectionScale, "injection damps in later ages");
assert.ok(ANTIQUITY.ownerBar <= EXPLORATION.ownerBar && EXPLORATION.ownerBar <= MODERN.ownerBar, "ownership bar rises in later ages");

console.log("config.mjs OK");
