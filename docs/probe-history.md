# Cultural Diffusion — Probe History (feasibility record)

The chronological record of what the in-game probe (`../probe/`) confirmed, corrected, and left open. This is *ground
truth* — the currency for this mod is isolation: which verb, on which tile, reproduces or not. When a design question
turns on engine behaviour, the answer lives here, not in theory. Current behaviour is in
[`current-model.md`](current-model.md); the outstanding work these findings gate is in
[`potential-future-features.md`](potential-future-features.md).

Deploy/run gotchas that cost real time (now team memory): Gameface caches modules (full restart to clear); never `rm
-rf` a deployed mod folder (orphans the `Mods.sqlite` `Disabled` flag → vanishes from Additional Content);
`scope="game"` attaches only at game load and the mod set is bound to the save — **test on a NEW game, not an old
save**. All ownership writes are **async** — success is read on a deferred re-read (~2s later / next pass), never
inline.

---

## 1. Original feasibility probe (v0.3.0, 2026-07-03) — and its false positive

The first probe asked whether tiles can flip at all. Results (in `UI.log` under `[Civ7Probe]`):

| Question | Original verdict | Note |
| --- | --- | --- |
| **Q-FLIP** — does a write reassign the plot & redraw? | GREEN | ownership reassigns; `PlotOwnershipChanged` fires |
| **Q-YIELD** — integrated or cosmetic? | Integrated | flipped tiles read `cityNow=65536` (city-attached); `purchasePlot` is the integrated verb |
| **Q-BEYOND-CAP** — claim outside the 3-ring footprint? | GREEN | every confirmed flip was beyond every city's normal footprint |
| **Q-RIVAL** — take a rival's tile? | ~~GREEN~~ **FALSE POSITIVE** | see below |
| **Q-PERSIST** — survive save→reload? | GREEN (unowned) | unowned flips survived; rival/far persistence deferred |

**The Q-RIVAL false positive.** The v0.3 run reported rival capture GREEN, and the mod shipped with
`flipVerb:"setOwnership"` on that basis. The 2026-07-08 re-run (below) proved this wrong: `setOwnership` had only ever
"flipped" tiles the player **already owned** (they trivially re-read as owner 0). This is the exact "isolation is the
only currency" lesson — a plausible GREEN that a cheap re-test disproved.

---

## 2. Verb ground truth (v0.7.0, 2026-07-08, ~600 logged flips + `PlotOwnershipChanged`)

The load-bearing finding: **the shipped default flip verb did not do what the mod needs.**

| Flip verb | Empty (unowned) land | Rival-owned land | Beyond ring 3 | Verdict |
| --- | --- | --- | --- | --- |
| **`WorldBuilder.MapPlots.setOwnership`** | becomes yours but **ORPHAN** (`owningCity=NONE`, not workable/buildable) | **FAILS — 102/102 `no-change`**, tile stays the rival's | orphan only | ✗ broken for our purpose |
| **`city.purchasePlot`** | **INTEGRATED** (`owningCity` set, `inCityPlots=true`) | **WORKS** — captured rival tiles incl. **ring-1** (`ringDepth=1`, fired `owner=0`) | **INTEGRATED beyond ring 3** | ✓ works, but spends gold |
| **`city.Growth.claimPlot`** | present in API; UNTESTED | untested | untested | ? |
| **`CREATE_ELEMENT DISTRICT_RURAL`** | present in API; UNTESTED | untested | untested | ? |

Corollaries proven this run:
- **Inner-ring capture is real** — the user watched a rival's ring-1 tiles change colour; the log confirms
  `purchasePlot` captures at `ringDepth=1`. The earlier "`setOwnership` is god-mode, no ring restriction" claim was
  wrong and is retracted.
- `buildable[...]=n` even on INTEGRATED tiles is expected — they are worked **rural** tiles (yields), not urban-district
  plots. "Integrated + `inCityPlots`" is the success signal, not building placement.

**Resolution (how the verb question was actually closed).** Rather than adopt `purchasePlot` with a gold cost (against
the "don't drain the treasury" rule) or chase the untested free verbs, the mod ships **`purchasePlot` + a same-tick gold
refund** — net-zero gold, integrated ([`current-model.md`](current-model.md) §4). So `setOwnership` is retired to
`unclaim` only, the `Growth.claimPlot` / `DISTRICT_RURAL` fork was never needed, and no gold cap is required — all three
recorded in [`wont-build-with-justifications.md`](wont-build-with-justifications.md).

