# Cultural Diffusion (Civ VII)

A reimagining and extension of the Cultural Diffusion mod for Civilization V, rebuilt
for Civ VII. Culture is a per-tile field that spreads outward from your cities over the
course of the game. A strong, established culture slowly pushes its borders past the
normal city footprint into open land, and can take a rival's frontier tiles where its
culture clearly wins there. This is a systemic answer to AI forward-settling: growing
your cultural border is the deterrent.

Single-player, flag-gated, reversible. It works standalone, and reads extra data from
the [Emigration](../emigration/) mod when that is also installed.

---

## How it works - a culture field, not a border calculation

The core of the mod (adapted from the Civ V original) is a reaction-diffusion
simulation over a persisted, per-tile, per-civ culture stock. Every
tile on the frontier remembers how much culture each civilization has deposited on
it. Once per turn, over a bounded region around your cities, four things happen:

### 1. Inject - cities pump culture into their own tile
Each city adds culture to the tile it sits on, using a self-amplifying curve
(`strength x sqrt(current x injectRatio) + injectBase`): the more culture already
present, the faster it grows, climbing over many turns toward a cap
(`strength x cityCapFactor`). **Strength** is not raw culture-per-turn - it's a
*fused* measure of the city's cultural power (see below), so an established or
prosperous city pumps a much bigger stock.

### 2. Diffuse - culture bleeds outward to neighbors
A tile with enough culture (`cultureThreshold`) spreads a fraction of its stock
(`diffusionRate`, ~5.5%/turn) to each of its 6 neighbors. A neighbor can hold at most
`normalMax` (40%) of the source's value - up to `maxPercent` (75%) when the culture
follows roads or rivers. Rough terrain slows or blocks the spread: forest, hills,
tundra, desert, jungle, marsh, and mountains each impose a penalty and a "crossing
threshold" the source must exceed before culture leaks across at all. If the
[Emigration](../emigration/) mod is present, diffusion is accelerated toward tiles
where your diaspora lives, so borders follow people.

### 3. Decay - every tile slowly loses culture
Each tile sheds `decayRate` (5%) + a flat point per turn. Decay is the constant brake
that the diffusion has to keep pushing against - it's what gives the border a stable
equilibrium, keeps growth slow, and lets a border **flow back** when the source city
weakens or is lost.

### 4. Flip - ownership is read off the stock
A tile becomes yours once **your** culture there is the largest, passes an absolute
floor (`minimumOwner`, 300), and - if you're taking it from a rival - beats their
culture on that tile by a decisive ratio (`flipRatio`, 0.65). It must also be within
`flipMaxDistance` (6) of one of your cities and — while `requireAdjacency` is on (default)
— **adjacent to land you already own**, so borders grow contiguously. Freshly claimed tiles
are locked briefly (`flipCooldownTurns`) to prevent flicker. By default a rival's
**city-center plot is never taken** (culture may press inward through the surrounding tiles
ring by ring); the full downtown ring can still be shielded via the *rival city protection*
option (`coreProtectRadius`).

### Why growth is slow and organic
Because culture must physically build up **ring by ring against decay**, reach is an
**emergent traveling wave**, not a distance formula. In practice:

| Distance from city | Roughly when it's claimed |
| --- | --- |
| Ring 1-2 | Early game, once a city has some culture |
| Ring 3 | Mid game (~turn 20-30 for a healthy city) |
| Ring 5+ | Late game, and only for a mature, entrenched culture |

An **overwhelming** culture injects a far bigger stock, so it pushes the *same* front
out **faster and farther** - organically, without any artificial "you're the leader"
switch. A weak or stagnant culture barely creeps past its border, and if a strong
neighbor out-cultures you, your border recedes. This is the slow, living,
back-and-forth feel of the Civ V original.

---

## Cultural power - what makes a city "strong" (the fused model)

A city's **injection strength** is a **geometric blend** of its culture output with a
prosperity/vitality aggregate (`culture^alpha x vitality^(1-alpha)`), so that *cultural power*,
not just raw culture, drives how far your borders reach - and a single big +culture or
+happiness ability is one diluted term rather than a linear multiplier (this is what
keeps culture-focused leaders/civs leading without running away):

- **Culture + a prosperity aggregate (food, production, happiness, growth)** - a happy,
  prosperous, growing city pumps much harder than a struggling one, but a lone culture
  spike is flattened by the blend.
- **Celebration** - a golden age gives a pulse of extra cultural projection.
- **Cultural Power Index (CPI)** - a per-civilization multiplier built from your
  standing across six dimensions (wonders + great works, culture/turn, influence +
  city-state suzerainties, happiness + golden ages, empire prosperity, traditions +
  age), each measured as your share versus the strongest civ and combined so that
  *breadth* of cultural power beats a single-stat spike. A cultural hegemon's cities
  inject harder and therefore reach farther.
