# Cultural Diffusion — Won't-Fix Decisions (with justifications)

The canonical record of **deliberate decisions not to change existing, working behaviour** — benign findings closed by
judgment rather than by a wall. Each is something a future audit will flag again, so the reasoning is written down here
to stop the re-litigation.

Mirrors the sibling mod's pattern
([`emigration/docs/wont-fix-with-justifications.md`](../../emigration/docs/wont-fix-with-justifications.md)).

> **How this differs from the neighbouring docs.**
> - [`wont-build-with-justifications.md`](wont-build-with-justifications.md) — features/approaches with **no path to
>   shipping** (proven-nonfunctional, superseded, or model-misaligned).
> - [`BACKLOG.md`](BACKLOG.md) — open items we still **intend** to fix (severity · confidence tagged).
> - **This file** — behaviour that is technically imperfect but **intentionally left as-is**.
>
> **Standing convention:** when a judgment *not* to change working behaviour is made, add a `##` entry with the
> behaviour, the finding, why we are not changing it, and a **verdict**.

---

## `commitFlip` seed-stock floor line — WON'T-FIX (intentional guard, author's call)

**Behaviour:** after a flip, `commitFlip` runs
`next[k][String(me)] = Math.max(next[k][String(me)] || 0, ageCfg.minimumOwner)`
([`ui/cd-pass.js`](../ui/cd-pass.js)), commented as seeding "a stable stock so the tile doesn't immediately fail the
ownership test."

**Finding:** it is a **provable no-op**. `commitFlip` is only reached when `resolveOwner` returned `flip:true`, which
requires `value > minimumOwner`, and when `verdict.owner === me` that `value` **is** `next[k][String(me)]` — so the
operand is already strictly greater than the floor being applied. Instrumented across `tests/pass.mjs`: **14 flips, 14
no-ops, 0 raises** (stocks 379–5000 against a 300 bar). Source: [`BACKLOG.md`](BACKLOG.md) 2026-07-16 addendum.

**Why we are not "fixing" (deleting) it:** it sits in the hot flip path and turns on design intent — it is a floor for a
possible future **direct-claim route** that does *not* come through `resolveOwner`, and protection if `resolveOwner`'s
bar ever changes independently. Deliberately **not** auto-removed (unlike the dead constructs cleaned out of
`cd-state.js` the same day).

**Verdict:** **Won't-fix** — kept as an intentional guard. It cannot be pinned by any test, so it will keep surfacing as
an "unkillable mutant"; that is expected. If ever removed, the comment must be corrected to match.

---

## `commitBuffer` twin seed-stock line — WON'T-FIX (same decision)

**Behaviour:** the buffer-path twin of the above:
`state.field[k][String(me)] = Math.max(state.field[k][String(me)] || 0, CONFIG.minimumOwner)`
([`ui/cd-pass.js`](../ui/cd-pass.js) `commitBuffer`). On a freshly claimed tile with no prior stock it
collapses to `= CONFIG.minimumOwner`, so both the `|| 0` and the `Math.max` do nothing.

**Verdict:** **Won't-fix** — resolved alongside the `commitFlip` line; it is the same design call.

---

## Tested-but-unwired pressure `*Factor` helpers kept — WON'T-FIX (removal would drop coverage)

**Behaviour:** `happinessFactor` / `wonderFactor` / `prosperityFactor` ([`ui/cd-pressure.js`](../ui/cd-pressure.js)) are
exported but never called by `projectionOf` — the fused model folds wonders/happiness/prosperity into CPI/`vitality`.
`prosperityOf` / `s.prosperity` ([`ui/cd-pass.js`](../ui/cd-pass.js)) is the data source for that same (unwired) factor.

**Finding:** looks like dead code / wasted per-pass computation. Source: [`BACKLOG.md`](BACKLOG.md) "Documented features
… never consumed."

**Why we are not "fixing" (deleting) them:** they are **tested** API (`tests/pressure.mjs`,
`tests/pressure-branches.mjs` exercise all three) — an intended-but-unwired utility library, not dead code. Deleting
them would drop test coverage. Kept for coherence; the per-pass cost is one function call per settlement (negligible).
*(The genuinely dead flags in the same audit — `preventForwardSettle` / `minimalOwnedCulture` — were removed; that is a
won't-build decision, see [`wont-build-with-justifications.md`](wont-build-with-justifications.md).)*

**Verdict:** **Won't-fix** — kept intentionally. Retiring them is a separate change that must also remove their tests.
