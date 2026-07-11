// tests/cpi-branches.mjs - branch/edge hardening for the pure CPI math (mutation coverage).
// Every assertion below pins a specific guard or arithmetic branch so a mutant that flips it
// is caught. Nothing here suppresses a mutant; each is a genuine behavioural check.
import assert from "node:assert/strict";
import { sharesVsMax, computeCPI, fPower, __test } from "/cultural-diffusion/ui/cd-cpi.js";

const { num, clamp01, EPS } = __test;

// --- num(): guard rejects non-finite / non-number, keeps finite numbers ---
assert.equal(num(5, 7), 5, "finite number passes through");
assert.equal(num(Number.NaN, 7), 7, "NaN -> fallback");
assert.equal(num(Number.POSITIVE_INFINITY, 7), 7, "Infinity -> fallback");
assert.equal(num("5", 7), 7, "numeric string is not a number -> fallback");
assert.equal(num(undefined, 7), 7, "undefined -> fallback");
assert.equal(num(0, 7), 0, "zero is a valid number, not falsy-coerced");

// --- clamp01(): both rails and the identity middle are exercised with exact values ---
assert.equal(clamp01(-1), 0, "below range clamps to 0");
assert.equal(clamp01(2), 1, "above range clamps to 1");
assert.equal(clamp01(0.5), 0.5, "in range is identity");

// --- computeCPI(): the no-weighting-info guard returns exactly the neutral 0.5 ---
assert.equal(computeCPI({}, {}, []), 0.5, "empty dims -> neutral 0.5 (guard fires)");
assert.equal(
  computeCPI({ a: 1 }, { a: 0 }, ["a"]), 0.5,
  "all weights zero (wsum==0) but dims present -> neutral 0.5 (|| guard, not &&)"
);
// A real weighting must NOT return the neutral sentinel - proves the guard is conditional.
assert.notEqual(computeCPI({ a: 1 }, { a: 1 }, ["a"]), 0.5, "a weighted CPI is computed, not the guard sentinel");

// --- computeCPI(): a zero-share dimension is floored by +EPS, never NaN-collapsed ---
const withZero = computeCPI({ a: 1, b: 0 }, { a: 1, b: 1 }, ["a", "b"]);
assert.ok(isFinite(withZero) && withZero > EPS * 10,
  `zero share is EPS-floored (share+EPS), giving a small finite CPI (got ${withZero})`);

// --- computeCPI(): weight actually re-weights (w/wsum, not w*wsum) ---
// Same shares, opposite weight emphasis -> emphasising the strong dim yields a higher CPI.
const shares = { a: 1.0, b: 0.02 };
const weightStrong = computeCPI(shares, { a: 9, b: 1 }, ["a", "b"]);
const weightWeak = computeCPI(shares, { a: 1, b: 9 }, ["a", "b"]);
assert.ok(weightStrong > weightWeak, "weighting the strong dimension raises CPI (normalised w/wsum)");

// --- computeCPI(): the leader (all shares 1) is exactly ~1, not the guard/floor ---
assert.ok(Math.abs(computeCPI({ a: 1, b: 1 }, { a: 2, b: 3 }, ["a", "b"]) - 1) < 1e-6,
  "all-share-1 with arbitrary positive weights -> CPI 1");

// --- fPower(): the finite/positive guard returns 1 when the mapped multiplier is non-positive ---
assert.equal(fPower(0, { cpiPowerMin: 0, cpiPowerMax: 2 }), 1,
  "a mapped multiplier of exactly 0 is rejected -> neutral 1 (guard false branch)");
assert.ok(fPower(1, { cpiPowerMin: 0, cpiPowerMax: 2 }) > 1,
  "a positive multiplier passes the guard (guard is conditional, not always-1)");
// Missing config -> defaults keep it at neutral 1 across the CPI range.
assert.equal(fPower(0.5, null), 1, "null cfg -> lo=hi=1 -> neutral");

// --- sharesVsMax(): the strongest civ is exactly 1 and a tie does not disturb the max ---
const s1 = sharesVsMax(new Map([[0, { legacy: 4 }], [1, { legacy: 4 }]]), ["legacy"]);
assert.equal(s1.shares.get(0).legacy, 1, "tied leaders both read share 1 (max is their common value)");
assert.equal(s1.shares.get(1).legacy, 1, "tie partner also 1");

console.log("cpi-branches.mjs OK");
