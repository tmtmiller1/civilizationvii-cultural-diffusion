// cd-config.js
//
// The DEFAULT VALUES of Cultural Diffusion's tunable settings (see
// docs/cultural-diffusion-spec.md 3b). The settings/options layer
// (cd-settings.js / cd-options.js) overrides these at boot and on each pass via
// applyTunableOverrides. Keep this file PURE: no engine reads, so the field/diffusion
// math can be unit-tested in Node.
//
// The reach model is a Civ V-style REACTION-DIFFUSION over a persisted per-tile culture
// stock (cd-field.js): cities INJECT culture, it DIFFUSES to neighbours (capped, terrain-
// and affinity-modified) and DECAYS each turn, and ownership is read off the stock. Reach is
// an emergent, slow travelling wave. The "fused" knobs (culture/CPI/prosperity/ethnic) shape
// how hard each city INJECTS; the diffusion knobs shape how that stock spreads over time.

/**
 * @typedef {Object} CrossMod Per-terrain diffusion modifier {malus, max, threshold}.
 * @property {number} malus Diffusion-rate penalty fraction crossing into this terrain.
 * @property {number} max Neighbour-cap multiplier (x normalMax) for this terrain.
 * @property {number} threshold Multiple of cultureThreshold the source must exceed to cross at all.
 */

