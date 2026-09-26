// tests/conversion.mjs - the engine-facing half of conversion (cd-conversion.js): constructible ids resolve to type
// names through Constructibles.get + GameInfo.Constructibles.lookup, traditions and the ideology through the
// owner's Culture component, array-LIKE lists are iterated, and every unreadable surface degrades to the base rate.
import assert from "node:assert/strict";

const instances = new Map(); // constructible id -> { type }
const types = new Map();     // type hash -> ConstructibleType
globalThis.Constructibles = { get: (id) => instances.get(id) || null };
globalThis.GameInfo = {
  Constructibles: { lookup: (t) => (types.has(t) ? { ConstructibleType: types.get(t) } : null) },
  Traditions: { lookup: (t) => (t === 71 ? { TraditionType: "TRADITION_TRIAL_OF_TIME" } : null) },
  Ideologies: { lookup: (i) => (i === 5 ? { IdeologyType: "IDEOLOGY_FASCISM" } : null) }
};
globalThis.CultureSlotTypes = { POLICY_CULTURE_SLOT: 0, TRADITION_CULTURE_SLOT: 1, NORMAL_CULTURE_SLOT: 2 };
let ideology = 5;
let traditions = [71, 71];
globalThis.Players = {
  get: (pid) => (pid === 3 ? {
    Culture: {
      getActiveTraditions: (slot) => (slot === 1 ? traditions : []),
      getChosenIdeology: () => ideology
    }
  } : null)
};

const { cityConstructibleTypes, playerCultureTypes, conversionRate } =
  await import("/cultural-diffusion/ui/cd-conversion.js");

// An array-LIKE id list (no Array.prototype), as the engine hands back.
instances.set("c1", { type: 101 }); instances.set("c2", { type: 102 }); instances.set("c3", { type: 103 });
types.set(101, "BUILDING_LIBRARY"); types.set(102, "BUILDING_GRANARY");
const ids = { 0: "c1", 1: "c2", 2: "c3", length: 3, [Symbol.iterator]: function* () { yield "c1"; yield "c2"; yield "c3"; } };
const city = { Constructibles: { getIds: () => ids } };

assert.deepEqual(cityConstructibleTypes(city), ["BUILDING_LIBRARY", "BUILDING_GRANARY"],
  "ids resolve to type names; an id without a row is skipped");
assert.deepEqual(playerCultureTypes(3), ["TRADITION_TRIAL_OF_TIME", "IDEOLOGY_FASCISM"],
  "traditions (deduplicated) then the ideology");

const cfg = { convertBase: 0.005, convertBonuses: { BUILDING_LIBRARY: 0.0025, IDEOLOGY_FASCISM: 0.0175, TRADITION_TRIAL_OF_TIME: 0.005 } };
assert.ok(Math.abs(conversionRate(city, 3, cfg) - 0.03) < 1e-9, "base + library + tradition + ideology");

ideology = 999; // an ideology the table does not know (or no ideology yet)
assert.ok(Math.abs(conversionRate(city, 3, cfg) - 0.0125) < 1e-9, "an unknown ideology adds nothing");
traditions = null; // Culture.getActiveTraditions returns nothing readable
assert.ok(Math.abs(conversionRate(city, 3, cfg) - 0.0075) < 1e-9, "unreadable traditions degrade to none");

assert.ok(Math.abs(conversionRate({}, 3, cfg) - 0.005) < 1e-9, "a city without Constructibles: the base rate");
assert.ok(Math.abs(conversionRate(city, 8, cfg) - 0.0075) < 1e-9, "an unknown player: buildings only");
assert.deepEqual(cityConstructibleTypes({ Constructibles: { getIds: () => { throw new Error("boom"); } } }), [],
  "a throwing read yields no names, never an exception");

console.log("conversion.mjs OK");
