// cdh-game-run31.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 30 (dev only).
//
// A/B CONTROL for run 30, which took a SIGSEGV at turn 150 with the top frame CivilizationVII+0x21081fc on the
// AppHost application thread - the signature recorded as appearing WITH AND WITHOUT mod code, and NOT the
// AsyncWorker1 / 0x2a8 broker fault associated with this mod family's claims. The mod held zero claims and zero
// pending writes at the time, and the base game's own unit-flag script was throwing just before it.
//
// "It matches the known signature" is not isolation, so this run is identical to run 30 except the mod's pass is
// DISABLED. Same save, same turns, same harness. Crash again at about the same point => not ours. Clean run =>
// suspicion lands on the pass and it needs narrowing.
//
// STRESS / CRASH WATCH. The reporter's campaign crashed unrecoverably, with the mod DISABLED as well, and
// they could not attribute it - so nothing here diagnoses their save. What this CAN establish is whether
// the current build survives the moment this mod family crashed before: harness run 3 took a native
// EXC_BAD_ACCESS on AsyncWorker1 about thirty seconds after an age transition while the mod held nine
// claims beyond ring 3, a signature matching the archived emigration enclave crash.
//
// So: run the mod with everything on - the pass, the strand guard, the minor floor - for as many turns as
// the budget allows, logging each turn and each pass summary, and let the runner capture any .ips. A clean
// long run is not proof the reporter's crash was unrelated; it is evidence that the code added this session
// does not fault on its own, which is the only crash question we can actually answer.
//
// Every turn logs: turn number, pass summary, claim count, and how many guard refusals have been seen, so a
// crash can be placed against what the mod was doing at the time.
//
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { loadState } from "/cultural-diffusion/ui/cd-state.js";

const TAG = "[CDH]";
const MAX_TURNS = 40;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }

let local = -1;
function ageName() {
  return safe(() => {
    const a = Game.age;
    if (typeof a === "string") return a;
    return GameInfo.Ages.lookup(a)?.AgeType || String(a);
  }, "?");
}
function stateSummary() {
  return safe(() => {
    const st = loadState();
    return { claims: Object.keys(st.claims || {}).length, pending: Object.keys(st.pending || {}).length,
      field: Object.keys(st.field || {}).length, locked: Object.keys(st.locked || {}).length };
  }, "ERR");
}
function unitsOnOurLand() {
  // A rough census of foreign units standing inside our borders: if the guard is doing its job this should
  // not climb steadily.
  return safe(() => {
    let n = 0;
    for (const p of Players.getAlive() || []) {
      const pid = safe(() => p.id, -1);
      if (pid === local) continue;
      for (const u of safe(() => p.Units?.getUnits?.() || [], [])) {
        const unit = safe(() => (u && u.location ? u : Units.get(u)), null);
        if (!unit || !unit.location) continue;
        if (safe(() => GameplayMap.getOwner(unit.location.x, unit.location.y), -9) === local) n++;
      }
    }
    return n;
  }, "ERR");
}

function run() {
  local = GameContext.localPlayerID;
  CONFIG.diffusionEnabled = false;     // THE ONLY DIFFERENCE FROM RUN 30
  emit(`S0 run31 CONTROL modPassDisabled turn=${safe(() => Game.turn)} age=${ageName()} local=${local} `
    + `diffusion=${CONFIG.diffusionEnabled} guard=${CONFIG.protectTrappedUnits} minorFloor=${CONFIG.minorProtectRadius} `
    + `recede=${CONFIG.recedeBorders} buffer=${CONFIG.growthBuffer}`);
  emit(`S0 state ${J(stateSummary())} foreignUnitsOnOurLand=${unitsOnOurLand()}`);
  emit("STRESS running; ending turns until the budget is spent or the game faults");
  setTimeout(endTurn, 6000);
}

let n = 0; let endTurnTimer = null; let blockedTries = 0; let lastAge = "";
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
    if (lastAge && age !== lastAge) emit(`AGE TRANSITION ${lastAge} -> ${age} at turn ${safe(() => Game.turn)} - the crash window`);
    lastAge = age;
    emit(`TURN n=${n} turn=${safe(() => Game.turn)} age=${age} state=${J(stateSummary())} `
      + `foreignUnitsOnOurLand=${unitsOnOurLand()}`);
    if (n >= MAX_TURNS) { emit(`STRESS SURVIVED ${n} turns, final age ${age}`); setTimeout(() => emit("DONE harness run31 finished"), 3000); return; }
    setTimeout(endTurn, 4000);
  }, 6000);
});

emit("attached run31");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { n = 1; lastAge = ageName(); run(); }, 8000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
