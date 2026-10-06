// cd-log.js
//
// Debug logger. A mod's `console.log` does not reach the game's UI.log, but
// `console.error` does (via the GameFace CSS-parse channel), so every line goes out
// that way with a `[CulturalDiffusion]` prefix. Grep for it in:
//   ~/Library/Application Support/Civilization VII/Logs/UI.log

const PREFIX = "[CulturalDiffusion]";

/** @type {boolean} Verbose gate; flipped on by cd-config's debug flag at boot. */
let _debug = false;

/** @param {boolean} on */
export function setDebug(on) {
  _debug = !!on;
}

/**
 * One line, only when debug logging is on.
 * @param {string} msg
 */
export function dlog(msg) {
  if (!_debug) return;
  try {
    console.error(`${PREFIX} ${msg}`);
  } catch (_) {
    /* ignore */
  }
}

/**
 * One line whatever the debug flag says: boot and errors.
 * @param {string} msg
 */
export function log(msg) {
  try {
    console.error(`${PREFIX} ${msg}`);
  } catch (_) {
    /* ignore */
  }
}
