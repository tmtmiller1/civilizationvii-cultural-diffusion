# Cultural Diffusion - Future Features / Roadmap

Backlog of features proposed for the Cultural Diffusion mod but **not yet built**.
Written to the same house style as `cultural-diffusion-spec.md`: flag-gated,
conservative defaults, reversible, single-player only, with file anchors so each
item is actionable when picked up. Nothing here ships until it has its own probe /
verification pass the way the core diffusion loop did.

Status legend: **PLANNED** (agreed, not started) - **IDEA** (needs design) - **DONE**.

---

## 1. Settings menu parity with the Emigration mod

**Status: MOSTLY DONE - polish/parity remaining.**

The mod *already* registers a settings surface under the shared **"Mods"** tab of the
Options screen, in both shell and game scopes - see
[`ui/cd-options.js`](../ui/cd-options.js) (state getters/setters in
[`ui/cd-settings.js`](../ui/cd-settings.js)). It currently exposes:

- Intensity preset (Custom / Low / Medium / High)
- Enable diffusion (master switch)
- Claim only unowned land (safety mode)
- Flip verb (Free territory / Buy with gold)
- Debug logging

Remaining work to reach true parity with Emigration's menu
([`emigration/ui/emigration-options.js`](../../emigration/ui/emigration-options.js)):

- Group the new gameplay toggles below (starting with **Tile ownership flip on
  conquest**, 2) under a clear sub-heading so the tab reads as a coherent panel.
- Mirror Emigration's convention of one persisted setting per option, defaulted OFF
  for anything that changes territory, with a localized label + tooltip per control.

Every new toggle proposed in this document is assumed to live in this same menu.

---

## 2. Tile ownership flip on conquest (with an occupation buffer)  **[PLANNED]**

### Summary

While you are **at war**, a plot your military **continuously holds** flips to your
territory - but **not immediately**. A configurable **occupation buffer** (default **5
turns**) must elapse with your unit holding the tile before it annexes. The buffer is the
whole point of the design: it preserves the window in which (a) contested tiles can still be
**pillaged**, and (b) the **Emigration** mod can react to the disruption of an active
occupation - *before* the tile becomes settled territory. Applied **after** all
Emigration + diffusion changes resolve for the turn (see **Ordering**), so occupation is the
final territorial word.

### Why a buffer (design rationale)

- **Immediate flip breaks pillage + emigration.** A 0-turn flip annexes on contact, so a
  drive-by raid instantly converts tiles - there is no contested-occupation phase for pillage
  economics or for Emigration's per-turn model to register the event. The buffer keeps the
  tile "occupied, not yet annexed" so both systems play out.
- **Continuous hold required; leaving resets it.** The counter only advances while your
  military unit **stays** on the tile; if the unit leaves or is killed, it **resets to 0**.
  So a tile annexes only if you genuinely *hold* it - a raid that moves on converts nothing,
  which is exactly the pillage/raid pattern this preserves.
- **Length: default 5, tunable 3-5 (or Immediate).** 3 turns is snappy but on fast game
  speeds a raid can still annex before pillage/emigration meaningfully react; **5 turns** is
  a comfortable margin beyond a typical raid, so annexation reads as real conquest rather than
  a drive-by. **Scale to game speed** via the existing
  [`ui/cd-calibration.js`](../ui/cd-calibration.js) age-pace factor so "5 turns" keeps its
  meaning on Marathon / Quick.

### Behavior

- **Trigger:** at war with the plot's owner (`atWar()` in
  [`ui/cd-borders.js`](../ui/cd-borders.js)) **and** a local military unit has
  **continuously occupied** the plot for `conquestBufferTurns` turns.
- **Buffer bookkeeping:** a persisted per-tile occupation counter (mirror the diffusion
  `locked` / field maps in [`ui/cd-state.js`](../ui/cd-state.js)) increments each turn the
  unit holds and resets to 0 whenever the tile is unoccupied at turn end.
