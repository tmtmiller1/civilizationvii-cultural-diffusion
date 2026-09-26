// tests/ownership.mjs - flip verb routing + gold refund + no-orphan-fallback.
//
// The core regression this guards: the shipping verb is the INTEGRATED purchasePlot, and a
// FAILED purchase must NOT fall back to setOwnership (which would re-create the orphan tile that
// blocks the base game's own border growth). Also verifies purchasePlot's gold cost is refunded
// the same tick so integrated claims net zero gold.
import assert from "node:assert/strict";

// --- minimal engine stubs -------------------------------------------------------
let setOwnershipCalls = 0;
let purchaseCalls = 0;
let goldBalance = 1000;
const goldWrites = [];

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.YieldTypes = { YIELD_GOLD: 7 };
globalThis.WorldBuilder = {
  MapPlots: {
    setOwnership: (_pid, _loc) => { setOwnershipCalls++; }
  }
};
globalThis.Players = {
  get: (_pid) => ({
    Treasury: {
      get goldBalance() { return goldBalance; },
      changeGoldBalance: (amt) => { goldBalance += amt; goldWrites.push(amt); }
    }
  })
};

// A city whose purchasePlot succeeds and costs 25 gold.
const buyingCity = { purchasePlot: (_loc) => { purchaseCalls++; goldBalance -= 25; } };
// A city whose purchasePlot throws (simulates a failed / unaffordable buy).
const failingCity = { purchasePlot: (_loc) => { throw new Error("cannot buy"); } };

const { performFlip, flipViaPurchasePlotRefunded, grantGold, playerGold } =
  await import("/cultural-diffusion/ui/cd-ownership.js");

const loc = { x: 3, y: 4 };

// 1. purchasePlot success integrates AND refunds the spent gold (net zero).
setOwnershipCalls = 0; purchaseCalls = 0; goldBalance = 1000; goldWrites.length = 0;
let r = performFlip({ playerId: 0, city: buyingCity, loc, verb: "purchasePlot", refund: true });
assert.equal(r.ok, true, "purchasePlot succeeds");
assert.equal(r.verb, "purchasePlot");
assert.equal(purchaseCalls, 1, "purchasePlot was called");
assert.equal(r.cost, 25, "cost of the buy is measured");
assert.equal(goldBalance, 1000, "gold balance is restored (net zero)");
assert.equal(setOwnershipCalls, 0, "success never touches setOwnership");

// 2. refund:false leaves the gold spent.
purchaseCalls = 0; goldBalance = 1000;
r = performFlip({ playerId: 0, city: buyingCity, loc, verb: "purchasePlot", refund: false });
assert.equal(r.ok, true);
assert.equal(goldBalance, 975, "no refund => gold stays spent");

// 3. FAILED purchase does NOT fall back to setOwnership (the orphan-prevention invariant).
setOwnershipCalls = 0; goldBalance = 1000;
r = performFlip({ playerId: 0, city: failingCity, loc, verb: "purchasePlot", refund: true });
assert.equal(r.ok, false, "failed buy reports failure");
assert.equal(r.verb, "purchasePlot");
assert.equal(setOwnershipCalls, 0, "failed buy must NOT orphan-fallback to setOwnership");

// 4. No city => no-city, still no setOwnership fallback.
setOwnershipCalls = 0;
r = performFlip({ playerId: 0, city: null, loc, verb: "purchasePlot" });
assert.equal(r.ok, false);
assert.equal(r.reason, "no-city");
assert.equal(setOwnershipCalls, 0, "missing city must NOT orphan-fallback");

// 5. Explicit setOwnership verb still routes to setOwnership (the "Free territory" option).
setOwnershipCalls = 0; purchaseCalls = 0;
r = performFlip({ playerId: 0, city: buyingCity, loc, verb: "setOwnership" });
assert.equal(r.verb, "setOwnership");
assert.equal(setOwnershipCalls, 1, "setOwnership verb calls setOwnership");
assert.equal(purchaseCalls, 0, "setOwnership verb never buys");

// 6. Refund helper: a zero-cost buy grants no gold.
goldBalance = 500; goldWrites.length = 0;
const zeroCostCity = { purchasePlot: (_l) => {} };
r = flipViaPurchasePlotRefunded(0, zeroCostCity, loc, true);
assert.equal(r.ok, true);
assert.equal(r.cost, 0, "free buy has zero cost");
assert.equal(goldWrites.length, 0, "free buy triggers no gold write");

// 7. Gold read/write primitives.
goldBalance = 42;
assert.equal(playerGold(0), 42, "playerGold reads the balance");
grantGold(0, 8);
assert.equal(goldBalance, 50, "grantGold writes the balance through changeGoldBalance when grantYield is absent");
// With Players.grantYield present it is preferred: the one gold write watched working on 1.5.0 (changeGoldBalance
// changed nothing for anyone, gold runs 2026-09-25).
const grants = [];
globalThis.Players.grantYield = (pid, yt, amt) => { grants.push([pid, yt, amt]); };
assert.deepEqual(grantGold(2, 37), { ok: true, reason: "grantYield" }, "grantYield is the preferred verb");
assert.deepEqual(grants, [[2, 7, 37]], "...called with the player, YIELD_GOLD and the amount");
assert.equal(goldBalance, 50, "...and changeGoldBalance is not also called");
delete globalThis.Players.grantYield;

console.log("ownership.mjs OK");
