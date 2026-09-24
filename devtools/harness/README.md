# Cultural Diffusion in-game harness (dev only)

A throwaway, hands-free harness for watching Cultural Diffusion against the real engine. It follows the Emigration
engine probe's proven pattern (`../../../emigration/devtools/engine-probe/`). Nothing here ships.

- `cdh-shell.js` (shell scope) auto-loads `TARGET_SAVE` from the main menu.
- `cdh-game.js` (run 1) and `cdh-game-run2.js` (run 2, deployed as `ui/cdh-game.js`) press Begin Game themselves with
  `UI.notifyUIReady()`, run scripted engine tests in the first local turn, then end turns with
  `GameContext.sendTurnComplete()`, falling back to a one-turn `Autoplay` when a blocker persists.
- Every line goes to `~/Library/Application Support/Civilization VII/Logs/UI.log` tagged `[CDH]`.

## Running it

1. Tell any other session that uses the game, and wait until Civ VII is closed.
2. Copy `cd-harness.modinfo` to `Mods/cd-harness/`, and the two scripts to `Mods/cd-harness/ui/`.
3. Deploy the mod with `<AffectsSavedGames>0</AffectsSavedGames>` added to its modinfo properties, so it attaches to a
   save made without it, and `debug: true` in `ui/cd-config.js`. Enable it: `UPDATE Mods SET Disabled=0 WHERE
   ModId='cultural-diffusion'` in `Mods.sqlite`.
4. Launch the game normally. The save loads by itself about 15 seconds after the main menu appears.
5. After `DONE`, stop the game with `pkill -TERM -x CivilizationVII`. A scripted `osascript` quit is blocked by a
   confirmation dialog. Move `Mods/cd-harness` out, since it hijacks every launch while installed. Redeploy the repo
   copy of the mod and set it back to `Disabled=1`.

Launching with `-autojson` and the base game's automation suites did not start a game on 1.4.2. Use this harness.

## Running it hands-free

`run-harness.sh` does the whole cycle, so step 2-5 below are only for a manual run:

```
zsh run-harness.sh cdh-game-run13.js AugustusAnt136.Civ7Save run13 1200
```

It refuses to start when Civ VII is already running or when another session's probe/harness mod is installed in
`Mods/` (a second harness hijacks the launch and contaminates both runs). It backs up the player's autosaves and puts
them back if the run churned the rotation, remembers every `cultural-diffusion` registry row's `Disabled` flag and
restores it, deploys the REPO copy of the mod with `AffectsSavedGames=0` and `debug: true` patched into the DEPLOYED
files only, waits for `DONE`, writes `<label>-UI.log`, copies any `.ips` crash report, then quits and redeploys the
unpatched copy.

## Borders 4-6 - the rejected "before" frame: the save was fine, the picture was not (2026-09-24, game 1.5.0)

Scripts `cdh-game-borders4.js`, `-borders5.js`, `-borders6.js`. The v1.2.0 gallery pair was rejected for showing a city with four rings of territory when the base game stops at three (`CONFIG.baseGrowthRadius`), which would mean the "before" frame was not a vanilla baseline at all.

Take 4 censused every one of the local player's cities, counting owned tiles by ring and attributing each tile to its NEAREST city so a neighbour's land cannot be read as this city's:

| City | Owned tiles by ring (0-6) | maxOwnedRing | Foreign tiles within 6 |
| --- | --- | --- | --- |
| London | 1,6,12,15,0,0,0 | 3 | 1 |
| Birmingham | 1,6,12,9,0,0,0 | 3 | 18 |
| Glasgow | 1,6,11,8,0,0,0 | 3 | 8 |
| Megiddo | 1,6,10,5,0,0,0 | 3 | 13 |
| Leeds | 1,6,12,8,0,0,0 | 3 | 1 |
| Lāhainā | 1,6,11,15,0,0,0 | 3 | 29 |

