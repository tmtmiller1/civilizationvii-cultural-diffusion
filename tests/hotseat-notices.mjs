// tests/hotseat-notices.mjs: notices for a human who isn't at the screen (another hotseat seat) wait for that seat's
// turn; the player at the screen is told at once. Off-engine, so this covers the queue, not the game's toast surface.
import assert from "node:assert/strict";

const ME = 0, SEAT1 = 1, AI = 3;
let localId = ME;
const toasts = [];
const sent = [];
globalThis.GameContext = { get localPlayerID() { return localId; } };
globalThis.Players = { get: (pid) => ({ id: pid, isHuman: pid === ME || pid === SEAT1 }) };
globalThis.Game = {
  turn: 10,
  getHash: (s) => s,
  Notifications: { send: (n, pid) => { sent.push({ pid, type: n.Type, summary: n.Summary }); }, getIdsForPlayer: () => [], find: () => null, dismiss: () => {} }
};
globalThis.UI = { sendNotification: (text) => { toasts.push(text); } };
globalThis.Locale = { compose: (tag) => tag };

const { notifyFlip, notifySettlement, deliverQueued } = await import("/cultural-diffusion/ui/cd-notifications.js");

// A tile seat 0 gains is a toast at once; one seat 1 gains or loses waits.
notifyFlip({ x: 1, y: 1, wasOwner: -1, newOwner: ME });
assert.equal(toasts.length, 1, "the player at the screen is told at once");
notifyFlip({ x: 2, y: 1, wasOwner: -1, newOwner: SEAT1 });
notifyFlip({ x: 3, y: 1, wasOwner: SEAT1, newOwner: AI });
notifyFlip({ x: 4, y: 1, wasOwner: AI, newOwner: -1 });
assert.equal(toasts.length, 1, "another seat's gain and loss, and a change between others, raise nothing now");
assert.equal(deliverQueued(SEAT1), 0, "seat 1's notices stay queued while seat 0 is at the screen");

// A settlement notice to both sides: seat 0 now, seat 1 later, an AI never.
notifySettlement("warn", "LINE", "TITLE", [SEAT1, ME, AI]);
assert.deepEqual(sent.map((s) => s.pid), [ME], "the settlement notice reaches the seat at the screen now");

// Seat 1's turn: its toasts (one per kind) and its settlement notice.
localId = SEAT1;
assert.equal(deliverQueued(SEAT1), 3, "seat 1's turn delivers two toasts and the settlement notice");
assert.equal(toasts.length, 3, "...the toasts are on screen");
assert.deepEqual(sent.map((s) => s.pid), [ME, SEAT1], "...and the notice is in seat 1's train");
assert.equal(deliverQueued(SEAT1), 0, "delivered once");
console.log("hotseat-notices.mjs OK");
