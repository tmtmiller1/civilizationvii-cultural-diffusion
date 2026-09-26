// cd-flip.js
//
// The COMMIT half of a culture flip, shared by the local player's flips (cd-pass.js) and the AI's (cd-ai-flips.js):
// the per-city claim budget, the eligibility gates that sit on top of cd-eligibility's shared ones, and the
// bookkeeping that follows the integrated verb (pending when the write has not landed, else claim + lock + seed +
// notification). Written in terms of a claimant `me`, which is the local player or the culture leader. No import
// from cd-pass.js.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { claimGateBlocked } from "/cultural-diffusion/ui/cd-eligibility.js";
import { performFlip } from "/cultural-diffusion/ui/cd-ownership.js";
import { markPending } from "/cultural-diffusion/ui/cd-pending.js";
import { notifyFlip } from "/cultural-diffusion/ui/cd-notifications.js";

/** Current per-city claim counts for a claimant (enforces maxDiffusionPlots). */
export function claimCountsFor(state, me) {
  /** @type {Map<number, number>} */
  const claimCount = new Map();
  const bump = (city) => claimCount.set(city, (claimCount.get(city) || 0) + 1);
  for (const c of Object.values(state.claims)) {
    if (c && c.by === me) bump(c.city);
  }
  // A claim still landing (cd-pending.js) spends the budget too, so a city can't over-claim mid-write.
  for (const p of Object.values(state.pending || {})) {
    if (p && p.kind === "claim" && p.by === me) bump(p.city);
  }
  return claimCount;
}

/**
 * Whether a won tile passes every eligibility gate (safety mode, war, core protection,
 * adjacency, per-city cap). Kept as pure predicates so the flip loop stays flat.
 */
export function flipEligible(cand, owner, me, claimCount, inFlight) {
  const { k, near } = cand;
  // Every gate except the per-city cap is shared with the lens and the hover readout (cd-eligibility.js),
  // so what the map promises and what the pass does cannot drift.
  const blocked = claimGateBlocked(cand.loc, owner, me, CONFIG, inFlight);
  if (blocked) {
    if (blocked === "would-strand-a-unit") dlog(`skip flip ${k}: would strand a foreign unit`);
    return false;
  }
  if ((claimCount.get(near.id) || 0) >= Math.max(0, CONFIG.maxDiffusionPlots)) {
    dlog(`skip flip ${k}: city ${near.id} at maxDiffusionPlots`);
    return false;
  }
  return true;
}

/** Commit a single won+eligible flip, recording claim/lock bookkeeping and a seed stock. */
export function commitFlip(cand, owner, verdict, fx) {
  const { state, next, me, ageCfg, claimCount } = fx;
  const { k, loc, near } = cand;
  const res = performFlip({ playerId: me, city: near.city, loc, verb: CONFIG.flipVerb, refund: CONFIG.refundGold });
  // Verify the tile actually changed owner before booking anything: performFlip only reports
  // "didn't throw", and a silent no-op would otherwise spend the city's budget, lock the tile,
  // seed a phantom stock and fire a false toast.
  if (!res.ok) {
    dlog(`flip ${k} NOT APPLIED reason=${res.reason || "call-failed"} verb=${res.verb}`);
    return false;
  }
  if (ownerAt(loc) !== me) {
    // The engine applies ownership AFTER the call, so the same-tick read is still the old owner. Book it
    // next pass from the live map (cd-pending.js); it counts toward the budget and cap immediately.
    markPending(state, k, { kind: "claim", by: me, city: near.id, was: owner });
    claimCount.set(near.id, (claimCount.get(near.id) || 0) + 1);
    dlog(`flip ${k} -> player ${me} via ${res.verb} sent; pending confirmation next pass (was owner ${owner})`);
    return "pending";
  }
  claimCount.set(near.id, (claimCount.get(near.id) || 0) + 1);
  state.claims[k] = { by: me, city: near.id, turn: state.monoTurn };
  state.locked[k] = Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
  // seed a stable stock so the tile doesn't immediately fail the ownership test
  next[k][String(me)] = Math.max(next[k][String(me)] || 0, ageCfg.minimumOwner);
  dlog(`flip ${k} -> player ${me} via ${res.verb} (was owner ${owner}, culture ${Math.round(verdict.value)})`);
  notifyFlip({ x: loc.x, y: loc.y, wasOwner: owner, newOwner: me });
  return "booked";
}

