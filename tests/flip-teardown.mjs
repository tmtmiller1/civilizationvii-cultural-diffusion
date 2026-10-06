// tests/flip-teardown.mjs: an improved tile is torn down before it is bought, then rebuilt for its new owner.
//
// The regression this guards: city.purchasePlot on a tile that still carries a rural district damages the save
// (watched 2026-10-06: enough of them crash the next age transition). So performFlip must send DESTROY_ELEMENT for
// the constructibles and the district, buy only after the teardown shows on the map, and recreate the district and
// the original improvement for the buyer. Bare tiles keep the plain purchase; urban districts, centers and wonders
// are refused.
import assert from "node:assert/strict";

const requests = [];
let purchaseCalls = 0;
let goldBalance = 1000;
// The stubbed plot: what the map reports about it, mutated by the stubbed engine requests.
const plot = { districtId: null, resolvable: false, districtType: null, constructibles: [], owner: 2 };

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.YieldTypes = { YIELD_GOLD: 7 };
globalThis.DistrictTypes = { CITY_CENTER: 1, URBAN: 2, RURAL: 3, WILDERNESS: 4 };
globalThis.GameContext = { localPlayerID: 0 };
globalThis.GameplayMap = { getOwner: (_x, _y) => plot.owner };
globalThis.MapCities = { getDistrict: (_x, _y) => plot.districtId };
globalThis.Districts = { get: (id) => (plot.resolvable && id === plot.districtId ? { type: DistrictTypes[plot.districtType], id } : null) };
globalThis.MapConstructibles = { getConstructibles: (_x, _y) => plot.constructibles.map((c) => c.id) };
globalThis.Constructibles = { getByComponentID: (id) => { const c = plot.constructibles.find((k) => k.id === id); return c ? { type: c.type } : null; } };
const DEFS = {
  FARM: { ConstructibleType: "IMPROVEMENT_FARM", ConstructibleClass: "IMPROVEMENT", $index: 4 },
  WONDER: { ConstructibleType: "WONDER_PYRAMIDS", ConstructibleClass: "WONDER", $index: 90 }
};
globalThis.GameInfo = { Constructibles: { lookup: (t) => DEFS[t] || null } };
globalThis.Players = {
  get: (_pid) => ({ Treasury: { get goldBalance() { return goldBalance; }, changeGoldBalance: (amt) => { goldBalance += amt; } } }),
  grantYield: (_pid, _y, amt) => { goldBalance += amt; }
};
globalThis.Game = {
  PlayerOperations: {
    sendRequest: (sender, op, args) => {
      requests.push({ sender, op, args });
      if (op === "DESTROY_ELEMENT" && args.Kind === "CONSTRUCTIBLE") plot.constructibles = plot.constructibles.filter((c) => c.id.id !== args.LocalID);
      if (op === "DESTROY_ELEMENT" && args.Kind === "DISTRICT") { plot.districtId = null; plot.resolvable = false; plot.districtType = null; }
      if (op === "CREATE_ELEMENT" && args.Kind === "DISTRICT") { plot.districtId = { owner: args.Owner, id: 777 }; plot.resolvable = true; plot.districtType = "RURAL"; }
      if (op === "CREATE_ELEMENT" && args.Kind === "CONSTRUCTIBLE") plot.constructibles.push({ id: { owner: args.Owner, id: 778 }, type: Object.keys(DEFS).find((k) => DEFS[k].$index === args.Type) });
    }
  }
};
// The buying city: the purchase lands a tick later, as in the game.
const city = { id: { owner: 0, id: 5 }, purchasePlot: (_loc) => { purchaseCalls++; goldBalance -= 25; setTimeout(() => { plot.owner = 0; }, 2); } };

const { performFlip } = await import("/cultural-diffusion/ui/cd-ownership.js");
const { flipWithTeardown, plotInventory } = await import("/cultural-diffusion/ui/cd-teardown.js");
const loc = { x: 3, y: 4 };
function reset(p) { requests.length = 0; purchaseCalls = 0; goldBalance = 1000; Object.assign(plot, { districtId: null, resolvable: false, districtType: null, constructibles: [], owner: 2 }, p); }

// 1. A farm tile: teardown, then buy, then rebuild with the farm.
reset({ districtId: { owner: 2, id: 11 }, resolvable: true, districtType: "RURAL", constructibles: [{ id: { owner: 2, id: 12 }, type: "FARM" }] });
let r = performFlip({ playerId: 0, city, loc, verb: "purchasePlot", refund: true });
assert.equal(r.ok, true);
assert.equal(r.reason, "teardown-purchase");
assert.equal(purchaseCalls, 0, "the buy waits for the teardown");
assert.deepEqual(requests.map((q) => q.op + ":" + q.args.Kind), ["DESTROY_ELEMENT:CONSTRUCTIBLE", "DESTROY_ELEMENT:DISTRICT"], "constructible then district torn down first");
assert.equal(requests[0].args.LocalID, 12); assert.equal(requests[1].args.LocalID, 11); assert.equal(requests[1].args.Owner, 2);
let out = await r.settled;
assert.equal(out.cleared, true); assert.equal(out.landed, true); assert.equal(out.rebuilt, true); assert.equal(out.improvement, "IMPROVEMENT_FARM");
assert.equal(purchaseCalls, 1, "bought once");
assert.equal(goldBalance, 1000, "the buy's gold is refunded");
assert.deepEqual(requests.slice(2).map((q) => q.op + ":" + q.args.Kind), ["CREATE_ELEMENT:DISTRICT", "CREATE_ELEMENT:CONSTRUCTIBLE"], "district then improvement rebuilt");
assert.deepEqual(requests[2].args, { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: loc, Parent: city.id, Owner: 0 });
assert.equal(requests[3].args.Type, 4, "the original improvement's index");
assert.equal(requests[3].args.Owner, 0);
assert.equal(plot.owner, 0); assert.equal(plotInventory(loc).constructibles[0].type, "IMPROVEMENT_FARM");

