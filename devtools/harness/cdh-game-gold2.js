// cdh-game-gold2.js - game scope, deployed as ui/cdh-game.js. Does a script claim cost gold at the turn roll? (dev only)
//
// Gold run 1 (cdh-game-gold.js) left one question open: the claim showed cost 0 on the tick, at +3 s and at +10 s,
// but our gold fell 515 beyond income across that turn. The engine log shows "Autoplay started" in every one of that
// run's turns, so the AI played our turns and may have spent it. This run rolls turns WITHOUT Autoplay wherever the
// engine allows: when the end-turn blocker is not NONE it names the blocker and sends sendTurnComplete anyway, and
// only after 90 s of no progress falls back to Autoplay, saying so on a line of its own.
//
//   turn 1  one refunded claim; gold at +0/+3/+10/+30/+60 s, then gPre right before the end-turn call
//   turn 2  control: nothing; the same reads and gPre
//   turn 3  changeGoldBalance(+37) alone; reads to +60 s; gPre
//   turn 4  read-out and DONE
// Each turn reports delta = gPost(next turn start) - gPre and effect = delta - own net income at gPre time.
// If turn 1's effect is a plot price and turn 2's is ~0 with no Autoplay in either, the claim is charged at the roll.

import { flipViaPurchasePlotRefunded } from "/cultural-diffusion/ui/cd-ownership.js";

const TAG = "[CDH]";
const TURNS = 4;
const DELTA = 37;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
function r2(v) { return typeof v === "number" ? Math.round(v * 100) / 100 : String(v); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function goldOf(pid) { return safe(() => Players.get(pid).Treasury.goldBalance, null); }
function netGold(pid) { return safe(() => Players.get(pid).Stats.getNetYield(YieldTypes.YIELD_GOLD), null); }
function unitCount() { return safe(() => Players.get(local).Units.getUnits().length, -1); }
function blockerName() {
  return safe(() => {
    const b = Game.Notifications.getEndTurnBlockingType(local);
    for (const k of Object.keys(EndTurnBlockingTypes)) if (EndTurnBlockingTypes[k] === b) return k;
    return String(b);
  }, "?");
}

function claimTarget() {
  for (const c of localCities()) {
    const p = inRadius(c.location, 4)
      .filter((q) => dist(c.location, q) === 4 && !isWater(q) && owner(q) === -1)
      .find((q) => inRadius(q, 1).some((n) => owner(n) === local));
    if (p) return { city: c, loc: p, name: safe(() => Locale.compose(c.name), "?") };
  }
  return null;
}

const turns = {}; // n -> { label, gPre, income, autoplay, gPost }
async function watch(label, g0, extra) {
  const marks = [0, 3000, 7000, 20000, 30000]; // cumulative: +0, +3, +10, +30, +60 s
  const out = [];
  for (const ms of marks) {
    if (ms) await later(ms);
    out.push(`${r2(goldOf(local) - g0)}${extra ? " " + extra() : ""}`);
  }
  emit(`G ${label}: gold before=${r2(g0)} deltas at +0/+3/+10/+30/+60 s = ${out.join(" | ")}`);
}
async function stage(n) {
  const t = { label: "?", autoplay: false };
  turns[n] = t;
  if (n === 1) {
    t.label = "one refunded claim";
    const tgt = claimTarget();
    if (!tgt) { emit("G CLAIM no target"); return; }
    const g0 = goldOf(local);
    const res = safe(() => flipViaPurchasePlotRefunded(local, tgt.city, tgt.loc, true), "THREW");
    emit(`G CLAIM ${key(tgt.loc)} from ${tgt.name}: result=${js(res)}`);
    await watch("CLAIM", g0, () => `owner=${owner(tgt.loc)}`);
  } else if (n === 2) {
    t.label = "control, nothing done";
    await watch("CONTROL", goldOf(local));
  } else if (n === 3) {
    t.label = "changeGoldBalance(+37)";
    const g0 = goldOf(local);
    safe(() => Players.get(local).Treasury.changeGoldBalance(DELTA));
    await watch("CHANGE", g0);
  }
}
function closeTurn(n) {
  const t = turns[n];
  if (!t || t.gPre == null) return;
  t.gPost = goldOf(local);
  const delta = t.gPost - t.gPre;
  const effect = delta - (typeof t.income === "number" ? t.income : 0);
  t.effect = effect;
  emit(`G turn${n} roll ${t.label}: gPre=${r2(t.gPre)} gPost=${r2(t.gPost)} delta=${r2(delta)} income=${r2(t.income)} autoplayUsed=${t.autoplay} units ${t.unitsPre}->${unitCount()} => effect beyond income = ${r2(effect)}`);
}
function finish() {
  closeTurn(3);
  const t1 = turns[1] || {}, t2 = turns[2] || {}, t3 = turns[3] || {};
  emit(`G VERDICT claim-turn effect=${r2(t1.effect)} (autoplay ${t1.autoplay}) control-turn effect=${r2(t2.effect)} (autoplay ${t2.autoplay}) changeGoldBalance-turn effect=${r2(t3.effect)} (autoplay ${t3.autoplay}) => `
    + (t1.autoplay || t2.autoplay ? "Autoplay touched a measured turn; compare the two turns with care" : "clean rolls: ")
    + (Math.abs((t1.effect || 0) - (t2.effect || 0)) < 5 ? "the claim cost NOTHING at the roll" : `the claim turn differs from the control by ${r2((t1.effect || 0) - (t2.effect || 0))} gold`));
  emit("DONE harness gold2 finished");
}

// ---------------------------------------------------------------- turns, without Autoplay where the engine allows
let n = 0; let endTimer = null; let tries = 0;
function endTurn() {
  try {
    const me = Players.get(local);
    if (!me.isTurnActive) return;
    const t = turns[n];
    if (t && t.gPre == null) { t.gPre = goldOf(local); t.income = netGold(local); t.unitsPre = unitCount(); }
    tries++;
    const b = blockerName();
    if (b !== "NONE" && tries % 3 === 1) emit(`ENDTURN turn${n} try ${tries} blocker=${b} sentAlready=${GameContext.hasSentTurnComplete()}`);
    if (tries > 18 && typeof Autoplay !== "undefined") { // 90 s of no progress
      if (t) t.autoplay = true;
      emit(`ENDTURN turn${n} AUTOPLAY engaged after ${tries} tries (blocker=${b})`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      endTimer = setTimeout(endTurn, 30000); return;
    }
    safe(() => UI.Player.deselectAllUnits());
    if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTimer = setTimeout(endTurn, 5000);
}
async function onTurn() {
  emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
  closeTurn(n - 1);
  if (n >= TURNS) { finish(); return; }
  await stage(n);
  tries = 0;
  endTurn();
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  n++;
  setTimeout(() => { onTurn().catch((e) => emit("onTurn threw " + e)); }, 4000);
});

async function run() {
  local = GameContext.localPlayerID;
  emit(`GOLD2 start turn=${safe(() => Game.turn)} local=${local} cities=${localCities().length} blocker=${blockerName()}`);
  n = 1;
  await stage(1);
  tries = 0;
  endTurn();
}

emit("attached gold2");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => emit("run threw " + e)); }, 10000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
