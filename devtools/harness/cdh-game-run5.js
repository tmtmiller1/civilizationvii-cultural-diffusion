// cdh-game-run5.js - game scope, deployed as ui/cdh-game.js. Crash disproof run 5 (dev only).
//
// Question: does playing AugustusAnt136 through the Antiquity -> Exploration transition with Cultural Diffusion
// ENABLED crash, with NO harness test actions? Run 3 crashed about 30s into the new age's startup, before GameStarted.
// The Emigration session played the same transition with Cultural Diffusion DISABLED and did not crash. Run 3's
// autosaves have rotated out, so this replays run 3's route from the turn-136 save:
//   Antiquity: press Begin, then end every turn exactly as run 3 did (sendTurnComplete, falling back to a one-turn
//     Autoplay when a blocker persists), and nothing else, until the age ends.
//   Exploration (the transition reloads this script): press Begin only. Log each loading-state change and a heartbeat
//     so a crash can be placed against startup. After 180s alive: DONE, then the Options fix check.
// Deploy the mod with debug, recedeBorders and growthBuffer on, matching run 3's configuration.
// Tagged [CDH] in Logs/UI.log.

import { Options } from "/core/ui/options/model-options.js";

const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function ageType() { return safe(() => GameInfo.Ages.lookup(Game.age).AgeType, "?"); }
const attachedAt = Date.now();
const since = () => Math.round((Date.now() - attachedAt) / 1000) + "s";

function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}

// Game-scope check of the Options fix, run only AFTER the crash test is over so it cannot disturb the isolation.
function optionsCheck(where) {
  try {
    const ids = ["cd-preset", "cd-growth-buffer", "cd-recede", "cd-debug"];
    const has = () => JSON.stringify(ids.map((id) => Options.data.has(id)));
    const before = has();
    Options.init();
    const afterInit = has();
    Options.reInitOptions();
    const afterReInit = has();
    Options.init();
    const afterRebuild = has();
    emit(`OPTIONS ${where} before=${before} afterInit=${afterInit} afterReInit=${afterReInit} afterRebuild=${afterRebuild} `
      + `verdict=${afterRebuild === JSON.stringify(ids.map(() => true)) ? "SURVIVES-REBUILD" : "LOST-ON-REBUILD"}`);
  } catch (e) { emit("OPTIONS check threw " + e); }
}

// --- Antiquity: end turns exactly as run 3 did, nothing else --------------------------------------------------------
let mode = "loading";
let local = -1;
let endTurnTimer = null;
let blockedTries = 0;
let autoplayTurns = 0;

function endTurn() {
  try {
    const me = Players.get(local);
    if (!me.isTurnActive || GameContext.hasSentTurnComplete()) return;
    const b = String(Game.Notifications.getEndTurnBlockingType(local));
    if (b !== String(EndTurnBlockingTypes.NONE)) {
      blockedTries++;
      if (blockedTries >= 3 && typeof Autoplay !== "undefined") {
        safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
        autoplayTurns++;
        blockedTries = 0; endTurnTimer = setTimeout(endTurn, 30000); return;
      }
      endTurnTimer = setTimeout(endTurn, 4000); return;
    }
    safe(() => UI.Player.deselectAllUnits()); GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTurnTimer = setTimeout(() => { if (safe(() => Players.get(local).isTurnActive, false) && !GameContext.hasSentTurnComplete()) endTurn(); }, 12000);
}

function antiquityLoop() {
  mode = "antiquity";
  local = GameContext.localPlayerID;
  const cfg = safe(() => globalThis.culturalDiffusion.config(), null);
  emit(`A0 start turn=${safe(() => Game.turn)} age=${ageType()} since=${since()} cd=${cfg ? JSON.stringify({ debug: cfg.debug, recede: cfg.recedeBorders, buffer: cfg.growthBuffer, enabled: cfg.diffusionEnabled }) : "no-console"}`);
  setTimeout(endTurn, 3000);
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID) return;
  emit(`TURN activated turn=${safe(() => Game.turn)} age=${ageType()} mode=${mode} autoplayTurns=${autoplayTurns} since=${since()}`);
  if (mode !== "antiquity") return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  blockedTries = 0;
  setTimeout(endTurn, 8000);
});

// --- Exploration: press Begin only, then watch -----------------------------------------------------------------------
function explorationWatch() {
  mode = "exploration";
  emit(`E1 new age started turn=${safe(() => Game.turn)} age=${ageType()} since=${since()}`);
  let beats = 0;
  const beat = setInterval(() => {
    beats++;
    emit(`E2 alive since=${since()} turn=${safe(() => Game.turn)} state=${loadStateName()}`);
    if (beats * 15 >= 180) {
      clearInterval(beat);
      emit("DONE run5 survived 180s into the new age");
      optionsCheck("game");
    }
  }, 15000);
}

emit(`attached run5 age=${ageType()} state=${loadStateName()}`);
let beginTries = 0;
let lastState = "";
function beginPoll() {
  const st = loadStateName();
  if (st !== lastState) { emit(`STATE ${st} since=${since()}`); lastState = st; }
  if (st === "GameStarted") {
    emit(`LOAD GameStarted age=${ageType()} turn=${safe(() => Game.turn)} since=${since()}`);
    setTimeout(() => (ageType() === "AGE_ANTIQUITY" ? antiquityLoop() : explorationWatch()), 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries % 5 === 0) emit(`WAIT state=${st} tries=${beginTries} since=${since()}`);
  if (beginTries < 120) setTimeout(beginPoll, 3000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
