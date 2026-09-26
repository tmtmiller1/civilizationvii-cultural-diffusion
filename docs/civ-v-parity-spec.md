# Civ V parity spec — the original's algorithms this mod does not yet carry

Written 2026-09-25. Status: #1 built and watched in game; #2, #3, #4, #5, #6 and #8 built on 2026-09-26 against the
probe results, unit-tested and run once in game (see "Build record" at the end); #7 stays open. Every verdict below is
static analysis unless it says "watched"; the probes in the last section were run on 2026-09-25 (game 1.5.0) and their
results are recorded there and in [probe-history.md §6](probe-history.md).

The README credits Gedemon's Civilization V *Cultural Diffusion* (v18) and says its "terrain and ownership rules follow
that design". A side-by-side read of the v18 Lua against this mod shows the culture field (inject, diffuse, decay,
flip) is a faithful port with the same constants, but eight pieces of the original are missing or changed. This file
specs each one for Civ VII and decides what can be built, what cannot, and what needs a probe first.

Source of the original: [`CultureFunctions.lua`](<../../../../civilization_v_mods/other_peoples_mods/Cultural Diffusion (v 18)/Lua/CultureFunctions.lua>)
and [`CultureDefines.lua`](<../../../../civilization_v_mods/other_peoples_mods/Cultural Diffusion (v 18)/Lua/CultureDefines.lua>).
Line numbers below refer to those files.

## Summary

| # | Feature (Civ V function) | Verdict | Blocking question | Player impact | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 | River follow vs cross (`DiffuseCulture`) | Built and watched in game 2026-09-25: every row of the table delivered exactly what the field math predicts | P1-P3 answered: both river kinds are tiles, no edge read exists | Medium: rivers used to speed culture across, the opposite of V | Small |
| 2 | Every civ gains land by culture (`UpdatePlotOwnership`) | Built 2026-09-26, opt-in `aiCultureFlips` (`ui/cd-ai-flips.js`) | P4 answered: no refund needed, purchase is free; `grantYield` if ever | High: AI empires never grow by culture today | Medium |
| 3 | Foreign culture groups pump in cities (`GetCityCulturalOutput`) | Built 2026-09-26, on by default with #4 (`ui/cd-inject.js`) | none | Medium, only with #4 | Small |
| 4 | Conversion in cities (`ConvertCulture`) | Built 2026-09-26, on by default with #3 (`ui/cd-conversion.js`) | none | Medium, only with #3 | Medium |
| 5 | Culture transfer on city capture (`CityCultureOnCapture`) | Built 2026-09-26, on by default (`ui/cd-capture.js`) | P5 answered: `CityTransfered` reaches the UI for transfers with no local party (watched, major to independent) | Medium in war games | Small |
| 6 | Unit culture conquest (`UnitCaptureTile`) | Built 2026-09-26, opt-in `conquestFlip` (`ui/cd-conquest.js`), and watched: a five-turn hold took an enemy tile, confirmed next pass | P6 answered: `Units.get(data.unit).Combat.isCombat` classifies every moved unit (watched) | Medium, opt-in | Medium |
| 7 | Release a dead civ's land (`UpdateCultureMap`) | PARKED 2026-09-26 as a future idea: heritage culture ([potential-future-features.md](potential-future-features.md), "Heritage culture"). Cannot build as V did; the mod already excludes dead civs from winning | P7 partly answered: no defeated major in the test save; the only dead plot owner is the engine's wilderness pseudo-player | Low | None or tiny |
| 8 | Small rules: source threshold on mountains, owner floor of 1, total-culture city cap | Built 2026-09-26 (`sourceThresholdMountain`, `ownerFloor`, total cap in `ui/cd-inject.js`) | none | Low | Tiny |

Not specced because they were off by default in v18 or depend on a mod that has no Civ VII counterpart: the log10
injection curve (`CULTURE_OUTPUT_USE_LOG = false`), the Revolution mod's separatist culture group, and Gedemon's
emigration hook (`UpdateCultureOnEmigration`, lines 1038-1072, unfinished and never wired). The Emigration companion
mod already does more than that stub intended.

