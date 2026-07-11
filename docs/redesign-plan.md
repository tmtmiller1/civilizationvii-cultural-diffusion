# Cultural Diffusion — Redesign & Build Plan

**Status: ACTIVE PLAN (2026-07-08).** Consolidates the in-game probe findings from this
session and specs the path forward. Companion to
[`cultural-diffusion-spec.md`](cultural-diffusion-spec.md) (authoritative model) and
[`future-features.md`](future-features.md) (roadmap items). Where this plan and the old spec
disagree (notably the flip **verb**), **this plan wins** — it is grounded in real in-game
probe data, which the original spec's verb decision was not.

House rules unchanged: single-player only (`guardSP()`), flag-gated, reversible, never write
`GameConfiguration` at runtime, nothing ships without a probe.

---

## 0. Why this plan exists

The 2026-07-08 in-game probe run (v0.7.0, read from `UI.log`) overturned a load-bearing
assumption: **the mod's default flip verb does not do what the mod needs.** Everything the
mod promises — usable culturally-claimed land, stealing rival tiles, pushing into a rival's
inner ring — depends on the flip verb, and the shipped default (`setOwnership`) fails at all
three. This plan records that finding, picks the verb, and sequences the rebuild plus the new
features the user asked for (usable outer tiles, inner-ring capture, conquest-flip with a
buffer, and — later — cultural city capture).

---

## 1. Probe findings — ground truth (2026-07-08, ~600 logged flips + `PlotOwnershipChanged`)

| Flip verb | Empty (unowned) land | Rival-owned land | Beyond ring 3 | Verdict |
| --- | --- | --- | --- | --- |
| **`WorldBuilder.MapPlots.setOwnership`** (shipped default) | becomes yours but **ORPHAN** — `owningCity=NONE`, `inCityPlots=false`, not workable/buildable | **FAILS — 102/102 `no-change`**, tile stays the rival's | orphan only | ✗ broken for our purpose |
| **`city.purchasePlot`** | **INTEGRATED** — `owningCity` set, `inCityPlots=true` (a real city tile) | **WORKS** — captured rival tiles, incl. **ring-1** (`51,30`/`51,32`, `ringDepth=1`, fired `owner=0`) | **INTEGRATED beyond ring 3** | ✓ works, **but spends gold** |
| **`city.Growth.claimPlot`** | present in API; **UNTESTED** | untested | untested | ? — Phase 0 probe |
| **`CREATE_ELEMENT DISTRICT_RURAL`** | present in API; **UNTESTED** | untested | untested | ? — Phase 0 probe |

Corollaries proven this run:
- The original v0.3 "Q-RIVAL green" was a **false positive** — `setOwnership` only ever
  "flipped" tiles the player already owned (they trivially re-read as owner 0).
- **Inner-ring capture is real** — the user watched the rival's ring-1 tiles change to their
  colour; the log confirms those were `purchasePlot` captures at `ringDepth=1`. So my earlier
  "`setOwnership` is god-mode, no ring restriction" claim was **wrong** and is retracted.
- `buildable[LIBRARY/ACADEMY/MONUMENT]=n` even on INTEGRATED tiles — expected: those are
  worked **rural** tiles (yields), not urban-district plots. "Integrated + `inCityPlots`" is
  the success signal, not building placement.

Two operational issues also seen, to fix in Phase 0:
- **No candidates on a fresh game.** Turn-1 maps have no rival tiles and no beyond-ring-3
  frontier → every verdict reads PENDING. Real answers need a mid-game bordering an AI.
- **State-machine thrash.** The probe reset every turn (`schema changed` ×107) — its
  persisted phase is not surviving between ticks (localStorage not persisting across the
  game-scope isolate), which breaks the save/reload persistence flow.

---

## 2. The central decision — the flip verb

Everything downstream depends on this. The options:

- **A. `purchasePlot`.** Proven to fully work (integrate, beyond ring 3, rival capture to
  ring 1). **Cost: gold.** A diffusion mod that flips dozens of tiles would drain the
  treasury — directly against spec §3.6 ("organic diffusion must not drain the treasury").
