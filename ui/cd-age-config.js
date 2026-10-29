// cd-age-config.js
//
// The config the field runs on this turn: CONFIG with the current age's ownership bar, the age pace on the diffusion
// and decay rates, and the water crossings eased by how far sea travel has come. The pass, the Cultural Pressure lens
// and the hover readout all read it from here, so what the map promises is computed on the same numbers the pass
// uses. No import from cd-pass.js: a UIScript module cycle can take down the whole graph in GameFace.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { agePace, mapSizeScale, ageProgress } from "/cultural-diffusion/ui/cd-calibration.js";

const AGE_ORDER = ["ANTIQUITY", "EXPLORATION", "MODERN"];

function ageWaterEase(ageKey) {
  const a = CONFIG.byAge && CONFIG.byAge[ageKey];
  return a && a.waterEase != null ? a.waterEase : 0;
}

/**
 * The waterEase to use right now: this age's anchor, optionally ramped continuously toward the
 * next age's anchor by progress through the current age (Game.turn / Game.maxTurns). So water
 * crossing improves smoothly across an age instead of stepping at the boundary.
 * @param {string} ageKey Current age key.
 * @returns {number} Effective waterEase in [0,1].
 */
export function effectiveWaterEase(ageKey) {
  const cur = ageWaterEase(ageKey);
  if (!CONFIG.waterEaseRamp) return cur;
  const idx = AGE_ORDER.indexOf(ageKey);
  const nextKey = (idx >= 0 && idx < AGE_ORDER.length - 1) ? AGE_ORDER[idx + 1] : ageKey;
  const nxt = ageWaterEase(nextKey);
  const t = Math.min(1, Math.max(0, ageProgress()));
  return cur + (nxt - cur) * t;
}

/**
 * Per-age injection scaling + a time-re-paced copy of CONFIG. Diffusion/decay scale together, so
 * the reach extent is unchanged and only the speed of approach is re-timed.
 * @returns {{ageInject:number, pace:number, ageCfg:import("/cultural-diffusion/ui/cd-config.js").CdConfig}}
 */
export function ageContext() {
  const ageKey = currentAgeKey();
  const age = (CONFIG.byAge && CONFIG.byAge[ageKey]) || { injectionScale: 1, ownerBar: 1 };
  const pace = agePace();
  const mapScale = mapSizeScale();
  const ageInject = Math.max(0, age.injectionScale != null ? age.injectionScale : 1) * mapScale;
  const waterEase = effectiveWaterEase(ageKey);
  const ageCfg = {
    ...CONFIG,
    minimumOwner: CONFIG.minimumOwner * Math.max(0.1, age.ownerBar != null ? age.ownerBar : 1),
    diffusionRate: CONFIG.diffusionRate * pace,
    decayRate: CONFIG.decayRate * pace,
    decayFlat: CONFIG.decayFlat * pace,
    // Water crossing eases as sea travel matures (0 = full malus, 1 = no water penalty).
    terrainCoast: easeCrossing(CONFIG.terrainCoast, waterEase),
    terrainOcean: easeCrossing(CONFIG.terrainOcean, waterEase)
  };
  return { ageInject, pace, ageCfg };
}

/**
 * Ease a water crossing modifier toward "free" by `ease` in [0,1]: 0 returns the modifier
 * unchanged (full malus), 1 returns {malus:0, max:1, threshold:0} (no water penalty at all).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CrossMod} m Base crossing modifier.
 * @param {number} ease Easing fraction.
 * @returns {import("/cultural-diffusion/ui/cd-config.js").CrossMod} Eased modifier.
 */
export function easeCrossing(m, ease) {
  const e = Math.max(0, Math.min(1, ease));
  if (!m) return m;
  return {
    malus: m.malus * (1 - e),
    max: m.max + (1 - m.max) * e,   // toward 1.0 = no neighbor-cap reduction
    threshold: m.threshold * (1 - e) // toward 0 = culture crosses at any strength
  };
}

