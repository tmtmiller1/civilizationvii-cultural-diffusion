// cdh-game-missionary.js: game scope, deployed as ui/cdh-game.js. Does a missionary order sent while a rural district
// tile is changing hands crash the game? (dev only)
//
// Player report (2026-10-06): the crash needs both Cultural Diffusion and AutoMissionary (Workshop 3773763645).
// AutoMissionary sends MOVE_TO / SPREAD_RELIGION for the local player's missionaries 0.9 s and 2.4 s after
// PlayerTurnActivated, aimed at rival settlements' rural district tiles; Cultural Diffusion's purchasePlot on those
// same border tiles is sent on PlayerTurnActivated and lands about 3 s later. Hypothesis: an order on a tile whose
// owning city changes in flight crashes the engine. Run with NO_MOD=1: this script imports nothing from either mod
// and replays both mods' calls itself, so the engine's reaction is the only thing measured.
//
// MODE "flip": each turn, every missionary parked on or beside its target tile sees the tile change hands (alternating
// rival -> us -> rival, so one tile can be reused), then gets AutoMissionary's orders at +0.9 s and +2.4 s.
// MODE "noflip": the control, the same orders on the same schedule with no ownership change.
// Needs an Exploration save where the local player has founded a religion. Without one it reports SETUP and stops.

const MODE = "flip";
const TURNS = 16;
const WANT_MISSIONARIES = 3;
const TAG = "[CDH]";

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }

let local = -1;
const owner = (l) => safe(() => GameplayMap.getOwner(l.x, l.y), -9);
const isWater = (l) => safe(() => !!GameplayMap.isWater(l.x, l.y), true);
const locOf = (i) => GameplayMap.getLocationFromIndex(i);
const dist = (a, b) => safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99);
const key = (l) => l.x + "," + l.y;
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
function majors() { return safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []); }
function citiesOf(pid) { return safe(() => Players.get(pid).Cities.getCities() || [], []); }
function nearestCity(pid, l) {
  let best = null;
  for (const c of citiesOf(pid)) { const d = dist(c.location, l); if (!best || d < best.d) best = { c, d }; }
  return best;
}
function cityAt(l) { return safe(() => { const id = MapCities.getCity(l.x, l.y); return id != null ? Cities.get(id) : null; }, null); }
function blockerName() {
  return safe(() => {
    const b = Game.Notifications.getEndTurnBlockingType(local);
    for (const k of Object.keys(EndTurnBlockingTypes)) if (EndTurnBlockingTypes[k] === b) return k;
    return String(b);
  }, "?");
}

// Missionary detection and orders, copied from AutoMissionary 1.18 (ui/auto-missionary.js) so the engine sees the
// same requests.
function isMissionary(unit) {
  const def = safe(() => GameInfo.Units.lookup(unit.type), null);
  if (!def) return false;
  if (def.UnitType === "UNIT_MISSIONARY") return true;
  return safe(() => GameInfo.UnitReplaces.filter((r) => r.CivUniqueUnitType === def.UnitType && r.ReplacesUnitType === "UNIT_MISSIONARY").length > 0, false);
}
function missionaries() {
  return safe(() => (Players.get(local).Units.getUnits() || []).filter(isMissionary), []);
}
function plotArgs(l) { return { X: l.x, Y: l.y, UnitAbilityType: -1 }; }
function spread(unitId, l) {
  const r = safe(() => Game.UnitOperations.canStart(unitId, "UNITOPERATION_SPREAD_RELIGION", plotArgs(l), false), null);
  if (!r?.Success) return "spread-no(" + js(r?.FailureReasons ?? r) + ")";
  safe(() => Game.UnitOperations.sendRequest(unitId, "UNITOPERATION_SPREAD_RELIGION", plotArgs(l)));
  return "spread-sent";
}
function moveTo(unitId, l) {
  const M = typeof UnitOperationMoveModifiers !== "undefined" ? UnitOperationMoveModifiers : null;
  const mods = M ? [(M.ATTACK ?? 0) + (M.MOVE_IGNORE_UNEXPLORED_DESTINATION ?? 0), M.MOVE_IGNORE_UNEXPLORED_DESTINATION ?? 0, M.NONE ?? 0] : [undefined];
  const op = typeof UnitOperationTypes !== "undefined" && UnitOperationTypes.MOVE_TO != null ? UnitOperationTypes.MOVE_TO : "UNITOPERATION_MOVE_TO";
  for (const m of mods) {
    const args = plotArgs(l);
    if (m !== undefined) args.Modifiers = m;
    if (safe(() => Game.UnitOperations.canStart(unitId, op, args, false)?.Success, false)) {
      safe(() => Game.UnitOperations.sendRequest(unitId, op, args));
      return "move-sent";
    }
  }
  const sw = safe(() => Game.UnitOperations.canStart(unitId, "UNITOPERATION_SWAP_UNITS", plotArgs(l), false)?.Success, false);
  if (sw) { safe(() => Game.UnitOperations.sendRequest(unitId, "UNITOPERATION_SWAP_UNITS", plotArgs(l))); return "swap-sent"; }
  return "move-no";
}