Two operational issues seen (fix if the probe is revived): **no candidates on a fresh game** (turn-1 maps have no rival
/ beyond-ring-3 tiles → every verdict PENDING; needs a mid-game bordering an AI), and **state-machine thrash** (the
probe's persisted phase did not survive between ticks — localStorage not persisting across the game-scope isolate —
which breaks the save/reload flow).

---

## 3. Outer-tile probe stages (built: v0.6 `v6-work-capture-found` → v0.7 `v7-deep`)

The probe was extended with read-only, on-screen stages that re-run every turn (no console, no clickable UI — past
Gameface button issues are why). These test the outer-ring / capture features tracked in
[`potential-future-features.md`](potential-future-features.md):

1. **Q-WORK (read-only) — the 1a/1c gate.** For each beyond-ring-3 owned tile: `canStart(ASSIGN_WORKER, {Location,
   Amount:1})`, owning-city `canStart(EXPAND).Plots`, `GetTilePlacementInfo(idx).IsBlocked`, `getYieldsWithCity`. Rigor
   guards: a near (ring 1-2) control (so a far BLOCKED isn't a false-negative from "no worker/pop pending") and per-verb
   pairing. 3-state verdict: **WORKABLE via [verb] / BLOCKED / INCONCLUSIVE**.
2. **Q-WORK-MUTATE / -PERSIST + worker-cap** (opt-in `AUTO.WORK_MUTATE`, throwaway save). Places a worker +
   `DISTRICT_RURAL` + `Growth.claimPlot`; records `NumWorkers` / `getCityWorkerCap` before/after (does working the tile
   consume the cap?) + a persistence marker for whether the **worked state** (not just ownership) survives reload.
3. **Q-CAPTURE.** Prefers a **developed** rival tile; captures `constructibleCount` / `districtOwner` at flip time;
   reports **TRANSFERRED** (you inherit the improvement) vs **STRIPPED** (reverts to bare land) — the "steal developed
   tiles organically" question.
4. **Q-FOUND.** Opportunistic: VII has no settler-free settle-validity read, so it reads a local settler's legal
   found-plots and reports whether an owned outer tile is foundable (not-foundable beside your own cities is expected —
   base min-city-range). A true test needs a settler moved next to an isolated claimed tile (`cd_probe.found()`).

Also in v0.7: **Q-DEEP** (inside-ring flip, ring-depth classified). Read-only stages fire from `PlayerTurnActivated` /
`LoadComplete`; the destructive Q-WORK-MUTATE stage is behind the `AUTO.WORK_MUTATE` code flag (like the existing
`AUTO.FLIP_RIVAL`).

**Verdict → build.** WORKABLE ⇒ (1c) buildable via the passing verb; BLOCKED ⇒ ship (1a) territory + capture only.
Q-CAPTURE TRANSFERRED strengthens capture; STRIPPED means captured tiles arrive bare. These map to config defaults in
[`reference-and-conventions.md`](reference-and-conventions.md) §9.

---

## 4. Historical decision matrix (superseded)

The original spec's probe→decision matrix chose `setOwnership` from the first-row "Q-FLIP green, Q-PERSIST green,
Q-YIELD integrated → `flipVerb = setOwnership` (free)". That row's premise was the Q-RIVAL false positive (§1); the
2026-07-08 ground truth (§2) overturned it. Retained only so the reasoning trail is legible — the current verb decision
is `purchasePlot` + refund ([`current-model.md`](current-model.md) §4).

---

## 5. In-game harness run 1 (game 1.4.2, 2026-09-12) — watched verdicts

The first hands-free run against the real engine ([`../devtools/harness/`](../devtools/harness/), log
`run1-antiquity-turn136-UI.log`), on the AugustusAnt136 save with the mod attached through `AffectsSavedGames=0`.

| Question | Verdict |
| --- | --- |
| Does our city's `purchasePlot` take unowned land beyond ring 3? | Yes, free. The write lands after the call: the same-tick owner read still shows the old owner, and the new owner appears within about three seconds |
| Does it take a rival's tile touching our land? | Yes, free, with the same deferred landing |
| Can a rival's city take that tile back (the cede verb)? | Yes, with the same deferred landing |
| Does `setOwnership(NO_PLAYER)` release a city-attached tile? | No. The tile was still ours after three seconds and twelve turns later |
| Does owned territory block founding? | Yes. A settler could found on an unowned plot four tiles from any settlement, and could not found on the rival-owned plot beside it |
| Can a script place an improvement on a ring-4 claimed tile? | Inconclusive, because the ring-2 control failed too |
| Is `Game.age` a string? | No, a numeric hash |
| Does the mod's pass run and read real yields? | Yes, every turn, with nonzero city strengths. No flips in twelve turns: ring 4 needs roughly 12,000 at the city centre, and London's stock was 364 after three passes |

Two bugs followed directly. The pass booked flips on the same-tick read, so it never recorded a real one, and every
age read as Antiquity. Both are fixed; see the changelog.

### Run 2 (same save and build, fixed mod deployed)

Log `run2-antiquity-turn136-UI.log`.

| Question | Verdict |
| --- | --- |
| Does the age fix resolve the real hash? | Yes. `Game.age` 2077444219 resolved to `AGE_ANTIQUITY` through `GameInfo.Ages.lookup` |
| Does the pending fix record a real flip end to end? | Yes. With a mature stock seeded on a frontier tile, the mod's own pass sent the flip and recorded it as pending. The tile was ours within five seconds, and the next pass logged `pending 89,29 claim confirmed`, booking the claim with a 15-turn lock |
| Does real diffusion then claim on its own? | Yes. In that same next pass the seeded culture had crossed the bar on the neighbouring tile, and the mod sent and later confirmed that flip too |
| Can any variant release a city-attached tile? | No. Setting ownership to ourselves first, clearing a tile with no district on it, and a plain clear all left the tile owned and attached after ten seconds |
| Does script-creating an improvement work at all? | Yes, as a control: London's ring-1 camp was destroyed and recreated. The far-tile half did not run, because the test used up the frontier tiles first; retried in run 3 |

### Run 3 (same save, fixed mod, recede and debug on)

Log `run3-antiquity-turn136-UI.log`, crash evidence `run3-crash-evidence.txt`.

| Question | Verdict |
| --- | --- |
| Can a script place a citizen on a claimed tile beyond ring 3? | No. After `addRuralPopulation(+1)` the engine offered 13 plots, none beyond ring 3. `CityCommands.sendRequest(EXPAND)` on a ring-4 claimed tile returned true, placed nothing, and left the citizen pending. The same citizen then placed a fishing boat on an offered ring-1 plot |
| Can a script create an improvement on a claimed tile beyond ring 3? | No. Four attempts on two ring-4 tiles placed nothing: a mine, a woodcutter, and two copies of the town's Potkop. The same call recreated that Potkop on ring 3 |
| Does the +1 growth buffer work? | Yes. Recreating the Potkop sent claims on its two unowned neighbours, and the next pass confirmed both |
| How fast does the mod claim on its own from an empty field? | London's first ring-4 claim was sent on pass 18. By pass 24 the mod had sent nine flips, two of them tiles taken from player 3. Seven were confirmed and two were still in flight when the run ended |
| Is the saved state or pass time a problem? | No: 8.9 KB of state and at most 21 ms per pass after 24 passes |
| Did the old release branch loop, as predicted? | Yes. Once the buffer claims' cooldowns ran out, the deployed pre-removal code sent a release on both every pass and dropped it the next, sixteen times |
| Does the mod's own cession work? | Not tested. The only candidate rival was read as at war, and the seeded tile sat inside Megiddo's ring 3, so the inner-ring rule dropped the claim first |

Two loose ends. The harness read player 3 as at war on turn 136, yet the mod took two of player 3's tiles on turns 155
and 156, which it only does at peace. And the run ended in a native crash. Autoplay had played each local turn since
about turn 154, and at turn 160 it drove the Antiquity to Exploration transition. About thirty seconds into the new age
the game segfaulted with `EXC_BAD_ACCESS` at `0x2a8` on `AsyncWorker1`, the thread and small-offset signature of the
archived Emigration enclave crash. The cause is not isolated; the disproof plan is in [`BACKLOG.md`](BACKLOG.md).

### Run 5 (2026-09-13, current build) — crash disproof across the age change

Log `run5-antiquity-to-exploration-UI.log`. A replay of run 3's route from AugustusAnt136 with run 3's settings (debug,
recede and buffer on), ending turns as run 3 did and running no harness test actions.

| Question | Verdict |
| --- | --- |
| Does crossing into Exploration with the mod enabled crash? | No. The new age reached GameStarted six seconds after the scripts reloaded, and the game ran 194 seconds and 21 Exploration turns with no crash report. Run 3's crash did not reproduce |
| Does the mod keep working across an age change? | Yes. It sent 29 flips across both ages and confirmed all 29 on the next pass, none dropped. The growth buffer claimed tiles in the new age. State reached 14.7 KB and passes took at most 19 ms |
| Is the pace the same as run 3? | Yes. The first organic flip came on turn 154, as in run 3 |
| Does the Options rebuild fix hold against the real model in game? | Yes. The mod's options appeared on init, vanished on `reInitOptions()`, and came back on the next init |

### Runs 6 and 7 (2026-09-13, current build)

Logs `run6-shipped-build-existing-save-UI.log` and `run7-run3-tests-current-build-UI.log`; crash evidence
`run7-crash-evidence.txt`.

| Question | Verdict |
| --- | --- |
| Does the shipped build run inside a save made without it? | No. With the exact `dist/` build enabled, which has no `AffectsSavedGames` override, loading AugustusAnt136 did not activate the mod: the Modding log's list for that load held only the harness, and the mod never booted. Players need a new game, or a save started with the mod |
| Does the mod's war check agree with the engine? | Yes. Over 25 turns the engine's `isAtWarWith` and the mod's `atWar` never disagreed for any rival. Player 3 was at war on turn 136 and at peace from turn 137, so run 3's later captures of player 3's tiles were legitimate |
| Does run 3's crash come back with run 3's harness tests on the current build? | Yes. The game crashed during the Exploration startup, before GameStarted, the same moment as run 3: `EXC_BAD_ACCESS` at `0x308` on `AsyncWorker1`, with different top frames from run 3's. Run 5 took the same route without those tests and did not crash, so the tests' script-only engine writes are implicated |

### Run 8 (2026-09-13, current build) — a new game at shipped defaults

Log `devtools/harness/run8-new-game-pacing-UI.log`. A new single-player game started the way Play Now does, with the
mod at its shipped defaults plus debug logging, driven 70 turns by the harness. Nobody played our civilization: the
harness only ended turns, so it kept one city all game. A human player's culture would be higher, so treat the result
as a floor.

| Question | Verdict |
| --- | --- |
| Does a new game's capital claim anything early? | No. No claims in 70 turns. The capital's Culture yield was 8, its injection strength about 11.8, and its centre stock 3,810 at turn 50. The pacing simulator predicts 3,866 for that strength, so the simulator is calibrated. By the simulator a city at strength 12 or less never claims its fourth ring |
| Did a rival settle near us? | Not closely. The nearest rival major settlement was a town 14 tiles away; the nearest settlement of any kind was a city-state town 8 tiles away on turn 51 |
| Does the Cultural Pressure lens switch on in a real game? | Yes. `setActiveLens("cd-pressure-lens")` made it the active lens with `cd-pressure-layer` enabled. The game had no contested tiles to shade, and the screenshot caught the editor window instead of the game, so rendering was left to run 9 |

### Runs 9 to 11 (2026-09-13, current build) — the pressure lens in a real game

Logs `devtools/harness/run9-lens-no-contested-tiles-UI.log`, `run10-lens-popup-covered-UI.log` and
`run11-lens-paints-UI.log`, and the image `run11-lens-off-vs-on.png`. Each loads AugustusAnt136 with debug on, ends
turns, then switches the lens on and captures the game window.

| Question | Verdict |
| --- | --- |
| Does the lens paint the contested tiles? | Yes, watched in run 11. With the game window in front, the Hawaiian-owned tile 89,35, where British culture led at 25%, was filled in faint British purple. With the lens off it had no fill. Captures taken while the game sat behind the editor never showed the lens view, in runs 10 and 11, because the game does not redraw a hidden window |
| Does switching the lens on change the map view? | Yes. The yield icons and border lines give way to the lens's fills (runs 9 and 11, game in front) |
| When does the lens first have tiles to paint on this save? | On turn 149, the 14th pass from an empty field. After 12 passes (run 9) none of our culture sat on a tile we do not own, so nothing was contested. Run 10 had 1 contested tile on turn 149, 3 on turn 150 and 5 on turn 151. The field's growth matched run 3 pass for pass |
| Does the hover readout see the saved field and name the civilizations? | Yes, for the data it is built from. The harness rebuilt the readout with the lens's own imports: `loadState()` returned the field, and `civLabel` gave "British Empire" and "Hawaiian Empire", not `#id` fallbacks. The panel itself was not hovered |
| Does the lens paint the contested tiles? | Not yet seen. In run 10 the top tile was centred under the Civic Unlocked popup and the others were off screen. Run 11 repeats it with the popup closed |
| Does the lens show only flips that will happen? | No. Two of run 10's five contested tiles were unowned tiles led by the Hawaiian Empire, which the pass never flips for an AI. See [`BACKLOG.md`](BACKLOG.md) |

## 6. Civ V parity probes P1-P7 and the river rule, watched (game 1.5.0, 2026-09-25)

The probes from [`civ-v-parity-spec.md`](civ-v-parity-spec.md), run hands-free on AugustusAnt136 (Antiquity, turn 136)
with the harness script `devtools/harness/cdh-game-parity.js`. Two runs, logs `parity-UI.log` (6 turns) and
`parity2-UI.log` (14 turns, a corrected site picker); a third, `cdh-game-gold.js` / `gold-UI.log`, isolates the gold
question P4 raised. Every line below is a watched read from the running game, not a reading of the source.

### P3. Is there any edge-level river read? No

`GameplayMap` has 74 members. The river ones are `getRiverName`, `getRiverType`, `isAdjacentToRivers`,
`isNavigableRiver` and `isRiver`, all keyed by a tile. `isRiverCrossing`, `isRiverConnection`, `getRiverEdge` and
`getRiverFlowDirection` are undefined; the only edge read on the object is `isCliffCrossing`. A `MapRivers` global
exists (`getRiver`, `getRiverIDByIndex`, `getRiverPlots`, `getRiverTypeByIndex`, `isRiverConnectedToOcean`,
`numRivers`) and it too speaks in plots. `TerrainBuilder` is absent from the game scope. `RiverTypes` is
`{ NO_RIVER: -1, RIVER_MINOR: 0, RIVER_NAVIGABLE: 1 }`, so a "river present" test must compare against `NO_RIVER`,
never test truthiness (a minor river is 0). `cd-terrain.js` already does the former.

### P1. Minor rivers are tiles, in 1-wide named chains

A whole-map scan (96 × 60, 5,760 tiles): 236 minor-river tiles, 116 navigable-river tiles, `isRiver` true on exactly
those 352 and no others. Names: 234 of 236 minor tiles and 116 of 116 navigable tiles carry a `getRiverName` key;
98 distinct rivers. Chain shape, counted as each river tile's same-kind, same-name river neighbours:

| Kind | Tiles | Neighbour histogram 0..6 | Mean | Different-name adjacent pairs |
| --- | --- | --- | --- | --- |
| Minor | 236 | 4, 162, 63, 6, 1, 0, 0 | 1.31 | 24 |
| Navigable | 116 | 13, 56, 47, 0, 0, 0, 0 | 1.29 | 4 |

A mean near 1.3 with almost every tile at one or two neighbours is a 1-wide chain with ends and a few forks, not the
2-wide band both banks would form if the flag were an edge marker. So minor rivers are stored per tile, as the spec
assumed, and the tile rule stands. `isAdjacentToRivers(x, y, 1)` is true on the river tile itself (197 of 200 sampled)
and on its bank tiles (790 of 793), so it means "within one tile of a river" and cannot tell a bank from the river. The
two unnamed minor tiles and the 24 different-name pairs (confluences) are the cases the "missing name counts as the same
river" rule and the "different name is a crossing" rule cover. The 11 × 11 text window at 82,32 (River Trent, Yenisei,
Damietta, Wye, Severn, Arno) and the frame `shots/parity-p1-window.png` show the same chains the renderer draws as
streams.