- **B. A free + integrated verb** (`Growth.claimPlot` and/or `CREATE_ELEMENT DISTRICT_RURAL`).
  If either integrates a tile **without** gold, it is strictly better than both the broken
  free verb (`setOwnership`) and the working-but-costly verb (`purchasePlot`). **Untested.**
- **C. Keep `setOwnership`.** Rejected — proven non-functional for owned-tile capture and
  produces unusable orphan land.

**Decision: Phase 0 probes B. If B works → adopt it. If B fails → adopt A (`purchasePlot`)
and expose a gold-budget cap.** Either way `setOwnership` is retired as the primary verb
(it may remain only for `unclaim`).

```
Phase 0 probe result
├─ Growth.claimPlot integrates FREE ........ → verb = Growth.claimPlot   (best case)
├─ DISTRICT_RURAL integrates FREE .......... → verb = DISTRICT_RURAL
└─ neither is free ......................... → verb = purchasePlot + gold cap (CONFIG.maxGoldPerTurn)
```

---

## 3. Feature inventory — the whole surface, mapped

| # | Feature (user ask) | Mechanism | Status | Gate |
| --- | --- | --- | --- | --- |
| 1a | Settle / develop tiles beyond ring 3 | integrated verb attaches the tile to a city | feasible (purchasePlot integrated beyond ring 3) | verb (Phase 0) |
| 1b | Swap a tile between your own settlements | **1.4.1 base-game "change which city works a tile"**; also `purchasePlot`/`claimPlot` re-parent | **moot** — base game covers it; nothing to build | — |
| 1c | *Work* the outer ring (yields), toggleable | integrated tile → assign worker / rural district; `cd-work-outer` toggle, default OFF | feasible pending "worked vs owned" confirm | verb + Q-WORK |
| 2 | Culturally steal rival tiles, organically | integrated verb on rival plots; already gated in `flipEligible` | **capture works via purchasePlot**, incl. inner ring | verb (Phase 0) |
| — | Take tiles **inside** a rival's ring | `coreProtectRadius` (0 = center-only, default) + integrated verb | **shipped** (config) + **proven** (ring-1 capture) | — |
| — | Contiguous vs enclave front | `requireAdjacency` toggle (default on) | **shipped** | — |
| 4 | Tile flip on **conquest**, with occupation **buffer** | per-tile occupation counter (default 5 turns) → integrated flip | **specced** ([future-features.md §2](future-features.md)) | verb + unit-on-tile API |
| 5 | Flip a city-center tile → **capture the settlement** | engine `CITY_TRANSFER` / cession subsystem | **research needed** — most ambitious | own research + probe |

---

## 4. Phased build order

Each phase is independently shippable and probe-gated. Do **not** start a phase before its
gate is green.

### Phase 0 — Verb probe + probe hardening  **[GATES EVERYTHING]**

**Goal:** decide the flip verb (§2) and make the probe trustworthy.

- **Add to `probe/`:** for a claimed tile (near, far, and rival), test `city.Growth.claimPlot`
  and `CREATE_ELEMENT DISTRICT_RURAL` and read back **owner + owning-city + `inCityPlots` +
  whether any gold was spent** (`player.Treasury` before/after). Verdict per verb:
  **FREE-INTEGRATED / COSTS-GOLD / FAILS.**
- **Fix the thrash:** make the phase/meta survive between ticks (or guard the schema-reset so
  it fires once per session), so the save/reload persistence flow actually runs.
- **Add a "waiting" HUD line:** when `rival:0` / `unownedBeyond3:0`, say *"play toward an AI
  border — no rival / outer-ring tiles yet"* so PENDING isn't mistaken for broken.
- **Exit criteria:** a definitive FREE-INTEGRATED verdict (or a clear COSTS-GOLD fallback),
  read on a mid-game map that actually has rival + beyond-ring-3 tiles, surviving save/reload.

### Phase 1 — Core verb switch

