// cdh-game-control.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness CONTROL (dev only).
//
// Imports NOTHING from the mod, so it runs with Cultural Diffusion disabled (NO_MOD=1). Its only job is to
// end turns on the same save for the same number of turns as the stress run, so a crash can be attributed -
// or not - to the mod.
//
// Why a separate script: a harness cannot simply switch the mod off from script. applyTunableOverrides()
// pulls the player's saved settings into CONFIG on every pass, so `CONFIG.diffusionEnabled = false` is
// clobbered within a turn - run 31 was meant to be a control and finished holding 37 claims.
//
// Tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
const MAX_TURNS = 40;
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function ageName() {
  return safe(() => {
    const a = Game.age;
    if (typeof a === "string") return a;
    return GameInfo.Ages.lookup(a)?.AgeType || String(a);
  }, "?");
}
let local = -1; let n = 0; let endTurnTimer = null; let blockedTries = 0; let lastAge = "";

function endTurn() {
  try {
    const me = Players.get(local);
    if (!me.isTurnActive || GameContext.hasSentTurnComplete()) return;
    const b = String(Game.Notifications.getEndTurnBlockingType(local));
    if (b !== String(EndTurnBlockingTypes.NONE)) {
      blockedTries++;
      if (blockedTries >= 3 && typeof Autoplay !== "undefined") {
        safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
        blockedTries = 0; endTurnTimer = setTimeout(endTurn, 30000); return;
      }
      endTurnTimer = setTimeout(endTurn, 4000); return;
    }
    safe(() => UI.Player.deselectAllUnits()); GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTurnTimer = setTimeout(() => { if (safe(() => Players.get(local).isTurnActive, false) && !GameContext.hasSentTurnComplete()) endTurn(); }, 12000);
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => {
    const age = ageName();
    if (lastAge && age !== lastAge) emit(`AGE TRANSITION ${lastAge} -> ${age} at turn ${safe(() => Game.turn)}`);
    lastAge = age;
    emit(`TURN n=${n} turn=${safe(() => Game.turn)} age=${age} CONTROL-noMod`);
    if (n >= MAX_TURNS) { emit(`CONTROL SURVIVED ${n} turns, final age ${age}`); setTimeout(() => emit("DONE harness control finished"), 3000); return; }
    setTimeout(endTurn, 4000);
  }, 6000);
});

emit("attached control (no mod imports)");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    emit("LOAD GameStarted");
    setTimeout(() => {
      local = GameContext.localPlayerID; n = 1; lastAge = ageName();
      emit(`S0 CONTROL turn=${safe(() => Game.turn)} age=${lastAge} local=${local} modShouldBeDisabled`);
      setTimeout(endTurn, 6000);
    }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
