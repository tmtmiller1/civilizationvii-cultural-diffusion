# Cultural Diffusion - Design & Implementation Spec (Civ VII)

A reimagining and extension of the classic Civ V **Cultural Diffusion** mod for Civilization VII.
Culturally strong settlements exert *pressure* on adjacent plots. Over time that
pressure pushes a civ's borders **beyond the normal city footprint**, contests a
rival's frontier tiles, and can **flip** border plots from one civ to another when
the cultural balance decisively and durably favors the newcomer.

> **Status: OK PROBE GREEN - buildable (2026-07-03).** The in-game probe (`../probe/`,
> v0.3.0) confirmed every feasibility question: tiles flip, the flip is *integrated*
> (city-attached, not cosmetic), it works **beyond the 3-ring footprint**, and it works
> on **rival (AI-owned) tiles** - via both `setOwnership` and `purchasePlot`. See 2
> "Probe results" and the 8 decision. Everything below is written to the same house
> style as `emigration/docs/*` (authoritative spec, file anchors, flag-gated,
> conservative defaults).

---

## 1. Pitch

- Borders are no longer purely a function of city growth. A settlement's **culture,
  ethnicity, and prosperity** (the combined metric, 3.1a) generate outward cultural
  pressure **on top of** the game's native population-driven expansion - never replacing
  it (3.5).
- A plot on the frontier accumulates pressure from every settlement that can "see"
  it. When one civ's pressure dominates the current owner's for a sustained number
  of turns, the plot **flips** to the dominant civ - even past the owning city's
  normal growth cap.
- Rivals push back. A contested plot is genuine border competition: war, a nearby
  rival capital, or a cultural golden age can reclaim lost ground.
- Entirely **single-player**, flag-gated, and reversible (a global off switch and a
  "diffusion never flips owned tiles, only claims unowned" safety mode).

### Primary purpose: a systemic fix for AI forward-settling

Beyond flavor, this mod targets a long-standing complaint - the AI **forward-settling**
cities into the buffer land next to the player in dumb spots. The mechanism:

- A strong / prosperous / culturally-dominant civ **organically projects territory into
  the buffer**, claiming the frontier tiles the AI would forward-settle into. **An owned
  plot blocks foreign city founding** (settle-validity checks plot ownership -
  `REQUIREMENT_PLOT_IS_OWNER` family), so expanding the border *is* the deterrent: there is
  simply no open plot to plant the dumb city on.
- If the AI still settles nearby in a weak moment, your dominant metric **flips its
  frontier tiles over time**, squeezing the ill-placed city - but **core-protected** (3.3),
  so you *cramp* a bad settle rather than delete it (a fair, organic consequence).
- Because it is metric-driven and reversible, it self-corrects: if the AI later
  out-cultures / out-prospers you there, the border flows back.

This is the "holy grail": borders that grow **beyond the traditional settlement footprint**
based on culture + ethnicity + prosperity, compete with other civs, flip as the balance
shifts over time, and - as a systemic side effect - close the gaps that make forward-settling
possible.

---

## 2. Feasibility - what the probe must confirm

The earlier belief that "you can't flip a tile or grow past the city cap" is
**outdated**. The 1.4.1 game code and shipped cheat mods expose working runtime
primitives:

| Primitive | Call | Evidence |
| --- | --- | --- |
| Hard tile flip | `WorldBuilder.MapPlots.setOwnership(playerId, {x,y})` | base tuner `ui/tuner-input/tuner-input.js:96,206`; cheat mod `3739573848/ui/map-cheat-panel/map-cheat-panel.js` calls it in normal play |
| City-attached claim | `city.purchasePlot({x,y})` | tuner City-panel "PurchasePlot"; `3736063097 api.js` `claimPlotForCity` |
| Native adjacency grow | `Game.CityCommands.canStart/sendRequest(cityID, EXPAND, {X,Y})` | `3736063097 api.js` `cityExpandPlotCount`/`growCity`; **adjacency is the only rule - no ring/distance cap** |
| Owner read | `GameplayMap.getOwningCityFromXY(x,y)` -> city ComponentID | `emigration-events.js:32-40` |
| Radius plots | `GameplayMap.getPlotIndicesInRadius(x,y,r)` + `getLocationFromIndex/getIndexFromLocation` | `cinematic-tour-highlights.js`, `canals-test.js:445` |
| Redraw hook | engine events `PlotOwnershipChanged`, `CityTileOwnershipChanged` | base `culture-borders-layer.js:53`, `city-borders-layer.js:39` |