/**
 * @typedef {Object} CdConfig
 * @property {boolean} diffusionEnabled Master switch.
 * @property {boolean} claimOnlyUnowned Safety mode: only claim empty land, never flip owned tiles.
 * @property {string}  flipVerb "purchasePlot" (integrated, default) | "setOwnership" (free but orphan).
 * @property {boolean} refundGold Restore purchasePlot's gold cost the same tick (net-free integrated claims).
 * @property {boolean} repairOrphans Re-integrate legacy orphan tiles each pass so they stop blocking base-game growth.
 * @property {boolean} growthBuffer On rural growth, claim the unowned tiles adjacent to the developed tile (+1 buffer).
 * @property {number}  baseGrowthRadius Base-game max city ring; buffer claims are capped to this + 1 rings out.
 * @property {boolean} diffuseAcrossWater Let the reaction-diffusion field spread across water (with a crossing malus).
 * @property {boolean} blockDistantLandsBeforeExploration Forbid claiming Distant-Lands tiles until the Exploration age.
 * @property {boolean} waterEaseRamp Ramp waterEase continuously across each age (toward the next age's value).
 * @property {number}  turnInterval Run the diffusion pass every N local-player turns.
 * @property {number}  fieldRadius Rings around each local city that the culture field is simulated (compute bound).
 * @property {number}  maxDiffusionPlots Per-city cap on diffusion-claimed plots (safety).
 * @property {number}  maxFlipsPerTurn Global per-pass ceiling on ownership flips (pacing/safety).
 * @property {number}  flipCooldownTurns Turns a freshly flipped tile is locked from re-flipping.
 * @property {number}  coreProtectRadius Rings around a rival city CENTER that never flip:
 *   1 = protect the center + its ring-1 (old "downtown" shield); 0 = protect only the
 *   city-center plot itself (culture can bite ring-1 inward); -1 = protect nothing (even the
 *   center is flippable). Lower = diffusion pushes deeper into a rival's worked footprint.
 * @property {boolean} requireAdjacency Only flip a tile that TOUCHES your existing land
 *   (the organic contiguous front - takes a rival's rings from the outside in). Off = flip
 *   any tile your culture field dominates, even a disconnected pocket inside their territory.
 *
 * -- reaction-diffusion field (Civ V model) --
 * @property {number}  cultureThreshold Min culture on a tile before it diffuses to neighbours.
 * @property {number}  diffusionRate Fraction of a tile's stock delivered to each neighbour per turn (Civ V 5.5%).
 * @property {number}  decayRate Fraction of a tile's stock lost per turn.
 * @property {number}  decayFlat Flat culture lost per turn (dissipates tiny stocks).
 * @property {number}  normalMax Neighbour cap as a fraction of the source (open ground).
 * @property {number}  maxPercent Absolute neighbour cap as a fraction of the source (with road/river bonuses).
 * @property {number}  injectBase Flat culture a city injects into its own tile each turn.
 * @property {number}  injectRatio Self-amplification ratio in the sqrt injection curve.
 * @property {number}  cityCapFactor City-tile culture cap = injection strength x this.
 * @property {number}  minimumOwner Culture a civ needs on a tile before it can own it.
 * @property {number}  flipRatio A flip needs newOwnerCulture x flipRatio > incumbentCulture (0.65 = decisive lead).
 * @property {number}  flipMaxDistance Max tiles from a city a plot may be claimed.
 * @property {number}  roadBonus / roadMax / riverFollowBonus / riverFollowMax Road/river follow
 *   bonus + cap multipliers.
 * @property {CrossMod} terrainHills / terrainMountain Terrain (elevation) crossing modifiers.
 * @property {CrossMod} terrainTundra / terrainDesert Biome crossing modifiers.
 * @property {CrossMod} terrainForest / terrainJungle / terrainMarsh Feature crossing modifiers.
 *
 * -- injection strength shaping (fused 3.1a: culture + CPI + prosperity + ethnic affinity) --
 * @property {boolean} fusedModel Fold CPI + prosperity into a city's injection strength. Off = raw culture only.
 * @property {boolean} useEmigration Read the emigration mod for ethnic-affinity diffusion. Off = base-game only.
 * @property {number}  cultureWeight Weight on a settlement's culture output.
 * @property {number}  cultureExponent alpha in the injection base culture^alpha x vitality^(1-alpha); dilutes
 *   culture spikes (1 = pure culture).
 * @property {number}  happinessAmp Amplitude of the happiness factor.
 * @property {number}  wonderBonus Per-wonder injection amplifier.
 * @property {number}  ageFactor Later-age injection multiplier.
 * @property {number}  prosperityAmp Prosperity swing on a settlement's injection.
 * @property {number}  cpiPowerMin / cpiPowerMax f_power multiplier bounds from a civ's CPI.
 * @property {number}  wLegacy / wFlow / wReach / wVitality / wProsperity / wIdentity CPI dimension weights.
 * @property {number}  ethnicWeight Diffusion toward a civ's diaspora is accelerated by up to this fraction.
 * @property {Object}  byAge Per-age { injectionScale, ownerBar } (ANTIQUITY/EXPLORATION/MODERN)
 *   - damps later-age snowball.
 * @property {boolean} civTuningEnabled Apply the per-leader/civ/memento injection variance table.
 * @property {number}  civTuningStrength Compress that table toward neutral (1 = full, 0 = flat).
 * @property {boolean} calibrateToGameSettings Scale field pace to age length (Game.maxTurns) + injection to map size.
 * @property {number}  paceReferenceTurns Effective diffusion steps per age (the age-pace numerator).
 * @property {number[]} paceBounds [min,max] clamp on the age-pace multiplier.
 * @property {Object}  mapSizeScale MAPSIZE_* -> injection multiplier (smaller maps damped).
 * @property {boolean} debug Verbose logging.
 */

