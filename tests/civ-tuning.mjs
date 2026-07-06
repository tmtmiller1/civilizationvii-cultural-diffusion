// tests/civ-tuning.mjs - the bounded per-leader/civ/memento injection variance layer.
import assert from "node:assert/strict";

// Stub the minimal engine surface BEFORE import (mirrors how the mod reads leader/civ/mementos).
const players = new Map();
globalThis.Players = { get: (pid) => players.get(pid) || null };
globalThis.GameInfo = {
  Leaders: { lookup: (t) => (t ? { LeaderType: t } : null) },
  Civilizations: { lookup: (t) => (t ? { CivilizationType: t } : null) }
};
let equipped = [];
globalThis.Online = { Metaprogression: { getEquippedMementos: () => equipped } };
const setPlayer = (pid, o) => players.set(pid, { leaderType: o.leader || null, civilizationType: o.civ || null });

const { civTuning, NEUTRAL, BY_LEADER, BY_CIV, BY_MEMENTO, __test } =
  await import("/cultural-diffusion/ui/cd-civ-tuning.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
const { LEADER_ROSTER, CIV_ROSTER, MEMENTO_ROSTER } = await import("/cultural-diffusion/ui/cd-civ-roster.js");

// Completeness: every tuned key is a REAL game type (in the roster).
for (const k of Object.keys(BY_LEADER)) assert.ok(LEADER_ROSTER.includes(k), `${k} is a real leader`);
for (const k of Object.keys(BY_CIV)) assert.ok(CIV_ROSTER.includes(k), `${k} is a real civilization`);
for (const k of Object.keys(BY_MEMENTO)) assert.ok(MEMENTO_ROSTER.includes(k), `${k} is a real memento`);

// Bounds: no single entry escapes the civ/leader band.
const [lo, hi] = __test.CIVLEADER_BOUNDS;
for (const t of [...Object.values(BY_LEADER), ...Object.values(BY_CIV)]) {
  assert.ok(t.injectionScale >= lo && t.injectionScale <= hi, `entry ${t.injectionScale} within [${lo},${hi}]`);
}

// Unknown player -> neutral.
setPlayer(0, {});
assert.equal(civTuning(0), NEUTRAL, "untuned player is neutral");

// A pure culture engine is NOT in the table - the composite base flattens it structurally.
setPlayer(1, { civ: "CIVILIZATION_GREECE" });
assert.equal(civTuning(1), NEUTRAL, "culture engines are handled by the composite, not damped here");

// A territory-redundant civ IS damped (< 1).
setPlayer(6, { civ: "CIVILIZATION_MONGOLIA" });
assert.ok(civTuning(6).injectionScale < 1, "territory-redundant civ is damped");

// Leader overrides civ (Xerxes' culture-on-capture double-dip wins over the civ entry).
setPlayer(2, { leader: "LEADER_XERXES", civ: "CIVILIZATION_MONGOLIA" });
assert.ok(Math.abs(civTuning(2).injectionScale - BY_LEADER.LEADER_XERXES.injectionScale) < 1e-9, "leader wins over civ");

// Persona _ALT normalizes to the base leader.
setPlayer(3, { leader: "LEADER_XERXES_ALT" });
assert.ok(Math.abs(civTuning(3).injectionScale - BY_LEADER.LEADER_XERXES.injectionScale) < 1e-9, "_ALT persona shares the entry");

// Mementos are no longer tuned (all were magnitude cases -> flattened by the composite).
equipped = ["MEMENTO_HATSHEPSUT_URAEUS", "MEMENTO_FOUNDATION_CORPUS_JURIS_CIVILIS"];
setPlayer(5, {});
assert.equal(civTuning(5), NEUTRAL, "equipped culture mementos have no tuning effect");
equipped = [];

// civTuningStrength compresses toward neutral, using the territory-redundant entry.
CONFIG.civTuningStrength = 0;
assert.equal(civTuning(6).injectionScale, 1, "strength 0 flattens to neutral");
CONFIG.civTuningStrength = 0.5;
const half = civTuning(6).injectionScale;
CONFIG.civTuningStrength = 1;
const full = civTuning(6).injectionScale;
assert.ok(full < half && half < 1, "partial strength interpolates toward neutral");

// Master toggle off -> neutral, touches nothing.
CONFIG.civTuningEnabled = false;
assert.equal(civTuning(6), NEUTRAL, "disabled -> neutral");
CONFIG.civTuningEnabled = true;

// flatten (reads CONFIG.civTuningStrength, now 1) is identity; clamp bounds.
assert.ok(Math.abs(__test.flatten(0.8) - 0.8) < 1e-9, "flatten at full strength is identity");
assert.equal(__test.clamp(5, 0, 1), 1);
assert.equal(__test.clamp(-5, 0, 1), 0);

console.log("civ-tuning.mjs OK");
