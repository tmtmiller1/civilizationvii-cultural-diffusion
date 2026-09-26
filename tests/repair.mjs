// tests/repair.mjs - orphan-tile healing + inner-ring reconciliation.
//
// An orphan is a tile owner === me with NO owning city (owningCity < 0), produced by the legacy
// setOwnership verb. repairOrphans handles orphans by POSITION:
//   - Inside our own base-game natural ring (<= baseGrowthRadius of a local city): RELEASE it back
//     to the map so the base game re-acquires it and assigns it to the city that can WORK it. (Re-
//     buying an inner orphan would attach it to the geometrically nearest city - often the wrong
//     one - the "can't work some inner tiles" regression.)
//   - Beyond the natural ring (the frontier buffer): re-integrate into its nearest city via the
//     integrated verb; if the re-buy can't take, release it. Integrated tiles are left untouched.
// releaseInnerClaims separately reconciles tiles the mod ALREADY force-bought inside the natural
// ring (owner=me, real owning city, but the WRONG one): it releases them so the base game re-owns
// and re-assigns them correctly.
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
const { repairOrphans, releaseInnerClaims } = __test;
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
CONFIG.repairOrphans = true;
CONFIG.baseGrowthRadius = 3; // rings <= 3 of a local city are the base game's to own/work

const ME = 0;
const CITY_ID = 42;
// A city whose purchasePlot integrates a tile: owner=ME, owningCity=CITY_ID.
const city = { purchasePlot: (loc) => { const t = getTileMut(loc.x, loc.y); t.owner = ME; t.city = CITY_ID; } };
const cities = [{ city, id: CITY_ID, loc: { x: 5, y: 5 } }];

// --- scenario 1: inner orphans RELEASED, frontier orphan RE-INTEGRATED -----------
tiles.clear();
setTile(5, 5, ME, CITY_ID);   // city center (integrated) - must be left alone
setTile(5, 6, ME, -1);        // INNER ORPHAN (d=1) - must be released back to the base game
setTile(6, 6, ME, -1);        // INNER ORPHAN (d=2) - must be released back to the base game
setTile(5, 11, ME, -1);       // FRONTIER ORPHAN (d=6, beyond ring 3) - must be re-integrated
setTile(7, 7, 3, 9);          // a rival's real tile - not ours, must be ignored
const region = new Set(["5,5", "5,6", "6,6", "5,11", "7,7"]);
const state = {
  claims: { "5,6": { by: ME, city: 99, turn: 1 }, "6,6": { by: ME, city: 99, turn: 1 }, "5,11": { by: ME, city: 99, turn: 1 } },
  locked: { "5,6": 5, "5,11": 5 }, monoTurn: 10
};

const healed = repairOrphans(state, region, cities, ME);

assert.equal(healed, 3, "all three orphans processed");
// Inner orphans handed BACK to the map (base game re-acquires + assigns to the workable city).
assert.equal(getTile(5, 6).owner, -1, "inner orphan (5,6) released to the base game");
assert.equal(getTile(6, 6).owner, -1, "inner orphan (6,6) released to the base game");
assert.equal(state.claims["5,6"], undefined, "inner orphan claim dropped");
// The lock is NOT part of the claim record: it stays (anti-flicker, and a conquest's hold). Changed 2026-09-26 after a
// conquered ring-3 tile lost its hold through this helper.
assert.equal(state.locked["5,6"], 5, "inner orphan lock kept");
// Frontier orphan re-integrated into the nearest city (owned border, beyond the base-game ring).
assert.deepEqual(getTile(5, 11), { owner: ME, city: CITY_ID }, "frontier orphan re-integrated");
assert.equal(state.claims["5,11"].city, CITY_ID, "frontier claim re-pointed to real city");
assert.equal(state.locked["5,11"], 5, "frontier orphan kept its lock (stayed ours)");
// The integrated city tile and the rival tile are untouched.
assert.deepEqual(getTile(5, 5), { owner: ME, city: CITY_ID }, "city center untouched");
assert.deepEqual(getTile(7, 7), { owner: 3, city: 9 }, "rival tile untouched");

// Idempotent: a second pass finds no orphans (inner released, frontier integrated).
const healed2 = repairOrphans(state, region, cities, ME);
assert.equal(healed2, 0, "second pass heals nothing (idempotent)");

// --- scenario 2: a frontier orphan whose re-buy FAILS is released ----------------
tiles.clear();
setTile(5, 11, ME, -1);       // frontier orphan (d=6)
const noBuyCity = { purchasePlot: () => { /* fails to integrate: owner stays released */ } };
const state2 = { claims: { "5,11": { by: ME, city: 99, turn: 1 } }, locked: { "5,11": 5 }, monoTurn: 10 };
const healed3 = repairOrphans(state2, new Set(["5,11"]), [{ city: noBuyCity, id: CITY_ID, loc: { x: 5, y: 5 } }], ME);
assert.equal(healed3, 1, "frontier orphan processed");
assert.equal(getTile(5, 11).owner, -1, "frontier orphan released back to the map (re-buy failed)");
assert.equal(state2.claims["5,11"], undefined, "dropped claim on release");
assert.equal(state2.locked["5,11"], 5, "the lock is kept on release (it is not part of the claim record)");

// --- scenario 3: releaseInnerClaims heals a mis-deeded inner tile ----------------
// The 1.0.6 regression: an inner tile the mod force-bought to the WRONG city (real owning city,
// but not the one whose ring it sits in). It is NOT an orphan (owningCity >= 0), so repairOrphans
// skips it; releaseInnerClaims must hand it back so the base game re-assigns it correctly.
tiles.clear();
setTile(5, 6, ME, 77);        // inner tile (d=1) attached to some city 77 (the "wrong" city)
setTile(5, 11, ME, CITY_ID);  // a frontier tile the mod legitimately owns - must be left alone
const state3 = { claims: { "5,6": { by: ME, city: 77, turn: 1 }, "5,11": { by: ME, city: CITY_ID, turn: 1 } }, locked: { "5,6": 9, "5,11": 4 }, monoTurn: 20 };
const released = releaseInnerClaims(state3, cities, ME);
assert.equal(released, 1, "one inner claim released");
assert.equal(getTile(5, 6).owner, -1, "mis-deeded inner tile handed back to the base game");
assert.equal(state3.claims["5,6"], undefined, "inner claim record dropped");
assert.equal(state3.locked["5,6"], 9, "inner lock kept (not part of the claim record)");
// The frontier claim is untouched.
assert.deepEqual(getTile(5, 11), { owner: ME, city: CITY_ID }, "frontier claim untouched");
assert.ok(state3.claims["5,11"], "frontier claim record kept");
// Idempotent: the claim is gone, so a second pass releases nothing.
assert.equal(releaseInnerClaims(state3, cities, ME), 0, "second pass releases nothing (idempotent)");

// --- scenario 4: disabled flag is respected -------------------------------------
CONFIG.repairOrphans = false;
tiles.clear();
setTile(5, 6, ME, -1);
assert.equal(repairOrphans({ claims: {}, locked: {}, monoTurn: 1 }, new Set(["5,6"]), cities, ME), 0, "no-op when disabled");
assert.equal(getTile(5, 6).owner, ME, "orphan untouched when disabled");
CONFIG.repairOrphans = true;

console.log("repair.mjs OK");
