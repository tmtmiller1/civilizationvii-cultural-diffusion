// cd-terrain.js
//
// Terrain modifiers for one source->neighbour diffusion step (docs/current-model.md §2, ported from
// Civ V DiffuseCulture): culture follows roads/rivers and is slowed or stopped crossing rough ground.
// Map API used:
//   - GameplayMap.getTerrainType(x,y) -> GameInfo.Terrains.lookup(id).TerrainType   (TERRAIN_HILL / TERRAIN_MOUNTAIN)
//   - GameplayMap.getBiomeType(x,y)   -> GameInfo.Biomes.lookup(id).BiomeType        (BIOME_TUNDRA / BIOME_DESERT)
//   - GameplayMap.getFeatureType(x,y) -> GameInfo.Features.lookup(id).FeatureType
//       (FEATURE_FOREST / _RAINFOREST / _MARSH / _TAIGA ...)
//   - GameplayMap.isMountain(x,y)     -> bool
//   - GameplayMap.getRiverType(x,y)   -> RiverTypes.NO_RIVER | RIVER_MINOR | RIVER_NAVIGABLE
//   - GameplayMap.getRouteType(x,y)   -> route id (0 / none when absent)
//
// Civ VII splits TERRAIN from BIOME (no "snow"); terrain, biome and feature modifiers on the
// destination tile STACK. Every read is defensive: an unreadable value omits that modifier (or, for
// water, blocks).

import { isWater } from "/cultural-diffusion/ui/cd-plots.js";

/** @param {()=>*} fn @param {*} fallback @returns {*} */
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

/** UPPERCASE type string for a plot's terrain (or ""). */
function terrainType(x, y) {
  return safe(() => {
    const id = GameplayMap?.getTerrainType?.(x, y);
    if (id == null || id < 0) return "";
    const t = GameInfo?.Terrains?.lookup?.(id)?.TerrainType;
    return typeof t === "string" ? t.toUpperCase() : "";
  }, "");
}

/** UPPERCASE type string for a plot's biome (or ""). */
function biomeType(x, y) {
  return safe(() => {
    const id = GameplayMap?.getBiomeType?.(x, y);
    if (id == null || id < 0) return "";
    const t = GameInfo?.Biomes?.lookup?.(id)?.BiomeType;
    return typeof t === "string" ? t.toUpperCase() : "";
  }, "");
}

/** UPPERCASE type string for a plot's feature (or ""). */
function featureType(x, y) {
  return safe(() => {
    const id = GameplayMap?.getFeatureType?.(x, y);
    if (id == null || id < 0) return "";
    const t = GameInfo?.Features?.lookup?.(id)?.FeatureType;
    return typeof t === "string" ? t.toUpperCase() : "";
  }, "");
}

/** Whether a plot lies on a river (culture flows along river valleys). */
function onRiver(x, y) {
  return safe(() => {
    const r = GameplayMap?.getRiverType?.(x, y);
    const none = typeof RiverTypes !== "undefined" && RiverTypes.NO_RIVER != null ? RiverTypes.NO_RIVER : 0;
    return typeof r === "number" && r !== none && r >= 0;
  }, false);
}

/** Whether a plot carries a route (road/rail). */
function hasRoute(x, y) {
  return safe(() => {
    const r = GameplayMap?.getRouteType?.(x, y);
    return typeof r === "number" && r > 0;
  }, false);
}

/** The biome crossing modifier for a plot, or null when the biome isn't gated. */
function biomeMod(x, y, cfg) {
  const biome = biomeType(x, y);
  if (biome.includes("TUNDRA")) return cfg.terrainTundra;
  if (biome.includes("DESERT")) return cfg.terrainDesert;
  return null;
}

/** The feature crossing modifier for a plot, or null when the feature isn't gated. */
function featureMod(x, y, cfg) {
  const feat = featureType(x, y);
  if (feat.includes("MARSH") || feat.includes("BOG") || feat.includes("MANGROVE")) return cfg.terrainMarsh;
  if (feat.includes("RAINFOREST")) return cfg.terrainJungle;
  if (feat.includes("FOREST") || feat.includes("TAIGA") || feat.includes("WOODLAND")) return cfg.terrainForest;
  return null;
}

