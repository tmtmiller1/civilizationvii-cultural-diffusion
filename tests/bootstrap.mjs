// tests/bootstrap.mjs: cd-bootstrap's engine wiring, off-engine.
//
// The pass and the buffer have their own suites (pass.mjs, buffer.mjs). This one covers what only the bootstrap can
// get wrong: which engine events it hears, how it reads their payloads, and when it runs a pass or a buffer claim. A
// payload it misreads doesn't throw anywhere; the mod just stays loaded and does nothing, so each read is pinned here.
//
// A pass is observed through the state it saves (every full pass ends with a save), and a buffer claim through the
// tiles it buys.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

const tiles = new Map();
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const getTile = (x, y) => tiles.get(tk(x, y)) || { owner: -1, city: -1 };
function getTileMut(x, y) {
  if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1 });
  return tiles.get(tk(x, y));
}

const ME = 0, RIVAL = 3, CITY_ID = 42, CENTER = { x: 10, y: 10 };
let savedState = null;
let saves = 0;
let turnActive = false;

/** @type {Record<string, Function>} */
const handlers = {};
const unsubscribed = [];
globalThis.engine = {
  on: (name, fn) => { handlers[name] = fn; },
  off: (name, fn) => { if (handlers[name] === fn) { delete handlers[name]; unsubscribed.push(name); } },
  trigger: () => {}
};
globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameContext = { localPlayerID: ME };
globalThis.YieldTypes = { YIELD_CULTURE: 1, YIELD_HAPPINESS: 2, YIELD_FOOD: 3, YIELD_PRODUCTION: 4, YIELD_GOLD: 5 };
globalThis.Configuration = {
  getGame: () => ({ isAnyMultiplayer: false, getValue: () => (savedState ? JSON.stringify({ v: 2, data: savedState }) : null) }),
  editGame: () => ({ setValue: (_k, v) => { saves++; savedState = JSON.parse(v).data; } })
};
globalThis.GameplayMap = {
  getOwner: (x, y) => getTile(x, y).owner,
  getOwningCityFromXY: (x, y) => ({ id: getTile(x, y).city }),
  isWater: () => false,
  isImpassable: () => false,
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
const myCity = {
  id: CITY_ID, location: CENTER, owner: ME,
  Yields: { getNetYield: (e) => (e === YieldTypes.YIELD_CULTURE ? 40 : 2) },
  Happiness: { netHappinessPerTurn: 4, isInGoldenAge: () => false },
  Constructibles: { getNumWonders: () => 0 },
  purchasePlot: (loc) => { const t = getTileMut(loc.x, loc.y); t.owner = ME; t.city = CITY_ID; }
};
globalThis.Players = {
  getAlive: () => [{ id: ME, isAlive: true, isMajor: true, Cities: { getCities: () => [myCity] } }],
  get: (pid) => ({
    id: pid, isMajor: true, isAlive: true,
    get isTurnActive() { return pid === ME && turnActive; },
    Treasury: { goldBalance: 1000, changeGoldBalance: () => {} },
    Happiness: { isInGoldenAge: () => false },
    Diplomacy: { isAtWarWith: () => false },
    isDistantLands: () => false
  })
};
globalThis.Cities = { getAtLocation: () => null, get: () => null };
globalThis.MapUnits = { getUnits: () => [] };
globalThis.Units = { get: () => null };
const FARM = 501, BUILDING = 502;
globalThis.GameInfo = {
  Constructibles: {
    lookup: (t) => (t === FARM ? { ConstructibleType: "IMPROVEMENT_FARM", ConstructibleClass: "IMPROVEMENT" }
      : t === BUILDING ? { ConstructibleType: "BUILDING_LIBRARY", ConstructibleClass: "BUILDING" } : null)
  }
};
globalThis.Game = { age: "AGE_ANTIQUITY", turn: 10, maxTurns: 90 };
// The game has started, so the stray-marker sweep cd-bootstrap starts at boot finds nothing and ends.
globalThis.UI = { getGameLoadingState: () => 8 };
globalThis.UIGameLoadingState = { GameStarted: 8 };
// Options the bootstrap reads before every pass and every buffer claim (cd-settings.js).
const modSettings = { "cultural-diffusion": {} };
globalThis.localStorage = {
  getItem: (k) => (k === "modSettings" ? JSON.stringify(modSettings) : null),
  setItem: () => {}, removeItem: () => {}, clear: () => {}
};
const setSetting = (k, on) => { modSettings["cultural-diffusion"][k] = on ? 1 : 0; };

function reset() {
  tiles.clear(); savedState = null; saves = 0; turnActive = false;
  modSettings["cultural-diffusion"] = { fusedModel: 0 };
  for (let y = 4; y <= 16; y++) for (let x = 4; x <= 16; x++) {
    if (hexDistance(CENTER, { x, y }) <= 3) { const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID; }
  }
}
reset();

await import("/cultural-diffusion/ui/cd-bootstrap.js");

// 1. Boot hears the three events it needs.
for (const name of ["PlayerTurnActivated", "ConstructibleAddedToMap", "CityTransfered"]) {
  assert.equal(typeof handlers[name], "function", `boot subscribes to ${name}`);
}
assert.equal(typeof globalThis.culturalDiffusion?.runNow, "function", "boot installs the console surface");

// 2. One pass per local turn, read the way the base game reads the payload.
const turn = handlers.PlayerTurnActivated;
/** Fire PlayerTurnActivated on game turn `t` and report whether a pass ran. */
function passOn(t, data) {
  Game.turn = t;
  const before = saves;
  turn(data);
  return saves > before;
}
reset();
assert.equal(passOn(10, { player: ME }), true, "the local player's turn runs a pass");
assert.equal(passOn(10, { player: ME }), false, "a second event the same turn runs nothing");
assert.equal(passOn(11, { player: RIVAL }), false, "another player's turn runs nothing");
assert.equal(passOn(11, { player: String(ME) }), true, "a numeric string names the player (the base game reads it with ==)");
assert.equal(passOn(12, { Player: ME }), true, "the capitalised key still works");
assert.equal(passOn(13, { player: "3" }), false, "a numeric string for another player runs nothing");

// A payload with no readable player falls back on the engine's own turn flag.
turnActive = false;
assert.equal(passOn(14, {}), false, "no readable player, local turn not active: nothing");
assert.equal(passOn(14, undefined), false, "no payload, local turn not active: nothing");
turnActive = true;
assert.equal(passOn(14, {}), true, "no readable player, local turn active: a pass");
assert.equal(passOn(14, { player: { id: ME } }), false, "still one pass a turn through the fallback");
assert.equal(passOn(15, null), true, "a missing payload on an active local turn: a pass");
turnActive = false;

// turnInterval spaces the passes out.
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
CONFIG.turnInterval = 3;
assert.equal(passOn(16, { player: ME }), false, "turnInterval 3: one turn after a pass runs nothing");
assert.equal(passOn(18, { player: ME }), true, "turnInterval 3: three turns after a pass runs one");
CONFIG.turnInterval = 1;

// 3. A finished rural improvement of ours claims the free tiles beside it (the +1 buffer, when it's on).
const added = handlers.ConstructibleAddedToMap;
const DEV = { x: 13, y: 10 };   // ring 3: beside unowned ring-4 tiles
const RING4 = [];
for (let y = DEV.y - 1; y <= DEV.y + 1; y++) for (let x = DEV.x - 1; x <= DEV.x + 1; x++) {
  if (hexDistance(DEV, { x, y }) === 1 && hexDistance(CENTER, { x, y }) === 4) RING4.push({ x, y });
}
assert.ok(RING4.length > 0, "fixture: the dev tile touches ring 4");
const ring4Owned = () => RING4.filter((p) => getTile(p.x, p.y).owner === ME).length;
function bufferOn(payload) {
  reset();
  setSetting("growthBuffer", true);
  added({ location: DEV, constructibleType: FARM, ...payload });
  return ring4Owned();
}
assert.ok(bufferOn({ percentComplete: 100 }) > 0, "a finished farm (100) claims beside it");
assert.ok(bufferOn({}) > 0, "a payload with no percentComplete is a finished build");
assert.ok(bufferOn({ percentComplete: "100" }) > 0, "\"100\" counts as finished (the base game reads it with ==)");
assert.equal(bufferOn({ percentComplete: 50 }), 0, "a half-built improvement claims nothing");
assert.equal(bufferOn({ percentComplete: 1 }), 0, "1 is a build at 1%, not a finished one");
assert.equal(bufferOn({ percentComplete: 100, constructibleType: BUILDING }), 0, "a building isn't rural growth");

reset();
added({ location: DEV, constructibleType: FARM, percentComplete: 100 });
assert.equal(ring4Owned(), 0, "the buffer setting off: nothing");

reset();
setSetting("growthBuffer", true);
setSetting("diffusionEnabled", false);
added({ location: DEV, constructibleType: FARM, percentComplete: 100 });
assert.equal(ring4Owned(), 0, "the master switch off stops the buffer too");

reset();
setSetting("growthBuffer", true);
getTileMut(DEV.x, DEV.y).owner = RIVAL;
added({ location: DEV, constructibleType: FARM, percentComplete: 100 });
assert.equal(ring4Owned(), 0, "a rival's farm doesn't claim for us");

// 4. stop() drains every subscription, so a broken build can be switched off from the console.
globalThis.culturalDiffusion.stop();
assert.deepEqual(unsubscribed.sort(), ["CityTransfered", "ConstructibleAddedToMap", "PlayerTurnActivated"],
  "stop() unsubscribes from all three events");
assert.equal(Object.keys(handlers).length, 0, "no handler left behind");

console.log("bootstrap.mjs OK");
// The stray-marker sweep boot starts waits a few seconds on timers before it ends; nothing here needs it.
process.exit(0);