Every city stopped at ring 3, so **the mod had not over-claimed anything and the save's before-state was vanilla**. What the rejected frame actually showed was a NEIGHBOURING CIV's territory in a near-identical purple: 29 of the tiles within six rings of Lāhainā belong to someone else, and at a wide zoom they read as Lāhainā's. The picture was wrong; the game state was not.

Take 5 therefore picks by `foreignWithin6` (Leeds, 1) instead of by claimable land, and aims the camera ONCE - re-aiming before the second shot does not land on the same view, so the pair was never quite the same frame. Take 6 keeps that and centres on the frontier rather than the city, because centred on the city the border simply left the picture instead of moving across it.

Result (`borders6`, six passes, shipped as `gallery/04-border-before.jpg` and `05-border-after.jpg`): Leeds `[1,6,12,8,0,0,0]` -> `[1,6,12,8,7,7,0]`, owned within six rings 49 -> 74. One camera, held still; in the first frame the border runs down the middle of the shot, in the second it sits at the far west and the plain between is inside it.

## Lens check - does the pressure layer paint under ANOTHER lens? NO (2026-09-24, game 1.5.0)

Script `cdh-game-lenscheck.js`. Raised while assembling the release gallery: suite shot 01 showed pressure paint although the run had logged `lensAtStart=fxs-default-lens`, which reads like the layer painting without its lens being active - a player on the Continent lens seeing magenta over half the map.

The script seeds one contested block (9 tiles, rival stock 210, centre 86,22), then captures three states, logging `LensManager.isLayerEnabled(LAYER)` and `pressureTiles().length` at each:

| State | Active lens | `layerEnabled` | `wouldPaint` | Frame |
| --- | --- | --- | --- | --- |
| A - untouched | `fxs-default-lens` | false | 9 | Clean. No shading anywhere |
| B - pressure active | `cd-pressure-lens` | true | 9 | Fully painted, the seeded band in magenta |
| C - switched away | `fxs-default-lens` | false | 9 | Clean again - `removeLayer` clears the overlay |

Verdict: **not a defect.** The layer is painted only while its own lens is active, and `wouldPaint=9` across all three states proves the clean frames are gating, not an empty field. The suite-01 observation was an artefact of the harness: the ACTIVE LENS PERSISTS ACROSS GAME SESSIONS, the run before it had left `cd-pressure-lens` selected, the game restored that selection after the script's early `getActiveLens()` read, and the frame was taken nine seconds later with the mod's lens genuinely on. Two lessons for capture runs - an early `getActiveLens()` is not the lens you will photograph, and a run should end on the default lens or it contaminates the next one.

## Run 13 - the eviction: can a mod move a unit it does not own? (RUN 2026-09-24, game 1.5.0)

Script `cdh-game-run13.js`. Settles whether the 1.1.1 eviction (`ui/cd-units.js`) works at all, and what the engine
does if it does not. It reads the UNIT'S LOCATION after each attempt rather than trusting `canStart`, because three
things already recorded say that is the only trustworthy signal:

- `engine-closed.md`: **an operation sent under another player's id is refused - `canStart` succeeds, `sendRequest`
  returns false, nothing changes.** That is exactly the shape of driving a unit we do not own.
- `engine-closed.md`: `canStart` checks request shape, not placement; confirm every write with a deferred re-read.
- The emigration engine probe: `canStart(UNITOPERATION_TELEPORT_TO)` answered **false** for one of our own units
  (`tower_mods/emigration/devtools/engine-probe/README.md`). Which unit and which destination is not fully pinned, so
  the verb needs a clean control before it can be called dead.