### P2. A navigable river tile is not water to the engine

Tile 85,19 (Ozama River, one tile from a local city): `isWater` false, terrain `TERRAIN_NAVIGABLE_RIVER`, biome
`BIOME_PLAINS`, `isNavigableRiver` true, `getRiverType` 1, `isRiver` true, `isImpassable` false, `isLake` false,
`isCoastalLand` true, owner 0. `Terrains.Water = 0` holds at runtime, so the channel takes the land path in
`stepMods`, and the isWater override in `cd-terrain.js` is a safety net that this build never needs.

### The river rule end to end (spec §1), watched in both runs

The harness cleared the field, seeded known stocks on real tiles at least three rings from every local city and not
touching our land (299 on the strong sites, under the 300 ownership bar; 150 on the gate site, under the 200 river
gate), ran ONE pass with `culturalDiffusion.runNow()`, and read what each neighbour received. Every actual value
matched `diffusionDelivered` applied to the live `stepMods` of that step to two decimals (ratio ×1 on every line), so
the in-game reads classify exactly as the unit stubs do and the Antiquity pace is 1.

| Step | Source, destination | Live stepMods | Received | Plain-land control | Verdict |
| --- | --- | --- | --- | --- | --- |
| Gate, bank onto minor river at 150 | 81,15 → 82,16 (Song Hong) | blocked | 0 | 8.25 | Nothing crosses below 2× threshold |
| Follow, minor river | 82,27 → 83,28 (Arno, flat floodplain) | bonus 0.65, cap ×1.8 | 27.13 | 16.45 | ×1.65 along the river (run 2) |
| Cross, bank onto minor river on hills | 84,25 → 85,24 (Sejenane) | malus 0.65, cap ×0.21 | 9.97 | 16.45 | ×0.61: river crossing and hills stack (run 1) |
| Follow, navigable river | 80,22 → 79,21 (Kolekole) | bonus 1.0, cap ×2.5 | 32.89 | 16.45 | ×2.0 along the channel (run 2) |
| Cross, bank onto navigable river | 78,34 → 78,35 (Damietta floodplain) | malus 0.5, cap ×0.35 | 10.96 | 16.45 | ×0.67 into the channel |

