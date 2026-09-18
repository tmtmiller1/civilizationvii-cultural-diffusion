// tests/pressure-verdict.mjs - the pure read-only pressure helpers that drive the Cultural Pressure
// lens + hover tooltip (docs/potential-future-features.md section 1). These MUST agree with
// resolveOwner's flip gates, so they are tested against the same constants and cross-checked.
import assert from "node:assert/strict";
import {
  resolveOwner, pressureVerdict, estimateTurnsToFlip, passCanAct
} from "/cultural-diffusion/ui/cd-field.js";

const cfg = {
  minimumOwner: 300, flipRatio: 0.65,
  // (used by estimateTurnsToFlip via diffusionDelivered / decayValue)
  diffusionRate: 0.055, cultureThreshold: 100, normalMax: 0.4, maxPercent: 0.75,
  decayRate: 0.05, decayFlat: 1
};

// -- pressureVerdict: empty land ------------------------------------------------------------------
{
  // A leader below the floor: some progress, no flip.
  const v = pressureVerdict({ "5": 150 }, -1, [], cfg);
  assert.equal(v.leader, 5, "leader is the strongest culture");
  assert.equal(v.incumbentOwner, -1, "unowned");
  assert.equal(v.target, 300, "empty-land target is minimumOwner");
  assert.ok(Math.abs(v.progress - 0.5) < 1e-9, "150/300 = 50% progress");
  assert.equal(v.willFlip, false, "below the floor: no flip yet");

  // Over the floor: flips, progress clamps to 1.
  const v2 = pressureVerdict({ "5": 350 }, -1, [], cfg);
  assert.equal(v2.willFlip, true, "over the floor on empty land: flips");
  assert.equal(v2.progress, 1, "progress clamps to 1");
  // Cross-check against resolveOwner.
  assert.equal(resolveOwner({ "5": 350 }, -1, [], cfg).flip, v2.willFlip, "matches resolveOwner (empty)");
}

// -- pressureVerdict: owned land (the out-culture gate binds) --------------------------------------
{
  // Leader 500 vs incumbent 400: needs value*0.65 > 400 => value > ~615. target = 400/0.65 ~= 615.4.
  const civMap = { "7": 500, "3": 400 };
  const v = pressureVerdict(civMap, 3, [], cfg);
  assert.equal(v.leader, 7, "challenger leads on stock");
  assert.equal(v.incumbent, 400, "incumbent stock read from the owner id");
  assert.ok(Math.abs(v.target - 400 / 0.65) < 1e-6, "owned target is incumbent/flipRatio");
  assert.ok(v.progress > 0.8 && v.progress < 1, "close but not yet decisive");
  assert.equal(v.willFlip, false, "500*0.65=325 < 400: not decisive, no flip");
  assert.equal(resolveOwner(civMap, 3, [], cfg).flip, false, "matches resolveOwner (not decisive)");

  // Push the challenger over the decisive bar.
  const civMap2 = { "7": 700, "3": 400 };
  const v2 = pressureVerdict(civMap2, 3, [], cfg);
  assert.equal(v2.willFlip, true, "700*0.65=455 > 400: decisive flip");
  assert.equal(v2.progress, 1, "progress saturates at a ready flip");
  assert.equal(resolveOwner(civMap2, 3, [], cfg).flip, true, "matches resolveOwner (decisive)");
}

// -- pressureVerdict: leader IS the owner => no pending shift --------------------------------------
{
  const v = pressureVerdict({ "3": 900, "7": 100 }, 3, [], cfg);
  assert.equal(v.leader, 3, "owner also leads");
  assert.equal(v.progress, 0, "no pending shift when the owner leads");
  assert.equal(v.willFlip, false, "owner keeping its tile does not 'flip'");
}

// -- pressureVerdict: dead owners are ignored -----------------------------------------------------
{
  const v = pressureVerdict({ "9": 9999, "7": 350 }, -1, [9], cfg);
  assert.equal(v.leader, 7, "a dead civ's stock is skipped");
  assert.equal(v.willFlip, true, "the living leader clears the floor");
}

// -- estimateTurnsToFlip --------------------------------------------------------------------------
{
  // Already decisive => 0 turns.
  const ready = pressureVerdict({ "7": 700, "3": 400 }, 3, [], cfg);
  assert.equal(estimateTurnsToFlip(ready, 700, cfg), 0, "a ready flip is 0 turns");

  // No pending flip => null.
  const none = pressureVerdict({ "3": 900 }, 3, [], cfg);
  assert.equal(estimateTurnsToFlip(none, 900, cfg), null, "no pending flip => null");

  // Growing: a strong neighbour feeds the tile, so it should flip in a finite, positive number of turns.
  const growing = pressureVerdict({ "5": 150 }, -1, [], cfg); // needs to reach 300
  const turns = estimateTurnsToFlip(growing, 6000, cfg);      // strong neighbour delivering culture
  assert.ok(Number.isFinite(turns) && turns > 0, "a fed frontier tile flips in finite turns");

  // Stalled: no neighbour support, decay dominates => Infinity.
  const stalled = estimateTurnsToFlip(growing, 0, cfg);
  assert.equal(stalled, Infinity, "no neighbour support => stalled (Infinity)");

  // Null verdict guard.
  assert.equal(estimateTurnsToFlip(null, 100, cfg), null, "null verdict => null");
  assert.equal(estimateTurnsToFlip({ leader: -1 }, 100, cfg), null, "no leader => null");
}

// -- passCanAct: the lens, readout, pass and recede share one "can the pass act here" test ---------------
{
  const me = 0;
  const ai = 3;
  assert.equal(passCanAct(me, -1, me, false, false), true, "our culture leading on unowned land is claimable");
  assert.equal(passCanAct(me, ai, me, false, false), true, "our culture leading on rival land is claimable");
  assert.equal(passCanAct(ai, -1, me, false, true), false, "an AI leading on unowned land never flips (run 10: 84,24)");
  assert.equal(passCanAct(ai, 5, me, false, true), false, "rival-to-rival flips are never made");
  assert.equal(passCanAct(ai, me, me, true, false), false, "a claimed tile never recedes with recede off");
  assert.equal(passCanAct(ai, me, me, false, true), false, "a tile the base game grew never recedes");
  assert.equal(passCanAct(ai, me, me, true, true), true, "with recede on a rival can win back a claimed tile");
  assert.equal(passCanAct(me, me, me, true, true), false, "the owner leading is no shift");
  assert.equal(passCanAct(-1, -1, me, false, true), false, "no leader is no shift");
}

console.log("pressure-verdict.mjs OK");