## 1. Rivers: follow versus cross, for both Civ VII river kinds

### What Civ V did

Rivers in Civ V run along tile edges. `DiffuseCulture` (lines 414-634) checks the edge between the source and the
neighbour in the direction of travel:

- **Following a river** (`plot:IsRiverConnection(direction) and not plot:IsRiverCrossing(direction)`): the step runs
  along the river on one bank. Rate bonus +65%, neighbour cap ×1.8 (`CULTURE_FOLLOW_RIVER_BONUS`, `_MAX`).
- **Crossing a river** (`plot:IsRiverCrossing(direction)`): the step jumps the river. The source must exceed 200
  (2× the base threshold), then the rate takes a +50% malus and the cap ×0.35 (`CULTURE_CROSS_RIVER_*`). Below the
  gate nothing crosses.

So a river was a highway along its bank and a wall across it. Water tiles received no culture at all.

### What Civ VII has

Civ VII has two river kinds, and neither is an edge.

- **Minor rivers** are a property of a land tile. `GameplayMap.getRiverType(x, y)` returns `RiverTypes.RIVER_MINOR`
  on the tile, the tile keeps its own terrain (flat or hill), and it can be worked and built on. Map scripts write them
  tile by tile with `TerrainBuilder.setRiverInfo(x, y, direction, RiverTypes.RIVER_MINOR)`, where the direction is the
  flow toward the next tile. Evidence: static, from `feature-biome-generator.js` (`isRiver` on land tiles) and the
  Earth maps' `setRiverInfo` calls.
- **Navigable rivers** are their own terrain, `TERRAIN_NAVIGABLE_RIVER`. `getRiverType` returns
  `RiverTypes.RIVER_NAVIGABLE` and `GameplayMap.isNavigableRiver(x, y)` is true. The compiled `Terrains` table gives it
  `Water = 0`, so the engine does not class it as water even though ships sail it. Evidence: static, from
  `Debug/gameplay-copy.sqlite` (`_debug-db` snapshot) and `discovery-generator.js`.
- Every river tile can carry a name: `GameplayMap.getRiverName(x, y)`, used by the plot tooltip.
- No shipped script calls a river-edge test. The only edge-crossing read in the base game is
  `GameplayMap.isCliffCrossing(x, y, direction)`. Whether an undocumented `isRiverCrossing` exists is probe P3.
- The engine does charge for rivers: `MOVEMENT_RIVER_COST = 2`, `COMBAT_RIVER_ATTACK_PENALTY = -2` and
  `COMBAT_RIVER_DEFENSE_PENALTY = -2` in `GlobalParameters`. Which step pays them is not visible statically.

### What this mod does today (a defect, not only a gap)

`routeRiverBonus` in [`cd-terrain.js`](../ui/cd-terrain.js) grants the follow bonus whenever the **destination** is a
river tile of either kind (`onRiver(dst)`), whatever the source is. `isWater` is false on navigable river tiles
(`Water = 0`), so they take the land path and get the bonus too. Result: a step from a dry bank straight onto a river
gets +65% rate and a ×1.8 cap. Rivers of both kinds currently **speed culture across them**, which inverts the Civ V
rule. Nothing ever takes the crossing malus.

### Built model (decided 2026-09-25)

Status: built, unit-tested, and watched in game on 2026-09-25 (harness runs `parity` and `parity2`,
[probe-history.md §6](probe-history.md)). Both kinds of river now copy the Civ V behaviour, a highway
along the river and a wall across it, and the highway along a navigable river is stronger than along a minor one
(user decision). Code: `riverStep` in [`cd-terrain.js`](../ui/cd-terrain.js); tests:
[`tests/rivers.mjs`](../tests/rivers.mjs).

Each diffusion step is classified by the river kind of the source tile and the destination tile. "Same river" means
both tiles carry the same `getRiverName`; a missing name on either side counts as the same river, which probe P1 must
show is safe. Two different names are two rivers, so a confluence is a crossing.

