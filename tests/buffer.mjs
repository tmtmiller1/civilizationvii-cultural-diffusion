// tests/buffer.mjs: the event-driven "+1 ring" cultural buffer (claimBufferAt).
//
// When the local player completes a rural improvement on a tile, the mod must claim only the
// unowned tiles adjacent to that tile (not the whole ring), water included, attach them to the nearest
// city, and never take a tile owned by another player or a tile past the +1 ring cap.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

// controllable engine stub over an (x,y) -> {owner, city} tile map
const tiles = new Map();
const water = new Set();
let savedState = null;
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const getTile = (x, y) => tiles.get(tk(x, y)) || { owner: -1, city: -1 };
function getTileMut(x, y) { if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1 }); return tiles.get(tk(x, y)); }

const ME = 0, CITY_ID = 42, CENTER = { x: 10, y: 10 };
let purchaseThrows = false; // purchasePlot fails outright, so the verb reports it wasn't applied
let deferWrites = false;   // purchasePlot lands after the call, as in the real engine
const writeQueue = [];

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
const cityObj = {
  id: CITY_ID, location: CENTER,
  purchasePlot: (loc) => {
    if (purchaseThrows) throw new Error("purchasePlot refused");
    const apply = () => { const t = getTileMut(loc.x, loc.y); t.owner = ME; t.city = CITY_ID; };
    if (deferWrites) writeQueue.push(apply); else apply();
  }
};

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
  purchaseThrows = false; deferWrites = false; writeQueue.length = 0;
  for (let y = 4; y <= 16; y++) for (let x = 4; x <= 16; x++) {
    if (hexDistance(CENTER, { x, y }) <= 3) { const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID; }
  }
}

// 1. develop a ring-3 tile -> claim its unowned neighbors only
seedFootprint();
const DEV = { x: 13, y: 10 };                 // a ring-3 (base-game frontier) tile we just improved
assert.equal(hexDistance(CENTER, DEV), 3);
// Its neighbors split between ring-2/3 (owned) and ring-4 (unowned), only the unowned get claimed.
const neighbours = [];
for (let y = DEV.y - 1; y <= DEV.y + 1; y++) for (let x = DEV.x - 1; x <= DEV.x + 1; x++) {
  if ((x === DEV.x && y === DEV.y) || hexDistance(DEV, { x, y }) !== 1) continue;
  neighbours.push({ x, y });
}
const unownedNbrs = neighbours.filter((n) => getTile(n.x, n.y).owner < 0);
assert.ok(unownedNbrs.length > 0, "the dev tile has unowned (ring-4) neighbors");

const claimed = claimBufferAt(DEV);
assert.equal(claimed, unownedNbrs.length, "claimed exactly the unowned neighbors");
for (const n of unownedNbrs) {
  assert.deepEqual(getTile(n.x, n.y), { owner: ME, city: CITY_ID }, `neighbor ${n.x},${n.y} claimed + integrated`);
}
// It did not claim the whole ring 4, a distant ring-4 tile not adjacent to DEV stays unowned.
const FARRING4 = { x: 6, y: 10 };
assert.equal(hexDistance(CENTER, FARRING4), 4);
assert.equal(getTile(FARRING4.x, FARRING4.y).owner, -1, "far ring-4 tile NOT claimed (not adjacent to the dev tile)");

// 2. never take a rival's tile; do claim unowned water
seedFootprint();
const RIVAL = { x: 14, y: 10 }, WET = { x: 13, y: 11 };
getTileMut(RIVAL.x, RIVAL.y).owner = 3; getTileMut(RIVAL.x, RIVAL.y).city = 9;  // rival-owned neighbor of DEV
assert.equal(getTile(WET.x, WET.y).owner, -1); assert.equal(hexDistance(DEV, WET), 1);
water.add(tk(WET.x, WET.y));                                                     // an UNOWNED water neighbor of DEV
claimBufferAt(DEV);
assert.deepEqual(getTile(RIVAL.x, RIVAL.y), { owner: 3, city: 9 }, "rival neighbor NOT taken");
assert.deepEqual(getTile(WET.x, WET.y), { owner: ME, city: CITY_ID }, "unowned water neighbor IS claimed");

// 3. developing an inner tile claims nothing (all neighbors already owned)
seedFootprint();
assert.equal(claimBufferAt({ x: 10, y: 10 }), 0, "developing the city center claims nothing");
assert.equal(claimBufferAt({ x: 11, y: 10 }), 0, "developing a ring-1 tile claims nothing");

// 3b. Where the game's own border growth and the buffer split. Placing a population takes every unowned tile next
// to it out to three tiles from the center (the Civilopedia's Growth page; watch run 2 block 1, V7/V8 with no mods).
// The buffer leaves those to the game, even while they're still unowned, and only takes what lies past them.
function seedRings(maxRing) {
  seedFootprint();
  for (const [k, t] of tiles) {
    const [x, y] = k.split(",").map(Number);
    if (hexDistance(CENTER, { x, y }) > maxRing) { t.owner = -1; t.city = -1; }
  }
}
seedRings(1);
const RING2 = { x: 12, y: 10 };
assert.equal(hexDistance(CENTER, RING2), 2);
const ring2Open = [];
for (let y = RING2.y - 1; y <= RING2.y + 1; y++) for (let x = RING2.x - 1; x <= RING2.x + 1; x++) {
  if (hexDistance(RING2, { x, y }) === 1 && getTile(x, y).owner < 0) ring2Open.push({ x, y });
}
assert.ok(ring2Open.length > 0, "the ring-2 tile has unowned neighbors");
getTileMut(RING2.x, RING2.y).owner = ME; getTileMut(RING2.x, RING2.y).city = CITY_ID;
assert.equal(claimBufferAt(RING2), 0, "a ring-2 improvement leaves its unowned neighbors to the game");
for (const n of ring2Open) assert.equal(getTile(n.x, n.y).owner, -1, `${n.x},${n.y} left for the game`);

