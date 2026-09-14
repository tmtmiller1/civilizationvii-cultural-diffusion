# Backlog

Open items not yet addressed. Findings from the 2026-07-10 corpus bug-hunt audit unless
noted. Each carries [severity · confidence] and enough context to pick up cold.

> **Closed decisions have moved out of this backlog.** Items that were *decided* rather than
> *pending* now live in their own files, cross-referenced from the entries below:
> - The `commitFlip` / `commitBuffer` seed-stock no-op lines and the kept tested-but-unwired
>   `*Factor` helpers → [`wont-fix-with-justifications.md`](wont-fix-with-justifications.md)
>   (deliberately left as-is).
> - The removed `preventForwardSettle` / `minimalOwnedCulture` targeting flags →
>   [`wont-build-with-justifications.md`](wont-build-with-justifications.md) (won't build as a
>   discrete mechanic).
>
> The detailed findings remain below for reference; the **verdicts** are canonical in those files.

## 2026-09-12 in-game harness findings

Watched on game 1.4.2 with `devtools/harness/` ([`probe-history.md`](probe-history.md) §5). The unrecorded-flip and
age-hash bugs it found are already fixed (changelog); these two stay open.

## [High · Cause unconfirmed] Native crash after an age transition in harness run 3

**Evidence:** `devtools/harness/run3-crash-evidence.txt` and the macOS report
`CivilizationVII-2026-09-12-220239.ips`. The game hit `EXC_BAD_ACCESS` at `0x2a8` on `AsyncWorker1`, about thirty
seconds after Autoplay drove AugustusAnt136 from Antiquity into Exploration at turn 160. The mod held nine claims beyond
ring 3 at the time, two of them captured from player 3. The signature matches the archived Emigration enclave crash, an
AI constructible-broker fault on the same thread.
**Hypothesis to disprove first:** the mod's claimed tiles beyond ring 3 make the new age's AI fault.
**Cheapest disproof:** load `Saves/Single/auto/AutoSave_01_0001`, the Exploration start with the claims already on the
map, with Cultural Diffusion disabled and no harness, and end one turn by hand. A crash there means the mod's code is not
needed for it, though its tiles still are. If that survives, load it again with the mod enabled. If both survive, repeat
the transition from `AutoSave_00_0160` with and without the mod. Autoplay is a separate suspect, because the harness had
handed every local turn to it since about turn 154.
**First disproof, run by the Emigration session the same evening:** it loaded `AutoSave_00_0158` with the nine claims
baked in, Cultural Diffusion disabled, Emigration enabled and no Cultural Diffusion harness. Autoplay ran through the
turn-160 transition to Exploration turn 11, and the game then idled about twelve minutes. There was no crash and no new
`.ips`. So the baked-in tiles plus Autoplay through the transition do not crash on their own. The hypothesis moves to
code that ran at the start of the new age.
**Correction (2026-09-13), from the saved run-3 log:** nothing from the harness or the mod logged between the mod's
new-age boot at 22:02:10 and the crash at 22:02:39. In every other load the harness logged `LOAD GameStarted` about
five seconds after attaching, and the mod logs every pass with debug on. So the new age never reached GameStarted. The
crash hit during startup, before the harness's first-turn actions and before the mod's first pass, which rules both out.
What did run in that window: the mod's game-scope scripts loading (bootstrap, pressure lens, tooltip, options), the
harness pressing Begin with `UI.notifyUIReady()`, and whatever state the transition carried over. The Emigration probe
pressed Begin the same way and survived, but it ran with Cultural Diffusion disabled.
**Next disproof (harness run 5):** load `AutoSave_00_0160` with the mod enabled. Run one mod pass through its console,
as run 3's last pass did, then play exactly one Autoplay turn so the age ends, and after the transition only press
Begin. A crash implicates the mod's presence across the transition. No crash means run 3 needed something this replay
lacks, such as that night's deployed build, which still sent releases, or the 24 turns of live play before it.
**Run 5 (2026-09-13): not reproduced.** The replay loaded AugustusAnt136 with the current build, set as in run 3
(debug, recede and buffer on), and ended turns exactly as run 3 did, with no harness test actions. Run 3's autosaves had
rotated out, so it started from turn 136. It crossed into Exploration at turn 160. The new age reached GameStarted six
seconds after the scripts reloaded, and the game ran 194 seconds and 21 Exploration turns with no crash and no new crash
report. The mod sent 29 flips across both ages and confirmed all 29. So Cultural Diffusion being present across the
transition does not crash the game on its own.
**What run 3 had that run 5 did not:**
- That night's build, whose recede step sent `setOwnership(NO_PLAYER)` on two claimed, city-attached tiles every pass
  through the final Antiquity turns. The current build no longer sends it.
