// cd-field.js
//
// The PURE reaction-diffusion math for the culture field (docs/cultural-diffusion-spec.md 3b -
// the core adapted from the Civ V "Cultural Diffusion" model). No engine reads live here, so the
// whole propagation can be unit-tested in Node. cd-pass.js owns the persisted field and the
// engine reads (terrain, ownership); it feeds those through these functions.
//
// The model is a cellular automaton over a persisted per-tile, per-civ culture STOCK. Each
// turn a tile DECAYS, DIFFUSES a fraction of its stock to neighbours (capped, terrain- and
// affinity-modified), and cities INJECT new culture into their own tile. Ownership is then a
// read-out of the stock (most culture wins, past absolute + ratio thresholds). Reach is an
// EMERGENT travelling wave - slow and organic - not a closed-form distance calculation.

/** @param {*} v @param {number} [d] @returns {number} */
function num(v, d = 0) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/**
 * Culture a city injects into its OWN tile this turn (Civ V GetCityCulturalOutput, sqrt
 * variant). Self-amplifying: the more culture already present, the faster it grows - so a
 * city's stock climbs from `injectBase` toward its cap over many turns, which is what makes
 * a mature culture project a big stock (and thus reach far) only later in the game.
 * @param {number} strength The city's cultural output (fused projection: culture x CPI x prosperity x celebration).
 * @param {number} currentOwnCulture The owner's culture already on the city tile.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Culture points to add (>= 0).
 */
export function injectionAmount(strength, currentOwnCulture, cfg) {
  const s = Math.max(0, num(strength));
  if (s <= 0) return 0;
  const ratio = Math.max(0, num(cfg.injectRatio, 0.15));
  const base = Math.max(0, num(cfg.injectBase, 10));
  const v = s * Math.sqrt(Math.max(0, num(currentOwnCulture)) * ratio) + base;
  return v > 0 && isFinite(v) ? v : base;
}

/**
 * The cap on total culture a city tile can hold, analogous to Civ V's
 * `(pop+output) * CULTURE_CITY_CAPED_FACTOR`. Bounds the self-amplifying injection.
 * @param {number} strength The city's cultural output.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Max culture on the city tile.
 */
export function cityCultureCap(strength, cfg) {
  return Math.max(0, num(strength)) * Math.max(1, num(cfg.cityCapFactor, 2000));
}

/**
 * Culture lost from a tile's stock this turn (Civ V DecayCulture): a percentage plus a flat
 * point, so small stocks fully dissipate and the front finds an equilibrium the diffusion
 * has to keep pushing against - the constant brake that keeps growth slow and lets borders
 * flow back when a source weakens.
 * @param {number} value Current culture value.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} The value after decay (>= 0).
 */
export function decayValue(value, cfg) {
  const v = Math.max(0, num(value));
  const d = v * Math.max(0, num(cfg.decayRate, 0.05)) + Math.max(0, num(cfg.decayFlat, 1));
  const next = v - d;
  return next > 0 ? next : 0;
}

/**
 * @typedef {Object} StepMods Terrain/affinity modifiers for ONE source->neighbour step.
 * @property {boolean} blocked True when culture cannot cross at all (water, or an ungated feature).
 * @property {number} bonus Additive diffusion-rate bonus fraction (road 1.0 = +100%, river 0.65).
 * @property {number} malus Additive diffusion-rate penalty fraction (0.10 = -ish via 1/(1+malus)).
 * @property {number} maxFactor Multiplier on the base neighbour cap (road x2.5, river x1.8, forest x0.8...).
 */

/**
 * Culture DELIVERED from a source tile to one neighbour this turn (Civ V DiffuseCulture). The
 * neighbour asymptotes to at most `normalMax x maxFactor` (capped by `maxPercent`) of the
 * source, approached at the diffusion rate - so each ring fills over many turns and the wave
 * propagates ring by ring. Returns the ADD to the neighbour's stock (never lowers it).
 * @param {number} sourceValue The diffusing civ's culture on the source tile.
 * @param {number} prevTargetValue The same civ's culture already on the neighbour.
 * @param {StepMods} mods Terrain/affinity modifiers for this step.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Culture to add to the neighbour (>= 0).
 */
export function diffusionDelivered(sourceValue, prevTargetValue, mods, cfg) {
  const src = Math.max(0, num(sourceValue));
  if (src <= Math.max(0, num(cfg.cultureThreshold, 100))) return 0; // below threshold: no diffusion
  if (!mods || mods.blocked) return 0;
  const rate = Math.max(0, num(cfg.diffusionRate, 0.055));
  const bonus = Math.max(0, num(mods.bonus, 0));
  const malus = Math.max(0, num(mods.malus, 0));
  const effRate = (rate * (1 + bonus)) / (1 + malus);

  const normalMax = Math.max(0, num(cfg.normalMax, 0.4));
  const maxPercent = Math.max(0, num(cfg.maxPercent, 0.75));
  const cap = Math.min(src * maxPercent, src * normalMax * Math.max(0, num(mods.maxFactor, 1)));

  const delivered = src * effRate;
  const prev = Math.max(0, num(prevTargetValue));
  const next = Math.min(cap, prev + delivered);
  const add = next - prev;
  return add > 0 && isFinite(add) ? add : 0;
}

/**
 * The strongest living culture on a tile (ignoring dead civs).
 * @param {Record<string, number>} civMap civId -> culture value.
 * @param {number[]} dead Player ids to ignore.
 * @returns {{owner:number, value:number}} Winner + its value (owner -1 when none).
 */
function strongestCulture(civMap, dead) {
  let owner = -1;
  let value = 0;
  for (const key of Object.keys(civMap)) {
    const pid = parseInt(key, 10);
    if (dead.indexOf(pid) >= 0) continue;
    const v = num(civMap[key]);
    if (v > value) { value = v; owner = pid; }
  }
  return { owner, value };
}

/**
 * Resolve who should own a tile from its per-civ culture stock (Civ V UpdatePlotOwnership,
 * the value test only - distance/adjacency/lock are the caller's engine checks). A tile goes
 * to the strongest culture, but only past an absolute floor and (when flipping an owned tile)
 * a decisive ratio over the incumbent - so ownership is stable, not flickery.
 * @param {Record<string, number>} civMap civId -> culture value on the tile.
 * @param {number} currentOwner Current owner player id (-1 = unowned).
 * @param {number[]} deadOwners Player ids to ignore (dead civs).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {{owner:number, value:number, incumbent:number, flip:boolean}} Verdict.
 */
export function resolveOwner(civMap, currentOwner, deadOwners, cfg) {
  const { owner, value } = strongestCulture(civMap, deadOwners || []);
  const minOwner = Math.max(0, num(cfg.minimumOwner, 300));
  const ratio = Math.max(0, num(cfg.flipRatio, 0.65));
  const incumbent = currentOwner >= 0 ? num(civMap[String(currentOwner)]) : 0;
  let flip = false;
  if (owner >= 0 && value > minOwner) {
    if (currentOwner < 0) flip = true;                                   // acquire empty land
    else if (owner !== currentOwner && value * ratio > incumbent) flip = true; // out-culture the incumbent decisively
  }
  return { owner, value, incumbent, flip };
}

/** Test/introspection helpers. */
export const __test = { num };
