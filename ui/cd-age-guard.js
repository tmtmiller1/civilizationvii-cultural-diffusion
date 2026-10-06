// cd-age-guard.js
//
// Keeps tiles that carry a district (a rural improvement, an urban district or a wonder) from changing hands while an
// age's end countdown runs and in the first two turns of the next age. Unimproved tiles are not affected, and nothing
// changes the rest of the time.
//
// Why: moving an owned district tile to another civilization in that window crashed the game natively, on the AI's
// AsyncWorker1 thread, reading a null object through an id list that no longer resolved (watched 2026-10-05/06 on
// 1.5.0: a soak of the shipped mod crashed in the new age's setup right after flips on the last Antiquity turns, and a
// mod-free run crashed 0.5 s after moving 12 district tiles on the first turn of the new age). The same moves of tiles
// with no district, at the same moment, did not crash, and district tiles moved mid-age never did (over 300 moves).
// Leaf module: it imports only cd-plots and cd-polity, so every flip path can use it without an import cycle.

import { districtTypeNameAt } from "/cultural-diffusion/ui/cd-plots.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";

/** Turns after a transition in which district tiles still hold: the first two of the new age. */
export const TRANSITION_GUARD_TURNS = 2;

/**
 * Pure: whether an age-transition window is open: for the whole of the age's end countdown, and the first turns of
 * the next age.
 *
 * The whole countdown, not only its last turns: the countdown's "turns left" is progression points, and one turn can
 * add 5, 10 or 20 at once (legacy milestones; 10 for each Future Tech or Civic, AgeProgressionEvents), so the age can
 * end on a turn that read several points from the end.
 * @param {{countdownStarted:boolean, ageOver:boolean, turnsRemaining:number|null, ageKey:string, turn:number}} a
 *   The age reads: the base game's countdown flag, its age-over flag, the countdown's points left (max progression
 *   points minus current, as the base game's age warning computes it; logged, not decided on), the age key and
 *   Game.turn.
 * @param {number} [n] Turns after a transition that still hold.
 * @returns {boolean} True inside the window.
 */
export function transitionWindowOpen(a, n = TRANSITION_GUARD_TURNS) {
  if (!a) return false;
  if (a.ageOver || a.countdownStarted) return true;
  // A new age restarts Game.turn at 1. Antiquity has no transition before it.
  return a.ageKey !== "ANTIQUITY" && typeof a.turn === "number" && a.turn >= 1 && a.turn <= n;
}

/** @param {()=>*} fn Thunk. @param {*} fallback @returns {*} fn() or fallback. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @returns {{countdownStarted:boolean, ageOver:boolean, turnsRemaining:number|null, ageKey:string, turn:number}} */
function readAge() {
  const m = safe(() => Game.AgeProgressManager, null);
  const countdownStarted = !!safe(() => m && m.ageCountdownStarted, false);
  const turnsRemaining = safe(() => {
    if (!m) return null;
    const max = m.getMaxAgeProgressionPoints();
    const cur = m.getCurrentAgeProgressionPoints();
    return typeof max === "number" && typeof cur === "number" ? max - cur : null;
  }, null);
  return {
    countdownStarted,
    ageOver: !!safe(() => m && m.isAgeOver, false),
    turnsRemaining,
    ageKey: currentAgeKey(),
    turn: safe(() => (typeof Game.turn === "number" ? Game.turn : -1), -1)
  };
}

/**
 * Whether moving this owned tile must wait: an age-transition window is open and the tile carries a district.
 * @param {{x:number,y:number}} loc Plot.
 * @param {number} owner Current owner (-1 = unowned; unowned land never carries a city's district).
 * @returns {boolean} True when the tile must not change hands this turn.
 */
export function districtTransferPaused(loc, owner) {
  if (typeof owner !== "number" || owner < 0) return false;
  if (!transitionWindowOpen(readAge())) return false;
  return !!districtTypeNameAt(loc);
}
