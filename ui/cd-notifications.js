// cd-notifications.js
//
// Throttled player-facing toasts when the local player gains a border tile to
// culture. Best-effort: routed through the base game's notification/toast surface
// when available, and always mirrored to UI.log. Never throws into the pass.

import { dlog } from "/cultural-diffusion/ui/cd-log.js";

const THROTTLE_TURNS = 1; // at most one toast per turn (flips are already capped per pass)
let _lastTurn = -999;
let _pendingThisTurn = 0;

/** @returns {number} Game.turn or 0. */
function gameTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Raise a best-effort toast/notification, degrading silently when no surface is
 * available.
 * @param {string} text The message.
 */
function raiseToast(text) {
  try {
    const g = /** @type {*} */ (globalThis);
    // Preferred: the mod-friendly toast bus if present.
    if (g.Sound && typeof g.Sound.OnUISound === "function") {
      /* purely cosmetic; ignore result */
    }
    if (typeof g.UI !== "undefined" && g.UI.sendNotification && typeof g.UI.sendNotification === "function") {
      g.UI.sendNotification(text);
      return;
    }
    if (g.engine && typeof g.engine.trigger === "function") {
      g.engine.trigger("CulturalDiffusionToast", { text });
    }
  } catch (_) {
    /* ignore */
  }
}

/** @returns {number} The local player id, or -1. */
function localId() {
  try {
    const id = typeof GameContext !== "undefined" ? GameContext.localPlayerID : -1;
    return typeof id === "number" ? id : -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Notify that a plot changed hands. The local player hears about a tile they GAINED and a tile they LOST (to
 * another civilization's culture or its army); a change between two other civilizations is only logged.
 * Coalesces multiple changes in the same turn into a single throttled toast, but logs each individually.
 * @param {Object} args Flip.
 * @param {number} args.x Plot x. @param {number} args.y Plot y.
 * @param {number} args.wasOwner Previous owner id (-1 = unowned).
 * @param {number} args.newOwner New owner id.
 */
export function notifyFlip({ x, y, wasOwner, newOwner }) {
  dlog(`notify: (${x},${y}) ${wasOwner < 0 ? "unowned" : "player " + wasOwner} -> player ${newOwner}`);
  const me = localId();
  const gained = newOwner === me;
  const lost = wasOwner === me && newOwner !== me;
  if (!gained && !lost) return; // between two other civilizations: the player is not told
  const turn = gameTurn();
  if (turn !== _lastTurn) {
    _lastTurn = turn;
    _pendingThisTurn = 0;
  }
  _pendingThisTurn++;
  if (_pendingThisTurn === 1) {
    // First change of the turn - one summary toast.
    raiseToast(gained
      ? "Cultural Diffusion: your culture has claimed new territory."
      : "Cultural Diffusion: another civilization has taken one of your tiles.");
  }
}

export const __test = { THROTTLE_TURNS };