**Goal:** make the shipped mod actually claim usable, capturable tiles.

- **`cd-ownership.js`:** add the chosen verb as `performFlip`'s primary path; keep
  `setOwnership` only for `unclaim`. If verb = `purchasePlot`, add a per-turn **gold cap**
  (`CONFIG.maxGoldPerTurn`, skip flips once exceeded) so it can't bankrupt the player.
- **`cd-config.js` / `cd-settings.js` / `cd-options.js`:** replace the "Free / Buy with gold"
  verb dropdown with the real decision; if gold path, expose the cap.
- **Verify:** rival + frontier tiles become **INTEGRATED** in-game, borders redraw, survive
  reload; treasury not drained (cap holds).

### Phase 2 — Usable outer ring (1a / 1c)

**Goal:** the owner can develop/work culturally-claimed tiles past ring 3.

- With integration confirmed, add `cd-work-outer` (default OFF) that **promotes** a *stable*
  diffusion tile (past its `flipCooldownTurns` lock, within `maxDiffusionPlots`) to a worked
  tile (assign worker / rural district), after `resolveOwnership()`.
- Keep the feedback-loop brakes (§3.5): relative metric, per-city cap, per-turn promotion cap.
- **Owner-only** by construction (owned plots block foreign use). Settling (found) is
  opportunistic — base min-city-range still applies (see Q-FOUND).
- **Verify:** Q-WORK green on a beyond-ring-3 owned tile; worked state persists reload.

### Phase 3 — Inner-ring capture (mostly shipped)

**Goal:** cultural pressure bites into a rival's worked footprint.

- **Already done:** `coreProtectRadius` (default 0 = protect only the enemy city-center plot)
  + `requireAdjacency` toggle, with Options controls. Proven feasible (ring-1 capture).
- **Remaining:** confirm side-effects on the rival city when an inner *developed* tile is
  taken (does the improvement transfer or vanish — Q-CAPTURE), and that it's clean across
  reload. Tune the intensity presets' default protection if playtest wants it gentler.

### Phase 4 — Conquest tile-flip with occupation buffer

**Goal:** hold enemy land with an army → it annexes after a buffer. Full spec in
[future-features.md §2](future-features.md).

- Per-tile occupation counter in `cd-state` (default **5 turns**, tunable 3/4/5/Immediate,
  scaled to game speed); **resets when the unit leaves** (preserves pillage + emigration
  reaction). Integrated verb only. Runs after Emigration + diffusion resolve.
- **Open:** the units-on-tile read (`MapUnits` / plot-unit query) — small research + probe.
- **Verify:** no flip before N turns of continuous hold; flips after; resets on leave;
  survives reload; only with the toggle ON.

### Phase 5 — Cultural city capture (research)

**Goal:** flipping the tile a city-center sits on cedes the **whole settlement**, like a
peace deal.

- Separate engine subsystem (`CITY_TRANSFER` / capture / cession) — **not** a tile flip.
- **Research first:** is there a `WorldBuilder` / player-operation to transfer a city to
  another player peacefully? Then a dedicated probe. Highest risk/ambition; scope last.

---

## 5. Config & Options additions (cumulative)

| Key | Default | Phase | Meaning |
| --- | --- | --- | --- |
| `flipVerb` (repurposed) | Phase-0 result | 1 | integrated verb: `growthClaimPlot` \| `districtRural` \| `purchasePlot` |
| `maxGoldPerTurn` | (only if gold verb) | 1 | per-turn gold ceiling for flips; skip once exceeded |
| `coreProtectRadius` | `0` | ✓ done | rings around a rival center that never flip (1 / 0 / -1) |
| `requireAdjacency` | `true` | ✓ done | organic contiguous front vs. enclave flips |
| `workOuterTiles` | `false` | 2 | promote stable diffusion tiles to worked tiles |
| `conquestFlip` | `false` | 4 | enable conquest tile-flip |
| `conquestBufferTurns` | `5` | 4 | continuous-occupation turns before annex (3/4/5/Immediate) |

