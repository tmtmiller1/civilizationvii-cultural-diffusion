// cdh-game-gold.js - game scope, deployed as ui/cdh-game.js. Does a claim cost gold, and does any refund land? (dev only)
//
// Parity run 2 (cdh-game-parity.js) found Treasury.changeGoldBalance(+37) moved NOTHING within 3 s, even on the
// LOCAL player, while Players.grantYield(GOLD) reached a rival. changeGoldBalance is the verb the mod's refund uses,
// and every earlier run logged goldSpent=0 at the same tick as purchasePlot - the tick on which the refund is
// measured. Ownership itself lands only seconds after the call, so the purchase cost may land late too, after the
// refund has already measured zero. If so, every claim quietly costs the player gold.
//
// One measurement per turn, so a turn's gold delta minus the player's own net income isolates one effect:
//   turn 1  ONE refunded claim through the mod's own flipViaPurchasePlotRefunded: gold at +0 / +3 s / +10 s,
//           owner of the plot at +3 / +10 s, then the across-turn delta
//   turn 2  changeGoldBalance(+37) on the local player: +0 / +3 / +10 s, then across the turn
//   turn 3  Players.grantYield(GOLD, +37) on the local player: +0 / +3 / +10 s, then across the turn (reversed after)
//   turn 4  read-out, plus what pseudo-player 63's DISTRICT_WILDERNESS plots are (parity run 2, P7), then DONE
// The mod's own pass runs every turn too; its "pass: N flip(s)" lines say whether it bought anything that would
// confound a delta (from an empty field it needs ~18 passes before its first claim).

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

/** An unowned land plot at ring 4 of a local city that touches our land: what the mod claims first. */
function claimTarget() {
  for (const c of localCities()) {
    const p = inRadius(c.location, 4)
      .filter((q) => dist(c.location, q) === 4 && !isWater(q) && owner(q) === -1)
      .find((q) => inRadius(q, 1).some((n) => owner(n) === local));
    if (p) return { city: c, loc: p, name: safe(() => Locale.compose(c.name), "?") };
  }
  return null;
}

const turns = {}; // n -> { label, gStart, income, gEnd }
function startTurn(n, label) {
  turns[n] = { label, gStart: goldOf(local), income: netGold(local) };
  emit(`G turn${n} start ${label}: gold=${r2(turns[n].gStart)} netIncome=${r2(turns[n].income)}`);
}
function closeTurn(n) {
  const t = turns[n];
  if (!t) return;
  t.gEnd = goldOf(local);
  const delta = t.gEnd - t.gStart;
  const effect = delta - (typeof t.income === "number" ? t.income : 0);
  emit(`G turn${n} across-turn ${t.label}: start=${r2(t.gStart)} end=${r2(t.gEnd)} delta=${r2(delta)} income=${r2(t.income)} => effect beyond income = ${r2(effect)}`);
  t.effect = effect;
}
async function readAfter(label, g0, extra) {
  const g1 = goldOf(local);
  await later(3000);
  const g3 = goldOf(local);
  const x3 = extra ? extra() : "";
  await later(7000);
  const g10 = goldOf(local);
  const x10 = extra ? extra() : "";
  emit(`G ${label}: gold before=${r2(g0)} inline=${r2(g1 - g0)} at+3s=${r2(g3 - g0)} ${x3} at+10s=${r2(g10 - g0)} ${x10}`);
  return { g1, g3, g10 };
}