| Source | Destination | Class | Modifier (defaults) |
| --- | --- | --- | --- |
| Navigable | Navigable, same river | Follow, navigable | rate +100%, cap ×2.5 (`navigableFollowBonus`, `navigableFollowMax`; road strength) |
| Minor | Minor, same river | Follow, minor | rate +65%, cap ×1.8 (`riverFollowBonus`, `riverFollowMax`; Civ V river values) |
| Anything else | Navigable | Cross into the channel | gate 2.0× threshold, rate malus +50%, cap ×0.35 (`terrainNavigableCross`) |
| Anything else | Minor | Cross onto the river | gate 2.0× threshold, rate malus +50%, cap ×0.35 (`terrainRiverCross`; Civ V `CULTURE_CROSS_RIVER_*`) |
| Any river | No river | Leaving the river | no river modifier; the destination's own terrain applies |

"Anything else" is a bank tile, the other river kind, or a differently named river. The crossing stacks with the
destination's own terrain, so stepping onto a minor river on hills pays both gates. A navigable channel has no land
terrain of its own, so its biome and feature are ignored and only the crossing applies. The two crossings are separate
keys with the same Civ V values, so a wider navigable river can be made a stronger wall by tuning alone.

The cap `maxPercent` (75% of the source) still bounds every step, so along a river the two kinds differ mainly in rate:
a minor follow reaches a cap of 72% of the source, a navigable follow is clipped at 75%.

**One crossing cost per river.** On tiles, crossing a river is two steps, bank onto river and river onto the far bank.
The cost is charged on the way in only. Charging both steps would make a river cost twice what Civ V charged. The
consequence: once a culture is established on the river itself, it spills onto either bank at the normal rate. A river
divides two cultures until one of them is strong enough to hold the river, then it stops being a border. That is the
tile-based reading of Civ V's edge rule, where the river line itself held no culture.

**Minor rivers are tiles here too.** Civ V's minor-river rule was about edges. The static evidence says Civ VII stores
minor rivers per tile, so the same follow-and-cross rule is applied to them. If probe P3 finds an edge-level river read,
or P1 shows minor rivers are really stored on edges, switch minor rivers to the Civ V edge rule and use the edge read.

**Detection.** A navigable river is recognised by `isNavigableRiver`, by its terrain type, or by
`RiverTypes.RIVER_NAVIGABLE`, so a missing API on one build never demotes it to a minor river. It always takes the
river path, even if `isWater` calls it wet on some build (probe P2), so it can never be mistaken for coast.

### Verdict

Built and watched. Pure field math, no engine writes. `tests/rivers.mjs` covers every row of the table, the stacking
with hills, confluences, the detection fallbacks, and an end-to-end check that along a navigable river delivers more
than along a minor one, which delivers more than plain land, while either crossing delivers less. The same tests fail
against the previous rule. In game (2026-09-25, AugustusAnt136, one pass from a cleared and seeded field) each row
delivered exactly the value `diffusionDelivered` predicts from the live `stepMods` of that step: the weak bank source
put nothing onto the river (gate), the minor-river follow gave 1.65× the plain-land step, the navigable follow 2.0×,
the bank-onto-navigable crossing 0.67×, and the bank-onto-minor-river-on-hills crossing 0.61× with both gates stacked.
P1-P3 confirmed the reads the rule relies on: both river kinds are per-tile named chains, a navigable tile is not
water, and no edge-level river read exists.

## 2. Every civilization gains land by culture

### What Civ V did

`UpdatePlotOwnership` (lines 164-273) swept every culture-bearing plot on the map each turn and flipped it to whichever
living civ led, with the same gates this mod uses (minimum 300, ratio 0.65 against the incumbent, within 6 of one of
the winner's cities, adjacent to the winner's land). It acted for every player. AI empires grew and lost land by
culture exactly as the human did, and both sides got a notification.

### What this mod does today

