# Changelog

All notable changes to Cultural Diffusion are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the mod uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] - 2026-09-26

### Added

The rest of Gedemon's Civ V model, built against what the 2026-09-25 probes proved
([`docs/civ-v-parity-spec.md`](docs/civ-v-parity-spec.md), results in [`docs/probe-history.md`](docs/probe-history.md) §6).

- **Cities carry every culture living in them** (`foreignCultureInCities`, on by default; spec §3 and §4). A city
  injects culture for every group present on its tile, not only its owner's: the owner at full strength, each foreign
  group at population strength (`foreignInjectScale`), weighted by that group's share of the population when the
  Emigration mod records one, and otherwise only once the group holds `foreignGroupMinStock` there, so a neighbour's
  trickle is never amplified. The city-tile cap now bounds the total culture on the tile, as in Civ V. Each turn the
  city converts `convertBase` (0.5%) of every foreign group's stock to its owner, plus a bonus per science and culture
  building it has and per ideology its owner holds (`convertBonuses`, a data table keyed by type name). A captured or
  mixed city therefore keeps producing its old culture, which contests the land around it and fades over time.
- **Culture transfer on capture** (`captureTransfer`, on by default; spec §5). When a city changes hands, every culture
  on its tiles loses `captureLoss` (55%) and the conqueror gains `captureGain` (75%) of the total lost, saved at once.
  The engine's `CityTransfered` event was watched reaching the mod for transfers between two other civilizations.
- **Every civilization gains land by culture** (`aiCultureFlips`, opt-in, Options toggle; spec §2). Inside the
  simulated region a living major whose culture decisively leads a tile takes it through its nearest city, under the
  same gates as the player's own claims (peace, the incumbent's core protection, adjacency to the leader's land,
  `flipMaxDistance`, the strand guard, its per-city cap, its own inner rings left to the base game), with its own
  per-pass ceiling. A rival can take one of your tiles and lose one the same way; you are told when it does.
  City-states and independent peoples never gain land this way. Far from your cities nothing moves, because the field
  is only simulated around them.
- **Armies hold the ground they occupy** (`conquestFlip`, opt-in, Options toggle; spec §6). During a war between two
  majors, a combat unit that holds an enemy tile for `conquestBufferTurns` (5) consecutive turns takes it for its
  owner, whatever the culture there. Leaving resets the count. The tile is then held for `conquestHoldTurns` (10):
  culture cannot flip it back meanwhile, but another army holding it through the buffer takes it at any time; after
  the hold it works the normal way. City centres and urban districts are never taken this way. Another civilization's
  armies do the same only when AI culture flips are also on. Watched in game: a planted Spearman held an enemy tile
  five turns, the tile flipped and was confirmed next pass. Watched again driven only by the Options checkbox, with no
  config patch: off by default, six turns of occupation took nothing; checked, the tile fell once the buffer filled;
  unchecked again, the live setting went off on the next pass.
- **Three small Civ V rules** (spec §8): a mountain source needs `sourceThresholdMountain` (7.5×) the threshold before
  it diffuses at all; every owned tile in the region keeps at least `ownerFloor` (1) of its owner's culture, so owned
  land never reads as empty in the lens; and the city-tile cap applies to the total (above).
- The pressure lens and its hover readout know about AI flips: with the toggle on, a tile another civilization's
  culture is winning is shaded and counted down only when that civilization's own gates would let it take the tile.

### Changed

- **Gold writes go through `Players.grantYield`.** `Treasury.changeGoldBalance`, the refund verb until now, was watched
  changing nothing for any player on 1.5.0, while `grantYield` lands within about 3 s for a rival as for us. A script
  `purchasePlot` was also watched costing nothing, so no gold moved either way; the change is insurance for a build
  that prices the purchase.

- **Rivers are a highway along them and a barrier across them, for both kinds of river.** Until now any step onto a
  river tile, from any direction, got the "follow the river" bonus, so rivers sped culture across them: the opposite of
  the Civ V original, where a river carried culture along its bank and held it back from the far side. Now a step from
  one tile of a river to the next follows it, and a navigable river is the stronger highway (+100% rate and a ×2.5 cap,
  as strong as a road, against +65% and ×1.8 on a minor river). A step onto a river from its bank, from the other kind
  of river, or from a differently named river crosses it, and pays Civ V's river-crossing gate once: the source needs
  twice the base threshold, the rate takes a 50% malus and the cap falls to ×0.35. Stepping off a river is free.
  New keys `navigableFollowBonus`, `navigableFollowMax`, `terrainRiverCross` and `terrainNavigableCross`. Unit-tested
  in `tests/rivers.mjs` and watched in game on 2026-09-25: from a seeded field, one pass delivered 1.65× along a minor
  river, 2.0× along a navigable one, 0.67× and 0.61× across them, and nothing across below the gate, each exactly the
  value the field math predicts ([`docs/probe-history.md`](docs/probe-history.md) §6). Spec:
  [`docs/civ-v-parity-spec.md`](docs/civ-v-parity-spec.md) §1.

