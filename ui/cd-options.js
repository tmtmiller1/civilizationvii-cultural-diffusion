// cd-options.js
//
// Registers Cultural Diffusion's settings under the shared "Mods" tab of the Options screen, in BOTH shell and game
// scopes. Kept separate from cd-settings.js so the gameplay loop never depends on the Options-screen chunk loading.
//
// Registration goes through Options.addInitCallback, never a bare addOption at load: the base OptionsModel rebuilds
// its whole option list from its init callbacks whenever reInitOptions() runs (e.g. when the Settings screen applies
// or closes), so options added only at load are wiped by that rebuild.
//
// The flip verb is NOT exposed here: claimed tiles are always integrated into the nearest city (CONFIG.flipVerb =
// "purchasePlot", refunded to net-free). The setOwnership path remains a code-only escape hatch.

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
  getGrowthBuffer,
  setGrowthBuffer,
  getRecedeBorders,
  setRecedeBorders,
  getPressureLensEnabled,
  setPressureLensEnabled,
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

/**
 * One checkbox row in the shared Mods category.
 * @param {string} id Option id. @param {()=>boolean} get Getter. @param {(v:boolean)=>void} set Setter.
 * @param {string} loc LOC key stem (label = stem, description = stem + "_DESCRIPTION").
 */
function addCheckbox(id, get, set, loc) {
  Options.addOption({
    category: CategoryType.Mods,
    group: GROUP,
    type: OptionType.Checkbox,
    id,
    initListener: (/** @type {*} */ info) => (info.currentValue = get()),
    updateListener: (/** @type {*} */ _i, /** @type {boolean} */ v) => set(!!v),
    label: loc,
    description: loc + "_DESCRIPTION"
  });
}

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

/** Every Cultural Diffusion option, in display order. Runs on every Options rebuild. */
export function registerAll() {
  registerPreset();
  addCheckbox("cd-enabled", getDiffusionEnabled, setDiffusionEnabled, "LOC_OPTIONS_CD_ENABLED");
  addCheckbox("cd-claim-only", getClaimOnlyUnowned, setClaimOnlyUnowned, "LOC_OPTIONS_CD_CLAIM_ONLY");
  registerCoreProtect();
  addCheckbox("cd-require-adjacency", getRequireAdjacency, setRequireAdjacency, "LOC_OPTIONS_CD_ADJACENCY");
  addCheckbox("cd-growth-buffer", getGrowthBuffer, setGrowthBuffer, "LOC_OPTIONS_CD_BUFFER");
  addCheckbox("cd-recede", getRecedeBorders, setRecedeBorders, "LOC_OPTIONS_CD_RECEDE");
  addCheckbox("cd-fused", getFusedModel, setFusedModel, "LOC_OPTIONS_CD_FUSED");
  addCheckbox("cd-emigration", getUseEmigration, setUseEmigration, "LOC_OPTIONS_CD_EMIGRATION");
  addCheckbox("cd-pressure-lens", getPressureLensEnabled, setPressureLensEnabled, "LOC_OPTIONS_CD_PRESSURE_LENS");
  addCheckbox("cd-debug", getDebug, setDebug, "LOC_OPTIONS_CD_DEBUG");
}

/**
 * Hook registerAll into an Options model so the options survive every reInitOptions() rebuild. addInitCallback throws
 * when the model has already initialized in this context with no callbacks pending; then register now and append to
 * the model's re-init list directly, so the next rebuild still includes these options.
 * @param {*} model The Options model.
 * @returns {"callback"|"late"|"unavailable"} Which path registered the options.
 */
export function installOptions(model) {
  try {
    model.addInitCallback(registerAll);
    return "callback";
  } catch (_) {
    try {
      registerAll();
      const reinit = model.optionsReInitCallbacks;
      if (Array.isArray(reinit) && reinit.indexOf(registerAll) < 0) reinit.push(registerAll);
      return "late";
    } catch (_e) {
      return "unavailable"; // Options screen not available in this context
    }
  }
}

installOptions(Options);
