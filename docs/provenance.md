# Provenance: what this mod shares with Gedemon's Cultural Diffusion

Cultural Diffusion for Civilization VII grew out of Gedemon's *Cultural Diffusion* mod for Civilization V. This page
sets out exactly what came from his mod and what's new. It compares version 1.7.0 of this mod against his v18, the
last release of the Civ V mod. Line numbers below are as of 1.7.0 for this mod and v18 for his.

How it was checked: every one of his functions and constants was read next to the JavaScript and matched by hand, the
constants were compared value by value, all of his text was run through a word-sequence scan against every text file
in this repo, and the git history was read for when each part arrived. The method section at the end has the details.

The short version:

- **The core culture model is a port of Gedemon's.** The per-tile culture stock and its inject, diffuse, decay and
  ownership steps follow his formulas, and 50 of his tunable numbers are in `ui/cd-config.js` with the same values.
- **His code text, strings and data aren't in the mod.** This mod is JavaScript for a different engine. His Lua, SQL
  and XML rows, his readme and his in-game text don't appear in it, apart from two comments that quote his constant
  names and percentages on purpose.
- **By lines, most of the shipping code is new.** Of the 5,722 code lines in the 43 shipping JavaScript files, about
  243 (4.2%) port his logic function for function, about 515 (9.0%) adapt his ideas with real changes, and 4,964
  (86.8%) are original. That's the strict reading. The most generous reading counts every module that touches the
  port as derived in full, about 1,090 lines or 19%. Either way, original code is 81-87% of what ships.

Line counts don't measure importance, though. The ported 4% is the culture field itself: the math every tile runs every
turn, and the numbers that decide how far and how fast culture spreads. Most of the rest is what it takes to make that
field work in Civ VII, what's built on top of it, and how the player sees it. By line count the mod is mostly new; by
design, its central mechanic is Gedemon's.

Seen from his side, about 590 of the roughly 1,350 lines of logic in his Lua (leaving out debug print lines) have a
counterpart here, plus his constants file. The rest of his code is Civ V plumbing this mod didn't need: his save
system, civilization-type lookups, tooltip hooks, policy text and links to the Revolution mod.

## What came from Gedemon

### Which files in his mod are his

His v18 package holds seven Lua files of his own, an options XML file, a short SQL file, a readme and a `.modinfo`.
Two more Lua files, `Lua/SaveUtils.lua` and `Lua/ShareData.lua`, are by Ryan F. Mercer ("Whys"), and Gedemon's readme
credits him; this mod uses neither. `Lua/CultureSpecDefines.lua` is Gedemon's, but v18 doesn't load it (its include in
`Lua/CultureMain.lua` is commented out), so the constants below come from `Lua/CultureDefines.lua`.

### Function map

Classes: **port** means the same algorithm and structure, translated to JavaScript; **adapted** means the same idea,
changed in a way that matters; **not ported** means this mod doesn't have a counterpart. His line numbers are where
each function starts. All of this mod's files are under `ui/`.

#### `Lua/CultureFunctions.lua`

