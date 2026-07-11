import assert from "node:assert/strict";

const originalLocalStorage = globalThis.localStorage;

const backing = new Map();
globalThis.localStorage = {
  getItem(key) {
    return backing.has(key) ? backing.get(key) : null;
  },
  setItem(key, value) {
    backing.set(key, String(value));
  },
  removeItem(key) {
    backing.delete(key);
  }
};

const {
  applyTunableOverrides,
  getPresetIndex,
  setPresetIndex,
  getDiffusionEnabled,
  setDiffusionEnabled,
  getClaimOnlyUnowned,
  setClaimOnlyUnowned,
  getFlipVerbIndex,
  setFlipVerbIndex,
  getFusedModel,
  setFusedModel,
  getUseEmigration,
  setUseEmigration,
  getDebug,
  setDebug
} = await import("/cultural-diffusion/ui/cd-settings.js");

const { CONFIG, CONFIG_DEFAULTS, PRESETS, PRESET_NAMES } =
  await import("/cultural-diffusion/ui/cd-config.js");

assert.equal(getPresetIndex(), PRESET_NAMES.indexOf("Medium"), "default preset should be Medium");

setPresetIndex(PRESET_NAMES.indexOf("High"));
assert.equal(getPresetIndex(), PRESET_NAMES.indexOf("High"));
setPresetIndex(-5);
assert.equal(getPresetIndex(), 0, "invalid preset index should coerce to Custom");

// Cascade safety: storing this mod's option must preserve sibling slices.
backing.set("modSettings", JSON.stringify({ sibling: { keep: 1 } }));
setDiffusionEnabled(false);
const parsedAfterSave = JSON.parse(backing.get("modSettings"));
assert.equal(parsedAfterSave.sibling.keep, 1);
assert.equal(parsedAfterSave["cultural-diffusion"].diffusionEnabled, 0);
assert.equal(getDiffusionEnabled(), false);

// Invalid shared root must not be overwritten by this mod.
backing.set("modSettings", "{bad-json");
setDebug(true);
assert.equal(backing.get("modSettings"), "{bad-json");

// Restore valid root and verify toggle getters/setters normalization.
backing.set("modSettings", JSON.stringify({}));
setClaimOnlyUnowned(true);
setFlipVerbIndex(1);
setFusedModel(false);
setUseEmigration(false);
setDebug(true);
assert.equal(getClaimOnlyUnowned(), true);
assert.equal(getFlipVerbIndex(), 1);
assert.equal(getFusedModel(), false);
assert.equal(getUseEmigration(), false);
assert.equal(getDebug(), true);

// Preset application should reset preset keys, then apply toggles as final overrides.
setPresetIndex(PRESET_NAMES.indexOf("High"));
setDiffusionEnabled(false);
setClaimOnlyUnowned(true); // toggle should override High profile value (false)
setFlipVerbIndex(1);
setFusedModel(false);
setUseEmigration(false);
setDebug(true);

CONFIG.diffusionRate = 999;
CONFIG.minimumOwner = -1;
CONFIG.maxDiffusionPlots = -1;
CONFIG.claimOnlyUnowned = false;
CONFIG.flipVerb = "setOwnership";
CONFIG.fusedModel = true;
CONFIG.useEmigration = true;
CONFIG.debug = false;

applyTunableOverrides();
assert.equal(CONFIG.diffusionRate, PRESETS.High.diffusionRate);
assert.equal(CONFIG.minimumOwner, PRESETS.High.minimumOwner);
assert.equal(CONFIG.maxDiffusionPlots, PRESETS.High.maxDiffusionPlots);
assert.equal(CONFIG.diffusionEnabled, false);
assert.equal(CONFIG.claimOnlyUnowned, true);
assert.equal(CONFIG.flipVerb, "purchasePlot");
assert.equal(CONFIG.fusedModel, false);
assert.equal(CONFIG.useEmigration, false);
assert.equal(CONFIG.debug, true);

// Switching from High to Custom should restore preset-controlled keys to defaults.
setPresetIndex(0);
setClaimOnlyUnowned(false);
setDiffusionEnabled(CONFIG_DEFAULTS.diffusionEnabled);
setFlipVerbIndex(0);
setFusedModel(CONFIG_DEFAULTS.fusedModel);
setUseEmigration(CONFIG_DEFAULTS.useEmigration);
setDebug(CONFIG_DEFAULTS.debug);
applyTunableOverrides();
assert.equal(CONFIG.maxDiffusionPlots, CONFIG_DEFAULTS.maxDiffusionPlots);
assert.equal(CONFIG.minimumOwner, CONFIG_DEFAULTS.minimumOwner);
assert.equal(CONFIG.diffusionRate, CONFIG_DEFAULTS.diffusionRate);

if (originalLocalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = originalLocalStorage;

console.log("settings harness passed");