## [1.2.0] - 2026-09-24

### Fixed

- **The border no longer closes the last way out on another civ's unit.** A player reported an AI Settler stuck inside
  their territory with no diplomatic access, freed only by declaring war. That is now **reproduced in game** and the
  cause is this mod: harness run 17 (1.5.0, 2026-09-24) let the mod's claims take every plot around a peaceful major's
  Scout, and the unit - which had moved every turn until then - sat frozen on the same plot for five consecutive turns.
  A claim that would leave such a unit with no legal move is now refused, and the tile is taken later, once the unit has
  moved on ([`ui/cd-units.js`](ui/cd-units.js), gated last in `flipEligible` so only a tile that has already won on
  culture pays for the map reads; the same rule applies to the "+1 ring" growth buffer).
  - **Only civs we are at PEACE with are protected.** Independent Powers and anyone at war cross our territory freely
    (an Independent reads as at war by default), so their units never block a claim. Watched: the same pen around an
    Independent's unit is harmless.
  - **The test is IMMOBILITY, not confinement.** A unit that can still step somewhere legal is fine, even shut inside a
    small pocket; the bug is a unit with NO legal destination.
  - **What blocks a unit depends on which element it is in.** A land unit ashore is stopped by water, a SHIP by land,
    and an EMBARKED land unit - measured on the map, 40 of them reading `DOMAIN_LAND` while standing on water - may use
    both. Treating water as blocked for everyone meant no ship and no embarked unit was ever protected, although the
    pass can own water (`diffuseAcrossWater` is on, and the +1 buffer claims unowned water). Every occupant of a stack
    is judged separately.
  - **Impassable terrain blocks everything, and one read covers it all.** `GameplayMap.isImpassable` was measured
    against the DB (49 impassable-terrain plots, 7 impassable-feature plots, **0 missed**), so `TERRAIN_MOUNTAIN`,
    `FEATURE_VOLCANO`, `FEATURE_ICE` and the sixteen impassable natural wonders need no special case.
  - **Only OUR claim being the cause counts.** Comparative: could it move before, can it move after. A unit already
    immobile does not block anything, and claiming the ground a unit stands on is never refused, because what it may
    move to is its neighbours, which that claim does not change. Once the unit moves on, the tile is claimed normally.
  - **Claims already sent this pass count as ours.** `purchasePlot` applies seconds after the call, so without this the
    second claim in a pass re-counts an exit the mod has already taken - which is how a unit with two exits lost both
    in one pass. The keys come from `cd-pending.js`.
  - New code-only tunable: `protectTrappedUnits` (default on). The units reads fail open, so an unreadable API degrades
    to the previous behaviour rather than stalling the pass.
  - **Known limit, measured rather than assumed:** the guard counts any plot not ours as a destination, although a unit
    of civ A also cannot always enter civ B's borders. Two readings settle why it stays that way. A census of 459
    foreign units found 30 standing in a third party's territory, 9 of 10 sampled at PEACE with its owner, so access is
    routinely granted and blocking third-party land outright would refuse claims along every shared frontier. And the
    engine exposes no access read: the whole Diplomacy surface is relationship ATTITUDE
    (`getRelationshipLevel`/`Name`/`Enum`, `hasAllied`, `hasAvailableTreatyActions`) and none of it separates an
    at-peace major from an at-war one - both read `LOC_PLAYER_RELATIONSHIP_HOSTILE`, the same enum, `hasAllied` false.
    So a unit wedged between our border and a third party's can still be stranded (7 such units on the test map, none
    within `flipMaxDistance` of us). Recorded in `docs/BACKLOG.md`.
  - **Watched working** (harness run 23): with a peaceful major's Scout down to one exit, the pass logged
    `skip flip 79,37: would strand a foreign unit`, left the plot unowned, and the Scout walked out through it
    (79,37 then 79,38 then 78,39). Three earlier drafts were watched FAILING in game while these same unit tests
    passed - pocket semantics, deferred writes, and mountains-as-exits - each fixed only after being measured. The
    naval case is **confirmed on a real ship** (run 29b): a `UNIT_KALAM` three rings from one of our cities had five of
    its six water neighbours bought, and the guard read it as `{domain: DOMAIN_SEA, water: true, land: false}` with
    `exitsNow=1 exitsAfterClaim=0 wouldStrand=true`. The embarked case rests on the same reads plus off-engine tests.