| Gedemon function | Line | Counterpart in this mod | Class | What changed |
| --- | --- | --- | --- | --- |
| `GetPlotCulture`, `GetPlotTotalCulture`, `GetPlotCulturePercent`, `GetCivPlotCulture`, `ChangeCivPlotCulture` | 10, 20, 38, 63, 274 | direct reads of a keyed row; `sumRow` in `cd-inject.js:27` | not ported | His list of `{ID, Value}` pairs keyed by civilization type became a plain map keyed by player id. |
| `PlotCultureThreshold` | 76 | `sourceThreshold`, `cd-terrain.js:80` | port | Same rule: a tile needs 100 culture to spread, or 750 on a mountain. |
| `GetCityCulturalOutput` | 84 | `injectionAmount` `cd-field.js:22`, `cityCultureCap` `cd-field.js:38`; `injectStep` `cd-inject.js:40`, `injectOwner` :56, `foreignStrength` :79, `injectForeignGroups` :91 | port (formula), adapted (inputs) | Same curve, `s * sqrt(v * 0.15) + 10`. The owner's strength is the mod's Cultural Power Index projection rather than population plus culture per turn. Foreign groups use population times their share from the Emigration mod, or a floor of 100 stock. The cap clamps injection to the room left instead of skipping it. His Liberty bonus isn't carried over. |
| `UpdatePlotOwnership` | 164 | `strongestCulture` `cd-field.js:100`, `resolveOwner` `cd-field.js:122`; `findDeadOwners` `cd-pass.js:275`, `flipCandidates` :289, `tryFlipCandidate` :304, `resolveOwnership` :324; `resolveAiOwnership` `cd-ai-flips.js:71`; `commitFlip` `cd-flip.js:53`; the recede path in `cd-recede.js` | port (ownership test), adapted (sweep) | The ownership test is identical. The sweep runs inside a radius-8 region, flips tiles for the player and (by default) AI majors, and adds gates his doesn't have: peace, core protection, per-city caps, unit safety, districts and pending claims. |
| `DecayCulture` | 300 | `decayValue` `cd-field.js:49`; `decayStep` `cd-pass.js:201` | port | Same `v - (v * 0.05 + 1)`. This mod keeps fractions where he rounds down, and the owner's minimum is its own step. |
| `ConvertCulture` | 328 | `convertCityCulture` `cd-field.js:162`; `convertStep` `cd-inject.js:122`; `conversionRateFor` `cd-conversion.js:102` | port (move), adapted (rate table) | Same base 0.5% moved from each foreign group to the owner, in cities only. His Civ V policies and buildings became a table of Civ VII buildings and ideologies. |
| `DiffuseCulture` | 414 | `diffusionDelivered` `cd-field.js:74`; `diffuseStep` `cd-pass.js:237`, `diffuseToNeighbor` :217; `stepMods` `cd-terrain.js:186`, `landStep` :201, `roadBonus` :221, `crossingMods` :165, `biomeMod` :133, `featureMod` :141, `riverStep` :238, `waterStep` :157 | port (rate, cap, gates, roads), adapted (terrain, rivers), new (water) | Rate, cap and gate arithmetic are identical. Terrain is mapped to Civ VII's terrain, biome and feature types; mountains replace the other penalties instead of stacking with them; snow is gone. Rivers are read per tile with two strengths instead of per edge. An ethnic-affinity bonus and water crossing are added; he blocked water. |
| `CityCultureOnCapture` | 635 | `applyCaptureTransfer` `cd-field.js:187`; `cityPlots` `cd-capture.js:54`, `transferCityCulture` :75, `onCityTransfered` :91 | port | Same 55% loss and 75% gain, applied over the captured city's tiles. |
| `UpdateCultureMap` | 681 | `passBody` `cd-pass.js:610`, `updateField` :259; the lock countdown in `prepareState` `cd-state.js:242` | adapted | Same step order: decay, diffuse, inject, convert, ownership, lock countdown. This mod double-buffers over a bounded region where he updates the whole map in place. His release of a dead civilization's land isn't carried over. |
| `OnCultureChangePlot` | 786 | `ownerFloorStep`, `cd-inject.js:140` | adapted | He gave a new owner 1 culture when a tile changed hands; this mod keeps that minimum on every owned tile each pass. |
| `GetCultureValueString` | 814 | — | not ported | His strength words (feeble, low, sparse, average, established, entrenched). This mod shows numbers. |
| `UnitCaptureTile` | 833 | `conquestSweep` `cd-conquest.js:184`, `sweepTile` :159, `conquer` :132, `hostileCombatOccupants` :54, `conquerable` :78; `tickOccupation` :94 is new | adapted | His units took a tile the moment they entered it, then locked it for 15 turns. Here a unit has to hold the tile for 5 turns, and it's then held for 10. The core is the same: a combat unit, at war, ignoring culture, credited to the nearest city. |
| `GetRelationValueString`, `GetCultureTypeAdj` | 957, 983 | — | not ported | Revolution-mod relations and civilization adjectives. |
| `InitializeGameOption` | 1004 | — | not ported | His four setup-screen switches line up loosely with this mod's `aiCultureFlips`, `claimOnlyUnowned` and `conquestFlip` options, which are its own code. |
| `UpdateCultureOnEmigration` | 1038 | — | not ported | An unfinished stub in his mod. `cd-emigration.js` is an unrelated bridge to Tower's Emigration mod. |
| `SetDiffusionFactorFromGameSetting` | 1074 | `agePace` `cd-calibration.js:42`, `mapSizeScale` :78; applied in `ageContext` `cd-pass.js:139` | adapted | He scaled diffusion only, by game length and map area. This mod scales diffusion, decay and injection by the age's length, and map size nudges injection only. |
| `IsAdjacentToOwner` | 1119 | `adjacentToMe` `cd-eligibility.js:92`; `touches` `cd-conquest.js:106`; `touchesOwner` `cd-recede.js:39` | port | A simple neighbor check; the comment above `adjacentToMe` names his function. |