/**
 * Accumulate every crossing modifier that applies to the DESTINATION tile (terrain + biome +
 * feature stack). Mountains dominate (near-impassable), matching their gameplay role.
 * @param {number} x @param {number} y
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg
 * @returns {import("/cultural-diffusion/ui/cd-config.js").CrossMod[]} Applicable modifiers.
 */
/**
 * Crossing result for a WATER destination (only reached when diffuseAcrossWater): deep ocean uses
 * the near-impassable terrainOcean gate, shallow water the easier terrainCoast gate. Below the
 * gate, culture cannot cross yet - so only an established/overwhelming culture spans open water.
 * @param {{x:number,y:number}} dst @param {number} sourceValue
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg
 * @returns {{blocked:boolean, bonus:number, malus:number, maxFactor:number}} Step result.
 */
function waterStep(dst, sourceValue, cfg) {
  const wm = terrainType(dst.x, dst.y).includes("OCEAN") ? cfg.terrainOcean : cfg.terrainCoast;
  const gate = Math.max(0, cfg.cultureThreshold) * Math.max(0, wm.threshold);
  if (sourceValue <= gate) return { blocked: true, bonus: 0, malus: 0, maxFactor: 0 };
  return { blocked: false, bonus: 0, malus: Math.max(0, wm.malus), maxFactor: Math.max(0, wm.max) };
}

/** The crossing modifiers that apply to the DESTINATION land tile (terrain + biome + feature). */
function crossingMods(x, y, cfg) {
  if (safe(() => !!GameplayMap?.isMountain?.(x, y), false)) return [cfg.terrainMountain];
  const terr = terrainType(x, y);
  if (terr.includes("MOUNTAIN")) return [cfg.terrainMountain];

  /** @type {import("/cultural-diffusion/ui/cd-config.js").CrossMod[]} */
  const mods = [];
  if (terr.includes("HILL")) mods.push(cfg.terrainHills);
  mods.push(biomeMod(x, y, cfg));
  mods.push(featureMod(x, y, cfg));
  return mods.filter(Boolean);
}

/**
 * Compute the diffusion modifiers for a single source->neighbour step.
 * @param {{x:number,y:number}} src Source plot.
 * @param {{x:number,y:number}} dst Neighbour plot.
 * @param {number} sourceValue The diffusing civ's culture on the source (for crossing gates).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {import("/cultural-diffusion/ui/cd-field.js").StepMods} Modifiers for cd-field.diffusionDelivered.
 */
export function stepMods(src, dst, sourceValue, cfg) {
  if (isWater(dst)) {
    if (!cfg.diffuseAcrossWater) return { blocked: true, bonus: 0, malus: 0, maxFactor: 0 };
    return waterStep(dst, sourceValue, cfg);
  }
  return landStep(src, dst, sourceValue, cfg);
}

/** Crossing result for a LAND destination: road/river carry-bonus, then stacked terrain gates. */
function landStep(src, dst, sourceValue, cfg) {
  // Culture carries much farther along roads and river valleys.
  const carry = routeRiverBonus(src, dst, cfg);
  let bonus = carry.bonus;
  let malus = 0;
  let maxFactor = carry.maxFactor;

  const gateBase = Math.max(0, cfg.cultureThreshold);
  for (const mod of crossingMods(dst.x, dst.y, cfg)) {
    if (sourceValue <= gateBase * Math.max(0, mod.threshold)) {
      // Below this terrain's crossing gate: culture cannot enter it yet.
      return { blocked: true, bonus: 0, malus: 0, maxFactor: 0 };
    }
    malus += Math.max(0, mod.malus);
    maxFactor *= Math.max(0, mod.max);
  }
  return { blocked: false, bonus, malus, maxFactor };
}

/** Road/river carry bonus for a land step: culture travels farther along routes and river valleys. */
function routeRiverBonus(src, dst, cfg) {
  let bonus = 0;
  let maxFactor = 1;
  if (hasRoute(src.x, src.y) && hasRoute(dst.x, dst.y)) {
    bonus += Math.max(0, cfg.roadBonus);
    maxFactor *= Math.max(1, cfg.roadMax);
  }
  if (onRiver(dst.x, dst.y)) {
    bonus += Math.max(0, cfg.riverFollowBonus);
    maxFactor *= Math.max(1, cfg.riverFollowMax);
  }
  return { bonus, maxFactor };
}