- Run 3's first-turn harness tests on turn 136: buying a rival tile and ceding it back, a spawned settler, a pending
  citizen placed by script, and improvements destroyed and recreated by script.
- Chance. One faithful replay not reproducing a single crash does not rule out a nondeterministic fault.
**Run 7 (2026-09-13): reproduced with the harness tests.** The same route on the current build, with run 3's first-turn
harness tests repeated, crashed at the same moment: during the new age's startup, before GameStarted. The tests were a
citizen added by script and ordered onto a far tile, improvements destroyed and created by script, and a purchase of a
rival tile inside our own ring 3 with a seeded recede state. The report `CivilizationVII-2026-09-13-191007.ips` is
`EXC_BAD_ACCESS` at `0x308` on `AsyncWorker1`. Its top frames differ from run 3's, so it is the same kind of fault at the
same point rather than an identical stack. Evidence: `devtools/harness/run7-crash-evidence.txt`.
**Status:** with those harness tests the transition crashed twice (runs 3 and 7); without them it did not (run 5). The
trigger is among the script-only engine writes above. The shipped mod performs none of them: it never adds or places
citizens, never creates or destroys constructibles, and never buys a tile inside one of your own cities' first three
rings. Which test triggers it is not isolated, and players are exposed only if some normal-play action reaches the same
engine state.
**Superseded suspect list (written before the log check):**
- **The harness.** An age transition reloads every game-scope UI script. In run 3 the harness re-attached at 22:02:09
  and would have re-run its first-turn actions: `addRuralPopulation`, `EXPAND` orders, `DESTROY_ELEMENT` and
  `CREATE_ELEMENT` improvements, and a `purchasePlot`. Those fall inside the 30 seconds before the 22:02:39 crash. No
  `[CDH] S0` line was logged after the re-attach, but a segfault may not flush the log.
- **The mod's first Exploration pass.** It confirms the pending claims carried over and sends new `purchasePlot` flips
  and `setOwnership` releases, during new-age startup.
**Narrowed by the same run:** the Emigration probe also re-attached on Exploration turn 1 and repeated its own engine
writes there. A `CREATE_ELEMENT` rural district and improvement on an empty London plot silently did not take, and a
`DESTROY_ELEMENT` plus `CREATE_ELEMENT` replacing an enclave on Paris did take. The game still ran to turn 11. So
destroying and creating constructibles on the first Exploration turn is not fatal on its own. The harness suspect
narrows to its `addRuralPopulation`, `EXPAND` orders and `purchasePlot` calls, alongside the mod's first pass, which
also calls `purchasePlot`.
**Superseded plan:** load `AutoSave_01_0001`, the Exploration start, with Cultural Diffusion enabled in its debug
copy and a harness that only presses Begin and does nothing else. A crash implicates the mod's first pass. No crash
points at the harness re-running its destructive actions.

## [Low · Confirmed] The debug `frontier` line over-reports claimable tiles

**Symptom:** `logFrontier` (`ui/cd-diagnostics.js`) scans every ring-4 tile of a city. That includes tiles inside
another of our cities' first three rings, and neighbouring city centres, which the pass can never claim, so `best` and
`over` run high. In run 3 London showed tiles over the bar from pass 8, but its first claim came on pass 18.
**Fix:** skip tiles within `baseGrowthRadius` of any local city, matching `flipCandidates`.

## [Resolved] War reads disagreed in harness run 3 - it was a peace, not a bug