| Stage | What it does | What it settles |
| --- | --- | --- |
| S1 SURFACE | Read-only reflection of `Game.UnitOperations` / `UnitCommands` / `WorldBuilder` / `WorldBuilder.MapUnits` / `Units` for move/teleport/place names, plus the `UnitOperationTypes` members | What is even callable on this build (1.5.0, not the 1.4.2 the old notes came from), including whether a `WorldBuilder` unit-placement path exists that bypasses ownership |
| S2 OWN | Bake-off against one of OUR units: for each of `TELEPORT_TO`, `MOVE_TO`, `SWAP_UNITS`, `TELEPORT_TO_CITY` - `canStart({})`, `canStart({X,Y})`, then `sendRequest` and re-read the unit's location at +3 s and +8 s | Whether each verb works AT ALL when we do own the unit. Without this control, a refusal on a foreign unit proves nothing |
| S3 FOREIGN | The same bake-off against a FOREIGN unit (civilian preferred, nearest to our cities) | **The decisive stage.** Whether any verb moves a unit we do not own, and which verbs return `canStart` success while moving nothing |
| S4 OVERRUN | With `bumpForeignUnits` OFF: seed our culture stock on the plot a real foreign unit is standing on and run one pass in the SAME tick (so it cannot wander off), then watch 3 turns | Whether the BASE GAME ejects a unit whose plot changes owner. If it does, the whole feature is unnecessary; if it does not, this reproduces the reported symptom in-game for the first time |
| S5 MOD | The same fixture with `bumpForeignUnits` ON | Whether `cd-units.js` fires end to end: unit moved and tile claimed, or claim skipped, or - the silent failure - tile claimed with the unit still standing on it |

S4/S5 relax `requireAdjacency` and `flipMaxDistance` so that whatever plot a real foreign unit happens to occupy can
be claimed at all; nothing else about the claim path is changed. Each stage emits its own `VERDICT` line, so the log
tail answers the question without reading the whole run.

Prerequisite: no other probe mod in `Mods/`; move any out first (run 13 moved two demographics probes aside and put
them back).

### Result: NO. The eviction cannot work. Full log `run13-UI.log`.

| Stage | Verdict |
| --- | --- |
| S1 surface | `UnitOperationTypes` has **no `TELEPORT_TO`** on 1.5.0 - only `MOVE_TO`, `MOVE_TO_UNIT`, `SWAP_UNITS`, `TELEPORT_TO_CITY` - although `UNITOPERATION_TELEPORT_TO` IS a row in the compiled `UnitOperations` table. `Game.UnitOperations`, `Game.UnitCommands`, `WorldBuilder` and `WorldBuilder.MapUnits` expose no move/teleport/place member at all; `Units` has only `Movement`, `getReachableMovement`, `restoreMovement` |
| S2 own unit (control) | All four verbs moved our own Scout **nowhere**. `MOVE_TO` answered `canStart` **true** and the unit still never left its plot at +3 s or +8 s - the canStart-lies pattern, watched live on a unit we own |
| S3 foreign unit | Rival Settler (player 3): all four verbs `canStart` **false**, nothing moved, no fault. `NO VERB MOVED A FOREIGN UNIT` |
| S4 overrun, eviction off | Inconclusive as an overrun test: our `purchasePlot` on the Slinger's plot never landed (the plot read as player 3's next turn and our claim was dropped). But the unit walked away by itself every turn - 89,42 then 87,41 then 87,42 then 86,43 then 87,45 |
| S5 mod path, eviction on | The wiring works end to end and hit exactly the documented fallback: `evict 80,36: engine offers nowhere legal for player 4's unit` then `skip flip 80,36`. The Scout had already stepped off the seeded plot, so 80,37 was claimed normally and the unit was at 80,34 by the end |

Consequences:

- `ui/cd-units.js` can never succeed on this engine. With `bumpForeignUnits` on, the shipped behaviour is **identical to
  refusing the claim**, just with four wasted `canStart` calls and a ring scan first.
- Recorded in `civilization_vii_mods/engine-closed.md` under "A mod cannot move a unit it does not own" and
  "`UnitOperationTypes` does not expose every operation the gameplay DB defines".
- Both AI units under test **walked off their plot within a turn or two unprompted**, which weakens the premise that
  overrunning a unit's plot strands it. The reported Settler was most likely encircled (a pocket), not overrun.
- No crash: sending four refused unit operations at a foreign unit did not fault on 1.5.0.
- Two runner bugs this run exposed and fixed: it truncated the shared `UI.log` (now copied to
  `cd-harness-backup/UI-before-<label>-*.log` first), and it restored the registry by the pre-run `ModRowId`, which
  redeploying invalidates - row 639 became row 1015, so the mod was left ENABLED. It now restores by value.