- **Effect (verb - REVISED by the 2026-07-08 probe, important):** the flip must use an
  **integrated** verb. The probe proved `WorldBuilder.MapPlots.setOwnership` **does NOT take
  a rival-owned tile** (100+ attempts, all `no-change`) - on empty land it only produces an
  *orphan* (owner set, no owning city, unworkable). Rival capture that actually lands uses
  **`city.purchasePlot`** (integrated; in-game it took rival tiles to **ring-1**) or a
  confirmed **free-integrated** verb (`city.Growth.claimPlot` / `CREATE_ELEMENT DISTRICT_RURAL`,
  pending probe). **So conquest-flip shares the core mod's verb decision - it cannot use bare
  `setOwnership`.**
- **Scope:** single-player only (`guardSP()`), like every other flip path.

### Toggle (Options)

- **"Flip occupied tiles during war"** master on/off (`id: "cd-conquest-flip"`,
  `CONFIG.conquestFlip`) - **default OFF** (changes territory outside the cultural model, so
  opt-in and reversible like the rest of the mod).
- **"Occupation buffer (turns)"** dropdown **3 / 4 / 5 / Immediate** (`CONFIG.conquestBufferTurns`,
  default 5), scaled by game speed.
- Backed by getter/setter pairs in [`ui/cd-settings.js`](../ui/cd-settings.js) + localized
  labels in `text/*/ModText.xml`, the same pattern as the new core-protection / adjacency
  controls (3).

### Ordering (important)

The user requirement is that conquest flips apply **after** Emigration's per-turn
changes. Both mods run off `PlayerTurnActivated`. Concretely:

1. Emigration's per-turn pass runs (migration, dilemmas, integration/return).
2. Cultural Diffusion's `runPass()` runs its cultural flips
   ([`ui/cd-pass.js`](../ui/cd-pass.js)).
3. **New:** a conquest sweep runs *last* within the CD pass (or as a distinct
   post-step gated on `CONFIG.conquestFlip`), so occupation overrides any cultural
   or migration outcome for the turn.

Since CD already depends on / reads Emigration state
([`ui/cd-emigration.js`](../ui/cd-emigration.js)), the cleanest placement is a final
stage appended after `resolveOwnership()` inside the existing pass, guaranteeing it
observes the fully-settled board.

### Open questions / discovery needed

- **Units-on-tile API.** CD reads ownership via `GameplayMap.getOwner(x, y)`
  ([`ui/cd-plots.js`](../ui/cd-plots.js)) but does not yet enumerate units on a plot.
  Need to confirm the correct read (e.g. `MapUnits` / `Units.getUnitsAt` / a plot
  unit query) and what counts as "controlling" a tile - any military unit present,
  vs. a unit that has *sat* on it (to avoid a unit merely passing through flipping a
  tile mid-move). Recommend "military unit present at turn end."
- **Reversal on peace / retreat.** Decide whether conquered tiles stay flipped after
  the war ends or after the unit leaves. Simplest v1: they stay (a permanent gain),
  and normal cultural diffusion governs them afterward. Note this explicitly since it
  differs from historical "occupied vs. annexed" nuance.
- **City tiles / capitals.** Confirm we do not accidentally flip the plot under an
  enemy city (that is a capture event the base game owns). Likely exclude
  district/city-center plots.
- **Interaction with `locked` / core-protected tiles.** Decide precedence vs.
  `isCoreProtected` and the diffusion `locked` map - conquest should probably win,
  but state that intent.
- **Buffer persistence.** The per-tile occupation counter must survive save/reload (store
  it in `cd-state`, never `GameConfiguration`). Confirm the counter reloads and continues,
  and that it resets correctly when the unit is no longer present at load.
- **Verb (mostly settled).** The 2026-07-08 probe already resolved that bare `setOwnership`
  cannot capture rival land; the remaining fork is `purchasePlot` (gold) vs. a free-integrated
  verb (`Growth.claimPlot` / `DISTRICT_RURAL`) - the same probe that gates 3 decides this.

### Verification

