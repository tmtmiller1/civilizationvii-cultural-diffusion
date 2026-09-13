# Cultural Diffusion — Current Model (authoritative)

What the mod **is** as shipped (v1.0.7): the reaction-diffusion culture field, the fused scoring that shapes it, the
flip verb, and the rules that gate ownership changes. This is the single source of truth for current behaviour.
Forward-looking work lives in [`potential-future-features.md`](potential-future-features.md); the feasibility record
that got us here is in [`probe-history.md`](probe-history.md); build-time reference (verb call shapes, state schema,
guards) is in [`reference-and-conventions.md`](reference-and-conventions.md).

House rules (enforced everywhere): single-player only (`guardSP()`), flag-gated, reversible, **never** write
`GameConfiguration` at runtime, nothing ships without a probe.

---

## 1. Pitch

Borders are no longer purely a function of city growth. A settlement's **culture, ethnicity, and prosperity** generate
outward cultural pressure **on top of** the game's native population-driven expansion — never replacing it. A frontier
plot accumulates pressure from every settlement that can reach it; when one civ's culture dominates the current owner's
for a sustained, decisive margin, the plot **flips** — even past the owning city's normal growth cap. Rivals push back;
a contested plot is genuine border competition, and borders flow **back** when a source weakens.

**Primary purpose — a systemic fix for AI forward-settling.** A strong / prosperous / culturally-dominant civ
organically projects territory into the buffer land next to a rival, claiming the frontier tiles the AI would
forward-settle into. An owned plot blocks foreign city founding, so expanding the border *is* the deterrent. If the AI
still settles nearby, your dominant culture flips its frontier tiles over time — but **core-protected**, so you *cramp*
a bad settle rather than delete it. Because it is metric-driven and reversible, it self-corrects.

> **Anti-forward-settling is emergent, not a discrete mechanic.** The earlier `preventForwardSettle` targeting flag was
> removed — see [`wont-build-with-justifications.md`](wont-build-with-justifications.md).

---

## 2. Core model — the reaction-diffusion culture field

The mod runs a persisted per-tile **culture field** (a cellular automaton adapted from the Civ V "Cultural Diffusion"
mod, v18). Each local-player turn it runs one pass — **inject → diffuse → decay → flip** — over a bounded region around
the local player's cities. The math is pure and lives in [`ui/cd-field.js`](../ui/cd-field.js); the per-turn
orchestration is `runPass()` in [`ui/cd-pass.js`](../ui/cd-pass.js).

- **Inject.** Each city adds `strength * sqrt(currentOwnCulture * injectRatio) + injectBase` (self-amplifying), capped
  at `strength * cityCapFactor`. "Strength" is the fused CPI / prosperity projection (§3), not raw culture.
- **Diffuse.** A source above `cultureThreshold` delivers `src * effRate` to each of 6 neighbours, where `effRate =
  rate*(1+bonus)/(1+malus)`; the neighbour is capped at a fraction of the source (`normalMax`, higher along
  roads/rivers). Terrain gates/penalties via [`ui/cd-terrain.js`](../ui/cd-terrain.js); culture also crosses water,
  slowly and gated by age.
- **Decay.** `value - (value*decayRate + decayFlat)`.
- **Flip.** Ownership is read off the stock (`resolveOwner`): the strongest civ wins past `minimumOwner`, and to take a
  tile from a rival its stock must clear the incumbent decisively: `winnerCulture * flipRatio > incumbentCulture`.

**Pacing is emergent & slow** — culture must physically build ring by ring against decay, so ring 3 ≈ turn 20–30 and
ring 5+ is a mature-culture, late-game event. Overwhelming culture injects a bigger stock and pushes the same front out
faster/farther, organically.

**State** is persisted in [`ui/cd-state.js`](../ui/cd-state.js) (v2 envelope: `field` / `claims` / `locked` /
`monoTurn`); `field["x,y"]` is a `Record<civId, number>` of culture stock. The pass is bounded to `fieldRadius` rings
around local cities and pruned beyond that.

### Constants (defaults, `ui/cd-config.js`)

`cultureThreshold:100, diffusionRate:0.055, decayRate:0.05, decayFlat:1, normalMax:0.4, maxPercent:0.75, injectBase:10,
injectRatio:0.15, cityCapFactor:2000, minimumOwner:300, flipRatio:0.65, flipMaxDistance:6, fieldRadius:8,
maxFlipsPerTurn:8`.

---

## 3. Fused scoring — CPI + ethnic affinity + prosperity

The scoring work shapes **how hard each city injects** culture (not an instantaneous reach). It is ON by default
(`fusedModel:true`, `useEmigration:true`).

