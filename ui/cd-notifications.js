// cd-notifications.js
//
// Throttled player-facing toasts when a human gains or loses a border tile to culture. Best-effort: routed through
// the base game's notification/toast surface when available, and always mirrored to UI.log. Never throws into the
// pass. Settlement flips go to the notification train under their own types (notifySettlement). A notice for a
// hotseat seat that isn't at the screen waits for that seat's turn (deliverQueued).

import { dlog } from "/cultural-diffusion/ui/cd-log.js";
import { isHumanPlayer } from "/cultural-diffusion/ui/cd-plots.js";

const THROTTLE_TURNS = 1; // at most one toast per turn (flips are already capped per pass)
let _lastTurn = -999;
let _pendingThisTurn = 0;

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

/**
 * The text of a tag in the game's language, or the English fallback when it cannot be composed.
 * @param {string} tag @param {string} fb @returns {string}
 */
function localized(tag, fb) {
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      const s = Locale.compose(tag);
      if (typeof s === "string" && s && s !== tag && !s.startsWith("LOC_")) return s;
    }
  } catch (_) {
    /* ignore */
  }
  return fb;
}

function localId() {
  try {
    const id = typeof GameContext !== "undefined" ? GameContext.localPlayerID : -1;
    return typeof id === "number" ? id : -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Notices for a human who isn't at the screen (another hotseat seat): kept here until that seat's turn starts
 * (deliverQueued, from cd-bootstrap.js). A toast is one word per turn ("gained" or "lost"); a settlement notice is
 * the composed text. Lost on a reload, like the toasts themselves.
 * @type {Map<number, {toast:Set<string>, settlement:{kind:string, line:string, title:string}[]}>}
 */
const _queued = new Map();

/** @param {number} pid @returns {{toast:Set<string>, settlement:*[]}} That player's queue. */
function queueFor(pid) {
  if (!_queued.has(pid)) _queued.set(pid, { toast: new Set(), settlement: [] });
  return _queued.get(pid);
}

/** The toast for a tile the player at the screen gained or lost, one per turn. */
function toastOnce(gained) {
  const turn = gameTurn();
  if (turn !== _lastTurn) {
    _lastTurn = turn;
    _pendingThisTurn = 0;
  }
  _pendingThisTurn++;
  if (_pendingThisTurn === 1) {
    // First change of the turn: one summary toast.
    raiseToast(gained
      ? localized("LOC_CD_TOAST_GAINED", "Cultural Diffusion: your culture has claimed new territory.")
      : localized("LOC_CD_TOAST_LOST", "Cultural Diffusion: another civilization has taken one of your tiles."));
  }
}

/**
 * Notify that a plot changed hands. A human hears about a tile they gained and a tile they lost (to another
 * civilization's culture or its army): the player at the screen at once, another hotseat seat when its turn starts;
 * a change between two other civilizations is only logged. Coalesces multiple changes in the same turn into a
 * single throttled toast, but logs each individually.
 * @param {Object} args Flip.
 * @param {number} args.x Plot x. @param {number} args.y Plot y.
 * @param {number} args.wasOwner Previous owner id (-1 = unowned).
 * @param {number} args.newOwner New owner id.
 */
export function notifyFlip({ x, y, wasOwner, newOwner }) {
  dlog(`notify: (${x},${y}) ${wasOwner < 0 ? "unowned" : "player " + wasOwner} -> player ${newOwner}`);
  const me = localId();
  if (newOwner === me) return toastOnce(true);
  if (wasOwner === me && newOwner !== me) return toastOnce(false);
  // Another seat's gain or loss waits for that seat's turn.
  if (newOwner >= 0 && isHumanPlayer(newOwner)) queueFor(newOwner).toast.add("gained");
  if (wasOwner >= 0 && wasOwner !== newOwner && isHumanPlayer(wasOwner)) queueFor(wasOwner).toast.add("lost");
}

/**
 * Show a seat the notices that waited for its turn: one toast for land gained, one for land lost, then each
 * settlement notice. Called when that player's turn starts, with the player at the screen.
 * @param {number} pid The player now at the screen.
 * @returns {number} Notices delivered.
 */
export function deliverQueued(pid) {
  const q = _queued.get(pid);
  if (!q || pid !== localId()) return 0;
  _queued.delete(pid);
  let n = 0;
  for (const word of ["gained", "lost"]) {
    if (!q.toast.has(word)) continue;
    raiseToast(localized(word === "gained" ? "LOC_CD_TOAST_GAINED" : "LOC_CD_TOAST_LOST",
      word === "gained" ? "Cultural Diffusion: your culture has claimed new territory."
        : "Cultural Diffusion: another civilization has taken one of your tiles."));
    n++;
  }
  for (const s of q.settlement) if (sendSettlement(s.kind, s.line, s.title, pid)) n++;
  return n;
}

/** The notification types of a settlement flip (data/cd-city-flip-notifications.xml). */
const SETTLEMENT_TYPES = Object.freeze({ warn: "NOTIFICATION_CD_CITY_FLIP_WARN", joined: "NOTIFICATION_CD_CITY_FLIP" });

/**
 * Dismiss the live notification of a type for a player and return its text, so a new notice can carry it on.
 * @returns {string[]} The summaries of the notices dismissed.
 */
function takeLive(N, hash, me) {
  const out = [];
  for (const id of N.getIdsForPlayer(me) || []) {
    const n = N.find(id);
    if (!n || n.Type !== hash) continue;
    const text = typeof N.getSummary === "function" ? N.getSummary(id) : "";
    if (typeof text === "string" && text) out.push(text);
    N.dismiss(id);
  }
  return out;
}

/**
 * Tell the humans concerned about a settlement flip in the game's notification train: a settlement leaning toward
 * a neighbor ("warn") or one that has joined it ("joined"). The player at the screen gets it now; another hotseat
 * seat gets it when its turn starts (deliverQueued). The engine keeps one live notification per type and player and
 * drops a second (watched 2026-10-15), so a live one of the same kind is dismissed and its text carried into the new
 * one, a blank line apart. Both expire at the end of the turn. The text is already composed; it's also written to
 * the log.
 * @param {"warn"|"joined"} kind @param {string} line Composed text, [N] between lines. @param {string} title
 * @param {number[]} [to] The players to tell (default: the player at the screen). Only humans are told.
 * @returns {boolean} Whether a notification went out or was queued.
 */
export function notifySettlement(kind, line, title, to) {
  dlog(`notify (${kind}): ${String(line).replace(/\[N\]/g, " | ")}`);
  const me = localId();
  const targets = Array.isArray(to) ? to : [me];
  let any = false;
  for (const pid of new Set(targets)) {
    if (pid < 0 || !SETTLEMENT_TYPES[kind]) continue;
    if (pid === me) { if (sendSettlement(kind, line, title, me)) any = true; continue; }
    if (!isHumanPlayer(pid)) continue;
    queueFor(pid).settlement.push({ kind, line, title });
    any = true;
  }
  return any;
}

/** Send one settlement notification to a player's train now. @returns {boolean} Whether it went out. */
function sendSettlement(kind, line, title, me) {
  const type = SETTLEMENT_TYPES[kind];
  if (me < 0 || !type) return false;
  try {
    const g = /** @type {*} */ (globalThis);
    const N = g.Game && g.Game.Notifications;
    if (!N || typeof N.send !== "function") return false;
    const hash = g.Game.getHash(type);
    const earlier = typeof N.dismiss === "function" ? takeLive(N, hash, me) : [];
    N.send({ Type: hash, Message: title, Summary: earlier.concat(line).join("[N][N]") }, me);
    return true;
  } catch (_) {
    return false;
  }
}

export const __test = { THROTTLE_TURNS };