// A target is a rival major's rural district tile, away from its city center, touching land we own, so one of our
// cities can buy it (contiguous purchasePlot) and the rival's nearest city can buy it back.
// Whole-map scan, cached per turn. Tiles touching our land come first (a contiguous purchasePlot is free), then any
// rival rural tile within 6 of one of our cities (purchasePlot still lands; the run grants gold for it).
let targetCache = null, targetCacheTurn = -1;
function mapTargets() {
  const t = safe(() => Game.turn, -1);
  if (targetCache && targetCacheTurn === t) return targetCache;
  const out = [];
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const ms = majors();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = { x, y };
    const a = owner(l);
    if (a < 0 || a === local || !ms.includes(a) || isWater(l)) continue;
    if (districtName(l) !== "DISTRICT_RURAL") continue;
    if (neighbors(l).some((n) => /CITY_CENTER/.test(districtName(n)))) continue;
    const ours = nearestCity(local, l);
    if (!ours || ours.d > 6) continue;
    out.push({ l, rival: a, adj: neighbors(l).some((n) => owner(n) === local), ourCity: ours.c, ourD: ours.d });
  }
  out.sort((p, q) => (q.adj - p.adj) || (p.ourD - q.ourD));
  targetCache = out; targetCacheTurn = t;
  emit(`TARGETS turn=${t} candidates=${out.length} adjacent=${out.filter((o) => o.adj).length} first=${js(out.slice(0, 5).map((o) => key(o.l) + "/p" + o.rival + (o.adj ? "/adj" : "")))}`);
  return out;
}
function targetsNear(from, taken) {
  return mapTargets().filter((o) => !taken.has(key(o.l))).map((o) => ({ ...o, d: dist(from, o.l) }))
    .sort((p, q) => (q.adj - p.adj) || (p.d - q.d));
}

function buyMissionaries(n) {
  const rows = [GameInfo.Types.lookup("UNIT_MISSIONARY")];
  for (const r of safe(() => GameInfo.UnitReplaces.filter((x) => x.ReplacesUnitType === "UNIT_MISSIONARY"), [])) rows.push(GameInfo.Types.lookup(r.CivUniqueUnitType));
  safe(() => Players.grantYield(local, YieldTypes.YIELD_GOLD, 3000));
  let bought = 0;
  // Buy in the cities nearest the targets, so the missionaries start beside them.
  const near = [...new Set(mapTargets().map((o) => o.ourCity))];
  const order = [...near, ...citiesOf(local).filter((c) => !near.includes(c))];
  for (const c of order) {
    if (bought >= n) break;
    for (const t of rows.filter(Boolean)) {
      const args = { UnitType: t.Hash };
      const r = safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.PURCHASE, args, false), null);
      if (r?.Success) {
        safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.PURCHASE, args));
        emit(`BUY ${t.Type} in ${safe(() => Locale.compose(c.name), "?")} at ${key(c.location)}`);
        bought++;
        break;
      }
    }
  }
  return bought;
}

const assigned = new Map(); // unit key -> { l, rival }
let pairs = 0, flips = 0, ordersSent = 0;

function assign() {
  const taken = new Set([...assigned.values()].map((t) => key(t.l)));
  for (const u of missionaries().slice(0, WANT_MISSIONARIES)) {
    const k = safe(() => ComponentID.toLogString(u.id), String(u.id?.id));
    if (assigned.has(k)) continue;
    const t = targetsNear(u.location, taken)[0];
    if (!t) { emit(`ASSIGN ${k} at ${key(u.location)}: no target on the map`); continue; }
    assigned.set(k, t); taken.add(key(t.l));
    emit(`ASSIGN ${k} at ${key(u.location)} -> ${key(t.l)} rival=${t.rival} d=${t.d} city=${safe(() => Locale.compose(cityAt(t.l)?.name), "?")}`);
  }
}