- **Ethnic affinity** *(requires Emigration)* - diffusion is pulled toward frontier
  tiles settled by your people.

**All of this is standalone-safe.** CPI and prosperity are computed from base-game
data alone; the ethnic-affinity layer is simply neutral when Emigration isn't
installed. Turn the whole fused model off (`Options -> Mods`) for a pure culture-only
source.

---

## Configuration

### Intensity presets (`Options -> Mods -> Cultural Diffusion - intensity`)
Change the feel with one knob. Higher intensity diffuses **faster**, decays
**slower**, and needs **less** culture to own a tile - so borders reach farther,
sooner.

| Preset | Diffusion | Decay | Ownership bar | Max distance |
| --- | --- | --- | --- | --- |
| **Low** (gentle nudge, empty land only) | 4.0% | 7% | 400 | 5 |
| **Medium** (default) | 5.5% | 5% | 300 | 6 |
| **High** (assertive) | 7.5% | 4% | 220 | 8 |

### Options toggles
- **Enabled** - master switch (off = vanilla borders).
- **Claim empty land only** - safety mode; never flip a tile owned by another civ.
- **How tiles are claimed** - *Free territory* (default; you develop it normally) or
  *Buy with gold* (instantly integrated into the nearest city).
- **Rich cultural model** - fold CPI + prosperity into a city's cultural power. Off =
  raw culture only.
- **Follow diaspora (Emigration mod)** - read Emigration for ethnic-affinity
  diffusion. No effect if Emigration is absent.
- **Debug logging** - per-pass diagnostics to `UI.log`.

### Full tunables (`ui/cd-config.js`, all overridable)
- **Pacing / safety:** `turnInterval`, `fieldRadius`, `maxDiffusionPlots`,
  `maxFlipsPerTurn`, `flipCooldownTurns`, `coreProtectRadius`, `requireAdjacency`,
  `preventForwardSettle`.
- **Field:** `cultureThreshold`, `diffusionRate`, `decayRate`, `decayFlat`,
  `normalMax`, `maxPercent`, `injectBase`, `injectRatio`, `cityCapFactor`,
  `minimumOwner`, `flipRatio`, `flipMaxDistance`, `minimalOwnedCulture`.
- **Terrain:** `roadBonus`/`roadMax`, `riverFollowBonus`/`riverFollowMax`, and a
  `{ malus, max, threshold }` entry per terrain (`terrainForest` ... `terrainMountain`).
- **Injection shaping (fused):** `fusedModel`, `useEmigration`, `cultureWeight`,
  `cultureExponent` (the geometric-blend alpha that dilutes lone culture spikes),
  `happinessAmp`, `wonderBonus`, `ageFactor`, `prosperityAmp`,
  `cpiPowerMin`/`cpiPowerMax`, the six CPI dimension weights
  (`wLegacy` ... `wIdentity`), `ethnicWeight`.
- **Game-settings calibration:** `calibrateToGameSettings`, `paceReferenceTurns`,
  `paceBounds`, `mapSizeScale` - re-times the field to the current age's length
  (`Game.maxTurns`) so the border arc is consistent across game speeds, and nudges
  injection by map size so cramped maps aren't steamrolled.
- **Per-age balance:** `byAge` - `{ injectionScale, ownerBar }` for
  `ANTIQUITY`/`EXPLORATION`/`MODERN`. Later ages have ~8x the cities and ~3x the
  culture, so injection is damped and the ownership bar raised so a single city's reach
  stays comparable across ages.
- **Leader/civ/memento tuning:** `civTuningEnabled`, `civTuningStrength` (1 = full table,
  0 = every civ neutral). A bounded registry (`cd-civ-tuning.js`) damps culture/wonder/
  celebration/suzerainty snowball kits and territory-redundant civs (e.g. Xerxes'
  culture-on-capture), and gently lifts culture-poor ones. See
  [`mods_research_and_analysis/cultural-diffusion-leader-civ-memento-and-age-tuning.md`](../../mods_research_and_analysis/cultural-diffusion-leader-civ-memento-and-age-tuning.md).

---

## Architecture

The runtime is a set of small, single-responsibility UI-script modules (`ui/`):

