// cdh-game-run9.js - game scope, deployed as ui/cdh-game.js. Run 9 (dev only): does the Cultural Pressure lens render?
// Loads AugustusAnt136 (via cdh-shell-run5.js), ends TURNS turns so the mod's field builds stock around London, then:
// centres the camera on our largest city, logs LENS OFF SHOT (monitor screenshots), switches the pressure lens on, and
// logs LENS ACTIVE (monitor screenshots again). No other game actions. Tagged [CDH] in Logs/UI.log.

import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const TURNS = 12;
const STATE_KEY = "CulturalDiffusionState_v2";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}

let local = -1;
function fieldSummary() {
  return safe(() => {
    const raw = Configuration.getGame().getValue(STATE_KEY);
    if (!raw) return { field: 0 };
    const d = JSON.parse(raw).data || {};
    const field = d.field || {};
    let ourStockOnTilesWeDoNotOwn = 0;
    for (const k of Object.keys(field)) {
      const [x, y] = k.split(",").map(Number);
      if ((field[k][String(local)] || 0) > 0 && GameplayMap.getOwner(x, y) !== local) ourStockOnTilesWeDoNotOwn++;
    }
    return { field: Object.keys(field).length, claims: Object.keys(d.claims || {}).length, contestable: ourStockOnTilesWeDoNotOwn };
  }, { field: "ERR" });
}

function lensShots() {
  const cities = safe(() => Players.get(local).Cities.getCities() || [], []);
  const big = cities.slice().sort((a, b) => (b.population || 0) - (a.population || 0))[0];
  const loc = big ? big.location : null;
  const cam = loc ? safe(() => { Camera.lookAtPlot(loc); return "lookAtPlot"; }, "no-camera") : "no-city";
  setTimeout(() => {
    emit(`LENS OFF SHOT active=${safe(() => LensManager.getActiveLens(), "?")} camera=${cam} at=${loc ? loc.x + "," + loc.y : "-"} cd=${JSON.stringify(fieldSummary())}`);
    setTimeout(() => {
      const set = safe(() => { LensManager.setActiveLens("cd-pressure-lens"); return "called"; }, "throw");
      setTimeout(() => {
        emit(`LENS ACTIVE set=${set} active=${safe(() => LensManager.getActiveLens(), "?")} layerEnabled=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")}`);
        setTimeout(() => emit("DONE run9"), 12000);
      }, 5000);
    }, 12000);
  }, 5000);
}

let n = 0; let endTurnTimer = null; let blockedTries = 0;
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
  emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
  if (n > TURNS) { setTimeout(lensShots, 8000); return; }
  setTimeout(endTurn, 8000);
});

emit("attached run9");
let beginTries = 0;
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    setTimeout(() => { local = GameContext.localPlayerID; emit(`R9 start turn=${safe(() => Game.turn)}`); n = 1; setTimeout(endTurn, 3000); }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
