// cd-bootstrap.js - game scope.
//
// Boot the Cultural Diffusion engine: run one diffusion pass per local-player turn
// (honoring CONFIG.turnInterval), refresh settings from the Options screen before
// each pass, and expose a small console surface for tuning/inspection. All engine
// wiring is defensive so a missing API never aborts the load.
//
// Results reach UI.log under the [CulturalDiffusion] prefix.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { setDebug as setLogDebug, log, dlog } from "/cultural-diffusion/ui/cd-log.js";
import { applyTunableOverrides } from "/cultural-diffusion/ui/cd-settings.js";
import { runPass } from "/cultural-diffusion/ui/cd-pass.js";
import { loadState, saveState } from "/cultural-diffusion/ui/cd-state.js";

let _lastLocalTurnRun = -999;

// Engine-subscription hygiene (shared-bus good citizenship): keep a handle to our own
// PlayerTurnActivated listener so a re-boot - e.g. a save/reload re-running this script -
// can drain the previous subscription instead of stacking a second handler on the engine
// event bus that every mod shares.
/** @type {((data:*)=>void)|null} */
let _turnHandlerRef = null;

// Kill switch: if our per-turn pass throws repeatedly, unsubscribe so a broken build stops
// running - and stops spamming errors - on every turn for the rest of the session.
let _passErrors = 0;
const KILL_THRESHOLD = 3;

/** Drain our own engine subscription. Idempotent; safe to call any time. */
function teardown() {
  try {
    const eng = typeof engine !== "undefined" ? engine : null;
    if (eng && typeof eng.off === "function" && _turnHandlerRef) {
      eng.off("PlayerTurnActivated", _turnHandlerRef);
    }
  } catch (_) {
    /* ignore */
  }
  _turnHandlerRef = null;
}

/** @returns {number} Game.turn or 0. */
function gameTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : 0;
  } catch (_) {
    return 0;
  }
}

/** @returns {number} The local player id, or -1. */
function localId() {
  try {
    const id = GameContext?.localPlayerID;
    return typeof id === "number" ? id : -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Run one pass, refreshing options first. Safe to call any time.
 * @param {string} why Trigger label (for the log).
 * @returns {{flips:number, considered:number}} Pass summary.
 */
function doPass(why) {
  try {
    applyTunableOverrides();
    setLogDebug(!!CONFIG.debug);
    const res = runPass();
    _passErrors = 0;
    dlog(`pass (${why}): flips=${res.flips} field tiles=${res.tiles}`);
    return res;
  } catch (e) {
    log(`doPass threw ${String(e)}`);
    if (++_passErrors >= KILL_THRESHOLD) {
      teardown();
      log(`disabled after ${KILL_THRESHOLD} consecutive pass errors - unsubscribed to stay a good citizen; use culturalDiffusion.runNow() to retry`);
    }
    return { flips: 0, considered: 0 };
  }
}

/**
 * PlayerTurnActivated handler: run the pass once per local-player turn.
 * @param {*} data Event payload (carries the activating player).
 */
function onTurnActivated(data) {
  try {
    const local = localId();
    const who = data && (data.player ?? data.Player);
    if (who !== local) return;
    const turn = gameTurn();
    if (turn - _lastLocalTurnRun < Math.max(1, CONFIG.turnInterval)) return;
    _lastLocalTurnRun = turn;
    doPass(`turn ${turn}`);
  } catch (e) {
    dlog(`onTurnActivated threw ${String(e)}`);
  }
}

/** Expose a console surface for tuning (optional; the mod does not need it). */
function installConsole() {
  try {
    const g = /** @type {*} */ (globalThis);
    g.culturalDiffusion = {
      runNow: () => doPass("manual"),
      config: () => ({ ...CONFIG }),
      state: () => loadState(),
      clear: () => {
        saveState({ field: {}, claims: {}, locked: {}, monoTurn: 0 });
        return "cleared";
      },
      enable: (/** @type {boolean} */ on) => {
        CONFIG.diffusionEnabled = on !== false;
        return CONFIG.diffusionEnabled;
      },
      stop: () => {
        teardown();
        return "unsubscribed from PlayerTurnActivated";
      }
    };
  } catch (_) {
    /* ignore */
  }
}

/** Boot. */
function boot() {
  applyTunableOverrides();
  setLogDebug(!!CONFIG.debug);
  log(`boot (turnInterval ${CONFIG.turnInterval}, verb ${CONFIG.flipVerb}, enabled ${CONFIG.diffusionEnabled})`);
  installConsole();
  const eng = typeof engine !== "undefined" ? engine : null;
  if (eng && typeof eng.on === "function") {
    try {
      teardown(); // drain any prior subscription so a re-boot never stacks a 2nd handler
      _turnHandlerRef = onTurnActivated;
      eng.on("PlayerTurnActivated", _turnHandlerRef);
    } catch (e) {
      log(`turn hook failed ${String(e)}`);
    }
  } else {
    log("engine.on unavailable - pass will only run via console runNow()");
  }
}

boot();
