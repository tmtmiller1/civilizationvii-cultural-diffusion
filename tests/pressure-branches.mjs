// tests/pressure-branches.mjs - branch/edge hardening for the injection-strength math.
import assert from "node:assert/strict";
import {
  happinessFactor, prosperityFactor, ethnicFactor, projectionOf
} from "/cultural-diffusion/ui/cd-pressure.js";

const cfg = {
  cultureWeight: 1, ageFactor: 1, cultureExponent: 0.65, fusedModel: true
};

// --- happinessFactor(): tanh(happiness/8) sign & the non-number guard ---
// The /8 divisor: a happiness of 8 squashes to tanh(1); scaling matters, so the argument
// must be happiness/8 (not happiness*8). At h=8, factor ~ 1 + amp*tanh(1) ~ 1+0.25*0.7616.
assert.ok(Math.abs(happinessFactor(8, 0.25) - (1 + 0.25 * Math.tanh(1))) < 1e-9,
  "happiness is divided by 8 before tanh");
assert.notEqual(happinessFactor(8, 0.25), 1 + 0.25 * Math.tanh(64),
  "argument is happiness/8, not happiness*8");
assert.equal(happinessFactor("bad", 0.25), 1, "non-number happiness -> tanh(0) -> neutral 1");
assert.equal(happinessFactor(0, 0.25), 1, "zero happiness -> neutral");

// --- prosperityFactor(): finite guard + [-1,1] clamp ---
assert.equal(prosperityFactor(Number.NaN, 0.5), 1, "NaN prosperity -> neutral (finite guard)");
// The amp guard is a real 'typeof === number' check: a non-number amp -> 0, not NaN.
assert.equal(prosperityFactor(1, "bad"), 1, "non-number amp -> amp 0 -> neutral (typeof guard, not always-amp)");
// The value guard is BOTH typeof-number AND isFinite: a numeric STRING passes isFinite but must
// still be rejected by the typeof half (kills the 'typeof===number -> true' left-operand mutant).
assert.equal(prosperityFactor("5", 0.5), 1, "a numeric string is rejected by the typeof half of the guard");
assert.equal(prosperityFactor(5, 0.5), prosperityFactor(1, 0.5), "prosperity clamps to +1");
assert.equal(prosperityFactor(-5, 0.5), prosperityFactor(-1, 0.5), "prosperity clamps to -1");
assert.ok(Math.abs(prosperityFactor(-1, 0.5) - 0.5) < 1e-9, "prosperity -1 at amp .5 -> 0.5");

// --- ethnicFactor(): finite guard + [0,1] clamp ---
assert.equal(ethnicFactor(Number.NaN, 1), 1, "NaN affinity -> neutral (finite guard)");
assert.equal(ethnicFactor(5, 1), ethnicFactor(1, 1), "affinity clamps to +1");
assert.equal(ethnicFactor(-1, 1), 1, "negative affinity clamps to 0 -> neutral");
assert.equal(ethnicFactor(0.5, "bad"), 1, "non-number weight -> neutral");
assert.equal(ethnicFactor("0.5", 1), 1, "a numeric-string affinity is rejected by the typeof half of the guard");

// --- projectionOf(): the culture<=0 short-circuit and the culture*weight product ---
assert.equal(projectionOf({ culture: 5, vitality: 5, celebrating: false }, { ...cfg, cultureWeight: 0 }), 0,
  "zero cultureWeight -> zero culture -> no injection (product, not quotient)");
// cultureWeight multiplies: doubling the weight raises the (fused) projection.
assert.ok(
  projectionOf({ culture: 20, vitality: 20, celebrating: false }, { ...cfg, cultureWeight: 2 }) >
  projectionOf({ culture: 20, vitality: 20, celebrating: false }, { ...cfg, cultureWeight: 1 }),
  "cultureWeight scales projection up (culture * cultureWeight)"
);

// --- projectionOf(): ageFactor multiplies (and its 0.1 floor) ---
const s = { culture: 20, vitality: 20, celebrating: false };
assert.ok(projectionOf(s, { ...cfg, ageFactor: 2 }) > projectionOf(s, { ...cfg, ageFactor: 1 }),
  "a larger ageFactor multiplies projection up (base * celebrate * age)");
// Floor at 0.1: ageFactor 0 and a tiny negative both clamp to the same 0.1 floor.
assert.equal(projectionOf(s, { ...cfg, ageFactor: 0 }), projectionOf(s, { ...cfg, ageFactor: -5 }),
  "ageFactor floored at 0.1 (Math.max, not Math.min)");
assert.ok(projectionOf(s, { ...cfg, ageFactor: 0 }) > 0, "floored ageFactor still injects (0.1, not 0)");

// --- fusedBase alpha exponent: alpha=1 is pure culture (vitality ignored) ---
const cultureOnly = projectionOf({ culture: 20, vitality: 999, celebrating: false }, { ...cfg, cultureExponent: 1 });
const cultureOnly2 = projectionOf({ culture: 20, vitality: 1, celebrating: false }, { ...cfg, cultureExponent: 1 });
assert.equal(cultureOnly, cultureOnly2, "cultureExponent 1 -> vitality has no weight");
// alpha=0 is pure vitality.
const vitOnly = projectionOf({ culture: 20, vitality: 50, celebrating: false }, { ...cfg, cultureExponent: 0 });
assert.ok(Math.abs(vitOnly - 50) < 1e-9, "cultureExponent 0 -> projection is pure vitality");

// --- vitality finite guard: non-finite vitality falls back to culture, not NaN ---
const nanVit = projectionOf({ culture: 20, vitality: Number.NaN, celebrating: false }, cfg);
const noVit = projectionOf({ culture: 20, celebrating: false }, cfg);
assert.ok(Math.abs(nanVit - noVit) < 1e-9, "NaN vitality falls back to culture (same as absent)");
assert.ok(isFinite(nanVit) && nanVit > 0, "NaN vitality does not poison the projection");
// A numeric-STRING vitality is rejected by the typeof half (kills the left-operand '-> true' mutant).
assert.equal(
  projectionOf({ culture: 20, vitality: "999", celebrating: false }, cfg), noVit,
  "a numeric-string vitality is rejected by typeof -> falls back to culture (not read as 999)"
);
// The cultureExponent guard is a real typeof check: a non-number exponent -> default 0.65, not NaN.
assert.equal(
  projectionOf({ culture: 20, vitality: 20, celebrating: false }, { ...cfg, cultureExponent: "bad" }),
  projectionOf({ culture: 20, vitality: 20, celebrating: false }, { ...cfg, cultureExponent: 0.65 }),
  "non-number cultureExponent -> 0.65 default (typeof guard, not always-exponent -> NaN)"
);

console.log("pressure-branches.mjs OK");
