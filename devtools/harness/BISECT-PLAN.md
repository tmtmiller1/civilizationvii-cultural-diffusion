# Crash bisect plan (drafted 2026-09-24, not yet run)

## What is established

| Run | Mod | Claims at fault | Result |
| --- | --- | --- | --- |
| 30 | on | **0** | crash, Antiquity t150, AppHost thread, `0x21081fc`, addr `0x0` |
| 31 | on | **37** | crash, Exploration t26 (after the age transition), AsyncWorker3, addr `0x2d8` |
| control40 | **off** | - | **57 turns, age transition included, NO crash** |
| 32 | on, `AI_VERBOSE=1` | ? | running: does the `AI_ConstructibleBroker` tail name a culprit? |

Two crashes in two runs with the mod, none in 57 turns without it, same save and harness within one hour. That
implicates the mod. Two things argue against a simple defect in it: the crashes were on DIFFERENT threads with
DIFFERENT fault addresses at unrelated points, and **run 30 held no claims at all** - so the mod's ownership
WRITES cannot be the whole story. A plausible alternative is that the pass's per-turn work perturbs timing
enough to expose an engine fragility, which would still be worth mitigating but is not data corruption.

## Order of splits (highest information first)

Run each point TWICE. A single clean run proves very little against a fault that has not yet reproduced at the
same place twice.

1. **Mod loaded, pass OFF.** Separates "the mod is loaded" from "the pass runs". Run 30 says claims are not
   required to crash, so this is the real top-level split - not claim count.
   `CONFIG_PATCH="diffusionEnabled=false"`
2. **Pass ON, no claims possible.** `flipMaxDistance=3` equals `baseGrowthRadius`, so every candidate is inside
   our own rings and nothing is ever claimed: the field math and all its map reads run, no ownership writes.
   Separates READS from WRITES.
   `CONFIG_PATCH="flipMaxDistance=3"`
3. **Pass ON, few claims.** `maxDiffusionPlots=5`.
4. **Pass ON, claims but no strand guard / minor floor** (`protectTrappedUnits=false,minorProtectRadius=-1`) -
   only if 1-3 point at this session's additions rather than the pass in general.

## Mechanism

`CONFIG_PATCH="key=value,key=value"` to be added to `run-harness.sh`: sed each pair into the DEPLOYED
`ui/cd-config.js` (never the repo). This works even for settings-driven keys, because `cd-settings.js` falls back
to `CONFIG_DEFAULTS` - which is read from `cd-config.js` - when the player has no saved value. Verify per run by
logging the live value at S0; a saved player value would silently win.

Keys the settings layer OVERWRITES (patch the default AND confirm at S0): `claimOnlyUnowned`, `coreProtectRadius`,
`debug`, `diffusionEnabled`, `fusedModel`, `growthBuffer`, `recedeBorders`, `requireAdjacency`, `useEmigration`.
Everything else (`maxDiffusionPlots`, `flipMaxDistance`, `baseGrowthRadius`, `minorProtectRadius`,
`protectTrappedUnits`) a harness may set directly.

## Harness rules learned the hard way

- **Never edit `run-harness.sh` while a run is in flight.** zsh re-reads the file mid-execution; doing this put a
  `parse error near 'then'` into control40's own log (the teardown still completed, but that was luck).
- A harness cannot switch the mod off from script: `applyTunableOverrides()` pulls saved settings into `CONFIG`
  every pass. Use `NO_MOD=1` for a true control, or patch the deployed defaults.
- Match harness completion with `DONE harness ` - the control script emits `DONE harness control finished` and the
  original `DONE harness run` grep missed it, leaving a finished game idling until timeout.