## Runs 30-31 + control40 - crash watch: TWO crashes, TWO different signatures (2026-09-24, game 1.5.0)

Long unattended runs on AugustusAnt136 with everything active. Both crashed, and NOT in the same way - which is
the whole point of reading the `.ips` rather than counting crashes.

| Run | Mod state at the fault | Thread | Fault address | Top frame | Report |
| --- | --- | --- | --- | --- | --- |
| 30 | pass active, **0 claims**, Antiquity turn 150 | AppHost application | `0x0` | `CivilizationVII 0x21081fc` | `run30-crash.ips` |
| 31 | pass active, **37 claims**, Exploration turn ~26, after the age transition | **AsyncWorker3** | **`0x2d8`** | `CivilizationVII 0xd90650` | `run31-crash.ips` |
| archived run 3 | 9 claims beyond ring 3, just after an age transition | AsyncWorker1 | `0x2a8` | - | `run3-crash-evidence.txt` |
| archived run 7 | - | AsyncWorker1 | `0x308` | - | `run7-crash-evidence.txt` |

Reading:

- **Run 30 is the known NON-mod signature.** `CivilizationVII+0x21081fc` on the AppHost thread at address 0 is the
  load-transition SIGSEGV recorded as appearing with AND without mod code (`engine-closed.md`, 2026-09-17). It happened
  with the mod holding NOTHING, and the base game's own `unit-flags-independent-powers.js:463` was throwing
  `Cannot read properties of null (reading 'type')` in the seconds before.
- **Run 31 is in the family of this mod's archived claim-associated crashes:** an AsyncWorker thread faulting on a small
  struct offset (`0x2d8`, vs `0x2a8` and `0x308` in runs 3 and 7), after an age transition, with claims held. That
  signature PREDATES this session's work, so it was not introduced by it - but that is not the same as harmless, and it
  is the one to keep narrowing.
- The mod's last pass before run 31's fault was unremarkable: `passMs=18`, `flips=0`, `confirmed 1 claim`, 38 claims.

**Parked 2026-09-24.** Run 32 (`AI_VERBOSE=1`, mod on) then passed BOTH crash points - Exploration t41 holding 38
claims, more than run 31 had when it died - without faulting, and the mod-off control ran 57 turns clean. That makes
it 2 crashes / 3 runs with the mod and 0 / 1 without: non-deterministic, and too weak to bisect at one run per
point. Full write-up, including the cost of doing it properly, in
[`../../docs/potential-bug-native-crash.md`](../../docs/potential-bug-native-crash.md); split order in
[`BISECT-PLAN.md`](BISECT-PLAN.md).

Next steps if it is resumed, in order:

1. `control40` (this folder, `cdh-game-control.js` with `NO_MOD=1`) - 40 turns on the same save with the mod DISABLED.
   A crash there means long unattended runs destabilise this save regardless of the mod.
2. `AI_VERBOSE=1`, so the `AI_ConstructibleBroker` CSV tail names the last-evaluated constructible - the evidence
   CLAUDE.md calls for on AI-turn crashes, and absent from both reports here.
3. If the mod is implicated, bisect by config rather than by code: `maxDiffusionPlots` low, then `flipMaxDistance` 4,
   then claims beyond ring 3 disallowed entirely.

**A harness trap this exposed:** a run cannot switch the mod off from script. `applyTunableOverrides()` pulls saved
settings into `CONFIG` on every pass, so `CONFIG.diffusionEnabled = false` set by a harness is clobbered within a turn -
run 31 was written as a control and finished holding 37 claims. `run-harness.sh` now takes `NO_MOD=1`, which leaves the
mod disabled in the registry, and the control script imports nothing from the mod.

## Runs 18-24 - both fixes CONFIRMED (RUN 2026-09-24, game 1.5.0)

Scripts `cdh-game-run18.js` ... `run24.js`. These run with the mod's pass ENABLED (runs 14-17 disabled it to measure the
engine). Every stage demands positive proof: the guard's own log line on the named plot, or an A/B where the same call
is made with the knob on and off.