### Open questions the probe answers ( maps to probe sections)

1. **Q-FLIP - does `setOwnership` actually reassign the plot and redraw borders?**
   (Does `getOwningCityFromXY` change; does `PlotOwnershipChanged` fire.)
2. **Q-YIELD - is a flipped tile *integrated* (worked, yields, city-attached) or a
   cosmetic repaint?** `setOwnership` paints owner only; `purchasePlot` /
   `EXPAND` are the integrated paths. The probe compares all three.
3. **Q-PERSIST - does a flip survive save -> reload?** (And does it survive without
   poisoning `GameConfiguration`; see the crash gotcha in 7.)
4. **Q-BEYOND-CAP - can we claim a plot the city could NOT claim via normal growth
   (outside the pending-growth gate / normal footprint)?** `EXPAND` only offers
   plots while `city.Growth.isReadyToPlacePopulation`; `setOwnership`/`purchasePlot`
   are not gated that way - the probe confirms.

If Q-FLIP + Q-PERSIST are green, the mod is buildable. Q-YIELD decides whether we
use `setOwnership` (visual/territory) vs `purchasePlot` (fully worked) as the flip
verb. Q-BEYOND-CAP decides whether "beyond the city maximum" is truly unbounded or
must be modeled with our own cap.

### Probe results - RESOLVED OK (2026-07-03, game 1.4.x, probe v0.3.0)

Run in-game on a fresh single-player game; results in `UI.log` under `[Civ7Probe]`.
The immediate before/after snapshot is unreliable (ownership writes are **async**);
the authoritative signals are the deferred `FLIP_CONFIRM` re-read (~2s later) and the
cross-reload `persistCheck`.

