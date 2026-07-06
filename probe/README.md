# Cultural Diffusion Probe

A standalone, single-player feasibility probe for the **Cultural Diffusion** mod
(see `../docs/cultural-diffusion-spec.md`). It confirms - in-game, against the real
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

**No dev console and no log-reading required.** The probe paints its results into an
on-screen panel (top-right) inside the game. Once installed and enabled, it runs the
whole sequence automatically:

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
4. The panel then tells you to **SAVE the game, then LOAD that save** (or quit to menu
   and reload). On that next session the probe automatically re-checks that the flips
   kept their owner (Q-PERSIST) **and** re-runs the integration read on screen.

Everything the panel shows is also written to `UI.log` (tagged `[Civ7Probe]`) if you
ever want the raw data, but you never need to open it.

The probe self-throttles via a persisted phase, so it flips exactly once and never
spams the map. To run it again from scratch, disable/re-enable or call
`cd_probe.reset()` if you do have a console.

### Optional console commands (only if your build exposes the console)

`cd_probe.auto()`, `cd_probe.diag()`, `cd_probe.integrate()`, `cd_probe.candidates()`,
`cd_probe.flipSet()`, `cd_probe.flipBuy()`, `cd_probe.flipSetRival()`,
`cd_probe.unclaim(loc)`, `cd_probe.reset()`. Nothing depends on these - they mirror
what auto-run does.

### Testing the rival "contest" flip

The automatic path only flips **empty** frontier land (fully reversible). To also
test taking a tile from an AI, set `AUTO.FLIP_RIVAL = true` at the top of
`ui/cd-probe-runner.js` and reinstall; start a fresh game afterward to discard the
change.


## Reading the output

All output goes to `~/Library/Application Support/Civilization VII/Logs/UI.log`,
tagged `[Civ7Probe]`, in the same fenced/base64 section format as `persist-probe`,
so the modding-probe `scripts/extract_dump.js` parses it directly. Key sections:

- `cd_diagnostics` - API presence, frontier candidates, and `persistCheck`.
- `cd_flip` - a single flip test: `before`, `after`, and `Q_FLIP_ownerChanged`.
- `cd_integration` - per-flip integration rows (`owningCityReal`, `inCityPlots`,
  `buildableHere`, `verdict`) plus a `rollup.setOwnership` summary. The plain-text
  `Q-INTEGRATE` / `Q-CODEX-ENABLEMENT` lines carry the same verdict without decoding.

The single line that answers the Han-codex question:

```
grep -E "Q-CODEX-ENABLEMENT|Q-INTEGRATE" UI.log
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

Feed the results into the decision matrix in
`../docs/cultural-diffusion-spec.md` 8 to choose the flip verb and confirm the mod
is buildable before writing the runtime.