- Extend the in-game probe (`../probe/`): enter a war, move a unit onto a rival tile, and
  confirm (a) the tile does **not** flip before `conquestBufferTurns` of continuous
  occupation, (b) it **does** flip once the buffer elapses - and only with the toggle ON,
  (c) leaving the tile mid-buffer **resets** the counter (no flip), (d) it uses an integrated
  verb so the captured tile is real city land, and (e) the counter + flip survive save/reload.

---

## 3. Usable outer-ring tiles + organic rival-tile capture  **[PLANNED - probe-gated]**

### Summary

Today a diffusion-claimed tile beyond a city's normal ~3-ring footprint is **free
territory only**: it paints the border (via `WorldBuilder.MapPlots.setOwnership`,
[`ui/cd-ownership.js`](../ui/cd-ownership.js)) and blocks foreign settling, but it is
**un-worked by design** (spec 3.6, to kill the yield -> growth -> culture feedback loop).
Some players want those outer tiles to be **usable** - settleable, workable, and
tradeable like normal city land - and want cultural **capture of rival tiles** to feel
as organic as claiming empty land. This item scopes that, gated behind a Phase 0 probe
because the deciding rules live in native C++, not in JS or the gameplay database.

Four sub-goals, from the request:

1. **(1a) Settle the outer ring** - the owner can expand/develop into culturally-claimed
   tiles past ring 3.
2. **(1b) Swap tiles between settlements** - as in the base game.
3. **(1c) Work the outer ring** - a city can actually work (yield-bear) tiles past ring 3;
   **toggleable** in Options.
4. **(2) Culturally capture rival tiles** - convert/"steal" owned rival tiles the same
   organic way we claim empty frontier.

**Hard constraint (user, this thread):** the outer tiles are **owner-only**. Only the
tile's owner may settle/work them; rivals are locked out (which owned plots already
enforce - settle-validity checks `REQUIREMENT_PLOT_IS_OWNER`). Nothing here lets a
non-owner use another civ's culturally-claimed land.

### Feasibility (from a full game-code + cheat-panel deep dive, this thread)

The workable/expandable set is computed entirely in **native C++** and handed to JS as an
opaque list; **there is no JS or gameplay-DB constant for the city work-range** and no
range-override setter. So a UIScript mod cannot *widen* the footprint declaratively - it
can only invoke native primitives and observe whether native itself accepts a far tile.
Primitives that exist (all confirmed by call sites in shipped JS + the published cheat
panels), ranked by promise for a *worked* outer tile:

| Primitive | Call | What it gives us | Beyond ring 3? |
| --- | --- | --- | --- |
| Worker op | `Game.PlayerOperations.canStart/sendRequest(me, PlayerOperationTypes.ASSIGN_WORKER, {Location: plotIndex, Amount: 1})` (`interface-mode-acquire-tile.js:317`) | force a worker/specialist onto an owned plot; `canStart().Success` is a **read-only** yes/no | **unknown - the make-or-break probe** |
| Rural district | `Game.PlayerOperations.sendRequest(0, 'CREATE_ELEMENT', {Kind:'DISTRICT', Type:'DISTRICT_RURAL', Location:{x,y}, Owner:me, Parent:cityID})` (map-cheat-panel `placeRuralDistrict`) | creates the *worked-tile improvement* bound to a city; cheat panel's own distance limits are self-imposed, not an engine cap | **unknown - probe** |
| City claim | `city.Growth.claimPlot({x,y})` (`map-utilities.js:449`) / `city.purchasePlot({x,y})` (`tuner-input.js:300`) | attach a plot to a **specific** city (not just a player) | `purchasePlot` unproven; cheat author instrumented it *because* unsure |
| Native expand | `Game.CityCommands.sendRequest(cityID, EXPAND, {X,Y})` (`interface-mode-acquire-tile.js:340`) | validated territory grow | adjacency-gated, one ring at a time - not a direct far grab |
| Yield read | `GameplayMap.getYieldsWithCity(x, y, cityID)` | plot yields **as worked by that city** - the success-check for "is it productive" | read-only |

