# Cultural Diffusion — Reference & Conventions

Build-time reference and house conventions that support both the shipped model ([`current-model.md`](current-model.md))
and the outstanding phases ([`potential-future-features.md`](potential-future-features.md)). Items marked
**(probe-gated)** are unknowns [`probe-history.md`](probe-history.md) resolves — do not fabricate them in code before
then.

---

## 1. House rules & guardrails

- **Single-player only.** `setOwnership`/`WorldBuilder` + local-player-turn model almost certainly excludes MP. Guard
  every mutation with `guardSP()` (`Configuration.getGame().isAnyMultiplayer`). (Note: `runPass` itself has no MP check
  — MP safety comes from the verbs' `guardSP()`; a MP pass still simulates the field and writes state each turn, but no
  ownership changes.)
- **`GameConfiguration` writes — an unresolved conflict, recorded honestly.** An older note (still carried in
  `probe/ui/cd-probe-store.js`) says a runtime `Configuration.editGame().setValue` corrupts the persisted config and
  crashes the next launch. The shipped mod does exactly that every pass (`cd-state.js` `saveState`), as do nine
  Emigration modules, and no such crash is recorded against either. No repro of the crash claim exists in this repo, so
  treat it as unverified: the probe stays on `localStorage`, and the pass logs the blob size (`state bytes=`) so growth
  is visible.
- **Async ownership writes.** The immediate read is unreliable; detect success on a **deferred** re-read (next pass, or
  `~2s` in the probe), never inline. Every mutation is wrapped in `guardSP()` and a `safe()` try/catch. Watched again on
  1.4.2 (harness run 1): the pass had been reading inline and booked nothing; it now records pending verbs and confirms
  them next pass (`ui/cd-pending.js`).
- **`Game.age` is a numeric hash.** Resolve it with `GameInfo.Ages.lookup(Game.age).AgeType`; never string-match the
  raw value (`currentAgeType` in `ui/cd-polity.js`).
- **Probe before ship.** Nothing ships without an in-game probe / verification pass.
- **Conservative defaults.** Anything that changes territory is opt-in (default OFF) and reversible.
- **AI fairness / fog.** Foreign plot writes may be fog-limited; default scope = flips involving the local player.
  AI-vs-AI diffusion is a later opt-in.
- **Performance.** Frontier enumeration is O(border plots), throttled to a bounded pass; memoize per-pass
  distance/pressure reads. Core-protection radius sets can be hot on large late-game maps — memoize per pass if
  profiling shows cost (see [`BACKLOG.md`](BACKLOG.md)).

---

## 2. Reuse map (emigration → cultural_diffusion)

The module split mirrors emigration so the shared machinery ports directly:

| Emigration | Reused for |
| --- | --- |
| `emigration-events.js` `getOwningCityFromXY` | `cd-plots.js` owner reads |
| pull/permeability distance falloff | `cd-pressure.js` `distanceFalloff` |
| `emigration-borders.js` / `-war.js` | `cd-borders.js` war/contest resistance |
| `emigration-polity.js` celebration/happiness reads | `cd-polity.js` |
| ethnicity `composition`/`diaspora`/`originCiv` | `cd-ethnicity.js` ethnic-affinity term |
| prosperity model + prosperity lens | `cd-pressure.js` prosperity dim; **and the lens template for the pressure lens** (`emigration-prosperity-lens.js` + `emigration-lens-hover-panel.js`) |
| `{v,data}` persistence envelope + sanitizer | `cd-state.js` |
| tunables spec + Options screen | `cd-config.js` / `cd-options.js` |
| throttled toasts | `cd-notifications.js` |

---

## 3. Verb call reference (exact shapes + success detection)

All ownership writes are **asynchronous** — verify on a deferred re-read, never inline.

