// cd-pending.js
//
// Ownership writes land AFTER the call returns. Watched in-game on game 1.4.2 (devtools/harness run 1): after
// city.purchasePlot - our city on unowned land, our city on a rival's tile, and a rival's city on ours - the owner
// read on the same tick still showed the OLD owner, and the new owner appeared ~3s later. The pass used to book a
// flip only on that same-tick read, so every real flip was logged "NOT APPLIED": no claim, no cooldown lock, no
// per-city budget, no maxFlipsPerTurn count, and the recede step never saw the tile.
//
// This module is the deferred half of the fix. A verb whose same-tick read does not yet show the result is
// recorded as PENDING; the next pass confirms every pending entry from the live map before anything else runs.
//   claim   - we asked for the tile (diffusion flip, +1 buffer, orphan re-integration): confirmed when owner === by
//   cede    - a rival's city was asked to take our claimed tile: confirmed when owner === by (that rival)
// (There is no release kind: setOwnership(NO_PLAYER) never un-owns a city-attached tile on 1.4.2.)
// A pending tile is skipped by every candidate scan until it resolves. An entry the live map does not confirm is
// dropped, so the tile is retried later exactly as a failed verb always was.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { notifyFlip } from "/cultural-diffusion/ui/cd-notifications.js";

/** @param {string} k Plot key. @returns {{x:number,y:number}} Location. */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/** @returns {number} The cooldown a confirmed ownership change is locked for. */
function cooldown() {
  return Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
}

/**
 * Record an ownership verb whose result has not landed yet.
 * @param {*} state Persisted state (mutated).
 * @param {string} k Plot key.
 * @param {{kind:"claim"|"cede", by:number, city?:number, was?:number}} entry What was asked for.
 */
export function markPending(state, k, entry) {
  if (!state.pending) state.pending = {};
  state.pending[k] = {
    kind: entry.kind,
    by: entry.by,
    city: entry.city != null ? entry.city : -1,
    turn: state.monoTurn || 0,
    was: entry.was != null ? entry.was : -1
  };
}

/**
 * @param {*} state Persisted state. @param {string} k Plot key.
 * @returns {boolean} Whether an ownership verb on k is still unresolved.
 */
export function isPending(state, k) {
  return !!(state && state.pending && state.pending[k]);
}

/**
 * Apply one pending entry if the live map shows its result.
 * @returns {string|null} The confirmed kind, or null when the map does not show it.
 */
function confirmOne(state, k, p) {
  const loc = unkey(k);
  const owner = ownerAt(loc);
  if (p.kind === "claim") {
    if (owner !== p.by) return null;
    state.claims[k] = { by: p.by, city: p.city, turn: p.turn };
    state.locked[k] = cooldown();
    notifyFlip({ x: loc.x, y: loc.y, wasOwner: p.was, newOwner: p.by });
    return "claim";
  }
  if (p.kind !== "cede" || owner !== p.by) return null;
  delete state.claims[k];
  state.locked[k] = cooldown();
  return p.kind;
}

/**
 * Confirm or drop every pending entry against the live map. Call at the start of a pass.
 * @param {*} state Persisted state (mutated: claims/locked updated, pending emptied).
 * @returns {{claim:number, cede:number, dropped:number}} What resolved.
 */
export function confirmPending(state) {
  const out = { claim: 0, cede: 0, dropped: 0 };
  const pending = state.pending || {};
  for (const k of Object.keys(pending)) {
    const p = pending[k];
    const kind = confirmOne(state, k, p);
    if (kind) {
      out[kind]++;
      dlog(`pending ${k} ${p.kind} confirmed on the live map`);
    } else {
      out.dropped++;
      dlog(`pending ${k} ${p.kind} NOT APPLIED on the live map - dropped`);
    }
  }
  state.pending = {};
  return out;
}
