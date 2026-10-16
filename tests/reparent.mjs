// tests/reparent.mjs: a tile stuck on a settlement too far away to work it moves to one of ours that can.
//
// The shape it heals: a tile attached to one of our settlements more than baseGrowthRadius (3) away while another of
// our settlements is within 3. The far one can't work it, and the near one can't expand onto it (watched 2026-10-16,
// lab seed 4242: a town 2 from such a tile had it out of its EXPAND list and a direct EXPAND placed nothing). 1.0.6
// left inner tiles like this; today a frontier claim does it when a settlement is founded beside it. Re-buying with
// the near settlement moves it (watched 2026-10-16); an improved tile goes by teardown, buy, rebuild. The scan reads
// the map, not the mod's claim records, so it heals tiles the records lost.
import assert from "node:assert/strict";

const ME = 0;
const W = 100;
const idx = (x, y) => y * W + (x + 50);
const loc = (i) => ({ x: (i % W) - 50, y: Math.floor(i / W) });
const tk = (x, y) => `${x},${y}`;
const tiles = new Map(); // "x,y" -> { owner, city, district, constructibles }
const tile = (x, y) => {
  if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1, district: null, constructibles: [] });
  return tiles.get(tk(x, y));
};
const plainBuysOfDistrictTiles = [];
const rebuildsBeforeMove = [];
const requests = [];

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameContext = { localPlayerID: ME };
globalThis.DistrictTypes = { CITY_CENTER: 1, URBAN: 2, RURAL: 3 };
globalThis.GameplayMap = {
  getOwner: (x, y) => tile(x, y).owner,
  getOwningCityFromXY: (x, y) => ({ id: tile(x, y).city }),
  getLocationFromIndex: (i) => loc(i),
  getIndexFromXY: (x, y) => idx(x, y)
};
globalThis.MapCities = {
  getCity: (x, y) => (tile(x, y).city >= 0 ? { owner: tile(x, y).owner, id: tile(x, y).city, type: 1 } : null),
  getDistrict: (x, y) => tile(x, y).district
};
globalThis.Districts = { get: (id) => (id ? { id, type: DistrictTypes.RURAL } : null) };
globalThis.MapConstructibles = { getConstructibles: (x, y) => tile(x, y).constructibles.map((c) => c.id) };
const FARM = { ConstructibleType: "IMPROVEMENT_FARM", ConstructibleClass: "IMPROVEMENT", $index: 4 };
globalThis.Constructibles = { getByComponentID: (id) => ({ type: "IMPROVEMENT_FARM", id }) };
globalThis.GameInfo = { Constructibles: { lookup: (t) => (t === "IMPROVEMENT_FARM" || t === 4 ? FARM : null) } };
globalThis.Players = { get: () => ({ Treasury: { goldBalance: 1000, changeGoldBalance: () => {} } }), grantYield: () => {} };
globalThis.YieldTypes = { YIELD_GOLD: 7 };
const at = (a) => a.Location;
globalThis.Game = {
  PlayerOperations: {
    sendRequest: (_s, op, args) => {
      requests.push({ op, kind: args.Kind, parent: args.Parent ? args.Parent.id : null });
      const t = args.Location ? tile(at(args).x, at(args).y) : null;
      if (op === "DESTROY_ELEMENT") {
        for (const [, v] of tiles) {
          if (args.Kind === "CONSTRUCTIBLE") v.constructibles = v.constructibles.filter((c) => c.id.id !== args.LocalID);
          if (args.Kind === "DISTRICT" && v.district && v.district.id === args.LocalID) v.district = null;
        }
      }
      if (op === "CREATE_ELEMENT" && t) {
        if (t.city !== args.Parent.id) rebuildsBeforeMove.push(tk(at(args).x, at(args).y));
        if (args.Kind === "DISTRICT") t.district = { owner: args.Owner, id: 900 + requests.length };
        if (args.Kind === "CONSTRUCTIBLE") t.constructibles.push({ id: { owner: args.Owner, id: 950 + requests.length } });
      }
    }
  }
};