| Verb | Exact call | Success signal | Cost |
| --- | --- | --- | --- |
| `purchasePlot` (**primary, shipped**) | `Cities.get(cityId).purchasePlot({x,y})` | `getOwningCityFromXY(x,y).id === cityId` **and** `city.getPurchasedPlots().includes(idx)` | gold — **refunded same tick** (`flipViaPurchasePlotRefunded`, net-zero) |
| `Growth.claimPlot` | `city.Growth.claimPlot({x,y})` | same owning-city check | (probe-gated) free? |
| `DISTRICT_RURAL` | `Game.PlayerOperations.sendRequest(0, "CREATE_ELEMENT", {Kind:"DISTRICT", Type:"DISTRICT_RURAL", Location:{x,y}, Owner:playerId, Parent:cityComponentId})` | `MapConstructibles.getConstructibles(x,y)` shows a rural district owned by us | (probe-gated) free? |
| `setOwnership` (**retired → `unclaim` only**) | `WorldBuilder.MapPlots.setOwnership(playerId \| NO_PLAYER, {x,y})` | owner read only (proven to **orphan** / fail on rival) | none |
| assign worker (Phase 2) | `Game.PlayerOperations.canStart/sendRequest(pid, PlayerOperationTypes.ASSIGN_WORKER, {Location: plotIndex, Amount:1})` | `canStart(...).Success`; then `Workers.GetTilePlacementInfo(idx).IsBlocked === false` | population/worker |

- **Plot index:** `plotIndex = GameplayMap.getIndexFromLocation({x,y})` — worker ops use `Location: plotIndex`; city ops
  use `{X,Y}` coords. Do not mix the two shapes.
- **Gold read:** `Players.get(pid).Treasury` (balance before/after a `purchasePlot`).
- **Yield / worked reads (Phase 2):** `GameplayMap.getYieldsWithCity(x,y,cityId)` is a *hypothetical* if-worked value —
  informational only, **never** a workability signal. The authoritative "is it workable" signal is
  `canStart(ASSIGN_WORKER).Success` / `GetTilePlacementInfo(idx).IsBlocked`.

### Outer-ring native primitives (probe-gated, Phase 2)

The workable/expandable set is native C++ handed to JS as an opaque list — **no JS/DB constant for the work-range, no
override setter**. A mod can only invoke primitives and observe whether native accepts a far tile. Candidates ranked by
promise for a *worked* outer tile: `ASSIGN_WORKER` (worker op) → `CREATE_ELEMENT DISTRICT_RURAL` →
`Growth.claimPlot`/`purchasePlot` (city-scoped attach) → `EXPAND` (adjacency-gated, one ring). Read-only tri-state
checks: worldbuilder schema `PlotOwners(Owner, CityOwner, CityWorking)` / `PlayerWorkers(PlayerID, PlotID, Placed)`;
runtime `getOwner` / `getOwningCityFromXY` / `GetTilePlacementInfo(idx).IsBlocked` / `GetAllPlacementInfo()` /
`MapConstructibles.getConstructibles(x,y)` / `getYieldsWithCity`.

---

## 4. State schema & migration (`cd-state.js`)

Current envelope (shipped): `{ v:2, data:{ field, claims, locked, monoTurn } }` — `field["x,y"]` is `Record<civId,
number>` culture stock; `claims` the soft-halo tiles; `locked` the anti-flicker cooldown. Persisted (survives
save/reload) via `cd-state`'s own store, sanitized on load.

**Planned v2 → v3** (Phases 2 & 4) — add two maps; `prepareState`/sanitizer initializes any missing key to `{}` so v2
saves load unchanged (no destructive migration, no `GameConfiguration`):

```
data.occupation = { "x,y": { by: playerId, turns: n, sinceTurn: monoTurn } }  // Phase 4 buffer
data.promoted   = { "x,y": monoTurn }                                          // Phase 2 (don't re-promote)
```

`pruneState` must also prune `occupation` (tile no longer occupied) and `promoted` (tile no longer ours). Version guard:
on load, `v < 3` → add the empty maps, set `v:3`.

---

## 5. Per-file change map (outstanding phases)

| File | Function | Change | Phase |
| --- | --- | --- | --- |
| `cd-pass.js` | *new* `promoteWorkedTiles(state)` | after `resolveOwnership`, promote stable owned tiles (past `locked`, within caps) to worked; record in `promoted` | 2 |
| `cd-pass.js` | *new* `conquestSweep(state)` | last stage: increment/reset `occupation`, flip at `conquestBufferTurns` | 4 |
| `cd-state.js` | schema + `prepareState`/`pruneState` | v3 maps (§4) | 2,4 |
| `cd-plots.js` | *new* `unitsAt(loc)` / `militaryOccupantAt(loc, me)` | units-on-tile read | 4 |
| `cd-config.js` | `CONFIG` + `PRESETS` | `workOuterTiles`; `conquestFlip`; `conquestBufferTurns` | 2,4 |
| `cd-settings.js` | getters/setters + `applyTunableOverrides` | persist + apply the new keys | 2,4 |
| `cd-options.js` | register* | work-outer + conquest toggles | 2,4 |
| *new* UIScript | pressure lens + hover panel | HUD lens reading `state.field` (own `<UIScripts>` entry) | 1 (lens) |
| `text/*/ModText.xml` | — | LOC keys (§7) | 1,2,4 |