Under the previous rule every one of the three "onto a river" steps would have received the follow bonus (×1.65
instead of 0, ×0.61 and ×0.67), so the runs also show the defect is gone. Two picker artefacts are recorded so nobody
re-reads them as failures: run 1's minor-follow site and run 2's minor-cross site each landed on a river tile under
rainforest, whose own gate (4.5× threshold) blocks at 299, so those single reads were 0 for the feature, not the river.
Each row above is the run in which the step was open. The mod's own passes ran every turn alongside (8-11 ms, 35-67
field tiles, no flips), and no error was logged.

### P6. A moved unit can be classed combat or civilian

`UnitMoved` fires in the UI context for every player's units: 9,072 events over 14 turns, 8,615 of them foreign.
The payload is `{ unit, location, parent, toStateChange, visibleToLocalPlayer, destinationVisibleToLocalPlayer }` with
`unit` a ComponentID. `Units.get(data.unit)` resolved for all but 17, and `unit.Combat.isCombat` split them 8,067
combat to 988 civilian (trade ships and settlers read false; scouts, commanders and quadriremes true). `canAttack` is
a separate flag (a scout is combat but cannot attack). Spec §6 can use `Combat.isCombat` directly.

### P5. `CityTransfered` reaches the UI for transfers the local player is not part of