Rival cities inject culture, so their stock defends their tiles and contests ours. But `tryFlipCandidate` only ever
flips for the local player ([`cd-pass.js:6`](../ui/cd-pass.js)). A rival gains a tile only through the opt-in recede
option, and only a tile this mod claimed for us. This is the largest divergence from the original and the one a player
notices: AI borders never move by culture.

### Engine surface

- **The verb works for a rival.** The recede cession calls `purchasePlot` on the rival's nearest city, and harness run 1
  (game 1.4.2) watched a rival city take a tile back with the same deferred landing as our own claims
  ([probe-history.md §5](probe-history.md)). So an AI flip is the same call with a different city.
- **Gold.** Watched 2026-09-25 (P4 and the gold runs, [probe-history.md §6](probe-history.md)): a script
  `purchasePlot` charges nobody on 1.5.0, `Treasury.changeGoldBalance` is a no-op for every player, and
  `Players.grantYield(pid, YIELD_GOLD, n)` is the verb that moves gold, for an AI as for us. An AI flip therefore needs
  no refund; if one is ever needed, `grantGold` must use `grantYield` first.
- **Multiplayer.** `guardSP()` blocks every mutating verb in multiplayer, so this stays single-player like the rest of
  the mod.
- **Region.** The field is simulated only within `fieldRadius` (8) of the local player's cities, because a whole-map
  sweep each turn is too slow in Gameface. AI flips can therefore only happen inside that region.

### Design

Generalise the flip step from "local player" to "every living major civ", inside the existing region:

1. For each candidate tile, the leader from `resolveOwner` is the civ that may gain it. Drop the `leader === me` check
   in `passCanAct`; keep "leader differs from the current owner".
2. Run the same shared gates from `cd-eligibility.js` for the leader, not for us: peace with the incumbent, adjacency to
   the leader's land, `flipMaxDistance` from one of the leader's cities, core protection, the strand guard, and the
   leader's per-city cap.
3. Commit through the leader's nearest city with `performFlip({ playerId: leader, city, ... })`, refunding the leader.
4. Keep the per-pass ceiling `maxFlipsPerTurn` global, and sort candidates so our tiles are not starved: nearest to any
   city first, ties broken in the local player's favour.
5. Independent Powers and city-states: gate on `isMajor === true`. `isAtWarWith` is true for every Independent Power,
   so war checks must never be the only filter.
6. Notify the local player when an AI takes one of our tiles or a tile next to ours. Log the rest under debug.

The recede step becomes a special case of this and can be folded in.

### The asymmetry to accept or fix

Inside the region AI civs grow by culture; outside it nothing moves. AI-versus-AI borders far from the player stay
frozen. Two ways out, both measured before chosen:

- **Accept it** (recommended first). The player sees borders move where they are looking, and that is where the rule
  matters. Document it in the README's limitations.
- **Rolling far-field.** Simulate one extra slice of the map each turn (for example a band of rows) so every region
  is updated every N turns at N× the step size. Needs a timing measurement of the current pass first, since the
  constraint is Gameface frame time.

### Verdict

Can build inside the field region. Verb watched working for a rival; refund to an AI is probe P4. If P4 fails, the AI
flip still works but costs the AI gold, which is acceptable as a documented behaviour or can be avoided by refunding
through `grantYield`. Opt-in toggle `aiCultureFlips`, default on only after a balance pass, since it changes how the
AI's territory evolves. Tests: pass tests with a rival leader winning an unowned tile, a rival leader taking our tile,
an Independent Power leader being skipped, and the global ceiling.

## 3. Foreign culture groups in cities

### What Civ V did

`GetCityCulturalOutput` (lines 84-162) injected into the city plot for **every** culture present there, not only the
owner's. The owner's group grew by `(population + culture per turn) × sqrt(stock × 0.15) + 10`. Every foreign group
grew by `population × sqrt(stock × 0.15) + 10`, using population alone. The Liberty policy let foreign groups use the
full formula. The cap `(population + culture per turn) × 2000` applied to the **total** culture on the plot; once it
was reached, nothing was injected for anyone.

The effect: a captured or mixed city kept producing its old culture, which diffused outward and contested the
conqueror's hold on the surrounding land until conversion (#4) wore it down.

