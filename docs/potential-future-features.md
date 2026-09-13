# Cultural Diffusion — Potential Future Features

The consolidated roadmap of everything **proposed but not yet built** Style: flag-gated, conservative defaults (OFF for
anything that changes territory), reversible, single-player only, with file anchors so each item is actionable.
**Nothing here ships until it has its own probe / verification pass** the way the core diffusion loop did.

Companions: current behaviour is in [`current-model.md`](current-model.md); the feasibility record is in
[`probe-history.md`](probe-history.md); build-time reference (verb calls, state schema, guards, tests, Definition of Done) is in [`reference-and-conventions.md`](reference-and-conventions.md). Decisions **not** to build things live in
[`wont-build-with-justifications.md`](wont-build-with-justifications.md).

> **The verb gate is already green.** Several items below were originally blocked on "which flip verb?". That is
> resolved: `purchasePlot` + a same-tick gold refund is net-free and integrated ([`current-model.md`](current-model.md)
> §4). What remains outstanding is each feature's *own* logic, not the verb.

Status legend (marked per section below): **Outstanding** · **Probe-gated** · **Research-gated**.

---

## 1. Cultural pressure lens + hover tooltip

*Status: Phase 1 BUILT (shading + split + tooltip + turns estimate), written but NOT YET watched in-game — probe-gated.
Arrows (Phase 2) still outstanding.*

A map **lens** that shows *where the border is about to move next* — the civ-vs-civ culture split on contested tiles,
shading that deepens as a tile nears capture — plus a **hover tooltip** that shows, per tile, how the capture
calculation is made.