| Question | Verdict | Evidence |
| --- | --- | --- |
| **Q-FLIP** | OK GREEN | `FLIP_CONFIRM ... ownerNow=0 Q_FLIP=GREEN` for every test; `setOwnership` and `purchasePlot` both reassign the plot to the local player. |
| **Q-YIELD** | OK Integrated | Flipped tiles read `cityNow=65536` - **attached to a city** (worked/yield-bearing), not a cosmetic repaint. `purchasePlot` is the integrated verb. |
| **Q-BEYOND-CAP** | OK GREEN | **Every** confirmed flip was `beyondCap=true` (outside every city's normal 3-ring footprint). "Beyond the city maximum" is real; adjacency to owned land is not required for `setOwnership`. |
| **Q-RIVAL (contest)** | OK GREEN | Took tiles from **two different AI civs** - `{x:42,y:34, owner=4}` and `{x:47,y:16, owner=5}` -> `ownerNow=0` after flip, via both verbs. Rival-owned tiles flip. |
| **Q-PERSIST** | OK (unowned) / pending (rival+far) | Unowned flips survived save->reload (`persistCheck ... survived:true`). Rival/beyond-cap persistence: confirm with one more save->reload (probe auto-reports `Q-PERSIST - N/M survived`). |

**Caveats / follow-ups:**
- `setOwnership` vs `purchasePlot` **yield** difference wasn't cleanly isolated - same-tick
  flips resolved to the same plot, so the `setOwnership` confirm read a plot `purchasePlot`
  had already integrated. Treat `purchasePlot` as the proven integrated verb; a targeted
  test can later confirm whether bare `setOwnership` grants yields on its own.
- Deploy/run gotchas that cost real time (now in team memory): Gameface caches modules
  (full restart to clear); never `rm -rf` a deployed mod folder (orphans the `Mods.sqlite`
  `Disabled` flag -> vanishes from Additional Content); **`scope="game"` attaches only at
  game load and the mod set is bound to the save - test on a NEW game, not an old save.**

---

## 3. Core model

> **3b - REACH MODEL REPLACED (2026-07-04): Civ V reaction-diffusion model.** The
> instantaneous pressure/charge/maturity model below (3.1-3.3a) was too fast - reach was a
> closed-form distance calc that filled in ~10-40 turns. It is superseded by a persisted
> per-tile **culture field** (a cellular automaton, adapted from the Civ V "Cultural
> Diffusion" mod, v18). The scoring work (3.1a CPI, prosperity, ethnic affinity) is **kept** - it
> now shapes how hard each city *injects* culture, not an instantaneous reach.
> - **Field** (`cd-field.js`, pure): each turn a tile DECAYS (`decayRate` 5% +1), DIFFUSES
>   `diffusionRate` (5.5%) of its stock to each neighbour (capped at `normalMax` 40% of the
>   source, 75% along roads/rivers; terrain gates/penalties via `cd-terrain.js`), and cities
>   INJECT `(strength)*sqrt(current*injectRatio)+injectBase` (self-amplifying, capped at
>   `strength*cityCapFactor`). Ownership is read off the stock: most culture wins past
>   `minimumOwner` (300), a decisive `flipRatio` (0.65) over the incumbent, within
>   `flipMaxDistance` (6) of a city and adjacent to the claimant's land.
> - **Injection strength** = `projectionOf(city)` (culture x happiness x wonders x prosperity x
>   celebration) x `f_power(CPI)`. Ethnic affinity accelerates diffusion toward diaspora tiles.
> - **Pacing is emergent & slow** - culture must physically build ring by ring against decay,
>   so ring 3 ~ turn 20-30, ring 5+ is a mature-culture, late-game event; overwhelming culture
>   injects a bigger stock and pushes the *same* front out faster/farther, organically. Borders
>   also flow **back** when a source weakens (decay wins). Simulated in a bounded `fieldRadius`
>   region around local cities (Gameface can't sweep the whole map like Civ V did).
> - Persisted in `cd-state` (v2 schema, `field`/`claims`/`locked`). Retired: charge accumulator,
>   maturity gate, `resistancePressure`, `civPressureAt`/`dominantAt`. Tests: `field.mjs`.
>
> The rest of 3 is retained for design history; the equations no longer match the code.

### 3.1 Per-plot cultural pressure

For each **frontier plot** `P` (a plot adjacent to at least one owned plot, within a
bounded diffusion range `R` of some settlement), compute pressure from each
settlement `S` that can reach it:

```
pressure(S, P) = cultureWeight * cultureOutput(S)
               * happinessFactor(S)          // unhappy cities project weakly
               * wonderBonus(S)               // wonders/great works amplify
               * ageFactor(age)               // later ages diffuse faster
               * distanceFalloff(dist(S,P))   // hex-distance decay, like emigration pull
               * borderResistance(P)          // rival-owned plots resist (see 3.3)
```

Aggregate per civ:

```
civPressure(C, P) = sum over S owned by C of pressure(S, P)
```

The **dominant** civ at `P` is `argmax_C civPressure(C, P)`. Let `owner(P)` be the
current owner (or none).

> **v2 fused model (see 3.1a).** The settlement-culture term above is only one of three
> layers of cultural pull. The full pressure fuses it with a civ-level **Cultural Power
> Index** and a plot-level **ethnic affinity** read from the emigration mod:
> ```
> pressure(C, P) = sum_{SinC reaching P}[ projection(S)*distanceFalloff(dist(S,P)) ] // (B) settlement culture reach
>                x f_power( CPI(C) )                                              // (A) holistic civ multiplier
>                x f_ethnic( ethnicAffinity(C, P) )                               // (C) demographic pull (emigration)
>                x borderResistance(C, P)                                         // rivals / war / core (3.3)
> ```
> `dominant(P) = argmax_C pressure(C,P)` then feeds the charge/flip rule (3.2) unchanged.

### 3.1a Civilization Cultural Power Index (CPI) + ethnic affinity

> **STATUS: IMPLEMENTED (2026-07-03).** The fused model ships and is ON by default (`fusedModel`).
> - **Term A / CPI** - `cd-cpi.js` (pure: share-vs-strongest -> geometric mean -> `fPower`) + `cd-metrics.js` (base-game reads: `Player.Stats` wonders/great-works/yields, `Player.Happiness` golden age, `Player.Culture` traditions, minor `Influence.getSuzerain()`). Dimensions: legacy, flow, reach, vitality, prosperity, identity. A dimension unreadable across all civs is dropped, never zeroed. Religion + civic-tree completion were NOT found readable in-repo -> omitted pending a runtime probe.
> - **Term B / prosperity projection** - `cd-polity.js prosperityOf()` (base-game happiness + food/production, normalized to [-1,1]); folded into `pressureFrom`.
> - **Term C / ethnic affinity** - `cd-ethnicity.js` + `cd-emigration.js`, reading emigration's `EmigrationEthnos_v1` composition from the shared game-config store (import-free, so no hard dependency). **Standalone-safe:** no emigration -> neutral x1; the mod runs on culture + CPI + prosperity alone.
> - **Reach coupling:** the map-wide `refStrength` yardstick (cd-pass) is the strongest FUSED projection (culture x prosperity x CPI power), so a culturally dominant civ's border reaches farther than a weaker neighbour's, while the leader still settles at the tuned ~6 tiles. Ethnic affinity is a local per-plot bonus on top.
> - **Tunables:** `cpiPowerMin/Max`, `wLegacy/wFlow/wReach/wVitality/wProsperity/wIdentity`, `ethnicWeight`, `prosperityAmp`, plus `fusedModel` / `useEmigration` toggles. Tests: `tests/cpi.mjs`, `tests/fusion.mjs`.


**The metric (A): CPI(C).** A per-civ scalar that captures a civilization's *overall*
cultural power - deliberately **not** culture-per-turn. Built from several normalized,
**relative** dimensions (each expressed as this civ's share vs. the strongest civ, so CPI
measures cultural *dominance* and scales across ages) and combined **geometrically** so
breadth beats a single-stat spike:

| Dimension | Reads (culture STOCK/REACH, not just flow) |
| --- | --- |
| **Legacy / stock** | wonders built (incl. retained past-age ones), great works displayed, relics, cultural golden ages earned, completed cultural masteries |
| **Flow** | culture / turn (one dimension only) |
| **Reach / soft power** | founded religion + follower cities, influence / turn, city-state suzerainties |
| **Vitality** | happiness stage across cities, active celebrations / golden ages |
| **Prosperity** | settlement prosperity from the emigration model (yields, growth, low emigration pressure) - a prosperous empire projects harder; a struggling one contracts (`emigration-prosperity.js` / prosperity lens) |
| **Identity depth** | traditions slotted, civic-tree completion, current age |

```
CPI(C) = product_d ( share_d(C) + eps ) ^ w_d          // geometric weighted mean; sum w_d = 1
```
Optional **momentum** term (recent delta in CPI) so an ascendant culture presses harder than a
stagnant equal. `f_power()` normalizes CPI into a bounded multiplier.

**Ethnic affinity (C): ethnicAffinity(C, P).** The most novel term - from the **emigration**
mod's demographic model. The share of population in and around `P` whose `originCiv` /
ethnicity descends from `C` (reads `composition` / `diaspora` / `originCiv` from
`emigration/ui/emigration-ethnicity-tiles.js`). A frontier tile surrounded by `C`'s diaspora
feels `C`'s pull even when `C`'s culture output is modest - **borders follow people**, which
is what real cultural diffusion does.

**Prosperity (both layers).** Prosperity feeds in twice: as a **CPI dimension** (empire-wide
prosperity) and as a per-settlement **projection** multiplier in term (B) - a prosperous, happy,
growing settlement beams culture farther than a struggling one. The three metrics **interlock**
rather than sum independently: people leave unprosperous places (emigration) -> diaspora -> ethnic
pressure elsewhere; prosperity fuels culture; culture and happiness fuel prosperity. That coupling
is exactly why the combined power is not a naive sum - it is the "detailed culture + ethnicity +
prosperity" feel the design targets.

**Tunable blend.** Expose `w_culture / w_ethnic / w_prosperity / w_power` (how much each layer
drives flips) plus the CPI dimension weights
(`w_legacy / w_flow / w_reach / w_vitality / w_prosperityDim / w_identity`) as an advanced group -
same Options pattern as emigration.

**Feasibility.** Ethnic affinity: solid (emigration already derives it). CPI dimensions:
culture, wonders, great works, happiness, religion, influence, golden ages, traditions, age
are readable via components emigration + the triumphs-overlay already touch - each needs a
quick data-availability check before we trust it. Neither changes the proven flip layer;
this is the *policy* that decides `dominant(P)`.

### 3.2 Accumulator + flip rule (mirrors emigration's violence score)

Each plot keeps a small persisted accumulator `charge(P) in [0, flipThreshold]`:

- If `dominant(P) != owner(P)` and `dominant` leads the owner's pressure by at least
  `flipMargin`, `charge += chargeGain * (leadRatio)` (bounded).
- Otherwise `charge -= chargeDecay` (relaxes; contested ground recovers if the
  pressure eases - same "duration" dimension as emigration's war score).
- When `charge >= flipThreshold` **and** the lead has held for `sustainTurns`, the
  plot **flips** to `dominant`, `charge` resets, and a cooldown blocks immediate
  re-flip (`flipCooldownTurns`) to prevent border flicker.

### 3.3 Contest, war, and resistance

- **Unowned plots** are the cheapest to claim (`borderResistance = ownednessFloor`),
  so a lone strong culture spreads into empty land first (the classic feel).
- **Rival-owned plots** resist proportional to the rival's own pressure and to
  `cityCoreProtection` (tiles adjacent to a rival city center never flip - no one
  loses their downtown to culture).
- **At war**, a plot in a war zone becomes `contested`: flips are paused (borders
  don't peacefully diffuse across an active front) but `charge` is retained, and a
  decisive cultural win after the war can still claim it. (Reuse emigration's
  violence/war reads: `emigration-borders.js`, `emigration-war.js`.)
- **Golden ages / celebrations** boost `cultureOutput(S)` (reuse
  `emigration-polity.js` celebration reads).

### 3.3a Reach = absolute maturity x relative competition (IMPLEMENTED 2026-07-03)

Empty-land reach is governed by TWO gates, multiplied, so it is neither purely relative nor
instant:

- **Relative (competition).** Empty-land resistance is `ownednessFloor x refStrength`, where
  `refStrength` is the strongest civ's fused projection on the map. This keeps a runaway
  leader from painting everything and makes contested frontiers a genuine cultural contest.
  *On its own it is degenerate:* a lone or early leader is "strongest" by default and would
  project full reach on turn 1.
- **Absolute (maturity, over time - but NOT a fixed clock).** `cd-state.accrueReach` integrates
  the local civ's culture each turn; `maturityFactor = acc/(acc+maturityScale)` maps that against
  a fixed EXTERNAL yardstick (`maturityScale`, not a rival) into a factor in (0,1] that scales the
  civ's own projection in the flip decision. Crucially the accrual is **momentum-driven**
  (`cultureMomentum`): a golden age multiplies it (`goldenAgeAccel`) and culture that overwhelms
  the field accelerates it super-linearly (`dominanceRatio^cultureDominanceExp`, capped at
  `maxMomentum`). So a young/parity culture ramps organically (~0->2->4->5 over ~40 turns), while a
  golden age or an **overwhelming culture overcomes the gate and spreads in ~5 turns** - never
  instant (the cap guarantees a few turns), and works in complete isolation. Tunables:
  `maturityGate`, `maturityScale`, `maturityRate`, `goldenAgeAccel`, `cultureDominanceExp`, `maxMomentum`.

Full reach (~6) is reached quickly by an overwhelming culture and slowly by a parity one; the
relative gate then still caps a runaway and arbitrates direct competition.

### 3.4 "Beyond the city maximum"

Normal growth stops at the pending-growth gate. Diffusion is **not** gated on it:
a plot claimed by diffusion is attached to the nearest owned city but does **not**
consume a growth event. A per-city `maxDiffusionPlots` (default generous, e.g. 12)
and a global `diffusionRangeRings` (default 3 beyond current border) bound it so a
runaway cultural leader can't paint the whole map. Both tunable; set high for the
"unbounded" feel or low for a gentle nudge.

### 3.5 Interaction with native (population-driven) border growth - MUST get right

Civ VII already grows borders organically: population growth -> you place a rural
improvement on an adjacent plot -> that plot is claimed. Adjacency is the only rule; there
is no fixed radius. Diffusion **layers on top of this and never replaces or fights it.**
Model it as **two ownership layers with clear precedence:**

- **Hard core (native).** Every tile the game claims via growth / purchase. We never touch
  our own hard core. Each pass reads the **live** owned footprint as the baseline.
- **Soft halo (cultural).** The extra frontier tiles diffusion claims by the metric,
  *beyond* the hard core, recorded in `cd-state` so we always know "ours by culture" vs
  "theirs by growth."

Reconciliation rules (these are the correctness guarantees the user asked about):

1. **No double-claim.** The frontier scan only ever considers plots **unowned** or owned by
   a **rival** - never owned-by-me. A tile the city already grew into is invisible to
   diffusion.
2. **Recompute every pass from the live map.** As your cities grow naturally, the diffusion
   baseline moves outward with them - no stale claims, no tug-of-war with the growth system.
3. **Graduation, not conflict.** When native growth later expands into a tile diffusion had
   already claimed for the *same* civ, there is no collision - the tile simply "graduates"
   from soft -> hard and gets developed normally. Diffusion having pre-owned it does not block
   the city from placing population there (confirm in the M2 slice).
4. **Core protection on flips.** Rival flips take only their frontier/soft tiles, never the
   ring adjacent to their city center (3.3) - diffusion cramps a bad settle, never guts a
   legitimately-grown city.

**Feedback-loop guard.** Worked diffusion tiles -> yields -> faster growth -> more culture -> more
diffusion is a real risk. Three brakes: (a) the metric is **relative** (share vs. the strongest
civ), so a leader can't runaway; (b) `maxDiffusionPlots` / `diffusionRangeRings` caps; (c) the
**buffer halo does not need to be worked** - see the verb split below, which removes the loop for
the outer ring entirely.

### 3.6 Cost model - culture grants LAND, the player earns the yields

**Correction (important):** tile acquisition in Civ VII is primarily **population / production
based**, not gold. Cities claim tiles by **growth (placing rural improvements)** and by
**building urban districts** - the `PlacePopulation` / EXPAND system
(`interface-mode-acquire-tile.js` -> `PlacePopulation.getExpandPlotsIndexes`). Gold purchase
(`getPurchasedPlots` / `city.purchasePlot`) is only an optional accelerant beside it. Three paths:

| Acquisition path | Cost | Use for diffusion? |
| --- | --- | --- |
| Population growth / building placement (`PlacePopulation`/EXPAND) | a growth/pop event (gated by `isReadyToPlacePopulation`) | **No** - would consume the player's *own* expansion picks |
| Gold purchase (`city.purchasePlot`) | gold | **No** - organic diffusion must not drain the treasury |
| Direct set (`WorldBuilder.MapPlots.setOwnership`) | **none** | **Yes** - culture grants territory, unpaid |

**Design: diffusion claims TERRITORY for free via `setOwnership`; yields are earned normally.**
Culture spreading is not something the player pays gold *or* population for - it just extends the
border. `setOwnership` is the honest verb: free, doesn't touch gold, doesn't steal the player's
growth/building placements. A diffusion tile arrives **un-worked**, which also removes the yield
feedback loop.

**How a diffusion tile becomes worked (graduation, 3.5):** the flip attaches the plot to the city
(probe: `owningCity` set), so it enters the city's **workable set**
(`city.Workers.GetAllPlacementInfo`). The player then develops it through the **normal**
population / building systems they already use - paying the usual population/production cost, not
gold. Diffusion gifts *land*; the player still *earns* the yields by growing into it. Balanced and
organic, and it mirrors how borders normally grow (with population, when you build).

> **M2 must confirm:** a `setOwnership`-claimed tile actually appears in the city's workable /
> expand set so the player can place population/buildings on it (the graduation path). If yes, the
> core loop never needs `purchasePlot` - it stays an optional "instantly develop with gold" nicety,
> and only *then* would its cost matter. Also confirm bare `setOwnership` ownership is respected by
> the settle-validity check (it blocks foreign founding - the anti-forward-settle premise).

---

## 4. Files (proposed runtime layout)

Mirrors emigration's module split so the shared machinery ports directly.

```
cultural_diffusion/
  cultural-diffusion.modinfo
  ui/
    cd-bootstrap.js            # engine hooks: onTurn pass, options load, console cmds
    cd-config.js               # tunables spec + defaults (declarative, like emigration-tunables.js)
    cd-pass.js                 # the per-turn diffusion pass (enumerate frontier, score, charge, flip)
    cd-pressure.js             # pure pressure math (cultureOutput/happiness/wonder/age/distance)
    cd-plots.js                # GameplayMap reads: frontier enumeration, owner lookup, radius plots
    cd-ownership.js            # the ONE place that calls the flip verb (setOwnership | purchasePlot)
    cd-state.js                # persisted charge map + cooldowns ({v,data} envelope, sanitized)
    cd-borders.js              # rival-pressure / war / core-protection resistance reads
    cd-polity.js               # culture/happiness/celebration reads (thin, reuse emigration patterns)
    cd-lens.js                 # optional overlay: pressure heat + at-risk frontier plots
    cd-notifications.js        # "gained/lost a tile to culture" toasts (throttled)
    cd-readout.js              # per-city "cultural reach" readout (optional, reuse emigration readout)
    options/
      cd-options.js            # Options -> Mods screen (intensity preset + advanced group)
  text/en_us/ModText.xml       # + 10 more locales at ship time
  data/                        # (if any native modifiers/lens defs are needed)
  tests/                       # node harnesses: pressure math, charge/flip rule, state schema
```

### Reuse map (emigration -> cultural_diffusion)

| Emigration | Reused for |
| --- | --- |
| `emigration-events.js` `getOwningCityFromXY` | `cd-plots.js` owner reads |
| pull/permeability distance falloff | `cd-pressure.js` `distanceFalloff` |
| violence-score accumulator + decay | `cd-pass.js` charge/flip rule |
| `emigration-borders.js` / `-war.js` | `cd-borders.js` war/contest resistance |
| `emigration-polity.js` celebration/happiness reads | `cd-polity.js` |
| ethnicity `composition`/`diaspora`/`originCiv` (`emigration-ethnicity-tiles.js`) | `cd-pressure.js` `ethnicAffinity` term (3.1a) |
| prosperity model (`emigration-prosperity.js` / prosperity lens) | `cd-pressure.js` prosperity CPI dim + settlement projection (3.1a) |
| `{v,data}` persistence envelope + sanitizer | `cd-state.js` |
| tunables spec + Options screen | `cd-config.js` / `cd-options.js` |
| lens overlay + throttled toasts | `cd-lens.js` / `cd-notifications.js` |

---

## 5. Tunables (defaults conservative)

| Key | Default | Meaning |
| --- | --- | --- |
| `diffusionEnabled` | `true` | master switch |
| `claimOnlyUnowned` | `false` | safety mode: diffusion never flips owned tiles, only claims unowned |
| `flipVerb` | `setOwnership` | free cultural territory (default, 3.6); `purchasePlot` optional gold "instantly develop" nicety |
| `diffusionRangeRings` | `3` | how far beyond the current border pressure reaches |
| `maxDiffusionPlots` | `12` | per-city cap on diffusion-claimed plots (high = "unbounded" feel) |
| `flipThreshold` | `100` | charge needed to flip |
| `flipMargin` | `1.15` | dominant must exceed owner's pressure by this ratio to charge |
| `chargeGain` | `12` | charge per turn while dominating |
| `chargeDecay` | `8` | charge lost per turn while not dominating |
| `sustainTurns` | `4` | consecutive dominating turns required before a flip |
| `flipCooldownTurns` | `10` | anti-flicker cooldown after a flip |
| `cityCoreProtection` | `true` | tiles adjacent to a city center never flip |
| `cultureWeight` / `happinessAmp` / `wonderBonus` / `ageFactor` | tuned | pressure shaping |
| `w_culture` / `w_ethnic` / `w_prosperity` / `w_power` | tuned | blend of the pressure layers (3.1a) |
| `w_legacy`/`w_flow`/`w_reach`/`w_vitality`/`w_prosperityDim`/`w_identity` | tuned | CPI dimension weights (advanced) |
| `preventForwardSettle` | `true` | prioritize claiming open buffer plots between you and rivals (the anti-forward-settle goal) |
| `intensity` | `Medium` | preset (Custom/Low/Medium/High) writing the above |

All exposed under **Options -> Mods -> Cultural Diffusion** (simple preset) and a
**Cultural Diffusion - Advanced** group, exactly like emigration.

---

## 6. Milestones

1. **M0 - Probe. OK DONE (2026-07-03).** Q-FLIP / Q-YIELD (integrated) / Q-BEYOND-CAP /
   rival flips all confirmed green in-game (probe v0.3.0); unowned Q-PERSIST green,
   rival/far persist a quick re-confirm. Build is unblocked.
2. **M1 - Read-only pressure model + lens.** Compute and *display* frontier pressure
   (culture + ethnicity + prosperity, 3.1a) with no ownership changes. Ships as a harmless
   visualization; validates the math against a real map.
3. **M2 - Claim unowned only (the anti-forward-settle buffer).** Enable diffusion into
   *empty* frontier plots via `setOwnership` (free territory), prioritizing buffer plots
   between you and rivals. **Verify the native-growth integration points from 3.5/3.6:**
   (a) a `setOwnership`-claimed tile enters the city's workable/expand set so the player can
   develop it via normal population/building growth (graduation, no block, no gold);
   (b) `setOwnership` ownership blocks foreign settling (the anti-forward-settle premise).
   Lowest-risk effect.
4. **M3 - Contest & flip.** Enable rival-owned flips with war/contest/core rules - the
   over-time border shifts + cramping of ill-placed forward settlements.
5. **M4 - Polish.** Notifications, per-city readout, Options screen, 11-locale
   ModText, tests, `release.sh`, mutation coverage - bring to emigration's bar.

---

## 7. Risks & guardrails

- **Single-player only.** `setOwnership`/`WorldBuilder` + local-player-turn model
  almost certainly excludes MP. Guard every mutation with the emigration/cheat
  `guardSP()` pattern (`Configuration.getGame().isAnyMultiplayer`).
- **GameConfiguration poison (crash gotcha).** Never write `Configuration.editGame().setValue`
  at runtime - it corrupts the persisted config and crashes on next launch (repo
  memory). State persists via the same store emigration uses (save-blob / localStorage
  mirror), never GameConfiguration.
- **Cosmetic-only flip.** If Q-YIELD shows `setOwnership` doesn't grant yields, use
  `purchasePlot`/`EXPAND` as the flip verb (integrated) and keep `setOwnership` only
  for un-claim/return.
- **AI fairness / fog.** Foreign (AI) plot writes may be fog-limited (emigration
  saw this). Default scope = flips that involve the local player; AI-vs-AI diffusion
  is a later opt-in once the probe confirms cross-civ writes land.
- **Border flicker.** `flipCooldownTurns` + `sustainTurns` prevent oscillation.
- **Runaway leader.** `maxDiffusionPlots` + `diffusionRangeRings` bound spread.
- **Performance.** Frontier enumeration is O(border plots), throttled to a bounded
  pass like emigration's; memoize per-pass distance/pressure reads.

---

## 8. Probe -> decision matrix

> **DECISION (2026-07-03): first row applies -> BUILD THE FULL MOD.** Q-FLIP green, Q-YIELD
> integrated, Q-BEYOND-CAP green, rival flips green. **Verb decision revised (3.6): core
> `flipVerb = setOwnership`** (free cultural territory; the player earns yields through normal
> population/building growth) - `purchasePlot` is only an optional gold "instantly develop"
> nicety, so its cost is not on the critical path. Only the rival/beyond-cap `Q-PERSIST`
> re-confirm remains (unowned already persisted); it does not gate the build.

| Probe result | Decision |
| --- | --- |
| Q-FLIP green, Q-PERSIST green, Q-YIELD integrated | Build full mod; **`flipVerb = setOwnership`** (free), yields via normal growth (3.6). **<- chosen** |
| Q-FLIP green, Q-PERSIST green, Q-YIELD only via `setOwnership` (cosmetic) | Build "territory + border competition" mod; yields follow when the city's normal growth reaches the tile. Document the limitation. |
| Q-FLIP green, Q-PERSIST **red** | Re-apply flips each load from our own persisted charge map (deterministic replay on `LoadComplete`). Feasible but heavier; note in spec. |
| Q-FLIP red | Not buildable with current APIs; fall back to a "cultural pressure lens + soft yield bonus" mod (no real flips). |

See `../probe/README.md` to run it.