### What this mod does today

Only the settlement owner injects (`injectStep` in [`cd-pass.js`](../ui/cd-pass.js)). The cap is applied to the owner's
own stock, not to the total.

### Design

- For each injector, also inject for every other civ with stock on the city tile:
  `foreignStrength × sqrt(stock × injectRatio) + injectBase`, where `foreignStrength` is population-based, as in Civ V.
  Population is readable on the city object the pass already holds.
- When Emigration is present, weight each foreign group by its share of the city's population composition
  (`EmigrationEthnos_v1`, already read by `cd-emigration.js`). A city whose people really are 30% Greek pumps Greek
  culture at 30% of its population. Without Emigration, use the Civ V rule: any group with stock above zero counts.
- Apply the cap to the total culture on the tile, as Civ V did. Keep the per-civ cap as a fallback so a missing
  population read never removes the cap.
- Skip the Liberty equivalent. There is no Civ VII policy with that meaning, and inventing one adds a tuning knob
  without a player-facing reason.

### Dependency

Ship with #4 or not at all. Without conversion, foreign stock in a captured city never erodes, and the conqueror can
never hold the land around it. Civ V needed both halves; so does this.

### Verdict

Can build. Pure field math. Tests in `tests/field.mjs` for the foreign formula and the total cap, and in
`tests/pass.mjs` for a captured city whose old owner's stock keeps injecting.

## 4. Conversion in cities

### What Civ V did

`ConvertCulture` (lines 328-413) ran only on city plots. Each turn it moved a percentage of every foreign group's stock
to the owner: base 0.5%, plus bonuses for Tradition (opener and finisher, +0.5% each), the ideologies and their tenets
(+1.0% to +1.75%), Library (+0.25%), University (+0.5%) and Public School (+1%).

### Civ VII mapping

| Civ V source | Civ VII read | Notes |
| --- | --- | --- |
| Base 0.5% | constant `convertBase` | unchanged |
| Library, University, Public School | `city.Constructibles` has the building | Antiquity: Library, Academy. Exploration: University, Observatory. Modern: read the age's science buildings from `GameInfo.Constructibles` at runtime; the Debug DB holds only the loaded age |
| Tradition opener and finisher | `player.Culture.getActiveTraditions(slot)` | already read by [`cd-metrics.js`](../ui/cd-metrics.js); candidates include `TRADITION_NATIONAL_PRESTIGE` and `TRADITION_PROPAGANDA` |
| Ideologies | `player.Culture.getChosenIdeology()` | Modern age only |

Keep the table of bonuses as data in `cd-config.js`, keyed by type string, so an age or DLC with different buildings
needs no code change. A missing type is ignored, never an error.

### Double counting

The fused CPI already rewards traditions and culture buildings through the injection strength. Conversion rewards them
again, in a different way: CPI makes the owner's culture spread, conversion makes foreign culture in its cities fade.
Keep conversion rates small (the Civ V numbers are fractions of a percent) and tune with #3 on, because conversion
only has anything to act on when foreign groups inject.

### Verdict

Can build. Pure field math plus reads the mod already makes. Tests: conversion moves stock from foreign to owner at the
configured rate, a missing building type is ignored, and the ideology branch is skipped outside the Modern age.

## 5. Culture transfer when a city is captured

### What Civ V did

`CityCultureOnCapture` (lines 635-679): on capture, every culture on each of the city's tiles lost 55%, and the
conqueror gained 75% of the total lost. A conquered region started leaning toward its new owner at once.

### What this mod does today

Nothing. The mod does not subscribe to any capture event, so the field keeps the old owner's stock and the conqueror
starts from zero on the captured land.

### Engine surface

- `engine.on("CityTransfered", data)` fires on capture. `data.cityID` carries the new owner and `data.location` the
  city tile. Demographics and Emigration both subscribe to it already and treat razing (`CityRemovedFromMap`) as a
  separate event. Whether it fires in the UI context for a capture between two AI civs is probe P5.