All under **Options → Mods → Cultural Diffusion**, mirroring the shipped controls.

---

## 6. Risks & open questions

- **Gold drain** (if verb = `purchasePlot`): mitigated by `maxGoldPerTurn`; still a balance
  concern vs. the free-verb ideal. Phase 0 decides.
- **Yield feedback loop** (worked outer tiles → yields → growth → more culture): the §3.5
  brakes (relative metric, per-city cap, promotion cap) plus `workOuterTiles` default OFF.
- **Probe persistence bug** (Phase 0): must fix or persistence verdicts (Q-PERSIST,
  worked-state, buffer counter) can't be trusted.
- **Unit-on-tile API** (Phase 4): unconfirmed read; small research.
- **City-transfer API** (Phase 5): unknown whether a mod can trigger a peaceful cession.
- **Fresh-map emptiness:** all probes need a mid-game bordering an AI to produce real data.

---

## 7. Already shipped this session (2026-07-08)

- **Inner-ring redesign:** `cityCoreProtection` (bool) → `coreProtectRadius` (1/0/-1, default
  0); new `requireAdjacency` toggle; both wired to Options + ModText; `isCoreProtected`
  generalized to a radius. Tests green (14 suites), eslint/ESM clean. (CHANGELOG `[Unreleased]`.)
- **Probe v0.7.0** (`probe/`, schema `v7-deep`): read-only stages re-run every turn (no
  buttons/console) and pin on-screen verdicts — **Q-WORK** (outer-tile workable, near-control
  + per-verb), **Q-DEEP** (inside-ring flip, ring-depth classified), **Q-CAPTURE** (developed
  rival tile transfer), **Q-FOUND** (settle, opportunistic), **Q-SWAP** (re-parent), plus
  destructive confirms behind `AUTO.WORK_MUTATE`.
- **Roadmap:** `future-features.md §2` expanded with the occupation-buffer conquest design.

---

## 8. Immediate next action

**Run Phase 0** — extend the probe to test `Growth.claimPlot` + `DISTRICT_RURAL` for
free-vs-gold integration and fix the persistence thrash — then read the verdict on a
mid-game map bordering an AI. That single result unblocks the verb switch, usable outer
tiles, rival/inner-ring capture, and conquest-flip all at once.

---

# Implementation reference

Everything below turns this from a plan into a build-ready spec. All API shapes are grounded
in confirmed call sites (game code / cheat panels / the 2026-07-08 probe). Items marked
**(Phase 0)** are unknowns the probe resolves — do not fabricate them in code before then.

## 9.1 Verb call reference (exact shapes + success detection)

All ownership writes are **asynchronous** — the immediate read is unreliable. Detect success
on a **deferred re-read** (next pass, or `setTimeout(...,~2s)` in the probe), never inline.
Every mutation is wrapped in `guardSP()` and a `safe()` try/catch, per `cd-ownership.js`.

| Verb | Exact call | Success signal | Cost |
| --- | --- | --- | --- |
| `purchasePlot` | `Cities.get(cityId).purchasePlot({ x, y })` | `getOwningCityFromXY(x,y).id === cityId` **and** `city.getPurchasedPlots().includes(idx)` | **gold** (affordability-gated) |
| `Growth.claimPlot` | `city.Growth.claimPlot({ x, y })` | same owning-city check | **(Phase 0)** free? |
| `DISTRICT_RURAL` | `Game.PlayerOperations.sendRequest(0, "CREATE_ELEMENT", { Kind:"DISTRICT", Type:"DISTRICT_RURAL", Location:{x,y}, Owner:playerId, Parent:cityComponentId })` | `MapConstructibles.getConstructibles(x,y)` shows a rural district owned by us | **(Phase 0)** free? |
| `setOwnership` (retire → `unclaim` only) | `WorldBuilder.MapPlots.setOwnership(playerId \| PlayerIds.NO_PLAYER, {x,y})` | owner read only (proven to **orphan** / fail on rival) | none |
| assign worker (Phase 2) | `Game.PlayerOperations.canStart/sendRequest(pid, PlayerOperationTypes.ASSIGN_WORKER, { Location: plotIndex, Amount: 1 })` | `canStart(...).Success`; then `Workers.GetTilePlacementInfo(idx).IsBlocked === false` | population/worker |

