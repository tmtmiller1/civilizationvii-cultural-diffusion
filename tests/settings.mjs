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

// Coherent's getItem() can hand back another key's value. A foreign blob parses as an object but carries scalars at
// the top level; writing it back would copy it into the shared key, so the save must decline and leave it untouched.
const foreign = JSON.stringify({ v: 2, updated: 178, turns: [1, 2] });
backing.set("modSettings", foreign);
setDebug(true);
assert.equal(backing.get("modSettings"), foreign, "a foreign blob is never written back");
const arraySlice = JSON.stringify({ sibling: [1, 2] });
backing.set("modSettings", arraySlice);
setDebug(true);
assert.equal(backing.get("modSettings"), arraySlice, "an array at the top level is not a settings slice");
const nullSlice = JSON.stringify({ sibling: null });
backing.set("modSettings", nullSlice);
setDebug(true);
assert.equal(backing.get("modSettings"), nullSlice, "a null at the top level is not a settings slice");

// Restore valid root and verify toggle getters/setters normalization.
backing.set("modSettings", JSON.stringify({}));
setClaimOnlyUnowned(true);
setFusedModel(false);
setUseEmigration(false);
setDebug(true);
assert.equal(getClaimOnlyUnowned(), true);
assert.equal(getFusedModel(), false);
assert.equal(getUseEmigration(), false);
assert.equal(getDebug(), true);

// Preset application should reset preset keys, then apply toggles as final overrides.
setPresetIndex(PRESET_NAMES.indexOf("High"));
setDiffusionEnabled(false);
setClaimOnlyUnowned(true); // toggle should override High profile value (false)
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
// flipVerb is no longer settings-driven: applyTunableOverrides must NOT touch it (it stays
// whatever the code set it to - here the "setOwnership" we forced above).
assert.equal(CONFIG.flipVerb, "setOwnership");
assert.equal(CONFIG.fusedModel, false);
assert.equal(CONFIG.useEmigration, false);
assert.equal(CONFIG.debug, true);

// Switching from High to Custom should restore preset-controlled keys to defaults.
setPresetIndex(0);
setClaimOnlyUnowned(false);
setDiffusionEnabled(CONFIG_DEFAULTS.diffusionEnabled);
setFusedModel(CONFIG_DEFAULTS.fusedModel);
setUseEmigration(CONFIG_DEFAULTS.useEmigration);
setDebug(CONFIG_DEFAULTS.debug);
applyTunableOverrides();
assert.equal(CONFIG.maxDiffusionPlots, CONFIG_DEFAULTS.maxDiffusionPlots);
assert.equal(CONFIG.minimumOwner, CONFIG_DEFAULTS.minimumOwner);
assert.equal(CONFIG.diffusionRate, CONFIG_DEFAULTS.diffusionRate);

// recedeBorders is opt-in: default OFF, and the stored toggle must actually reach the live CONFIG (the
// first draft stored it but never applied it, so the Options checkbox did nothing).
const { getRecedeBorders, setRecedeBorders } = await import("/cultural-diffusion/ui/cd-settings.js");
assert.equal(getRecedeBorders(), false, "recedeBorders defaults OFF on a fresh profile");
setRecedeBorders(true);
CONFIG.recedeBorders = false;
applyTunableOverrides();
assert.equal(CONFIG.recedeBorders, true, "the stored recede toggle is applied to the live CONFIG");
setRecedeBorders(false);
applyTunableOverrides();
assert.equal(CONFIG.recedeBorders, false, "...and switching it back off applies too");

// growthBuffer (the "+1 ring" buffer) is player-switchable: the shipped default until a toggle is stored, and the stored
// toggle reaches the live CONFIG (players asked for a way to turn it off).
const { getGrowthBuffer, setGrowthBuffer } = await import("/cultural-diffusion/ui/cd-settings.js");
assert.equal(CONFIG_DEFAULTS.growthBuffer, false, "the +1 ring buffer ships OFF (territory-changing features are opt-in)");
assert.equal(getGrowthBuffer(), CONFIG_DEFAULTS.growthBuffer, "growthBuffer keeps the shipped default on a fresh profile");
setGrowthBuffer(false);
CONFIG.growthBuffer = true;
applyTunableOverrides();
assert.equal(CONFIG.growthBuffer, false, "turning the buffer off in Options reaches the live CONFIG");
setGrowthBuffer(true);
applyTunableOverrides();
assert.equal(CONFIG.growthBuffer, true, "...and turning it back on applies too");

if (originalLocalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = originalLocalStorage;

console.log("settings harness passed");
