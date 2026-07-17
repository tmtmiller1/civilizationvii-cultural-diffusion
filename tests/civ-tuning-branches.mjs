// tests/civ-tuning-branches.mjs - branch/edge hardening for the per-civ tuning layer.
// Focuses on the branches observable through the PUBLIC civTuning() API: the UNTUNED_* roster
// filters, the flatten() compression, and the shared-NEUTRAL identity return.
// The memento pipeline is not reachable from here (BY_MEMENTO ships empty by design), but its
// internals are real, live code with real contracts - they are pinned directly, via the __test
// handles, in tests/civ-tuning-internals.mjs.
import assert from "node:assert/strict";

const players = new Map();
globalThis.Players = { get: (pid) => players.get(pid) || null };
globalThis.GameInfo = {
  Leaders: { lookup: (t) => (t ? { LeaderType: t } : null) },
  Civilizations: { lookup: (t) => (t ? { CivilizationType: t } : null) }
};
globalThis.Online = { Metaprogression: { getEquippedMementos: () => [] } };
const setPlayer = (pid, o) => players.set(pid, { leaderType: o.leader || null, civilizationType: o.civ || null });

const { civTuning, NEUTRAL, BY_LEADER, BY_CIV, UNTUNED_LEADERS, UNTUNED_CIVS, UNTUNED_MEMENTOS, __test } =
  await import("/cultural-diffusion/ui/cd-civ-tuning.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
const { LEADER_ROSTER, CIV_ROSTER } = await import("/cultural-diffusion/ui/cd-civ-roster.js");

// --- UNTUNED_* filters actually filter (not the identity roster, not empty) ---
assert.ok(UNTUNED_LEADERS.length > 0, "some leaders are untuned (filter predicate is real, not always-false)");
assert.ok(UNTUNED_LEADERS.length < LEADER_ROSTER.length, "not EVERY leader is untuned (filter runs, not bypassed)");
for (const k of Object.keys(BY_LEADER)) {
  assert.ok(!UNTUNED_LEADERS.includes(k), `${k} is tuned, so it is excluded from UNTUNED_LEADERS`);
}
assert.ok(UNTUNED_CIVS.length > 0, "some civs are untuned");
assert.ok(UNTUNED_CIVS.length < CIV_ROSTER.length, "not every civ is untuned");
for (const k of Object.keys(BY_CIV)) {
  assert.ok(!UNTUNED_CIVS.includes(k), `${k} is tuned, so it is excluded from UNTUNED_CIVS`);
}
// BY_MEMENTO is empty, so every memento is untuned - the filter must keep them all, not drop them.
assert.ok(UNTUNED_MEMENTOS.length > 0, "with no memento tuning, every memento is untuned (predicate keeps them)");

// --- flatten(): compression toward neutral scales by CONFIG.civTuningStrength ---
const savedStrength = CONFIG.civTuningStrength;
CONFIG.civTuningStrength = 0.5;
assert.ok(Math.abs(__test.flatten(0.8) - 0.9) < 1e-9, "strength 0.5 halves the deviation: 0.8 -> 0.9");
assert.ok(Math.abs(__test.flatten(1.4) - 1.2) < 1e-9, "strength 0.5 on 1.4 -> 1.2");
CONFIG.civTuningStrength = 1;
assert.ok(Math.abs(__test.flatten(0.8) - 0.8) < 1e-9, "strength 1 is identity");
// A non-number strength is coerced to full strength (1), not NaN-propagated.
CONFIG.civTuningStrength = "oops";
assert.ok(Math.abs(__test.flatten(0.8) - 0.8) < 1e-9, "non-number strength -> treated as full (1), not NaN");
CONFIG.civTuningStrength = savedStrength;

// --- civTuning() returns the SHARED frozen NEUTRAL (identity), not a fresh {injectionScale:1} ---
// At strength 0 a tuned civ flattens exactly to 1, which must collapse to the shared NEUTRAL.
setPlayer(6, { civ: "CIVILIZATION_MONGOLIA" });
CONFIG.civTuningStrength = 0;
assert.equal(civTuning(6), NEUTRAL, "a tuned civ flattened to 1 returns the shared NEUTRAL object (identity)");
CONFIG.civTuningStrength = savedStrength;
// And a real, non-neutral tuning returns a NEW object, not NEUTRAL.
assert.notEqual(civTuning(6), NEUTRAL, "an actually-damped civ returns its own object, not NEUTRAL");
assert.ok(civTuning(6).injectionScale < 1, "...and it is damped below 1");

console.log("civ-tuning-branches.mjs OK");