- The city's tiles: `city.getPurchasedPlots()` or `GameplayMap.getOwningCityFromXY` over the field region. Both are
  used by the base game.
- No engine write is needed. The change is to the persisted field only, so there is no verb risk.

### Design

On `CityTransfered`, for each tile owned by that city and inside the field, reduce every civ's stock by
`captureLoss` (0.55) and add `captureGain` (0.75) of the removed total to the new owner. Save the state immediately so a
save-and-reload before the next pass keeps it. Captures outside the region have no field data and are skipped.

Pairs with #3 and #4: after a capture the old owner's stock still injects in the city (#3) and is converted away over
time (#4). Without #3 and #4 this step still helps on its own.

### Verdict

Can build. Small. Tests: a unit test for the loss and gain arithmetic, and a pass test that a capture event rewrites
only the captured city's tiles.

## 6. Unit culture conquest

### What Civ V did

`UnitCaptureTile` (lines 833-956), off by default: a combat unit entering an enemy tile during war took it, optionally
without needing more culture there (`CULTURE_CONQUEST_EVEN_LOWER`, `_EVEN_NONE`), only if adjacent to the unit owner's
land, and locked it for 15 turns.

### What this mod does today

Nothing. The Steam description lists "tile ownership flip on conquest" as planned, and
[reference-and-conventions.md](reference-and-conventions.md) has a phase-4 design with an occupation counter
(`conquestFlip`, `conquestBufferTurns`), but there is no code and no `tests/conquest.mjs`.

### Engine surface

- `engine.on("UnitMoved", data)` carries `data.unit` (a component id) and is used by the base game. The unit's owner and
  location are readable from the unit object. Whether a combat test is available on the unit (`isCombat` appears once
  in the shipped scripts) is probe P6.
- The flip verb is `purchasePlot` on the conqueror's nearest city, watched working on rival land.
- War: `isAtWarWith`, restricted to majors, since every Independent Power reads as at war.
- The lock map exists (`flipCooldownTurns`).

### Design

Build the phase-4 design rather than Civ V's instant flip: a tile held continuously by one side's combat unit for
`conquestBufferTurns` during a war changes hands, ignoring culture, then locks. The counter resets when the unit leaves.
The buffer avoids tiles flickering as armies move through, which instant flips caused in Civ V. City and district tiles
are never taken this way; capturing a city is the engine's job.

For the local player's units, this is independent of #2. For AI units taking our land or each other's, it rides on the
AI flip path from #2.

### Verdict

Can build for the local player. Opt-in (`conquestFlip`, default off), as in Civ V. Needs P6. Tests: the counter
increments on a continuous hold, resets on vacate, flips exactly at the buffer, respects the toggle, and skips cities.

## 7. Releasing a dead civ's land

### What Civ V did

In `UpdateCultureMap` (lines 681-785), any plot still owned by a dead player was set to no owner, and dead civs were
excluded from winning a plot.

### Civ VII

Excluding dead civs from winning is already done (`findDeadOwners`, `resolveOwner`). Releasing land to no one cannot be
done: `setOwnership(NO_PLAYER)` never un-owns a city-attached tile ([engine-closed list](../../../engine-closed.md),
watched on 1.4.2). But in Civ VII territory belongs to cities, and a defeated player has none, so there should be no
dead-owned land to release. Probe P7 confirms that with one read after a defeat.

### Verdict

Cannot build as Civ V did, and likely unnecessary. If P7 finds orphaned dead-owned plots, reassign them to the nearest
living claimant through the normal flip path rather than releasing them.

## 8. Three small rules

- **Mountain source threshold.** `PlotCultureThreshold` (lines 76-82) made a mountain tile need 750 before it diffused
  at all; other tiles need 100. This mod uses 100 everywhere. Add `sourceThresholdMountain` (7.5× the base). Effect is
  small because mountains already hold at most 10% of their source.
- **Owner floor.** Civ V kept at least 1 of the owner's culture on its own plots (`MINIMAL_CULTURE_ON_OWNED_PLOT`). This
  mod decays owned plots to zero. Only matters for the lens's "no culture" state on owned land; add it for parity.
- **Total-culture cap on the city tile.** Covered in #3.

All three can be built in a few lines each, with a unit test apiece.

## Probes

Each probe is one read in a running game over the CDP port (9444) or the in-game harness, and each can disprove the
design it guards. Run them before building the feature that depends on them, one session using the game at a time.

| Probe | Question | Cheapest test | Guards |
| --- | --- | --- | --- |
| P1 | Are minor rivers per tile, and do tiles of one river share a name? | Dump `getRiverType` and `getRiverName` for a 10×10 window around a visible river, compare with the rendered map | #1 |
| P2 | Is a navigable river tile water to the engine? | `GameplayMap.isWater`, `getTerrainType` and `isNavigableRiver` on one channel tile | #1 |
| P3 | Is there any edge-level river read? | List the methods on `GameplayMap` and grep for "River" | #1 (switches minor rivers to the edge rule if found) |
| P4 | Can gold be refunded to an AI? | `changeGoldBalance` on a rival, then read its `Treasury.goldBalance` before, at +3 s and after a turn | #2 |
| P5 | Does `CityTransfered` fire in the UI for AI-vs-AI captures? | Log every `CityTransfered` over an autoplayed war | #5 |
| P6 | Can a moved unit be classed as combat? | On `UnitMoved`, read the unit and test `isCombat` or its `Combat` component | #6 |
| P7 | Does a defeated player keep any plots? | After `PlayerDefeat`, count plots whose owner is that player | #7 |

### Results (2026-09-25, game 1.5.0, `devtools/harness/cdh-game-parity.js`, full record in [probe-history.md §6](probe-history.md))

| Probe | Result | Consequence |
| --- | --- | --- |
| P1 | Yes. 236 minor and 116 navigable river tiles on a 96×60 map, 350 of 352 named, forming 1-wide chains (mean 1.3 same-name river neighbours per tile, never a 2-wide band); 24 adjacent pairs carry different names (confluences) | The tile rule for minor rivers stands; the "unnamed counts as the same river" and "different name is a crossing" rules cover the real cases |
| P2 | No. `isWater` false, terrain `TERRAIN_NAVIGABLE_RIVER`, `isNavigableRiver` true, `isImpassable` false, `isCoastalLand` true | The channel takes the land path; the isWater override is a safety net this build never needs |
| P3 | No. `GameplayMap` has only tile reads (`getRiverName`, `getRiverType`, `isAdjacentToRivers`, `isNavigableRiver`, `isRiver`); `MapRivers` speaks in plots; `RiverTypes` is `NO_RIVER -1, RIVER_MINOR 0, RIVER_NAVIGABLE 1` | No edge rule to switch to. `isAdjacentToRivers` is true on the river tile itself, so it cannot tell bank from river |
| P4 | `Treasury.changeGoldBalance` moves nothing, on a rival OR on the local player, within 60 s or across a turn. `Players.grantYield(pid, YIELD_GOLD, n)` lands at +3 s on both. And a script `purchasePlot` costs nothing: 0 on the tick, through +60 s, and at the turn roll (a clean roll with no Autoplay) | An AI can be refunded, through `grantYield`; the mod's preferred refund verb is dead on this build, which costs nothing today because the purchase is free. #2 needs no refund at all unless the engine prices script purchases again |
| P5 | Yes. Two transfers watched: our Glasgow to player 3 (a capture; `CityRemovedFromMap` + `CityAddedToMap` accompany it), and player 6's Tendirma to independent 12 with no local party | #5 can subscribe; payload `{ fromPlayer, transferType, cityID }` with the city already under its new owner |
| P6 | Yes. `UnitMoved` fires for every player's units (8,615 foreign of 9,072); `Units.get(data.unit).Combat.isCombat` split them 8,067 combat to 988 civilian | #6 has its combat test |
| P7 | No defeated major in the save. The two dead ids are a placeholder city-state with no plots and pseudo-player 63 (`CIVILIZATION_NONE`), which owns six `DISTRICT_WILDERNESS` plots (coast, wreckage, campfire, tents, cave improvements) with no owning city | Still open for a real defeat. Note that `getOwner` returns a dead id on wilderness plots, so the district check is what keeps them out of the claim path |

## Suggested order

1. **#1 rivers**. Built; P1-P3 are the in-game check.
2. **#8 small rules**, alongside #1, since both are field-math only.
3. **#5 capture transfer**, small and independent.
4. **#3 and #4 together**, then a balance pass with the pacing simulator.
5. **#2 AI flips**, after P4 and a timing measurement of the pass. This is the change players will feel most, so it
   ships opt-in first.
6. **#6 unit conquest**, last, opt-in.

When any of these lands, update the README credits line so it states which Civ V rules are carried and which differ.

## Build record (2026-09-26)

Built in one change against the probe results above (the conquest watch followed the same day): #2 (`ui/cd-ai-flips.js`, opt-in `aiCultureFlips`), #3 and #4
(`ui/cd-inject.js` + `ui/cd-conversion.js`, `foreignCultureInCities`, on by default), #5 (`ui/cd-capture.js`,
`captureTransfer`, on by default), #6 (`ui/cd-conquest.js`, opt-in `conquestFlip`), #8 (`sourceThresholdMountain`,
`ownerFloor`, the total cap in `cd-inject.js`). The flip commit shared by the player and the AI moved to
`ui/cd-flip.js`; the pass calls the new steps in the order decay, diffuse, inject, convert, floor, flips, AI flips,
recede, conquest. Options gained three toggles; the pressure lens and its readout ask the AI-flip gates for the leading
player. Gold writes go through `Players.grantYield` (P4). Unit tests: `tests/parity.mjs`, `tests/capture.mjs`,
`tests/conversion.mjs`, `tests/pass.mjs` §20-§24, and updates to the options, verdict and ownership suites.

