// tests/outer-ai.mjs: the AI's citizen moved to a claimed outer tile when that's clearly the better tile.
//
// Pins the decision (more total yield by MIN_GAIN, the AI's resource pick kept, no tile beside a war enemy, still
// beside development once the old tile is bare), the watched move (teardown first, then the outer district and
// improvement for the same city: population 3 -> 2 -> 3, runs 7 and 8 on 2026-11-12), and which growths are noted.
import assert from "node:assert/strict";

const AI = 1;
const CITY = { owner: AI, id: 5 };
const idx = (x, y) => (y + 50) * 1000 + (x + 50);
const world = new Map();
const put = (x, y, p) => world.set(`${x},${y}`, { owner: AI, city: CITY, district: false, cons: [], imp: "IMPROVEMENT_FARM", worth: 2, res: -1, ...p });
const at = (x, y) => world.get(`${x},${y}`);
function reset() {
  world.clear();
  put(0, 0, { district: true, worth: 0 });                               // the center
  put(3, 0, { district: true, cons: ["IMPROVEMENT_FARM"], worth: 2 });   // a developed ring-3 tile
  put(2, 1, { district: true, cons: ["IMPROVEMENT_FARM"], worth: 2 });   // N: the AI's new pick (ring 2)
  put(4, 0, { worth: 4 });                                               // A: ring 4 beside the ring-3 tile, worth 4
  put(4, 2, { worth: 5 });                                               // B: ring 4, worth 5, beside only N
  put(3, 2, { worth: 1 });                                               // ring 3 bare (between)
}
reset();

const DEFS = { IMPROVEMENT_FARM: { ConstructibleType: "IMPROVEMENT_FARM", ConstructibleClass: "IMPROVEMENT", $index: 4, $hash: 1004 } };
const byHash = (h) => Object.values(DEFS).find((d) => d.$hash === h || d.$index === h || d.ConstructibleType === h) || null;
const counts = { population: 3, ruralPopulation: 2, pendingPopulation: 0 };
let ignoreDestroy = false;
let dropDistrictAt = null;
const lag = 2;
let war = false;

const city = {
  id: CITY, owner: AI, location: { x: 0, y: 0 },
  get population() { return counts.population; },
  get ruralPopulation() { return counts.ruralPopulation; },
  get pendingPopulation() { return counts.pendingPopulation; },
  getPurchasedPlots: () => [...world.entries()].filter(([, p]) => p.city === CITY).map(([k]) => { const [x, y] = k.split(",").map(Number); return idx(x, y); })
};
const pl = { isHuman: false, isMajor: true, isTurnActive: true, Diplomacy: { isAtWarWith: (o) => war && o === 2 } };

globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: false }) };
globalThis.GameContext = { localPlayerID: 0 };
globalThis.DistrictTypes = { CITY_CENTER: 1, URBAN: 2, RURAL: 3 };
const me = { isHuman: true, isMajor: true, isTurnActive: false };
globalThis.Players = { get: (p) => (p === AI ? pl : me) };
globalThis.Cities = { get: (cid) => (cid && cid.id === CITY.id ? city : null) };
globalThis.GameplayMap = {
  getPlotDistance: (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)),
  getLocationFromIndex: (i) => ({ x: (i % 1000) - 50, y: Math.floor(i / 1000) - 50 }),
  getIndexFromLocation: (l) => idx(l.x, l.y),
  getPlotIndicesInRadius: (x, y, r) => [...world.keys()].map((k) => k.split(",").map(Number))
    .filter(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) <= r).map(([a, b]) => idx(a, b)),
  getOwner: (x, y) => (at(x, y) ? at(x, y).owner : -1),
  getOwningCityFromXY: (x, y) => (at(x, y)?.city ? { ...at(x, y).city } : { owner: -1, id: -1 }),
  getResourceType: (x, y) => (at(x, y) ? at(x, y).res : -1),
  getYieldsWithCity: (i) => { const l = globalThis.GameplayMap.getLocationFromIndex(i); const p = at(l.x, l.y); return p ? [[700, p.worth]] : null; },
  isNaturalWonder: () => false
};
globalThis.MapCities = { getDistrict: (x, y) => (at(x, y)?.district ? { owner: AI, id: idx(x, y) } : null) };
globalThis.Districts = {
  get: (id) => (id ? { type: 3, id } : null),
  getFreeConstructible: (l) => { const p = at(l.x, l.y); return p && p.imp ? DEFS[p.imp].$hash : -1; }
};
globalThis.MapConstructibles = { getConstructibles: (x, y) => (at(x, y)?.cons || []).map((t, i) => ({ owner: AI, id: idx(x, y) * 10 + i, t })) };
globalThis.Constructibles = { getByComponentID: (id) => ({ type: id.t }) };
globalThis.GameInfo = { Constructibles: { lookup: byHash }, Yields: [{ $hash: 700 }] };
const ops = [];
globalThis.Game = {
  PlayerOperations: {
    sendRequest: (sender, op, args) => {
      ops.push(op + ":" + args.Kind);
      if (op === "DESTROY_ELEMENT") {
        if (ignoreDestroy) return;
        const x = args.Kind === "DISTRICT" ? (args.LocalID % 1000) - 50 : (Math.floor(args.LocalID / 10) % 1000) - 50;
        const y = args.Kind === "DISTRICT" ? Math.floor(args.LocalID / 1000) - 50 : Math.floor(Math.floor(args.LocalID / 10) / 1000) - 50;
        const p = at(x, y);
        setTimeout(() => {
          if (args.Kind === "DISTRICT") { p.district = false; counts.population--; counts.ruralPopulation--; } else p.cons = [];
        }, lag);
        return;
      }
      const p = at(args.Location.x, args.Location.y);
      if (args.Kind === "DISTRICT") {
        if (dropDistrictAt === `${args.Location.x},${args.Location.y}`) return;
        setTimeout(() => { p.district = true; counts.population++; counts.ruralPopulation++; }, lag);
      }
      if (args.Kind === "CONSTRUCTIBLE") setTimeout(() => { if (p.district) p.cons.push("IMPROVEMENT_FARM"); }, lag);
    }
  }
};
globalThis.engine = { on: () => ({ clear() {} }) };

