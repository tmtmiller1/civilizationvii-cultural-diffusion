# Mutation analysis

Mutation testing for Cultural Diffusion's pure, off-engine logic — the same discipline
applied to the Emigration and Demographics mods. Mutation testing perturbs the source (flip a
`>` to `>=`, an `&&` to `||`, delete a statement) and checks that some test *fails*. A mutant
that survives every test marks an assertion the suite is missing — coverage that executes a
line but never checks what it does.

Run with [Stryker](https://stryker-mutator.io/): `npm run mutation`. The runner re-executes the
full Node harness (`npm test`) against each mutant; `coverageAnalysis` is `off` because the
command runner has no per-test hooks. Scope is the seven pure diffusion-logic modules **plus
`cd-pass.js`**, named in `stryker.config.json`. The true engine adapters (`cd-plots`, `cd-polity`,
`cd-borders`, `cd-ownership`) remain out — they are the layer that actually talks to the engine.

> **`cd-pass.js` joined the scope on 2026-07-16.** This file previously said "the engine-facing
> UI/pass/plot code is not unit-mutatable off-engine". That was wrong about the pass: it reads only
> `Game` and `Cities` directly and delegates everything else to the adapters, so it is an
> orchestrator ON TOP of the engine layer, not part of it. `repair.mjs`/`buffer.mjs`/`terrain.mjs`
> had been mutation-testing its internals via `__test` all along, against a stub engine
> `buffer.mjs` already built — the claim was being disproven in the same directory.
> `tests/pass.mjs` gave `runPass` a real harness and the exclusion was dropped.

## Score

Last run: 2026-07-16 (1344 mutants across 8 files).

| Module | Baseline | 2026-07-06 | Current | Survivors |
|---|---|---|---|---|
| `cd-pressure.js` (injection strength) | 76% | 93.8% | **93.8%** | 6 |
| `cd-field.js` (reaction-diffusion) | 79% | 92.2% | **92.2%** | 10 |
| `cd-cpi.js` (Cultural Power Index) | 72% | 89.9% | **89.9%** | 9 |
| `cd-state.js` (persistence/sanitizer) | 61% | 86.3% | **87.0%** | 22 |
| `cd-calibration.js` (game-settings pace) | 53% | 86.1% | **86.5%** | 13 |
| `cd-civ-tuning.js` (per-civ variance) | 44% | 51.4% | **78.9%** | 30 |
| **— 7 pure modules** | **63.3%** | **81.8%** | **87.5%** | **90** |
| `cd-pass.js` (orchestration) | not scoped | not scoped | **69.7%** | 189 |
| **Overall (8 modules)** | — | — | **79.2%** | **279** |

1065 of 1344 mutants killed. Every kill is a real behavioural assertion — **no mutant was
suppressed, and no `mutate`/threshold was narrowed to inflate the number.** The headline moved
87.5% -> 79.2% because a 624-mutant orchestrator entered the denominator; **nothing regressed.**
The diffusion-math modules still sit at 87–94%.

### `cd-pass.js`: 69.7%, honestly

Progression while building `tests/pass.mjs`: **56.3% -> 65.4% -> 69.7%**. Each step came from a gap
the survivor list exposed — the suite asserted DECISIONS (flips, ownership, bookkeeping) but never
field VALUES, and never exercised map bounds, per-age scaling, water, the claim-budget filter, or
dead owners.

Of the 189 survivors: **32 (17%)** are on `dlog`/`log`/`CONFIG.debug` lines (killing them tests
logging, not behaviour); **~13** are buffer-path lines owned by `tests/buffer.mjs`, which asserts
tile ownership but never persisted state or the failure path (filed in `BACKLOG.md`); the rest are
the degenerate at-cap carry-over, the `cd-ethnicity` affinity leg, and proven-equivalent
optimisations. An orchestrator over a STUBBED engine has a lower honest ceiling than `clamp01` — its
ratchet floor is 65, not 85, and deliberately so.

## What the new tests target

Six `*-branches.mjs` harnesses (one per mutated module) pin the guard and arithmetic branches
that plain coverage walked over, plus `civ-tuning-internals.mjs` (2026-07-16) for the resolvers
the public API cannot reach:

- **Non-finite guards** (`num()`, prosperity/ethnic/vitality/happiness factors, state
  sanitizer): feed `NaN`, `Infinity`, and — critically — a *numeric string* (`"50"`), which
  passes `isFinite()` but must be rejected by the `typeof === "number"` half of the guard. This
  kills the `&&`-left-operand `→ true` mutants that plain `NaN` inputs leave alive.
- **Exact arithmetic**: that strength *multiplies* the sqrt injection term, that a malus
  *divides* via `1/(1+malus)`, that `cultureWeight`/`ageFactor` scale as products, that CPI
  weights normalise as `w/wsum` (not `w*wsum`), that the diffusion cap is the `min` of two
  legs.
- **Strict vs. non-strict comparisons**: ownership floor (`value > minimumOwner`), the flip
  ratio (`value*ratio > incumbent`), the strongest-culture tie-break (`>` keeps the first
  owner), the incumbent read guard (`currentOwner >= 0`).
- **Sanitizer edges** (`cd-state`): the civ-id key regex `/^-?\d+$/` (anchors + multi-digit),
  the `{v,data}` envelope-vs-raw discrimination, the 20 000-entry cap, null/number-input
  guards, the `+1` monoTurn advance, and prune's `>0`-not-`>=0` stock test.
- **Calibration fallthrough**: age-pace normalisation and clamp, the `paceReferenceTurns`/
  `paceBounds` fallbacks, and the Configuration→GameInfo map-size fallthrough (so the GameInfo
  branch and the Configuration optional-chaining actually run and are observed).
- **Persistence crash-safety** (`state-branches`, 2026-07-16): the module header promises "a corrupt
  blob can never throw into the pass" — so a corrupt blob, valid-JSON-of-the-wrong-shape, and a
  throwing or accessor-less `Configuration` are each asserted to load as a clean default.
- **Engine-read contracts** (`civ-tuning-internals`, 2026-07-16): `_ALT` persona stripping is
  `$`-anchored and non-global; `mementoIdOf` reads all 7 runtime shapes in candidate order and
  matches `MEMENTO_` by prefix not substring; `equippedMementos` dedups and guards a non-array or
  throwing metaprogression API; `baseTimesMemento` multiplies (not divides) and clamps to
  `FINAL_BOUNDS` at both rails.

## Surviving mutants are equivalent (not gaps)

The 90 survivors fall into a few categories, all of which cannot change observable behaviour.
Re-verify these categories each run rather than inheriting them — see the civ-tuning section below
for what happens when a stale equivalence claim goes unchallenged:

1. **Dead defensive `false` branches** (e.g. `cpi L76`, `pressure L129`, `field L35`): a
   final `x > 0 && isFinite(x) ? x : fallback` guard whose input is provably always positive
   and finite, so the fallback is unreachable. Flipping the guard is a no-op.
2. **Boundary equalities** (`clamp01`'s `v <= 0` / `v >= 1`, decay/diffusion `next >= 0`,
   clamp bounds): `>` vs `>=` differ only at the exact boundary value, where both branches
   return the *same* number.
3. **Try/catch- and `??`-masked reads** (`state` load/save `L127–158`, `civ-tuning`
   `leaderName`/`civName` `L78–88`): an optional-chaining or guard mutant that would throw is
   caught by the surrounding `try` (or the null coalesces the same as a graceful `""`/`null`),
   so the observable result — a default state, a neutral profile — is identical.
4. **Equivalent optimisations** (`civ-tuning L156`'s `typeof pid` guard, which a non-number pid
   reaches the same NEUTRAL result without): the mutated path reaches the same output by another
   route.
5. **The inert `BY_MEMENTO` pipeline** (`civ-tuning L116–L119`): `mementoScale()`'s `if (t)` body
   cannot execute while the table ships empty. See below.

Two former members of category 4 are gone as of 2026-07-16: the `n++` counters in `cd-state.js`
(`normalizeFieldRow`, and the dead `typeof key !== "string"` check in `normalizeMap`) were **deleted**
rather than documented. A mutant that is unkillable because the code is dead is a signal to remove
the code, not to write a paragraph about it.

### The `cd-civ-tuning.js` floor: 51% → 79% (2026-07-16)

This section previously argued that the 69 survivors were equivalent, and that killing them would
require adding a fake `BY_MEMENTO` entry purely to move the number — metric-masking, correctly
refused. That reasoning was **half right, and the half that was wrong cost ~28 points**.

The survivors were unobservable *through the public `civTuning()` API* — true, and still true. But
`mementoIdOf`, `equippedMementos` and `baseTimesMemento` are real, shipped functions with real
contracts: engine shape tolerance (7 candidate fields), `MEMENTO_`-prefix matching (`startsWith`,
not `includes`), Set dedup, the non-array guard, the `mem` multiplier leg, and the `FINAL_BOUNDS`
clamp. "Unreachable from the public API" is not the same as "untestable" — it just meant no test had
a handle on them.

They are now pinned directly in `tests/civ-tuning-internals.mjs`, via the `__test` export that
already existed for introspection. **No fake table entry, no shipped-behaviour change** — so this is
not metric-masking; it is testing live code that had no test. It also carries real forward value: the
pipeline activates the moment a memento is tuned, and it will now work rather than silently no-op.

The 30 that remain ARE equivalent: `mementoScale()`'s `if (t)` body (`L116–L119`) is genuinely
unreachable while the table is empty, and the `L78–L88` engine reads are try/catch-masked
(category 3 above). The table still ships empty on purpose — every culture/happiness memento's
magnitude is already flattened by the composite injection base (module header,
`docs/current-model.md`).

**The lesson worth keeping:** "these mutants are equivalent" is a claim that decays. It was written
when the only handle on that code was the public API, and it silently stopped being true the moment
the code was worth testing directly. Re-derive it per run; don't inherit it.

### Two survivors that look like bugs but are not

Before "fixing" either of these, note why the mutant is equivalent:

- `equippedMementos`' `!Array.isArray(raw)` guard, mutated to `false`, still returns `[]` for a
  string input — a string is iterable, and none of its characters start with `MEMENTO_`.
- `civTuning`'s `typeof pid !== "number"` guard, mutated away, still returns NEUTRAL for a
  non-number pid — the lookup just resolves to no entry. The guard is an optimisation, not a
  behaviour.

## Fast per-module loops

`stryker.config.json` runs all six modules against the full suite. There is no sharded config
yet (the suite is ~3.3 s and there are 720 mutants at concurrency 4, so a full run is ~12 min);
if a module needs a tighter loop, copy the Emigration mod's `stryker.leaf.config.json` pattern
(a `mutate` subset + a reduced command runner).
