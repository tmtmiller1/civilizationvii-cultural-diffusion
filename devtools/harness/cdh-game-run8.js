// cdh-game-run8.js - game scope, deployed as ui/cdh-game.js. Run 8 (dev only): early-game pacing and AI forward-settling.
// Loads the turn-1 save AugustusAnt1 as a stand-in for a new game, with the mod at shipped defaults plus debug logging.
// Ends TURNS turns one at a time (sendTurnComplete, one-turn Autoplay fallback), and logs:
//   CITY    every settlement founded after load: owner, turn, and its distance to our nearest city
//   CLAIM   the first turn the mod holds a claim, and the claim count every turn
//   SUMMARY every 10 turns: our cities, rival majors' settlements within 6 tiles of ours, claims
// Question 3: how long before a new game shows any claim? Question 4: does the AI settle within reach of our borders
// before culture gets there? Tagged [CDH] in Logs/UI.log.

import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const TURNS = 70;

// Pressure lens smoke test at the end of the run: switch the lens on and log LENS ACTIVE for the monitor's screenshot.
function lensTest() {
  const before = safe(() => LensManager.getActiveLens(), "?");
  const set = safe(() => { LensManager.setActiveLens("cd-pressure-lens"); return "called"; }, "throw");
  setTimeout(() => {
    emit(`LENS ACTIVE before=${before} set=${set} active=${safe(() => LensManager.getActiveLens(), "?")} `
      + `layerEnabled=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")} cd=${JSON.stringify(claims())}`);
  }, 4000);
}
const STATE_KEY = "CulturalDiffusionState_v2";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function key(l) { return l.x + "," + l.y; }
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}

let local = -1;
let startTurn = null;
let firstClaimTurn = null;
const known = new Map(); // "x,y" -> { owner, turn }
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function nearestToOurs(loc) {
  let best = 99;
  for (const c of localCities()) best = Math.min(best, dist(c.location, loc));
  return best;
}
function allSettlements() {
  const out = [];
  for (const p of safe(() => Players.getAlive(), []) || []) {
    for (const c of safe(() => p.Cities.getCities() || [], []) || []) out.push({ p, c });
  }
  return out;
}
function claims() {
  return safe(() => {
    const raw = Configuration.getGame().getValue(STATE_KEY);
    if (!raw) return { claims: 0, pending: 0 };
    const d = JSON.parse(raw).data || {};
    return { claims: Object.keys(d.claims || {}).length, pending: Object.keys(d.pending || {}).length };
  }, { claims: "ERR", pending: "ERR" });
}

function scanSettlements(turn, baseline) {
  for (const { p, c } of allSettlements()) {
    const k = key(c.location);
    if (known.has(k)) continue;
    known.set(k, { owner: p.id, turn });
    if (baseline) continue;
    const near = p.id === local ? "-" : nearestToOurs(c.location);
    emit(`CITY founded turn=${turn} owner=${p.id} kind=${p.id === local ? "ours" : (p.isMajor ? "major" : "minor")} `
      + `town=${safe(() => c.isTown)} at=${k} ourNearest=${near} ourCities=${localCities().length}`);
  }
}

function summary(turn) {
  const ours = localCities();
  const close = allSettlements().filter(({ p, c }) => p.id !== local && p.isMajor && nearestToOurs(c.location) <= 6)
    .map(({ p, c }) => `${p.id}@${key(c.location)}:d${nearestToOurs(c.location)}`);
  emit(`SUMMARY turn=${turn} elapsed=${turn - startTurn} ourCities=${ours.length} rivalMajorsWithin6=${close.length} ${JSON.stringify(close)} `
    + `cd=${JSON.stringify(claims())} firstClaimTurn=${firstClaimTurn}`);
}

let n = 0; let endTurnTimer = null; let blockedTries = 0; let autoplayTurns = 0;
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

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  const turn = safe(() => Game.turn, -1);
  setTimeout(() => {
    scanSettlements(turn, false);
    const c = claims();
    if (firstClaimTurn === null && typeof c.claims === "number" && c.claims > 0) {
      firstClaimTurn = turn;
      emit(`CLAIM first claim held at turn=${turn} elapsed=${turn - startTurn} ourCities=${localCities().length}`);
    }
    emit(`TURN n=${n} turn=${turn} cd=${JSON.stringify(c)} ourCities=${localCities().length} autoplayTurns=${autoplayTurns}`);
    if ((turn - startTurn) % 10 === 0) summary(turn);
  }, 5000);
  if (n > TURNS) { setTimeout(() => { summary(turn); emit("DONE run8"); lensTest(); }, 7000); return; }
  setTimeout(endTurn, 8000);
});

emit("attached run8");
let beginTries = 0;
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    setTimeout(() => {
      local = GameContext.localPlayerID;
      startTurn = safe(() => Game.turn, 0);
      scanSettlements(startTurn, true);
      const cfg = safe(() => globalThis.culturalDiffusion.config(), null);
      emit(`R8 start turn=${startTurn} ourCities=${localCities().length} settlements=${known.size} `
        + `cd=${cfg ? JSON.stringify({ debug: cfg.debug, buffer: cfg.growthBuffer, recede: cfg.recedeBorders, enabled: cfg.diffusionEnabled }) : "no-console"}`);
      n = 1;
      setTimeout(endTurn, 3000);
    }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