- **Plot index:** `plotIndex = GameplayMap.getIndexFromLocation({x,y})` (worker ops use
  `Location: plotIndex`; city ops use `{X,Y}` coords — do not mix the two shapes).
- **Gold read (Phase 0 to confirm exact accessor):** `Players.get(pid).Treasury` — read the
  gold balance before/after a `purchasePlot`, and **affordability-gate** (skip the flip if
  balance < cost, and stop for the turn once `maxGoldPerTurn` is spent).
- **Yield / worked reads (Phase 2):** `GameplayMap.getYieldsWithCity(x,y,cityId)` is a
  *hypothetical* if-worked value — informational only, **never** a workability signal. The
  authoritative "is it workable" signal is `canStart(ASSIGN_WORKER).Success` /
  `GetTilePlacementInfo(idx).IsBlocked`.

## 9.2 State schema & migration (`cd-state.js`, v2 → v3)

Current envelope: `{ v:2, data:{ field, claims, locked, monoTurn } }`. Bump to **v3**, add two
maps; `prepareState`/sanitizer initializes any missing key to `{}` so **v2 saves load
unchanged** (no destructive migration, no `GameConfiguration` writes).

```
data.occupation = { "x,y": { by: playerId, turns: n, sinceTurn: monoTurn } }  // Phase 4 buffer
data.promoted   = { "x,y": monoTurn }                                          // Phase 2 (don't re-promote)
```

- `pruneState` must also prune `occupation` (drop entries whose tile is no longer occupied)
  and `promoted` (drop tiles no longer owned by us), on the same skirt rule as `field`.
- Version guard: on load, `v < 3` → add the empty maps, set `v:3`.

## 9.3 Per-file change map

| File | Function | Change | Phase |
| --- | --- | --- | --- |
| `cd-ownership.js` | `performFlip` | route to the chosen integrated verb; keep `setOwnership` only in `unclaim`; add affordability gate if gold verb | 1 |
| `cd-ownership.js` | *new* `flipViaClaimPlot` / `flipViaRuralDistrict` | thin guarded wrappers per 9.1 | 1 |
| `cd-config.js` | `CONFIG` + `PRESETS` | `flipVerb` values; `maxGoldPerTurn`; `workOuterTiles`; `conquestFlip`; `conquestBufferTurns` | 1,2,4 |
| `cd-settings.js` | getters/setters + `applyTunableOverrides` | persist + apply the new keys | 1,2,4 |
| `cd-options.js` | register* | verb dropdown (rewritten), gold cap, work-outer, conquest toggles | 1,2,4 |
| `cd-pass.js` | *new* `promoteWorkedTiles(state)` | after `resolveOwnership`, promote stable owned tiles (past `locked`, within caps) to worked; record in `promoted` | 2 |
| `cd-pass.js` | *new* `conquestSweep(state)` | last stage: increment/reset `occupation`, flip at `conquestBufferTurns` | 4 |
| `cd-state.js` | schema + `prepareState`/`pruneState` | v3 maps (9.2) | 2,4 |
| `cd-plots.js` | *new* `unitsAt(loc)` / `militaryOccupantAt(loc, me)` | units-on-tile read | 4 |
| `text/*/ModText.xml` | — | LOC keys (9.6) | 1,2,4 |

## 9.4 Test & acceptance plan (Node harnesses, per phase)

Pure logic is unit-tested in Node (no engine); engine behavior is probe/in-game verified.
**No metric masking** — every new branch gets a real assertion; keep the mutation bar.

- **Phase 1:** `tests/ownership.mjs` — verb routing (chosen verb primary, `setOwnership` only
  for unclaim), gold gate skips when `balance < cost` and after `maxGoldPerTurn`. `tests/settings.mjs`
  — new keys apply/override presets.