### Investigated

- **Moving the unit aside instead is engine-closed, not merely unbuilt.** Harness runs 13 and 16: against a rival
  Settler, `UNITOPERATION_TELEPORT_TO`, `MOVE_TO`, `SWAP_UNITS` and `TELEPORT_TO_CITY` all returned `canStart` false and
  moved nothing; none moved one of OUR units either; `MOVE_TO` on our own Scout returned `canStart` **true** while the
  unit never moved; and `TELEPORT_TO` is absent from the runtime `UnitOperationTypes` enum despite being a row in the
  compiled gameplay DB. `WorldBuilder` exposes no unit-placement member. A short-lived eviction built on that verb was
  removed. The engine does not relocate the occupant when our claim lands either.
- **Claims do not silently revert.** Nine plots bought at rings 4-7 from the buying city stayed ours for five turns,
  including two rings from a rival major's city. Five plots bought at ring **8** were all released within one turn, so
  claim durability tracks distance from the OWNING CITY - comfortably outside `flipMaxDistance` (6), which is why the
  mod's own claims hold.
- **A minor settlement was being stripped of its land, which is the reporter's "absorbed independent".** With
  `coreProtectRadius: 0` - reasonable against a major - only the centre PLOT was protected, and a city-state or village
  owns just a ring or two in total, so diffusion took everything else and left the settlement sitting alone inside our
  territory. Watched in harness run 13: the pass flipped 89,41 and 90,42, both ring-1 of city-state 33's centre at
  89,42. **Fixed** by `minorProtectRadius` (default 1), a floor on protection for any owner that is not a major.
  Confirmed in game (run 19) by an A/B on three of a real city-state's ring-1 plots: `claimAllowedWithFloor=false`,
  `withoutFloor=true`.
- **Core protection can now see a settlement no city list reports.** `isCoreProtected` found centres only by walking
  `Players.get(pid).Cities.getCities()`, which returns NOTHING for an Independent Power. It now also reads the map
  (`isCityCenterAt`, via `Cities.getAtLocation`), so a village centre is protected regardless of owner kind. Validated
  against the live engine in run 18: all six of our own centres detected, five minor-owned centres found where the
  earlier district-type read found none, and the pass refused a centre carrying a 50,000 culture seed.
- All four verdicts are recorded in `civilization_vii_mods/engine-closed.md`.
- **A non-deterministic native crash turned up while stress-testing this build, and is PARKED rather than fixed.**
  Two of four long unattended harness runs faulted, on different threads with different addresses; a third run with
  the mod active then passed both crash points holding more claims than the run that died. 2 crashes / 3 runs with
  the mod against 0 / 1 without is too weak to act on, and no code was changed on the strength of it. Full evidence,
  including why a config bisect was not run and what it would cost, in
  [`docs/potential-bug-native-crash.md`](docs/potential-bug-native-crash.md).

### Added (dev only)

- **`scripts/check-esm.mjs` now fails when a `ui/*.js` module is not declared in the modinfo.** The engine only serves
  declared files, so an undeclared module makes its importer fail at load and takes the whole action group down - the
  mod looks dead, not like a missing file. It caught exactly that on `cd-units.js` before a probe run.
- **`devtools/harness/run-harness.sh`**, a hands-free runner: refuses to start if the game is running or another
  session's probe is installed, preserves the shared `UI.log`, backs up autosaves, restores the mod registry **by
  value** (redeploying mints a new `ModRowId`, so restoring by row id leaves the mod enabled), and collects the log plus
  any crash report.

## [1.1.0] - 2026-09-18

### Added

- **An Options toggle for the "+1 ring" growth buffer, now off by default.** Players asked how to turn it off. *Claim
  land beside new improvements (+1 ring)* controls `growthBuffer`. It now defaults to off, following the rule that
  territory-changing features are opt-in; since 1.0.6 it had been always on. Existing players get the new default,
  because no earlier build stored a value for it. Switching it on or off takes effect at the next finished improvement.