Payload: `{ fromPlayer, transferType, cityID }`, the city already carrying its new owner. Two were watched:

| Turn | City | From → to | Note |
| --- | --- | --- | --- |
| 136 (run 1 and 2) | Glasgow, 90,37 | 0 (us) → 3 | Preceded by `CityRemovedFromMap` for our id and `CityAddedToMap` for player 3's; a capture while autoplay left the city undefended |
| 149 (run 2) | Tendirma, 31,26 | 6 (major) → 12 (an independent, no cities before) | Neither side local; a different `transferType` hash, so a revolt or independence rather than a capture |

So the event is delivered for AI-to-AI transfers; a capture between two AI majors was not seen in 20 turns but has no
reason to differ from the second row. Spec §5 can subscribe. Note the accompanying `CityRemovedFromMap` +
`CityAddedToMap` pair: a capture is not silent on those events, so razing must still be told apart by
`CityRazingStarted` / the absence of a `CityTransfered`.

### P7. No defeated major exists in this save; the only dead plot owner is the engine's wilderness player

`Players.getEverAlive()` lists 51 ids, `getAlive()` 49. The two dead: 49, a `CIVILIZATION_PLACEHOLDER_CITYSTATE`
minor with no plots, and 63, `CIVILIZATION_NONE`, neither major nor minor nor independent, no cities, holding six plots
scattered across the whole map (5 to 45 tiles from us), each with `DISTRICT_WILDERNESS` and an owning-city id of -1.
Those are engine-owned wilderness plots, not a defeated civilization's land. Whether a defeated MAJOR keeps plots is
still not watched (it needs a save with a real defeat), but two facts narrow it: territory hangs off cities here, and
the mod's `findDeadOwners` already excludes dead ids from winning. Note for the flip path: `ownerAt` on a player-63
plot returns 63, a dead owner, so a tile with a wilderness district must never be treated as claimable frontier;
the district check in the claim gate is what protects it.