/** @type {CdConfig} */
export const CONFIG = {
  // -- master / safety ----------------------------------------------
  diffusionEnabled: true,
  claimOnlyUnowned: false,
  // The INTEGRATED verb (redesign-plan Phase 1). `purchasePlot` attaches the flipped tile to
  // the nearest city (owningCity set, inCityPlots true), so the tile is a real, workable city
  // plot - NOT the orphan that `setOwnership` produces (owner set but no owning city), which
  // blocks the base game's own population/border growth from ever acquiring that tile. This is
  // now CODE-ONLY (no Options dropdown): every player gets the integrated verb. `setOwnership`
  // survives only for `unclaim` and as a testing escape hatch (set this to "setOwnership").
  // Probe-proven (2026-07-09): purchasePlot integrates, and is effectively free on contiguous
  // frontier tiles - refundGold nets any cost to zero regardless.
  flipVerb: "purchasePlot",
  // Net-zero the gold purchasePlot spends by restoring the balance the same tick via
  // Treasury.changeGoldBalance (invisible to the player and to the demographics gold metrics).
  // The proven "free + integrated" ideal. Turn off to let claims actually cost gold.
  refundGold: true,
  // Each pass, re-integrate any ORPHAN tile (owner === me but no owning city) left by an older
  // setOwnership build or a pre-fix save: release it, then re-claim it via the integrated verb so
  // it becomes a real city tile and stops blocking the base game's own inner-ring border growth.
  // Off = leave legacy orphans as-is.
  repairOrphans: true,

  // Event-driven "+1 ring" cultural buffer. When the local player completes a RURAL improvement on
  // a tile (a manual rural-growth event: "we improved a resource/tile"), claim only the UNOWNED
  // land tiles ADJACENT to that developed tile (not the whole ring) for the nearest city, via the
  // integrated verb - so developing a frontier tile pushes your cultural border one tile past it,
  // organically, paced to your own development. Claims adjacent UNOWNED land AND water (coastal
  // borders); it NEVER takes a tile owned by another player (peaceful rival capture is left to the
  // slow diffusion pass). Off = borders come only from the reaction-diffusion field.
  growthBuffer: true,
  baseGrowthRadius: 3, // base-game max city ring; buffer tiles are capped to this + 1 rings out

  // Let the slow reaction-diffusion field spread ACROSS water (not just the +1 buffer). Culture
  // crosses water slowly and only once strong enough (see terrainCoast/terrainOcean) - so an
  // established coastal culture can island-hop and claim SOME land across the sea, while a weak one
  // stays landlocked. Off = the field is land-only (legacy) and only the buffer touches water.
  diffuseAcrossWater: true,
  // Before the Exploration age you may NOT culturally claim tiles in your DISTANT LANDS (the far
  // hemisphere) - matching the base game gating ocean crossing to Exploration. Home-hemisphere
  // islands across nearby water are still claimable. Applies to BOTH the diffusion flip and the +1
  // buffer. From Exploration on, distant-lands tiles can be claimed (still subject to the water malus).
  blockDistantLandsBeforeExploration: true,

  // -- pacing / scope -----------------------------------------------
  turnInterval: 1,
  fieldRadius: 8,        // sim the culture field this many rings around each local city
  maxDiffusionPlots: 80, // per-city safety ceiling on culturally-claimed tiles
  maxFlipsPerTurn: 8,    // per-pass ceiling on flips (the field paces growth; this is a safety net)
  flipCooldownTurns: 15, // a freshly claimed/conquered tile is locked this long

  // Take tiles INSIDE a rival's ring by default - protect only the enemy city-center plot
  // itself (0), not its whole ring-1. Set 1 for the old downtown shield, -1 to allow even
  // the center to flip. Diffusion still reaches inner tiles organically via requireAdjacency.
  coreProtectRadius: 0,
  requireAdjacency: true,

  // -- reaction-diffusion field (the SLOW, organic reach - Civ V model) --
  // Culture is a persisted per-tile stock. A tile diffuses 5.5% of its value to each
  // neighbour per turn (capped at 40% of the source, 75% along roads/rivers) and loses 5%+1
  // to decay. A tile is owned once a civ's stock there passes `minimumOwner`. Because the
  // stock must physically build up ring by ring against decay, reach is a creeping front
  // that takes tens of turns - ring 3 is mid-game, ring 5+ is a mature, established culture.
  cultureThreshold: 100,
  diffusionRate: 0.055,
  decayRate: 0.05,
  decayFlat: 1,
  normalMax: 0.4,
  maxPercent: 0.75,
  injectBase: 10,
  injectRatio: 0.15,
  cityCapFactor: 2000,
  minimumOwner: 300,
  flipRatio: 0.65,
  flipMaxDistance: 6,

  // Terrain: culture follows roads/rivers and is slowed crossing rough ground. `max` is the
  // neighbour cap x normalMax; `malus` slows the rate; `threshold` (x cultureThreshold) gates
  // whether culture crosses at all. Modifiers for the DESTINATION tile's terrain (hill/
  // mountain), biome (tundra/desert), and feature (forest/jungle/marsh) STACK (Civ VII has no
  // "snow"; tundra is the cold biome, and mountains are a terrain type).
  roadBonus: 1.0, roadMax: 2.5,
  riverFollowBonus: 0.65, riverFollowMax: 1.8,
  terrainHills:    { malus: 0.15, max: 0.60, threshold: 1.50 }, // TERRAIN_HILL
  terrainMountain: { malus: 0.75, max: 0.10, threshold: 7.50 }, // TERRAIN_MOUNTAIN (near-impassable to culture)
  terrainTundra:   { malus: 0.25, max: 0.40, threshold: 2.50 }, // BIOME_TUNDRA (the cold biome)
  terrainDesert:   { malus: 0.55, max: 0.30, threshold: 3.00 }, // BIOME_DESERT
  terrainForest:   { malus: 0.10, max: 0.80, threshold: 1.25 }, // FEATURE_FOREST / FEATURE_TAIGA
  terrainJungle:   { malus: 0.60, max: 0.20, threshold: 4.50 }, // FEATURE_RAINFOREST
  terrainMarsh:    { malus: 0.65, max: 0.20, threshold: 5.00 }, // FEATURE_MARSH / bog / mangrove
  // Water crossing (only when diffuseAcrossWater). Coast (shallow) is crossable by an established
  // culture - island hopping; deep ocean is near-impassable, only an overwhelming culture spans it.
  // The high thresholds are what make "SOME land across water" reachable but rare.
  terrainCoast:    { malus: 0.55, max: 0.30, threshold: 3.50 }, // TERRAIN_COAST (shallow water)
  terrainOcean:    { malus: 0.80, max: 0.12, threshold: 6.50 }, // TERRAIN_OCEAN (deep water)

  // -- injection strength shaping (fused 3.1a) ---------------------
  // These decide how hard each city PUMPS culture into its own tile (the diffusion source).
  // CPI/prosperity/celebration make an established or overwhelming culture inject a bigger
  // stock, which then diffuses farther/faster - the organic version of "overwhelming culture
  // spreads fast". Ethnic affinity accelerates diffusion toward a civ's diaspora.
  fusedModel: true,
  useEmigration: true,
  cultureWeight: 1.0,
  // The injection base is a geometric blend culture^alpha x vitality^(1-alpha). alpha (cultureExponent)
  // keeps culture dominant while diluting a lone +culture/+happiness ability into one concave
  // term - the structural flattener that lets the per-civ table stay tiny. 1 = pure culture.
  cultureExponent: 0.65,
  happinessAmp: 0.25,
  wonderBonus: 0.12,
  ageFactor: 1.0,
  prosperityAmp: 0.5,
  cpiPowerMin: 0.6,
  cpiPowerMax: 1.6,
  wLegacy: 0.22,
  wFlow: 0.18,
  wReach: 0.15,
  wVitality: 0.15,
  wProsperity: 0.15,
  wIdentity: 0.15,
  ethnicWeight: 1.0,

  // -- per-age tuning (3c) -----------------------------------------
  // Settlement caps grow 1->5->8 and culture yields ~2x->~1.5x across the ages, so later ages
  // would runaway-paint the map at a fixed injection. So injection is DAMPED and the ownership
  // bar RAISED per age - keeping a single city's reach roughly comparable across ages while
  // letting the bigger late-game empire (more cities) cover more ground. Keyed by age.
  //
  // waterEase [0..1] shrinks the water crossing gates as sea travel matures: 0 keeps the full
  // coast/ocean malus (Antiquity - deep ocean near-impassable), a partial value drastically eases
  // it (Exploration - ocean-going ships), and 1 removes the water penalty entirely (Modern - blue-
  // water culture spreads across oceans like open land). Applied to terrainCoast + terrainOcean.
  byAge: {
    ANTIQUITY:   { injectionScale: 1.0,  ownerBar: 1.0,  waterEase: 0.0 },
    EXPLORATION: { injectionScale: 0.8,  ownerBar: 1.25, waterEase: 0.65 },
    MODERN:      { injectionScale: 0.65, ownerBar: 1.6,  waterEase: 1.0 }
  },
  // Ramp waterEase CONTINUOUSLY across each age instead of stepping at the boundary: within an age
  // it interpolates from that age's waterEase toward the NEXT age's, by progress through the age
  // (Game.turn / Game.maxTurns). So Exploration eases from 0.65 up to ~1.0 over its course, and
  // Antiquity eases from 0.0 up to ~0.65 (deep ocean stays near-impassable early, softening late).
  // Off = flat per-age steps.
  waterEaseRamp: true,

  // -- per-leader / civ / memento variance (cd-civ-tuning.js) -------
  // Bounded injection nudges for the culture/wonder/celebration/suzerainty outliers and the
  // territory-redundant civs (e.g. Xerxes' culture-on-capture double-dip). civTuningStrength
  // 1 = table as written, 0 = every civ neutral.
  civTuningEnabled: true,
  civTuningStrength: 1.0,

  // -- game-settings calibration (3d - cd-calibration.js) ----------
  // Normalize the field's per-turn pace to the CURRENT AGE's length (Game.maxTurns) so the
  // border arc spans the age consistently on any game speed, and nudge injection by map size so
  // a cramped map isn't steamrolled. Neutral (1) when unreadable - i.e. Standard-tuned.
  calibrateToGameSettings: true,
  paceReferenceTurns: 90,   // "~one Standard age" of effective diffusion steps
  paceBounds: [0.25, 3],
  mapSizeScale: {
    MAPSIZE_TINY: 0.85, MAPSIZE_SMALL: 0.92, MAPSIZE_STANDARD: 1.0, MAPSIZE_LARGE: 1.05, MAPSIZE_HUGE: 1.1
  },

  // -- misc ---------------------------------------------------------
  debug: false
};

