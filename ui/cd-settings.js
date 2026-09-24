// cd-settings.js
//
// Runtime bridge between the Options screen and the live CONFIG. Reads/writes the player's
// choices through a cascade-safe per-mod localStorage store and pushes them into CONFIG at boot
// and at the start of every pass, so a change in the Options screen takes effect next pass.
//
// The store is INLINED here (not imported from a standalone file): GameFace's module
// linker treats an import-less UIScript as a classic script and won't expose its
// exports, so the store must live in a module that always has imports.

import { CONFIG, CONFIG_DEFAULTS, PRESETS, PRESET_NAMES } from "/cultural-diffusion/ui/cd-config.js";

const MOD_ID = "cultural-diffusion";
const OPT_PRESET = "preset"; // 0 = Custom, then Low/Medium/High
const OPT_ENABLED = "diffusionEnabled";
const OPT_CLAIM_ONLY = "claimOnlyUnowned";
const OPT_FUSED = "fusedModel";
const OPT_EMIGRATION = "useEmigration";
const OPT_DEBUG = "debug";
const OPT_CORE = "coreProtect";      // 0 = Full downtown ring, 1 = Center only, 2 = None
const OPT_ADJACENCY = "requireAdjacency";
const OPT_PRESSURE_LENS = "pressureLens"; // read-only Cultural Pressure map lens (UI only)
const OPT_RECEDE = "recedeBorders";        // opt-in: claimed tiles can be ceded to a rival
const OPT_BUFFER = "growthBuffer";         // +1 ring: claim unowned tiles beside a newly finished rural improvement

// Core-protection dropdown index -> ring radius that never flips (see cd-config coreProtectRadius).
const CORE_RADIUS_BY_INDEX = [1, 0, -1];

/**
 * Cascade-safe per-mod settings store over a single shared "modSettings" localStorage
 * key. Never wipes a sibling mod's slice (mirrors emigration's ModOptionsStore).
 */
class ModOptionsStore {
  /**
   * Read the shared root for a WRITE without ever destroying a sibling's slice.
   * @returns {{root: Record<string, *>, safe: boolean}} Root + whether it is safe to write.
   * @private
   */
  _readForWrite() {
    let raw = null;
    try {
      raw = localStorage.getItem("modSettings");
      if (!raw) raw = localStorage.getItem("modSettings"); // defeat a flaky empty read
    } catch (_) {
      return { root: {}, safe: false };
    }
    if (!raw) return { root: {}, safe: true };
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return { root: {}, safe: false };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { root: {}, safe: false };
    // Coherent's getItem() in this UI context IGNORES the key and returns the FIRST key's value, so
    // this read can hand back another mod's blob; writing that back would copy it into the shared key.
    // A real settings root has only object values, so on a mismatch decline to persist - never rewrite.
    const looksLikeSettingsRoot = Object.keys(parsed).every((k) => {
      const v = parsed[k];
      return !!v && typeof v === "object" && !Array.isArray(v);
    });
    if (!looksLikeSettingsRoot) return { root: {}, safe: false };
    return { root: parsed, safe: true };
  }