Read-only tri-state confirms what to measure: worldbuilder schema `PlotOwners(Owner,
CityOwner, CityWorking)` and `PlayerWorkers(PlayerID, PlotID, Placed)`
(`schema-worldbuilder-map.sql:132-138, 302-307`). Runtime reads: `GameplayMap.getOwner` /
`getOwningCityFromXY`, `city.Workers.GetTilePlacementInfo(plotIndex).IsBlocked` /
`GetAllPlacementInfo()`, `MapConstructibles.getConstructibles(x,y)` (rural district
present?), and `getYieldsWithCity`.

**Per sub-goal:**

- **(1a) settle** - plausible via `purchasePlot` / `Growth.claimPlot` (city-scoped) once
  owned; owner-only falls out of ownership. Gate on the probe.
- **(1b) swap** - there is **no base-game *UI/command* for tile transfer** in Civ VII 1.4.1
  (no `CITY_COMMAND_TRANSFER`, no swap interface mode). BUT the capability is not absent:
  `city.purchasePlot({x,y})` and `city.Growth.claimPlot({x,y})` **re-parent a plot to the
  city they are called on**, so "move a tile from city A to city B" is buildable by calling
  the verb on B - we would supply the trigger (there is no native button). This is the same
  ownership-reassignment family the mod already uses; it just needs its own confirm. **Probe
  it (Q-SWAP), do not drop.** (Correction to an earlier note that called 1b impossible.)
- **(1c) work** - the headline unknown. Achievable **iff** native accepts `ASSIGN_WORKER`
  and/or `CREATE_ELEMENT DISTRICT_RURAL` on a beyond-ring-3 owned tile and yields follow.
  If `canStart(ASSIGN_WORKER).Success` is false for a far tile, (1c) is **not achievable**
  with this modding surface - report honestly and stop.