**Why it's feasible now:** the per-tile data already lives in the mod's own HUD/GameFace context (`state.field["x,y"]`,
a `Record<civId, number>`), and the emigration mod already ships the exact pattern — a plot-tinting lens
([`emigration/ui/emigration-prosperity-lens.js`](../../emigration/ui/emigration-prosperity-lens.js)) and a per-tile
cursor hover panel
([`emigration/ui/emigration-lens-hover-panel.js`](../../emigration/ui/emigration-lens-hover-panel.js), resolver
signature is already `resolve(signal, snapshot, plot?)`). Cultural Diffusion has no map rendering today; this is a port
+ wiring job, read-only (no gameplay change, so it can't destabilize the sim). The spec's original `cd-lens.js` / M1
"read-only pressure lens" milestone was never built — this is that, realized.

**Mechanism.**
- New UIScript module (own `<UIScripts>` entry, HUD context) `import { loadState }` from
  [`ui/cd-state.js`](../ui/cd-state.js); register a lens layer + lens with `LensManager`; build an overlay group of plot
  fills; decorate `lens-panel` with a "Cultural Pressure" radio.
- **Split / shading** — from `state.field` + the flip rule ([`ui/cd-field.js`](../ui/cd-field.js)): leader vs incumbent
  as a %, `progress = min(1, winner*flipRatio / incumbent)` (or the `minimumOwner` ramp on empty land), driving fill
  colour/`alpha` so frontier tiles saturate as `progress → 1`.
- **Tooltip** — register a per-tile hover panel whose `resolve` reads the hovered plot's `civMap` and lays out each
  civ's stock, the threshold, `flipRatio`, and the verdict.

**Phasing.** Ship shading + split + tooltip first. **Arrows for pressure direction are Phase 2** — the overlay API
paints plot fills, not vectors; the per-neighbour delivery data exists ([`ui/cd-field.js`](../ui/cd-field.js) diffusion
step) but rendering arrows needs textured edge markers or positioned DOM, which must be confirmed first.

**Honest boundaries.** (1) The field is only populated within `fieldRadius` (8) of local cities and pruned beyond — the
lens shows the *contested frontier near your empire*, not a whole-map culture picture (that data is never computed). (2)
`loadState()` reflects last-completed-turn values; the tooltip must not claim to recompute mid-turn (which is exactly
when a player plans, so it's fine).

**Verification.** In-game: enable the lens, confirm frontier tiles tint by capture-progress, hover a contested tile and
confirm the readout matches `state.field` + the flip constants.

**Implementation (Phase 1 shipped to the tree — code-complete, unit-tested, NOT yet watched in-game).** The lens and
tooltip are wired into the `game`-scope `<UIScripts>`/`<ImportFiles>` of
[`cultural-diffusion.modinfo`](../cultural-diffusion.modinfo). New files:
- [`ui/cd-pressure-lens.js`](../ui/cd-pressure-lens.js) — the lens UIScript (mirrors the Emigration prosperity/ethnicity
  lenses): registers a `LensManager` layer + lens, decorates `lens-panel` with a "Cultural Pressure" radio, Shift+C
  hotkey. Reads `loadState().field`, scores each tile with the shared verdict below, paints contested tiles (leading
  culture ≠ current owner) in the contender's banner colour at an alpha that ramps with capture progress. Batches by
  quantized colour and memoizes per turn.
- [`ui/cd-pressure-tooltip.js`](../ui/cd-pressure-tooltip.js) — the cursor-following hover panel (per-tile, so no
  plot→settlement index): each contender's stock, an owner marker, capture progress %, and an "at current pace"
  turns-to-flip line (the Civ VI growth-hex idea, below).
- [`ui/cd-lens-colors.js`](../ui/cd-lens-colors.js) — self-contained readable civ-colour + `#RRGGBB`→float4 helper (a
  trim of Emigration's `emigration-civ-colors.js`, so this mod stays standalone; no cross-mod import).
- [`ui/cd-field.js`](../ui/cd-field.js) gained two PURE, unit-tested helpers that both the lens and tooltip share so map
  and sim can't drift: `pressureVerdict(civMap, currentOwner, deadOwners, cfg)` (leader, incumbent, target, `progress`,
  `willFlip` — the exact gates `resolveOwner` uses, cross-checked in [`tests/pressure-verdict.mjs`](../tests/pressure-verdict.mjs))
  and `estimateTurnsToFlip(...)` (a deterministic one-step-ahead estimate; returns `0` = ready, `Infinity` = stalled,
  `null` = no pending flip). The lens/tooltip age-adjust `minimumOwner` by the current age's `ownerBar` to match the
  pass, and pull the player's preset via `applyTunableOverrides()`.
- Options: a read-only "pressure lens" enable checkbox ([`ui/cd-options.js`](../ui/cd-options.js) +
  [`ui/cd-settings.js`](../ui/cd-settings.js) `get/setPressureLensEnabled`, default ON) and the `LOC_CD_LENS_PRESSURE`
  / `LOC_CD_PRESSURE_*` strings in [`text/en_us/ModText.xml`](../text/en_us/ModText.xml).

*What is proven vs. assumed.* `npm test` (incl. the new pressure-verdict suite) + `npm run lint` + `check:esm` pass.
What has NOT happened: loading the mod in Civ VII and watching the overlay tint, the panel follow the cursor, the colours
resolve, and `loadState()` return a populated field in the HUD isolate. Those are the probe items below and the reason
the status is "not yet watched in-game." Known risk points to check first: whether the HUD isolate actually sees the
`GameConfiguration`-persisted field, and whether `civLabel` resolves real civ names (its player-name property guesses
are best-effort with a `#id` fallback).

*Turns-to-flip (the Civ VI growth-hex, realized).* Civ VI, on city selection, drew a filling hex on the next tile a city
will culturally claim plus a "N turns until your borders expand" countdown (`UILens.SetLayerGrowthHex` +
`GetTurnsUntilExpansion`, `CityPanel.lua`). This mod has no per-city culture-cost clock, but the field gives the same
signal per contested tile: `estimateTurnsToFlip` reads the leader's strongest neighbour stock, projects one open-ground
diffusion step minus decay, and divides the remaining stock-to-target by that net gain. It is deliberately labelled "at
current pace" — an estimate, not a promise (it ignores terrain, injection, and the sigmoid approach to the cap).

### Prior art — how Civ V and Civ VI did tile-expansion notification and styling

Both games are installed locally and their UI Lua/XML is readable, so this section is grounded in the actual engine
source, not memory. Paths below are inside each game's `Assets` tree. The headline finding shapes the whole feature:
**neither game raises a notification when culture organically grows a border** — border growth is silent in both. The
only per-tile border toasts that exist are the *loss* case (a rival culture-bomb taking a tile from you). So a "you
gained a tile" toast, and especially a pressure-and-capture readout, is net-new UI in both lineages — this feature is a
genuine gap-filler, not a re-skin.

**Civ V (`Sid Meier's Civilization V`, engine-drawn borders + Lua overlay events).**
- *Expansion notification.* `NOTIFICATION_CITY_TILE` (`Gameplay/XML/Misc/Notifications.xml`, `Welcomeness=1`, i.e.
  good-news styling) with text `TXT_KEY_NOTIFICATION_CITY_CULTURE_ACQUIRED_NEW_PLOT` ("...has built up enough Culture to
  claim a new Tile!"). Rendered table-driven in `UI/InGame/WorldView/NotificationPanel.lua` (`g_NameTable[type] ->
  "CityTile"`, instantiated from the `CityTileItem` XML template in `NotificationPanel.xml`). The art is fixed —
  `NotificationTileFrame/Glass/Glow.dds` with a pulsing glow — **not** player-colored. There is **no** rival-claim /
  border-friction notification at all in Civ V (only diplomatic border-promise expiry).
- *Border styling.* Fully engine-drawn, parameterized by `Overlays/CultureBorders.xml`: a crisp inner **primary** band
  (player `PrimaryColor`) over a wide translucent **secondary** fill (`SecondaryColor`), with `randomness`/`expansion`
  giving the hand-drawn wobble and outward bleed. Contested/city-state edges use a separate dashed `cs_*` style. Player
  colors come from `Gameplay/XML/Interface/CIV5PlayerColors.xml`. Note: there is **no** per-tile "how contested is this"
  tint in the data — frontier tension is only implied by overlapping alpha falloff.
- *Lens/overlay mechanism a script can drive.* `Events.SerialEventHexHighlight(Vector2(x,y), true, Vector4(r,g,b,a),
  "StyleName")` + `Events.ClearHexHighlightStyle("StyleName")`, with fill styles (`FilledHex`/`HexContour`) defined in
  `Overlays/Highlights.xml`. The dropdown-lens + color-key legend pattern lives in
  `UI/InGame/WorldView/MiniMapPanel.lua` (`SetStrategicViewOverlay`, `GetOverlayLegend`, `SetLegend`).
- *Hover tooltip.* `UI/InGame/PlotHelpManager.lua` `Level1Tip()` assembles the plot readout as `[NEWLINE]`-joined
  blocks; the ownership line is `GetOwnerString(plot)` in `PlotMouseoverInclude.lua`, which **color-codes ownership by
  relationship** — own tiles white, at-war owner red, others green. That relationship coloring is the one directly
  transferable idea for a "whose tile, how contested" line.

**Civ VI (`Sid Meier's Civilization VI`, the real lens framework — the closer ancestor to Civ7's `LensManager`).**
- *Expansion notification.* Same story: plain border growth raises only the engine event
  `Events.CityTileOwnershipChanged(owner, cityID)` (a re-render signal, not a toast). The closest existing template for a
  frontier-loss toast is `NOTIFICATION_TILE_LOST_CULTURE_BOMB` (`Gameplay/Data/Notifications.xml`, `SeverityType=MID`),
  rendered through `UI/Panels/NotificationPanel.lua` (`g_notificationHandlers` / `RegisterHandlers`, icon from
  `pNotification:GetIconName()`).
- *The lens framework.* `UILens.CreateLensLayerHash("<Layer>")` to mint a layer, `UILens.SetActive("<Lens>")` to
  activate, and `UILens.SetLayerHexesColoredArea(layerHash, playerID, plots, color[, variant])` to tint plots. Dispatch
  hub is `UI/MinimapPanel.lua` (`Events.LensLayerOn -> OnLensLayerOn`). Two built-ins are the porting templates: the
  **owner lens** `SetOwningCivHexes` (tint each city's `GetPurchasedPlots()` with `UI.GetPlayerColors()`), and the
  **appeal lens** `SetAppealHexes`, which buckets a per-tile scalar into 5 color bands and calls
  `SetLayerHexesColoredArea` once per band — structurally identical to shading tiles by capture-progress.
- *The direct analog — the Loyalty / "Cultural Identity" lens* (`DLC/Expansion2/UI/Replacements/
  MinimapPanel_Expansion1.lua`, `UpdateLoyaltyLens`, layer `Cultural_Identity_Lens`). It reads
  `pCity:GetCityIdentityPressures()` (per-source `{CityOwner, CityID, IdentityPressureTotal}`), buckets plots into
  gaining/losing, tints them with owner color + a `LoyaltyFlag_Up`/`_Down` variant, and animates directional pressure
  from source city to contested plot via `UILens.CreatePressureWaves(layerHash, waves)`. **This is the single closest
  existing implementation to the Cultural Pressure Lens** — same shape as our per-tile `state.field` civ split, and its
  `CreatePressureWaves` is exactly the Phase 2 "arrows for pressure direction" we deferred. A clean standalone
  add-a-lens context (no core edits) is `DLC/Expansion2/UI/Additions/PowerLensManager.lua`. The color-key legend is
  `AddKeyEntry` in `UI/Panels/ModalLensPanel.lua`.
- *Border styling.* Owner-color line drawn via the `"CityBorders"` overlay in `UI/WorldView/PlotInfo.lua`
  (`SetBorderColors` from `UI.GetPlayerColors`, one channel per city). Colors defined in
  `UI/Colors/PlayerColors.xml` + `PlayerStandardColors.xml`. As in Civ V, base Civ VI has **no** contested-frontier
  border style — that shading is only ever the Loyalty pressure lens, confirming ours is net-new on top of the
  owner-color border.
- *Hover tooltip.* `UI/ToolTips/PlotToolTip.lua`: `FetchData(plot)` -> `GetDetails(data)` builds an array of localized
  rows (`table.insert(details, Locale.Lookup(...))`, owner line first via `LOC_TOOLTIP_CITY_OWNER`), rendered as one
  `table.concat(details, "[NEWLINE]")` string. Refreshable via `LuaEvents.PlotInfo_UpdatePlotTooltip`.

**What this means for the Civ7 port.** The Civ6 lens framework is the ancestor of the exact API our emigration lenses already use, so the mapping is close to 1:1 — and the emigration mod has already made the jump, which is why this feature
is "a port + wiring job":

| Civ V / Civ VI concept | Civ7 equivalent already used in this repo |
| --- | --- |
| `UILens.SetActive` / `LensLayerOn` dispatch | `LensManager.registerLens` / `setActiveLens` ([`emigration-prosperity-lens.js`](../../emigration/ui/emigration-prosperity-lens.js)) |
| `UILens.SetLayerHexesColoredArea(...,color)` | `WorldUI.createOverlayGroup(...).addPlotOverlay().addPlots(plots, {fillColor})` |
| `SetAppealHexes` 5-band scalar bucketing | `paintTileBuckets` quantized buckets in `emigration-prosperity-lens.js` (already the same idea) |
| `ModalLensPanel.AddKeyEntry` legend / lens button | `Controls.decorate("lens-panel", ...)` + `createLensButton` |
| `PlotToolTip.GetDetails` newline-joined rows | the cursor-following `rows` panel in [`emigration-lens-hover-panel.js`](../../emigration/ui/emigration-lens-hover-panel.js) |
| Loyalty lens `GetCityIdentityPressures` split | our own `state.field["x,y"]` civ-vs-civ split (already computed) |
| `CreatePressureWaves` directional arrows | the deferred **Phase 2** arrows (still needs an edge-marker/positioned-DOM equivalent — no direct Civ7 verb) |
| relationship-colored owner line (`GetOwnerString`) | the tooltip's per-civ swatch + verdict rows |

Two honest caveats carried over from the source read. (1) The `UILens.*` / `SerialEventHexHighlight` calls are Civ5/Civ6
engine APIs — the value here is the *data-and-bucketing blueprint* (especially the loyalty lens), not drop-in code; Civ7
is a different UI stack that the emigration lenses already target. (2) Both prior games left organic border growth
un-notified and un-shaded-for-contest, so there is no upstream art or string to reuse for the "about to flip" state — the
Loyalty lens's up/down flag variants are the nearest reference for signaling direction of pressure.

---

## 2. Tile ownership flip on conquest (with an occupation buffer)

*Status: outstanding, probe-gated.*

While you are **at war**, a plot your military **continuously holds** flips to your territory — but **not immediately**.
A configurable **occupation buffer** (default **5 turns**) must elapse with your unit holding the tile before it
annexes.

**Why a buffer.** An immediate flip breaks pillage economics and the Emigration mod's per-turn reaction to occupation —
a drive-by raid would annex on contact. The buffer keeps the tile "occupied, not yet annexed" so both systems play out.
**Continuous hold required; leaving resets the counter to 0**, so a raid that moves on converts nothing. Default 5
(tunable 3/4/5/Immediate); 3 is snappy but on fast speeds a raid can annex before pillage/emigration react, 5 is a
comfortable margin beyond a typical raid. **Scale to game speed** via [`ui/cd-calibration.js`](../ui/cd-calibration.js).

**Behavior.**
- **Trigger:** at war with the plot's owner (`atWar()` in [`ui/cd-borders.js`](../ui/cd-borders.js)) **and** a local
  military unit has continuously occupied the plot for `conquestBufferTurns` turns.
- **Bookkeeping:** a persisted per-tile occupation counter (mirror the `locked`/`field` maps in
  [`ui/cd-state.js`](../ui/cd-state.js)) increments each held turn, resets to 0 when unoccupied at turn end.
- **Verb:** the integrated flip verb (per [`current-model.md`](current-model.md) §4) — **not** bare `setOwnership`,
  which cannot take rival land.
- **Scope:** single-player only (`guardSP()`).

**Toggle (Options).** "Flip occupied tiles during war" master on/off (`CONFIG.conquestFlip`, default OFF); "Occupation
buffer (turns)" dropdown 3/4/5/Immediate (`CONFIG.conquestBufferTurns`, default 5).

**Ordering.** Conquest flips apply **after** Emigration's per-turn pass and after Cultural Diffusion's `runPass()`
cultural flips — a conquest sweep runs *last* (a stage appended after `resolveOwnership()`), so occupation is the final
territorial word on a fully-settled board.

**Open questions.** Units-on-tile read (`MapUnits` / `Units.getUnitsAt` / plot unit query — not yet used; recommend
"military unit present at turn end"); reversal on peace/retreat (simplest v1: tiles stay); exclude enemy
city-center/district plots (base game owns city capture); precedence vs `isCoreProtected` and the `locked` map (conquest
should win); buffer persistence in `cd-state` (never `GameConfiguration`), including reset on load when the unit is
gone.

**Verification.** Extend the probe: enter a war, hold a rival tile, confirm no flip before N turns of continuous hold,
flip after (toggle ON only), reset on leaving mid-buffer, integrated verb, survives save/reload.

---

## 3. Usable outer-ring tiles — closed, engine-blocked

*Status: closed. Moved to [`wont-build-with-justifications.md`](wont-build-with-justifications.md).*

This section used to say integration made claimed beyond-ring-3 tiles workable and only a yield check remained. That
was wrong. Civ VII's work radius is native and capped at ring 3, and since 1.0.7 the mod only claims beyond ring 3, so
every claimed tile is territory without yield. Evidence: [`civ7-tile-range-investigation.md`](civ7-tile-range-investigation.md).

> **Related, still open — organic rival-tile capture polish.** `flipEligible` ([`ui/cd-pass.js`](../ui/cd-pass.js))
> flips rival-owned tiles; see [`current-model.md`](current-model.md) §5. Remaining: a clearer capture notification, and
> confirming whether a captured *developed* tile keeps its improvement (Q-CAPTURE, [`probe-history.md`](probe-history.md)).

---

## 4. Cultural city capture

*Status: research-gated.*

Flipping the plot a city-center sits on cedes the **whole settlement**, like a peace-deal cession. The most ambitious
item — a **separate engine subsystem** (`CITY_TRANSFER` / capture / cession), not a tile flip. **Research first:** is
there a `WorldBuilder` / player-operation to transfer a city to another player peacefully? Then a dedicated probe.
Highest risk; scope last.

---

## 5. Settings-menu parity polish

*Status: outstanding.*

The Options surface already ships ([`current-model.md`](current-model.md) §6). Remaining parity work vs. Emigration's
menu ([`emigration/ui/emigration-options.js`](../../emigration/ui/emigration-options.js)): group the territory-changing
toggles above under a clear sub-heading so the tab reads as a coherent panel, and keep Emigration's convention of one
persisted setting per option, defaulted OFF for anything that changes territory, with a localized label + tooltip per
control. Every new toggle proposed above lives in this same menu.
