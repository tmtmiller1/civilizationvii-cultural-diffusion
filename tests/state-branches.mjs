// tests/state-branches.mjs - branch/edge hardening for the persistence layer.
// Exercises the sanitizer guards (non-finite values, key regex, envelope detection, entry cap),
// the gameTurn() guards, and prepare/prune. Each assertion pins a specific branch.
import assert from "node:assert/strict";

const KV = {};
let gameImpl = { turn: 42 };
globalThis.Configuration = {
  getGame: () => ({ getValue: (k) => (k in KV ? KV[k] : null) }),
  editGame: () => ({ setValue: (k, v) => (KV[k] = v) })
};
globalThis.Game = new Proxy({}, { get: (_t, k) => gameImpl[k] });

const { normalizeState, loadState, saveState, prepareState, pruneState, __test } =
  await import("/cultural-diffusion/ui/cd-state.js");

// --- STATE_KEY is the exact versioned string (not blanked) ---
assert.equal(__test.STATE_KEY, "CulturalDiffusionState_v2", "state key is the exact v2 key");

// --- num() guard inside normalizeFieldRow: non-finite / non-number values are dropped ---
const row = normalizeState({ field: { "1,1": { "0": Infinity, "1": "x", "2": 30, "3": -5, "4": Number.NaN } } });
assert.deepEqual(Object.keys(row.field["1,1"] || {}), ["2"],
  "only the finite positive numeric stock survives (Infinity/NaN/string/negative dropped)");
// A NUMERIC string ("50") passes isFinite but must be rejected by the typeof half of num()'s guard
// (kills the '-> true' left-operand mutant that would keep it as the string "50").
const numstr = normalizeState({ field: { "1,1": { "0": "50", "1": 30 } } });
assert.deepEqual(Object.keys(numstr.field["1,1"] || {}), ["1"],
  "a numeric-string stock is rejected by the typeof half of num() (not kept)");

// --- field-key regex /^-?\d+$/ is fully anchored and multi-digit ---
const keys = normalizeState({ field: { "1,1": { "0": 1, "10": 1, "-1": 1, "x5": 1, "5x": 1, "1.5": 1, "": 1 } } });
assert.deepEqual(Object.keys(keys.field["1,1"]).sort(), ["-1", "0", "10"],
  "only whole (optionally-negative) integer keys pass; 'x5','5x','1.5','' rejected");

// --- normalizeFieldRow / normalizeClaim / normalizeMap object guards do not crash on null rows ---
assert.doesNotThrow(() => normalizeState({ field: { "1,1": null }, claims: { "2,2": null }, locked: {} }),
  "null rows are guarded, not passed to Object.keys");
const nullRows = normalizeState({ field: { "1,1": null }, claims: { "2,2": null } });
assert.equal(nullRows.field["1,1"], undefined, "null field row dropped");
assert.equal(nullRows.claims["2,2"], undefined, "null claim row dropped");
// A whole non-object field/claims map is guarded too.
assert.doesNotThrow(() => normalizeState({ field: null, claims: 5, locked: "nope" }), "non-object maps guarded");
assert.deepEqual(normalizeState({ field: null }).field, {}, "null field map -> empty object");
// A non-object map key ('' empty string) is skipped by normalizeMap.
const emptyKey = normalizeState({ field: { "": { "0": 100 }, "1,1": { "0": 50 } } });
assert.deepEqual(Object.keys(emptyKey.field), ["1,1"], "empty-string map key is skipped");

// --- normalizeClaim: missing 'by' drops the claim; city defaults -1, turn is max(0, floor) ---
const claims = normalizeState({ claims: { a: { city: 1, turn: 2 }, b: { by: 4 }, c: { by: 7, turn: 9 } } });
assert.equal(claims.claims.a, undefined, "a claim with no 'by' is dropped (isFinite guard)");
assert.equal(claims.claims.b.city, -1, "missing city defaults to -1 (not +1)");
assert.equal(claims.claims.b.turn, 0, "missing turn defaults to 0");
assert.equal(claims.claims.c.turn, 9, "a positive turn is kept via max(0, floor) (not min)");

// --- envelope detection: {v,data} unwraps to data; everything else is treated as raw ---
assert.equal(normalizeState({ v: 2, monoTurn: 99, data: { monoTurn: 10 } }).monoTurn, 10,
  "a proper {v,data} envelope unwraps to data.monoTurn");