Run once in game (`devtools/harness/cdh-game-build.js`, log `build-UI.log`, both opt-in toggles patched on):

| Item | Watched |
| --- | --- |
| #2 AI flip | A rival city took a seeded tile (pending, then `claim confirmed on the live map` next pass), and kept claiming from the diffusing stock on later turns |
| #3 foreign injection | On our capital (population 24) a rival stock of 500 rose to 681 in one pass where decay alone leaves 474 |
| #4 conversion | The same pass converted the foreign share to the owner (the arithmetic pinned in `tests/parity.mjs`) |
| #5 capture transfer | The handler on a real city read 24 purchased plots and rewrote the centre's 1000 to exactly 862.5 |
| #8 owner floor | 158 owned region tiles carried the floor after one pass |
| #6 conquest | Watched in a second run (`cdh-game-conquest.js`, `conquest-UI.log`): at war with player 3, a Spearman created on their tile 83,32 beside our land held it; the counter read 1, 2, 3, 4 on turns 136-139; on turn 140 the pass logged `conquest 83,32: taken from player 3 by player 0's unit`, the tile read as ours at +5 s, and turn 141's pass logged `pending 83,32 claim confirmed on the live map`. The unit stood there unharmed throughout. The tile sat inside our city's ring 3, so the inner-ring rule then dropped the claim record and, in that build, the lock too; the tile stayed ours. Fixed the same day: the release keeps the lock, and a conquest now applies its own `conquestHoldTurns` (10) hold against culture, which another army never waits on. Retake rules, decided the same day: an army at any time; culture only after peace and after the hold, by the standard method, for any civilization whose culture leads, not only the original owner |
| #7 | Not built. No defeated major has been watched; the only dead plot owner seen is the engine's wilderness pseudo-player |

What differs from the spec text above: the AI has its own per-pass ceiling rather than sharing ours; the conquest
buffer counts passes and is not scaled to game speed; a foreign group without Emigration data is pumped only once it
holds `foreignGroupMinStock` on the tile (Civ V pumped any group above zero), to keep a neighbour's trickle from being
amplified by the city's own people; and no refund is made for an AI flip, because a script purchase was watched
charging nothing.
