// cdh-game-trade.js: game scope, deployed as ui/cdh-game.js. Does moving a rival-owned tile that lies on an active
// trade route's path crash the turn? (dev only)
//
// Player report (2026-10-05): hard crash on turn start, log names "Trade Route Validation Failure", gone with
// "claim empty land only". Hypothesis: purchasePlot moving a rival-owned tile on a live route's path leaves the route
// invalid. Run with NO_MOD=1: this script imports nothing from the mod and makes the flips itself, with the same
// verb the mod uses (city.purchasePlot), so the engine's reaction is the only thing measured.
//
// MODE "onpath": flip up to MAX tiles that lie on current routes' paths. MODE "offpath": the control, the same kind
// of tile (rival-owned, rural, touching the buyer's land) but nowhere on or beside any path. Then roll TURNS turns.

const MODE = "soak";
const MAX = 6;
const TURNS = 6;
const TAG = "[CDH]";

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }

let local = -1;
const owner = (l) => safe(() => GameplayMap.getOwner(l.x, l.y), -9);
const isWater = (l) => safe(() => !!GameplayMap.isWater(l.x, l.y), true);
const locOf = (i) => GameplayMap.getLocationFromIndex(i);
const idxOf = (l) => GameplayMap.getIndexFromLocation(l);
const dist = (a, b) => safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99);
function neighbors(l) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, 1).map(locOf).filter((n) => n.x !== l.x || n.y !== l.y), []);
}
function districtName(l) {
  return safe(() => GameInfo.Districts.lookup(GameplayMap.getDistrictType(l.x, l.y))?.DistrictType || "none", "?");
}
function majors() {
  return safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []);
}
function citiesOf(pid) { return safe(() => Players.get(pid).Cities.getCities() || [], []); }
function blockerName() {
  return safe(() => {
    const b = Game.Notifications.getEndTurnBlockingType(local);
    for (const k of Object.keys(EndTurnBlockingTypes)) if (EndTurnBlockingTypes[k] === b) return k;
    return String(b);
  }, "?");
}

// Every major's current routes: plot index -> [route labels]
function routeCensus(label) {
  const onPath = new Map();
  let total = 0;
  for (const p of majors()) {
    const tr = safe(() => Players.get(p).Trade, null);
    if (!tr) continue;
    const count = safe(() => tr.countPlayerTradeRoutes(), "?");
    const routes = safe(() => tr.getCurrentTradeRoutes(), null);
    const arr = Array.isArray(routes) ? routes : [];
    if (label === "T0" && arr[0]) {
      const r = arr[0];
      const fields = ["targetCityId", "nearestCityId", "pathPlots", "domain", "status", "id", "fromCityId", "toCityId", "owner"];
      emit(`ROUTE shape p${p}: ${fields.map((f) => f + ":" + typeof r[f]).join(" ")} keys=${js(Object.keys(r))}`);
    }
    emit(`ROUTES ${label} p${p}: count=${count} current=${Array.isArray(routes) ? arr.length : typeof routes}`);
    arr.forEach((r, i) => {
      const path = Array.isArray(r.pathPlots) ? r.pathPlots : [];
      const tc = safe(() => Cities.get(r.targetCityId), null);
      const nc = safe(() => Cities.get(r.nearestCityId), null);
      const tag = `p${p}#${i} ${nc ? nc.owner : "?"}->${tc ? tc.owner : "?"} dom=${r.domain} len=${path.length}`;
      total++;
      if (label === "T0") emit(`ROUTE ${tag} owners=${js(path.map((ix) => owner(locOf(ix))))}`);
      for (const ix of path) { if (!onPath.has(ix)) onPath.set(ix, []); onPath.get(ix).push({ tag, a: nc?.owner, b: tc?.owner }); }
    });
  }
  emit(`ROUTES ${label} total=${total} pathPlots=${onPath.size}`);
  return onPath;
}

function pickTargets(onPath) {
  const ms = new Set(majors());
  const near = (ix) => onPath.has(ix) || neighbors(locOf(ix)).some((n) => onPath.has(idxOf(n)));
  const out = [];
  const usedRoutes = new Set();
  const consider = (l) => {
    if (out.length >= MAX || isWater(l)) return;
    const a = owner(l);
    if (a < 0) return;
    const d = districtName(l);
    if (/CITY_CENTER|URBAN/.test(d)) return;
    const ix = idxOf(l);
    if (MODE === "onpath" && !onPath.has(ix)) return;
    if (MODE !== "onpath" && near(ix)) return;
    const buyers = [...new Set(neighbors(l).map(owner))].filter((b) => b >= 0 && b !== a && ms.has(b));
    for (const b of buyers) {
      const c = citiesOf(b).map((c) => ({ c, d: dist(c.location, l) })).sort((x, y) => x.d - y.d)[0];
      if (!c || c.d > 6) continue;
      const r = onPath.get(ix);
      const rt = r ? r[0].tag : "-";
      if (MODE === "onpath" && usedRoutes.has(rt) && out.length < 3) continue; // spread over routes first
      usedRoutes.add(rt);
      out.push({ l, a, b, city: c.c, d: c.d, district: d, route: rt, third: r ? (b !== r[0].a && b !== r[0].b) : null });
      return;
    }
  };
  if (MODE === "onpath") for (const ix of onPath.keys()) consider(locOf(ix));
  else {
    const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
    for (let y = 0; y < h && out.length < MAX; y++) for (let x = 0; x < w && out.length < MAX; x++) consider({ x, y });
  }
  return out;
}

let n = 0; let endTimer = null; let tries = 0;
function endTurn() {
  try {
    const me = Players.get(local);
    if (!me.isTurnActive) { endTimer = setTimeout(endTurn, 5000); return; }
    tries++;
    const b = blockerName();
    if (b !== "NONE" && tries % 3 === 1) emit(`ENDTURN turn${n} try ${tries} blocker=${b}`);
    safe(() => UI.Player.deselectAllUnits());
    if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTimer = setTimeout(endTurn, 5000);
}

let flipped = [];
const TURNS2 = 25;
async function run() {
  local = GameContext.localPlayerID;
  emit(`SOAK start turn=${safe(() => Game.turn)} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} local=${local} majors=${js(majors())} claimOnly=${safe(() => culturalDiffusion.config().claimOnlyUnowned, "?")}`);
  routeCensus("T0");
  n = 1; tries = 0;
  endTurn();
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  n++;
  setTimeout(() => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)} owners=${flipped.map((t) => `${t.l.x},${t.l.y}=${owner(t.l)}`).join(" ")}`);
    routeCensus(`T${n}`);
    if (n > TURNS2) { emit(`DONE harness soak finished, survived ${TURNS2} turns`); return; }
    tries = 0; endTurn();
  }, 4000);
});

emit(`attached soak`);
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
