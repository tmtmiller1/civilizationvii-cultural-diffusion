// cd-bootstrap.js, game scope.
//
// Boot the Cultural Diffusion engine: run one diffusion pass per local-player turn (honoring
// CONFIG.turnInterval), refresh settings before each pass, and expose a small console surface.
// All engine wiring is defensive. Results reach UI.log under the [CulturalDiffusion] prefix.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { setDebug as setLogDebug, log, dlog } from "/cultural-diffusion/ui/cd-log.js";
import { applyTunableOverrides } from "/cultural-diffusion/ui/cd-settings.js";
import { runPass, claimBufferAt } from "/cultural-diffusion/ui/cd-pass.js";
import { loadState, saveState } from "/cultural-diffusion/ui/cd-state.js";
import { onCityTransfered } from "/cultural-diffusion/ui/cd-capture.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { onSettlementTransfer, sweepFlipMarkers, sweepWhenStarted } from "/cultural-diffusion/ui/cd-city-flip.js";

let _lastLocalTurnRun = -999;

// Keep handles to our own engine listeners so a re-boot (e.g. a save/reload re-running this
// script) can drain the previous subscription instead of stacking a second handler.
/** @type {((data:*)=>void)|null} */
let _turnHandlerRef = null;
/** @type {((data:*)=>void)|null} */
let _constructibleHandlerRef = null;
/** @type {((data:*)=>void)|null} */
let _transferHandlerRef = null;

// Kill switch: if our per-turn pass throws repeatedly, unsubscribe so a broken build stops
// running (and spamming errors) on every turn for the rest of the session.
let _passErrors = 0;
const KILL_THRESHOLD = 3;

/** Drain our own engine subscriptions. Idempotent; safe to call any time. */
function teardown() {
  try {
    const eng = typeof engine !== "undefined" ? engine : null;
    if (eng && typeof eng.off === "function") {
      if (_turnHandlerRef) eng.off("PlayerTurnActivated", _turnHandlerRef);
      if (_constructibleHandlerRef) eng.off("ConstructibleAddedToMap", _constructibleHandlerRef);
      if (_transferHandlerRef) eng.off("CityTransfered", _transferHandlerRef);
    }
  } catch (_) {
    /* ignore */
  }
  _turnHandlerRef = null;
  _constructibleHandlerRef = null;
  _transferHandlerRef = null;
}

/**
 * True when a constructible type is a rural development (a worked improvement or the rural
 * district) rather than a city-center building/wonder: a "we improved a tile" growth event.
 * @param {*} typeId The event's constructibleType id.
 * @returns {boolean} Whether it counts as rural growth.
 */
function isRuralConstructible(typeId) {
  const row = lookupConstructible(typeId);
  if (!row) return false;
  const t = String(row.ConstructibleType || "");
  return t === "DISTRICT_RURAL" || String(row.ConstructibleClass || "") === "IMPROVEMENT" || t.indexOf("IMPROVEMENT") === 0;
}