#### `Lua/CultureUtils.lua`

| Gedemon function | Line | Counterpart in this mod | Class | Note |
| --- | --- | --- | --- | --- |
| `GetPlotKey` | 19 | `key`, `cd-pass.js:44` | port (trivial) | Same `"x,y"` string key. |
| `GetPlot`, `GetPlotFromKey`, `GetPlotXYFromKey` | 14, 29, 37 | `unkey`, `cd-pass.js:49` | port (trivial) | Parses the same key. |
| `GetCloseCity` | 44 | `nearestCity` `cd-eligibility.js:63`; `nearestCityOf` `cd-conquest.js:115`; `nearest` `cd-recede.js:29` | port (trivial) | A generic nearest-city search. |
| `GetAdjacentPlots` | 58 | `plotsInRadius(p, 1)` in `cd-plots.js` | not ported | Uses the Civ VII map API. |
| `LoadCultureMap` through `SaveTableOnBarbarianTurn` | 94-181 | `loadState`, `saveState` in `cd-state.js` | not ported | Different storage: versioned JSON in the game configuration instead of his save slots. |
| `Round`, `Shuffle`, `GetSize` and his civilization-type helpers | 187-343 | — | not ported | Civ V plumbing. |

#### `Lua/CultureUIFunctions.lua`, `Lua/CultureMain.lua`, `Lua/CultureDebug.lua` and his data files

| Gedemon function or file | Line | Counterpart in this mod | Class | Note |
| --- | --- | --- | --- | --- |
| `GetCulturePlotHelpString` | UI 22 | `contenderRows`, `cd-pressure-tooltip.js:281` | adapted | Both list a tile's cultures from highest to lowest and cap the rows (his at 5, this mod at 3). He shows percentages and strength words; this mod shows stocks, the flip target, progress and turns left. |
| His tooltip and input handlers | UI 72-167 | — | not ported | Civ V tooltip plumbing. This mod's hover readout is its own panel. |
| `OnEventReceived` | UI 174 | — | not ported | Policy-screen text. |
| `OnNewTurn` and his other turn hooks | Main 56-117 | `onTurnActivated`, `cd-bootstrap.js:181` | generic | Every mod has a turn hook. |
| `Dprint`, `DisplayCultureMap` | Debug 10, 20 | `dlog`, `cd-log.js:22` | generic | Debug logging. |
| `XML/Options.xml` (4 game options) | | — | not ported | This mod's option keys and text are its own. |
| `SQL/Rules.sql` (clears two save hotkeys) | | — | not ported | |

### Constants

Every tunable in his `Lua/CultureDefines.lua`, next to this mod's value in `ui/cd-config.js`. "Same" means the same
number once the units are lined up: he writes percents and per-mille where this mod uses fractions, and his
`X_THRESHOLD` values are this mod's multipliers on the base threshold of 100.