// One turn: flips first (as Cultural Diffusion does on PlayerTurnActivated), then AutoMissionary's two order passes.
async function turnStep(label) {
  assign();
  const ready = [];
  for (const u of missionaries()) {
    const k = safe(() => ComponentID.toLogString(u.id), String(u.id?.id));
    const t = assigned.get(k);
    if (!t) continue;
    const d = dist(u.location, t.l);
    if (d > 1) {
      emit(`TRAVEL ${label} ${k} at ${key(u.location)} -> ${key(t.l)} d=${d}: ${moveTo(u.id, t.l)}`);
      continue;
    }
    ready.push({ u, k, t });
  }
  for (const r of ready) {
    if (MODE !== "flip") continue;
    const now = owner(r.t.l);
    const buyer = now === local ? r.t.rival : local;
    const near = nearestCity(buyer, r.t.l);
    if (!near) { emit(`FLIP ${label} ${key(r.t.l)}: no city for ${buyer}`); continue; }
    safe(() => near.c.purchasePlot(r.t.l));
    flips++;
    emit(`FLIP ${label} ${key(r.t.l)} ${now}->${buyer} via ${key(near.c.location)} dist=${districtName(r.t.l)} unitOn=${dist(r.u.location, r.t.l) === 0}`);
  }
  await later(900);
  for (const r of ready) {
    const u = safe(() => Units.get(r.u.id), null);
    if (!u) { emit(`ORDER1 ${label} ${r.k}: unit gone`); continue; }
    const on = dist(u.location, r.t.l) === 0;
    const res = on ? spread(u.id, r.t.l) + " " + moveTo(u.id, neighbors(r.t.l).find((n) => !isWater(n)) ?? r.t.l) : moveTo(u.id, r.t.l);
    ordersSent++; pairs++;
    emit(`ORDER1 ${label} ${r.k} on=${on} owner=${owner(r.t.l)}: ${res}`);
  }
  await later(1500);
  for (const r of ready) {
    const u = safe(() => Units.get(r.u.id), null);
    if (!u) continue;
    const on = dist(u.location, r.t.l) === 0;
    const res = on ? spread(u.id, r.t.l) : moveTo(u.id, r.t.l);
    ordersSent++;
    emit(`ORDER2 ${label} ${r.k} on=${on} owner=${owner(r.t.l)}: ${res}`);
  }
  await later(3600);
  for (const r of ready) {
    const u = safe(() => Units.get(r.u.id), null);
    emit(`AFTER ${label} ${r.k} tile=${key(r.t.l)} owner=${owner(r.t.l)} dist=${districtName(r.t.l)} unit=${u ? key(u.location) : "gone"} city=${safe(() => Locale.compose(cityAt(r.t.l)?.name), "?")}`);
  }
  emit(`TALLY ${label} mode=${MODE} ready=${ready.length} flips=${flips} pairs=${pairs} orders=${ordersSent}`);
}

let turnsSeen = 0, lastTurnAt = 0, busy = false, finished = false, lastHandledTurn = -1;
function endTurn() {
  if (finished) return;
  try {
    if (Date.now() - lastTurnAt > 60000 && typeof Autoplay !== "undefined") {
      emit(`ENDTURN stuck on turn ${safe(() => Game.turn)} blocker=${blockerName()}: one Autoplay turn`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      lastTurnAt = Date.now();
    } else if (!busy && Players.get(local).isTurnActive) {
      safe(() => UI.Player.deselectAllUnits());
      if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
    }
  } catch (e) { emit("ENDTURN threw " + e); }
  setTimeout(endTurn, 5000);
}
async function onNewTurn() {
  // PlayerTurnActivated can fire more than once for one game turn; count game turns, not events.
  const gt = safe(() => Game.turn, -1);
  if (gt === lastHandledTurn) return;
  lastHandledTurn = gt;
  busy = true; lastTurnAt = Date.now();
  const k = ++turnsSeen;
  emit(`TURN k=${k} turn=${safe(() => Game.turn)} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)}`);
  if (k > TURNS) {
    finished = true;
    emit(`DONE harness missionary finished mode=${MODE}, survived ${TURNS} turns, flips=${flips} pairs=${pairs} orders=${ordersSent}`);
    return;
  }
  if (missionaries().length < WANT_MISSIONARIES) buyMissionaries(WANT_MISSIONARIES - missionaries().length);
  await turnStep(`T${k}`);
  busy = false;
}

async function run() {
  local = GameContext.localPlayerID;
  const age = safe(() => GameInfo.Ages.lookup(Game.age).AgeType);
  const rel = safe(() => Players.Religion?.get(local)?.getReligionType?.(), null);
  const ms = missionaries();
  emit(`SETUP mode=${MODE} turn=${safe(() => Game.turn)} age=${age} religion=${rel}:${safe(() => GameInfo.Religions.lookup(rel)?.ReligionType, "none")} missionaries=${ms.length} cities=${citiesOf(local).length} majors=${js(majors())}`);
  if (age !== "AGE_EXPLORATION" || !safe(() => GameInfo.Religions.lookup(rel), null)) {
    finished = true;
    emit(`DONE harness missionary finished: unusable save (needs Exploration and a founded religion)`);
    return;
  }
  if (ms.length < WANT_MISSIONARIES) {
    buyMissionaries(WANT_MISSIONARIES - ms.length);
    await later(4000);
    emit(`SETUP after buy: missionaries=${missionaries().length}`);
  }
  engine.on("PlayerTurnActivated", (d) => {
    if (finished || busy || d?.player !== local) return;
    onNewTurn().catch((e) => { busy = false; emit("onNewTurn threw " + e); });
  });
  await onNewTurn();
  endTurn();
}

emit("attached missionary-" + MODE);
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