/** @param {*} typeId */
function lookupConstructible(typeId) {
  try {
    if (typeof GameInfo === "undefined") return null;
    return GameInfo?.Constructibles?.lookup?.(typeId) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Whether a build is finished. No `percentComplete` means the engine sent a finished build. The field is a 0-100
 * percentage (the base game reads it with `== 100`, tutorial-items-antiquity.js), so read it the same loose way:
 * 100, 100.0 and "100" all count. 1 isn't taken as a fraction, because on that scale it's a build at 1%.
 * @param {*} pc The payload's percentComplete.
 * @returns {boolean} True when the build is complete.
 */
function buildComplete(pc) {
  return pc == null || Number(pc) >= 100;
}

/**
 * Whether a ConstructibleAddedToMap payload is a completed rural development on the local player's own land.
 * @param {*} data Event payload: { location:{x,y}, constructibleType, percentComplete }.
 * @returns {boolean} True when the +1 buffer could apply.
 */
function isOwnRuralCompletion(data) {
  const loc = data && data.location;
  if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") return false;
  if (!buildComplete(data.percentComplete)) return false;            // only completed builds
  if (!isRuralConstructible(data.constructibleType)) return false;   // rural growth only
  return ownerAt(loc) === localId();                                 // only our own development
}

/**
 * ConstructibleAddedToMap handler: when the local player finishes a rural improvement, push the
 * "+1 ring" cultural buffer onto the unowned tiles adjacent to it.
 * @param {*} data Event payload: { location:{x,y}, constructibleType, percentComplete }.
 */
function onConstructibleAdded(data) {
  try {
    // Cheap checks first: this event fires for every player's every build, and the settings refresh below
    // reads and parses the shared localStorage blob about fifteen times.
    if (!isOwnRuralCompletion(data)) return;
    applyTunableOverrides(); // pick up an Options change made since the last pass, e.g. the buffer just switched off
    if (!CONFIG.diffusionEnabled || !CONFIG.growthBuffer) return; // the master switch stops the buffer too
    claimBufferAt({ x: data.location.x, y: data.location.y });
  } catch (e) {
    dlog(`onConstructibleAdded threw ${String(e)}`);
  }
}

function gameTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : 0;
  } catch (_) {
    return 0;
  }
}

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
 * The player a PlayerTurnActivated payload names, or null when it names none this can read. The base game compares
 * `data.player` with a loose `==` (unit-selection.js), so a numeric string counts as that id.
 * @param {*} data Event payload.
 * @returns {number|null} Player id.
 */
function turnPlayerOf(data) {
  const raw = data && typeof data === "object" ? (data.player ?? data.Player) : data;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

/** @param {number} local @returns {boolean} Whether the engine says the local player's turn is active now. */
function localTurnActive(local) {
  try {
    return local >= 0 && Players?.get?.(local)?.isTurnActive === true;
  } catch (_) {
    return false;
  }
}

/**
 * PlayerTurnActivated handler: run the pass once per local-player turn. A payload this can't read a player from
 * still counts when the engine reports the local player's turn active, so a change in the payload's shape can't
 * leave the mod loaded but idle. The per-turn check below keeps it to one pass a turn either way.
 * @param {*} data Event payload (carries the activating player).
 */
function onTurnActivated(data) {
  try {
    const local = localId();
    const who = turnPlayerOf(data);
    if (who == null ? !localTurnActive(local) : who !== local) return;
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
      // Partisans reads this: when true, Cultural Diffusion's "has joined" notice carries Partisans' unrest line for
      // a flip it made, and Partisans sends no unrest notice of its own for that flip.
      get tellsPartisanUnrest() {
        return !!CONFIG.cityFlips;
      },
      sweepFlipMarkers: () => sweepFlipMarkers(),
      state: () => loadState(),
      clear: () => {
        saveState({ field: {}, claims: {}, locked: {}, cityHold: {}, monoTurn: 0 });
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
      _constructibleHandlerRef = onConstructibleAdded;
      eng.on("ConstructibleAddedToMap", _constructibleHandlerRef);
      // A city changing hands rewrites the culture on its tiles at once (cd-capture.js), for any two players, and
      // a settlement flip waiting on its transfer hears about it (cd-city-flip.js).
      _transferHandlerRef = (d) => { applyTunableOverrides(); onCityTransfered(d); onSettlementTransfer(d); };
      eng.on("CityTransfered", _transferHandlerRef);
    } catch (e) {
      log(`turn hook failed ${String(e)}`);
    }
  } else {
    log("engine.on unavailable - pass will only run via console runNow()");
  }
  // A flip marker left in a city carries over a save and an age change (each loads the game's scripts again), and
  // would hand the city back to that leader if it ever changed hands again; clear any stray once the game has started.
  sweepWhenStarted().catch(() => 0);
}

boot();
