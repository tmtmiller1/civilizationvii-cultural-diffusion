// cd-terrain.js
//
// Terrain modifiers for one source->neighbor diffusion step (docs/current-model.md §2, ported from
// Civ V DiffuseCulture): culture follows roads/rivers and is slowed or stopped crossing rough ground.
// Map API used:
//   - GameplayMap.getTerrainType(x,y) -> GameInfo.Terrains.lookup(id).TerrainType   (TERRAIN_HILL / TERRAIN_MOUNTAIN)
//   - GameplayMap.getBiomeType(x,y)   -> GameInfo.Biomes.lookup(id).BiomeType        (BIOME_TUNDRA / BIOME_DESERT)
//   - GameplayMap.getFeatureType(x,y) -> GameInfo.Features.lookup(id).FeatureType
//       (FEATURE_FOREST / _RAINFOREST / _MARSH / _TAIGA ...)
//   - GameplayMap.isMountain(x,y)     -> bool
//   - GameplayMap.getRiverType(x,y)   -> RiverTypes.NO_RIVER | RIVER_MINOR | RIVER_NAVIGABLE
//   - GameplayMap.isNavigableRiver(x,y) -> bool; GameplayMap.getRiverName(x,y) -> LOC key or ""
//   - GameplayMap.getRouteType(x,y)   -> route id (0 / none when absent)
//
// Civ VII splits TERRAIN from BIOME (no "snow"); terrain, biome and feature modifiers on the
// destination tile STACK.
//
// Rivers (docs/civ-v-parity-spec.md §1). Civ V rivers ran along tile edges and were a highway ALONG a
// bank and a wall ACROSS it. Civ VII rivers are tiles, of two kinds: a minor river is a property of a
// land tile, a navigable river is its own terrain (TERRAIN_NAVIGABLE_RIVER, Water=0 in Terrains). The
// same rule is kept on tiles: a step from one tile of a river to the next FOLLOWS it (bonus, bigger for
// a navigable river), a step onto a river from anywhere else CROSSES into it (a gated malus, paid once
// on the way in), and a step off a river carries no river modifier.
//
// Every read is defensive: an unreadable value omits that modifier (or, for
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

/** A finite number, else the fallback. @param {*} v @param {number} d @returns {number} */
function num(v, d) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/** Whether a plot is a mountain (isMountain, else the terrain type name). @param {number} x @param {number} y */
function isMountainAt(x, y) {
  if (safe(() => GameplayMap?.isMountain?.(x, y), null) === true) return true;
  return terrainType(x, y).includes("MOUNTAIN");
}

/**
 * The stock a SOURCE tile needs before it diffuses at all (Civ V PlotCultureThreshold): the base threshold, or
 * `sourceThresholdMountain` times it on a mountain. Culture parked on a peak barely leaks off it.
 * @param {{x:number,y:number}} src Source plot.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Source threshold.
 */
export function sourceThreshold(src, cfg) {
  const base = Math.max(0, num(cfg.cultureThreshold, 100));
  const mult = Math.max(1, num(cfg.sourceThresholdMountain, 1));
  return isMountainAt(src.x, src.y) ? base * mult : base;
}

/**
 * The river kind on a plot: "navigable", "minor" or "" (no river). Navigable is read three ways
 * (isNavigableRiver, the terrain type, RiverTypes.RIVER_NAVIGABLE) so a missing API or enum on one
 * game build never demotes a navigable river to a minor one.
 * @param {number} x @param {number} y
 * @returns {""|"minor"|"navigable"} River kind.
 */
function riverKind(x, y) {
  if (safe(() => !!GameplayMap?.isNavigableRiver?.(x, y), false)) return "navigable";
  if (terrainType(x, y).includes("NAVIGABLE_RIVER")) return "navigable";
  return riverKindFromType(safe(() => GameplayMap?.getRiverType?.(x, y), null));
}

/** Map a RiverTypes value to a kind; anything but NO_RIVER that is not navigable is a minor river. */
function riverKindFromType(r) {
  if (typeof r !== "number" || r < 0) return "";
  const RT = safe(() => RiverTypes, null) || {};
  if (RT.RIVER_NAVIGABLE != null && r === RT.RIVER_NAVIGABLE) return "navigable";
  return r !== num(RT.NO_RIVER, 0) ? "minor" : "";
}

/** The river's name on a plot (a LOC key), or "" when unnamed or unreadable. */
function riverName(x, y) {
  return safe(() => {
    const n = GameplayMap?.getRiverName?.(x, y);
    return typeof n === "string" ? n : "";
  }, "");
}

