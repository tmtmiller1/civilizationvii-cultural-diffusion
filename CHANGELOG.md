# Changelog

All notable changes to Cultural Diffusion are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the mod uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **No more phantom territory claims.** A tile flip is now recorded only after confirming the
  tile actually changed owner. Previously a flip attempt that silently did nothing (the default
  verb no-ops on rival-owned land) was still booked as a success — consuming the settlement's
  claim budget, locking the tile on cooldown, and firing a "claimed territory" toast while the
  rival kept the tile. (The permanent fix — switching the claim verb — remains the redesign
  plan's Phase 1.)

### Removed
- Two unused, unwired config flags (`preventForwardSettle`, `minimalOwnedCulture`); anti-forward-
  settling is an emergent property of the diffusion field, not a discrete toggle.

### Probe (v0.8.0 — Phase 0, `probe/`)

- **Q-VERB — the flip-verb decision gate** (redesign-plan §2). For a distinct tile per
  candidate verb (`Growth.claimPlot` and `CREATE_ELEMENT DISTRICT_RURAL`), the probe reads
  the player's gold synchronously around the call and, deferred, whether the tile
  **integrated** (owner=me, real owning city, `inCityPlots` / rural district). Verdict per
  verb, pinned on-screen: **FREE-INTEGRATED / COSTS-GOLD / FAILS**, plus a rolled-up
  **decision** driving the plan's tree (claimPlot free → adopt it; else rural free → adopt
  it; else → `purchasePlot` + gold cap). `Q-VERB-PERSIST` re-reads across save/reload.
- **Fixed the state-machine thrash** (the "schema changed ×107" per-turn reset). The store
  now serves reads/writes from a `globalThis` session mirror that survives between ticks even
  when the game-scope isolate's `localStorage` doesn't round-trip; `localStorage` is still
  written best-effort for cross-session persistence. Re-arm now runs at most **once per
  session** so a mid-session mirror miss can't wipe the flip log again.
- **"Waiting" HUD line.** On a fresh/interior map with `rival:0` / `unownedBeyond3:0`, the
  panel now says *"play toward an AI border"* so PENDING verb/capture verdicts aren't
  mistaken for broken.

### Probe (v0.8.1 — Phase 0 fixes from the 2026-07-09 in-game run)

The first v0.8.0 run confirmed the thrash fix (1 reset, not ×107) and cleanly read gold, but
its verb verdict was confounded. Four fixes:

- **Verdicts now settle over turns, not one short timer.** The async ownership/district write
  settled *after* the 2.5s seed read (every tile read FAILS then, yet was integrated
  post-reload). The seed read now waits 6s **and** every turn-refresh re-classifies, upgrading
  a verb's verdict monotonically the turn its write finally lands.
- **Verb tiles are now excluded from the flip set.** The failed flips left their tiles reading
  unowned, so the verb probe re-picked them — `DISTRICT_RURAL`'s tile also carried a
  `purchasePlot` flip, so integration couldn't be attributed to one verb. Each verb now gets a
  virgin plot.
- **`CREATE_ELEMENT` success is read correctly.** `sendRequest` is fire-and-forget (returns
  void), so the old `res.Success` check always logged `op-failed` even when the rural district
  placed. Success is now the deferred `constructiblesAt` re-read, not the return value.
- **Clearer border messaging** when far tiles exist but there's no rival to test capture on.

### Probe (v0.8.2 — visible-land claims + un-masked verb decision)

- **Claims now land on visible LAND, not ocean/fog.** `findCandidates` skipped nothing, so a
  coastal city's nearest "frontier" was open water — the flips took (`Q_FLIP=GREEN`) but on
  water/hidden tiles, producing **no visible border growth** (the thing to watch, and the
  prerequisite for testing rival capture). It now skips `isWater` and fully-hidden
  (`revealedState === 0`) tiles, and reports `skippedWater` / `skippedHidden` in the
  diagnostics counts. This is also correct for the eventual mod — culture claims land, not sea.
- **Verb decision is driven by the FAR (beyond-ring-3) verdict.** The old rollup took each
  verb's best verdict across all tiles, so `Growth.claimPlot` (FREE-INTEGRATED near, **FAILS**
  beyond ring 3 — it's range-limited) was wrongly recommended. The rollup now decides on the
  frontier the mod actually claims and prints the full `near:… far:…` split so a range-limited
  verb can't be masked. On the 2026-07-09 data this correctly resolves to **`DISTRICT_RURAL`**.

