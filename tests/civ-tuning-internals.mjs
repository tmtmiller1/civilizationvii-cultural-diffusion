// tests/civ-tuning-internals.mjs - direct contract tests for the cd-civ-tuning internals.
//
// WHY THIS SUITE EXISTS: BY_MEMENTO ships empty by design, so mementoScale() always returns 1 and
// the whole memento pipeline (mementoIdOf / equippedMementos) plus baseTimesMemento's `mem` leg are
// unobservable through the public civTuning() API. That made their mutants look "equivalent" when
// they are really just untested: the code is live, ships, and activates the moment a memento entry
// is added. These tests pin those contracts now, via the __test handles, so that future entry works
// rather than silently no-opping. Same for leaderName/civName, whose engine-shape tolerance the
// happy-path stubs never exercise.
import assert from "node:assert/strict";

const players = new Map();
globalThis.Players = { get: (pid) => players.get(pid) || null };
globalThis.GameInfo = {
  Leaders: { lookup: (t) => (t ? { LeaderType: t } : null) },
  Civilizations: { lookup: (t) => (t ? { CivilizationType: t } : null) }
};
globalThis.Online = { Metaprogression: { getEquippedMementos: () => [] } };
const setPlayer = (pid, o) => players.set(pid, { leaderType: o.leader || null, civilizationType: o.civ || null });

const { civTuning, NEUTRAL, BY_CIV, __test } = await import("/cultural-diffusion/ui/cd-civ-tuning.js");
const { leaderName, civName, mementoIdOf, equippedMementos, baseTimesMemento, mementoScale } = __test;

// --- bounds constants are the exact documented bands (not blanked to []) ---
assert.deepEqual(__test.CIVLEADER_BOUNDS, [0.6, 1.5], "civ/leader band is [0.6, 1.5]");
assert.deepEqual(__test.MEMENTO_BOUNDS, [0.8, 1.2], "memento stack band is [0.8, 1.2]");
assert.deepEqual(__test.FINAL_BOUNDS, [0.55, 1.6], "resolved-product band is [0.55, 1.6]");

// --- leaderName(): `_ALT` persona normalization is ANCHORED to the end ---
setPlayer(1, { leader: "LEADER_XERXES" });
assert.equal(leaderName(1), "LEADER_XERXES", "a plain leader type passes through");
setPlayer(2, { leader: "LEADER_XERXES_ALT" });
assert.equal(leaderName(2), "LEADER_XERXES", "a trailing _ALT is stripped");
setPlayer(3, { leader: "LEADER_ALT_XERXES" });
assert.equal(leaderName(3), "LEADER_ALT_XERXES", "_ALT mid-string is NOT stripped (regex is $-anchored)");
setPlayer(4, { leader: "LEADER_XERXES_ALT_ALT" });
assert.equal(leaderName(4), "LEADER_XERXES_ALT", "only ONE trailing _ALT is stripped (no global flag)");

// --- leaderName(): non-string / missing / throwing engine reads all resolve to null ---
setPlayer(5, {});
assert.equal(leaderName(5), null, "a player with no leaderType -> null");
assert.equal(leaderName(999), null, "an unknown player id -> null");
globalThis.GameInfo.Leaders.lookup = () => ({ LeaderType: 12345 });
assert.equal(leaderName(1), null, "a non-string LeaderType is rejected by the typeof guard -> null");
globalThis.GameInfo.Leaders.lookup = (t) => (t ? { LeaderType: t } : null);
const savedGet = globalThis.Players.get;
globalThis.Players = { get: () => { throw new Error("engine boom"); } };
assert.equal(leaderName(1), null, "a throwing engine read is caught -> null (not undefined)");
globalThis.Players = { get: savedGet };

// --- civName(): same contract, without the _ALT rule ---
setPlayer(6, { civ: "CIVILIZATION_MONGOLIA" });
assert.equal(civName(6), "CIVILIZATION_MONGOLIA", "a plain civ type passes through");
assert.equal(civName(5), null, "a player with no civilizationType -> null");
globalThis.GameInfo.Civilizations.lookup = () => ({ CivilizationType: {} });
assert.equal(civName(6), null, "a non-string CivilizationType -> null");
globalThis.GameInfo.Civilizations.lookup = () => { throw new Error("engine boom"); };
assert.equal(civName(6), null, "a throwing civ lookup is caught -> null (not undefined)");
globalThis.GameInfo.Civilizations.lookup = (t) => (t ? { CivilizationType: t } : null);

// --- mementoIdOf(): tolerates every runtime shape, and ONLY MEMENTO_* ids ---
assert.equal(mementoIdOf("MEMENTO_A"), "MEMENTO_A", "a bare string entry is its own id");
for (const key of ["mementoTypeId", "mementoType", "Type", "type", "id", "value"]) {
  assert.equal(mementoIdOf({ [key]: "MEMENTO_A" }), "MEMENTO_A", `the '${key}' shape is read`);
}
assert.equal(mementoIdOf(null), null, "a null entry -> null");
assert.equal(mementoIdOf(undefined), null, "an undefined entry -> null");
assert.equal(mementoIdOf({}), null, "an entry with no recognised field -> null");
assert.equal(mementoIdOf({ id: 42 }), null, "a non-string id is rejected by the typeof guard");
assert.equal(mementoIdOf("NOT_A_MEMENTO"), null, "a string without the MEMENTO_ prefix -> null");
assert.equal(mementoIdOf({ id: "XMEMENTO_A" }), null, "startsWith, not includes: an embedded prefix -> null");
// Candidate ORDER: the entry itself, then mementoTypeId, ... - the first MEMENTO_* match wins.
assert.equal(mementoIdOf({ mementoTypeId: "MEMENTO_FIRST", type: "MEMENTO_SECOND" }), "MEMENTO_FIRST",
  "the earlier candidate field wins over a later one");

