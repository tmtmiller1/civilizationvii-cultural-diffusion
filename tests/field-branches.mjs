// tests/field-branches.mjs - branch/edge hardening for the reaction-diffusion field math.
import assert from "node:assert/strict";
import {
  injectionAmount, decayValue, diffusionDelivered, resolveOwner, __test
} from "/cultural-diffusion/ui/cd-field.js";

const { num } = __test;
const cfg = {
  injectBase: 10, injectRatio: 0.15, cityCapFactor: 2000,
  decayRate: 0.05, decayFlat: 1,
  diffusionRate: 0.055, cultureThreshold: 100, normalMax: 0.4, maxPercent: 0.75,
  minimumOwner: 300, flipRatio: 0.65
};
const OPEN = { blocked: false, bonus: 0, malus: 0, maxFactor: 1 };

// --- num(): non-finite guard (shared helper) ---
assert.equal(num(3, 9), 3);
assert.equal(num(Number.NaN, 9), 9, "NaN -> fallback");
assert.equal(num(Number.POSITIVE_INFINITY, 9), 9, "Infinity -> fallback");
assert.equal(num("3", 9), 9, "string -> fallback");

// --- injectionAmount(): strength MULTIPLIES the sqrt term (not adds) ---
// v = strength * sqrt(currentOwn * ratio) + base. Doubling strength doubles the growth term.
const grow1 = injectionAmount(30, 10000, cfg) - cfg.injectBase;
const grow2 = injectionAmount(60, 10000, cfg) - cfg.injectBase;
assert.ok(Math.abs(grow2 - 2 * grow1) < 1e-6, "strength scales the sqrt growth term multiplicatively");
// The non-finite guard returns the base, not a poisoned value.
assert.equal(injectionAmount(30, Number.NaN, cfg), cfg.injectBase, "NaN current stock -> just the base");

// --- decayValue(): the >0 clamp (not >=0) still yields exactly 0 at the boundary ---
assert.equal(decayValue(1, cfg), 0, "a stock fully consumed by flat decay lands at 0, never negative");
assert.ok(decayValue(1000, cfg) > 0, "a large stock stays positive after decay");
// decay is percentage + flat: at 1000 -> 1000 - (50+1).
assert.equal(decayValue(1000, cfg), 1000 - 51, "5% + flat 1 removed");

// --- diffusionDelivered(): threshold is strictly-greater (src <= threshold -> 0) ---
assert.equal(diffusionDelivered(100, 0, OPEN, cfg), 0, "src exactly at threshold does NOT diffuse");
assert.ok(diffusionDelivered(101, 0, OPEN, cfg) > 0, "src just above threshold diffuses");

// --- diffusionDelivered(): malus DIVIDES via 1/(1+malus) and is floored at 0 ---
const withMalus = diffusionDelivered(5000, 0, { ...OPEN, malus: 1 }, cfg);
const noMalus = diffusionDelivered(5000, 0, OPEN, cfg);
assert.ok(withMalus < noMalus, "a positive malus slows diffusion (rate/(1+malus))");
assert.ok(Math.abs(withMalus - noMalus / 2) < 1e-6, "malus 1 halves the effective rate");
// A negative malus is floored to 0 (Math.max(0,...)) -> same as no malus.
assert.equal(diffusionDelivered(5000, 0, { ...OPEN, malus: -1 }, cfg), noMalus,
  "negative malus floored to 0 (no speed-up)");

// --- diffusionDelivered(): the cap is a MIN of two products (maxPercent vs normalMax*maxFactor) ---
// With maxFactor huge, the maxPercent leg binds; the neighbour never exceeds src*maxPercent.
const bigFactor = diffusionDelivered(5000, 5000 * 0.75 - 1, { ...OPEN, maxFactor: 100 }, cfg);
assert.ok(bigFactor <= 1 + 1e-9, "maxPercent cap binds even with a huge maxFactor (Math.min)");
assert.equal(diffusionDelivered(5000, 5000 * 0.75, { ...OPEN, maxFactor: 100 }, cfg), 0,
  "at the maxPercent cap nothing more is delivered");
// normalMax*maxFactor multiplies: a bigger maxFactor lifts the (sub-maxPercent) cap.
const cap1 = diffusionDelivered(5000, 5000 * 0.4, { ...OPEN, maxFactor: 1 }, cfg);
const cap2 = diffusionDelivered(5000, 5000 * 0.4, { ...OPEN, maxFactor: 1.5 }, cfg);
assert.equal(cap1, 0, "at normalMax*1 cap, maxFactor 1 delivers nothing");
assert.ok(cap2 > 0, "maxFactor 1.5 raises the cap so there is still room (normalMax*maxFactor)");

// --- resolveOwner(): strongest-culture strict '>' and the flip guards ---
// strongestCulture uses v > value, so a tie keeps the FIRST-seen owner, not a later equal.
const tie = resolveOwner({ "0": 500, "1": 500 }, -1, [], cfg);
assert.equal(tie.owner, 0, "on a stock tie the strict '>' keeps the first owner (no late swap)");

// value > minimumOwner is strict: exactly at the floor does NOT acquire.
assert.equal(resolveOwner({ "0": 300 }, -1, [], cfg).flip, false, "value exactly at minimumOwner does not acquire");
assert.equal(resolveOwner({ "0": 301 }, -1, [], cfg).flip, true, "just above the floor acquires empty land");

// currentOwner < 0 is the acquire path; >= 0 requires the decisive ratio.
assert.equal(resolveOwner({ "0": 5000 }, 0, [], cfg).flip, false,
  "the incumbent holding the strongest culture never flips to itself");
// value*ratio > incumbent is strict.
const decisive = 500; // incumbent
const need = decisive / cfg.flipRatio; // value where value*ratio == incumbent exactly
assert.equal(resolveOwner({ "0": need, "1": decisive }, 1, [], cfg).flip, false,
  "value*ratio exactly equal to the incumbent does NOT flip (strict '>')");
assert.equal(resolveOwner({ "0": need + 100, "1": decisive }, 1, [], cfg).flip, true,
  "value*ratio decisively over the incumbent flips");

// incumbent culture is read from the tile for the CURRENT owner id specifically.
const inc = resolveOwner({ "0": 900, "5": 380 }, 5, [], cfg);
assert.equal(inc.incumbent, 380, "incumbent value is read for the current owner's civ id");

// incumbent read guard is 'currentOwner >= 0' (player 0 is a real owner, not "unowned").
// Owner 0 holds 900; challenger 1 has 950. 950*0.65 = 617.5 < 900, so it must NOT flip - which
// only holds if owner 0's incumbent culture (900) is actually read (>= 0, not > 0).
assert.equal(resolveOwner({ "0": 900, "1": 950 }, 0, [], cfg).flip, false,
  "player 0's incumbent culture is read (currentOwner >= 0), so a sub-ratio challenger does not flip");
assert.equal(resolveOwner({ "0": 900, "1": 950 }, 0, [], cfg).incumbent, 900,
  "player 0 incumbent value is read, not zeroed");
// An unowned tile (currentOwner -1) reports incumbent 0 - the ternary's else branch, never civMap["-1"].
assert.equal(resolveOwner({ "-1": 700, "0": 900 }, -1, [], cfg).incumbent, 0,
  "unowned tile -> incumbent 0 (the ':0' branch), not a stray civMap['-1'] read");

console.log("field-branches.mjs OK");