// A settlement: purchasePlot lands a few ms later, as the engine's does (the owning city changes, the owner doesn't).
function settlement(id, x, y, owner = ME) {
  const city = {
    id: { owner, id, type: 1 },
    location: { x, y },
    getPurchasedPlots: () => [...tiles].filter(([, v]) => v.city === id).map(([k]) => { const [a, b] = k.split(",").map(Number); return idx(a, b); }),
    purchasePlot: (l) => {
      const t = tile(l.x, l.y);
      if (t.district) plainBuysOfDistrictTiles.push(tk(l.x, l.y));
      setTimeout(() => { t.owner = owner; t.city = id; }, 2);
    }
  };
  return { city, id, loc: { x, y } };
}
function own(x, y, cityId, improved, owner = ME) {
  const t = tile(x, y);
  Object.assign(t, { owner, city: cityId, district: null, constructibles: [] });
  if (improved) { t.district = { owner, id: 500 + x * 7 + y }; t.constructibles = [{ id: { owner, id: 600 + x * 7 + y } }]; }
}
const later = (ms) => new Promise((r) => setTimeout(r, ms));

const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
CONFIG.baseGrowthRadius = 3;
CONFIG.maxFlipsPerTurn = 8;
const { stuckTiles, reparentStuck, reparentAll } = await import("/cultural-diffusion/ui/cd-reparent.js");

// Row y=4, so tiles sit |dx| apart. A (id 1) at (0,4), B (id 2) at (5,4), D (id 3) far away at (-8,4).
function layout() {
  tiles.clear(); requests.length = 0; plainBuysOfDistrictTiles.length = 0; rebuildsBeforeMove.length = 0;
  const A = settlement(1, 0, 4); const B = settlement(2, 5, 4); const D = settlement(3, -8, 4);
  own(0, 4, 1); own(5, 4, 2); own(-8, 4, 3);              // the centres
  own(4, 4, 1);          // T: A's, 4 from A and 1 from B -> stuck, goes to B (a frontier claim after B was founded)
  own(3, 4, 1);          // V: A's, 3 from A, 2 from B -> A can work it; stays even though B is nearer
  own(2, 4, 3, true);    // S: D's (10 away), 2 from A, 3 from B, with a Farm -> stuck, goes to A by teardown
  own(9, 4, 2);          // F: B's frontier, 4 from B, nobody else within 3 -> stays
  return [A, B, D];
}

// 1. The scan: from the map, no claim records involved.
let cities = layout();
const found = stuckTiles(cities, 3).map((s) => `${tk(s.loc.x, s.loc.y)}:${s.from.id}->${s.to.id}`).sort();
assert.deepEqual(found, ["2,4:3->1", "4,4:1->2"], "the scan finds exactly the two stuck tiles and the settlement each goes to");

// 2. The heal with empty claim records: both move, the improved one by teardown, never a plain buy.
cities = layout();
const state = { claims: {}, pending: {}, locked: {}, monoTurn: 30 };
let moved = reparentStuck(state, cities, ME, new Set());
assert.equal(moved, 2, "two moves sent");
await later(700);
assert.equal(tile(4, 4).city, 2, "the bare stuck tile is now B's");
assert.equal(tile(2, 4).city, 1, "the improved stuck tile is now A's");
assert.equal(tile(2, 4).constructibles.length, 1, "...with its improvement rebuilt");
assert.ok(tile(2, 4).district, "...and its rural district");
assert.deepEqual(plainBuysOfDistrictTiles, [], "a tile with a district is never bought as it stands");
assert.deepEqual(rebuildsBeforeMove, [], "nothing is rebuilt before the tile has moved to the buyer");
assert.equal(tile(3, 4).city, 1, "a tile its owner can work stays put");
assert.equal(tile(9, 4).city, 2, "a frontier tile with nobody nearer stays put");
assert.equal(tile(4, 4).owner, ME, "the owner never changes");

// 3. Idempotent: a second pass finds nothing, so nothing swaps back.
assert.equal(stuckTiles(cities, 3).length, 0, "nothing left to move");
assert.equal(reparentStuck(state, cities, ME, new Set()), 0, "a second pass moves nothing");

