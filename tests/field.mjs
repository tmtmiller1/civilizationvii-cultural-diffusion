// tests/field.mjs - the pure reaction-diffusion culture-field math (Civ V port).
import assert from "node:assert/strict";
import {
  injectionAmount, cityCultureCap, decayValue, diffusionDelivered, resolveOwner
} from "/cultural-diffusion/ui/cd-field.js";

// Civ V-derived constants (kept explicit here so this tests the MATH, not cd-config wiring).
const cfg = {
  injectBase: 10, injectRatio: 0.15, cityCapFactor: 2000,
  decayRate: 0.05, decayFlat: 1,
  diffusionRate: 0.055, cultureThreshold: 100, normalMax: 0.4, maxPercent: 0.75,
  minimumOwner: 300, flipRatio: 0.65
};
const OPEN = { blocked: false, bonus: 0, malus: 0, maxFactor: 1 };

// injectionAmount: self-amplifying (grows with current stock), floored at base.
assert.equal(injectionAmount(0, 100, cfg), 0, "no strength -> no injection");
assert.equal(injectionAmount(30, 0, cfg), cfg.injectBase, "empty tile injects the base");
assert.ok(injectionAmount(30, 10000, cfg) > injectionAmount(30, 100, cfg), "injection grows with current stock");
assert.ok(injectionAmount(60, 1000, cfg) > injectionAmount(30, 1000, cfg), "a stronger city injects more");

// decay: percentage + flat point; small stocks dissipate to 0.
assert.ok(Math.abs(decayValue(1000, cfg) - (1000 - 51)) < 1e-9, "5% + 1 lost");
assert.equal(decayValue(0.5, cfg), 0, "tiny stock decays to nothing");

// diffusion: below threshold nothing spreads; blocked terrain nothing spreads; neighbour
// asymptotes to normalMax of the source and never exceeds it.
assert.equal(diffusionDelivered(50, 0, OPEN, cfg), 0, "source below threshold does not diffuse");
assert.equal(diffusionDelivered(5000, 0, { ...OPEN, blocked: true }, cfg), 0, "blocked terrain stops culture");
const oneStep = diffusionDelivered(5000, 0, OPEN, cfg);
assert.ok(Math.abs(oneStep - 5000 * 0.055) < 1e-6, "delivers the diffusion rate of the source");
const nearCap = diffusionDelivered(5000, 5000 * 0.4 - 1, OPEN, cfg);
assert.ok(nearCap <= 1 + 1e-9, "a neighbour near the normalMax cap receives almost nothing more");
assert.equal(diffusionDelivered(5000, 5000 * 0.4, OPEN, cfg), 0, "at the cap it receives nothing");
// road carries much farther than open ground.
assert.ok(
  diffusionDelivered(5000, 0, { blocked: false, bonus: 1.0, malus: 0, maxFactor: 2.5 }, cfg) >
  diffusionDelivered(5000, 0, OPEN, cfg),
  "roads accelerate diffusion"
);

// ownership: needs the absolute floor, and a decisive ratio to flip an incumbent.
assert.equal(resolveOwner({ "0": 200 }, -1, [], cfg).flip, false, "below minimumOwner: no acquire");
assert.equal(resolveOwner({ "0": 400 }, -1, [], cfg).flip, true, "past minimumOwner on empty land: acquire");
assert.equal(resolveOwner({ "0": 400, "1": 380 }, 1, [], cfg).flip, false, "a slim lead does NOT flip an owned tile");
assert.equal(resolveOwner({ "0": 900, "1": 380 }, 1, [], cfg).flip, true, "a decisive lead flips it");
assert.equal(resolveOwner({ "0": 5000 }, -1, [0], cfg).owner, -1, "dead civs are ignored");

// -- Travelling wave: reach is SLOW and emergent (the whole point of the port) --
// A 1-D line of tiles; tile 0 is a city injecting each turn; culture diffuses to line
// neighbours, decays, and we watch how many TURNS until each distance crosses ownership.
function simulateReach(strength, maxTurns) {
  const N = 12;
  let f = new Array(N).fill(0);
  const cap = cityCultureCap(strength, cfg);
  const firstOwned = new Array(N).fill(Infinity);
  for (let turn = 1; turn <= maxTurns; turn++) {
    const next = f.map((v) => decayValue(v, cfg));
    for (let i = 0; i < N; i++) {
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= N) continue;
        next[j] += diffusionDelivered(f[i], next[j], OPEN, cfg);
      }
    }
    // city injection at tile 0 (capped)
    if (f[0] < cap) next[0] = Math.min(cap, next[0] + injectionAmount(strength, f[0], cfg));
    f = next;
    for (let i = 0; i < N; i++) if (f[i] > cfg.minimumOwner && turn < firstOwned[i]) firstOwned[i] = turn;
  }
  return firstOwned;
}
const owned = simulateReach(40, 400);
// The city tile is owned almost immediately; each ring out takes progressively, and
// substantially, longer - a creeping front, not an instant snap.
assert.ok(owned[1] < owned[2] && owned[2] < owned[3], "each ring is claimed later than the last");
assert.ok(owned[1] >= 3, "even the first ring takes several turns to build up");
assert.ok(owned[3] - owned[1] >= 10, "reaching ring 3 lags ring 1 by many turns (slow, organic)");
assert.ok(owned[3] > 20, `ring 3 is a mid-game event, not turn ~5 (was ${owned[3]})`);

// A far-stronger culture pushes the SAME front out faster and farther (overwhelming culture).
const strongOwned = simulateReach(160, 400);
assert.ok(strongOwned[3] < owned[3], "an overwhelming culture reaches ring 3 sooner");

console.log("field.mjs OK");