### P4 and the price of a claim: `changeGoldBalance` is dead, `grantYield` works, and a script purchase is free

Parity run 2 found `Treasury.changeGoldBalance(+37)` on a rival moved nothing, and the same call on the local player,
the mod's own refund verb, moved nothing either. Two short runs isolated it (`cdh-game-gold.js` / `gold-UI.log` and
`cdh-game-gold2.js` / `gold2-UI.log`). The first rolled its turns with the harness's Autoplay fallback, and the engine
log shows `Autoplay started` on every one of them, so its across-turn gold deltas (−515, +70, −15 beyond income) are
the AI spending our treasury and prove nothing. The second rolled every turn WITHOUT Autoplay: `sendTurnComplete()`
ended the turn within 12 s although the blocker read `UNITS` (and later `NEW_POPULATION`), no `Autoplay started` line
was logged, and our unit count only changed by one completed build. Its numbers are clean:

| Turn | Action | Gold at +0 / +3 / +10 / +30 / +60 s | Across the roll, beyond own net income |
| --- | --- | --- | --- |
| 136 | One refunded claim of 89,29 from London (`flipViaPurchasePlotRefunded`, result cost 0); owner became us at +3 s | 0 / 0 / 0 / 0 / 0 | 0 (delta 95.44 = income 95.44) |
| 137 | Control, nothing done | 0 / 0 / 0 / 0 / 0 | +70 (a one-off credit with no claim and no Autoplay; noise, not cost) |
| 138 | `changeGoldBalance(+37)` on the local player | 0 / 0 / 0 / 0 / 0 | 0 (delta 94.34 = income 94.34) |