| Module | Responsibility |
| --- | --- |
| `cd-bootstrap.js` | Boots the engine, runs one pass per local-player turn, console surface. |
| `cd-pass.js` | The per-turn simulation: inject -> diffuse -> decay -> flip. |
| `cd-field.js` | **Pure** field math (injection, decay, diffusion, ownership resolution). |
| `cd-terrain.js` | Per-step terrain diffusion modifiers (roads, rivers, rough ground). |
| `cd-pressure.js` | **Pure** injection-strength math (`projectionOf` + factors). |
| `cd-cpi.js` | **Pure** Cultural Power Index (share-vs-strongest -> geometric mean -> power). |
| `cd-metrics.js` | Base-game per-civ CPI dimension reads. |
| `cd-polity.js` | Per-settlement culture / happiness / wonders / prosperity reads. |
| `cd-emigration.js` | Optional, import-free bridge to the Emigration mod's data. |
| `cd-ethnicity.js` | Ethnic-affinity diffusion accelerant from composition data. |
| `cd-civ-tuning.js` | Bounded per-leader/civ/memento injection nudges (redundancy-only balance layer). |
| `cd-civ-roster.js` | The full game leader/civ/memento type rosters (data-only). |
| `cd-calibration.js` | Age-length (field pace) + map-size (injection) calibration from game settings. |
| `cd-plots.js` | GameplayMap reads (owners, radii, water, dimensions). |
| `cd-borders.js` | City-core protection + war checks. |
| `cd-ownership.js` | The one place that mutates ownership (`setOwnership` / `purchasePlot`). |
| `cd-state.js` | Persisted culture field (v2 schema), save/reload, pruning. |
| `cd-config.js` | Default tunables + intensity presets. |
| `cd-settings.js` / `cd-options.js` | Options-screen bridge + registration. |
| `cd-notifications.js` | Throttled flip notifications. |
| `cd-log.js` | Logging. |

The pure modules (`cd-field`, `cd-pressure`, `cd-cpi`) carry the algorithm and are
unit-tested in Node with no engine - `npm run verify` runs syntax, ESM-integrity, and
the test suites (`tests/field.mjs` locks the slow travelling-wave pacing as a
regression guard).

---

## Standalone vs. Emigration

The mod has **no hard dependency** on Emigration. When Emigration is installed and the
"Follow diaspora" toggle is on, Cultural Diffusion reads its persisted population
composition (import-free, via the shared game-config store) to bias diffusion toward
your diaspora. When it's absent, that layer is simply neutral and everything else works
unchanged.

---

## Credits

This mod is a reimagining and extension of Gedemon's work, not a straight port.

- **Gedemon** - the *Cultural Diffusion* mod for Civilization V (v18), whose
  reaction-diffusion culture model is the core layer this mod builds on: the
  inject / diffuse / decay / flip loop over a per-tile culture stock, plus its
  terrain and ownership rules, follow that design.
- Everything layered on top of that core is new to this Civ VII version:
  - a per-civilization **Cultural Power Index** built from wonders, great works,
    culture, influence, city-state suzerainties, happiness, golden ages, traditions,
    and age;
  - the **prosperity / vitality composite** injection base that flattens lone culture
    and happiness spikes so culture leaders lead without running away;
  - **ethnic-affinity** diffusion that reads the Emigration mod's diaspora data so
    borders follow people (and stays standalone-safe when Emigration is absent);
  - the **per-leader / civilization / memento** balance-tuning layer and the
    **per-age** damping for Civ VII's three-age structure;
  - the **game-settings calibration** (age length, map size) reworked for Civ VII;
  - the Civ VII engine adaptation: terrain/biome/feature reads, `setOwnership`
    integration, bounded-region simulation, persistence, the Options screen, and
    notifications.
- Per-turn pass structure, plot reads, persistence envelope, options screen, and
  notification throttling patterns are shared with the sibling Emigration mod.

## Notes & limitations

- Terrain (roads, river valleys, hills/mountains, tundra/desert biomes, forest/
  rainforest/marsh features) is read against the **shipped Civ VII 1.4.1 map API**
  (`GameplayMap.getTerrainType`/`getBiomeType`/`getFeatureType`/`isMountain`/
  `getRiverType`/`getRouteType`, via the `GameInfo.Terrains`/`Biomes`/`Features`
  lookups). Civ VII splits terrain (flat/hill/mountain) from biome (tundra/desert/...)
  and has no "snow" - modifiers stack per destination tile. Reads are still defensive:
  anything unreadable simply omits that modifier.
- Civ V swept the whole map each turn; Gameface can't, so the field is simulated in a
  bounded `fieldRadius` region around your cities.
- Game-scope scripts bind at game **load** - test on a **new** game (or enable, then
  save + reload), and redeploy by overwriting the folder in place rather than deleting
  it. See [`docs/cultural-diffusion-spec.md`](docs/cultural-diffusion-spec.md) 3b for
  the full model write-up and [`probe/`](probe/) for the original feasibility probe.
