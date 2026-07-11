# Mutation analysis

Mutation testing for Cultural Diffusion's pure, off-engine logic — the same discipline
applied to the Emigration and Demographics mods. Mutation testing perturbs the source (flip a
`>` to `>=`, an `&&` to `||`, delete a statement) and checks that some test *fails*. A mutant
that survives every test marks an assertion the suite is missing — coverage that executes a
line but never checks what it does.

Run with [Stryker](https://stryker-mutator.io/): `npm run mutation`. The runner re-executes the
full Node harness (`npm test`) against each mutant; `coverageAnalysis` is `off` because the
command runner has no per-test hooks. Scope is the six pure diffusion-logic modules named in
`stryker.config.json` (the engine-facing UI/pass/plot code is not unit-mutatable off-engine).

## Score

| Module | Baseline | Current | Survivors |
|---|---|---|---|
| `cd-pressure.js` (injection strength) | 76% | **93.8%** | 6 |
| `cd-field.js` (reaction-diffusion) | 79% | **92.2%** | 10 |
| `cd-cpi.js` (Cultural Power Index) | 72% | **89.9%** | 9 |
| `cd-state.js` (persistence/sanitizer) | 61% | **86.3%** | 24 |
| `cd-calibration.js` (game-settings pace) | 53% | **86.1%** | 11 |
| `cd-civ-tuning.js` (per-civ variance) | 44% | **51.4%** | 69 |
| **Overall** | **63.3%** | **81.8%** | **129** |

580 of 709 mutants killed (was 449). Every kill is a real behavioural assertion — **no mutant
was suppressed, and no `mutate`/threshold was narrowed to inflate the number.** The surviving
mutants are equivalent (a mutation that cannot change observable behaviour) for the reasons
catalogued below. Excluding the intentionally-inert memento scaffold in `cd-civ-tuning.js`
(see below), the diffusion-math modules sit at 86–94%.

## What the new tests target

Six `*-branches.mjs` harnesses (one per mutated module) pin the guard and arithmetic branches
that plain coverage walked over:

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

## Surviving mutants are equivalent (not gaps)

The 129 survivors fall into a few categories, all of which cannot change observable behaviour:

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
4. **Equivalent optimisations** (`civ-tuning L142` `return null` vs. returning `1` that later
   `flatten`s to `1`; `state L53`/`L88` `n++`→`n--` where the counter is only tested for
   truthiness): the mutated path reaches the same output by another route.

### The `cd-civ-tuning.js` floor (51%) is by design

39 of its 69 survivors live in the **memento pipeline** (`mementoIdOf`, `equippedMementos`,
`mementoScale`, `L92–L119`), and another 19 in the leader/civ engine reads (`L78–L88`). The
memento table `BY_MEMENTO` ships **empty on purpose** — every culture/happiness memento's
magnitude is already flattened by the composite injection base, so no memento grants a tuning
(documented in the module header and `docs/cultural-diffusion-spec.md`). With an empty table,
`mementoScale()` always returns `1` regardless of what the pipeline computes, so mutating that
pipeline changes nothing observable. Killing those mutants would require adding a fake
`BY_MEMENTO` entry purely to move the number — that is metric-masking (it changes shipped
behaviour to serve the metric) and was deliberately **not** done. The pipeline is retained as
forward-compatible scaffolding and stays honestly uncovered until a real memento is tuned.

## Fast per-module loops

`stryker.config.json` runs all six modules against the full suite. There is no sharded config
yet (the whole suite is ~2.5 s, so a full run is ~7 min); if a module needs a tighter loop,
copy the Emigration mod's `stryker.leaf.config.json` pattern (a `mutate` subset + a reduced
command runner).
