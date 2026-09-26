// tests/options.mjs - the mod's Options registration survives the base OptionsModel's rebuild.
//
// A player reported the mod's settings vanishing after closing Settings until the game restarted. The base model's
// reInitOptions() clears every option and rebuilds only from init callbacks (addInitCallback), so an option added with
// a bare addOption at load is gone after a rebuild. tests/core-stub.mjs mirrors model-options.js (1.4.2) for exactly
// these methods.
import assert from "node:assert/strict";

const { Options } = await import("/core/ui/options/model-options.js");
const { CONFIG_DEFAULTS } = await import("/cultural-diffusion/ui/cd-config.js");
const { installOptions, registerAll } = await import("/cultural-diffusion/ui/cd-options.js");

const CD_IDS = [
  "cd-preset", "cd-enabled", "cd-claim-only", "cd-core-protect", "cd-require-adjacency", "cd-growth-buffer",
  "cd-recede", "cd-ai-flips", "cd-conquest", "cd-foreign-culture", "cd-fused", "cd-emigration", "cd-pressure-lens",
  "cd-debug"
];
const present = () => CD_IDS.filter((id) => Options.data.has(id));
const registrations = () => Options.optionsReInitCallbacks.filter((cb) => cb === registerAll).length;

// Loading cd-options registers through the init callback, so nothing exists until the Settings screen initializes.
assert.equal(present().length, 0, "no option is added before the Options screen initializes");
Options.init();
assert.deepEqual(present(), CD_IDS, "the screen's init adds every Cultural Diffusion option, in display order");

const buffer = Options.data.get("cd-growth-buffer");
assert.equal(buffer.label, "LOC_OPTIONS_CD_BUFFER", "the +1 ring buffer toggle is labelled");
assert.equal(buffer.description, "LOC_OPTIONS_CD_BUFFER_DESCRIPTION", "...and described");
assert.equal(buffer.currentValue, CONFIG_DEFAULTS.growthBuffer, "...and shows the shipped default on a fresh profile");

// The old registration, for contrast: an option added with a bare addOption at load does not survive a rebuild.
Options.addOption({ id: "bare-at-load", type: 1 });
Options.reInitOptions(); // e.g. GraphicsOptionsChanged when Settings applies or closes
Options.init();          // the next time the screen opens
assert.equal(Options.data.has("bare-at-load"), false, "fixture: a bare addOption is wiped by reInitOptions");
assert.deepEqual(present(), CD_IDS, "every Cultural Diffusion option comes back after the rebuild (the reported bug)");

Options.reInitOptions(); Options.init();
Options.reInitOptions(); Options.init();
assert.deepEqual(present(), CD_IDS, "the options survive repeated rebuilds");
assert.equal(registrations(), 1, "registered once, not once per rebuild");

// Late path: installing after the model has initialized makes addInitCallback throw. The options register now and
// stay on the rebuild list, without a duplicate.
assert.equal(installOptions(Options), "late", "installing after initialization takes the late path instead of throwing");
assert.equal(registrations(), 1, "...without registering twice");
Options.reInitOptions(); Options.init();
assert.deepEqual(present(), CD_IDS, "...and the options still come back after the next rebuild");

const lateModel = { optionsReInitCallbacks: [], addInitCallback() { throw new Error("Options already initialized"); } };
assert.equal(installOptions(lateModel), "late", "a model that refuses new callbacks still gets the options");
assert.ok(lateModel.optionsReInitCallbacks.includes(registerAll), "...and keeps them on its rebuild list");

const brokenModel = { get optionsReInitCallbacks() { throw new Error("no model"); }, addInitCallback() { throw new Error("no model"); } };
assert.equal(installOptions(brokenModel), "unavailable", "a context without a usable Options model is skipped, not thrown");

console.log("options.mjs OK");