**Symptom:** the harness read player 3 as at war on turn 136 through `Diplomacy.isAtWarWith`. Yet on turns 155 and 156
the mod took two of player 3's tiles, which `flipEligible` blocks at war.
**Resolution (harness run 7, 2026-09-13):** run 7 logged, every turn, the engine's `isAtWarWith` and the mod's own
`atWar` from `ui/cd-borders.js` for every rival. Across 25 turns they never disagreed. Both read player 3 as at war on
turn 136 and at peace from turn 137 on, and every capture of player 3's tiles came after that peace. The war gate works
as designed.

## [High · Confirmed] No known verb releases a city-attached tile

**Sites:** [ui/cd-recede.js](../ui/cd-recede.js) (`releaseToNoOne`), [ui/cd-pass.js](../ui/cd-pass.js)
(`releaseInnerClaims`, `repairOrphans`)
**Symptom:** `WorldBuilder.MapPlots.setOwnership(NO_PLAYER, loc)` does nothing to a tile attached to a city. In harness
run 1 the tile was still owned three seconds and twelve turns later. `releaseInnerClaims`, the 1.0.7 self-heal, calls it
and then forgets the claim regardless, so that heal most likely never worked on the real engine. Recede's release
branch sends the call, stays pending, and is dropped.
**Run 2 (2026-09-12):** three more variants all failed. Setting ownership to ourselves first and then clearing it,
clearing a tile after checking for a district (none existed), and a plain clear each left the tile owned and attached
after ten seconds. No other ownership-writing call exists in the base game's scripts.
**Done (2026-09-12):** the release branch is removed from `recedeOwnership`, and cession is documented as the only way
a claimed tile leaves ([`wont-build-with-justifications.md`](wont-build-with-justifications.md)).
**Still open:** `releaseInnerClaims` still calls `unclaim` on inner-ring claims and then forgets them. On the real
engine the call does nothing (harness run 3 dropped a ring-3 claim this way while the tile stayed attached), so it
cannot heal a save damaged by 1.0.6. A heal needs a different verb, for example re-buying the tile with the city whose
ring it sits in; that re-parent between our own cities is untested.

## [Medium · Confirmed] Ring 4 takes a very long time to reach the ownership bar

**Symptom:** since 1.0.7 the mod claims only ring 4 and beyond. Each ring holds at most 40% of the ring inside it, so a
ring-4 tile reaches the default bar of 300 only once the city centre holds roughly 12,000. In harness run 1 London
(culture 40, strength 84) reached 364 after three passes, and no ring-4 tile had any stock after twelve turns.
**Offline estimate (2026-09-12):** a hex-grid replay of the pass's own field functions, on open terrain with one city
and the ~0.8 pace implied by London's logged stocks, gives the turn of the first claim on rings 4, 5 and 6. Terrain
and rivals are ignored, so the real game will be slower.

| City strength | Default bar 300 | Bar 150 and `normalMax` 0.55 |
| --- | --- | --- |
| 6 (Megiddo-like town) | never | ring 4 at turn 74 |
| 30 (Leeds-like) | 39 / 73 / never | 30 / 38 / 46 |
| 84 (London-like) | 25 / 32 / 42 | 22 / 28 / 34 |
| 150 | 21 / 27 / 34 | 19 / 24 / 30 |

**In-game (harness run 3):** from an empty field on turn 136, London's first organic ring-4 claim was sent on pass 18,
sooner than the estimate, likely because its culture rose during the run and roads and rivers speed diffusion. By pass
24 the mod had sent nine flips, two of them rival tiles. Megiddo, at strength 7, never came close.
**New game (harness run 8, 2026-09-13), which reopens the decision above:** a brand-new game started through Play Now
at shipped defaults ran 70 turns with the pass running every turn and made no claim at all. The harness only ended
turns, so we kept one city, with culture 8 and injection strength about 12. Its centre stock reached 3,810 by turn 50,
and no culture reached ring 4. The simulator, which predicts 3,866 for that city, gives the first ring-4 claim on
open terrain at pace 0.8 as:

| City strength | First ring-4 claim |
| --- | --- |
| 12 or less | never (400 turns) |
| 14 | turn 203 |
| 16 | turn 102 |
| 20 | turn 63 |
| 30 | turn 39 |
| 50 | turn 30 |