| Gedemon constant | His line | His value | This mod's key, line | Its value | Match |
| --- | ---: | --- | --- | --- | --- |
| `CULTURE_CITY_BASE_PRODUCTION` | 48 | 10 | `injectBase` :283 | 10 | same |
| `CULTURE_CITY_FACTOR` | 50 | 10000 | — | | not carried over (his log curve, which was off) |
| `CULTURE_CITY_RATIO` | 51 | 15 (%) | `injectRatio` :284 | 0.15 | same |
| `CULTURE_OUTPUT_USE_LOG` | 52 | false | square-root curve only | | same behavior |
| `CULTURE_CITY_CAPED_FACTOR` | 55 | 2000 | `cityCapFactor` :285 | 2000 | same |
| `CULTURE_CITY_CONVERSION_RATE` | 56 | 0.5 (%) | `convertBase` :249 | 0.005 | same |
| `CULTURE_LOST_CONQUEST` | 57 | 55 | `captureLoss` :265 | 0.55 | same |
| `CULTURE_GAIN_CONQUEST` | 58 | 75 | `captureGain` :266 | 0.75 | same |
| `CULTURE_MINIMUM_OWNER` | 62 | 300 | `minimumOwner` :286 | 300 (x1.25 in Exploration, x1.6 in Modern) | same base |
| `CULTURE_FLIPPING_RATIO` | 63 | 0.65 | `flipRatio` :287 | 0.65 | same |
| `CULTURE_FLIPPING_RATIO_FEEBLE` | 64 | 0.65 (unused in his code) | — | | not carried over |
| `CULTURE_FLIPPING_MAX_DISTANCE` | 65 | 6 | `flipMaxDistance` :288 | 6 | same |
| `MINIMAL_CULTURE_ON_OWNED_PLOT` | 66 | 1 | `ownerFloor` :271 | 1 | same |
| `CULTURE_THRESHOLD` | 70 | 100 | `cultureThreshold` :277 | 100 | same |
| `CULTURE_MOUNTAIN_THRESHOLD` | 75 | 750 | `terrainMountain.threshold` :303; `sourceThresholdMountain` :270 | 7.5; 7.5 | same (both uses) |
| `CULTURE_CROSS_MARSH_THRESHOLD` | 76 | 500 | `terrainMarsh.threshold` :308 | 5.0 | same |
| `CULTURE_CROSS_JUNGLE_THRESHOLD` | 77 | 450 | `terrainJungle.threshold` :307 | 4.5 | same |
| `CULTURE_CROSS_SNOW_THRESHOLD` | 78 | 400 | — | | not carried over (Civ VII doesn't have snow) |
| `CULTURE_CROSS_DESERT_THRESHOLD` | 79 | 300 | `terrainDesert.threshold` :305 | 3.0 | same |
| `CULTURE_CROSS_TUNDRA_THRESHOLD` | 80 | 250 | `terrainTundra.threshold` :304 | 2.5 | same |
| `CULTURE_CROSS_RIVER_THRESHOLD` | 81 | 200 | `terrainRiverCross.threshold` :300 (also `terrainNavigableCross` :301) | 2.0 | same |
| `CULTURE_CROSS_HILLS_THRESHOLD` | 82 | 150 | `terrainHills.threshold` :302 | 1.5 | same |
| `CULTURE_CROSS_FOREST_THRESHOLD` | 83 | 125 | `terrainForest.threshold` :306 | 1.25 | same |
| `CULTURE_DIFFUSION` | 87 | 55 (per mille) | `diffusionRate` :278 | 0.055 | same |
| `CULTURE_DECAY_RATE` | 92 | 5 | `decayRate` :279 | 0.05 | same |
| the flat `+ 1` in his decay | Functions 309 | 1 | `decayFlat` :280 | 1 | same |
| `CULTURE_MAX_PERCENT` | 100 | 75 | `maxPercent` :282 | 0.75 | same |
| `CULTURE_NORMAL_MAX` | 102 | 40 | `normalMax` :281 | 0.4 | same |
| `CULTURE_FOLLOW_RIVER_MAX` | 104 | 180 | `riverFollowMax` :298 | 1.8 | same |
| `CULTURE_FOLLOW_ROAD_MAX` | 105 | 250 | `roadMax` :293 (also `navigableFollowMax` :299) | 2.5 | same |
| `CULTURE_CROSS_FOREST_MAX` | 107 | 80 | `terrainForest.max` :306 | 0.80 | same |
| `CULTURE_CROSS_HILLS_MAX` | 108 | 60 | `terrainHills.max` :302 | 0.60 | same |
| `CULTURE_CROSS_TUNDRA_MAX` | 109 | 40 | `terrainTundra.max` :304 | 0.40 | same |
| `CULTURE_CROSS_RIVER_MAX` | 110 | 35 | `terrainRiverCross.max` :300 | 0.35 | same |
| `CULTURE_CROSS_DESERT_MAX` | 111 | 30 | `terrainDesert.max` :305 | 0.30 | same |
| `CULTURE_CROSS_SNOW_MAX` | 112 | 25 | — | | not carried over |
| `CULTURE_CROSS_JUNGLE_MAX` | 113 | 20 | `terrainJungle.max` :307 | 0.20 | same |
| `CULTURE_CROSS_MARSH_MAX` | 114 | 20 | `terrainMarsh.max` :308 | 0.20 | same |
| `CULTURE_MOUNTAIN_MAX` | 115 | 10 | `terrainMountain.max` :303 | 0.10 | same |
| `CULTURE_CROSS_FOREST_PENALTY` | 120 | 10 | `terrainForest.malus` :306 | 0.10 | same |
| `CULTURE_CROSS_HILLS_PENALTY` | 121 | 15 | `terrainHills.malus` :302 | 0.15 | same |
| `CULTURE_CROSS_TUNDRA_PENALTY` | 122 | 25 | `terrainTundra.malus` :304 | 0.25 | same |
| `CULTURE_CROSS_RIVER_PENALTY` | 123 | 50 | `terrainRiverCross.malus` :300 | 0.50 | same |
| `CULTURE_CROSS_DESERT_PENALTY` | 124 | 55 | `terrainDesert.malus` :305 | 0.55 | same |
| `CULTURE_CROSS_SNOW_PENALTY` | 125 | 55 | — | | not carried over |
| `CULTURE_CROSS_JUNGLE_PENALTY` | 126 | 60 | `terrainJungle.malus` :307 | 0.60 | same |
| `CULTURE_CROSS_MARSH_PENALTY` | 127 | 65 | `terrainMarsh.malus` :308 | 0.65 | same |
| `CULTURE_MOUNTAIN_PENALTY` | 128 | 75 | `terrainMountain.malus` :303 | 0.75 | same |
| `CULTURE_FOLLOW_RIVER_BONUS` | 131 | 65 | `riverFollowBonus` :298 | 0.65 | same |
| `CULTURE_FOLLOW_ROAD_BONUS` | 132 | 100 | `roadBonus` :293 (also `navigableFollowBonus` :299) | 1.0 | same |
| `ALLOW_CULTURE_CONQUEST` | 138 | false | `conquestFlip` :237 | false | same default |
| `MINIMAL_CULTURE_FOR_CONQUEST` | 139 | 150 | — | | not carried over (his `CULTURE_CONQUEST_EVEN_NONE` overrides it anyway) |
| `CULTURE_CONQUEST_EVEN_LOWER`, `CULTURE_CONQUEST_EVEN_NONE` | 140-141 | true, true | army claims ignore culture | | same behavior |
| `LOCKED_TURN_ON_CONQUEST` | 142 | 15 | `flipCooldownTurns` :186 | 15 | same number, used on every claim; an army's hold, `conquestHoldTurns` :239, is 10 |
| `CULTURE_CONQUEST_ONLY_ADJACENT` | 143 | true (defined, but his v18 code never reads it) | `requireAdjacency` :193 | true | same idea |
| Tradition opener and finisher rates | 148-149 | 0.5, 0.5 | — | | not carried over |
| Communism, Democracy, Populism, Socialist Realism, Media Culture, Nationalism rates | 150-155 | 1.5, 1.5, 1.0, 1.5, 1.75, 1.25 | `IDEOLOGY_DEMOCRACY`, `IDEOLOGY_FASCISM`, `IDEOLOGY_COMMUNISM` :258 | 0.01, 0.0175, 0.0125 | three of his values, on different ideologies |
| `CULTURE_LIBRARY_CONVERTION_RATE` | 157 | 0.25 | `BUILDING_LIBRARY` :252 | 0.0025 | same (the Academy's 0.005 is new) |
| `CULTURE_UNIVERSITY_CONVERTION_RATE` | 158 | 0.5 | `BUILDING_UNIVERSITY` :253 | 0.005 | same (the Observatory is new) |
| `CULTURE_PUBLIC_SCHOOL_CONVERTION_RATE` | 159 | 1 | `BUILDING_SCHOOLHOUSE`, `BUILDING_LABORATORY` :254 | 0.01 | same value, on Civ VII buildings |
| `CULTURE_MAX_LINE_UI` | 29 | 5 | `MAX_CONTENDERS` in `cd-pressure-tooltip.js:32` | 3 | differs |
| Calibration bases | Functions 1088, 1103 | 500 turns, an 80x52 map | `paceReferenceTurns` :365, `mapSizeScale` :367 | 90 turns, a table by map size | differs |
| Strength-word cutoffs | Functions 815-830 | 50, 200, 500, 2000, 5000 | — | | not carried over |

That's **50 of his tunables with the same value**. Three more of his numbers are reused on different ideologies, and
the Medium preset (`ui/cd-config.js:394-400`) restates four of them. Everything else in the config is this mod's own:
the Cultural Power Index weights, the per-age and map-size tables, water crossing, settlement flips, the caps, and the
presets other than Medium.

### Formulas side by side

His line numbers are in `Lua/CultureFunctions.lua`; this mod's files are under `ui/`.

| Step | Gedemon | This mod | Verdict |
| --- | --- | --- | --- |
| Diffusion delivered | `value * ((d + d*bonus/100) / (1000 + 1000*malus/100))`, `d = 55` (:601) | `src * (rate * (1 + bonus)) / (1 + malus)`, `rate = 0.055` (`cd-field.js:81, 87`) | identical algebra |
| Neighbor cap | `plotMax = value * 0.40 * product(max_i)`, then `min(plotMax, value * 0.75)` (:448, :465-589, :595) | `min(src * 0.75, src * 0.4 * maxFactor)`, where `maxFactor` is the same product (`cd-field.js:85`; `cd-terrain.js:206, 216`) | identical |
| Approach to the cap | `next = min(plotMax, prev + diffused); add = next - prev` (:607-610) | the same three lines (`cd-field.js:88-90`) | identical |
| Source threshold | `value > 100`, or 750 on a mountain (:424, :76-82) | `src <= 100` gives 0; at or below `sourceThreshold` the source is skipped (`cd-field.js:76`; `cd-pass.js:243-246`; `cd-terrain.js:80-84`) | identical |
| Terrain gate | `if value > X_THRESHOLD then malus += P; plotMax *= M else diffusion = 0` (:480-591) | `if sourceValue <= 100 * threshold then blocked, else malus += P; maxFactor *= M` (`cd-terrain.js:209-217`) | same result |
| Road | both tiles have a route: `bonus += 100; plotMax *= 2.5` (:462-467) | `roadBonus` (`cd-terrain.js:221-224`) | identical |
| River | edge test: following gives `+65, x1.8`; crossing is gated at `x2` with `+50` malus and `x0.35` (:470-475, :517-527) | tile test: the same values for minor rivers, road values for navigable ones, the crossing cost paid on the way in (`cd-terrain.js:238-249`) | adapted |
| Decay | `v = floor(v - (v * 5/100 + 1))`; below 0 it's removed, or set to 1 on the owner's tile (:309-321) | `v - (v * 0.05 + 1)`, dropped at 0 or below (`cd-field.js:49-54`; `cd-pass.js:207-208`); the owner's minimum is a separate step (`cd-inject.js:140`) | same formula, kept as fractions |
| City injection | owner `(pop + culturePerTurn) * sqrt(v * 15/100) + 10`; foreign `pop * sqrt(...) + 10` (:131, :141, :144) | `strength * sqrt(v * 0.15) + 10` (`cd-field.js:27`); owner strength is the Cultural Power Index projection (`cd-pass.js:192-196`); foreign strength is population times share (`cd-inject.js:79-82, 94`) | same curve, different inputs |
| City cap | if the total is over `(pop + culture) * 2000`, inject nothing (:98, :111-116) | `strength * 2000` on the total, clamped to the room left (`cd-field.js:39`; `cd-inject.js:45-47, 65`) | adapted |
| Conversion | `Round(v * rate/100)` moved to the owner, `rate = 0.5` plus bonuses (:336-405) | `v * r` moved, `r = 0.005` plus bonuses (`cd-field.js:162-177`; `cd-conversion.js:102-110`) | same apart from rounding |
| Ownership | `OwnerValue > 300 and (unowned or OwnerValue * 0.65 > incumbent)` (:235-236) | the same test (`cd-field.js:128-131`) | identical |
| Placement | within 6 of the winner's nearest city and next to its land (:239-243) | the same two gates, plus more of its own (`cd-pass.js:296`; `cd-eligibility.js:125, 153`) | port plus additions |
| Capture | each culture loses 55%, and the conqueror gains 75% of the total lost (:659-672) | the same (`cd-field.js:187-201`) | identical |
| Calibration | `CULTURE_DIFFUSION *= (500 / turns) * (W*H / (80*52))` (:1083-1113) | diffusion and decay scaled by `clamp(90 / maxTurns, 0.25, 3)`; map size scales injection from 0.85 to 1.1 (`cd-calibration.js:42-52, 78-84`; `cd-pass.js:149-151`) | adapted |

### How the shared core plays differently

The formulas match, but the same numbers don't give exactly the same game:

- His map updates in place, tile by tile, so a tile's diffusion uses its already-decayed value and the order of tiles
  matters. This mod double-buffers: decay and diffusion both read last turn's field.
- He rounds every stock down to a whole number. This mod keeps fractions.
- He simulates the whole map. This mod simulates a region within 8 tiles of the player's cities (`fieldRadius`).
- His terrain penalties stack, mountains included. Here a mountain replaces the other penalties.
- He blocks water completely. Here a strong culture can cross coast and ocean, more easily in later ages.

## What's new in the Civ VII mod

These systems don't have a counterpart in his mod. Code lines are from the per-function split described in the method
section.

| System | Modules (under `ui/`) | Code lines |
| --- | --- | ---: |
| Whole settlements change hands by culture (1.6.0 and 1.7.0). His v18 only ever flipped tiles: its description says "Cities won't flip from culture in this test version", and `UpdatePlotOwnership` skips city tiles (`Lua/CultureFunctions.lua:194`). | `cd-city-flip.js`, `cd-city-flip-rule.js` (plus `data/cd-city-flip.sql` and the notification and icon XML, 63 more lines) | 495 |
| The Cultural Power Index and the fused injection strength | `cd-cpi.js`, `cd-metrics.js`, `cd-pressure.js`, `cd-polity.js` | 330 |
| Ethnic affinity from the Emigration mod's population data | `cd-ethnicity.js`, `cd-emigration.js` | 92 |
| Per-leader, per-civilization and memento tuning | `cd-civ-tuning.js`, `cd-civ-roster.js` | 293 |
| The Cultural Pressure lens, the hover readout, the City Details section and banner colors | `cd-pressure-lens.js`, `cd-pressure-tooltip.js` (all but `contenderRows`), `cd-city-panel.js`, `cd-lens-colors.js` | 778 |
| Civ VII ownership changes that don't crash the game: district teardown, the age-transition guard, pending claims, reparenting, and the guard that keeps units from being stranded | `cd-ownership.js`, `cd-teardown.js`, `cd-age-guard.js`, `cd-pending.js`, `cd-reparent.js`, `cd-units.js`, `cd-borders.js` | 582 |
| The rest of the turn pass: the region and its buffer ring, orphan repair, per-age settings, water easing, the hand-off to settlement flips | `cd-pass.js` | 335 |
| Civ VII reads and new rules inside the ported modules: terrain and river reads, water crossing, lens math, conversion reads, the capture event, the occupation counter, caps and gates | `cd-terrain.js`, `cd-field.js`, `cd-conversion.js`, `cd-capture.js`, `cd-conquest.js`, `cd-eligibility.js`, `cd-flip.js`, `cd-recede.js`, `cd-calibration.js`, `cd-inject.js`, `cd-ai-flips.js` | 401 |
| Settings, the Options screen, saving, startup, map reads, logging, notifications and the config | `settings-keeper.js`, `cd-settings.js`, `cd-options.js`, `cd-state.js`, `cd-bootstrap.js`, `cd-plots.js`, `cd-log.js`, `cd-diagnostics.js`, `cd-notifications.js`, `cd-config.js` | 1,658 |
| **Total original JavaScript** | | **4,964** |

Also new: the Civilopedia section (150 page and section rows in `data/cd-civilopedia.xml`), all the player-facing text
and its eleven translations, and the unit tests and test harness. `ui/settings-keeper.js` (565 lines) is Tower's shared
settings library and ships in other Tower mods too; without it the split is 4.7% ported, 10.0% adapted and 85.3%
original. The Civilopedia history text in `history-corrections/` doesn't come from Gedemon's mod; the LICENSE says
where it comes from.

The repo starts at v1.0.2 (2026-07-06). Gedemon's field model was the core from the first release, and the rest of his
rules (foreign culture in cities, conversion, capture transfer, AI flips, army claims, the mountain threshold, the owner
minimum and the river rule) came over in 1.3.0 (2026-09-26).

## Text and data

A word-sequence scan compared every run of five and six words in his readme, `.modinfo`, `XML/Options.xml`,
`SQL/Rules.sql` and his Lua files, comments and strings included, against every text file in this repo. Ryan F.
Mercer's two files were left out.

- **Six or more words in a row:** besides standard XML boilerplate (`<?xml version="1.0" encoding="utf-8"?>`), the only
  matches are two comments that quote him on purpose. `ui/cd-inject.js:135-136` names `MINIMAL_CULTURE_ON_OWNED_PLOT`,
  and `ui/cd-config.js:251` lists "Library +0.25%, University +0.5%, Public School +1%", the same buildings and numbers
  as a line in his v.13 changelog.
- **Five words:** the same, plus `docs/civ-v-parity-spec.md`, a design note that doesn't ship with the mod. It quotes
  two short pieces of his code (`plot:IsRiverConnection(direction) and not plot:IsRiverCrossing(direction)` and
  `CULTURE_OUTPUT_USE_LOG = false`) to pin down what's being matched.
- **In-game text, Civilopedia, Workshop and README:** the wording is this mod's own. Shared vocabulary like "culture
  group" or "established" is ordinary English. His in-game strings (the "has annexed a part of ... territory with
  support of local culture group" message, the strength words, the policy tooltips) don't appear.
- **Text keys:** his are `TXT_KEY_GAME_OPTION_*`; this mod's are `LOC_OPTIONS_CD_*`, `LOC_CD_*` and `LOC_PEDIA_*`. They
  don't overlap.
- **Data rows:** his `XML/Options.xml` adds four game options and `SQL/Rules.sql` clears two save hotkeys. This mod's
  `data/` files (settlement-flip modifiers, notifications, icons, Civilopedia pages) are all new.

## Credits and licensing

Gedemon's mod doesn't carry a license. His files open with `-- Author: Gedemon` and a date from 2011 or 2012, his
`.modinfo` lists him as author and links his CivFanatics thread
(http://forums.civfanatics.com/showthread.php?t=410985), and his readme has a credits section, but none of it states a
license, a copyright line or a permission to reuse. The only "open source" note in his package is on Ryan F. Mercer's
two files, which this mod doesn't use.

This mod credits Gedemon in the README's Credits section, in the `.modinfo` (`SpecialThanks`), on the Civilopedia's
About page and on the Steam Workshop page. Its LICENSE names the port: the culture model and the numbers that tune it
are Gedemon's design, the JavaScript is the author's, and the license claims only the author's own code. Versions up to
and including 1.7.0 were released under MIT.

## How this was checked

- **The original:** Gedemon's *Cultural Diffusion (v 18)* package, unmodified; each file matches the checksum listed in
  its own `.modinfo`.
- **Code lines:** non-blank lines that aren't comments. For Lua, `--[[ ... ]]` blocks are left out too, which drops his
  commented-out code. The shipping JavaScript is the 43 files under `ui/` that `cultural-diffusion.modinfo` loads.
- **Functions and constants:** every Gedemon function and constant was read and matched by hand against the
  JavaScript. Each file was then split at its top-level functions, and each function was classed as ported, adapted or
  original. Generic helpers that copy one of his trivial functions (nearest city, adjacency) count as ported, so the
  ported figure leans high. Two judgment calls move the numbers: Civ VII engine reads inside a ported function count as
  original here, and a gate stack holding his rule plus several new ones counts as adapted. Counting every ported or
  adapted module whole gives the generous 19%.
- **Text:** a scan of every five- and six-word sequence across the text files of both mods, leaving out build copies
  and installed packages.
- **History:** the repo's git log, including searches for each credit phrase and for when each ported piece arrived.
