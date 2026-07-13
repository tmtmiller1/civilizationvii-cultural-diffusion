// tests/buffer.mjs - the event-driven "+1 ring" cultural buffer (claimBufferAt).
//
// When the local player completes a rural improvement on a tile, the mod must claim only the
// UNOWNED land tiles ADJACENT to that tile (not the whole ring), attach them to the nearest city,
// and NEVER take a tile owned by another player, water, or a tile past the +1 ring cap.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

// --- controllable engine stub over an (x,y) -> {owner, city} tile map ------------
const tiles = new Map();
const water = new Set();
let savedState = null;
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const getTile = (x, y) => tiles.get(tk(x, y)) || { owner: -1, city: -1 };
function getTileMut(x, y) { if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1 }); return tiles.get(tk(x, y)); }

const ME = 0, CITY_ID = 42, CENTER = { x: 10, y: 10 };

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameContext = { localPlayerID: ME };
globalThis.Configuration = {
  getGame: () => ({ isAnyMultiplayer: false, getValue: () => (savedState ? JSON.stringify({ v: 3, data: savedState }) : null) }),
  editGame: () => ({ setValue: (_k, v) => { savedState = JSON.parse(v).data; } })
};
globalThis.GameplayMap = {
  getOwner: (x, y) => getTile(x, y).owner,
  getOwningCityFromXY: (x, y) => ({ id: getTile(x, y).city }),
  isWater: (x, y) => water.has(tk(x, y)),
  getGridWidth: () => 200, getGridHeight: () => 200,
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  },
  getLocationFromIndex: (i) => dec(i)
};
const distant = new Set();  // "x,y" of tiles that are Distant Lands for ME
globalThis.Players = {
  getAlive: () => [{ id: ME, isAlive: true, isMajor: true, Cities: { getCities: () => [cityObj] } }],
  get: () => ({
    Treasury: { goldBalance: 1000, changeGoldBalance: () => {} },
    isDistantLands: (loc) => distant.has(tk(loc.x, loc.y))
  })
};
globalThis.Game = { age: "AGE_ANTIQUITY" };
const cityObj = { id: CITY_ID, location: CENTER, purchasePlot: (loc) => { const t = getTileMut(loc.x, loc.y); t.owner = ME; t.city = CITY_ID; } };

const { __test } = await import("/cultural-diffusion/ui/cd-pass.js");
const { claimBufferAt } = __test;
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
CONFIG.growthBuffer = true;
CONFIG.baseGrowthRadius = 3;
CONFIG.flipVerb = "purchasePlot";
CONFIG.flipCooldownTurns = 15;
CONFIG.minimumOwner = 300;

/** Own the base-game footprint (rings 0..3) for the city. */
function seedFootprint() {
  tiles.clear(); water.clear(); savedState = null;
  for (let y = 4; y <= 16; y++) for (let x = 4; x <= 16; x++) {
    if (hexDistance(CENTER, { x, y }) <= 3) { const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID; }
  }
}

// --- 1. develop a ring-3 tile -> claim its UNOWNED neighbours only ---------------
seedFootprint();
const DEV = { x: 13, y: 10 };                 // a ring-3 (base-game frontier) tile we just improved
assert.equal(hexDistance(CENTER, DEV), 3);
// Its neighbours split between ring-2/3 (owned) and ring-4 (unowned) - only the unowned get claimed.
const neighbours = [];
for (let y = DEV.y - 1; y <= DEV.y + 1; y++) for (let x = DEV.x - 1; x <= DEV.x + 1; x++) {
  if ((x === DEV.x && y === DEV.y) || hexDistance(DEV, { x, y }) !== 1) continue;
  neighbours.push({ x, y });
}
const unownedNbrs = neighbours.filter((n) => getTile(n.x, n.y).owner < 0);
assert.ok(unownedNbrs.length > 0, "the dev tile has unowned (ring-4) neighbours");

const claimed = claimBufferAt(DEV);
assert.equal(claimed, unownedNbrs.length, "claimed exactly the unowned neighbours");
for (const n of unownedNbrs) {
  assert.deepEqual(getTile(n.x, n.y), { owner: ME, city: CITY_ID }, `neighbour ${n.x},${n.y} claimed + integrated`);
}
// It did NOT claim the whole ring 4 - a distant ring-4 tile not adjacent to DEV stays unowned.
const FARRING4 = { x: 6, y: 10 };
assert.equal(hexDistance(CENTER, FARRING4), 4);
assert.equal(getTile(FARRING4.x, FARRING4.y).owner, -1, "far ring-4 tile NOT claimed (not adjacent to the dev tile)");

// --- 2. never take a rival's tile; DO claim unowned water -----------------------
seedFootprint();
const RIVAL = { x: 14, y: 10 }, WET = { x: 13, y: 11 };
getTileMut(RIVAL.x, RIVAL.y).owner = 3; getTileMut(RIVAL.x, RIVAL.y).city = 9;  // rival-owned neighbour of DEV
assert.equal(getTile(WET.x, WET.y).owner, -1); assert.equal(hexDistance(DEV, WET), 1);
water.add(tk(WET.x, WET.y));                                                     // an UNOWNED water neighbour of DEV
claimBufferAt(DEV);
assert.deepEqual(getTile(RIVAL.x, RIVAL.y), { owner: 3, city: 9 }, "rival neighbour NOT taken");
assert.deepEqual(getTile(WET.x, WET.y), { owner: ME, city: CITY_ID }, "unowned water neighbour IS claimed");

// --- 3. developing an INNER tile claims nothing (all neighbours already owned) ---
seedFootprint();
assert.equal(claimBufferAt({ x: 10, y: 10 }), 0, "developing the city centre claims nothing");
assert.equal(claimBufferAt({ x: 11, y: 10 }), 0, "developing a ring-1 tile claims nothing");

// --- 4. only OUR development triggers it ----------------------------------------
seedFootprint();
getTileMut(DEV.x, DEV.y).owner = 3;           // pretend the dev tile is a rival's
assert.equal(claimBufferAt(DEV), 0, "a rival's rural growth does not trigger our buffer");

// --- 5. disabled flag is respected ----------------------------------------------
seedFootprint();
CONFIG.growthBuffer = false;
assert.equal(claimBufferAt(DEV), 0, "no-op when disabled");
CONFIG.growthBuffer = true;

// --- 6. Distant Lands are off-limits before the Exploration age ------------------
CONFIG.blockDistantLandsBeforeExploration = true;
seedFootprint();
distant.clear();
// Mark the dev tile's unowned neighbours as Distant Lands for us.
for (const n of neighbours) if (getTile(n.x, n.y).owner < 0) distant.add(tk(n.x, n.y));
globalThis.Game = { age: "AGE_ANTIQUITY" };
assert.equal(claimBufferAt(DEV), 0, "no distant-lands claims during Antiquity");
// From the Exploration age, the same distant-lands neighbours can be claimed.
globalThis.Game = { age: "AGE_EXPLORATION" };
assert.ok(claimBufferAt(DEV) > 0, "distant-lands claims allowed from Exploration");
globalThis.Game = { age: "AGE_ANTIQUITY" };
distant.clear();

console.log("buffer.mjs OK");