- **Borders can recede (opt-in `recedeBorders`, off by default).** The flow-back half of the Civ V model, which
  the docs described but the pass never did. Each pass walks only the tiles this mod claimed. A claim a rival now
  out-cultures by the same decisive margin a claim needs is ceded to that rival's nearest city (`purchasePlot`,
  refunded to the rival). Peace, `flipMaxDistance`, `requireAdjacency`, the cooldown lock and `maxFlipsPerTurn` all
  apply, and tiles your cities grew are never touched. There is no release to no one: harness runs 1 and 2 showed
  `setOwnership(NO_PLAYER)` never un-owns a tile attached to a city, so that branch was removed. The rival-city
  `purchasePlot` is watched working, and so is the mod's own cession: harness run 12 (2026-09-18) seeded a claim a
  rival at peace out-cultured, and the recede step sent the cession, the tile landed with the rival's city, and the
  next pass confirmed it and locked the tile. It stays off by default because territory-changing features are opt-in.
  New Options checkbox: *borders recede (experimental)*.
- **Debug diagnostics for failures that are otherwise silent.** With debug logging on, each pass logs every
  injector's culture, vitality, strength and city-tile stock against its cap (`inject ...`), each city's best stock
  on the first ring the mod may claim against the ownership bar (`frontier ...`), and the persisted state size with
  the pass time (`state bytes=...`). The state line is logged without debug once the blob passes 512 KB.
- **Cultural Pressure lens and hover tooltip** (Phase 1: shading, civ split, turns-to-flip estimate). Watched painting
  a contested tile in-game on 2026-09-13 (harness run 11). The lens shades, and the readout counts down, only tiles
  the pass can act on: your culture leading on unowned or rival land, or with recede on, a rival leading on a tile the
  mod claimed for you. A tile an AI's culture leads that the pass will never flip shows its stocks with no progress or
  turns line. One predicate (`passCanAct` in `cd-field.js`) now gates the pass, the recede step, the lens and the
  readout, so they cannot drift. Watched in harness run 12: every AI-led tile the earlier rule would have painted was
  left unpainted with no progress line, and the seeded rival-led claim was painted with one.
- **In-game test harness (`devtools/harness/`).** A dev-only mod that loads a save from the main menu, presses Begin
  Game, runs scripted engine tests, and ends turns, all hands-free, logging `[CDH]` lines to `UI.log`. Run 1 on
  AugustusAnt136 (game 1.4.2) produced the two fixes below and the watched verdicts in `docs/probe-history.md` §5.

### Fixed

- **Saving an option could copy another mod's data into the shared settings key.** The game's `localStorage.getItem`
  can return the value of a different key (watched 2026-09-16), so the settings read before a save could be another
  mod's blob. It parsed as an object and was written back under `modSettings`, growing it without bound. The save now
  declines unless every top-level value is a per-mod object, and never rewrites or deletes anything it did not write.
- **The mod's settings disappeared after closing Settings, until the game restarted.** Reported by a player. The base
  Options model rebuilds its option list from registered init callbacks whenever it re-initializes, for example when
  graphics options change as Settings applies or closes. The mod added its options once at load without a callback,
  so any rebuild wiped them. They now register through `Options.addInitCallback`, as the Emigration mod does, with a
  fallback for a script that loads after the model has already initialized.
- **Flips were never recorded in the real game.** Found by harness run 1 on game 1.4.2: `city.purchasePlot` changes
  ownership after the call returns, so the same-tick owner read the pass used as its success check always showed
  the old owner. Every real flip was logged `NOT APPLIED` and left no claim, no cooldown lock, no per-city budget and
  no per-turn count, and the recede step never saw a claimed tile. A verb whose result has not landed is now
  recorded as pending (`cd-pending.js`) and confirmed from the live map at the start of the next pass. Pending flips
  count toward `maxFlipsPerTurn` and `maxDiffusionPlots` meanwhile. This covers diffusion flips, the +1 buffer, and
  recede cessions. Watched working in-game: harness run 5 sent 29 flips across an age change and confirmed all 29.
- **Every age read as Antiquity on the real engine.** `Game.age` is a numeric hash, but both age readers only
  accepted strings. Per-age injection and ownership-bar scaling, water easing and the Distant Lands gate therefore
  never changed after Antiquity. The age now resolves through `GameInfo.Ages.lookup(Game.age).AgeType`, the lookup
  the base game uses.

