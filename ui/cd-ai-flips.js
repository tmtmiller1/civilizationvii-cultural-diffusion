// cd-ai-flips.js
//
// Every civilization gains land by culture (opt-in, CONFIG.aiCultureFlips; docs/civ-v-parity-spec.md §2). Inside the
// simulated region, a tile whose culture leader is a living MAJOR other than the local player and other than its
// owner flips to that leader through the leader's nearest city, under exactly the gates our own flips pass (peace
// with the incumbent, the incumbent's core protection, adjacency to the leader's land, flipMaxDistance from one of
// the leader's cities, the strand guard, the leader's per-city cap) and with the same commit (cd-flip.js). The
// leader's own natural ring is left to the base game, as ours is. Independent Powers and city-states never lead a
// flip. Watched 2026-09-25: a rival city's purchasePlot lands like ours and charges nothing.
//
// Only tiles within the field region can move, so AI-versus-AI borders far from the player stay as the base game
// leaves them; that asymmetry is documented in the README. No import from cd-pass.js.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { resolveOwner, passCanAct } from "/cultural-diffusion/ui/cd-field.js";
import { isMajorPlayer } from "/cultural-diffusion/ui/cd-borders.js";
import { cityListOf, nearestCity, withinOwnNaturalRing } from "/cultural-diffusion/ui/cd-eligibility.js";
import { isPending, pendingClaimKeys } from "/cultural-diffusion/ui/cd-pending.js";
import { claimCountsFor, flipEligible, commitFlip } from "/cultural-diffusion/ui/cd-flip.js";

/** @param {string} k Plot key. @returns {{x:number,y:number}} Location. */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/**
 * One region tile as an AI flip candidate, or null: its culture leader must be a living MAJOR other than us and
 * other than its owner, the tile outside that leader's own natural ring and within flipMaxDistance of one of the
 * leader's cities. Independent Powers and city-states never lead a flip.
 */
function aiCandidateAt(k, p, cityList) {
  const { state, next, me, ageCfg, deadOwners } = p;
  if (!next[k] || state.locked[k] > 0 || isPending(state, k)) return null;
  const loc = unkey(k);
  const owner = ownerAt(loc);
  const verdict = resolveOwner(next[k], owner, deadOwners, ageCfg);
  const leader = verdict.owner;
  if (!verdict.flip || leader === me || !isMajorPlayer(leader)) return null;
  if (!passCanAct(leader, owner, me, false, { aiFlips: true })) return null;
  return placeForLeader({ k, loc, owner, leader, verdict }, cityList(leader));
}

/** Attach a candidate to the leader's nearest city, or drop it (inside the leader's natural ring, or too far). */
function placeForLeader(cand, cities) {
  if (!cities.length || withinOwnNaturalRing(cand.loc, cities)) return null; // the base game grows the inner rings
  const near = nearestCity(cand.loc, cities);
  if (!near || near.d > Math.max(1, CONFIG.flipMaxDistance)) return null;
  return { ...cand, near };
}

/** Every AI flip candidate in the region, sorted nearest to its leader's city first. */
function aiFlipCandidates(p, cityList) {
  const out = [];
  for (const k of p.region) {
    const cand = aiCandidateAt(k, p, cityList);
    if (cand) out.push(cand);
  }
  out.sort((a, b) => a.near.d - b.near.d);
  return out;
}

/**
 * Every civilization gains land by culture (opt-in, aiCultureFlips; docs/civ-v-parity-spec.md §2): the same gates
 * and the same commit as our own flips, with the culture LEADER as the claimant. The leader's per-city cap and
 * in-flight claims are tracked per leader; the per-pass ceiling is the AI's own, so neither side starves the other.
 * @returns {{flips:number, pending:number}} AI flips booked now and sent awaiting the map.
 */
export function resolveAiOwnership(p) {
  const { state, next, ageCfg } = p;
  const maxFlips = Math.max(0, CONFIG.maxFlipsPerTurn);
  /** @type {Map<number, *>} */
  const cityLists = new Map();
  const cityList = (pid) => {
    if (!cityLists.has(pid)) cityLists.set(pid, cityListOf(pid));
    return cityLists.get(pid);
  };
  /** @type {Map<number, {claimCount:Map<number,number>, inFlight:Set<string>}>} */
  const perLeader = new Map();
  const bookFor = (pid) => {
    if (!perLeader.has(pid)) {
      perLeader.set(pid, { claimCount: claimCountsFor(state, pid), inFlight: pendingClaimKeys(state, pid) });
    }
    return perLeader.get(pid);
  };
  let flips = 0;
  let pending = 0;
  for (const cand of aiFlipCandidates(p, cityList)) {
    if (flips + pending >= maxFlips) break;
    const books = bookFor(cand.leader);
    if (!flipEligible(cand, cand.owner, cand.leader, books.claimCount, books.inFlight)) continue;
    const fx = { state, next, me: cand.leader, ageCfg, claimCount: books.claimCount };
    const result = commitFlip(cand, cand.owner, cand.verdict, fx);
    if (result) books.inFlight.add(cand.k);
    if (result === "booked") flips++;
    else if (result === "pending") pending++;
  }
  return { flips, pending };
}