/**
 * Whether two adjacent river tiles belong to the same river. Two different names mean two rivers
 * (a confluence is a crossing, not a follow); a missing name on either side is taken as the same river.
 */
function sameRiver(a, b) {
  const na = riverName(a.x, a.y);
  const nb = riverName(b.x, b.y);
  return !na || !nb || na === nb;
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
 * Compute the diffusion modifiers for a single source->neighbor step.
 * @param {{x:number,y:number}} src Source plot.
 * @param {{x:number,y:number}} dst Neighbor plot.
 * @param {number} sourceValue The diffusing civ's culture on the source (for crossing gates).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {import("/cultural-diffusion/ui/cd-field.js").StepMods} Modifiers for cd-field.diffusionDelivered.
 */
export function stepMods(src, dst, sourceValue, cfg) {
  const dstRiver = riverKind(dst.x, dst.y);
  // A navigable river is river terrain, never open water, even on a build where isWater calls it wet.
  if (dstRiver !== "navigable" && isWater(dst)) {
    if (!cfg.diffuseAcrossWater) return { blocked: true, bonus: 0, malus: 0, maxFactor: 0 };
    return waterStep(dst, sourceValue, cfg);
  }
  return landStep(src, dst, dstRiver, sourceValue, cfg);
}

/**
 * Crossing result for a LAND or RIVER destination: road and river-follow carry bonus, then the stacked
 * gates (a river crossing, plus the destination's terrain, biome and feature; a navigable channel has
 * no land terrain of its own, so only the crossing applies to it).
 */
function landStep(src, dst, dstRiver, sourceValue, cfg) {
  const road = roadBonus(src, dst, cfg);
  const river = riverStep(src, dst, dstRiver, cfg);
  let bonus = road.bonus + river.bonus;
  let malus = 0;
  let maxFactor = road.maxFactor * river.maxFactor;

  const gates = [river.cross].concat(dstRiver === "navigable" ? [] : crossingMods(dst.x, dst.y, cfg));
  const gateBase = Math.max(0, cfg.cultureThreshold);
  for (const mod of gates.filter(Boolean)) {
    if (sourceValue <= gateBase * Math.max(0, mod.threshold)) {
      // Below this terrain's crossing gate: culture cannot enter it yet.
      return { blocked: true, bonus: 0, malus: 0, maxFactor: 0 };
    }
    malus += Math.max(0, mod.malus);
    maxFactor *= Math.max(0, mod.max);
  }
  return { blocked: false, bonus, malus, maxFactor };
}

/** Road carry bonus: culture travels farther when both tiles carry a route. */
function roadBonus(src, dst, cfg) {
  if (!(hasRoute(src.x, src.y) && hasRoute(dst.x, dst.y))) return { bonus: 0, maxFactor: 1 };
  return { bonus: Math.max(0, num(cfg.roadBonus, 0)), maxFactor: Math.max(1, num(cfg.roadMax, 1)) };
}

/**
 * The river part of one step, by the kinds of the two tiles:
 * - no river on the destination (off a river, or away from one): no river modifier;
 * - same kind and same river on both tiles: FOLLOW - navigableFollow* for a navigable channel,
 *   riverFollow* for a minor river;
 * - anything else onto a river (a bank, the other kind, a different river): CROSS into it with that
 *   kind's gate (terrainNavigableCross / terrainRiverCross).
 * @param {{x:number,y:number}} src @param {{x:number,y:number}} dst
 * @param {""|"minor"|"navigable"} dstRiver Destination river kind.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg
 * @returns {{bonus:number, maxFactor:number, cross:(import("/cultural-diffusion/ui/cd-config.js").CrossMod|null)}}
 */
function riverStep(src, dst, dstRiver, cfg) {
  if (!dstRiver) return { bonus: 0, maxFactor: 1, cross: null };
  const nav = dstRiver === "navigable";
  if (riverKind(src.x, src.y) === dstRiver && sameRiver(src, dst)) {
    return {
      bonus: Math.max(0, num(nav ? cfg.navigableFollowBonus : cfg.riverFollowBonus, 0)),
      maxFactor: Math.max(1, num(nav ? cfg.navigableFollowMax : cfg.riverFollowMax, 1)),
      cross: null
    };
  }
  return { bonus: 0, maxFactor: 1, cross: (nav ? cfg.terrainNavigableCross : cfg.terrainRiverCross) || null };
}
