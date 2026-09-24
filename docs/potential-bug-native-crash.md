# Potential bug: non-deterministic native crash in long unattended runs

**Status: OPEN, parked 2026-09-24. Not attributed. No code change was made on the strength of it.**

Parked because the outcome measure is too noisy to act on, not because it was resolved. Everything needed to
resume is here; [`../devtools/harness/BISECT-PLAN.md`](../devtools/harness/BISECT-PLAN.md) holds the next steps.

## Origin

A player reported that their campaign crashed unrecoverably, **with Cultural Diffusion disabled as well**, and
said they could not establish whether the mod contributed. They kept no artefacts. That report is still
unattributable and always will be without the `.ips`; the reply drafted in
`civilization_vii_mods/steam-comments/2026-09-24-tower-cultural-diffusion-3757509212-discussion-reply.txt`
asks for it.

While testing this session's fixes, the harness produced crashes of its own. Those are what this file records.

## The evidence

All four runs: same save (`AugustusAnt136`, Antiquity turn 136), same machine, same harness, game 1.5.0, within
one hour. Reports are in `devtools/harness/` as `run30-crash.ips` and `run31-crash.ips`.

| Run | Mod | Reached | Claims held | Outcome |
| --- | --- | --- | --- | --- |
| 30 | on | Antiquity t150 | **0** | CRASH: `EXC_BAD_ACCESS` addr `0x0`, **AppHost application thread**, top frame `CivilizationVII 0x21081fc` |
| 31 | on | Exploration t26 (after the age transition) | **37** | CRASH: `EXC_BAD_ACCESS` addr `0x2d8`, **AsyncWorker3**, top frame `CivilizationVII 0xd90650` |
| 32 | on, `AI_VERBOSE=1` | Exploration t41 | **38** | **no crash** (1268 s) |
| control40 | **off** (`NO_MOD=1`) | Exploration t57 | - | **no crash** |

Archived for comparison (different game builds, so frame offsets are NOT comparable):

| Report | Build | Thread | Fault |
| --- | --- | --- | --- |
| CD harness run 3 | 1.4.2 | AsyncWorker1 | `0x2a8`, 9 claims, just after an age transition |
| CD harness run 7 | 1.4.2 | AsyncWorker1 | `0x308` |
| emigration probe tests 20/21 | 1.4.x | AppHost application | `0x377` - and DIAGNOSED: the probe passed player id 99 into `Game.IndependentPowers.independentName`, fixed by guarding unknown ids. Not a shipped defect |

## What is established

- **Run 30's signature is the known non-mod one.** `CivilizationVII+0x21081fc` on the AppHost thread at address 0
  is recorded in `civilization_vii_mods/engine-closed.md` as appearing with AND without mod code (2026-09-17).
  It happened while the mod held **nothing**, and the base game's own
  `base-standard/ui/unit-flags/unit-flags-independent-powers.js:463` was throwing
  `Cannot read properties of null (reading 'type')` in the seconds before.
- **The crash is NOT a deterministic function of the mod's state.** Run 32 passed turn 150, went through the age
  transition, and finished holding 38 claims - more than run 31 had when it died at Exploration t26 - without
  faulting. Same config, same save, opposite outcome.
- **Ownership writes are not required.** Run 30 crashed holding zero claims, so "how much territory the mod holds"
  cannot be the whole mechanism.
- Run 31's fault shares a SHAPE with archived run 3 (an async worker dereferencing null plus a small struct
  offset) but on a different binary, so it cannot be called the same crash.
- The mod's last pass before run 31's fault was unremarkable: `passMs=18`, `flips=0`, `confirmed 1 claim`.

## What is NOT established

- **Whether the mod causes it.** The scoreboard is 2 crashes / 3 runs with the mod, 0 / 1 without. At that sample
  size the difference is not meaningful: one more mod-off run could equalise it.
- **Whether the harness is the destabiliser.** It drives 40 turns in about 20 minutes with scripted end-turns,
  which no player does. The control ran the same harness and survived, but that is a single run on the arm that
  matters most.
- **Any player-facing rate.** Nothing here measures how often a real game would fault.

## Why it was parked rather than bisected

The planned bisect (mod loaded/pass off, then claims impossible, then few claims) assumes a clean run at a given
setting means that setting is safe. Against a fault that lands roughly two runs in three and has never reproduced
at the same point twice, a single run per point is a coin toss dressed as a result.

Making the measure usable needs replicates. Separating something like a 65% crash rate from a 15% one takes on the
order of ten runs per arm; at ~20 minutes a run that is about **seven hours of exclusive game time for one
comparison**, before the four-point bisect starts. That is a large spend, and
the evidence does not justify it yet.

## What would re-open it

1. A player report with the artefacts: the macOS `.ips`, the `UI.log` tail, and the `AI_ConstructibleBroker` CSV
   tail. `AI_VERBOSE=1` on `run-harness.sh` now turns that logging on and collects the CSVs.
2. A crash that reproduces at the same point twice - that would make the bisect worth running.
3. Funded replication: about six runs per arm to establish whether a rate difference exists at all.

## Harness traps this cost us (all fixed)

- A harness **cannot switch the mod off from script**: `applyTunableOverrides()` pulls saved settings into `CONFIG`
  on every pass, so `CONFIG.diffusionEnabled = false` is clobbered within a turn. Run 31 was written as the control
  and finished holding 37 claims. `run-harness.sh` now takes `NO_MOD=1`, which leaves the mod disabled in the
  registry, and `cdh-game-control.js` imports nothing from the mod.
- **Never edit `run-harness.sh` while a run is in flight**: zsh re-reads the file mid-execution, which put a
  `parse error near 'then'` into control40's own log.
- The completion grep must match `DONE harness ` broadly; `DONE harness run` missed the control script's
  `DONE harness control finished` and left a finished game idling until timeout.
- zsh **aborts a `for` loop whose glob matches nothing**, which silently skipped AI-log collection on run 32 even
  though `AI_ConstructibleBroker.csv` existed. Fixed with `setopt local_options null_glob`.
- A save whose mods are not installed refuses to load, and the shell reports the missing TITLES. Saves store their
  mod list in plaintext, so `strings <save> | grep <title>` picks a loadable fixture before spending a launch.
