// tests/outer-growth.mjs: growth onto a settlement's own tiles past ring 3.
//
// Pins the rule (owned by this city, past ring 3, bare, an improvement the game would place, beside land the city
// has developed) and the watched placement sequence (2026-11-12, docs/probe-history.md): the rural district and the
// improvement held by the city, then addRuralPopulation(-1), which spends the waiting citizen.
import assert from "node:assert/strict";

const CITY = { owner: 0, id: 5 };
const OTHER = { owner: 0, id: 9 };
const idx = (x, y) => (y + 50) * 1000 + (x + 50);
// The world: plot key -> { city, district, cons, imp }
const world = new Map();
const put = (x, y, p) => world.set(`${x},${y}`, { city: null, district: false, cons: [], imp: "IMPROVEMENT_FARM", ...p });
const at = (x, y) => world.get(`${x},${y}`);
function reset() {
  world.clear();
  put(0, 0, { city: CITY, district: true });              // the center
  put(3, 0, { city: CITY, district: true });              // a developed ring-3 tile
  put(4, 0, { city: CITY });                              // A: ring 4, beside it
  put(5, 0, { city: CITY });                              // C: ring 5, beside only A
  put(4, 1, { city: OTHER });                             // D: ring 4, another city's
  put(4, 3, { city: CITY, district: true, cons: ["IMPROVEMENT_FARM"] });  // E: ring 4, already developed
  put(2, 0, { city: CITY });                              // F: ring 2
  put(5, 3, { city: CITY, imp: null });                   // G: ring 5 beside E, nothing the game would build
  put(3, 1, { city: CITY, district: false });             // ring 3, bare
}
reset();

const DEFS = {
  IMPROVEMENT_FARM: { ConstructibleType: "IMPROVEMENT_FARM", ConstructibleClass: "IMPROVEMENT", $index: 4, $hash: 1004 },
  IMPROVEMENT_CAMP: { ConstructibleType: "IMPROVEMENT_CAMP", ConstructibleClass: "IMPROVEMENT", $index: 6, $hash: 1006 }
};
const byHash = (h) => Object.values(DEFS).find((d) => d.$hash === h || d.$index === h || d.ConstructibleType === h) || null;
const counts = { population: 2, ruralPopulation: 1, pendingPopulation: 1 };
const requests = [];
let lagMs = 2;

const city = {
  id: CITY, owner: 0, location: { x: 0, y: 0 },
  get population() { return counts.population; },
  get ruralPopulation() { return counts.ruralPopulation; },
  get pendingPopulation() { return counts.pendingPopulation; },
  getPurchasedPlots: () => [...world.entries()].filter(([, p]) => p.city === CITY).map(([k]) => { const [x, y] = k.split(",").map(Number); return idx(x, y); }),
  addRuralPopulation: (n) => {
    setTimeout(() => {
      if (n < 0 && counts.pendingPopulation > 0) { counts.population += n; counts.ruralPopulation += n; counts.pendingPopulation += n; }
    }, lagMs);
  }
};

globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: false }) };
globalThis.GameContext = { localPlayerID: 0 };
globalThis.DistrictTypes = { CITY_CENTER: 1, URBAN: 2, RURAL: 3 };
globalThis.Cities = { get: (cid) => (cid && cid.id === CITY.id ? city : null) };
globalThis.GameplayMap = {
  getPlotDistance: (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)),
  getLocationFromIndex: (i) => ({ x: (i % 1000) - 50, y: Math.floor(i / 1000) - 50 }),
  getIndexFromLocation: (l) => idx(l.x, l.y),
  getPlotIndicesInRadius: (x, y, r) => [...world.keys()].map((k) => k.split(",").map(Number))
    .filter(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) <= r).map(([a, b]) => idx(a, b)),
  getOwner: (x, y) => (at(x, y)?.city ? at(x, y).city.owner : -1),
  getOwningCityFromXY: (x, y) => (at(x, y)?.city ? { ...at(x, y).city } : { owner: -1, id: -1 }),
  isNaturalWonder: () => false
};
globalThis.MapCities = { getDistrict: (x, y) => (at(x, y)?.district ? { owner: at(x, y).city.owner, id: idx(x, y) } : null) };
globalThis.Districts = {
  get: (id) => (id ? { type: 3, id } : null),
  getFreeConstructible: (l, _owner) => { const p = at(l.x, l.y); return p && p.imp ? DEFS[p.imp].$hash : -1; }
};
globalThis.MapConstructibles = { getConstructibles: (x, y) => (at(x, y)?.cons || []).map((t, i) => ({ owner: 0, id: idx(x, y) * 10 + i, t })) };
globalThis.Constructibles = { getByComponentID: (id) => ({ type: id.t }) };
globalThis.GameInfo = { Constructibles: { lookup: byHash }, Yields: Object.assign([0, 1, 2, 3, 4, 5].map((i) => ({ $hash: 700 + i })), {}) };
globalThis.Game = {
  PlayerOperations: {
    sendRequest: (sender, op, args) => {
      requests.push({ sender, op, args });
      const p = at(args.Location.x, args.Location.y);
      if (op === "CREATE_ELEMENT" && args.Kind === "DISTRICT") {
        setTimeout(() => { p.district = true; counts.population++; counts.ruralPopulation++; }, lagMs);
      }
      if (op === "CREATE_ELEMENT" && args.Kind === "CONSTRUCTIBLE") {
        setTimeout(() => { p.cons.push(Object.values(DEFS).find((d) => d.$index === args.Type).ConstructibleType); }, lagMs);
      }
    }
  }
};

const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
const P = await import("/cultural-diffusion/ui/cd-outer-place.js");
const L = (x, y) => ({ x, y });

// 1. The rule, tile by tile.
assert.equal(P.outerRefusal(city, L(4, 0)), null, "ring 4, owned, bare, beside developed ring 3");
assert.equal(P.outerRefusal(city, L(5, 0)), "not-beside-development", "ring 5 beside only bare land");
assert.equal(P.outerRefusal(city, L(4, 1)), "not-this-city", "another city's tile");
assert.equal(P.outerRefusal(city, L(4, 3)), "occupied", "already developed");
assert.equal(P.outerRefusal(city, L(2, 0)), "inside-native-ring", "the game's own rings");
assert.equal(P.outerRefusal(city, L(3, 1)), "inside-native-ring", "ring 3 stays the game's");
assert.equal(P.outerRefusal(city, L(5, 3)), "no-improvement", "nothing the game would build there");
assert.deepEqual(P.outerCandidates(city), [idx(4, 0)], "only A qualifies");

// 2. Off when the mod is off or in a network game.
CONFIG.diffusionEnabled = false;
assert.deepEqual(P.outerCandidates(city), []);
assert.equal((await P.placeOuterCitizen(CITY, L(4, 0))).reason, "off");
CONFIG.diffusionEnabled = true;
globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: true }) };
assert.deepEqual(P.outerCandidates(city), []);
globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: false }) };

// 3. No waiting citizen: nothing is sent.
counts.pendingPopulation = 0;
let r = await P.placeOuterCitizen(CITY, L(4, 0), { pollMs: 1, waitMs: 200 });
assert.equal(r.ok, false); assert.equal(r.reason, "no-waiting-citizen"); assert.equal(requests.length, 0);
counts.pendingPopulation = 1;

// 4. A tile that no longer qualifies is refused before anything is sent.
r = await P.placeOuterCitizen(CITY, L(5, 0), { pollMs: 1, waitMs: 200 });
assert.equal(r.reason, "not-beside-development"); assert.equal(requests.length, 0);

// 5. The watched sequence: district and improvement held by the city, then the citizen spent.
r = await P.placeOuterCitizen(CITY, L(4, 0), { pollMs: 1, waitMs: 500 });
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.reason, "placed");
assert.deepEqual(requests.map((q) => q.op + ":" + q.args.Kind), ["CREATE_ELEMENT:DISTRICT", "CREATE_ELEMENT:CONSTRUCTIBLE"]);
assert.deepEqual(requests[0].args, { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: L(4, 0), Parent: CITY, Owner: 0 });
assert.equal(requests[1].args.Type, 4, "the improvement's index"); assert.equal(requests[1].args.Parent, CITY);
assert.deepEqual(r.counts, { pop: 2, rural: 1, pending: 0 }, "the same counts a native placement leaves");
assert.deepEqual(at(4, 0).cons, ["IMPROVEMENT_FARM"]);