  /**
   * Persist one value, only ever touching our own slice.
   * @param {string} modID Mod id. @param {string} optionID Option id. @param {*} value Value.
   */
  save(modID, optionID, value) {
    try {
      const { root, safe } = this._readForWrite();
      if (!safe) return;
      (root[modID] ??= {})[optionID] = value;
      localStorage.setItem("modSettings", JSON.stringify(root));
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Read one value.
   * @param {string} modID Mod id. @param {string} optionID Option id.
   * @returns {*} The value, or null.
   */
  load(modID, optionID) {
    try {
      const raw = localStorage.getItem("modSettings");
      if (!raw) return null;
      const all = JSON.parse(raw);
      return all?.[modID]?.[optionID] ?? null;
    } catch (_) {
      return null;
    }
  }
}

const ModOptions = new ModOptionsStore();

// -- preset ---------------------------------------------------------

/**
 * The saved intensity-preset index (0 = Custom). Defaults to Medium (index 2) on a
 * fresh profile so the mod has sensible behaviour out of the box.
 * @returns {number} Preset index.
 */
export function getPresetIndex() {
  const v = ModOptions.load(MOD_ID, OPT_PRESET);
  if (typeof v === "number" && v >= 0 && v < PRESET_NAMES.length) return v;
  return PRESET_NAMES.indexOf("Medium");
}

/**
 * Persist a preset selection.
 * @param {number} index Preset index.
 */
export function setPresetIndex(index) {
  const i = typeof index === "number" && index >= 0 && index < PRESET_NAMES.length ? index : 0;
  ModOptions.save(MOD_ID, OPT_PRESET, i);
}

// -- boolean / verb toggles -----------------------------------------

/** @param {string} opt Option id. @param {boolean} dflt Default. @returns {boolean} Stored bool. */
function loadBool(opt, dflt) {
  const v = ModOptions.load(MOD_ID, opt);
  if (v === 1 || v === true) return true;
  if (v === 0 || v === false) return false;
  return dflt;
}

/** @returns {boolean} Whether diffusion is enabled. */
export function getDiffusionEnabled() {
  return loadBool(OPT_ENABLED, CONFIG_DEFAULTS.diffusionEnabled);
}
/** @param {boolean} on Enable flag. */
export function setDiffusionEnabled(on) {
  ModOptions.save(MOD_ID, OPT_ENABLED, on ? 1 : 0);
}

/** @returns {boolean} Whether only unowned land may be claimed. */
export function getClaimOnlyUnowned() {
  return loadBool(OPT_CLAIM_ONLY, CONFIG_DEFAULTS.claimOnlyUnowned);
}
/** @param {boolean} on Claim-only flag. */
export function setClaimOnlyUnowned(on) {
  ModOptions.save(MOD_ID, OPT_CLAIM_ONLY, on ? 1 : 0);
}

/** @returns {boolean} Whether the fused cultural model is on. */
export function getFusedModel() {
  return loadBool(OPT_FUSED, CONFIG_DEFAULTS.fusedModel);
}
/** @param {boolean} on Fused-model flag. */
export function setFusedModel(on) {
  ModOptions.save(MOD_ID, OPT_FUSED, on ? 1 : 0);
}

/** @returns {boolean} Whether emigration-mod reads (ethnic affinity) are enabled. */
export function getUseEmigration() {
  return loadBool(OPT_EMIGRATION, CONFIG_DEFAULTS.useEmigration);
}
/** @param {boolean} on Use-emigration flag. */
export function setUseEmigration(on) {
  ModOptions.save(MOD_ID, OPT_EMIGRATION, on ? 1 : 0);
}

/** @returns {boolean} Whether verbose logging is on. */
export function getDebug() {
  return loadBool(OPT_DEBUG, CONFIG_DEFAULTS.debug);
}
/** @param {boolean} on Debug flag. */
export function setDebug(on) {
  ModOptions.save(MOD_ID, OPT_DEBUG, on ? 1 : 0);
}

/**
 * Core-protection dropdown index (0 = Full downtown ring, 1 = Center only, 2 = None).
 * Defaults to the index whose radius matches the shipped `coreProtectRadius` default.
 * @returns {number} Dropdown index.
 */
export function getCoreProtectIndex() {
  const v = ModOptions.load(MOD_ID, OPT_CORE);
  if (typeof v === "number" && v >= 0 && v < CORE_RADIUS_BY_INDEX.length) return v;
  const def = CORE_RADIUS_BY_INDEX.indexOf(CONFIG_DEFAULTS.coreProtectRadius);
  return def >= 0 ? def : 1;
}
/** @param {number} index Dropdown index. */
export function setCoreProtectIndex(index) {
  const i = typeof index === "number" && index >= 0 && index < CORE_RADIUS_BY_INDEX.length ? index : 1;
  ModOptions.save(MOD_ID, OPT_CORE, i);
}

/** @returns {boolean} Whether the organic contiguous front (adjacency) is required. */
export function getRequireAdjacency() {
  return loadBool(OPT_ADJACENCY, CONFIG_DEFAULTS.requireAdjacency);
}
/** @param {boolean} on Adjacency flag. */
export function setRequireAdjacency(on) {
  ModOptions.save(MOD_ID, OPT_ADJACENCY, on ? 1 : 0);
}

/**
 * Whether the read-only Cultural Pressure map lens registers its lens-panel button + hotkey. Default
 * ON. This is a pure UI toggle (the lens changes nothing about the sim), so - unlike the territory
 * toggles - it does NOT feed into CONFIG or the pass; the lens UIScript reads it directly.
 * @returns {boolean} Whether the pressure lens is enabled.
 */
export function getPressureLensEnabled() {
  return loadBool(OPT_PRESSURE_LENS, true);
}
/** @param {boolean} on Pressure-lens flag. */
export function setPressureLensEnabled(on) {
  ModOptions.save(MOD_ID, OPT_PRESSURE_LENS, on ? 1 : 0);
}

/**
 * Whether claimed tiles can be lost again (ceded to a decisive rival). Opt-in, OFF by default.
 * @returns {boolean} Whether borders recede.
 */
export function getRecedeBorders() {
  return loadBool(OPT_RECEDE, CONFIG_DEFAULTS.recedeBorders);
}
/** @param {boolean} on Recede flag. */
export function setRecedeBorders(on) {
  ModOptions.save(MOD_ID, OPT_RECEDE, on ? 1 : 0);
}

/**
 * Whether finishing a rural improvement also claims the unowned tiles right beside it (the "+1 ring" buffer).
 * Defaults to the shipped CONFIG value.
 * @returns {boolean} Whether the growth buffer is on.
 */
export function getGrowthBuffer() {
  return loadBool(OPT_BUFFER, CONFIG_DEFAULTS.growthBuffer);
}
/** @param {boolean} on Growth-buffer flag. */
export function setGrowthBuffer(on) {
  ModOptions.save(MOD_ID, OPT_BUFFER, on ? 1 : 0);
}

// -- apply to live CONFIG -------------------------------------------

/**
 * Reset the preset-controlled keys to their shipped defaults (so switching from a
 * heavier preset to a lighter one never leaves a stale, higher value behind).
 * @private
 */
function resetPresetKeys() {
  for (const profile of Object.values(PRESETS)) {
    for (const k of Object.keys(profile)) {
      /** @type {Record<string, *>} */ (CONFIG)[k] = /** @type {Record<string, *>} */ (CONFIG_DEFAULTS)[k];
    }
  }
}

/**
 * Push every saved setting into the live CONFIG. Call at boot and at the top of each
 * pass. Order: defaults -> preset profile -> individual toggles (toggles win).
 */
export function applyTunableOverrides() {
  resetPresetKeys();
  const profile = PRESETS[PRESET_NAMES[getPresetIndex()]];
  if (profile) {
    for (const k of Object.keys(profile)) {
      /** @type {Record<string, *>} */ (CONFIG)[k] = /** @type {Record<string, *>} */ (profile)[k];
    }
  }
  CONFIG.diffusionEnabled = getDiffusionEnabled();
  CONFIG.claimOnlyUnowned = getClaimOnlyUnowned();
  // flipVerb is intentionally NOT overridden from settings: it stays at its CONFIG default
  // ("purchasePlot", integrated). Change it only in code (cd-config.js) for testing.
  CONFIG.fusedModel = getFusedModel();
  CONFIG.useEmigration = getUseEmigration();
  CONFIG.coreProtectRadius = CORE_RADIUS_BY_INDEX[getCoreProtectIndex()];
  CONFIG.requireAdjacency = getRequireAdjacency();
  CONFIG.recedeBorders = getRecedeBorders();
  CONFIG.growthBuffer = getGrowthBuffer();
  CONFIG.debug = getDebug();
}

export { MOD_ID };
