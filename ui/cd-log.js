// cd-log.js
//
// Minimal debug logger for the Cultural Diffusion mod. Mod `console.log` does not
// reach the game's UI.log, but `console.error` does (via the GameFace CSS-parse
// channel), so every line is emitted with a stable `[CulturalDiffusion]` prefix.
// Grep it in:
//   ~/Library/Application Support/Civilization VII/Logs/UI.log

const PREFIX = "[CulturalDiffusion]";

/** @type {boolean} Verbose gate; flipped on by cd-config's debug flag at boot. */
let _debug = false;

/**
 * Enable/disable verbose logging.
 * @param {boolean} on Whether to log debug lines.
 */
export function setDebug(on) {
  _debug = !!on;
}

/**
 * Emit one debug line (only when debug logging is enabled).
 * @param {string} msg The message.
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
 * Emit one line unconditionally (used for boot + errors that should always show).
 * @param {string} msg The message.
 */
export function log(msg) {
  try {
    console.error(`${PREFIX} ${msg}`);
  } catch (_) {
    /* ignore */
  }
}
