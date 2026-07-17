# Backlog

Open items not yet addressed. Findings from the 2026-07-10 corpus bug-hunt audit unless
noted. Each carries [severity · confidence] and enough context to pick up cold.

## [High · Confirmed] Default flip verb `setOwnership` records phantom claims

**Sites:** [ui/cd-ownership.js:40-49](../ui/cd-ownership.js) (`flipViaSetOwnership`),
[ui/cd-pass.js:337-353](../ui/cd-pass.js) (`commitFlip`)
**Overlaps existing plan:** this is the problem the author's own
[redesign-plan.md](redesign-plan.md) Phase 1 already targets (switch primary verb to
`purchasePlot`/`claimPlot`, retire `setOwnership` to `unclaim` only). Filed here so the
correctness angle isn't lost while the redesign is pending.
**Symptom:** `flipViaSetOwnership` returns `{ok:true}` whenever
`WorldBuilder.MapPlots.setOwnership(...)` doesn't throw; `commitFlip` acts on `res.ok`
alone and never re-reads `ownerAt(loc)` to confirm the tile actually changed owner. The
author's own probe (redesign-plan.md:31) proves `setOwnership` on rival land **FAILS —
102/102 no-change** (returns without error, tile stays the rival's), and on empty land
produces an **orphan** tile (`owningCity=NONE`, not workable/buildable).
**Failure scenario:** with shipping defaults (`flipVerb:"setOwnership"`, Medium preset →
`claimOnlyUnowned:false`, `coreProtectRadius:0`) the pass targets rival tiles every turn.
Each attempt silently no-ops but is recorded as a win: `state.claims[k]` set (consuming
that city's `maxDiffusionPlots`=80 budget on tiles it never took), `state.locked[k]` set
(15-turn cooldown blocks retry), `next[k][me]` seeded, and a "claimed new territory" toast
fired — while the rival still owns the tile.
**Fix (interim, code-level):** in `commitFlip`, after `performFlip`, verify
`ownerAt(loc) === me` before recording claim/lock/seed/notify. Full fix = the
redesign-plan Phase 1 verb switch.

**Design (interim guard):** in `commitFlip` (`cd-pass.js:336-353`), gate ALL five
side-effects behind a post-flip ownership read. `ownerAt` (`cd-plots.js:53`) is already
imported and used at `cd-pass.js:358`, so no new import:
```js
const res = performFlip({ playerId: me, city: near.city, loc, verb: CONFIG.flipVerb });
if (!res.ok || ownerAt(loc) !== me) {
  dlog(`flip ${k} NOT APPLIED reason=${res.reason || "no-change"} verb=${res.verb}`);
  return false;
}
// only now: claimCount.set(...), state.claims[k]=..., state.locked[k]=...,
//           next[k][String(me)]=..., notifyFlip(...)
```
Effect: on the proven 102/102 rival-land no-change case, nothing is recorded — no
`maxDiffusionPlots` budget consumed, no `flipCooldownTurns` lock, no seed stock, no false
"claimed territory" toast. The tile is simply retried in a future pass as conditions allow.
**Limitation (state in the entry):** this does NOT fix `setOwnership` on *unowned* land,
where it sets owner=me but yields an unworkable **orphan** (`owningCity=NONE`) — there
`ownerAt(loc) === me` passes, so the guard still records it. That case needs the permanent
verb switch. So this guard is strictly an interim stop-loss for the rival-land phantom;
the real fix remains [redesign-plan.md](redesign-plan.md) Phase 1 (`:116-126`) switching the
primary verb to `purchasePlot`/`claimPlot`.
**Verify:** with shipping defaults, drive the pass against a rival's tile and confirm (via
`dlog`/state inspection) that no claim, lock, seed, or toast is recorded when
`GameplayMap.getOwner` still returns the rival after the attempt.

## [Low · Confirmed] Documented features and gathered signals that are never consumed

**Sites:** [ui/cd-config.js:104](../ui/cd-config.js) (`preventForwardSettle`, default
`true`), [ui/cd-config.js:124](../ui/cd-config.js) (`minimalOwnedCulture`),
[ui/cd-pass.js:66](../ui/cd-pass.js) (`s.prosperity`), `ui/cd-pressure.js`
(`happinessFactor`/`wonderFactor`/`prosperityFactor`)
**Symptom:** `preventForwardSettle` and `minimalOwnedCulture` are defined and documented
("prioritize claiming open buffer plots between rivals") but referenced nowhere in `ui/` —
a promised behavior that does nothing. `prosperityOf(city)` is read into `s.prosperity`
every pass but `fusedBase` only uses `s.vitality`; the three `*Factor` helpers are exported
but never called by `projectionOf`.
**Failure scenario:** not a crash — dead code / wasted per-pass computation and a stated
model input (prosperity) with no effect on behavior.
**Fix:** either wire prosperity/forward-settle into the pressure model as documented, or
remove the dead config + exports and update the docs.

**IMPLEMENTED (scaled back from "remove all four").** Only the two config flags were
genuinely dead. The three `*Factor` helpers turned out to be **tested** API
(`tests/pressure.mjs` + `tests/pressure-branches.mjs` exercise `happinessFactor`,
`wonderFactor`, `prosperityFactor`), i.e. an intended-but-unwired utility library, not dead
code — deleting them would drop test coverage, so they were kept. The `prosperityOf`/
`s.prosperity` row field is the data source for that same (tested) prosperity factor, so it
was kept too for coherence (its per-pass cost is one function call per settlement — negligible).
**Removed:** `preventForwardSettle` and `minimalOwnedCulture` (config + JSDoc) — unread and
untested. If the tested-but-unwired factors are ever to be retired, that's a separate change
that must also remove their tests.

**Original design (superseded — see above):**
- `minimalOwnedCulture` (`cd-config.js:124`), the unused `s.prosperity` row field
  (`cd-pass.js:66` `prosperity: fused ? prosperityOf(city) : 0` — `prosperityOf` at
  `cd-polity.js:111`), and the exported-but-uncalled `happinessFactor`/`wonderFactor`/
  `prosperityFactor` (`cd-pressure.js:47/59/70`) → **delete.** The JSDoc at
  `cd-pressure.js:115` already states wonders/happiness/prosperity were folded into
  CPI/`vitality` by the fused model, so these are genuine superseded dead code. Drop the
  `prosperity` field from the settlement row (nothing reads it — `fusedBase`/`projectionOf`
  use only `culture`+`vitality`), remove the three factor exports, and delete the config key
  + its JSDoc.
- `preventForwardSettle` (`cd-config.js:104`) → **delete as misaligned with the organic
  model.** The mod is organic reaction-diffusion pacing (its Civ V CultureDiffusion lineage);
  denying rival forward-settlement is meant to **emerge** from natural cultural pressure
  organically owning the buffer, not from a special-cased flag that targets/prioritizes the
  plots between rivals. A targeting knob would contradict the organic model, so there is no
  real feature to wire in — the emergent behavior already covers the intent. Remove the dead
  flag + its JSDoc, and add a one-line note (in the config doc or spec) that anti-forward-
  settling is an emergent property of the diffusion pass, not a discrete mechanic.
**Verify:** grep confirms zero read sites for each removed symbol; the mod's field pass and
options screen build/behave identically after removal (pure dead-code deletion).

## 2026-07-13 full hostile audit addendum

Findings from the post-1.0.7 "anything could be wrong" sweep. Verification baseline was green
(`npm run verify` passed), so items below are runtime-risk and behavior-consistency findings,
not syntax/lint/test breakage.

## [Medium · High] Buffer trigger can silently miss valid completion events

**Sites:** [ui/cd-bootstrap.js](../ui/cd-bootstrap.js) (onConstructibleAdded, around lines 75-82)
**Symptom:** the growth-buffer event gate accepts completion only when `percentComplete === 100`
when the field is present.
**Failure scenario:** if the engine emits completion as `1`, `1.0`, or another normalized value
in some contexts, the handler returns early and no buffer claim runs despite a real completion.
**Impact:** intermittent "buffer did nothing" behavior with no hard error.
**Fix:** normalize completion semantics (accept 100 and 1 forms, and/or treat missing field as
already-finalized), then add test coverage for event payload variants.
**Verify:** simulate/observe `ConstructibleAddedToMap` payload variants and confirm
`claimBufferAt(...)` runs once for each completed rural improvement.

## [Medium · Medium] Per-turn pass depends on narrow `PlayerTurnActivated` payload shape

**Sites:** [ui/cd-bootstrap.js](../ui/cd-bootstrap.js) (onTurnActivated, lines around 134-142)
**Symptom:** pass execution is gated on `data.player ?? data.Player` matching local id exactly.
**Failure scenario:** if payload shape drifts (missing field, wrapped object, different key/name),
the guard rejects all turn events and the mod appears loaded but inert unless manually run from
console.
**Impact:** hard behavior regression with no obvious crash signal.
**Fix:** harden player extraction (support known alternate shapes), and add a conservative fallback
path that still honors single-player/local-turn constraints.
**Verify:** replay with synthetic payload variants and confirm exactly one pass per local turn.

## [Medium · Medium] 1.0.7 inner-ring self-heal is claim-record dependent

**Sites:** [ui/cd-pass.js](../ui/cd-pass.js) (`releaseInnerClaims`),
[ui/cd-state.js](../ui/cd-state.js) (claim normalization/caps)
**Symptom:** release/reconciliation iterates tracked `state.claims` entries only.
**Failure scenario:** damaged tiles from 1.0.6 that are integrated to the wrong city but absent
from `state.claims` (cap truncation, stale/missing state, prior state loss) are not revisited by
`releaseInnerClaims` and may remain misassigned.
**Impact:** rare "1.0.7 did not fully heal this save" reports.
**Fix:** add a secondary map-scan reconciliation for owned inner-ring tiles that does not rely
solely on claim bookkeeping, or explicitly document this as a best-effort constraint.
**Verify:** load crafted state with missing claim records and confirm inner-ring tiles still
release/recover.

## [Low · Confirmed] Internal docs/comments disagree on buffer land-vs-water rule

**Sites:** [ui/cd-pass.js](../ui/cd-pass.js) (`claimBufferAt`/`bufferTarget` comments),
[tests/buffer.mjs](../tests/buffer.mjs)
**Symptom:** comments near `claimBufferAt` say "UNOWNED land" only, while behavior and tests
explicitly allow adjacent UNOWNED water claims.
**Impact:** maintenance confusion; easy future regression if someone "fixes" to the wrong doc.
**Fix:** make wording consistent everywhere (CHANGELOG/docs/code comments/tests).
**Verify:** docs and comments align with tested behavior.

## [Low · Medium] Core-protection check is potentially expensive inside hot candidate loop

**Sites:** [ui/cd-borders.js](../ui/cd-borders.js) (`isCoreProtected`/`_cityCenterWithin`),
[ui/cd-pass.js](../ui/cd-pass.js) (`flipEligible`)
**Symptom:** for rival-owned candidates, core protection builds radius sets and scans alive
players/cities per tile.
**Failure scenario:** late-game/high-city maps can pay this repeatedly per pass on a hot path.
**Impact:** possible turn-time spikes without correctness failure.
**Fix:** precompute/memoize protected-center influence per pass (or owner-scoped cache), then
query O(1)-ish in `flipEligible`.
**Verify:** profile pass time before/after on a large late-game save.

## [Low · Confirmed] Test harness gap around bootstrap/event wiring

**Sites:** [package.json](../package.json) (test scripts), [tests/](../tests)
**Symptom:** strong unit coverage exists for pure/near-pure modules, but no dedicated harness for
turn-hook/event payload compatibility in `cd-bootstrap`.
**Impact:** event-shape regressions can ship despite green test suite.
**Fix:** add bootstrap-focused tests for `PlayerTurnActivated` and `ConstructibleAddedToMap`
payload variants.
**Verify:** new tests fail on brittle extraction/completion assumptions and pass after hardening.
**2026-07-16 update:** PARTIALLY ADDRESSED for the pass itself — `tests/pass.mjs` now covers
`runPass` orchestration against a stub engine (guards, step order, flip gates, bookkeeping, state
bounds), and `cd-pass.js` joined the c8 and Stryker scopes. `cd-bootstrap`'s event wiring remains
uncovered, so this item stays open as originally written.

## 2026-07-16 addendum (found while building `tests/pass.mjs`)

## [Low · Confirmed] `commitFlip`'s post-flip "seed stock" line is a provable no-op

**Site:** [ui/cd-pass.js](../ui/cd-pass.js) (`commitFlip`, the line
`next[k][String(me)] = Math.max(next[k][String(me)] || 0, ageCfg.minimumOwner);`)
**Symptom:** the comment says it seeds "a stable stock so the tile doesn't immediately fail the
ownership test", but the `Math.max` can never raise anything. `tryFlipCandidate` only reaches
`commitFlip` when `resolveOwner` returned `flip:true`, which requires `value > ageCfg.minimumOwner`
— and when `verdict.owner === me`, that `value` IS `next[k][String(me)]`. So the operand is already
strictly greater than the floor being applied.
**Evidence:** instrumented across the whole `tests/pass.mjs` suite — 14 flips, 14 no-ops, 0 raises.
Stocks at flip time ranged 379–5000 against a bar of 300.
**Impact:** none at runtime; it is dead code in the hot flip path that reads as load-bearing. It
also can't be pinned by any test, so it will keep surfacing as an unkillable mutant.
**Fix:** either delete the line, or — if the intent was a floor for a path that does NOT come
through `resolveOwner` (e.g. a future direct-claim route, or protection against `resolveOwner`'s
bar changing independently) — keep it and correct the comment to say so.
**Deliberately NOT auto-removed:** unlike the dead constructs cleaned out of `cd-state.js` on the
same day, this sits in the flip path and turns on design intent. Author's call.
**Verify:** the instrumentation above; or delete the line and confirm `tests/pass.mjs` still passes
(it does — which is the point).

## [Low · Confirmed] `commitBuffer` repeats the same dead seed-stock line

**Site:** [ui/cd-pass.js](../ui/cd-pass.js) (`commitBuffer`:
`state.field[k][String(me)] = Math.max(state.field[k][String(me)] || 0, CONFIG.minimumOwner);`)
**Symptom:** the twin of the `commitFlip` item above, reached by the buffer path instead. Here the
tile is freshly claimed and usually has NO prior stock, so the `Math.max` collapses to
`= CONFIG.minimumOwner` — i.e. the `|| 0` and the `Math.max` are both doing nothing. Whatever is
decided for `commitFlip`'s line should be applied here for consistency.
**Impact:** none at runtime; dead-ish code in the buffer claim path.
**Fix:** resolve alongside the `commitFlip` item; they are the same decision.

## [Low · Confirmed] `tests/buffer.mjs` asserts tiles but never state

**Sites:** [tests/buffer.mjs](../tests/buffer.mjs), [ui/cd-pass.js](../ui/cd-pass.js)
(`commitBuffer` / `claimBufferAt`)
**Symptom:** `buffer.mjs` asserts tile ownership after `claimBufferAt`, but never the persisted
state it writes (`claims`, `locked`, `field` seed) and never the FAILURE path
(`if (!res.ok || ownerAt(T) !== me)` — the silent-no-op guard, the buffer's copy of the one
`tests/pass.mjs` pins for flips).
**Evidence:** with `cd-pass.js` in the Stryker scope (2026-07-16), ~13 of its 189 survivors sit on
those buffer lines (L481, L489, L518) — the only cd-pass survivors attributable to a suite other
than `pass.mjs`.
**Fix:** extend `buffer.mjs` with a `purchaseNoOps`-style stub (copy the pattern from
`tests/pass.mjs`) plus claim/lock/field assertions after a successful buffer claim.
**Verify:** those survivors die; buffer-path mutation stops trailing the rest of `cd-pass.js`.

## [Low · Confirmed] `runPass`'s JSDoc claims a multiplayer bail it does not do

**Site:** [ui/cd-pass.js](../ui/cd-pass.js) (`runPass` doc comment: "bails cleanly when disabled,
in multiplayer, or with no local cities")
**Symptom:** `runPass` checks `CONFIG.diffusionEnabled`, `me < 0`, and `cities.length` — there is no
multiplayer check. MP safety is real but comes from elsewhere: `cd-ownership`'s `guardSP()` blocks
every mutating verb, so a MP pass runs the whole field simulation, attempts flips, fails them all,
and still writes state each turn.
**Impact:** cosmetic/doc accuracy, plus wasted per-turn work in MP. No incorrect ownership occurs —
`tests/pass.mjs` pins that safety property directly.
**Fix:** either add an early `if (isMultiplayer()) return { flips: 0, tiles: 0 };` to `runPass`
(cheap, and makes the doc true), or reword the comment to say the guard lives in the verbs.

## Suggested implementation order

1. Harden `cd-bootstrap` event parsing (`percentComplete` + turn payload extraction).
2. Add bootstrap/event compatibility tests so those regressions cannot re-ship.
3. Add state-independent inner-ring reconciliation fallback (or downgrade release claim wording).
4. Align docs/comments on buffer water behavior.
5. Optimize/memoize core-protection checks if profiling confirms measurable cost.
