// tests/pressure.mjs - the pure injection-strength math (3b).
import assert from "node:assert/strict";
import {
  hexDistance, happinessFactor, wonderFactor, prosperityFactor, ethnicFactor, projectionOf
} from "/cultural-diffusion/ui/cd-pressure.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

const cfg = { ...CONFIG };

// hexDistance: same tile 0, one step 1, symmetric.
assert.equal(hexDistance({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
assert.equal(hexDistance({ x: 5, y: 5 }, { x: 6, y: 5 }), 1);
assert.equal(
  hexDistance({ x: 2, y: 3 }, { x: 8, y: 9 }),
  hexDistance({ x: 8, y: 9 }, { x: 2, y: 3 }),
  "symmetric"
);

// happiness/wonder/prosperity/ethnic factors: neutral points + monotonicity + bounds.
assert.equal(happinessFactor(0, 0.25), 1);
assert.ok(happinessFactor(50, 0.25) > 1 && happinessFactor(50, 0.25) <= 1.25 + 1e-9);
assert.ok(happinessFactor(-50, 0.25) < 1);
assert.equal(wonderFactor(0, 0.12), 1);
assert.ok(wonderFactor(3, 0.12) > wonderFactor(1, 0.12));
assert.equal(prosperityFactor(0, 0.5), 1);
assert.equal(prosperityFactor(undefined, 0.5), 1);
assert.ok(Math.abs(prosperityFactor(1, 0.5) - 1.5) < 1e-9);
assert.equal(ethnicFactor(0, 1), 1);
assert.equal(ethnicFactor(null, 1), 1);
assert.ok(Math.abs(ethnicFactor(1, 1) - 2) < 1e-9);

// projectionOf: the fused injection base is culture^alpha x vitality^(1-alpha). Rises with culture,
// vitality, and celebration; zero culture -> zero injection.
const base = { owner: 0, loc: { x: 10, y: 10 }, culture: 20, vitality: 25, celebrating: false };
assert.ok(projectionOf(base, cfg) > 0, "a producing city injects");
assert.equal(projectionOf({ ...base, culture: 0 }, cfg), 0, "no culture, no injection");
assert.ok(projectionOf({ ...base, celebrating: true }, cfg) > projectionOf(base, cfg), "celebration boosts injection");
assert.ok(projectionOf({ ...base, culture: 40 }, cfg) > projectionOf(base, cfg), "more culture, more injection");
assert.ok(projectionOf({ ...base, vitality: 60 }, cfg) > projectionOf(base, cfg), "a more prosperous society injects harder");

// The flattener: a culture spike raises injection SUBLINEARLY (concave), and by strictly less
// than the raw-culture (alpha=1) model would - this is what tames culture-engine snowball.
const rawCfg = { ...cfg, cultureExponent: 1.0 };
const spike = { ...base, culture: 40 }; // doubled culture
const compBoost = projectionOf(spike, cfg) / projectionOf(base, cfg);
const rawBoost = projectionOf(spike, rawCfg) / projectionOf(base, rawCfg);
assert.ok(compBoost < rawBoost, "composite flattens a culture spike vs the raw-culture base");
assert.ok(compBoost < 2 && compBoost > 1, "doubling culture less-than-doubles injection (concave)");
assert.ok(Math.abs(rawBoost - 2) < 1e-9, "raw base doubles injection when culture doubles");

// With the fused model off, it degrades to plain culture (vitality ignored).
const off = { ...cfg, fusedModel: false };
assert.equal(projectionOf({ ...base, vitality: 5 }, off), projectionOf({ ...base, vitality: 500 }, off), "fusedModel off ignores vitality");

console.log("pressure.mjs OK");
