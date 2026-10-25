# Cultural Diffusion: design notes

This file holds the design decisions and the in-game checks for features that need more than the README says. The
model itself is in [current-model.md](current-model.md).

## Whole-settlement flips

Status: built 2026-10-15 from [SPEC.md](../../../mod_ideas_tested/liberation/cd-city-flip/SPEC.md) and its build
prompt. Engine evidence: [liberation FINDINGS.md](../../../mod_ideas_tested/liberation/FINDINGS.md), "Culture flips"
and later, and the `engine-closed.md` entries "A marker building can transfer a city to a chosen leader", "Grievances
and relationships can be written from script" and "No request transfers a city between owners".

### How it fits together

| Piece | Where | What it does |
| --- | --- | --- |
| Data | `data/cd-city-flip.sql` | Per major leader (from `Leaders`, so DLC is covered): a trait, a hidden marker building `BUILDING_CD_FLIP_<LeaderType>` owned by a trait nobody has, and a `RunOnce 0` modifier over `COLLECTION_ALL_CITIES` with `EFFECT_CITY_TRANSFER_OWNER`, `TransferType BY_CULTURAL_IDENTITY`, gated on the city holding that marker and on the inverted `REQUIREMENT_CITY_OWNER_IS_SAME_TEAM` guard. Loaded by the game action group in every age |
| Notices | `data/cd-city-flip-notifications.xml`, `-icons.xml` | Two notification types for the train: a settlement leaning (`_WARN`) and one that has joined |
| Rule | `ui/cd-city-flip-rule.js` | Pure: leader on the center, center won, plot share, the gates, the hold counter, the per-pass pick |
| Engine | `ui/cd-city-flip.js` | The pass step, the flip sequence, booking, grievances, the notice, the stray-marker sweep, the hover readout's answer |
| Pass | `ui/cd-pass.js` | `cityFlipStep` runs after every tile change (flips, AI flips, recede, conquest); the picked flips start after the state is saved |
| State | `ui/cd-state.js` | `cityHold` (center key -> `{by, owner, n}`) in `CulturalDiffusionState_v2`; claims gain a `settlement` mark |