// 6. Growth spreads tile by tile: ring 5 qualifies now that the ring-4 tile beside it is developed.
assert.deepEqual(P.outerCandidates(city), [idx(5, 0)]);

// 7. A district that never lands leaves the citizen waiting and takes nothing away.
reset(); requests.length = 0; Object.assign(counts, { population: 2, ruralPopulation: 1, pendingPopulation: 1 });
const send = Game.PlayerOperations.sendRequest;
Game.PlayerOperations.sendRequest = (s, op, args) => { requests.push({ s, op, args }); };
r = await P.placeOuterCitizen(CITY, L(4, 0), { pollMs: 1, waitMs: 30 });
assert.equal(r.ok, false); assert.equal(r.reason, "district-missing");
assert.deepEqual(r.counts, { pop: 2, rural: 1, pending: 1 });
Game.PlayerOperations.sendRequest = send;

// 8. The growth screen's list gets the outer tiles after the engine's own, once, and remembers them for the click.
const G = await import("/cultural-diffusion/ui/cd-outer-growth.js");
reset();
const model = { expandPlots: [{ plotIndex: idx(1, 0), constructibleType: 1004 }], ExpandPlotDataUpdatedEvent: { trigger: () => { model.fired++; } }, fired: 0 };
assert.equal(G.appendOuterPlots(model, CITY), 1);
assert.deepEqual(model.expandPlots.map((e) => e.plotIndex), [idx(1, 0), idx(4, 0)]);
assert.equal(model.expandPlots[1].constructibleType, 1004, "the engine's own value for the improvement");
assert.equal(model.fired, 1);
assert.equal(G.isOfferedOuter(idx(4, 0), CITY), true);
assert.equal(G.isOfferedOuter(idx(4, 0), OTHER), false);
assert.equal(G.isOfferedOuter(idx(1, 0), CITY), false, "the engine's own tiles go to the engine");
assert.equal(G.appendOuterPlots(model, CITY), 0, "no duplicates on a second call");
const prev = G.outerYieldPreview(idx(4, 0), CITY);
assert.deepEqual(prev, { plotID: idx(4, 0), yieldChanges: [0, 0, 0, 0, 0, 0], changeDetails: [], overbuiltConstructibleID: -1 },
  "zeros when the engine gives no yields");
{
  const saved = globalThis.GameplayMap.getYieldsWithCity;
  const hashes = [...globalThis.GameInfo.Yields].map((y) => y.$hash);
  globalThis.GameplayMap.getYieldsWithCity = () => [[hashes[1], 1], [hashes[4], 3], [hashes[5], 2], ["nonsense", 9]];
  assert.deepEqual(G.outerYieldPreview(idx(4, 0), CITY).yieldChanges, [0, 1, 0, 0, 3, 2], "each pair lands on its yield");
  globalThis.GameplayMap.getYieldsWithCity = saved;
}

// 9. The patches on the game's own objects: the expand list grows, a resettle list doesn't, and the hover preview
// answers for an offered outer tile instead of returning nothing.
const { PlacePopulation, BuildingPlacementManager } = await import("/base-standard/ui/place-population/model-place-population.js");
reset();
PlacePopulation.expandPlots = [];
PlacePopulation.updateExpandPlots(CITY);
assert.deepEqual(PlacePopulation.expandPlots.map((e) => e.plotIndex), [idx(4, 0)]);
PlacePopulation.expandPlots = []; PlacePopulation.isResettling = true;
PlacePopulation.updateExpandPlots(CITY);
assert.deepEqual(PlacePopulation.expandPlots, [], "a resettle list is left alone");
PlacePopulation.isResettling = false;
assert.equal(BuildingPlacementManager.getImprovementYieldChanges(1004, idx(4, 0)).plotID, idx(4, 0));
assert.equal(BuildingPlacementManager.getImprovementYieldChanges(1004, idx(1, 0)), undefined, "other tiles keep the game's answer");

console.log("outer-growth: all assertions passed");