### Probe (v0.8.3 — visible contiguous border growth + rival capture demo)

The v0.8.2 run confirmed (via `PlotOwnershipChanged` events) that the claims and border-redraws
*do* fire — but every candidate was `beyondCap` (the city's ring 1–3 was already owned), so the
probe claimed a few **disconnected specks far from the city**, which don't read as "the border
grew" and never touched a rival. New **diffusion demo** stage (`AUTO.DIFFUSION_DEMO`, on):

- Each turn it claims the **contiguous front** — land tiles directly adjacent to your existing
  territory — so the colored border visibly creeps outward ring by ring (`DEMO_PER_TURN` tiles,
  default 8). Unowned land uses `DISTRICT_RURAL` (free + integrated); **rival** land on the front
  uses `purchasePlot` (the verb proven to capture rival tiles), so rival capture is visible where
  the front meets an AI. Water/hidden tiles are skipped. Console: `cd_probe.demo()`.

### Probe (v0.8.4 — the demo now uses a verb that actually repaints the border)

The v0.8.3 demo ran and advanced the front (99 `owner=0` `PlotOwnershipChanged` events across a
whole region), but **borders still didn't visibly grow** — because `DISTRICT_RURAL` changes
ownership data and fires the event **without repainting the culture border**. Important caveat
for Phase 1: the free/integrated verb may need an explicit border refresh to be visible.

- **Demo unowned-tile verb switched to `setOwnership`** — the mod's own default, which is free
  *and* visibly repaints the border (rival tiles still use `purchasePlot`). Configurable via
  `AUTO.DEMO_UNOWNED_VERB`.
- **Throttled to once per turn.** `PlayerTurnActivated` re-fired ~7×/second, so the demo was
  blasting ~56 claims/sec; it now advances at most once per `DEMO_MIN_MS` (2.5s) — one watchable
  ring per turn.

### Probe (v0.9.2 — Phase 5 via Game.DiplomacyDeals, the real city-transfer path)

The first Phase-5 run's "no runtime API" was wrong — it never checked `Game.DiplomacyDeals`. The
shipped "Fealty: Transfer Cities" mod proves cities cede in JS through the diplomacy **deal**
system, and for **minor/Independent/city-state** owners the deal can be **force-accepted**
(they can't refuse). `runCityTransfer` now drives that path: `diplomacyDealsPresence` (API + enum
surface) → `cityCedeItem` builds a scratch working deal (`{direction, player1:me, player2:owner}`),
`clearWorkingDeal` + `getPossibleWorkingDealItems(dealId, owner, CITIES)` and finds the target
city's `OFFER` item (READ-ONLY) → `Q-XFER-CEDE`/`Q-XFER-ROLLUP` report `CEDE-ABLE (minor,
FORCE-ACCEPT)` / `major needs agree` / `not offerable yet`. Behind `AUTO.CITY_TRANSFER_MUTATE`,
`sendCityCession` adds the city item and `sendWorkingDeal(dealId, ACCEPTED)` — auto-attempted only
for the force-acceptable **minor** case; the `CityTransfered` event confirms it. New API:
`diplomacyDealsPresence`, `cityCedeItem`, `sendCityCession`.

### Probe (v0.9.9 — Phase 5 via the REVOLT MARKER: the real cultural city-capture)

Cities flip owner by placing a hidden marker constructible that carries the **base-game
`CityRevolt`** unhappiness effect — the base-game revolt system then transfers the settlement to an
adjacency/culture candidate (us, since diffusion has surrounded it). No war, no occupation, **works
on majors.** Ships as data (base-game schema + effect identifiers only) + a game-scope
`CREATE_ELEMENT`:

- **Data** (`probe/data/`, own ActionGroup so a schema error can't kill the JS stages):
  `cd-revolt-gameeffects.xml` (`CD_MARKER_CITY_REVOLT` → `EFFECT_CITY_ADJUST_UNHAPPINESS_EFFECT`,
  `CityRevolt`), `cd-revolt-marker.xml` (hidden `BUILDING_CD_REVOLT_MARKER` bound to that modifier),
  `cd-revolt-text.sql` (LOC).
- **`runRevoltMarker`** (`AUTO.REVOLT_MARKER`, on): resolves the marker's constructible index,
  finds a rival/city-state city center, and — read-only — reports `Q-REVOLT-READY`. Under
  `AUTO.CITY_TRANSFER_MUTATE` it `CREATE_ELEMENT`s the marker onto that city (`Q-REVOLT-PLACE`).
- **`runRevoltWatch`** (per turn): the revolt/transfer takes turns, so it re-reads the city's owner
  each turn and reports **who got it** — `Q-REVOLT-WATCH` / `Q-REVOLT-RESULT toMe=…`. If it comes
  to us → cultural city-capture confirmed; if it goes independent → it's now a minor we can absorb
  via the DiplomacyDeals force-accept chain. New API: `constructibleIndexByType`, `createCityMarker`.

### Probe (v0.9.1 — fixes from the first Phase-5 run)

- **District type resolved to a name.** `getDistrictType` returns a numeric enum, so the v0.9.0
  rural/urban capture labels all fell through to `other`. New `districtTypeNameAt` resolves it via
  `GameInfo.Districts.lookup`, so `Q-CAPTURE` now correctly tags `rural`/`urban` and the rollup
  separates tile-bound (transfer) from city-bound (strip). Rollup also counts `other`.
- **Q-COST retries.** It fired before the map could purchase (both `claimed=false`) and, being
  one-shot, never re-ran. It now re-arms itself when a run is inconclusive.
- Phase 5 first result confirmed the design: `Q-XFER-ROLLUP` = *transfer-ish API names exist but
  none canStart on a city center* — the city object exposes only conquest **state** reads
  (`isJustConqueredFrom`/`getTurnsUntilRazed`/`isBeingRazed`), no transfer **action** → cultural
  city-capture needs the `EFFECT_CITY_TRANSFER_OWNER` data-modifier path, not a runtime JS op.

### Probe (v0.9.0 — Q-COST, capture instrumentation, city-center exclusion, Phase 5 discovery)

- **Q-COST (one-shot):** measures `purchasePlot`'s gold cost on a **contiguous** vs a
  **disconnected** tile (self-refunds, net-zero) → classifies `CONTIGUITY-REQUIRED` /
  `CONTIGUITY-GATED-PRICING` / `UNCONDITIONALLY-FREE`. Answers *why* the front was free.
- **Capture instrumentation (points 1 & 2):** the demo now snapshots each captured rival tile's
  improvement and reads it back — `Q-CAPTURE rural … => TRANSFERRED` (tile-bound improvements come
  across) vs `Q-CAPTURE urban … => STRIPPED` (city-bound buildings can't survive their plot leaving
  the losing city). Confirms the observed behavior in the log, not just on screen.
- **City-center exclusion:** `frontierRing`/`disconnectedTile` now skip city-center plots
  (`isCityCenterAt`), so normal diffusion no longer leaves a broken half-state on a settlement core.
- **Phase 5 — cultural city capture DISCOVERY:** taking a city-center tile *should* annex (major)
  or absorb (minor) the whole settlement, but no runtime cede API is known. `runCityTransfer`
  reflects the API surface (`Cities`/`WorldBuilder`/city methods/`PlayerOperationTypes`/
  `CityOperationTypes`/`CityCommandTypes`) for transfer-ish names, `canStart`-tests (READ-ONLY) any
  transfer op on a target rival/minor city center, and reports `Q-XFER-SURFACE` + `Q-XFER-ROLLUP`
  (`INVOKABLE via <op>` / `names exist, none canStart` / `NO runtime API → needs a DATA modifier`).
  Destructive attempt gated behind `AUTO.CITY_TRANSFER_MUTATE` (off); the bootstrap listens for the
  engine's `CityTransfered` event as independent confirmation. Console: `cd_probe.cityXfer()`.

### Probe (v0.8.9 — the refund is now player-invisible, not just metric-invisible)

v0.8.8 left a ~2.5s dip on the live gold counter (purchase, then deferred refund). Now the refund
happens in the **same tick** as each purchase: `purchasePlot`'s cost is applied synchronously at
the call, so we read the balance immediately and restore it with `changeGoldBalance` before the
frame renders — the displayed gold counter never moves. The deferred pass is demoted to a
**backstop** that only acts on any async residual and reports `invisible=true/false` +
`syncRefunded`/`asyncResidual` so we know empirically whether the whole cost was synchronous. Still
metric-safe (balance-only, no yield-stat touch) and still net-zero.

### Probe (v0.8.8 — refund is invisible to the demographics mod's metrics)

The demographics mod compiles two gold metrics: **Treasury** = `treasury.getGoldBalance()` and
**Gold Per Turn** = `Stats.getNetYield(YIELD_GOLD)`. A `grantYield` refund would inject into that
yield stat and spike "Gold Per Turn". Fixed: `grantGold()` now **prefers
`Treasury.changeGoldBalance`** — a balance-only poke that never touches the yield rate (grantYield
is only a last-resort fallback). The refund read-back now re-reads **both** demographics values
after settling and reports `DIFFUSION-METRIC-SAFE Treasury=clean GoldPerTurn=clean` (and a
`★ GOLD:` headline), proving the balance round-trips to zero and the per-turn rate never moved.
New `netGoldYield()` reader mirrors exactly what demographics samples.

### Probe (v0.8.7 — purchasePlot with silent gold refund: visible + integrated + net-free)

Confirmed in-game: `setOwnership` **does** visibly repaint the border (free, but orphan), and the
stack proved both orders orphan. The remaining ideal — visible **and** integrated **and** no
treasury drain — is now reached by refunding `purchasePlot`'s cost. The demo claims unowned front
tiles (and rival tiles) with `purchasePlot` (visible + integrated), then a **deferred refund**
grants back exactly what was spent via `Players.grantYield(pid, YIELD_GOLD, spent)` (the proven
write path the emigration mod uses; falls back to `Treasury.changeGoldBalance`). Net gold change
is **zero** — the balance dips for ~2.5s then restores. New `grantGold()` API wrapper;
`DEMO_REFUND_GOLD` (default on); `DIFFUSION-REFUND` / `★ GOLD: refunded N` report the round-trip.
This is a candidate answer for the mod itself: `purchasePlot` + per-turn refund = the redesign
plan's free + integrated + visible verb without draining the treasury (§2 / §3.6).

### Probe (v0.8.6 — stack: test BOTH orders)

The v0.8.5 run showed `setOwnership → DISTRICT_RURAL` yields **0/8 integrated** (all ORPHAN):
`setOwnership` claims the tile, so `CREATE_ELEMENT DISTRICT_RURAL` then refuses (it only claims
*unowned* land). The demo now tests **both orders on alternating tiles** — `set→rural` and
`rural→set` — and the read-back tallies integration per order (`DIFFUSION-STACK [order] …`,
`★ STACK integration => set->rural:x/n rural->set:y/n`). If either order keeps the owning city
*and* you see the border, that's the free+integrated+visible verb; if both are 0, the two verbs'
ownership models are mutually exclusive and integration needs `purchasePlot` or a border-refresh
call.

### Probe (v0.8.5 — the "stack" verb: paint + integrate + free)

Tests the idea that if `setOwnership` repaints the border and `DISTRICT_RURAL` integrates for
free, **stacking them** on one tile could give all three. The demo's unowned-tile verb defaults
to **`stack`**: `setOwnership` first (border repaint) then `DISTRICT_RURAL` (attach owning city +
rural district). A **deferred read-back** (`DIFFUSION-STACK` / `DIFFUSION-STACK-ROLLUP`, and a
`★ STACK:` headline) reports how many stacked tiles kept **integration** — so your eyes confirm
the paint while the log confirms `setOwnership` didn't re-orphan the tile. If both hold, that's
the free + integrated + visible verb for Phase 1; if the tile reads ORPHAN, the next thing to try
is the reverse order or an explicit border-refresh call. Configurable via `AUTO.DEMO_UNOWNED_VERB`
(`stack` | `setOwnership` | `purchasePlot`).

## [1.0.4] - 2026-07-10

Cultural diffusion can now press **into** a rival's territory instead of stopping at their
frontier, with a new toggle to control how aggressively it does so. Defaults are conservative:
culture still spreads from the outside in and never claims an enemy city-center plot.

### Changed
- **Diffusion can now take tiles INSIDE a rival's ring, not just their frontier.** Rival
  city protection is now a radius, not an all-or-nothing shield: the new default protects
  only the enemy **city-center plot itself** (culture may claim the tiles around it and push
  inward ring by ring), where before the whole ring-1 "downtown" was shielded. Configurable
  under **Options → Mods → Cultural Diffusion → rival city protection**
  (Full downtown ring / Center only / Protect nothing). Replaces the boolean
  `cityCoreProtection` with `coreProtectRadius` (1 / 0 / -1).

### Added
- **"Contiguous border only" toggle** (`requireAdjacency`, default on). On: culture claims
  only tiles touching your land, taking a rival's territory from the outside in. Off: culture
  may claim any tile its field dominates, including a disconnected pocket inside another civ.

### Notes
- **Safe by default.** With `requireAdjacency` on and `coreProtectRadius` at Center-only
  (both defaults), culture claims a rival's tiles contiguously from the outside in and never
  the city-center plot — the same rival-tile capture the probe's capture stage exercised
  (developed tiles transfer and hold; tile-bound improvements survive). The disconnected-pocket
  behaviour (`requireAdjacency` off) reaches deep into a rival's worked footprint and is opt-in.

## [1.0.3] - 2026-07-06

Test-quality hardening only. No gameplay, balance, or shipped-behaviour changes — the shipped
`ui/`, `text/`, and modinfo content is identical to 1.0.2 apart from the version bump.

### Added
- Mutation-testing coverage for the six pure diffusion-logic modules
  (`cd-pressure`, `cd-field`, `cd-cpi`, `cd-state`, `cd-calibration`, `cd-civ-tuning`). Six new
  `tests/*-branches.mjs` harnesses raise the Stryker mutation score from **63.3% to 81.8%**
  (580 of 709 mutants killed, up from 449), with the diffusion-math modules at 86–94%. Every
  kill is a genuine behavioural assertion — no mutant was suppressed and no scope narrowed to
  inflate the number; the surviving mutants are equivalent (dead defensive branches, boundary
  equalities, try/catch-masked engine reads, and the intentionally-empty memento pipeline in
  `cd-civ-tuning`). Full write-up in `docs/mutation-analysis.md`.
- New `npm run test:*-branches` scripts, wired into `npm test` and `npm run verify`.

## [1.0.2] - 2026-07-06

Options-screen localization fix. No gameplay or balance changes.

### Fixed
- The mod's controls under the shared "Mods" Options tab now show their proper
  localized names rather than a raw `LOC_…` tag. Every label, description, and dropdown
  item resolves to a defined, mod-prefixed key in `text/en_us/ModText.xml`.

## [1.0.1] - 2026-07-04

Cross-mod compatibility and stability hardening so the mod coexists cleanly with
other players' mods. No gameplay or balance changes.

### Changed
- Turn-hook registration is now idempotent: the per-turn engine subscription is
  drained before it is re-registered, guaranteeing exactly one diffusion pass per turn
  even if the game scope re-runs the script within a session, and never stacking a
  duplicate handler on the engine event bus that other mods also use.

### Added
- Safety cutoff: after repeated internal errors the mod unsubscribes its own turn hook
  instead of retrying (and logging) every turn, so a fault can never spam the shared
  event bus. New `culturalDiffusion.stop()` console helper to unsubscribe on demand.
- Branded Workshop preview image.

## [1.0.0] - 2026-07-04

First public release. A reimagining and extension of the Civ V "Cultural Diffusion"
mod for Civilization VII.

### Added
- Reaction-diffusion culture field: cities inject culture into a persisted per-tile
  stock that diffuses to neighbours and decays each turn, so borders grow as a slow,
  organic travelling wave (ring 3 is a mid-game event; ring 5+ is a mature culture).
- Terrain shaping: culture follows roads and river valleys and is slowed or blocked
  crossing hills, mountains, tundra/desert biomes, and forest/jungle/marsh features.
- Fused injection strength: a geometric blend of culture with a prosperity/vitality
  aggregate, a per-civilization Cultural Power Index (wonders, great works, culture,
  influence, city-state suzerainties, happiness, golden ages, traditions, age), and a
  celebration bonus.
- Optional ethnic-affinity diffusion that reads the Emigration mod's diaspora data so
  borders follow people. Standalone-safe: neutral when Emigration is absent.
- Per-age tuning for Civ VII's three ages and game-settings calibration that paces the
  field to the current age length and nudges injection by map size.
- Bounded per-leader / civilization / memento balance layer for territory-redundant
  kits (e.g. culture-on-capture).
- Options: intensity presets (Low / Medium / High), enable switch, claim-empty-land-only
  safety mode, free-territory vs buy-with-gold verb, rich-cultural-model and
  follow-diaspora toggles, and debug logging.
- Single-player, flag-gated, reversible.
