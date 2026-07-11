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
