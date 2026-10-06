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

// (MODE is set below)

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
  return safe(() => {
    const d = Districts.getAtLocation(l);
    if (!d) return "none";
    for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return "DISTRICT_" + k;
    return "type" + String(d.type);
  }, "?");
}
// What the mod's districtTypeNameAt (cd-plots.js) reads on this build, for comparison.
function modDistrictRead(l) {
  return safe(() => {
    const t = GameplayMap?.getDistrictType?.(l.x, l.y);
    if (t == null) return "null(getDistrictType " + typeof GameplayMap?.getDistrictType + ")";
    if (typeof t === "string") return t;
    return GameInfo?.Districts?.lookup?.(t)?.DistrictType || ("unresolved:" + t);
  }, "threw");
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


function centersNear(l, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, r).map(locOf).some((p) => /CITY_CENTER/.test(districtName(p))), true);
}
// Every major's possible routes, through the engine's path builder. Counts SUCCESS routes with no path.
function project(label) {
  let all = 0, ok = 0, emptyOk = 0, threw = 0;
  for (const p of majors()) {
    const r = safe(() => Players.get(p).Trade.projectPossibleTradeRoutes(), "THREW");
    if (r === "THREW" || typeof r === "string") { threw++; continue; }
    for (const t of r || []) {
      all++;
      const st = Array.isArray(t.status) && t.status.length ? t.status[0] : -1;
      if (st === TradeRouteStatus.SUCCESS) { ok++; if (!t.pathPlots || !t.pathPlots.length) emptyOk++; }
    }
  }
  emit(`PROJECT ${label}: routes=${all} success=${ok} successWithEmptyPath=${emptyOk} threw=${threw}`);
}
let flipsDone = 0;
function flipWave(label, cap, perPlayer) {
  const ms = majors(); let sent = 0; const done = new Set();
  for (const p of ms) {
    let mine = 0;
    for (const c of citiesOf(p)) {
      if (mine >= perPlayer || sent >= cap) break;
      const ring = safe(() => GameplayMap.getPlotIndicesInRadius(c.location.x, c.location.y, 5).map(locOf), []);
      for (const l of ring) {
        if (mine >= perPlayer || sent >= cap) break;
        const k = l.x + "," + l.y;
        if (done.has(k) || isWater(l)) continue;
        const a = owner(l);
        if (a < 0 || a === p) continue;
        if (/CITY_CENTER|URBAN/.test(districtName(l)) || centersNear(l, 1)) continue;
        if (!neighbors(l).some((n) => owner(n) === p)) continue;
        safe(() => c.purchasePlot(l));
        done.add(k); mine++; sent++;
      }
    }
  }
  flipsDone += sent;
  emit(`WAVE ${label}: sent ${sent} flips (total ${flipsDone})`);
}


function consNames(l) {
  return safe(() => (MapConstructibles.getConstructibles(l.x, l.y) || []).map((c) => {
    const inst = Constructibles.getByComponentID(c);
    const info = inst && GameInfo.Constructibles.lookup(inst.type);
    return info ? info.ConstructibleType + (info.ConstructibleClass === "WONDER" ? "(W)" : "") : "?";
  }), []);
}
function resName(l) { return safe(() => { const r = GameplayMap.getResourceType(l.x, l.y); return r >= 0 ? GameInfo.Resources.lookup(r).ResourceType : ""; }, ""); }
function unitsOn(l) { return safe(() => (MapUnits.getUnits(l.x, l.y) || []).length, 0); }
const used = new Set();
function buyerFor(l, a) {
  const ms = majors();
  const adj = [...new Set(neighbors(l).map(owner))].filter((b) => b >= 0 && b !== a && ms.includes(b));
  const pick = (cands) => {
    let best = null;
    for (const b of cands) for (const c of citiesOf(b)) { const d = dist(c.location, l); if (d <= 8 && (!best || d < best.d)) best = { b, c, d, adj: adj.includes(b) }; }
    return best;
  };
  return pick(adj) || pick(ms.filter((b) => b !== a));
}
// MODE "district": owned tiles carrying a district (rural improvement or urban). MODE "bare": owned tiles with none.
const MODE = "district";
const FLIPS = 12;
async function valuableWave(label, per) {
  if (label !== "T0") { emit(`AGE ${label} ${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)}`); return; }
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const picks = [];
  for (let y = 0; y < h && picks.length < FLIPS; y++) for (let x = 0; x < w && picks.length < FLIPS; x++) {
    const l = { x, y };
    if (isWater(l)) continue;
    const a = owner(l);
    if (a < 0 || !majors().includes(a)) continue;
    const d = districtName(l);
    if (/CITY_CENTER/.test(d) || centersNear(l, 1)) continue;
    const hasDistrict = d !== "none" && d !== "?";
    if ((MODE === "district") !== hasDistrict) continue;
    const b = buyerFor(l, a);
    if (!b || !b.adj) continue;
    picks.push({ l, a, b });
  }
  for (const p of picks) {
    emit(`FLIP ${label} ${MODE} ${p.l.x},${p.l.y} ${p.a}->${p.b.b} dist=${districtName(p.l)} cons=${js(consNames(p.l))}`);
    safe(() => p.b.c.purchasePlot(p.l));
  }
  await later(6000);
  emit(`LANDED ${label}: ${picks.filter((p) => owner(p.l) === p.b.b).length}/${picks.length} mode=${MODE}`);
}
const TURNS3 = 30;
let turnsSeen = 0, startTurn = -1, lastTurn = -1, lastTurnAt = 0, busy = false;
function endTurn2() {
  try {
    if (Date.now() - lastTurnAt > 60000 && typeof Autoplay !== "undefined") {
      emit(`ENDTURN stuck on turn ${safe(() => Game.turn)} blocker=${blockerName()}: one Autoplay turn`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      lastTurnAt = Date.now();
    } else if (Players.get(local).isTurnActive) {
      safe(() => UI.Player.deselectAllUnits());
      if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
    }
  } catch (e) { emit("ENDTURN threw " + e); }
  setTimeout(endTurn2, 5000);
}
async function onNewTurn(t) {
  busy = true;
  const k = ++turnsSeen; // Game.turn restarts at 1 in a new age
  emit(`TURN k=${k} turn=${t}`);
    if (k >= TURNS3) { emit(`DONE harness transition finished, survived ${TURNS3} turns, ${flipsDone} flips`); return; }
  await valuableWave(`T${k}`, 3);
  busy = false;
}
function turnPoll() {
  const t = safe(() => Game.turn, -1);
  if (!busy && t !== lastTurn && safe(() => Players.get(local).isTurnActive, false)) {
    lastTurn = t; lastTurnAt = Date.now();
    onNewTurn(t).catch((e) => emit("onNewTurn threw " + e));
  }
  setTimeout(turnPoll, 2000);
}
async function run() {
  local = GameContext.localPlayerID;
  startTurn = safe(() => Game.turn, 0); lastTurn = startTurn; lastTurnAt = Date.now();
  emit(`VALUABLE start turn=${startTurn} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} majors=${js(majors())}`);
  const caps = [];
  for (const p of majors().slice(0, 3)) for (const c of citiesOf(p).slice(0, 1)) caps.push(c.location);
  emit(`DISTRICT READ check: ${caps.map((l) => `${l.x},${l.y} probe=${districtName(l)} mod=${modDistrictRead(l)}`).join(" | ")}`);
  await valuableWave("T0", 6);
  busy = false;
  turnPoll();
  endTurn2();
}
emit("attached transition-" + MODE);
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