- **Phase 2:** `tests/promote.mjs` — a tile promotes only when owned + past `locked` + under
  `maxDiffusionPlots` + promotion cap; `promoted` prevents re-promotion; workability uses the
  authoritative signal (mock), never `getYieldsWithCity`.
- **Phase 4:** `tests/conquest.mjs` — counter increments on continuous hold, **resets on
  vacate**, flips exactly at `conquestBufferTurns`, respects the toggle, scales with
  game-speed factor.
- **State:** `tests/state.mjs` — v2→v3 migration adds empty maps, v2 blobs load, prune drops
  stale `occupation`/`promoted`.
- **Acceptance (in-game, `verify`/probe):** each phase's §4 "Verify" bullet, on a mid-game map
  bordering an AI, surviving save/reload.

## 9.5 Edge cases, guards & invariants

- **Never mutate** in multiplayer (`guardSP()`), when `!diffusionEnabled`, or with no local
  cities. Once-per-turn, idempotent (the phase machine).
- **Never target:** water (`isWater`), a city-center / district plot (exclude — city capture
  is Phase 5, not a tile flip), the local player's own tiles (invisible to the scan by
  design, §3.5 rule 1).
- **Cultural flips** honor: `claimOnlyUnowned`, `atWar` (no peaceful diffusion across a
  front), `coreProtectRadius`, `requireAdjacency`, `flipCooldownTurns` lock,
  `maxDiffusionPlots` per-city cap, `maxFlipsPerTurn`.
- **Conquest flips** (Phase 4) intentionally **bypass** the peaceful gates (war is the point)
  but still exclude city-center/district plots and require continuous occupation; precedence
  over the cultural `locked` map — conquest wins.
- **Affordability** (gold verb): never spend below a safety floor; stop at `maxGoldPerTurn`.
- **Async writes:** verify on a later pass, not inline. **No `GameConfiguration` writes.**

## 9.6 Localization keys to add (`text/*/ModText.xml`)

Phase 1: `LOC_OPTIONS_CD_VERB` items rewritten (Free-integrated / Buy-with-gold),
`LOC_OPTIONS_CD_GOLDCAP(+_DESCRIPTION)`. Phase 2: `LOC_OPTIONS_CD_WORK_OUTER(+_DESCRIPTION)`.
Phase 4: `LOC_OPTIONS_CD_CONQUEST(+_DESCRIPTION)`, `LOC_OPTIONS_CD_CONQUEST_BUFFER(+_DESCRIPTION)`
and buffer items `LOC_OPTIONS_CD_BUFFER_3/4/5/IMMEDIATE`. All mod-prefixed; ship all 11
locales (or English + fallback) per the mod's existing convention.

## 9.7 Definition of Done (per phase → release gate)

A phase is shippable only when: its probe/acceptance gate is green in-game; new pure logic has
Node tests with honest assertions (mutation coverage not gamed); `eslint` + `check-esm` clean;
`CHANGELOG` updated; the `verify` skill (or an in-game drive) confirms the change end-to-end;
and the feature is flag-gated + reversible with a conservative default.

## 9.8 Traceability — probe verdict → config default

| Phase 0 verdict | Sets |
| --- | --- |
| `Growth.claimPlot` FREE-INTEGRATED | `flipVerb = "growthClaimPlot"`, no gold cap needed |
| `DISTRICT_RURAL` FREE-INTEGRATED (and claimPlot not) | `flipVerb = "districtRural"` |
| neither free | `flipVerb = "purchasePlot"`, expose `maxGoldPerTurn` (conservative default) |
| Q-WORK WORKABLE beyond ring 3 | `workOuterTiles` becomes meaningful; promotion uses the passing worker path |
| Q-WORK BLOCKED (owned but not workable) | Phase 2 ships **territory only**; document that the outer ring is owned/settle-blocking but not yield-worked |
| Q-CAPTURE TRANSFERRED / STRIPPED | note in-game whether inner captures keep improvements (balance flavor only) |