- **(2) capture rival tiles** - **already implemented.** [`ui/cd-pass.js`](../ui/cd-pass.js)
  `flipEligible` (line 317) already flips rival-owned tiles; the probe already proved
  rival flips (Q-RIVAL green). Remaining work is *hardening*: make organic capture the
  default posture (it is off under the `Low` preset's `claimOnlyUnowned`), verify the
  war/core-protection gates read correctly, and surface a clear on-screen notification.

### Phase 0 probe - BUILT (`../probe/` v0.6.0, schema `v6-work-capture-found`)

The probe now extends the original flip/integrate tests with the outer-tile stages. All
verdicts pin on-screen (no console needed). Stages:

1. **Q-WORK (read-only, safe) - the 1a/1c gate.** For each **beyond-ring-3** owned tile:
   `canStart(ASSIGN_WORKER, {Location, Amount:1})`, owning-city `canStart(EXPAND).Plots`,
   `GetTilePlacementInfo(idx).IsBlocked`, `getYieldsWithCity`. Two rigor guards baked in:
   a **near (ring 1-2) control** (so a far BLOCKED can't be a false-negative from "no
   worker/pop pending") and **per-verb pairing** (`setOwnership` vs `purchasePlot`, since a
   far tile may only be workable via the city-scoped verb). 3-state verdict: **WORKABLE via
   [verb]** / **BLOCKED** / **INCONCLUSIVE**.
2. **Q-WORK-MUTATE / -PERSIST + worker-cap (E, C; opt-in `AUTO.WORK_MUTATE`, throwaway
   save).** Places a worker + `CREATE_ELEMENT DISTRICT_RURAL` + `Growth.claimPlot`, records
   `NumWorkers`/`getCityWorkerCap` before/after (**C**: does working the tile consume the
   cap?), and a persistence marker so the next session re-reads whether the **worked state**
   (not just ownership) survived reload (**E**).
3. **Q-CAPTURE (D).** Prefers a **developed** rival tile (has a district), captures the
   `constructibleCount`/`districtOwner` at flip time, and reports **TRANSFERRED** (you
   inherit the improvement) vs **STRIPPED** (reverts to bare land) - the "steal developed
   tiles organically" half of ask (2).
4. **Q-FOUND (1a-found).** Opportunistic: **VII has no settler-free settle-validity read**
   (found city is gated by a settler's `Game.UnitOperations.canStart(UNITOPERATION_FOUND_CITY)`),
   so it reads a local settler's legal found-plots and reports whether an owned outer tile
   is foundable. Not-foundable beside your own cities is expected (base min-city-range); a
   true test needs a settler moved next to an isolated claimed tile (`cd_probe.found()`).
5. **Q-SWAP (1b; opt-in `AUTO.WORK_MUTATE`).** Re-parents a near owned tile to a *second*
   local city via `purchasePlot` and reads (deferred, async) whether the owning city changed
   **A→B** - then restores it. **TRANSFERRED** ⇒ inter-city tile swap is buildable (no base
   UI needed); **BLOCKED** ⇒ the verb didn't re-parent.

**How it runs (no buttons).** All stages fire from engine events (`PlayerTurnActivated` /
`LoadComplete`) via the auto-runner - the read-only ones re-run **every turn** so verdicts
stay live and Q-FOUND catches a settler-positioned turn, all with **no console and no
clickable UI** (the on-screen panel is display-only; past Gameface button issues are why).
Destructive stages (Q-WORK-MUTATE, Q-SWAP) are behind the `AUTO.WORK_MUTATE` code flag you
flip before installing, exactly like the existing `AUTO.FLIP_RIVAL`.

Verdict → build: **WORKABLE** ⇒ (1c) buildable via the passing verb (may force the outer-ring
flip to `purchasePlot`); **BLOCKED** ⇒ (1c) not achievable, ship (1a) territory + (2) capture
only. Q-CAPTURE TRANSFERRED strengthens (2); STRIPPED means captured tiles arrive bare.

### Toggle (Options)

- **"Work culturally-claimed tiles beyond the city footprint"** (`id: "cd-work-outer"`,
  `CONFIG.workOuterTiles`, `getWorkOuterTiles/setWorkOuterTiles` in
  [`ui/cd-settings.js`](../ui/cd-settings.js)). **Default OFF** (it re-introduces the yield
  feedback loop 3.6 deliberately removed; keep it opt-in). When ON and the probe verdict is
  WORKABLE, the pass promotes each *stable* diffusion tile (past its `locked` cooldown) to
  a worked rural tile via the proven verb.
- **(2)** rides the existing `claimOnlyUnowned` toggle; add a preset note that Medium/High
  already permit organic rival capture.

### Ordering / feedback-loop guard (important)

Working the outer ring resurrects the 3.6 loop (worked tiles -> yields -> growth -> culture
-> more diffusion). Brakes: only promote tiles **past the `flipCooldownTurns` lock** and
**within `maxDiffusionPlots`**; keep the metric relative (share-vs-strongest); and cap
promotions per turn like flips (`maxFlipsPerTurn` sibling). Promotion runs **after**
`resolveOwnership()` so it only ever acts on already-owned, settled diffusion tiles.

### Open questions

- Does `ASSIGN_WORKER` / `DISTRICT_RURAL` on a far tile need the tile attached to a
  *specific* city first (`purchasePlot`/`claimPlot`), or does bare `setOwnership`
  (player-level) suffice? (Probe compares.)
- Do promoted rural tiles count against the player's own growth/worker cap
  (`getCityWorkerCap`)? If so, promotion should respect it, not exceed it.
- AI fairness: promotion is local-player only (single-player, `guardSP()`), like every
  other flip.

### Verification

Probe first (above). Then, once built, drive it in-game: claim a far tile, toggle
"work outer tiles" ON, confirm the tile becomes worked + yields, survives save/reload, and
that a rival cannot settle/use our owned outer tiles.

---

## 4. (reserved for future items)

Add new proposals below in the same shape: Summary - Behavior - Toggle - Ordering (if
turn-timing matters) - Open questions - Verification.