/** Frozen defaults, so the settings layer can restore any knob to its shipped value. */
export const CONFIG_DEFAULTS = Object.freeze({ ...CONFIG });

/**
 * Intensity presets (the simple knob in Options -> Mods). "Custom" applies nothing. Intensity
 * mostly moves the diffusion SPEED (diffusionRate vs decayRate) and the ownership bar
 * (minimumOwner) - higher intensity = a faster, farther-reaching front.
 * @type {Record<string, Partial<CdConfig>>}
 */
export const PRESETS = Object.freeze({
  Custom: {},
  Low: {
    diffusionRate: 0.04,
    decayRate: 0.07,
    minimumOwner: 400,
    flipMaxDistance: 5,
    maxDiffusionPlots: 40,
    claimOnlyUnowned: true
  },
  Medium: {
    diffusionRate: 0.055,
    decayRate: 0.05,
    minimumOwner: 300,
    flipMaxDistance: 6,
    maxDiffusionPlots: 80,
    claimOnlyUnowned: false
  },
  High: {
    diffusionRate: 0.075,
    decayRate: 0.04,
    minimumOwner: 220,
    flipMaxDistance: 8,
    maxDiffusionPlots: 140,
    claimOnlyUnowned: false
  }
});

/** Preset names in display order (index 0 = "Custom"). */
export const PRESET_NAMES = Object.freeze(Object.keys(PRESETS));
