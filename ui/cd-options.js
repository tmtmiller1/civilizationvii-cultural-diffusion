// cd-options.js
//
// Registers Cultural Diffusion's settings under the shared "Mods" tab of the
// Options screen, in BOTH shell and game scopes. Kept separate from cd-settings.js
// so the gameplay loop never depends on the Options-screen chunk loading.
//
// Controls:
//   - Intensity preset (Custom / Low / Medium / High) - the simple knob.
//   - Enable diffusion (master switch).
//   - Claim only unowned land (safety mode).
//   - Debug logging.
//
// The flip verb is NOT exposed here: claimed tiles are always integrated into the nearest
// city (CONFIG.flipVerb = "purchasePlot", refunded to net-free). The legacy free-but-orphan
// setOwnership path remains a code-only escape hatch in cd-config.js / cd-ownership.js.

import { CategoryType, OptionType, Options } from "/core/ui/options/model-options.js";
import { CategoryData } from "/core/ui/options/options-helpers.js";
import {
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
  getCoreProtectIndex,
  setCoreProtectIndex,
  getRequireAdjacency,
  setRequireAdjacency,
  getDebug,
  setDebug
} from "/cultural-diffusion/ui/cd-settings.js";
import { PRESET_NAMES } from "/cultural-diffusion/ui/cd-config.js";

// Create/reuse the community-convention shared "Mods" Options category (idempotent).
if (!CategoryType.Mods) CategoryType["Mods"] = "mods";
if (!CategoryData[CategoryType.Mods]) {
  CategoryData[CategoryType.Mods] = {
    title: "LOC_UI_CONTENT_MGR_SUBTITLE",
    description: "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION"
  };
}

// Underscore token: the engine derives the group header LOC key as
// `LOC_OPTIONS_GROUP_${group.toUpperCase()}`, so this must match the tag
// defined in text/*/ModText.xml (LOC_OPTIONS_GROUP_CULTURAL_DIFFUSION).
const GROUP = "cultural_diffusion";

const PRESET_ITEMS = PRESET_NAMES.map((n) => ({ label: "LOC_CD_PRESET_" + n.toUpperCase() }));
const CORE_ITEMS = [
  { label: "LOC_OPTIONS_CD_CORE_FULL" },   // protect the rival's whole downtown ring
  { label: "LOC_OPTIONS_CD_CORE_CENTER" }, // protect only the city-center plot (bite ring-1 inward)
  { label: "LOC_OPTIONS_CD_CORE_NONE" }    // protect nothing (even the center can flip)
];

/** Register the intensity preset dropdown. */
function registerPreset() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Dropdown,
    id: "cd-preset",
    initListener: (/** @type {*} */ info) => (info.selectedItemIndex = getPresetIndex()),
    updateListener: (/** @type {*} */ _i, /** @type {number} */ v) => setPresetIndex(v),
    label: "LOC_OPTIONS_CD_PRESET",
    description: "LOC_OPTIONS_CD_PRESET_DESCRIPTION",
    dropdownItems: PRESET_ITEMS
  });
}

/** Register the master enable checkbox. */
function registerEnabled() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id: "cd-enabled",
    initListener: (/** @type {*} */ info) => (info.currentValue = getDiffusionEnabled()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => setDiffusionEnabled(v),
    label: "LOC_OPTIONS_CD_ENABLED",
    description: "LOC_OPTIONS_CD_ENABLED_DESCRIPTION"
  });
}

/** Register the "claim only unowned land" safety checkbox. */
function registerClaimOnly() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id: "cd-claim-only",
    initListener: (/** @type {*} */ info) => (info.currentValue = getClaimOnlyUnowned()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => setClaimOnlyUnowned(v),
    label: "LOC_OPTIONS_CD_CLAIM_ONLY",
    description: "LOC_OPTIONS_CD_CLAIM_ONLY_DESCRIPTION"
  });
}

/** Register the core-protection dropdown (how deep into a rival's rings culture may bite). */
function registerCoreProtect() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Dropdown,
    id: "cd-core-protect",
    initListener: (/** @type {*} */ info) => (info.selectedItemIndex = getCoreProtectIndex()),
    updateListener: (/** @type {*} */ _i, /** @type {number} */ v) => setCoreProtectIndex(v),
    label: "LOC_OPTIONS_CD_CORE",
    description: "LOC_OPTIONS_CD_CORE_DESCRIPTION",
    dropdownItems: CORE_ITEMS
  });
}

/** Register the require-adjacency checkbox (organic contiguous front vs. enclave flips). */
function registerAdjacency() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id: "cd-require-adjacency",
    initListener: (/** @type {*} */ info) => (info.currentValue = getRequireAdjacency()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => setRequireAdjacency(v),
    label: "LOC_OPTIONS_CD_ADJACENCY",
    description: "LOC_OPTIONS_CD_ADJACENCY_DESCRIPTION"
  });
}

/** Register the fused-model checkbox. */
function registerFused() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id: "cd-fused",
    initListener: (/** @type {*} */ info) => (info.currentValue = getFusedModel()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => setFusedModel(v),
    label: "LOC_OPTIONS_CD_FUSED",
    description: "LOC_OPTIONS_CD_FUSED_DESCRIPTION"
  });
}

/** Register the use-emigration checkbox. */
function registerEmigration() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id: "cd-emigration",
    initListener: (/** @type {*} */ info) => (info.currentValue = getUseEmigration()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => setUseEmigration(v),
    label: "LOC_OPTIONS_CD_EMIGRATION",
    description: "LOC_OPTIONS_CD_EMIGRATION_DESCRIPTION"
  });
}

/** Register the debug-logging checkbox. */
function registerDebug() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id: "cd-debug",
    initListener: (/** @type {*} */ info) => (info.currentValue = getDebug()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => setDebug(v),
    label: "LOC_OPTIONS_CD_DEBUG",
    description: "LOC_OPTIONS_CD_DEBUG_DESCRIPTION"
  });
}

try {
  registerPreset();
  registerEnabled();
  registerClaimOnly();
  registerCoreProtect();
  registerAdjacency();
  registerFused();
  registerEmigration();
  registerDebug();
} catch (_) {
  /* Options screen not available in this context - ignore. */
}