Below a strength of about 13, injection and decay balance before the centre can push 300 out to ring 4, so a young
empire's cities claim nothing until their culture grows. That is most of the early game.
**Needs a decision:** retune so early cities claim something, or document that the mod starts working mid-game. Options
include a lower ownership bar on the first ring the mod may claim, a higher `injectBase`, or a ring share (`normalMax`)
that carries more culture outward.

## [Medium · Confirmed] Culture never gains land for the AI

**Symptom:** the mod is one-sided. Rival settlements near our cities do inject into the field (`buildInjectors`), so
their culture defends their tiles and slows ours. But only the local player ever gains a tile: `tryFlipCandidate`
returns unless the winning culture is ours (`cd-pass.js:466`). With recede on, a rival can win back a tile the mod
claimed for us, and nothing more. AI civilizations never take land from us or from each other by culture, and the field
is only simulated around our cities.
**Not an engine limit:** a rival city's `purchasePlot` works (the cession in harness run 3, confirmed through
`cd-pending.js`), so a flip can be sent on an AI's behalf.
**Needs a decision:** an opt-in two-sided mode, off by default. Sketch: let a tile flip to any living major whose
culture wins it by the flip ratio, sent through that civilization's nearest city with the cession path recede already
uses. Keep every existing gate (peace, core protection, adjacency, caps, cooldown). The base game's rings 1-3 around our
cities stay out of reach, as they are for our claims. Rival-to-rival flips need the region to cover rival cities, which
grows the pass time, so leave them for a second step.

## [Medium · Confirmed] The pressure lens and its readout show flips the pass will never make

**Symptom:** the lens paints every tile whose leading culture is not its owner (`pressureTiles`,
`cd-pressure-lens.js:118`). The hover readout adds capture progress and an "At current pace ~N turns" line for the same
tiles (`cd-pressure-tooltip.js:222-230`). But the pass only flips a tile to the local player (`cd-pass.js:466`), and
cedes to a rival only with recede on and only a tile the mod claimed. So a tile where an AI's culture leads, whether
unowned land or our own land with recede off, is painted in the AI's colour with a countdown that never ends in a flip.
**In-game (harness run 10, turn 151):** two of the five contested tiles were unowned tiles led by the Hawaiian Empire:
84,24 at 22% and 79,30 at 15%.
**Fix sketch:** shade tiles and count down only where the pass can act. That means our culture leading on unowned or
rival land, or, with recede on, a rival leading on a tile the mod claimed for us. Put that test in one shared predicate
in `cd-field.js` so the lens, the readout and the pass cannot drift. A rival-led tile can still show its stocks, without
a progress or turns line.

## [High · Confirmed] Default flip verb `setOwnership` records phantom claims

**Sites:** [ui/cd-ownership.js:40-49](../ui/cd-ownership.js) (`flipViaSetOwnership`),
[ui/cd-pass.js:337-353](../ui/cd-pass.js) (`commitFlip`)
**Overlaps existing plan:** this is the problem the verb switch already targeted (switch primary verb
to `purchasePlot`/`claimPlot`, retire `setOwnership` to `unclaim` only) — now **shipped** (default is
`purchasePlot`, [CHANGELOG](../CHANGELOG.md) 1.0.6/1.0.7), so the default-path phantom-claim is moot;
the note stands for the still-selectable `setOwnership` option.
**Symptom:** `flipViaSetOwnership` returns `{ok:true}` whenever
`WorldBuilder.MapPlots.setOwnership(...)` doesn't throw; `commitFlip` acts on `res.ok`
alone and never re-reads `ownerAt(loc)` to confirm the tile actually changed owner. The
author's own probe (probe-history.md §2) proves `setOwnership` on rival land **FAILS —
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
verb switch (shipped, [CHANGELOG](../CHANGELOG.md) 1.0.6/1.0.7).

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
the real fix was the verb switch to `purchasePlot`/`claimPlot` (shipped,
[CHANGELOG](../CHANGELOG.md) 1.0.6/1.0.7).
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