// 2. A bare tile keeps the plain purchase: no engine requests at all.
reset({});
r = performFlip({ playerId: 0, city, loc, verb: "purchasePlot", refund: true });
assert.equal(r.ok, true); assert.equal(r.reason, "purchasePlot"); assert.equal(r.settled, undefined);
assert.equal(purchaseCalls, 1); assert.equal(requests.length, 0);

// 3. Urban districts and city centers are refused.
for (const t of ["URBAN", "CITY_CENTER"]) {
  reset({ districtId: { owner: 2, id: 11 }, resolvable: true, districtType: t });
  r = performFlip({ playerId: 0, city, loc, verb: "purchasePlot", refund: true });
  assert.equal(r.ok, false); assert.equal(r.reason, "district-" + t.toLowerCase());
  assert.equal(purchaseCalls, 0); assert.equal(requests.length, 0);
}

// 4. A wonder is refused even on a rural district.
reset({ districtId: { owner: 2, id: 11 }, resolvable: true, districtType: "RURAL", constructibles: [{ id: { owner: 2, id: 13 }, type: "WONDER" }] });
r = performFlip({ playerId: 0, city, loc, verb: "purchasePlot", refund: true });
assert.equal(r.ok, false); assert.equal(r.reason, "wonder"); assert.equal(requests.length, 0);

// 5. A half-made district (the id the map holds does not resolve) is destroyed by that id, then bought; the rebuild
//    recreates the district alone, since there was no improvement to put back.
reset({ districtId: { owner: 0, id: 99 }, resolvable: false });
r = performFlip({ playerId: 0, city, loc, verb: "purchasePlot", refund: true });
assert.equal(r.ok, true); assert.equal(r.reason, "teardown-purchase");
assert.deepEqual(requests.map((q) => q.op + ":" + q.args.Kind + ":" + (q.args.LocalID ?? "")), ["DESTROY_ELEMENT:DISTRICT:99"]);
out = await r.settled;
assert.equal(out.improvement, null); assert.equal(out.rebuilt, true);
assert.deepEqual(requests.slice(1).map((q) => q.op + ":" + q.args.Kind), ["CREATE_ELEMENT:DISTRICT"]);

// 6. If the teardown never shows on the map, the buy still goes out once the wait is up (nothing is left stranded).
reset({ districtId: { owner: 2, id: 11 }, resolvable: true, districtType: "RURAL", constructibles: [{ id: { owner: 2, id: 12 }, type: "FARM" }] });
const realSend = Game.PlayerOperations.sendRequest;
Game.PlayerOperations.sendRequest = (s, op, a) => { requests.push({ s, op, a }); };
out = await flipWithTeardown({ loc, playerId: 0, city, inv: plotInventory(loc), buy: () => { purchaseCalls++; setTimeout(() => { plot.owner = 0; }, 2); return { ok: true, reason: "purchasePlot" }; }, pollMs: 1, teardownWaitMs: 10, landWaitMs: 50 });
Game.PlayerOperations.sendRequest = realSend;
assert.equal(out.cleared, false, "teardown did not show"); assert.equal(purchaseCalls, 1, "bought anyway"); assert.equal(out.landed, true);

// 8. A buy that never lands gives the tile back to its previous owner, improvement included, instead of leaving a
//    bare plot: the rebuild goes to the old owner's city.
reset({ districtId: { owner: 2, id: 11 }, resolvable: true, districtType: "RURAL", constructibles: [{ id: { owner: 2, id: 12 }, type: "FARM" }] });
globalThis.MapCities.getCity = (_x, _y) => ({ owner: 2, id: 41 });
out = await flipWithTeardown({ loc, playerId: 0, city, inv: plotInventory(loc), buy: () => { purchaseCalls++; return { ok: true, reason: "purchasePlot" }; }, pollMs: 1, teardownWaitMs: 20, landWaitMs: 10 });
assert.equal(out.landed, false); assert.equal(out.rebuilt, false); assert.equal(out.restored, true);
const creates = requests.filter((q) => q.op === "CREATE_ELEMENT");
assert.equal(creates.length, 2, "district and farm recreated");
assert.deepEqual(creates[0].args.Parent, { owner: 2, id: 41 }, "attached to the previous owner's city");
assert.equal(creates[0].args.Owner, 2); assert.equal(creates[1].args.Type, 4);
assert.equal(plot.owner, 2, "still the previous owner's tile");
delete globalThis.MapCities.getCity;

// 7. The setOwnership verb is untouched by all of this.
reset({ districtId: { owner: 2, id: 11 }, resolvable: true, districtType: "RURAL" });
globalThis.WorldBuilder = { MapPlots: { setOwnership: () => {} } };
r = performFlip({ playerId: 0, city, loc, verb: "setOwnership" });
assert.equal(r.ok, true); assert.equal(r.verb, "setOwnership"); assert.equal(requests.length, 0);

console.log("flip-teardown: OK (8 scenarios)");