// --- equippedMementos(): API guards, shape filtering, and dedup ---
const withMeta = (impl) => { globalThis.Online = { Metaprogression: impl }; };
withMeta({ getEquippedMementos: () => ["MEMENTO_A", "MEMENTO_B"] });
assert.deepEqual(equippedMementos(0), ["MEMENTO_A", "MEMENTO_B"], "equipped ids are returned in order");
withMeta({ getEquippedMementos: () => ["MEMENTO_A", "MEMENTO_A", { id: "MEMENTO_A" }] });
assert.deepEqual(equippedMementos(0), ["MEMENTO_A"], "duplicate ids collapse (Set dedup)");
withMeta({ getEquippedMementos: () => ["MEMENTO_A", null, "junk", { nope: 1 }, "MEMENTO_B"] });
assert.deepEqual(equippedMementos(0), ["MEMENTO_A", "MEMENTO_B"], "unreadable entries are skipped, not kept as null");
withMeta({ getEquippedMementos: () => "not-an-array" });
assert.deepEqual(equippedMementos(0), [], "a non-array return is rejected by the isArray guard");
withMeta({ getEquippedMementos: () => { throw new Error("boom"); } });
assert.deepEqual(equippedMementos(0), [], "a throwing metaprogression API is caught -> []");
withMeta({ getEquippedMementos: "not-a-function" });
assert.deepEqual(equippedMementos(0), [], "a non-function API member -> [] (typeof guard)");
withMeta(undefined);
assert.deepEqual(equippedMementos(0), [], "a missing Metaprogression -> []");
globalThis.Online = undefined;
assert.deepEqual(equippedMementos(0), [], "a missing Online namespace -> []");
globalThis.Online = { Metaprogression: { getEquippedMementos: () => [] } };

// --- mementoScale(): BY_MEMENTO is empty, so nothing equipped can move the scale off 1 ---
withMeta({ getEquippedMementos: () => ["MEMENTO_HATSHEPSUT_URAEUS", "MEMENTO_A"] });
assert.equal(mementoScale(0), 1, "with BY_MEMENTO empty, no equipped memento applies -> exactly 1");
globalThis.Online = { Metaprogression: { getEquippedMementos: () => [] } };

// --- baseTimesMemento(): the `mem` leg, unreachable via civTuning() while BY_MEMENTO is empty ---
setPlayer(7, {}); // untuned: no civ, no leader
assert.equal(baseTimesMemento(7, 1), null,
  "no civ/leader entry AND a neutral memento stack -> null (caller returns NEUTRAL)");
assert.ok(Math.abs(baseTimesMemento(7, 1.2) - 1.2) < 1e-9,
  "no civ/leader entry but a NON-neutral memento stack -> the memento scale applies (&& not ||, base null -> 1)");

setPlayer(8, { civ: "CIVILIZATION_MONGOLIA" }); // 0.82
const mongolia = BY_CIV.CIVILIZATION_MONGOLIA.injectionScale;
assert.ok(Math.abs(baseTimesMemento(8, 1) - mongolia) < 1e-9, "a tuned civ with a neutral stack is its own scale");
assert.ok(Math.abs(baseTimesMemento(8, 1.2) - mongolia * 1.2) < 1e-9,
  "base and memento MULTIPLY (0.82 x 1.2 = 0.984, not divided)");

// FINAL_BOUNDS clamps the resolved product at both rails.
assert.ok(Math.abs(baseTimesMemento(8, 5) - 1.6) < 1e-9, "a runaway product clamps to the FINAL_BOUNDS ceiling 1.6");
assert.ok(Math.abs(baseTimesMemento(8, 0.01) - 0.55) < 1e-9, "a collapsing product clamps to the FINAL_BOUNDS floor 0.55");

// Leader still wins over civ through this path.
setPlayer(9, { leader: "LEADER_XERXES", civ: "CIVILIZATION_MONGOLIA" });
assert.ok(Math.abs(baseTimesMemento(9, 1) - 0.8) < 1e-9, "leader entry overrides the civ entry (?? chain order)");

// --- civTuning(): the pid type guard ---
assert.equal(civTuning("nope"), NEUTRAL, "a non-number pid -> NEUTRAL (typeof guard)");
assert.equal(civTuning(undefined), NEUTRAL, "an undefined pid -> NEUTRAL");
assert.equal(civTuning(Number.NaN), NEUTRAL, "NaN is a number, but resolves to no entry -> NEUTRAL");

console.log("civ-tuning-internals.mjs OK");