### Removed

- **The work-radius `GlobalParameters` override (`data/cd-work-range.xml`) is withdrawn before release.** Its entry
  here claimed `CITY_MIN_RANGE` went 3→6, but the file set it to 3, a no-op. The three parameters it did raise to 6
  (`CITY_MAX_BUY_PLOT_RANGE`, `PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE`, `CITY_EXTENDED_CLAIM_RANGE`) were already shown
  in-game not to move the ring-3 work wall, and they widened border reach for every civ, AI included. The work radius
  is native and not moddable: see [`docs/civ7-tile-range-investigation.md`](docs/civ7-tile-range-investigation.md).

## [1.0.7] - 2026-07-13

### Fixed

- **The mod no longer locks tiles inside your own city's 3-ring (regression from 1.0.6).** After
  1.0.6 switched the claim verb to `purchasePlot`, the diffusion pass, the +1 buffer, and the
  orphan-repair were force-buying *unowned tiles inside your own natural rings* and attaching each
  to the **geometrically nearest** of your cities. When two of your cities sit close together, a
  tile in **City A's** workable ring that happens to be a hair closer to **City B** was deeded to
  B — so A could no longer work it, and if B was too far, nobody could. This is the reported
  *"restricting me from working some, but not all, tiles within the 3-ring of my city centre."*
- **The base game now owns and allocates your inner rings, always.** Rings within
  `baseGrowthRadius` (3) of any of your cities are ceded entirely to the base game, which assigns
  each tile to the city that can actually **work** it. The mod only ever claims the **frontier
  beyond** that ring — the anti-forward-settling buffer, which was always its purpose. The
  diffusion flip (`flipCandidates`) and the +1 buffer (`bufferTarget`) now skip any tile within a
  local city's natural ring.
- **Existing damaged saves self-heal.** A new per-pass reconciliation (`releaseInnerClaims`)
  releases any tile the 1.0.6 build already force-bought inside your natural rings back to the base
  game, which re-acquires it and re-assigns it to the workable city. Orphan-repair
  (`repairOrphans`) likewise now **releases** inner-ring orphans instead of re-buying them to the
  nearest city (it still re-integrates true *frontier* orphans). Healing is one-shot per tile and
  logged as `N inner tile(s) released to base game`. So a save broken by today's earlier update
  repairs itself within a turn or two of loading 1.0.7 — every 3-ring tile becomes workable again.

## [1.0.6] - 2026-07-13

### Added

- **The reaction-diffusion field now spreads across water (`diffuseAcrossWater`, on by default).**
  Previously the slow diffusion form was land-only (water was excluded from the region and hard-
  blocked as a diffusion destination). Culture now crosses water, but slowly and only once strong
  enough: shallow **coast** has a lower crossing gate (`terrainCoast`) than deep **ocean**
  (`terrainOcean`, near-impassable), so an established coastal culture can island-hop and claim
  **some** land across the sea while a weak one stays landlocked.
- **Water crossing eases across the ages (`byAge[...].waterEase`).** As sea travel matures the
  crossing gates shrink: **Antiquity** keeps the full malus (deep ocean near-impassable),
  **Exploration** drastically eases it (`waterEase 0.65` — ocean-going ships), and **Modern**
  removes the water penalty entirely (`waterEase 1.0` — blue-water culture spreads across oceans
  like open land). Applied to both coast and ocean gates.
- **waterEase ramps continuously *within* each age (`waterEaseRamp`, on by default).** Rather than
  stepping at the age boundary, the crossing difficulty interpolates from the current age's anchor
  toward the next age's, by progress through the age (`Game.turn / Game.maxTurns`). So over the
  Exploration age ocean crossing eases smoothly from `0.65` up to ~`1.0` (near-free by the age's
  end), and late Antiquity softens from full-malus toward Exploration levels — an organic ramp that
  models maritime capability growing during an age. Set `waterEaseRamp: false` for flat per-age steps.
- **Distant Lands are off-limits until the Exploration age (`blockDistantLandsBeforeExploration`,
  on by default).** Culture may claim home-hemisphere islands across nearby water anytime, but it
  cannot claim tiles in your **Distant Lands** (the far hemisphere) before the Exploration age —
  matching the base game gating ocean crossing to Exploration. Applies to both the diffusion flip
  and the +1 buffer. Uses the base-game `player.isDistantLands({x,y})` check.
