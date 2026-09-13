# Cultural Diffusion — Won't-Build Decisions (with justifications)

The canonical record of **features or approaches we designed, specced, or attempted and then decided not to build** —
each with the concrete reason there is no viable (or appropriate) path, and a one-line **verdict**. Documented here so
no future session re-discovers and re-attempts them.

Mirrors the sibling mod's pattern
([`emigration/docs/wont-implement-with-justifications.md`](../../emigration/docs/wont-implement-with-justifications.md)).

> **Reasons (the "why" — every entry is tagged with one).** This file is organized by *why* we won't build a thing;
> "superseded" is one such reason and lives here rather than in its own file:
> - **Proven non-functional** — the engine does not support it (with in-game evidence).
> - **Superseded** — built or specced, then **replaced** by a better path that reaches the same goal. The old path is
>   retired; **superseded ≠ impossible** — the justification says what replaced it and why, so no one resurrects it.
>   Full design history stays in the spec.
> - **Redundant** — the base game already provides it; nothing to build.
> - **Model-misaligned** — contradicts the mod's organic reaction-diffusion design; the intent is met *emergently*
>   instead.
> - **Paused — not engine-blocked** — no wall; parked for priority, with a revisit trigger.

> **How this differs from the neighbouring docs.**
> - [`potential-future-features.md`](potential-future-features.md) — work we still intend to do.
> - [`wont-fix-with-justifications.md`](wont-fix-with-justifications.md) — decisions **not to change** existing, working
>   behaviour. Closed by judgment, not by a wall.
> - **This file** — features/approaches with **no path (or no reason) to ship**, grouped by the reasons above.
>
> **Standing convention — keep this list current.** When an approach is abandoned or retired, add a `##` entry with:
> what was proposed, why it was tempting, the concrete reason it won't ship, what we did instead, and a **Reason** tag +
> **Verdict**.

---

## `setOwnership` as the flip / capture verb — REJECTED (proven non-functional on owned land)

**Reason: Proven non-functional.**

**Proposed / shipped, then retired:** the original spec chose `WorldBuilder.MapPlots.setOwnership` as the default flip
verb — free, no gold, no growth cost (recorded now in [`current-model.md`](current-model.md) §7 and
[`probe-history.md`](probe-history.md) §4; the old `flipVerb:"setOwnership"` default).

**Why it was tempting:** it is the only truly *free* territory write, matching the design's "culture grants land, the
player earns the yields" cost model.