// 4. The cap, busy settlement plots and pending claims are respected.
cities = layout();
CONFIG.maxFlipsPerTurn = 1;
assert.equal(reparentStuck({ claims: {}, pending: {} }, cities, ME, new Set()), 1, "maxFlipsPerTurn caps the moves");
CONFIG.maxFlipsPerTurn = 8;
await later(700);
cities = layout();
assert.equal(reparentStuck({ claims: {}, pending: {} }, cities, ME, new Set(["4,4", "2,4"])), 0, "plots of a settlement about to flip are left alone");
cities = layout();
const pend = { claims: {}, pending: { "4,4": { kind: "claim", by: ME }, "2,4": { kind: "claim", by: ME } } };
assert.equal(reparentStuck(pend, cities, ME, new Set()), 0, "a tile with a claim in flight is left alone");

// 5. Every major civilization's stuck tiles move, never a city-state's or an independent's. The AI's tiles go the
// same way ours do (an AI culture claim gets stuck exactly like ours when it founds beside it), each civilization
// with its own cap so one can't starve another.
const AI = 1; const CS = 2;
function world() {
  tiles.clear(); requests.length = 0; plainBuysOfDistrictTiles.length = 0; rebuildsBeforeMove.length = 0;
  const mine = [settlement(1, 0, 4), settlement(2, 5, 4)];
  own(0, 4, 1); own(5, 4, 2); own(4, 4, 1);                                   // ours: (4,4) stuck on 1, goes to 2
  const ai = [settlement(11, 0, 10, AI), settlement(12, 5, 10, AI), settlement(13, -8, 10, AI)];
  own(0, 10, 11, false, AI); own(5, 10, 12, false, AI); own(-8, 10, 13, false, AI);
  own(4, 10, 11, false, AI); own(2, 10, 13, true, AI);                         // AI: (4,10) to 12, (2,10) 13 -> 11
  const cs = [settlement(21, 0, 16, CS), settlement(22, 5, 16, CS)];
  own(0, 16, 21, false, CS); own(5, 16, 22, false, CS); own(4, 16, 21, false, CS); // city-state: stuck, left alone
  const city = (rows) => rows.map((r) => r.city);
  globalThis.Players = {
    get: () => ({ Treasury: { goldBalance: 1000, changeGoldBalance: () => {} } }), grantYield: () => {},
    getAlive: () => [
      { id: ME, isAlive: true, isMajor: true, Cities: { getCities: () => city(mine) } },
      { id: AI, isAlive: true, isMajor: true, Cities: { getCities: () => city(ai) } },
      { id: CS, isAlive: true, isMajor: false, Cities: { getCities: () => city(cs) } }
    ]
  };
}
world();
moved = reparentAll({ claims: {}, pending: {} }, new Set());
assert.equal(moved, 3, "our one stuck tile and the AI's two move");
await later(700);
assert.equal(tile(4, 4).city, 2, "our stuck tile moved");
assert.deepEqual([tile(4, 10).city, tile(4, 10).owner], [12, AI], "the AI's bare stuck tile moved to its near settlement, still the AI's");
assert.deepEqual([tile(2, 10).city, tile(2, 10).owner], [11, AI], "the AI's improved stuck tile moved too");
assert.equal(tile(2, 10).constructibles.length, 1, "...with its improvement rebuilt");
assert.ok(requests.filter((q) => q.op === "CREATE_ELEMENT").every((q) => q.parent !== null), "every rebuild names its settlement");
assert.deepEqual(rebuildsBeforeMove, [], "no AI rebuild before its tile moved");
assert.equal(tile(4, 16).city, 21, "a city-state's tile is never touched");
assert.equal(reparentAll({ claims: {}, pending: {} }, new Set()), 0, "a second pass moves nothing");
world();
CONFIG.maxFlipsPerTurn = 1;
assert.equal(reparentAll({ claims: {}, pending: {} }, new Set()), 2, "the cap is per civilization: one of ours, one of the AI's");
CONFIG.maxFlipsPerTurn = 8;
await later(700);
world();
const aiPending = { claims: {}, pending: { "4,10": { kind: "claim", by: AI }, "2,10": { kind: "claim", by: AI } } };
assert.equal(reparentAll(aiPending, new Set()), 1, "an AI tile with the AI's claim in flight waits; ours still moves");
await later(700);

console.log("reparent.mjs OK");