- **Event-driven "+1 ring" cultural buffer (`growthBuffer`, on by default).** When the local player
  **completes a rural improvement** on a tile (a manual rural-growth event — "we improved a
  resource/tile", via the `ConstructibleAddedToMap` engine event), the mod claims only the
  **unowned tiles adjacent to that developed tile** — not the whole ring — attaching them to the
  nearest city as integrated, workable tiles. So developing a frontier tile pushes your cultural
  border one tile past it, organically, paced to your own development. It claims adjacent **unowned
  land and water** (coastal borders) and **never** takes a tile owned by another player (peaceful
  rival capture stays with the slow reaction-diffusion pass); claims are capped to
  `baseGrowthRadius + 1` rings from the city so the buffer can't creep. Logged as
  `buffer: +N tile(s) adjacent to rural growth at x,y`.

### Fixed

- **Heals legacy orphan tiles baked into existing saves (`repairOrphans`, on by default).** A save
  played under an older `setOwnership` build has orphan tiles (owner = you, no owning city) around
  your cities; those block the base game's own inner-ring population/border growth from ever
  acquiring them — a city "won't expand" into a tile it should. Each pass now finds these orphans
  in-region and re-integrates them into their nearest city via the integrated verb (releasing any
  it can't re-buy, so the base game can grow into them). The inner rings again fill through normal
  base-game growth **and** cultural diffusion, with no orphan blocking either. The pass logs
  `N orphan(s) healed` whenever it heals a tile (visible without debug logging).
- **Claimed tiles are now integrated city tiles, not orphans (Phase 1 verb switch).** The
  shipping flip verb is now `purchasePlot`, which attaches each claimed plot to your nearest
  city as a real, workable tile (`owningCity` set, `inCityPlots` true). The previous default,
  `setOwnership`, made the plot yours but attached it to **no** city — an orphan that could not
  be worked **and blocked the base game's own population/border growth from ever acquiring that
  tile** (the reported "some tiles won't expand" bug). The integrated verb was proven by the
  Phase 0 probe (2026-07-09) but had never been promoted from `probe/` into the mod.
- **Gold cost is refunded the same tick (`refundGold`, default on).** `purchasePlot`'s cost is
  restored via `Treasury.changeGoldBalance` the same frame, so integrated claims net zero gold
  and never touch the demographics gold-per-turn metric. Contiguous frontier claims were already
  effectively free; the refund makes every claim free regardless.
- **A failed purchase no longer falls back to `setOwnership`.** The old fallback silently
  re-created the orphan tile on any purchase failure. A failed claim now simply skips the tile
  for the turn; the culture field keeps it and the pass retries.
### Changed

- **Removed the "how tiles are claimed" (flip-verb) option from the Options screen.** With the
  integrated verb now free, the legacy *Free territory* choice had no upside and only produced
  unworkable orphan tiles that block city growth, so it is no longer a user-facing footgun.
  Every player now gets the integrated verb; any stale saved verb choice from an older version
  is ignored. The `setOwnership` path remains in code (used by `unclaim`, and as a
  `cd-config.js` testing escape hatch).

### Probe (v0.8.0 — Phase 0, `probe/`)

- **Q-VERB — the flip-verb decision gate** (probe-history.md §2). For a distinct tile per
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

## [1.0.5] - 2026-07-11

### Fixed
- **Mod now shows its name in Additional Content.** The mods browser listed the mod as the raw
  `LOC_MOD_CULTURAL_DIFFUSION_NAME` tag (and its description as a tag) because the name/description
  strings were only loaded into the in-game text database by an ActionGroup, which the frontend
  reads too late. Added a top-level `<LocalizedText>` block so the name and description resolve at
  mod-discovery time — the mod now reads as **Cultural Diffusion**.
- **No more phantom territory claims.** A tile flip is now recorded only after confirming the
  tile actually changed owner. Previously a flip attempt that silently did nothing (the default
  verb no-ops on rival-owned land) was still booked as a success — consuming the settlement's
  claim budget, locking the tile on cooldown, and firing a "claimed territory" toast while the
  rival kept the tile. (The permanent fix — switching the claim verb — remains the redesign
  plan's Phase 1.)

### Removed
- Two unused, unwired config flags (`preventForwardSettle`, `minimalOwnedCulture`);
  anti-forward-settling is an emergent property of the diffusion field, not a discrete toggle.

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
