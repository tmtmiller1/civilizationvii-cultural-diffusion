// tests/pressure-verdict.mjs: the pure read-only pressure helpers that drive the Cultural Pressure
// lens + hover tooltip (docs/potential-future-features.md section 1). These must agree with
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

// pressureVerdict: empty land
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

// pressureVerdict: owned land (the out-culture gate binds)
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

// pressureVerdict: leader is the owner => no pending shift
{
  const v = pressureVerdict({ "3": 900, "7": 100 }, 3, [], cfg);
  assert.equal(v.leader, 3, "owner also leads");
  assert.equal(v.progress, 0, "no pending shift when the owner leads");
  assert.equal(v.willFlip, false, "owner keeping its tile does not 'flip'");
}

// pressureVerdict: dead owners are ignored
{
  const v = pressureVerdict({ "9": 9999, "7": 350 }, -1, [9], cfg);
  assert.equal(v.leader, 7, "a dead civ's stock is skipped");
  assert.equal(v.willFlip, true, "the living leader clears the floor");
}

// estimateTurnsToFlip
{
  const open = { blocked: false, bonus: 0, malus: 0, maxFactor: 1 };
  // A patch of the plot (node 0) and held neighbours feeding it, one per [value, maxFactor].
  const patchOf = (...feeds) => ({
    nodes: [{ value: 0 }, ...feeds.map(([value, , threshold = 100]) => ({ value, threshold, fixed: true }))],
    links: feeds.map(([, maxFactor = 1], i) => ({ from: i + 1, to: 0, mods: { ...open, maxFactor } }))
  });
  const feed = (value, maxFactor = 1) => patchOf([value, maxFactor]);

  // Already decisive => 0 turns.
  const ready = pressureVerdict({ "7": 700, "3": 400 }, 3, [], cfg);
  assert.equal(estimateTurnsToFlip(ready, feed(700), cfg), 0, "a ready flip is 0 turns");

  // No pending flip => null.
  const none = pressureVerdict({ "3": 900 }, 3, [], cfg);
  assert.equal(estimateTurnsToFlip(none, feed(900), cfg), null, "no pending flip => null");

  // Growing: a strong neighbor feeds the tile, so it should flip in a finite, positive number of turns.
  const growing = pressureVerdict({ "5": 150 }, -1, [], cfg); // needs to reach 300
  const turns = estimateTurnsToFlip(growing, feed(6000), cfg);
  assert.ok(Number.isFinite(turns) && turns > 0, "a fed frontier tile flips in finite turns");

  // Stalled: no neighbor support, decay dominates => Infinity.
  assert.equal(estimateTurnsToFlip(growing, { nodes: [{ value: 150 }], links: [] }, cfg), Infinity,
    "no neighbor support => stalled (Infinity)");
  assert.equal(estimateTurnsToFlip(growing, patchOf([6000, 1, 7500]), cfg), Infinity,
    "a neighbour under its source threshold (a mountain) feeds nothing");

  // Levelling off: 2400 next door across a river onto a hill (step maxFactor 0.21) holds the tile at ~202, under the
  // 300 bar. The estimate has to say so, and agree turn by turn with the field's own step.
  const { diffusionDelivered, decayValue } = await import("/cultural-diffusion/ui/cd-field.js");
  let v = 0;
  for (let t = 0; t < 6; t++) { v = decayValue(v, cfg); v += diffusionDelivered(2400, v, { ...open, maxFactor: 0.21 }, cfg); }
  assert.ok(v > 195 && v < 210, `fixture: the field levels off at ${v}`);
  const levelled = pressureVerdict({ "5": v }, -1, [], cfg);
  assert.equal(estimateTurnsToFlip(levelled, feed(2400, 0.21), cfg), Infinity, "a tile levelled off under the bar is stalled");
  assert.equal(estimateTurnsToFlip(levelled, feed(2400, 1), cfg), 1, "...where open ground from the same neighbour flips next turn");

  // The projection matches the field step: count the field's own turns from 0 on open ground.
  let w = 0, fieldTurns = 0;
  while (w < 300) { w = decayValue(w, cfg); w += diffusionDelivered(1000, w, open, cfg); fieldTurns++; }
  assert.equal(estimateTurnsToFlip(pressureVerdict({ "5": 0.001 }, -1, [], cfg), feed(1000), cfg), fieldTurns,
    "the estimate counts the same turns the field takes");

  // The field takes the best cap among the neighbours: an open neighbour with less culture can still carry it over.
  const two = pressureVerdict({ "5": 200 }, -1, [], cfg);
  assert.equal(estimateTurnsToFlip(two, feed(2400, 0.21), cfg), Infinity, "fixture: one hill-across-river feed stalls");
  assert.ok(Number.isFinite(estimateTurnsToFlip(two, patchOf([2400, 0.21], [800, 1]), cfg)),
    "a second, open neighbour lifts it over");

  // A front still rising carries the plot over. The neighbour holds 200, whose cap alone would level the plot at 80;
  // a held 20000 behind it lifts the neighbour, and the neighbour the plot (the mountain at 35% in the 2026-10-29 lab
  // run read "stalled" one pass before it was claimed).
  const front = {
    nodes: [{ value: 0 }, { value: 200, threshold: 100 }, { value: 20000, threshold: 100, fixed: true }],
    links: [{ from: 1, to: 0, mods: open }, { from: 2, to: 1, mods: open }]
  };
  const behind = pressureVerdict({ "5": 80 }, -1, [], cfg);
  assert.equal(estimateTurnsToFlip(behind, { nodes: front.nodes.slice(0, 2).map((n) => ({ ...n, fixed: true })),
    links: front.links.slice(0, 1) }, cfg), Infinity, "fixture: with the neighbour held, the plot stalls");
  const carried = estimateTurnsToFlip(behind, front, cfg);
  assert.ok(Number.isFinite(carried) && carried > 1, `a rising front carries the plot over (${carried} turns)`);

  // A step opens once its source rises past the crossing gate. The neighbour holds 200, under a coast gate of 350, so
  // the plot gets nothing yet; a held 20000 behind it lifts it past the gate (coast tiles and a desert oasis read
  // "stalled" for 1-4 passes before flipping in the 2026-10-29 lab run, when the gate was read once at today's stock).
  const gated = {
    nodes: [{ value: 0 }, { value: 200, threshold: 100 }, { value: 20000, threshold: 100, fixed: true }],
    links: [{ from: 1, to: 0, mods: open, gate: 350 }, { from: 2, to: 1, mods: open }]
  };
  const shut = { nodes: gated.nodes.map((n) => ({ ...n, fixed: n.fixed || false })), links: gated.links.slice(0, 1) };
  shut.nodes[1] = { ...shut.nodes[1], fixed: true };
  assert.equal(estimateTurnsToFlip(behind, shut, cfg), Infinity, "fixture: a neighbour held under its gate feeds nothing");
  assert.equal(estimateTurnsToFlip(behind, { nodes: [{ value: 0 }, { value: 800, threshold: 100, fixed: true }],
    links: [{ from: 1, to: 0, mods: open, gate: 1000 }] }, cfg), Infinity,
  "a held 800 under a gate of 1000 feeds nothing, though its open cap (320) would clear the bar");
  const opened = estimateTurnsToFlip(behind, gated, cfg);
  assert.ok(Number.isFinite(opened) && opened > 1, `a neighbour rising past its gate carries the plot over (${opened} turns)`);

  // A held tile carries its rise. 2458 next door on desert (cap 0.3) levels the plot at 295, five under the bar, and
  // held still that's "stalled"; rising 60 a pass, as a border filling in behind the plot does, it lifts the plot
  // over ((63,10) in the 2026-10-29 lab run sat at 295 reading "stalled" and was claimed two passes later).
  const nearBar = pressureVerdict({ "5": 290 }, -1, [], cfg);
  const desert = { ...open, maxFactor: 0.3 };
  assert.equal(estimateTurnsToFlip(nearBar, { nodes: [{ value: 0 }, { value: 2458, threshold: 100, fixed: true }],
    links: [{ from: 1, to: 0, mods: desert }] }, cfg), Infinity, "fixture: held at 2458 the plot levels off under the bar");
  const lifted = estimateTurnsToFlip(nearBar, { nodes: [{ value: 0 }, { value: 2458, threshold: 100, fixed: true, rise: 60 }],
    links: [{ from: 1, to: 0, mods: desert }] }, cfg);
  assert.ok(Number.isFinite(lifted) && lifted >= 1 && lifted <= 5, `a feeder still rising carries it over (${lifted} turns)`);
  assert.equal(estimateTurnsToFlip(nearBar, { nodes: [{ value: 0 }, { value: 2458, threshold: 100, fixed: true, rise: -60 }],
    links: [{ from: 1, to: 0, mods: desert }] }, cfg), Infinity, "a feeder that fell is held, not carried down");

  // Null verdict guard.
  assert.equal(estimateTurnsToFlip(null, feed(100), cfg), null, "null verdict => null");
  assert.equal(estimateTurnsToFlip({ leader: -1 }, feed(100), cfg), null, "no leader => null");
}

// passCanAct: the lens, readout, pass and recede share one "can the pass act here" test
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
  assert.equal(passCanAct(ai, -1, me, false, { aiFlips: true }), true, "with AI flips on an AI leading unowned land flips");
  assert.equal(passCanAct(ai, me, me, false, { recede: true, aiFlips: false }), false, "object flags: recede alone still needs a claim");
  assert.equal(passCanAct(me, me, me, true, true), false, "the owner leading is no shift");
  assert.equal(passCanAct(-1, -1, me, false, true), false, "no leader is no shift");
}

console.log("pressure-verdict.mjs OK");
