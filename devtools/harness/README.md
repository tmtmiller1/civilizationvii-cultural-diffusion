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