**Concrete reason it won't ship:** the 2026-07-08 in-game probe (~600 logged flips) proved `setOwnership` **fails on
rival land — 102/102 `no-change`** (returns without error, the tile stays the rival's), and on empty land produces an
**orphan** (`owningCity=NONE`, not workable/buildable). The original probe's "Q-RIVAL green" was a **false positive** —
`setOwnership` only ever re-flipped tiles the player *already* owned (they trivially re-read as owner 0). Source:
[`probe-history.md`](probe-history.md) §2.

**What we did instead:** `flipVerb = "purchasePlot"` (integrated, city-attached), made **net-free** by a same-tick gold
refund ([`ui/cd-ownership.js:133`](../ui/cd-ownership.js) `flipViaPurchasePlotRefunded`). `setOwnership` is retained
**only** for `unclaim` ([`ui/cd-ownership.js:155,175`](../ui/cd-ownership.js)).

**Verdict:** **Won't build the mod on `setOwnership`.** Kept only as the un-claim / return verb. *Revisit only if* a
future patch makes `setOwnership` integrate tiles and take rival land.

---

## Instantaneous charge / maturity pressure model — SUPERSEDED (replaced by the culture field)

**Reason: Superseded — replaced by a better path, *not* impossible.**

**Specced / partly built, then retired:** the original core model computed pressure as an **instantaneous closed-form
reach**, gated by a per-plot **charge accumulator** (charge builds while a civ dominates, the plot flips at
`flipThreshold` after `sustainTurns`, decays when the lead eases) and a **maturity / momentum** reach gate. Tunables:
`flipThreshold` (as charge) / `flipMargin` / `chargeGain` / `chargeDecay` / `sustainTurns`, plus the maturity knobs.

**Why it was tempting / why we built it:** a direct, legible "pressure → charge → flip" loop mirroring emigration's
violence score — easy to reason about per plot.

**Concrete reason it won't ship:** it was **too fast and partly degenerate** — reach was a distance calc that filled
~10–40 turns with no physical build-up, and the maturity gate made a lone/early leader "strongest" by default (full
reach on turn 1). Replaced (2026-07-04) by a persisted per-tile **reaction-diffusion culture field** (`cd-field.js`:
inject → diffuse → decay → flip) that paces **emergently**, ring by ring against decay. Source:
[`current-model.md`](current-model.md) §2 (the field that replaced it).

**What we did instead:** the field model, shipped and live ([`ui/cd-field.js`](../ui/cd-field.js),
[`ui/cd-state.js`](../ui/cd-state.js) v2). The scoring work (CPI, prosperity, ethnic affinity) was **kept** — it now
shapes each city's *injection strength*, not an instantaneous reach. Retired with the model: the charge accumulator,
maturity/momentum gate, `resistancePressure`, and `civPressureAt`/`dominantAt`.

**Verdict:** **Superseded — do not resurrect.** The goal (culture-driven flips) is fully shipped via the field; this
entry exists so no future session rebuilds the charge/maturity loop thinking it is missing. Full equations remain as
**design history** in [`current-model.md`](current-model.md) §7.

---

## `maxGoldPerTurn` gold-budget cap — SUPERSEDED (by the refund)

**Reason: Superseded — the refund removed the thing it was meant to cap.**

**Proposed:** a gold-cap fallback to the verb decision ([`probe-history.md`](probe-history.md) §2) — if the flip verb
had to be `purchasePlot` (gold), expose a per-turn gold ceiling so flipping dozens of tiles could not bankrupt the
player (the no-treasury-drain rule, [`current-model.md`](current-model.md) §4).

**Why it was tempting:** it is the obvious guardrail for a gold-spending flip verb.

**Concrete reason it won't ship:** the same-tick **refund** ([`ui/cd-ownership.js:133`](../ui/cd-ownership.js)) makes
`purchasePlot` net-zero gold, so there is no treasury spend to cap. A cap would be dead config with nothing to gate.

**What we did instead:** refund each plot's cost the same tick (balance-only restore, no visible dip).

**Verdict:** **Won't build.** *Revisit only if* the refund path regresses (e.g. a patch blocks the same-tick grant) and
the mod must fall back to a real gold spend.

---

## Discrete anti-forward-settle targeting mechanic (`preventForwardSettle` / `minimalOwnedCulture`) — WON'T BUILD

**Reason: Model-misaligned — the intent is met emergently.**

**Proposed:** a `preventForwardSettle` (default `true`) flag — "prioritize claiming open buffer plots between you and
rivals" — plus `minimalOwnedCulture`.

**Why it was tempting:** denying AI forward-settling is the mod's stated *primary purpose*
([`current-model.md`](current-model.md) §1), so a knob that directly targets the buffer plots looks like the direct
route.

**Concrete reason it won't ship:** the mod is organic reaction-diffusion pacing (its Civ V CultureDiffusion lineage).
Denying rival forward-settlement is meant to **emerge** from natural cultural pressure organically owning the buffer — a
special-cased targeting flag would contradict the organic model, and the emergent behavior already covers the intent.
Both flags were also referenced nowhere in `ui/` (dead config). Source: [`BACKLOG.md`](BACKLOG.md) "Documented features
… never consumed."

**What we did instead:** **removed** both flags + their JSDoc; anti-forward-settling is now documented as an *emergent
property* of the diffusion pass, not a discrete mechanic.

**Verdict:** **Won't build as a discrete mechanic** — it is emergent by design.

---

## Free-integrated verb via `Growth.claimPlot` / `CREATE_ELEMENT DISTRICT_RURAL` — NOT PURSUED

**Reason: Paused — not engine-blocked.**

**Proposed:** the free-verb probe fork ([`probe-history.md`](probe-history.md) §2) — probe whether
`city.Growth.claimPlot` or a `DISTRICT_RURAL` create integrates a tile **without** gold, as a cleaner free-integrated
verb than a refunded `purchasePlot`.

**Why it was tempting:** a natively-free integrated verb would beat spend-then-refund and remove the refund's dependence
on a same-tick grant.

**Concrete reason it won't ship (now):** the refunded `purchasePlot` path already delivers net-free integration and is
proven in-game, so this Phase-0 fork lost its purpose before it was run. A second verb adds maintained surface with no
user-visible gain.

**What we did instead:** shipped refunded `purchasePlot`. The exact call shapes remain recorded in
[`reference-and-conventions.md`](reference-and-conventions.md) §3 if ever needed.

**Verdict:** **Paused — not engine-blocked.** *Revisit only if* refunded `purchasePlot` proves unreliable.

---

## Usable outer-ring tiles / an extended work radius — WON'T BUILD (proven non-functional: native)

**Reason: Proven non-functional.**

**Proposed / partly shipped, then withdrawn:** two routes to turning the frontier the mod claims (beyond ring 3) into
land a city can work and develop. First, the claim that `purchasePlot` integration alone makes a far tile workable (the
old `current-model.md` §5 "Usable outer-ring tiles" bullet and `potential-future-features.md` §3). Second, the unreleased
v1.1.0 `data/cd-work-range.xml` `GlobalParameters` override, which raised `CITY_MAX_BUY_PLOT_RANGE`,
`PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE` and `CITY_EXTENDED_CLAIM_RANGE` to 6 and left `CITY_MIN_RANGE` at 3 while its
changelog entry said 6.

**Why it was tempting:** integration really does attach the tile to a city (`owningCity` set, `inCityPlots` true), so it
looks like the city's own land; and those parameter names read like the range lever.

**Concrete reason it won't ship:** the workable/developable set is computed in native C++ and handed to JS as an opaque
plot list, and no data row or JS input moves it. The same three parameters raised to 6, confirmed applied in the live
DB, produced zero change to the buildable ring in-game. Community reverse-engineering hit the same wall, and the only
franchise precedent (Civ VI "Workable 4th Ring") replaced the engine DLL, which Civ VII does not allow.
`CITY_MIN_RANGE` is settlement spacing only. The override also widened border reach for every civ, AI included. Full
record: [`civ7-tile-range-investigation.md`](civ7-tile-range-investigation.md).

**What we did instead:** withdrew the override before release, and reframed claimed land in the README, model doc and
Steam copy as a settle-denial buffer plus rival frontier capture, not developable land.

**Verdict:** **Won't build.** *Revisit only if* Firaxis ships a modding toolkit or source access that exposes the work
radius.

**Watched again in-game (harness run 3, game 1.4.2, 2026-09-12).** Both script routes around the limit were tried
against a ring-4 tile attached to Lāhainā. A pending citizen added with `addRuralPopulation(+1)` was not offered
any plot beyond ring 3. Ordering it onto the far tile with `CityCommands.sendRequest(EXPAND, {X,Y})` returned true, but
nothing was placed and the citizen stayed pending, while the same citizen placed a fishing boat on an offered ring-1
plot. `CREATE_ELEMENT` improvements were refused on two ring-4 tiles: a mine on a hill, a woodcutter on woodland, and a
copy of the town's Potkop on each. In the same session the same call recreated that Potkop on ring 3. The engine
enforces the ring-3 limit inside both operations, not just in the list the interface offers.

---

## Releasing a claimed tile to no one (recede "release" branch) — WON'T BUILD (proven non-functional)

**Reason: Proven non-functional.**

**Proposed / built, then removed:** the opt-in recede step released a claim whose own culture had faded below half the
ownership bar, via `unclaim` (`WorldBuilder.MapPlots.setOwnership(NO_PLAYER, loc)`), with a floor-to-bar hysteresis
band (`recedeFraction`).

**Why it was tempting:** it is the Civ V behaviour. A culture that fades should lose its frontier, and not only to a
rival that out-cultures it.

**Concrete reason it won't ship:** on game 1.4.2 `setOwnership(NO_PLAYER)` never un-owns a tile attached to a city.
Harness run 1 found the tile still owned three seconds and twelve turns later. Run 2 tried three more variants and all
failed after ten seconds: setting ownership to ourselves first, clearing after checking for a district (none existed),
and a plain clear. No other ownership-writing call exists in the base game's scripts. The branch could only send a call
that stays pending and is dropped every pass.

**What we did instead:** removed the branch and `recedeFraction`. Cession to a rival through the rival city's
`purchasePlot`, which is watched working, is the only way a claimed tile leaves. A faded claim stays ours.

**Verdict:** **Won't build.** *Revisit only if* a future patch lets `setOwnership` or another call release a
city-attached tile. The 1.0.7 `releaseInnerClaims` heal has the same dependency (see `BACKLOG.md`).