| Run | Result |
| --- | --- |
| 18 | Map centre read validated live (all six of our centres; `Cities.getAtLocation` is the route that works - district type reads null). Five minor centres found where run 16-17's district read found none; the pass refused a centre carrying a 50,000 seed. Stage G was VOID: the gap it left was outside `flipMaxDistance`, so "left alone" proved nothing |
| 19 | `minorProtectRadius` CONFIRMED by A/B on three of city-state 18's ring-1 plots (`withFloor=false, withoutFloor=true`). Strand guard FAILED: took the gap, unit frozen 4 turns |
| 20 | Diagnosis: the unit list IS a real Array (`isArray=true`), so that theory was wrong. `hasStrandableUnit=true` but `wouldStrandForeignUnit=false` - the cap/region rule called a small pocket "already trapped" |
| 21 | Second cause: `legalExitsNow=2 -> 1`, and the pass took BOTH exits in one pass because `purchasePlot` had not landed when the second claim was judged |
| 22 | Third cause: `legalExitsNow` stayed 2 because a MOUNTAIN neighbour counted as a legal destination |
| 23 | **HELD.** `legalExitsNow=1 legalExitsAfterClaim=0`, `skip flip 79,37: would strand a foreign unit`, gap left unowned, Scout walked out 79,37 / 79,38 / 78,39 |
| 24 | Repeat with corrected verdict semantics: `refusedWhenPenned=true everImmobile=false distinctPositions=3 => HELD`, plus the minor floor and centre protection re-confirmed in the same run |

Taking the tile LATER, once the unit has moved on, is correct and designed - run 23's first verdict logic scored that as
a failure. Judge the guard on the seeded claim and on the unit never being left immobile.

## Runs 15-17 - the reversion, and the trap REPRODUCED (RUN 2026-09-24, game 1.5.0)

Scripts `cdh-game-run15.js` / `run16.js` / `run17.js`, logs `run15-UI.log` / `run16-UI.log` / `run17-UI.log`. Three runs
because the first two answered method problems rather than the question.

| Run | What it settled |
| --- | --- |
| 15 | **No general claim reversion.** Nine plots bought at rings 4-7, each confirmed, all stayed ours for five turns - including two rings from a city-state and two from a rival major's city. The pen half was void: one ring plot belonged to a third player and the unit left through the gap |
| 16 | **Claim durability is distance from the OWNING CITY.** The pen was 8 rings out and the engine released all five plots at the turn roll, dissolving the cage in the same turn the unit moved - inconclusive again. Also: Independent Powers report `cities:0`, so `getCities()`-based centre protection is blind to villages |
| 17 | **TRAPPED-BY-US.** Pen at ring 6 around player 4's Scout, a major at PEACE: `enclosedTurns=5/5`, `movedWhileEnclosed=false`. The unit had moved every turn before and never moved again. The reporter's symptom, reproduced, caused by the mod |

Method notes, each earned by a wasted run:

- A fixture must survive a turn roll; build inside `flipMaxDistance` (6) or the engine takes the plots back.
- Independent Powers are hostile-by-default and walk through our borders, so they can never be the fixture for a
  trespass question. Only a major at peace can.
- `moves` / `reachable` read during OUR turn are always 0 for an AI unit. Movement between turns is the evidence.
- Run 17's per-turn site rescan was necessary: the first two turns offered only ring-8 sites.

## Run 14 - does the ENGINE bump the occupant when our claim lands? (RUN 2026-09-24, game 1.5.0)

Script `cdh-game-run14.js`, log `run14-UI.log`. Run 13 answered only the script surface; it never observed an ownership
change under a foreign unit, because its purchase never landed. This run refuses to conclude anything until the owner
reads as US, and retries candidates and turns until one lands. The mod's own pass is disabled so it cannot race the
harness for the plots.