assert.equal(normalizeState({ monoTurn: 7 }).monoTurn, 7, "a raw object (no v) is used directly");
assert.equal(normalizeState({ v: "x", monoTurn: 7, data: { monoTurn: 99 } }).monoTurn, 7,
  "non-number v -> not an envelope -> raw object used (not data)");
assert.equal(normalizeState({ v: 2, monoTurn: 7, data: 5 }).monoTurn, 7,
  "non-object data -> not an envelope -> raw object used");

// --- the top-level guards: null / non-object / number inputs return a clean default, no throw ---
assert.doesNotThrow(() => normalizeState(null), "null input guarded");
assert.doesNotThrow(() => normalizeState(5), "number input guarded");
assert.deepEqual(normalizeState(null), __test.defaultState(), "null -> default state");
assert.deepEqual(normalizeState(5), __test.defaultState(), "number -> default state");
assert.ok(normalizeState({ monoTurn: 3, field: { "1,1": { "0": 5 } } }).field["1,1"],
  "a valid object is NOT collapsed to default (guard is conditional)");

// --- locked normalizer: only strictly-positive cooldowns survive ---
const locked = normalizeState({ locked: { a: 0, b: 5, c: -3, d: 2.9 } });
assert.deepEqual(Object.keys(locked.locked).sort(), ["b", "d"], "0 and negative locks dropped; positive kept");
assert.equal(locked.locked.d, 2, "lock floored to integer");

// --- entry cap: normalizeMap stops at MAX_FIELD_ENTRIES (20000), does not keep them all ---
const many = {};
for (let i = 0; i < 20001; i++) many["r" + i] = { "0": 100 };
const capped = normalizeState({ field: many });
assert.equal(Object.keys(capped.field).length, 20000, "field entries are capped at 20000 (cap break + n++ counter)");

// --- round-trip through Configuration KV ---
delete KV[__test.STATE_KEY];
saveState({ monoTurn: 10, field: { "3,4": { "0": 550.5 } }, claims: {}, locked: {} });
assert.ok(KV[__test.STATE_KEY], "saveState writes to the game config store");
assert.equal(loadState().field["3,4"]["0"], 550.5, "loadState restores the persisted stock");

// --- gameTurn(): the '&& typeof turn === number' guard and the catch ---
// prepareState uses max(monoTurn+1, gameTurn()). A non-number Game.turn must read as 0, not poison it.
gameImpl = { turn: "not-a-number" };
const stA = normalizeState({ monoTurn: 5 });
prepareState(stA);
assert.equal(stA.monoTurn, 6, "non-number Game.turn -> gameTurn 0 -> monoTurn advances to 6 (not NaN)");

gameImpl = new Proxy({}, { get() { throw new Error("boom"); } });
const stB = normalizeState({ monoTurn: 5 });
prepareState(stB);
assert.equal(stB.monoTurn, 6, "a throwing Game.turn is caught -> gameTurn 0 -> monoTurn 6 (catch returns 0)");

// prepareState monoTurn advance is +1 (not -1), and it initialises a missing locked map.
gameImpl = { turn: 0 };
const stC = normalizeState({ monoTurn: 5 });
prepareState(stC);
assert.equal(stC.monoTurn, 6, "monoTurn advances by +1 when gameTurn is low");
assert.doesNotThrow(() => prepareState({ monoTurn: 1 }), "a state with no locked map is guarded (locked = {})");
// Lock cooldowns tick down and expire.
gameImpl = { turn: 42 };
const stLock = normalizeState({ monoTurn: 5, locked: { keep: 3, expire: 1 } });
prepareState(stLock);
assert.equal(stLock.locked.keep, 2, "lock cooldown ticks down by 1");
assert.equal(stLock.locked.expire, undefined, "a lock reaching 0 is deleted");

// --- pruneState: drops all-zero rows and empty tiles, keeps any positive stock ---
// Build field DIRECTLY (bypassing normalize, which would strip the 0s we want to prune here).
const pr = { field: { onlyZero: { "0": 0 }, mixed: { "0": 0, "1": 5 }, live: { "0": 30 } } };
pruneState(pr);
assert.equal(pr.field.onlyZero, undefined, "an all-zero tile is pruned (any stays false -> deleted)");
assert.ok(pr.field.live, "a tile with positive stock is kept");
assert.equal(pr.field.mixed["0"], undefined, "the zero stock inside a live tile is deleted (>0, not >=0)");
assert.equal(pr.field.mixed["1"], 5, "the positive stock inside that tile is kept (any = true)");

console.log("state-branches.mjs OK");