- **Term A / CPI (Cultural Power Index)** — a per-civ scalar of *overall* cultural dominance, built from **relative**
  dimensions (this civ's share vs. the strongest civ) combined **geometrically** so breadth beats a single-stat spike.
  Dimensions: legacy/stock (wonders, great works, relics, cultural golden ages, masteries), flow (culture/turn),
  reach/soft-power (religion, influence, suzerainties), vitality (happiness, celebrations), prosperity, identity depth
  (traditions, civics, age). `cd-cpi.js` (pure) + `cd-metrics.js` (base-game reads). A dimension unreadable across all
  civs is dropped, never zeroed.
- **Term B / prosperity projection** — `cd-polity.js prosperityOf()` (happiness + food/production, normalized), folded
  into each city's projection: a prosperous, happy, growing settlement beams culture farther.
- **Term C / ethnic affinity** — `cd-ethnicity.js` + `cd-emigration.js`, reading the emigration mod's
  `EmigrationEthnos_v1` composition from the shared game-config store (import-free, no hard dependency). A frontier tile
  surrounded by a civ's diaspora feels that civ's pull. **Standalone-safe:** no emigration → neutral ×1.

The three metrics **interlock** (people leave unprosperous places → diaspora → ethnic pressure elsewhere; prosperity
fuels culture; culture fuels prosperity), which is why the combined power is not a naive sum. Tunables:
`cpiPowerMin/Max`, the six CPI dimension weights, `ethnicWeight`, `prosperityAmp`, plus the `fusedModel` /
`useEmigration` toggles.

---

## 4. The flip verb — `purchasePlot`, made net-free

**`flipVerb = "purchasePlot"`** (integrated, city-attached) is the shipped default, made **net-zero gold** by a
same-tick refund: `flipViaPurchasePlotRefunded` measures the balance around the buy and restores whatever was spent
([`ui/cd-ownership.js:133`](../ui/cd-ownership.js)). This was the resolution of the long verb debate — see
[`probe-history.md`](probe-history.md) for why `setOwnership` was retired (it fails on rival land and orphans empty
land) and [`wont-build-with-justifications.md`](wont-build-with-justifications.md) for the formal decision.
`setOwnership` survives only as the `unclaim` verb.

Ownership is really mutated (not cosmetic): the integrated verb attaches the tile to a city (`owningCity` set,
`inCityPlots` true). That does **not** make it workable. Civ VII computes the workable/developable set natively and caps
it at ring 3, and since 1.0.7 the mod only claims beyond ring 3, so every claimed tile is territory without yield —
no citizen can work it and nothing can be built on it. See §5 and
[`civ7-tile-range-investigation.md`](civ7-tile-range-investigation.md).

**Writes land after the call.** Watched in-game on game 1.4.2 (harness run 1, [`probe-history.md`](probe-history.md)
§5): after `purchasePlot` the owner read on the same tick still shows the old owner, and the new owner appears about
three seconds later. The pass therefore never books an ownership change on that read. A verb that has not landed is
recorded in `state.pending` ([`ui/cd-pending.js`](../ui/cd-pending.js)) and confirmed from the live map at the start
of the next pass, when it becomes a claim, a cession or a release, or is dropped and retried later. Harness run 2 watched
this work end to end: a flip on a seeded frontier tile was sent, landed within five seconds, and was confirmed and
locked by the next pass, and an organic flip on the neighbouring tile followed the same path.

---

## 5. Contest, core protection, and native-growth integration

- **Core protection** — `coreProtectRadius` (default `0` = only the rival's city-center plot is protected) via
  `isCoreProtected` ([`ui/cd-borders.js`](../ui/cd-borders.js), gated in `flipEligible`
  [`ui/cd-pass.js:394`](../ui/cd-pass.js)). Diffusion still reaches inner tiles organically. Proven in-game to ring-1.
- **Adjacency** — `requireAdjacency` (default `true`): only flip a tile that touches your existing land, for an organic
  contiguous front rather than enclaves.
- **War** — `atWar` tiles pause peaceful flips (borders don't diffuse across an active front).
- **Beyond the city maximum** — diffusion is not gated on the pending-growth gate; a diffusion tile does not consume a
  growth event. Bounded by `fieldRadius` + `maxFlipsPerTurn` so a runaway leader can't paint the map.
- **Outer-ring tiles are territory, not workable land.** A claimed tile beyond ring 3 is city-attached but outside
  the native ring-3 work radius, so it yields nothing and cannot be developed. Its value is strategic: frontier tiles taken
  from a rival, and a buffer that blocks foreign founding. The block is watched in-game (harness run 1): a settler
  could found on an unowned plot four tiles from any settlement, and could not found on the neighbouring plot once
  a rival owned it ("This Unit has no valid constructions for this location"). Making outer tiles workable is engine-blocked — recorded in
  [`wont-build-with-justifications.md`](wont-build-with-justifications.md). Founding a **new city** on an outer tile is
  base-game min-city-range territory, not a mod feature.
- **Recede (opt-in, `recedeBorders`, default off).** `recedeOwnership` ([`ui/cd-recede.js`](../ui/cd-recede.js)) walks only
  `state.claims`. A claim a rival out-cultures past `resolveOwner`'s gates is ceded to that rival's nearest city via
  refunded `purchasePlot` (peace, `flipMaxDistance`, `requireAdjacency` apply), locked for `flipCooldownTurns`, and
  capped by `maxFlipsPerTurn`. There is no release to no one. Harness run 1 watched the cession verb work (a rival city's
  `purchasePlot` took back a tile we held, landing after the call) and the release verb fail (`setOwnership(NO_PLAYER)`
  left a city-attached tile ours for several turns). Run 2 tried three more release variants and all
  failed, so the release branch was removed and a faded claim simply stays ours. Still default off until the mod's own
  cession is watched against a rival at peace with us; in run 3 the only adjacent rival was at war, so the war gate held.
- **Native-growth integration (two layers).** *Hard core* = every tile the game claims via growth/purchase — never
  touched; the pass reads the live owned footprint each turn. *Soft halo* = the frontier tiles diffusion claims beyond
  the hard core, recorded in `cd-state`. Rules: no double-claim (the scan only considers unowned or rival tiles, never
  owned-by-me), recompute every pass from the live map, graduation-not-conflict (native growth into a soft tile just
  promotes it), and core protection on rival flips.
  - **v1.0.7 hardening:** rings within `baseGrowthRadius` (3) of any of your cities are ceded entirely to the base game
    (which assigns each tile to the city that can *work* it); the mod only claims the frontier beyond.
    `releaseInnerClaims` self-heals saves damaged by the 1.0.6 build.

---

## 6. Options surface

Registered under **Options → Mods → Cultural Diffusion** in both shell and game scopes
([`ui/cd-options.js`](../ui/cd-options.js), state in [`ui/cd-settings.js`](../ui/cd-settings.js)): intensity preset
(Custom / Low / Medium / High), enable diffusion (master switch), claim-only-unowned (safety mode), core-protection
radius, adjacency, the +1 ring growth buffer (default off), borders recede (default off), the rich cultural model, follow
diaspora, the pressure lens, and debug logging. The flip verb is code-only. Options register through
`Options.addInitCallback`, so they survive the base model's `reInitOptions()` rebuild; a bare `addOption` at load made
them vanish after closing Settings until a restart. Notifications are throttled toasts
([`ui/cd-notifications.js`](../ui/cd-notifications.js)). Tunables reference is in
[`reference-and-conventions.md`](reference-and-conventions.md).

---

## 7. Design history — the retired charge / maturity model (do not resurrect)

The original core model computed pressure as an **instantaneous closed-form reach**, gated by a per-plot **charge
accumulator** and a **maturity / momentum** reach gate. It was too fast and partly degenerate (a lone/early leader was
"strongest" by default) and was replaced (2026-07-04) by the reaction-diffusion field above. Retained here as design
history because [`wont-build-with-justifications.md`](wont-build-with-justifications.md) records it as **Superseded**.

- **Charge / flip rule (retired).** Each plot kept `charge ∈ [0, flipThreshold]`; `charge` grew while a civ dominated by
  `flipMargin`, decayed otherwise, and the plot flipped once `charge` reached `flipThreshold` and the lead held for
  `sustainTurns`, then a `flipCooldownTurns` cooldown blocked re-flip. Tunables (retired): `flipThreshold` (as charge) /
  `flipMargin` / `chargeGain` / `chargeDecay` / `sustainTurns`.
- **Reach = maturity × competition (retired).** Empty-land reach multiplied a **relative** gate (`ownednessFloor ×
  refStrength`, strongest civ's projection) by an **absolute** momentum-driven maturity factor
  (`acc/(acc+maturityScale)`, accelerated by golden ages and overwhelming culture). Tunables (retired): `maturityGate` /
  `maturityScale` / `maturityRate` / `goldenAgeAccel` / `cultureDominanceExp` / `maxMomentum`.
- **Also retired with the model:** `resistancePressure`, `civPressureAt`, `dominantAt`.

The scoring work (CPI, prosperity, ethnic affinity, §3) was **kept** — it now shapes injection strength instead of an
instantaneous reach.