async function stage1Claim() {
  startTurn(1, "one refunded claim");
  const t = claimTarget();
  if (!t) { emit("G CLAIM no target; skipping"); return; }
  const g0 = goldOf(local);
  const res = safe(() => flipViaPurchasePlotRefunded(local, t.city, t.loc, true), "THREW");
  emit(`G CLAIM ${key(t.loc)} from ${t.name}: result=${js(res)} (cost is what the refund measured on the same tick)`);
  await readAfter("CLAIM", g0, () => `owner=${owner(t.loc)}`);
}
async function stage2Change() {
  startTurn(2, "changeGoldBalance(+37)");
  const g0 = goldOf(local);
  const ret = safe(() => Players.get(local).Treasury.changeGoldBalance(DELTA), "THREW");
  emit(`G CHANGE changeGoldBalance(${DELTA}) returned=${js(ret)}`);
  await readAfter("CHANGE", g0);
}
async function stage3Grant() {
  startTurn(3, "grantYield(GOLD,+37)");
  const g0 = goldOf(local);
  const ret = safe(() => Players.grantYield(local, YieldTypes.YIELD_GOLD, DELTA), "THREW");
  emit(`G GRANT grantYield(${DELTA}) returned=${js(ret)}`);
  const r = await readAfter("GRANT", g0);
  if (Math.abs(r.g10 - g0) > 0.01) safe(() => Players.grantYield(local, YieldTypes.YIELD_GOLD, -DELTA)); // leave the player as found
}
function wilderness() {
  const w = safe(() => GameplayMap.getGridWidth(), 0), h = safe(() => GameplayMap.getGridHeight(), 0);
  let n = 0;
  for (let y = 0; y < h && n < 12; y++) for (let x = 0; x < w && n < 12; x++) {
    const o = owner({ x, y });
    if (o < 0 || safe(() => Players.get(o)?.isAlive, true) !== false) continue;
    n++;
    const l = { x, y };
    emit(`P7 wilderness ${key(l)} owner=${o} feature=${safe(() => { const f = GameplayMap.getFeatureType(x, y); return f < 0 ? "-" : GameInfo.Features.lookup(f)?.FeatureType; }, "?")} `
      + `naturalWonder=${safe(() => GameplayMap.isNaturalWonder(x, y), "?")} resource=${safe(() => { const r = GameplayMap.getResourceType(x, y); return r < 0 ? "-" : GameInfo.Resources.lookup(r)?.ResourceType; }, "?")} `
      + `constructibles=${js(safe(() => MapConstructibles.getConstructibles(x, y).map((c) => GameInfo.Constructibles.lookup(Constructibles.get(c).type)?.ConstructibleType), "?"))} `
      + `district=${safe(() => { const d = Districts.getAtLocation(l); return d ? GameInfo.Districts.lookup(d.type)?.DistrictType : "-"; }, "?")} owningCityId=${js(safe(() => GameplayMap.getOwningCityFromXY(x, y)?.id))}`);
  }
  if (!n) emit("P7 wilderness: no plot owned by a dead player found");
}
function finish() {
  closeTurn(3);
  wilderness();
  const t1 = turns[1] || {}, t2 = turns[2] || {}, t3 = turns[3] || {};
  emit(`G VERDICT claim effect beyond income=${r2(t1.effect)} changeGoldBalance effect=${r2(t2.effect)} grantYield effect=${r2(t3.effect)} `
    + `=> claims ${Math.abs(t1.effect || 0) < 5 ? "cost NOTHING across the turn" : "COST GOLD across the turn (" + r2(t1.effect) + ")"}; `
    + `changeGoldBalance ${Math.abs((t2.effect || 0) - DELTA) < 5 ? "lands LATE (by the next turn)" : (Math.abs(t2.effect || 0) < 5 ? "NEVER lands" : "moved " + r2(t2.effect))}; `
    + `grantYield ${Math.abs((t3.effect || 0) - DELTA) < 5 || Math.abs(t3.effect || 0) < 5 ? "(see +3s line; reversed before the turn ended)" : "moved " + r2(t3.effect)}`);
  emit("DONE harness gold finished");
}

// ---------------------------------------------------------------- turns
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
async function onTurn() {
  emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
  closeTurn(n - 1);
  if (n === 2) await stage2Change();
  else if (n === 3) await stage3Grant();
  else if (n >= TURNS) { finish(); return; }
  setTimeout(endTurn, 2000);
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => { onTurn().catch((e) => emit("onTurn threw " + e)); }, 4000);
});

async function run() {
  local = GameContext.localPlayerID;
  emit(`GOLD start turn=${safe(() => Game.turn)} local=${local} cities=${localCities().length}`);
  await stage1Claim();
  n = 1;
  setTimeout(endTurn, 2000);
}

emit("attached gold");
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