The flip sequence (spec 4.1): warn on the pass the count first reaches 1, when either side is the local player; on the
pass it reaches `cityFlipHoldPasses`, place the leader's marker with `CREATE_ELEMENT` as the local player, owner = the
settlement's owner; wait for `CityTransfered` at that center (matched by location, since the city's id changes with
its owner) or for the center's owner to read the leader, up to `cityFlipWaitMs` (4 s); remove every flip marker in
the city; book every plot that shows the new owner; write `changeNumGrievances(owner, n x 1000)` on the leader (the
engine books a grievance on the civ that did the wrong, so this is the loser's grievance against the leader); send
the "has joined" notice `cityFlipNoticeDelayMs` (500 ms) later with Partisans' line when it has one. No transfer in
time: marker out, plots untouched, count reset, `city flip refused` logged. One flip waits at a time.

Seeding: `cd-capture.js` already rewrites the field on every `CityTransfered` (captureLoss/captureGain), ours
included, so the flip leaves it to that handler; it seeds itself only when `captureTransfer` is off.

The age-transition pause holds every count unchanged rather than resetting it.

Three things the lab runs changed (all watched 2026-10-15, then fixed and watched again):

- **Notices.** The engine keeps one live notification per type and player and drops a second, so the warning and
  "has joined" notices for a second settlement in the same turn vanished. `notifySettlement` now reads the live
  notice's text (`Game.Notifications.getSummary`), dismisses it and sends one notice with both, a blank line apart.
  Reading the live text rather than remembering it keeps this right after a UI reload or a load.
- **The stray-marker sweep.** Nothing a script sends lands while a loaded game waits behind its loading curtain for
  Begin Game (`UI.getGameLoadingState()` reads 6, `WaitingForUIReady`), and a removal sent the moment it first read
  8 (`GameStarted`) at a new age's start was lost too. The first version swept on a 5 s timer and logged removals
  that never happened. `sweepWhenStarted` now waits for `GameStarted`, waits 3 s more, sweeps, re-reads and sweeps
  again while any marker stands (up to five tries), and logs what was left. An age change reloads the game's scripts,
  so the same sweep runs at each age start.
- **A transfer that lands late.** Requests sent while the game can't take them are queued, not dropped: a marker
  sent behind the load screen landed once Begin Game was pressed, after the flip had already given up, so the town
  changed hands unbooked with the marker still inside. `onSettlementTransfer` now treats a transfer of a city that
  holds one of the markers, with no flip waiting on it, as that flip landing late: marker out, plots booked,
  grievances, notice. In normal play the pass only runs in a started game, so this is a backstop.

### Requirement 1: the guard audit

Searched `ui/` on 2026-10-15 for `isCityCenterAt`, `CITY_CENTER`, `isCoreProtected`, `flipRefusedFor`,
`getOwningCity`, "center" and "centre", and for every guard on a tile's owner that could refuse, undo or re-flip a
settlement's plots after the transfer. Every hit and its decision:

| Where | What it does | Decision |
| --- | --- | --- |
| `cd-borders.js` `rivalClaimAllowed`, `isCoreProtected`, `_centerOnMapWithin`, `_cityCenterWithin` | Protects plots within `coreProtectRadius` of a rival center, and every plot a minor owns | Kept for tile flips. Never called by the settlement path |
| `cd-teardown.js` `flipRefusedFor` | Refuses urban districts, centers and wonders as tile flips | Kept for tile flips. The settlement carries them; never called |
| `cd-eligibility.js` `claimGateBlocked` (calls the two above, `distantLandsGated`, `districtTransferPaused`, `adjacentToMe`, `wouldStrandForeignUnit`) | The tile gates the pass, lens and readout share | Kept for tile flips. The settlement path has its own war, age-transition and distant-lands gates in the rule |
| `cd-flip.js` `flipEligible`, `commitFlip`, `claimCountsFor` | Tile gates, the commit, the per-city cap | Kept. `claimCountsFor` now skips `settlement` claims, so a joined settlement never counts toward a cap |
| `cd-ownership.js` `performFlip` | Last refusal before `purchasePlot` | Tile flips only. The settlement path never sends `purchasePlot` |
| `cd-conquest.js` `conquerable` (`isCityCenterAt`) | Armies never take a center | Kept: cities fall to the game's own capture |
| `cd-ai-flips.js` | AI tile flips through the same gates | Kept; skips the plots of a settlement that may flip this pass |
| `cd-pass.js` `releaseInnerClaims` | Drops the record of any claim of ours inside our own 3 rings (it used to send `setOwnership(NO_PLAYER)` too, which the engine ignores on a city-attached tile; removed 2026-10-16) | Skips `settlement` claims, so a settlement that joined us keeps its records |
| `cd-reparent.js` `reparentAll`, `reparentStuck` | For every living major civilization, moves a tile attached to one of its settlements more than 3 away to its settlement within 3, by re-buying it (teardown first when improved); city-states and independents are left out | Skips the plots of a settlement that may flip this pass. A joined settlement's plots sit around its own center, so they're never stuck |
| `cd-pass.js` `repairOrphans` | Re-buys our plots that have no owning city | No change: a joined settlement's plots belong to its city |
| `cd-pass.js` `tryFlipCandidate` (local tile flips), `cd-conquest.js` sweep | Tile flips and army conquest | Skip the plots of a settlement that may flip this pass (its count is one short of the bar or past it), so nothing buys a plot of a settlement about to change hands |
| `cd-recede.js` `recedeEligible` | Cedes our claims to a rival that out-cultures them | Skips `settlement` claims and the plots of a settlement that may flip this pass |
| `cd-pending.js` `confirmOne` | Books last pass's tile verbs from the map | The flip deletes every pending entry on the settlement's plots, and the flip waits a pass when one of its plots still has a tile verb landing |
| Cooldown locks (`state.locked`) | Every tile path skips a locked plot | The flip locks every plot for `flipCooldownTurns`, so no tile flip moves them back in that time |
| `cd-pressure-tooltip.js` `actionableHere`, `cd-pressure-lens.js` `contestedEntry` | Showed a rival center as protected (no progress) | Still never offer the center as a tile; the center now shows the settlement's leaning and count, or the gate holding it |
| `cd-config.js` `coreProtectRadius`, `minorProtectRadius` docs | Said the center could flip at -1 | Reworded: the center moves only with its settlement |
| `cd-capture.js` `cityPlots` | The city's plots, center included | Used by the settlement path to read and book the plots |
| `cd-plots.js` `isCityCenterAt`, `owningCityLocAt`, `districtTypeNameAt` | Map reads | Reads only |
| `cd-bootstrap.js`, `cd-diagnostics.js`, `cd-ethnicity.js`, `cd-emigration.js`, `cd-pressure.js`, `cd-units.js`, `cd-options.js`, `cd-settings.js` | "center" in comments, keys and labels | No guard |

`tests/city-flip.mjs` fails if `cd-city-flip.js` or `cd-city-flip-rule.js` names a tile gate, or reaches a tile-flip
module (`cd-eligibility`, `cd-flip`, `cd-ownership`, `cd-teardown`, `cd-ai-flips`, `cd-recede`, `cd-conquest`,
`cd-pending`, `cd-units`, `cd-pass`) through its imports.

### Acceptance checks

Two seeded lab games (`tools/tower-bench`, `lab start --seed 4242 --age AGE_ANTIQUITY`, game 1.5.0), 2026-10-15:
**vanilla** (every other mod off; the local build of this mod the only user mod) and **usual set** (the 27 user mods
the owner normally runs, Partisans among them, with the Workshop copy of this mod off and a throwaway one-line probe
mod that ends Antiquity at 20 age points so the run reaches the transition). The towns were made with
`CREATE_ELEMENT {Kind:"CITY"}` around the local capital at (65,13); "seeded" means the saved culture field was written
so the leader had about 6000 on the center and a lead under the tile-claim bar on every plot, and the passes were run
with `culturalDiffusion.runNow()` a few seconds apart, plus every natural turn in the long run. The step scripts are
the liberation probes' `lib.js` and a small CDF helper beside it; neither ships.

| # | Check | Vanilla | Usual set |
| --- | --- | --- | --- |
| F1 | Rival town, culture over the bars for 3 passes | Pass. Argos (Alexander's) to us: warning on pass 1 ("Argos's people look to Heian Japan."), flip on pass 3, `BY_CULTURAL_IDENTITY`, 265 ms, 7 of 7 plots; `ConstructibleRemovedFromMap` for the marker right after `CityTransfered`; no marker left | Pass. Same town, 280 ms, 7 of 7 |
| F2 | Our town to an AI | Pass. Dazaifu to Alexander, 237 ms, 7 of 7; the notice says "Dazaifu has joined Greece." (seen once the notice merge was in; see above) | Not run separately: F1's notices covered the train with mods on. Pass 2026-10-16 (block 1 L2): Mutsu (68,17) to Alexander on pass 3, 313 ms, 7 of 7, `BY_CULTURAL_IDENTITY`; Alexander's `getNumGrievances(us)` 30, ours 0 |
| F3 | AI to AI inside the field | Pass. Wailuku (José Rizal's) to Alexander, 249 ms, 7 of 7; the local player's notifications unchanged (11 before, 11 after); Hawaii's grievance count against Greece read 30. That run used the old write, which put the count on Hawaii's side and so booked Hawaii as the one who did wrong | Not run separately. Pass 2026-10-16: Mutsu from Alexander to Machiavelli on pass 3, 286 ms, 7 of 7; Machiavelli's `getNumGrievances(Alexander)` 30. The local player's notifications went 14 to 15, the new one `NOTIFICATION_PLAYER_MET` (the town made Machiavelli our neighbour); Cultural Diffusion didn't send a notice |
| F4 | Capital, setting off / on | Pass. Off: our capital Heian-Kyo never started a count in four passes. On: it flipped to Alexander in 247 ms as a town (Palace gone, City Hall); our capital moved to Kórinthos | Not run separately. Pass 2026-10-16, both settings. Off: our capital Asuka never started a count in three passes. On (`setCityFlipCapitals(true)`): Asuka joined Alexander on pass 3 as a town and our capital moved to Heijo |
| F5 | Last settlement, setting off | Pass. Harrân, Xerxes' only town, never started a count in four passes. (Xerxes then read `isAlive` false with no units, an artefact of the scripted start; Hawaii stood in for F3) | Not run separately. Pass 2026-10-16: with Heijo our last settlement and "can eliminate" off, it never started a count in a pass, and the readout composed "Leans to Greek Empire · held: their last settlement". (An AI's only settlement far away couldn't be used: the pass drops seeded culture outside the area it works on.) |
| F6 | At war | Pass. After declaring war on Alexander, Heian-Kyo (his) never started a count in four passes; the readout said "held: at war" | Not run separately. Pass 2026-10-16: at war with Machiavelli, his Mutsu never started a count in three passes; readout "Leans to Heian Empire · held: at war" |
| F7 | Penalty | Pass with the old write, which put the +30 on the loser's own count, so the engine booked the loser as the one who did wrong (Greece vs us: 0/0, then 30/-30, then 60/-60). Re-run with the write on the receiver, 2026-10-15: Chalkís from Alexander to us, our `getNumGrievances(Alexander)` 0 to 30 and his `getNumGrievances(us)` unchanged; the relationship and history didn't move in that early, scripted game (see `engine-closed.md`) | Pass with the old write (Argos: 30). Re-run with the write on the receiver, 2026-10-15, Tower mods on: same as vanilla, our count 0 to 30, his unchanged. Between two AIs that met naturally (2026-10-16, watch run 2 block 2 G7b, usual set): Yangju from Machiavelli to Alexander at turn 33, Alexander's count 0 to 30, Machiavelli's 0, relationship 23 to -7 both ways, history `DIPLOMACY_GRIEVANCE` -30 `triggeredBy` Alexander; the game added `GRIEVANCE_FROM_CLOSE_LAND_CLAIM` -20 two turns later |
| F8 | Repeat flips of one settlement | Pass. Heian-Kyo us to Alexander, back to us, to Alexander again: each flip once, 246-249 ms, no stray marker, no crash | Not run separately. Pass 2026-10-16: Mutsu us to Alexander, to Machiavelli, to us, to Machiavelli: each flip on pass 3, 279-313 ms, 7 of 7, the flip marker gone each time, no crash |
| F9 | Save and reload mid-hold; age transition | Pass. Count 2 for Hanyang, quicksave, quickload: the count read 2 behind the load screen; the next pass after Begin Game flipped it (246 ms, 7 of 7). A stray marker stayed put behind the load screen and was swept after Begin Game | Pass. A count of 2 written before the Age Ending countdown stayed 2 through countdown passes and read 2 at Exploration turn 1; Argos and Chalkís kept their new owner (transfer record reset to `NO_TRANSFER_TYPE`); a stray marker was swept after the transition, and again across a quicksave and quickload in Exploration. The carried count then reset correctly: the age change made that town Goryeo's capital |
| F10 | SQL test | Pass: `tests/city-flip-data.mjs`; and the live compiled database held 38 transfer modifiers, all 38 with the guard | Pass: the same 38 |
| F11 | 40-turn run | Not run in vanilla | Pass. 20 Antiquity turns, the transition, 20 Exploration turns with the pass on every turn, no crash and no Cultural Diffusion error in `UI.log` |
| F12 | City-states and independents | Pass. Our culture seeded over an independent village (player 16) and then over the same settlement as a city-state (`setSuzerain`): no count, no flip, no marker in four passes each | Not run separately. Pass 2026-10-16: independent village Teouma (57,23, player 20), then the same as a city-state (`setSuzerain` to Alexander): it never started a count and every plot kept its owner in three passes each |
| F13 | Town with urban districts and a wonder | Pass. Kórinthos (Library and Granary urban districts, Angkor Wat) to us in 286 ms: the center, every plot, both districts and the wonder showed the new owner in the same pass; 0 tile flips that pass | Pass. Chalkís, same build, 274 ms |
| F14 | The pass after a flip | Pass. Two more passes: no tile flip, recede or pending entry moved any of Kórinthos' plots; Argos kept all 7 plots although they lie inside our capital's three rings (the release the `settlement` mark guards) | Covered by the long run: both towns kept every plot for 40 turns |
| F15 | The old owner's units at the transfer | Pass. Alexander's Warrior on the center went to (64,5) and his Spearman on a ring-1 plot to (65,5), into his own land 3-4 tiles out; his units outside the town didn't move; no crash | Pass. Center and ring-1 units went two tiles out; no crash |
| F16 | Core protection 0 and raised | Pass. Radius 0: flips above. Radius 1: Hanyang still flipped (281 ms). The live tile gate, asked for Goryeo and Dai Viet against Argos: at 0 only the center is refused, at 1 the center and all six ring-1 plots | Not run separately. 2026-10-16 (1.6.0 release watch, W1): FAIL, at radius 0 all six ring-1 tiles of Thêbai refused as well as the centre; `Cities.getAtLocation({x,y})` returns the owning city for every owned tile. 2026-10-16 (1.6.1, Exploration 4242, usual set, turn 1, deployed into the running game and the UI reloaded): on Persia's capital 19,34 and its ring, the 1.6.0 module read `isCityCenterAt` true, `conquerable` false and `isCoreProtected(…, 1, 0)` true on every ring tile; the 1.6.1 module reads the centre true/false/true and each ring tile false, `isCoreProtected` at 0 false and at 1 true, `conquerable` true on the rural tile 18,34 and false on the two urban ones (19,35, 20,34), which conquest refuses by design. Across four cities, 24 of 24 ring-1 tiles returned the owning city with its location at the centre, 0 at the tile |
| Readout | Hover readout on a center | Pass: "Leans to Heian Empire · held: at war" on Heian-Kyo, "Leans to Goryeo Empire · 1 of 3 turns of clear culture" on Hanyang | Not run separately. 2026-10-16: the held wording read through the tooltip's `resolve()` (see F5, F6); the "N of 3 turns" wording wasn't read |
| Partisans | The hand-off (spec step 6) | Not applicable | Pass. With Partisans' roll forced to hit, Partisans logged "brewing at 61,15: Cultural Diffusion's flip notice carries the unrest" and sent nothing; this mod's notice read "Argos has joined Heian Japan. / Greece now holds 30 grievances against Heian Japan. / Not everyone wanted this. Partisans are gathering near Argos." |

Still open:

- With the usual set, only F16 is left to repeat on its own; F2-F6, F8, F12 and the readout's held wording were
  watched 2026-10-16 (block 1 L2), and F1, F7, F9, F11, F13-F15 and the Partisans hand-off before that. The rule and
  the gates don't read any other mod.
- Every settlement flipped on 2026-10-16 arrived at population 1 (Asuka 7 to 1, Mutsu 3 to 1), where the spec's probes
  saw about one point lost. It's the engine's transfer; see "Observation: population after a flip" below.
- The late-transfer backstop is covered by `tests/city-flip.mjs` only; watching it needs a request queued behind the
  load screen, which normal play doesn't send.
- The log line naming the transfer type (`BY_CULTURAL_IDENTITY` instead of the enum's number) was added after the
  runs; it was seen in `UI.log` on 2026-10-16: "city flip: Mutsu (68,17) joined player 2 from player 0 in 313 ms
  (BY_CULTURAL_IDENTITY); 7 of 7 plot(s) show the new owner".
- The Civilopedia page and the marker building's Civilopedia entry weren't opened in game; `tests/pedia-pages.mjs`
  checks the page resolves.

### 1.7.0: the land gate, the countdown and the City Details section (2026-10-16)

Lab game, Antiquity 4242, usual set, 1.7.0 deployed into the running game with the UI reloaded (so the mechanics are
the new code and the text keys are 1.6.0's: a new key reads as its tag until a new game compiles the text). Our
capital Kamakura founded at 65,13 by `CREATE_ELEMENT`, Persian towns the same way, the field seeded as in the 1.6.0
runs (6000 against 500 on the center, 250 against 100 on the plots), passes by `culturalDiffusion.runNow()`.

| Check | What was watched |
| --- | --- |
| Land gate, held by a gate | Tushpa (67,17), Persia's only settlement: outlook `won false, refusal last-settlement, landShort true, land 1:6 (14%)`, readout "held: their last settlement", no hold |
| Land gate alone (Low) | A second Persian city far off, then a new town at 61,13 under *claim empty land only*: three passes, each `refusal null, landShort true, land 1:6`, readout "held: the countryside is still theirs", no hold, every ring tile still Persia's |
| Land gone, hold starts | Back on Medium with ten of the town's countryside tiles bought by Kamakura: the next pass read `land 15:2 (88%)` (the pass's own tile flips took four ring tiles too), hold `n 1`, readout "1 of 5 turns of clear culture" |
| Countdown and flip | Tushpa, once its ring had gone to tile flips (6:1): pass 1 "Tushpa's people look to Heian Japan", passes 2-4 the countdown notice (the COUNTDOWN, COUNTDOWN and COUNTDOWN_LAST keys, unresolved in this game), pass 5 "Tushpa has joined Heian Japan. Achaemenid Persia now holds 30 grievances against Heian Japan" in 182 ms, Partisans rolled ("level -10, chance 0.03, stays quiet") |
| City Details section | Persia's culture seeded over Kamakura, `INTERFACEMODE_CITY_PRODUCTION` on it and a `panel-city-details` created the way the production chooser does: the Citizen Growth tab reads "Cultural Diffusion / Leans to Achaemenid Persian Empire / held: Distant Lands before Exploration / (the center and countryside keys)", under Partisans' and Emigration's sections (`working_screenshots/cd-1.7.0-2026-10-16/01-city-details.png`) |

A second lab game (same setup, started with the 1.7.0 files in place, so the text compiled and the section's script
loaded from the modinfo rather than an import):

| Check | What was watched |
| --- | --- |
| Countdown wording | Tushpa, its countryside bought (land 16:3) and Persia given a second city: pass 1 "Tushpa's people look to Heian Japan", pass 2 "Tushpa joins Heian Japan in 3 turns unless its people are won back", pass 3 "... in 2 turns ...", pass 4 "... next turn ...", readout "1 of 5" through "4 of 5 turns of clear culture"; pass 5 "Tushpa has joined Heian Japan. Achaemenid Persia now holds 30 grievances against Heian Japan. Not everyone wanted this. Partisans are gathering near Tushpa." |
| Section, calm | Kamakura selected: "Cultural Diffusion / Heian Empire's own culture leads here." (`02-city-details-calm.png`) |
| Section, leaning | Persia's culture seeded over Kamakura, the panel's own `update-city-details` event: "Leans to Achaemenid Persian Empire / held: their last settlement / Culture on the center: Achaemenid Persian Empire 6,000, Heian Empire 500 / Countryside: Achaemenid Persian Empire holds 1 tiles, Heian Empire 6" (`03-city-details-leaning.png`). The "1 tiles" line was reworded to "Countryside tiles: ... 1, ... 6" after the run; the new wording isn't watched |
| Section with nothing selected | The section's first build logged "Script Error: Expected object" from `Cities.get(null)` on every refresh with no city selected (Partisans' `pt-panel.js:45` logs the same). The id is checked first now. Not watched: after the deploy's reload no City Details panel existed (the game builds it on the first open), so no refresh ran; the errors before the reload were the only ones logged. It's a null check on the id before `Cities.get`, covered by nothing in `tests/` either |

### Watch run 2, block 2 G1 (2026-10-16, 1.7.0, usual set, Antiquity 4242, fast setup)

- F16 with real tiles moving: a Greek town 5 tiles from Heian-Kyo (Knōssós, 68,17), our culture seeded on it, core
  protection None. All six ring-1 tiles went from Greece to us in three passes and the town's plots went 7 to 1; the
  town then read held 3 of 5 with land 15:0 and flipped `BY_CULTURAL_IDENTITY` at the fifth turn. Population 2 to 1.
- The +1 buffer on growth (setting off by default): a population point on ring 3 with the setting off left its
  ring-4 neighbours unowned, and the game took nothing past ring 3. Setting on: "buffer: +2 tile(s) adjacent to rural
  growth at 68,14", ring-4 tiles 69,14 and 68,15 ours. Mod switched off with the setting on: ring-4 tiles stayed
  unowned, no buffer line.
- Block 2 G3, Cultural Diffusion alone: the same three buffer readings ("buffer: +3 tile(s) ... at 68,13"). A Greek
  town grown to 6 and flipped to us `BY_CULTURAL_IDENTITY`: 6 on the pass before, 1 after, the same drop as with the
  usual set, so it's the engine's transfer. The capital case wasn't reached (the rival held none of the land around
  our capital, so the land gate never let the hold start).

### Observation: population after a flip

Watch run 2, block 1, run L2 (2026-10-16, usual set, Antiquity seed 4242, fast setup): every settlement flipped
arrived at population 1. Asuka (62,16), our capital with the capital setting on, went from 7 to 1 in a single flip to
Alexander. Mutsu (68,17) went from 3 to 1 over four flips in 81 seconds (us, Alexander, Machiavelli, us, Machiavelli),
so a point a flip would also end at 1 there. Both kept 7 of 7 plots.

The mod doesn't set or spend population anywhere on this path. It places the flip marker (`Population 0`), the
engine's `EFFECT_CITY_TRANSFER_OWNER` with `BY_CULTURAL_IDENTITY` moves the settlement, and after `CityTransfered`
the mod removes the marker and moves the saved culture (`cd-capture.js`, state only). The passes after it leave a
joined settlement's plots alone (see the audit above), and Partisans only rolls at the transfer and schedules any
rising turns later. So the drop is the engine's transfer. The liberation probes
(`mod_ideas_tested/liberation/FINDINGS.md`, flips 13-17) only moved settlements of population 2 and 3 and saw one point
lost in 5 of 6. Asuka shows a larger settlement can lose far more than one point. Not yet seen: a flip of a large
settlement with every other mod off, and whether a capital loses more than a town.
