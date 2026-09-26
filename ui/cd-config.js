// cd-config.js
//
// The DEFAULT VALUES of Cultural Diffusion's tunable settings (see docs/current-model.md §2).
// cd-settings.js / cd-options.js override these at boot and on each pass via applyTunableOverrides.
// Keep this file PURE (no engine reads) so the field math can be unit-tested in Node. The "fused"
// knobs shape how hard each city INJECTS; the diffusion knobs shape how that stock spreads.

/**
 * @typedef {Object} CrossMod Per-terrain diffusion modifier {malus, max, threshold}.
 * @property {number} malus Diffusion-rate penalty fraction crossing into this terrain.
 * @property {number} max Neighbor-cap multiplier (x normalMax) for this terrain.
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
 *   1 = protect the center + its ring-1 (full "downtown" shield); 0 = protect only the
 *   city-center plot itself (culture can bite ring-1 inward); -1 = protect nothing (even the
 *   center is flippable). Lower = diffusion pushes deeper into a rival's worked footprint.
 * @property {boolean} protectTrappedUnits Never close the LAST way out on a foreign unit belonging to a
 *   civ we are at PEACE with: trespass then leaves it with no legal move until a war ejects it
 *   (watched, harness run 17). Refused only when this claim takes its LAST legal destination; a unit
 *   that can still move, even inside a small pocket, is fine.
 * @property {number}  minorProtectRadius Minimum rings of core protection around a MINOR settlement
 *   (city-state or Independent Power) regardless of coreProtectRadius. A minor's whole territory is a
 *   ring or two, so the major-civ default of 0 stripped it to its center plot - which reads to the
 *   player as the settlement being absorbed. -1 disables the floor.
 * @property {boolean} requireAdjacency Only flip a tile that TOUCHES your existing land
 *   (the organic contiguous front - takes a rival's rings from the outside in). Off = flip
 *   any tile your culture field dominates, even a disconnected pocket inside their territory.
 * @property {boolean} aiCultureFlips Every living major civilization gains land by culture inside the simulated
 *   region, under the same gates as the local player (Civ V UpdatePlotOwnership). Opt-in.
 * @property {boolean} conquestFlip A combat unit that holds an enemy tile for `conquestBufferTurns` consecutive
 *   passes during a war takes it, ignoring culture; city centers and urban districts are never taken. Opt-in.
 * @property {number}  conquestBufferTurns Consecutive passes a tile must be held before a conquest flip (0 = at once).
 * @property {number}  conquestHoldTurns Turns a conquered tile is held against CULTURE flips afterwards; another army
 *   can still take it at any time. After the hold the tile works the normal way.
 * @property {boolean} foreignCultureInCities A city injects culture for EVERY group present on its tile, weighted
 *   by population (and by the Emigration composition when present), and converts foreign stock to its owner each
 *   turn (Civ V GetCityCulturalOutput + ConvertCulture).
 * @property {number}  foreignInjectScale Multiplier on a city's population for a foreign group's injection strength.
 * @property {number}  foreignGroupMinStock Without Emigration data, a foreign group must hold at least this much
 *   stock on the city tile before the city's people pump it (keeps a trickle from being amplified).
 * @property {number}  convertBase Fraction of every foreign group's city-tile stock converted to the owner per turn.
 * @property {Record<string, number>} convertBonuses Extra conversion per turn keyed by constructible, tradition or
 *   ideology type present in the city / on its owner. Unknown keys are ignored.
 * @property {boolean} captureTransfer On a city capture, every culture on the city's tiles loses `captureLoss` and
 *   the conqueror gains `captureGain` of the total lost (Civ V CityCultureOnCapture).
 * @property {number}  captureLoss Fraction each culture loses on the captured city's tiles.
 * @property {number}  captureGain Fraction of the total lost that the conqueror gains.
 * @property {number}  sourceThresholdMountain Multiple of cultureThreshold a MOUNTAIN source needs before it
 *   diffuses at all (Civ V PlotCultureThreshold).
 * @property {number}  ownerFloor Minimum stock of the owner's culture kept on every owned tile in the region
 *   (Civ V MINIMAL_CULTURE_ON_OWNED_PLOT). 0 disables.
 *
 * -- reaction-diffusion field (Civ V model) --
 * @property {number}  cultureThreshold Min culture on a tile before it diffuses to neighbors.
 * @property {number}  diffusionRate Fraction of a tile's stock delivered to each neighbor per turn (Civ V 5.5%).
 * @property {number}  decayRate Fraction of a tile's stock lost per turn.
 * @property {number}  decayFlat Flat culture lost per turn (dissipates tiny stocks).
 * @property {number}  normalMax Neighbor cap as a fraction of the source (open ground).
 * @property {number}  maxPercent Absolute neighbor cap as a fraction of the source (with road/river bonuses).
 * @property {number}  injectBase Flat culture a city injects into its own tile each turn.
 * @property {number}  injectRatio Self-amplification ratio in the sqrt injection curve.
 * @property {number}  cityCapFactor City-tile culture cap = injection strength x this.
 * @property {number}  minimumOwner Culture a civ needs on a tile before it can own it.
 * @property {number}  flipRatio A flip needs newOwnerCulture x flipRatio > incumbentCulture (0.65 = decisive lead).
 * @property {number}  flipMaxDistance Max tiles from a city a plot may be claimed.
 * @property {number}  roadBonus / roadMax Road follow bonus + cap multiplier.
 * @property {number}  riverFollowBonus / riverFollowMax Follow bonus + cap multiplier along a MINOR river.
 * @property {number}  navigableFollowBonus / navigableFollowMax Follow bonus + cap multiplier along a
 *   NAVIGABLE river (the stronger highway).
 * @property {CrossMod} terrainRiverCross / terrainNavigableCross Gate for stepping onto a minor /
 *   navigable river from anywhere but the same river (the wall across it).
 * @property {CrossMod} terrainHills / terrainMountain Terrain (elevation) crossing modifiers.
 * @property {CrossMod} terrainTundra / terrainDesert Biome crossing modifiers.
 * @property {CrossMod} terrainForest / terrainJungle / terrainMarsh Feature crossing modifiers.
 *
 * -- injection strength shaping (fused: culture + CPI + prosperity + ethnic affinity) --
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
  // WATCHED (harness run 17): our claims closed every exit around a peaceful major's Scout and it sat
  // frozen for five turns. The engine exposes no way to move a unit we do not own, so the only lever is
  // not to take the last plot. Units at war with us - which includes every Independent Power - cross our
  // land freely and are never protected. A refused claim costs one frontier tile for one turn.
  protectTrappedUnits: true,
  // A minor settlement is a ring or two of territory in total, so coreProtectRadius 0 - fine against a
  // major - takes everything a city-state or village has except the plot it stands on. Watched in harness
  // run 13: the pass flipped 89,41 and 90,42, both ring-1 neighbors of city-state 33's center at 89,42.
  minorProtectRadius: 1,
  // The INTEGRATED verb (current-model.md §4): `purchasePlot` attaches the flipped tile to the
  // nearest city so it is a real, workable plot, not the orphan `setOwnership` produces (which blocks
  // base-game border growth). Code-only; `setOwnership` survives for `unclaim` and as a testing escape hatch.
  flipVerb: "purchasePlot",
  // Net-zero any gold purchasePlot spends by restoring the balance the same tick (Players.grantYield; watched
  // 2026-09-25: a script purchase charges nothing on 1.5.0 and Treasury.changeGoldBalance is a no-op, so this
  // is insurance against a future build that prices the purchase). Turn off to let claims cost gold if they ever do.
  refundGold: true,
  // Each pass, re-integrate any ORPHAN tile (owner === me but no owning city): release it, then
  // re-claim it via the integrated verb so it stops blocking base-game border growth. Off = leave orphans as-is.
  repairOrphans: true,

  // Event-driven "+1 ring" cultural buffer: when the local player completes a RURAL improvement, claim
  // the UNOWNED tiles (land and water) ADJACENT to it for the nearest city via the integrated verb. It
  // NEVER takes another player's tile. Default OFF (territory-changing features are opt-in).
  growthBuffer: false,
  baseGrowthRadius: 3, // base-game max city ring; buffer tiles are capped to this + 1 rings out

  // Let the reaction-diffusion field spread ACROSS water. Culture crosses slowly and only once strong
  // enough (see terrainCoast/terrainOcean), so an established coastal culture can island-hop while a
  // weak one stays landlocked. Off = the field is land-only and only the buffer touches water.
  diffuseAcrossWater: true,
  // Before the Exploration age you may NOT culturally claim tiles in your DISTANT LANDS (matching the
  // base game's ocean gating); home-hemisphere islands stay claimable. Applies to BOTH the diffusion
  // flip and the +1 buffer.
  blockDistantLandsBeforeExploration: true,

  // -- pacing / scope -----------------------------------------------
  turnInterval: 1,
  fieldRadius: 8,        // sim the culture field this many rings around each local city
  maxDiffusionPlots: 80, // per-city safety ceiling on culturally-claimed tiles
  maxFlipsPerTurn: 8,    // per-pass ceiling on flips (the field paces growth; this is a safety net)
  flipCooldownTurns: 15, // a freshly claimed/conquered tile is locked this long

  // Take tiles INSIDE a rival's ring by default - protect only the enemy city-center plot
  // itself (0), not its whole ring-1. Set 1 for the full downtown shield, -1 to allow even
  // the center to flip. Diffusion still reaches inner tiles organically via requireAdjacency.
  coreProtectRadius: 0,
  requireAdjacency: true,

  // Borders RECEDE (opt-in). A tile this mod CLAIMED can be lost again: if a rival's culture decisively
  // wins it (the same resolveOwner gates a claim uses), it is ceded to that rival's nearest city via
  // purchasePlot (refunded). Only tiles in state.claims are touched; there is no release-to-no-one.
  recedeBorders: false,

  // EVERY civilization gains land by culture (opt-in; docs/civ-v-parity-spec.md §2). Inside the simulated
  // region a living major whose culture decisively leads a tile takes it through its nearest city, under the
  // same gates as our own claims: peace with the incumbent, the incumbent's core protection, adjacency to the
  // leader's land, flipMaxDistance from one of the leader's cities, the strand guard, its per-city cap, and its
  // own natural ring left to the base game. Independent Powers and city-states never win a tile. Watched
  // 2026-09-25: a rival city's purchasePlot lands like ours and costs nothing. Off = AI borders never move by culture.
  aiCultureFlips: false,

  // Unit CONQUEST (opt-in; spec §6, potential-future-features.md §2). During a war between two majors, a combat
  // unit that holds an enemy tile for `conquestBufferTurns` consecutive passes takes it for its owner, ignoring
  // culture. Leaving resets the count. City centers and urban districts are never taken (capturing a city is the
  // engine's job). A conquered tile is then HELD for conquestHoldTurns: culture cannot flip it back in that time, but
  // another army holding it through the buffer takes it at any time (conquest never waits on a lock). Afterwards
  // the tile works the normal way: once peace is made (no culture path crosses an active front) any civilization
  // whose culture decisively leads the tile may take it, not only the one it was taken from - intended, decided
  // 2026-09-26. For another civ's units it also needs aiCultureFlips.
  conquestFlip: false,
  conquestBufferTurns: 5,
  conquestHoldTurns: 10,

  // Foreign culture IN cities (spec §3 + §4, shipped together). A city injects for every culture group present on
  // its tile - the owner at full strength, each foreign group at population x foreignInjectScale (x that group's
  // share of the population when the Emigration mod records one) - so a captured or mixed city keeps producing its
  // old culture; and each turn it CONVERTS convertBase (+ bonuses) of every foreign group's stock to its owner, so
  // that culture fades over time. The city-tile cap applies to the TOTAL culture on the tile.
  foreignCultureInCities: true,
  foreignInjectScale: 1.0,
  foreignGroupMinStock: 100,
  convertBase: 0.005, // Civ V 0.5% per turn
  convertBonuses: {
    // science buildings (Civ V: Library +0.25%, University +0.5%, Public School +1%), by age
    BUILDING_LIBRARY: 0.0025, BUILDING_ACADEMY: 0.005,
    BUILDING_UNIVERSITY: 0.005, BUILDING_OBSERVATORY: 0.005,
    BUILDING_SCHOOLHOUSE: 0.01, BUILDING_LABORATORY: 0.01,
    // culture buildings help a city absorb its people
    BUILDING_MONUMENT: 0.0025, BUILDING_AMPHITHEATER: 0.0025, BUILDING_MUSEUM: 0.005, BUILDING_OPERA_HOUSE: 0.005,
    // the Modern ideologies (Civ V: +1.0% to +1.75%)
    IDEOLOGY_DEMOCRACY: 0.01, IDEOLOGY_FASCISM: 0.0175, IDEOLOGY_COMMUNISM: 0.0125
  },

  // Culture transfer on city CAPTURE (spec §5): on CityTransfered, every culture on the captured city's tiles
  // loses captureLoss and the new owner gains captureGain of the total lost, so a conquered region starts leaning
  // toward its conqueror at once. Watched 2026-09-25: the event reaches the mod for any transfer, AI-vs-AI included.
  captureTransfer: true,
  captureLoss: 0.55,
  captureGain: 0.75,

  // Three small Civ V rules (spec §8): a mountain source needs 7.5x the threshold before it diffuses, and an
  // owned tile never drops below ownerFloor of its owner's culture.
  sourceThresholdMountain: 7.5,
  ownerFloor: 1,

  // -- reaction-diffusion field (the SLOW, organic reach - Civ V model) --
  // Culture is a persisted per-tile stock: a tile diffuses 5.5% to each neighbor per turn (capped at
  // 40% of the source, 75% along roads/rivers) and loses 5%+1 to decay; a tile is owned once a civ's
  // stock passes `minimumOwner`. Building up ring by ring against decay makes reach a creeping front.
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

  // Terrain: culture follows roads/rivers and is slowed crossing rough ground. `max` is the neighbor
  // cap x normalMax; `malus` slows the rate; `threshold` (x cultureThreshold) gates whether culture
  // crosses at all. Modifiers for the DESTINATION tile's terrain, biome and feature STACK.
  roadBonus: 1.0, roadMax: 2.5,
  // Rivers are a highway ALONG them and a wall ACROSS them, as in Civ V (docs/civ-v-parity-spec.md §1).
  // Following: tile to tile down the same river. A navigable river carries culture farther than a minor
  // one (road strength, vs Civ V's river values). Crossing: stepping onto a river from a bank, the other
  // kind or another river pays Civ V's river-crossing gate once; stepping off a river is free.
  riverFollowBonus: 0.65, riverFollowMax: 1.8,         // minor river (Civ V CULTURE_FOLLOW_RIVER_*)
  navigableFollowBonus: 1.0, navigableFollowMax: 2.5,  // navigable river
  terrainRiverCross:     { malus: 0.50, max: 0.35, threshold: 2.00 }, // onto a minor river (Civ V CROSS_RIVER)
  terrainNavigableCross: { malus: 0.50, max: 0.35, threshold: 2.00 }, // onto a navigable river
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

  // -- injection strength shaping (fused) --------------------------
  // These decide how hard each city PUMPS culture into its own tile (the diffusion source):
  // CPI/prosperity/celebration make an established culture inject a bigger stock, which then
  // diffuses farther/faster. Ethnic affinity accelerates diffusion toward a civ's diaspora.
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

  // -- per-age tuning ----------------------------------------------
  // Settlement caps and culture yields grow across the ages, so injection is DAMPED and the ownership
  // bar RAISED per age to keep a single city's reach comparable while a bigger empire covers more ground.
  // waterEase [0..1] shrinks the coast/ocean crossing gates as sea travel matures (0 = full malus, 1 = none).
  byAge: {
    ANTIQUITY:   { injectionScale: 1.0,  ownerBar: 1.0,  waterEase: 0.0 },
    EXPLORATION: { injectionScale: 0.8,  ownerBar: 1.25, waterEase: 0.65 },
    MODERN:      { injectionScale: 0.65, ownerBar: 1.6,  waterEase: 1.0 }
  },
  // Ramp waterEase CONTINUOUSLY across each age: interpolate from this age's value toward the NEXT
  // age's by progress through the age (Game.turn / Game.maxTurns). Off = flat per-age steps.
  waterEaseRamp: true,

  // -- per-leader / civ / memento variance (cd-civ-tuning.js) -------
  // Bounded injection nudges for the culture/wonder/celebration/suzerainty outliers and the
  // territory-redundant civs (e.g. Xerxes' culture-on-capture double-dip). civTuningStrength
  // 1 = table as written, 0 = every civ neutral.
  civTuningEnabled: true,
  civTuningStrength: 1.0,

  // -- game-settings calibration (cd-calibration.js) ---------------
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