await import("/cultural-diffusion/ui/cd-config.js");
const A = await import("/cultural-diffusion/ui/cd-outer-ai.js");
const L = (x, y) => ({ x, y });
const fast = { pollMs: 3, waitMs: 200 };

// 1. The decision.
assert.equal(A.tileWorth(L(4, 0), CITY), 4);
let pick = A.betterOuterTile(city, L(2, 1));
assert.deepEqual(pick && pick.loc, L(4, 0), "A is worth 4 against the AI's 2; B is beside only the tile being cleared");
assert.equal(pick.gain, 2);
at(4, 0).worth = 2;
assert.equal(A.betterOuterTile(city, L(2, 1)), null, "a tie keeps the AI's pick");
at(4, 0).worth = 3;
assert.deepEqual(A.betterOuterTile(city, L(2, 1)).loc, L(4, 0), "one more is enough (MIN_GAIN 1)");
at(2, 1).res = 7;
assert.equal(A.betterOuterTile(city, L(2, 1)), null, "the AI's resource pick stays");
at(2, 1).res = -1;
put(5, 0, { owner: 2, city: { owner: 2, id: 1 } });
war = true;
assert.equal(A.betterOuterTile(city, L(2, 1)), null, "not beside a war enemy");
war = false;
assert.deepEqual(A.betterOuterTile(city, L(2, 1)).loc, L(4, 0), "at peace the neighbour doesn't matter");
world.delete("5,0");

// 2. Which growths are noted: an AI major's, during its own turn.
assert.equal(A.noteAiGrowth({ cityID: CITY, location: L(2, 1) }), true);
me.isTurnActive = true;
assert.equal(A.noteAiGrowth({ cityID: CITY, location: L(2, 1) }), false, "not during the local player's turn");
me.isTurnActive = false;
pl.isTurnActive = false;
assert.equal(A.noteAiGrowth({ cityID: CITY, location: L(2, 1) }), true, "even before the AI's turn reads as active");
pl.isTurnActive = true;
assert.equal(A.noteAiGrowth({ cityID: { owner: 0, id: 1 }, location: L(9, 9) }), false, "not a human's growth");

// 3. The review moves the noted citizen: teardown, then the outer tile, population back where it was.
let moves = await A.reviewAiGrowth(fast);
assert.equal(moves.length, 1);
assert.equal(moves[0].reason, "moved");
assert.deepEqual(moves[0].to, L(4, 0));
assert.equal(moves[0].after.pop, 3);
assert.equal(at(2, 1).district, false, "the AI's pick is bare");
assert.equal(at(2, 1).owner, AI, "and still the AI's land");
assert.equal(at(4, 0).district, true);
assert.deepEqual(at(4, 0).cons, ["IMPROVEMENT_FARM"]);
assert.deepEqual(await A.reviewAiGrowth(fast), [], "a growth is handled once");

// 4. A teardown the game ignores changes nothing else.
reset(); at(4, 0).worth = 4; counts.population = 3; counts.ruralPopulation = 2;
ignoreDestroy = true;
let r = await A.moveCitizen(CITY, AI, L(2, 1), L(4, 0), fast);
assert.equal(r.reason, "teardown-ignored");
assert.equal(at(4, 0).district, false, "no new district when the old one stayed");
ignoreDestroy = false;

// 5. An outer district that never lands: the old tile is rebuilt and the AI keeps its citizen.
reset(); counts.population = 3; counts.ruralPopulation = 2;
dropDistrictAt = "4,0";
r = await A.moveCitizen(CITY, AI, L(2, 1), L(4, 0), fast);
assert.equal(r.reason, "district-missing-restored");
assert.equal(at(2, 1).district, true);
assert.deepEqual(at(2, 1).cons, ["IMPROVEMENT_FARM"]);
assert.equal(counts.population, 3);
dropDistrictAt = null;

// 6. Off in a network game.
globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: true }) };
assert.equal(A.noteAiGrowth({ cityID: CITY, location: L(2, 1) }), false);
globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: false }) };

console.log("outer-ai: all assertions passed");
