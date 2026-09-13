# Cultural Diffusion Probe

A standalone, single-player feasibility probe for the **Cultural Diffusion** mod
(see `../docs/current-model.md` and `../docs/probe-history.md`). It confirms - in-game, against the real
map - whether a mod can flip tile ownership, whether a flipped tile is integrated
(worked / yields) or cosmetic, whether a flip survives save/reload, and whether we
can claim plots the city could not claim through normal growth.

## The questions it answers

| ID | Question | How the probe tests it |
| --- | --- | --- |
| **Q-FLIP** | Does `WorldBuilder.MapPlots.setOwnership` actually reassign a plot + redraw borders? | `cd_probe.flipSet()` snapshots owner before/after and logs the engine's own `PlotOwnershipChanged` event. |
| **Q-YIELD** | Is a flipped tile integrated or a cosmetic repaint? | Compares `plotSnapshot` (owner, owning city, district, resource) before/after, and offers `cd_probe.flipBuy()` (city.purchasePlot, the integrated path) to contrast. |
| **Q-INTEGRATE / Q-CODEX** | Is a **bare `setOwnership`** tile REAL, buildable city land - or an inert **orphan** (owner set, no owning city)? i.e. can the Han build a science building on diffused land and Shi-Dafu-**codex** it? | After the flips settle, for each flipped tile it reads `getOwningCityFromXY` (real city vs `-1`), `city.getPurchasedPlots()` membership, and whether `Game.CityOperations.canStart(BUILD, Library/Academy/Monument)` lists the tile as a valid placement plot. Verdict per tile: **INTEGRATED** (Han-codex path CONFIRMED) vs **ORPHAN** (empty-tile codex REFUTED). Runs hands-off (`cd_probe.integrate()` to re-run). |
| **Q-PERSIST** | Does a flip survive save -> reload? | Records each flip to `localStorage` (never GameConfiguration), then re-reads the plot's current owner on the next `LoadComplete` / `cd_probe.diag()`. |
| **Q-BEYOND-CAP** | Can we claim a plot the city could NOT claim via normal growth? | `cd_probe.expandCount()` shows how few plots native `EXPAND` offers; a successful `flipSet()` outside that set proves diffusion escapes the cap. |
| **Q-WORK** | Can a **beyond-ring-3 owned** tile be **worked / settled** (the "usable outer tiles" request, `../docs/potential-future-features.md` §3)? | For each far claimed tile it reads (READ-ONLY, no mutation) `Game.PlayerOperations.canStart(ASSIGN_WORKER, {Location, Amount:1})`, the owning city's `canStart(EXPAND).Plots`, `city.Workers.GetTilePlacementInfo(idx).IsBlocked`, and `GameplayMap.getYieldsWithCity(x,y,cityID)`. **3-state verdict** with a **near (ring 1-2) control** and **per-verb pairing** (see step 4 below): **WORKABLE via [verb]** / **BLOCKED** (range) / **INCONCLUSIVE** (no worker pending). Re-run: `cd_probe.work()`. |
| **Q-WORK-MUTATE / -PERSIST** (E) | Does an actually-placed worker / rural district **survive save→reload**? | With `AUTO.WORK_MUTATE=true`, it places a worker + `DISTRICT_RURAL` on each far owned tile (recording `NumWorkers`/cap before/after — the **(C)** worker-cap-consumption read), stores a marker, and on the next session re-reads the tile: `Q-WORK-PERSIST … workedStateSurvived=`. Destructive → throwaway save. Re-run: `cd_probe.workMutate()`. |
| **Q-CAPTURE** (D) | When you culturally take a **developed** rival tile, does the improvement **transfer** (you inherit the yields) or get **stripped** to bare land? | It prefers a rival tile that already has a district, records its `constructibleCount`/`districtOwner` at flip time, then reads them after: verdict **TRANSFERRED** / **STRIPPED** / **NOT-CAPTURED** / **N/A-bare**. Re-run: `cd_probe.capture()`. |
| **Q-FOUND** (1a-found) | Can the owner **found a new settlement** on an owned outer tile? | Opportunistic — VII has **no settler-free settle check**, so it needs a settler unit. It reads the settler's legal `UNITOPERATION_FOUND_CITY` plots and reports whether any owned outer tile is **FOUNDABLE**. Not-foundable near your own cities is expected (base min-city-range). Move a settler beside an isolated claimed tile and run `cd_probe.found()`. |
| **Q-SWAP** (1b) | Can a tile be **transferred between your own cities** (the Civ VI "swap", which VII has no UI for)? | With `AUTO.WORK_MUTATE=true`, it re-parents a near owned tile to a *second* city via `city.purchasePlot`, reads (deferred, async) whether the owning city changed **A→B**, then restores it: **TRANSFERRED** (swap buildable) vs **BLOCKED**. Re-run: `cd_probe.swap()`. *(Likely moot: 1.4.1 added a base-game "change which city works a tile" option.)* |
| **Q-DEEP** | Can we flip a rival tile **INSIDE their 3-ring** (their worked footprint), not just their frontier? | Classifies every rival candidate by `ringDepth` = distance to *its owner's* city center (1 = core, ≤3 = inside their worked ring), flips the most *interior* one (`AUTO.FLIP_RIVAL`), and reports whether it **held** and whether the rival's improvement survived: `★ DEEP-FLIP: … YES/NO`. `setOwnership` has no ring restriction, so the open question is really the side-effects on the rival city. |
| **Q-VERB** (Phase 0) | **Which flip verb should the mod use?** `setOwnership` is retired (orphans / fails on rival); `purchasePlot` works but spends gold. Is there a **free + integrated** verb? | For a **distinct** tile per candidate verb (`Growth.claimPlot`, `CREATE_ELEMENT DISTRICT_RURAL`), across near / far / rival kinds, it reads the player's gold **synchronously around the call** (a cost is deducted at call time) and, deferred, whether the tile **integrated** (owner=me, real owning city, `inCityPlots` / rural district). Verdict per verb: **FREE-INTEGRATED / COSTS-GOLD / FAILS**, rolled up to a **decision** (probe-history.md §2): claimPlot free → adopt it; else rural free → adopt it; else `purchasePlot` + gold cap. `Q-VERB-PERSIST` re-reads across save/reload. Pinned headline: `★ VERB: … => verb = …`. This **mutates** (claims tiles) — gated by `AUTO.VERB_PROBE` (on by default; targets are reversible frontier land or a throwaway-save rival tile). |
| **Q-RECEDE** | Do the mod's opt-in **borders recede** verbs work? (a) Can a **rival** city's `purchasePlot` take a tile **we** own beyond ring 3 (cede)? (b) Does `setOwnership(NO_PLAYER)` release an **integrated** tile of ours (release)? | One-shot per session, once we own a beyond-ring-3 tile and a rival major city exists. It picks the far tile touching that rival's land (else nearest its city), buys it with the rival's city (refunding the rival's gold), releases a second far tile, and reads each owner **inline** (what `recedeOwnership` checks the same tick) and again ~2.5s later. Verdicts: **CEDE-WORKS / CEDE-FAILS** and **RELEASE-WORKS / RELEASE-FAILS**; `Q-RECEDE-ROLLUP` also flags a verb that works but only after the inline read (the pass would then book nothing). Both tiles are bought back with our own refunded `purchasePlot` (`Q-RECEDE-RESTORE`). Gated by `AUTO.RECEDE_PROBE`. Re-run: `cd_probe.recede()`. |

> **Why Q-INTEGRATE was added.** The original run left the spec's Q-YIELD caveat open:
> its `setOwnership` and `purchasePlot` flips could land on the *same* plot in one tick
> (writes are async), so it couldn't isolate whether *bare* `setOwnership` integrates a
> tile. This build assigns **distinct** plots per verb and reads each in isolation,
> which both closes Q-YIELD and answers the Han-codex report directly.
>
> **What Q-INTEGRATE proves vs. can't.** It proves, from read APIs, whether a diffused
> tile is real buildable city land (**mechanism A**: build a science building there, then
> Shi-codex it) and whether `getOwner` still reads as you (**the combat-buff carryover**:
> `REQUIREMENT_PLOT_IS_OWNER` "friendly territory" bonuses). It does **not** spawn a Shi
> Dafu, so it can't directly fire the codex action - if a tile reads **ORPHAN** yet the
> report still reproduces, the only remaining path is empire-scoped action requirements
> (**mechanism B**), which needs an in-game Shi to confirm.

## Install & run (macOS, no command line)

**Install by dragging the folder — no terminal, no SDK.**

1. In Finder, choose **Go → Go to Folder…** (⇧⌘G) and paste:
   `~/Library/Application Support/Civilization VII/Mods`
2. Drag this **`probe`** folder into that Mods folder (the game reads the `.modinfo`
   inside it; the folder name doesn't matter). If you're replacing an older copy,
   delete the old one first, then **fully quit and relaunch the game** so it reloads.

**No buttons, no console, no log-reading.** The on-screen panel (top-right) is
**display-only** (`pointer-events:none`) — there is nothing to click, deliberately, because
Gameface click handling on injected DOM is unreliable (past probe "buttons" broke that way).
Every test fires from **engine events** (`PlayerTurnActivated` / `LoadComplete`) — the same
mechanism the original flip probe used — and the read-only stages (work / capture / found)
**re-run every turn** so the verdicts stay live and Q-FOUND catches the turn a settler sits
next to an outer tile. The `cd_probe.*()` calls are a fallback for anyone who *does* have a
console; you don't need them. Destructive stages are behind the `AUTO.WORK_MUTATE` /
`AUTO.FLIP_RIVAL` code flags you flip before installing.

Once installed and enabled, it runs the whole sequence automatically:

1. Enable **Cultural Diffusion Probe** in Add-Ons and load a **single-player** game.
2. Play a turn or two. The probe emits read-only diagnostics, then - as soon as
   frontier plots are available - automatically performs the flip tests **once** on
   **distinct** tiles (an unowned tile via `setOwnership`, a *separate* one via
   `city.purchasePlot`, plus beyond-ring-3 variants). Watch a border tile change owner;
   that is Q-FLIP happening live.
3. ~5s later (once the async ownership writes settle) it auto-runs the **Q-INTEGRATE /
   Q-CODEX** read. The on-screen panel pins a headline verdict:
   **`★ CODEX: setOwnership => INTEGRATED …`** (or `ORPHAN`), with a per-tile breakdown
   below it. That headline is the answer to the Han-codex report — read it right off the
   screen, no console, no manual step.
4. Immediately after the integration read it also runs the **Q-WORK** read and pins a
   second headline: **`★ OUTER-TILES: …`** with a **3-state** verdict:
   - **WORKABLE via [verb]** — a city can work/settle the culturally-claimed outer ring
     (feature 1c is buildable). The `[verb]` says *which* claim path worked
     (`setOwnership` vs `purchasePlot`) — if only `purchasePlot`, the outer-ring flip verb
     must switch to it.
   - **BLOCKED** — a **near** control tile (ring 1-2) is workable but the far tile is not,
     so the engine genuinely refuses to work past ring 3; 1c is not achievable.
   - **INCONCLUSIVE** — the near control was *also* blocked, which means no worker/pop was
     pending (nothing to do with range). Grow a pop and re-run `cd_probe.work()`.

   The near control matters: `canStart(ASSIGN_WORKER)` is false both when the tile is
   out-of-range **and** when you simply have no worker to place, so the probe only trusts a
   BLOCKED result when the near tile proves a worker *was* placeable. Per-tile `Q-WORK`
   rows (tagged `far` / `NEAR-control`) show `canAssignWorker`, `inExpandSet`, `isBlocked`,
   `yield`, and `rural` below it.

   Two more headlines pin alongside it: **`★ CAPTURE: rival developed tiles => …`**
   (TRANSFERRED = you inherit a captured rival tile's improvement, STRIPPED = it reverts to
   bare land — answers ask **2**), and **`★ FOUND-OUTER: …`** (whether a settler can found
   on a claimed outer tile — needs a settler nearby; see Q-FOUND).
5. The panel then tells you to **SAVE the game, then LOAD that save** (or quit to menu
   and reload). On that next session the probe automatically re-checks that the flips
   kept their owner (Q-PERSIST) **and** re-runs the integration + Q-WORK reads on screen.

Everything the panel shows is also written to `UI.log` (tagged `[Civ7Probe]`) if you
ever want the raw data, but you never need to open it.

The probe self-throttles via a persisted phase, so it flips exactly once and never
spams the map. To run it again from scratch, disable/re-enable or call
`cd_probe.reset()` if you do have a console.

### Optional console commands (only if your build exposes the console)

`cd_probe.auto()`, `cd_probe.diag()`, `cd_probe.integrate()`, `cd_probe.verb()`,
`cd_probe.verbRead()`, `cd_probe.work()`,
`cd_probe.workMutate()`, `cd_probe.capture()`, `cd_probe.found()`, `cd_probe.swap()`,
`cd_probe.candidates()`, `cd_probe.flipSet()`, `cd_probe.flipBuy()`,
`cd_probe.flipSetRival()`, `cd_probe.unclaim(loc)`, `cd_probe.reset()`. Nothing depends
on these - they mirror what auto-run does.

### Testing the rival "contest" flip

The automatic path only flips **empty** frontier land (fully reversible). To also
test taking a tile from an AI, set `AUTO.FLIP_RIVAL = true` at the top of
`ui/cd-probe-runner.js` and reinstall; start a fresh game afterward to discard the
change.

### Confirming the outer-tile work (destructive)

Q-WORK is **read-only by default** — `canStart(...)` answers "would the engine work this
far tile?" without touching the map, which is enough for the WORKABLE/BLOCKED verdict.
To *prove* it by actually placing a worker + a `DISTRICT_RURAL` on a beyond-ring-3 owned
tile (and re-reading `IsBlocked`/yields/constructibles), set `AUTO.WORK_MUTATE = true` at
the top of `ui/cd-probe-runner.js` and reinstall; use a throwaway save.


## Reading the output

All output goes to `~/Library/Application Support/Civilization VII/Logs/UI.log`,
tagged `[Civ7Probe]`, in the same fenced/base64 section format as `persist-probe`,
so the modding-probe `scripts/extract_dump.js` parses it directly. Key sections:

- `cd_diagnostics` - API presence, frontier candidates, and `persistCheck`.
- `cd_flip` - a single flip test: `before`, `after`, and `Q_FLIP_ownerChanged`.
- `cd_integration` - per-flip integration rows (`owningCityReal`, `inCityPlots`,
  `buildableHere`, `verdict`) plus a `rollup.setOwnership` summary. The plain-text
  `Q-INTEGRATE` / `Q-CODEX-ENABLEMENT` lines carry the same verdict without decoding.
- `cd_verb` / `cd_verb_read` (Phase 0) - per-verb/per-tile rows (`ownerIsMe`,
  `owningCityReal`, `inCityPlots`, `rural`, `goldSpent`, `verdict`) plus a `perVerb` rollup
  and the resolved `decision`. Plain-text `Q-VERB` / `Q-VERB-ROLLUP` carry the
  FREE-INTEGRATED/COSTS-GOLD/FAILS verdict + verb decision; `Q-VERB-PERSIST` the
  reload-survival re-read.
- `cd_work` - per-far-tile work rows (`canAssignWorker`, `inExpandSet`, `isBlocked`,
  `yieldTotal`, `ruralDistrictCount`, `workerCap`/`numWorkers`, `verdict`) plus a
  verb-paired `rollup`. Plain-text `Q-WORK` / `Q-WORK-ROLLUP` carry the
  WORKABLE/BLOCKED/INCONCLUSIVE verdict; `Q-WORK-MUTATE` / `Q-WORK-PERSIST` the
  destructive-confirm + reload-survival.
- `cd_capture` - per-rival-flip rows (`developedBefore`, `consBefore`/`consNow`,
  `verdict`). Plain-text `Q-CAPTURE` / `Q-CAPTURE-ROLLUP` = TRANSFERRED vs STRIPPED.
- `cd_found` - settler legal-found-plot count + per-far-tile `foundable`. Plain-text
  `Q-FOUND` / `Q-FOUND-ROLLUP`.
- `cd_swap` - the inter-city re-parent test (`from`/`to`/`before`/`mid`/`moved`).
  Plain-text `Q-SWAP-CONFIRM` = TRANSFERRED vs BLOCKED.

The single line that answers the Han-codex question:

```
grep -E "Q-CODEX-ENABLEMENT|Q-INTEGRATE" UI.log
```

The single line that answers the **Phase 0 flip-verb** decision:

```
grep -E "Q-VERB-ROLLUP" UI.log
```

## Safety

- **Single-player only.** Every mutating call is guarded by the same
  `Configuration.getGame().isAnyMultiplayer` check the base UI uses.
- **Read-only by default.** Only the console commands (`flipSet`/`flipBuy`/...)
  change the map. Auto diagnostics never mutate.
- **Never writes GameConfiguration.** Per the repo crash gotcha, runtime
  `Configuration.editGame().setValue` poisons the save; the probe's bookkeeping
  uses `localStorage` only. Actual tile ownership is the engine's own state.
- **Reversible.** `unclaim(loc)` returns a test plot to nobody.

## Decision

Feed the results into the decision record in
`../docs/probe-history.md` §4 to choose the flip verb and confirm the mod
is buildable before writing the runtime.
