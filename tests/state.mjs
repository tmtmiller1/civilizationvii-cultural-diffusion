// tests/state.mjs - persistence schema round-trip + prune/prepare (culture-field model).
import assert from "node:assert/strict";

const KV = {};
globalThis.Configuration = {
  getGame: () => ({ getValue: (k) => (k in KV ? KV[k] : null) }),
  editGame: () => ({ setValue: (k, v) => (KV[k] = v) })
};
globalThis.Game = { turn: 42 };

const { normalizeState, loadState, saveState, prepareState, pruneState, __test } =
  await import("/cultural-diffusion/ui/cd-state.js");

// Empty load yields a well-formed default.
delete KV[__test.STATE_KEY];
const empty = loadState();
assert.ok(empty && typeof empty === "object");
assert.equal(typeof empty.monoTurn, "number");
assert.ok(empty.field && typeof empty.field === "object");
assert.ok(empty.claims && typeof empty.claims === "object");
assert.ok(empty.locked && typeof empty.locked === "object");

// Save writes a versioned envelope; load restores the per-tile culture field.
const original = {
  monoTurn: 10,
  field: { "3,4": { "0": 550.5, "1": 120 } },
  claims: { "3,4": { by: 0, city: 7, turn: 9 } },
  locked: { "3,4": 5 }
};
saveState(original);
const persisted = JSON.parse(KV[__test.STATE_KEY]);
assert.equal(persisted.v, 2, "envelope carries the v2 schema version");

const loaded = loadState();
assert.equal(loaded.monoTurn, 10);
assert.equal(loaded.field["3,4"]["0"], 550.5, "civ 0's stock survives the round trip");
assert.equal(loaded.field["3,4"]["1"], 120);
assert.equal(loaded.claims["3,4"].city, 7);
assert.equal(loaded.locked["3,4"], 5);

// normalizeState drops junk field entries (non-civ keys, non-positive values).
const cleaned = normalizeState({ field: { "1,1": { "0": 100, "x": 5, "1": 0, "2": -3 } }, claims: {}, locked: {} });
assert.deepEqual(Object.keys(cleaned.field["1,1"]), ["0"], "only positive civ-id stocks kept");

// prepareState advances monoTurn to at least Game.turn and ticks locks down.
const st = normalizeState({ monoTurn: 5, field: {}, claims: {}, locked: { "1,1": 3 } });
prepareState(st);
assert.ok(st.monoTurn >= 42, "monoTurn tracks Game.turn");
assert.equal(st.locked["1,1"], 2, "lock cooldown ticks down");
const st2 = normalizeState({ monoTurn: 5, field: {}, claims: {}, locked: { "2,2": 1 } });
prepareState(st2);
assert.equal(st2.locked["2,2"], undefined, "expired lock removed");

// pruneState drops emptied field tiles but keeps ones with any live stock.
const pr = normalizeState({
  monoTurn: 1,
  field: { gone: { "0": 0 }, live: { "0": 30 } },
  claims: {}, locked: {}
});
pruneState(pr);
assert.equal(pr.field.gone, undefined, "emptied tile pruned");
assert.ok(pr.field.live, "tile with stock kept");

console.log("state.mjs OK");