seedRings(2);
getTileMut(DEV.x, DEV.y).owner = ME; getTileMut(DEV.x, DEV.y).city = CITY_ID;
const pastReach = neighbours.filter((n) => hexDistance(CENTER, n) === 4);
const insideReach = neighbours.filter((n) => hexDistance(CENTER, n) === 3 && getTile(n.x, n.y).owner < 0);
assert.ok(pastReach.length > 0 && insideReach.length > 0, "the ring-3 tile has open neighbors on both sides of 3");
assert.equal(claimBufferAt(DEV), pastReach.length, "a ring-3 improvement takes only the neighbors past three tiles");
for (const n of pastReach) assert.equal(getTile(n.x, n.y).owner, ME, `${n.x},${n.y} (ring 4) claimed`);
for (const n of insideReach) assert.equal(getTile(n.x, n.y).owner, -1, `${n.x},${n.y} (ring 3) left for the game`);

// 4. only our development triggers it
seedFootprint();
getTileMut(DEV.x, DEV.y).owner = 3;           // pretend the dev tile is a rival's
assert.equal(claimBufferAt(DEV), 0, "a rival's rural growth does not trigger our buffer");

// 5. disabled flag is respected
seedFootprint();
CONFIG.growthBuffer = false;
assert.equal(claimBufferAt(DEV), 0, "no-op when disabled");
CONFIG.growthBuffer = true;

// 6. Distant Lands are off-limits before the Exploration age
CONFIG.blockDistantLandsBeforeExploration = true;
seedFootprint();
distant.clear();
// Mark the dev tile's unowned neighbors as Distant Lands for us.
for (const n of neighbours) if (getTile(n.x, n.y).owner < 0) distant.add(tk(n.x, n.y));
globalThis.Game = { age: "AGE_ANTIQUITY" };
assert.equal(claimBufferAt(DEV), 0, "no distant-lands claims during Antiquity");
// From the Exploration age, the same distant-lands neighbors can be claimed.
globalThis.Game = { age: "AGE_EXPLORATION" };
assert.ok(claimBufferAt(DEV) > 0, "distant-lands claims allowed from Exploration");
globalThis.Game = { age: "AGE_ANTIQUITY" };
distant.clear();

// 7. A claim that landed is saved: the claim record, the cooldown lock and the owner's seed stock.
seedFootprint();
const n7 = claimBufferAt(DEV);
assert.ok(n7 > 0 && savedState, "claimed, and the state was saved");
for (const n of unownedNbrs) {
  const k = tk(n.x, n.y);
  assert.deepEqual(savedState.claims[k], { by: ME, city: CITY_ID, turn: savedState.monoTurn }, `claim ${k} recorded`);
  assert.equal(savedState.locked[k], CONFIG.flipCooldownTurns, `claim ${k} locked for the cooldown`);
  assert.equal(savedState.field[k][String(ME)], CONFIG.minimumOwner, `claim ${k} seeded at the ownership bar`);
}
assert.equal(Object.keys(savedState.pending || {}).length, 0, "nothing left pending when the buys landed at once");

// 8. A buy the engine refuses records nothing: no claim, no lock, no seed, no pending entry, no save.
seedFootprint();
purchaseThrows = true;
assert.equal(claimBufferAt(DEV), 0, "a refused buy is not a claim");
assert.equal(savedState, null, "and nothing is saved");
for (const n of unownedNbrs) assert.equal(getTile(n.x, n.y).owner, -1, `neighbor ${n.x},${n.y} still unowned`);

// 9. A buy that lands after the call is held as pending, not booked, until the next pass reads the map. (A buy that
// never lands looks the same in this tick; the next pass drops it, cd-pending.js.)
seedFootprint();
deferWrites = true;
const n9 = claimBufferAt(DEV);
assert.equal(n9, unownedNbrs.length, "every buy was sent");
for (const n of unownedNbrs) {
  const k = tk(n.x, n.y);
  assert.equal(savedState.claims[k], undefined, `claim ${k} not booked before it lands`);
  assert.equal(savedState.locked[k], undefined, `claim ${k} not locked before it lands`);
  assert.deepEqual(savedState.pending[k] && { kind: savedState.pending[k].kind, by: savedState.pending[k].by },
    { kind: "claim", by: ME }, `claim ${k} pending`);
}
// The same development again, before the next pass: the pending tiles are not bought twice.
assert.equal(claimBufferAt(DEV), 0, "a tile still landing is not sent again");
deferWrites = false; writeQueue.length = 0;

// 10. The master switch stops the buffer as well as the pass.
seedFootprint();
CONFIG.diffusionEnabled = false;
assert.equal(claimBufferAt(DEV), 0, "no buffer claim while the mod is switched off");
for (const n of unownedNbrs) assert.equal(getTile(n.x, n.y).owner, -1, `neighbor ${n.x},${n.y} untouched`);
CONFIG.diffusionEnabled = true;

console.log("buffer.mjs OK");
