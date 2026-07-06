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
//   - Flip verb (Free territory / Buy with gold).
//   - Debug logging.

import { CategoryType, OptionType, Options } from "/core/ui/options/model-options.js";
import { CategoryData } from "/core/ui/options/options-helpers.js";
import {
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

const GROUP = "cultural-diffusion";

const PRESET_ITEMS = PRESET_NAMES.map((n) => ({ label: "LOC_CD_PRESET_" + n.toUpperCase() }));
const VERB_ITEMS = [
  { label: "LOC_OPTIONS_CD_VERB_FREE" },
  { label: "LOC_OPTIONS_CD_VERB_GOLD" }
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

/** Register the flip-verb dropdown. */
function registerVerb() {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Dropdown,
    id: "cd-verb",
    initListener: (/** @type {*} */ info) => (info.selectedItemIndex = getFlipVerbIndex()),
    updateListener: (/** @type {*} */ _i, /** @type {number} */ v) => setFlipVerbIndex(v),
    label: "LOC_OPTIONS_CD_VERB",
    description: "LOC_OPTIONS_CD_VERB_DESCRIPTION",
    dropdownItems: VERB_ITEMS
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
  registerVerb();
  registerFused();
  registerEmigration();
  registerDebug();
} catch (_) {
  /* Options screen not available in this context - ignore. */
}