And from the parity and first gold runs, within a turn: `Players.grantYield(pid, YIELD_GOLD, +37)` read 0 on the tick
and +37 at +3 s, on the rival (416.52 to 453.52) and on us (268.49 to 305.49), and `grantYield(−37)` took it back.

Verdicts, all watched on 1.5.0:

- `Treasury.changeGoldBalance` changes nothing, for the local player or a rival, within 60 s or across a turn. The
  `Treasury` object has only `changeGoldBalance`, `goldBalance` and two maintenance getters. The mod's `grantGold`
  prefers this verb and falls back to `grantYield` only when it is not a function, so on this build the mod's refund
  path never moves gold.
- `Players.grantYield(pid, YIELD_GOLD, n)` is the working verb, deferred by up to 3 s, for any player. So an AI CAN be
  refunded (spec §2, P4), through `grantYield`.
- A script `city.purchasePlot` costs nothing: 0 on the tick, 0 through +60 s, and 0 at the turn roll, while the tile
  landed at +3 s. Every harness run since July logged `goldSpent=0` at the same tick, and this closes the possibility
  of a late charge. The July "spends gold" verdict in §2 came from a build where the tuner's purchase was priced; it is
  not the case now. The dead refund verb therefore costs the player nothing today; if the engine ever prices script
  purchases again, `grantGold` must reach for `grantYield` first.