---

## 6. Test & acceptance plan (Node harnesses, per phase)

Pure logic is unit-tested in Node (no engine); engine behaviour is probe / in-game verified. **No metric masking** —
every new branch gets a real assertion; keep the mutation bar.

- **Phase 2:** `tests/promote.mjs` — a tile promotes only when owned + past `locked` + under `maxDiffusionPlots` +
  promotion cap; `promoted` prevents re-promotion; workability uses the authoritative signal (mock), never
  `getYieldsWithCity`.
- **Phase 4:** `tests/conquest.mjs` — counter increments on continuous hold, **resets on vacate**, flips exactly at
  `conquestBufferTurns`, respects the toggle, scales with game-speed factor.
- **State:** `tests/state.mjs` — v2→v3 migration adds empty maps, v2 blobs load, prune drops stale
  `occupation`/`promoted`.
- **Acceptance (in-game, `verify`/probe):** each phase's "Verify" bullet, on a mid-game map bordering an AI, surviving
  save/reload.

*(Test-harness gaps still open — `cd-bootstrap` event-wiring coverage, buffer-path state assertions — are tracked in
[`BACKLOG.md`](BACKLOG.md).)*

---

## 7. Localization keys to add (`text/*/ModText.xml`)

- **Phase 1 (lens):** `LOC_OPTIONS_CD_LENS(+_DESCRIPTION)`; lens panel labels.
- **Phase 2:** `LOC_OPTIONS_CD_WORK_OUTER(+_DESCRIPTION)`.
- **Phase 4:** `LOC_OPTIONS_CD_CONQUEST(+_DESCRIPTION)`, `LOC_OPTIONS_CD_CONQUEST_BUFFER(+_DESCRIPTION)`, buffer items
  `LOC_OPTIONS_CD_BUFFER_3/4/5/IMMEDIATE`.

All mod-prefixed; ship all 11 locales (or English + fallback) per the mod's existing convention.

---

## 8. Edge cases, guards & invariants

- **Never mutate** in multiplayer (`guardSP()`), when `!diffusionEnabled`, or with no local cities. Once-per-turn,
  idempotent (the phase machine).
- **Never target:** water (`isWater`), a city-center / district plot (city capture is Phase 5, not a tile flip), the
  local player's own tiles (invisible to the scan by design).
- **Cultural flips** honor: `claimOnlyUnowned`, `atWar` (no peaceful diffusion across a front), `coreProtectRadius`,
  `requireAdjacency`, `flipCooldownTurns` lock, `maxDiffusionPlots` per-city cap, `maxFlipsPerTurn`.
- **Conquest flips** (Phase 4) intentionally **bypass** the peaceful gates (war is the point) but still exclude
  city-center/district plots and require continuous occupation; precedence over the `locked` map — conquest wins.
- **Affordability:** the shipped refund makes `purchasePlot` net-zero; if a future path spends real gold, never spend
  below a safety floor.

---

## 9. Traceability — probe verdict → config default

| Verdict ([`probe-history.md`](probe-history.md)) | Sets |
| --- | --- |
| Q-WORK WORKABLE beyond ring 3 | `workOuterTiles` becomes meaningful; promotion uses the passing worker path |
| Q-WORK BLOCKED (owned but not workable) | outer-ring work ships **territory only**; document that the outer ring is owned/settle-blocking but not yield-worked |
| Q-CAPTURE TRANSFERRED / STRIPPED | note in-game whether inner captures keep improvements (balance flavour) |

---

## 10. Definition of Done (feature → release gate)

A feature ships only when: its probe / acceptance gate is green in-game; new pure logic has Node tests with honest
assertions (mutation coverage not gamed); `eslint` + `check-esm` clean; `CHANGELOG` updated; the `verify` skill (or an
in-game drive) confirms the change end-to-end; and the feature is flag-gated + reversible with a conservative default.
Per-feature test/acceptance detail is in §6 above; each outstanding feature's own gate is noted in
[`potential-future-features.md`](potential-future-features.md).