| Read | Result |
| --- | --- |
| Claim landed | Plot 90,41 (unowned, an Independent's Slinger standing on it): `purchasePlot` from Glasgow, 0 gold after refund, **owner read as us within 2 s**, `owningCity` 262146 |
| Native bump within seconds | **No.** The Slinger stayed on the plot at +2 s, +5 s and +8 s |
| Was it trapped? | **No.** It walked off on its own turns: 88,42 then 89,40 then 89,41 |
| Mobility reads | Useless as written: `moves: 0, reachable: 0` on every turn, because the harness reads during OUR turn when the AI unit has already spent its movement. The movement between turns is the real evidence |
| Our claim a turn later | **`owner=3`.** The plot was player 3's from turn 137 on, with `diffusionEnabled = false`, so nothing of the mod's touched it. Run 13 hit the same on the same plot |

Consequences: trespass does not immobilise a unit that has somewhere to go, so an overrun plot resolves itself and the
reported Settler was enclosed rather than overrun. The eviction was removed from the mod. The claim reverting to player
3 is now the open question (`docs/BACKLOG.md`) and matters more to this mod than the eviction did.

## Run 1 - AugustusAnt136, game 1.4.2, 2026-09-12

Full log: `run1-antiquity-turn136-UI.log`.

| Test | Verdict |
| --- | --- |
| Our city's `purchasePlot` on an unowned tile beyond ring 3 | Works, no gold. Lands after the call: the same-tick read shows the old owner |
| Our city's `purchasePlot` on a rival tile touching our land | Works, no gold, lands after the call |
| A rival city's `purchasePlot` on that tile (cede back) | Works, lands after the call |
| `WorldBuilder.MapPlots.setOwnership(NO_PLAYER)` on a city-attached tile | Fails. Still ours at 3 seconds and 12 turns later |
| Settler `UNITOPERATION_FOUND_CITY`: unowned plot vs rival-owned neighbour, both four tiles from any settlement | Unowned: can found. Rival-owned: cannot ("no valid constructions for this location") |
| `CREATE_ELEMENT` improvement on a ring-4 claimed tile, and on a ring-2 control | Neither placed. Inconclusive, because the control failed too; redone in run 2 |
| `Game.age` | A numeric hash, not a string |
| The mod's own pass over 12 turns | Runs every turn, city strengths nonzero (London 84), no flips. London's centre stock reached 364 by turn 3, and ring 4 needs about 12,000 at the centre |

Consequences: the pass never recorded a real flip (fixed with `ui/cd-pending.js`), and every age read as Antiquity
(fixed in `ui/cd-polity.js`). Both are in the changelog.

## Run 2 - same save, fixed mod, 2026-09-12

Script `cdh-game-run2.js`, full log `run2-antiquity-turn136-UI.log`.

| Test | Verdict |
| --- | --- |
| R5 age hash | `GameInfo.Ages.lookup(Game.age).AgeType` resolved the hash to `AGE_ANTIQUITY` |
| R1 seeded stock, then the mod's own pass | Flip sent and recorded pending; tile ours within 5 seconds; next pass confirmed and booked it with a 15-turn lock; the neighbouring tile flipped organically and was confirmed a pass later |
| R2 release variants | All three still owned and attached at 10 seconds; the bought tile had no district to destroy |
| R3 pending citizen onto a far tile | Did not run: seeding and release purchases used up the main city's frontier tiles |
| R4 improvement create | Control worked (London's ring-1 camp destroyed and recreated); the far half did not run, for the same reason |

## Run 3 - same save, recede and debug on, 2026-09-12

Script `cdh-game-run3.js`, log `run3-antiquity-turn136-UI.log`, crash evidence `run3-crash-evidence.txt`.

| Test | Verdict |
| --- | --- |
| R3 pending citizen onto a ring-4 tile | Refused. The tile was not offered, and `sendRequest(EXPAND)` placed nothing; the control on an offered ring-1 plot placed a fishing boat |
| R4 improvement on ring-4 tiles | Refused four times (mine, woodcutter, two Potkop copies); the control recreated the Potkop on ring 3 |
| R7 the mod's own cession | Not tested: the rival was read as at war, and the seeded tile was inside Megiddo's ring 3 |
| Growth buffer, unplanned | Two neighbour tiles claimed and confirmed after the Potkop was recreated |
| 24 natural passes from an empty field | First organic claim on pass 18 (London, ring 4); nine flips sent by pass 24, two of them rival tiles |
| How it ended | Native crash about 30 seconds after Autoplay drove the Antiquity to Exploration transition at turn 160 |

## Run 5 - crash disproof, 2026-09-13

Scripts `cdh-shell-run5.js` and `cdh-game-run5.js`. The question: does playing AugustusAnt136 through the Antiquity
to Exploration transition crash with Cultural Diffusion enabled and no harness test actions? The Emigration session
already ran the same transition with the mod disabled and saw no crash. The planned start, run 3's turn-160 autosave, was
gone, because the game keeps only ten autosaves. A save written during Autoplay also resumes Autoplay when loaded. So
run 5 replays run 3's route from the hand-played turn-136 save. It ends turns exactly as run 3 did, with debug, recede
and the buffer on as in run 3. After the transition it only presses Begin and logs each loading-state change. It also
checks the Options rebuild fix against the real model: in the main menu before loading, and in-game after the crash
watch ends.

Result, log `run5-antiquity-to-exploration-UI.log`: no crash. The game crossed into Exploration at turn 160 and ran 194
seconds and 21 Exploration turns with no new crash report. The mod sent and confirmed 29 flips across both ages. The
in-game Options check passed: the options vanished on `reInitOptions()` and came back on the next init. The main-menu
check never ran, because the save began loading before its eight-second timer fired.

`cdh-game-run4.js` is written but has not run. It tests a tile re-parent between two of our cities, and the mod's own
cession against a rival at peace. Two cautions for any rerun on AugustusAnt136:
- Keep `TURNS` short. Its Antiquity age ends around turn 160, and run 3 crashed right after that transition.
- Drive turns one at a time: `Autoplay.setTurns(1)` per turn, or `GameContext.sendTurnComplete()`. A single multi-turn
  `Autoplay.setTurns(N)` never hands control back between turns, so the local player's `PlayerTurnActivated` does not
  fire and the mod's pass does not run at all. The Emigration session saw zero passes in 80 turns that way. One-turn
  Autoplay fired the event and ran the pass every turn in run 5, including after the age transition.
- An age transition reloads every game-scope UI script, so the game script attaches again in the new age and re-runs
  its first-turn actions from scratch. In run 3 that re-run overlapped the crash window, which makes it a suspect.
  Guard any future script against a second run, for example with a flag in `Configuration`, before crossing an age.
- Launch through Steam with `open "steam://rungameid/1295660"`. A direct launch a few seconds after a `pkill` stalled
  on "Steam wants us to restart".

## Run 6 - the shipped build on an existing save, 2026-09-13

Scripts `cdh-shell-run5.js` and `cdh-game-run6.js`, with the exact `dist/` build enabled and no `AffectsSavedGames`
override. The question: does the mod run inside a save that was made without it? Result, log
`run6-shipped-build-existing-save-UI.log`: no. The Modding log's mod list for the load held only the harness, and the
mod never booted. A save keeps the mod list it was started with.

## Run 7 - run 3's tests on the current build, 2026-09-13

Script `cdh-game-run7.js`: run 3's R3, R4 and R7 tests, then 25 turns that each log a `WAR` line comparing the engine's
`isAtWarWith` with the mod's `atWar`. Result, log `run7-run3-tests-current-build-UI.log`:
- The war check never disagreed with the engine. Player 3 was at war on turn 136 and at peace from turn 137.
- The game crashed during the Exploration startup, as run 3 did (`run7-crash-evidence.txt`). Run 5 took the same
  route without the tests and did not crash, so the tests' script-only engine writes are implicated. The shipped mod
  makes none of those writes.

## Run 8 - a new game at shipped defaults, 2026-09-13

Scripts `cdh-shell-run8.js` and `cdh-game-run8.js`. The shell script starts a new single-player game the way Play Now
does: `Configuration.editGame().reset(GameModeTypes.SINGLEPLAYER)`, then `engine.call("startGame")`. The turn-1 save
AugustusAnt1 could not stand in, because it needs an uninstalled dev mod. The game script logs every settlement founded,
the mod's claims, and a summary every ten turns, then switches the pressure lens on after 70 turns.

Result, log `run8-new-game-pacing-UI.log`: no claims in 70 turns. The harness only ends turns, so our civilization kept
one city at Culture 8, and the nearest rival major settled 14 tiles away. The lens became active with its layer on.
Screenshots from `screencapture -x` catch whatever window is in front. Capture the game window by id instead:
`screencapture -x -o -l <id>`. `swift cdh-winid.swift` prints the id: the game's layer-0 window taller than 600
pixels in `CGWindowListCopyWindowInfo`.

## Runs 9 and 10 - the pressure lens, 2026-09-13

Scripts `cdh-game-run9.js` and `cdh-game-run10.js`, both on AugustusAnt136 via `cdh-shell-run5.js`. Run 9 ends 12
turns, centres the camera on our largest city, and switches the lens on. Run 10 ends turns until the lens's own
contested-tile list, rebuilt with the lens's imports, holds four tiles. Then it logs the readout for the top tiles and
shoots with the lens off and on.

Results, logs `run9-lens-no-contested-tiles-UI.log` and `run10-lens-popup-covered-UI.log`:
- Switching the lens hides the yield icons and shows the hex grid. A background window capture lags: 8 seconds after
  the switch it still showed the old view. Wait about 20 seconds before shooting.
- Run 9 had nothing to paint. Run 10 reached five contested tiles on turn 151, and the readout named the civilizations
  correctly.
- `Camera.lookAtPlot(tile)` centres the tile, and a queued Civic Unlocked popup covers the screen centre, so the tile
  was hidden. The second `lookAtPlot` with `{ zoom: 0.3 }` did not visibly zoom.
- Two of the five tiles were led by an AI on unowned land. The lens shades them, but the pass never flips them.

## Run 11 - the lens paints, 2026-09-13

Script `cdh-game-run11.js`: run 10, plus closing queued tech and civic popups with
`TechCivicPopupManager.closePopup()` (five were queued), aiming the camera four columns east of the target tile, and
shooting 20 and 30 seconds after switching the lens on. Result, log `run11-lens-paints-UI.log` and image
`run11-lens-off-vs-on.png`: both background captures still matched the lens-off view pixel for pixel. The "age will
soon end" popup also appeared, and closing tech popups does not clear it. With the game brought to the front
(`osascript -e 'tell application id "com.2k.civ7" to activate'`), the view redrew within 6 seconds. The Hawaiian-owned
tile 89,35, which British culture led at 25%, was filled in faint British purple. The game does not redraw while its
window is hidden, so bring it to the front before any capture, then give the editor focus back.

## Run 12 - the mod's own cession, and the lens gate, 2026-09-18

Scripts `cdh-shell-run5.js` and `cdh-game-run12.js`, with recede and debug on. The script calls the shipped lens's
`pressureTiles()` and the readout's `resolve()` through their `__test` exports, so the check runs the real code rather
than a rebuilt copy. Log `run12-cede-and-lens-UI.log`.

| Test | Verdict |
| --- | --- |
| R9: run 4's cession against a rival at peace | Works. On turn 137 (player 3 at peace from then, at war on 136) the harness bought 83,18, beyond ring 3 of Lāhainā and two tiles from Hilo, and seeded our claim with a dominant rival stock. The next pass's recede step sent the cession, the tile was owned by Hilo one turn later, and the pass after cleared the claim and set the 15-turn lock |
| Lens after seeding | The seeded rival-led claim was painted, and its readout showed a progress row |
| Lens over four turns | Seven AI-led tiles, unowned or ours but never claimed by the mod, met the 1.1.0 rule. None was painted and none showed a progress row. Nothing painted failed `passCanAct` |

No mod errors in `UI.log` and no crash report. The game never approached the turn-160 age change.

