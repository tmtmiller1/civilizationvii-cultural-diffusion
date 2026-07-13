// tests/repair.mjs - orphan-tile healing (the "inner ring won't expand" fix).
//
// An orphan is a tile owner === me with NO owning city (owningCity < 0), produced by the legacy
// setOwnership verb. repairOrphans must re-integrate each orphan into its nearest city (via the
// integrated verb) so it stops blocking base-game growth; if the re-buy can't take, it releases
// the tile back to the map. Integrated (owningCity >= 0) tiles must be left untouched.
import assert from "node:assert/strict";

// --- controllable engine stub over an (x,y) -> {owner, city} tile map ------------
const tiles = new Map();
const tk = (x, y) => `${x},${y}`;
const setTile = (x, y, owner, city) => tiles.set(tk(x, y), { owner, city });
const getTile = (x, y) => tiles.get(tk(x, y)) || { owner: -1, city: -1 };

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameplayMap = {
  getOwner: (x, y) => getTile(x, y).owner,
  getOwningCityFromXY: (x, y) => ({ id: getTile(x, y).city })
};
globalThis.WorldBuilder = {
  MapPlots: { setOwnership: (pid, loc) => { getTileMut(loc.x, loc.y).owner = pid; if (pid < 0) getTileMut(loc.x, loc.y).city = -1; } }
};
globalThis.Players = { get: () => ({ Treasury: { goldBalance: 1000, changeGoldBalance: () => {} } }) };
function getTileMut(x, y) {
  if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1 });
  return tiles.get(tk(x, y));
}

const { __test } = await import("/cultural-diffusion/ui/cd-pass.js");
const { repairOrphans } = __test;
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
CONFIG.repairOrphans = true;

const ME = 0;
const CITY_ID = 42;
// A city whose purchasePlot integrates a tile: owner=ME, owningCity=CITY_ID.
const city = { purchasePlot: (loc) => { const t = getTileMut(loc.x, loc.y); t.owner = ME; t.city = CITY_ID; } };
const cities = [{ city, id: CITY_ID, loc: { x: 5, y: 5 } }];

// --- scenario -------------------------------------------------------------------
tiles.clear();
setTile(5, 5, ME, CITY_ID);   // city center (integrated) - must be left alone
setTile(5, 6, ME, -1);        // ORPHAN adjacent to the city (owner me, no city)
setTile(6, 6, ME, -1);        // ORPHAN a bit further out
setTile(7, 7, 3, 9);          // a rival's real tile - not ours, must be ignored
const region = new Set(["5,5", "5,6", "6,6", "7,7"]);
const state = { claims: { "5,6": { by: ME, city: 99, turn: 1 }, "6,6": { by: ME, city: 99, turn: 1 } }, locked: { "5,6": 5 }, monoTurn: 10 };

const healed = repairOrphans(state, region, cities, ME);

assert.equal(healed, 2, "both orphans processed");
// Orphans re-integrated into the nearest city.
assert.deepEqual(getTile(5, 6), { owner: ME, city: CITY_ID }, "orphan (5,6) re-integrated");
assert.deepEqual(getTile(6, 6), { owner: ME, city: CITY_ID }, "orphan (6,6) re-integrated");
// Claim records updated to the real city id.
assert.equal(state.claims["5,6"].city, CITY_ID, "claim re-pointed to real city");
assert.equal(state.locked["5,6"], 5, "kept lock (tile stayed ours)");
// The integrated city tile and the rival tile are untouched.
assert.deepEqual(getTile(5, 5), { owner: ME, city: CITY_ID }, "city center untouched");
assert.deepEqual(getTile(7, 7), { owner: 3, city: 9 }, "rival tile untouched");

// Idempotent: a second pass finds no orphans (everything is integrated now).
const healed2 = repairOrphans(state, region, cities, ME);
assert.equal(healed2, 0, "second pass heals nothing (idempotent)");

// Release path: an orphan whose re-buy fails is unclaimed and its claim dropped.
tiles.clear();
setTile(5, 6, ME, -1);
const noBuyCity = { purchasePlot: () => { /* fails to integrate: owner stays released */ } };
const state2 = { claims: { "5,6": { by: ME, city: 99, turn: 1 } }, locked: { "5,6": 5 }, monoTurn: 10 };
const healed3 = repairOrphans(state2, new Set(["5,6"]), [{ city: noBuyCity, id: CITY_ID, loc: { x: 5, y: 5 } }], ME);
assert.equal(healed3, 1, "orphan processed");
assert.equal(getTile(5, 6).owner, -1, "orphan released back to the map (unowned)");
assert.equal(state2.claims["5,6"], undefined, "dropped claim on release");
assert.equal(state2.locked["5,6"], undefined, "dropped lock on release");

// Disabled: repairOrphans is a no-op when the flag is off.
CONFIG.repairOrphans = false;
tiles.clear();
setTile(5, 6, ME, -1);
assert.equal(repairOrphans({ claims: {}, locked: {}, monoTurn: 1 }, new Set(["5,6"]), cities, ME), 0, "no-op when disabled");
assert.equal(getTile(5, 6).city, -1, "orphan untouched when disabled");
CONFIG.repairOrphans = true;

console.log("repair.mjs OK");
