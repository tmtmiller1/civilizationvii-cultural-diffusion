// tests/cpi.mjs - the pure Cultural Power Index math (3.1a term A).
import assert from "node:assert/strict";
import { sharesVsMax, computeCPI, fPower, powerMultipliers, CPI_DIMENSIONS } from "/cultural-diffusion/ui/cd-cpi.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

const cfg = { ...CONFIG };

// sharesVsMax: leader in each dimension reads 1; empty dimensions are dropped.
const raw = new Map([
  [0, { legacy: 10, flow: 100, reach: 4, vitality: 8, prosperity: 50, identity: 6 }],
  [1, { legacy: 5, flow: 50, reach: 2, vitality: 4, prosperity: 25, identity: 3 }],
  [2, { legacy: 0, flow: 0, reach: 0, vitality: 0, prosperity: 0, identity: 0 }]
]);
const { shares, liveDims } = sharesVsMax(raw);
assert.deepEqual(liveDims, [...CPI_DIMENSIONS], "all six dimensions have signal");
assert.equal(shares.get(0).flow, 1, "leader gets share 1");
assert.equal(shares.get(1).flow, 0.5, "half-as-strong civ gets 0.5");
assert.equal(shares.get(2).flow, 0, "a civ with nothing gets 0");

// A dimension where everyone reads 0 is dropped, not treated as a shared zero.
const raw2 = new Map([
  [0, { legacy: 4, flow: 10, reach: 0, vitality: 2, prosperity: 3, identity: 1 }],
  [1, { legacy: 2, flow: 5, reach: 0, vitality: 1, prosperity: 1, identity: 1 }]
]);
assert.ok(!sharesVsMax(raw2).liveDims.includes("reach"), "all-zero dimension dropped");

// computeCPI: the all-1s leader tends to 1; breadth beats a single spike.
const ones = {}; const wts = {};
for (const d of liveDims) { ones[d] = 1; wts[d] = 1; }
assert.ok(computeCPI(ones, wts, liveDims) > 0.999, "leader in every dimension -> CPI ~ 1");

const broad = { legacy: 0.6, flow: 0.6, reach: 0.6, vitality: 0.6, prosperity: 0.6, identity: 0.6 };
const spiky = { legacy: 1.0, flow: 1.0, reach: 0.05, vitality: 0.05, prosperity: 0.05, identity: 0.05 };
const eqw = { legacy: 1, flow: 1, reach: 1, vitality: 1, prosperity: 1, identity: 1 };
assert.ok(
  computeCPI(broad, eqw, [...CPI_DIMENSIONS]) > computeCPI(spiky, eqw, [...CPI_DIMENSIONS]),
  "broad strength beats a two-stat spike (geometric mean)"
);

// fPower: bounded and monotone between cpiPowerMin and cpiPowerMax.
assert.ok(Math.abs(fPower(0, cfg) - cfg.cpiPowerMin) < 1e-9, "CPI 0 -> cpiPowerMin");
assert.ok(Math.abs(fPower(1, cfg) - cfg.cpiPowerMax) < 1e-9, "CPI 1 -> cpiPowerMax");
assert.ok(fPower(0.5, cfg) > fPower(0.2, cfg), "f_power rises with CPI");

// powerMultipliers end-to-end: the strongest civ gets the biggest multiplier.
const { power, cpi } = powerMultipliers(raw, cfg);
assert.ok(power.get(0) > power.get(1) && power.get(1) > power.get(2), "power ordering follows strength");
assert.ok(cpi.get(0) > cpi.get(1), "CPI ordering follows strength");
assert.ok(power.get(0) <= cfg.cpiPowerMax + 1e-9 && power.get(2) >= cfg.cpiPowerMin - 1e-9, "multipliers stay in bounds");

console.log("cpi.mjs OK");
