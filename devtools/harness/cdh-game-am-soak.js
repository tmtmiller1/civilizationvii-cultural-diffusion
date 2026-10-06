// cdh-game-am-soak.js: game scope. The shipped mod beside the real AutoMissionary (Workshop 3773763645), both on,
// for a long soak (dev only). Run with EXTRA_MOD=<AutoMissionary folder> and the mod enabled (no NO_MOD).
//
// Player report (2026-10-06): a crash that needs both mods. This is the faithful version of cdh-game-missionary.js:
// nothing is replayed, both mods run their own code. The script only sets the stage and watches:
//   - turns AutoMissionary's Auto-Spread on through its own settings API (globalThis.AutoMissionarySettings)
//   - keeps MISSIONARIES missionaries alive while the local player has a religion (buys them near rival borders)
//   - seeds heavy culture on frontier tiles every SEED_EVERY turns, so Cultural Diffusion flips a lot
//   - per turn: tiles whose owner changed, missionaries on or beside them, missionaries idle with moves left,
//     charges, missionaries gone, the mod's own invariants, and every uncaught JS error
// Works from Antiquity through the age transition (AutoMissionary has no units there, but its UI is loaded) and from
// Exploration. After a transition the UI scripts reload and this script starts again; it stops EXP_TURNS turns into
// Exploration, or after MAX_TURNS turns seen in one load.
import { loadState, saveState } from "/cultural-diffusion/ui/cd-state.js";

const MAX_TURNS = 40;
const EXP_TURNS = 16;
const SEED_EVERY = 5;
const MISSIONARIES = 6;
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
const unkey = (k) => { const [x, y] = k.split(",").map(Number); return { x, y }; };
function ring(l, r) { return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, r).map(locOf), []); }
const ageType = () => safe(() => GameInfo.Ages.lookup(Game.age).AgeType, "?");
function districtName(l) {
  return safe(() => {
    const d = Districts.getAtLocation(l);
    if (!d) return "none";
    for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return k;
    return "type" + d.type;
  }, "?");
}
function majors() { return safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []); }
function citiesOf(pid) { return safe(() => Players.get(pid).Cities.getCities() || [], []); }
function allCities() {
  const out = [];
  for (const p of safe(() => Players.getAlive(), [])) for (const c of safe(() => p.Cities.getCities() || [], [])) out.push({ c, owner: p.id, loc: { x: c.location.x, y: c.location.y } });
  return out;
}
function blockerName() {
  return safe(() => {
    const b = Game.Notifications.getEndTurnBlockingType(local);
    for (const k of Object.keys(EndTurnBlockingTypes)) if (EndTurnBlockingTypes[k] === b) return k;
    return String(b);
  }, "?");
}

// Uncaught errors from any script in this context (both mods share it with this harness).
let jsErrors = 0;
safe(() => window.addEventListener("error", (e) => { jsErrors++; emit(`JSERR ${e?.message} @ ${e?.filename}:${e?.lineno}`); }));
safe(() => window.addEventListener("unhandledrejection", (e) => { jsErrors++; emit(`JSREJ ${String(e?.reason)}`); }));

// ---- AutoMissionary ----
function amPresent() { return typeof globalThis.AutoMissionarySettings === "object" && globalThis.AutoMissionarySettings !== null; }
function amEnable() {
  if (!amPresent()) return "absent";
  return js(safe(() => globalThis.AutoMissionarySettings.set({ autoSpread: true, garrisonLastCharge: false, ignoreAsleep: true }), "set threw"));
}
function isMissionary(unit) {
  const def = safe(() => GameInfo.Units.lookup(unit.type), null);
  if (!def) return false;
  if (def.UnitType === "UNIT_MISSIONARY") return true;
  return safe(() => GameInfo.UnitReplaces.filter((r) => r.CivUniqueUnitType === def.UnitType && r.ReplacesUnitType === "UNIT_MISSIONARY").length > 0, false);
}
function missionaries() { return safe(() => (Players.get(local).Units.getUnits() || []).filter(isMissionary), []); }
function religionType() {
  const r = safe(() => Players.Religion?.get(local)?.getReligionType?.(), null);
  return safe(() => GameInfo.Religions.lookup(r), null) ? r : null;
}
function charges(u) {
  const r = safe(() => Game.UnitOperations.canStart(u.id, "UNITOPERATION_SPREAD_RELIGION", { X: -9999, Y: -9999, UnitAbilityType: -1 }, false), null);
  return typeof r?.ChargesRemaining === "number" ? r.ChargesRemaining : "?";
}
function frontierCities() {
  // Our cities ranked by how close the nearest rival major's land is.
  const ms = majors();
  return citiesOf(local).map((c) => {
    const near = ring(c.location, 6).filter((l) => { const o = owner(l); return o >= 0 && o !== local && ms.includes(o); });
    return { c, n: near.length };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.c);
}
function topUpMissionaries(label) {
  if (religionType() == null) return;
  const have = missionaries().length;
  if (have >= MISSIONARIES) return;
  const rows = [GameInfo.Types.lookup("UNIT_MISSIONARY")];
  for (const r of safe(() => GameInfo.UnitReplaces.filter((x) => x.ReplacesUnitType === "UNIT_MISSIONARY"), [])) rows.push(GameInfo.Types.lookup(r.CivUniqueUnitType));
  safe(() => Players.grantYield(local, YieldTypes.YIELD_GOLD, 4000));
  let bought = 0;
  const cities = [...frontierCities(), ...citiesOf(local)];
  for (const c of cities) {
    if (have + bought >= MISSIONARIES) break;
    for (const t of rows.filter(Boolean)) {
      const args = { UnitType: t.Hash };
      if (safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.PURCHASE, args, false)?.Success, false)) {
        safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.PURCHASE, args));
        bought++;
        break;
      }
    }
  }
  emit(`BUY ${label}: had ${have}, bought ${bought}`);
}

// ---- Cultural Diffusion ----
function seed(label) {
  const st = loadState();
  const cfg = safe(() => culturalDiffusion.config(), {});
  const maxD = Math.max(4, cfg.flipMaxDistance || 6);
  let n = 0;
  for (const p of majors()) {
    let mine = 0;
    for (const cr of allCities().filter((c) => c.owner === p)) {
      for (const l of ring(cr.loc, maxD)) {
        if (mine >= 40) break;
        if (dist(cr.loc, l) < 3 || isWater(l)) continue;
        if (owner(l) === p) continue;
        if (!ring(l, 1).some((q) => owner(q) === p)) continue;
        const k = key(l);
        st.field[k] = { ...(st.field[k] || {}), [String(p)]: 4000 };
        mine++; n++;
      }
    }
  }
  emit(`SEED ${label}: ${n} frontier tiles seeded, state bytes=${saveState(st)}`);
}
function invariants(label) {
  const st = safe(() => culturalDiffusion.state(), null);
  if (!st || typeof st !== "object") { emit(`INV ${label}: no state (${st})`); return; }
  const cities = allCities();
  const claims = Object.entries(st.claims || {});
  let stale = 0, localInner = 0, district = 0;
  for (const [k, c] of claims) {
    const l = unkey(k); const o = owner(l);
    if (o !== c.by) stale++;
    if (c.by !== local && o === c.by && cities.some((lc) => lc.owner === local && dist(lc.loc, l) <= 3)) localInner++;
    if (o === c.by && /URBAN|CITY_CENTER/.test(districtName(l))) district++;
  }
  const center = cities.filter((cc) => owner(cc.loc) !== cc.owner).length;
  emit(`INV ${label}: claims=${claims.length} stale=${stale} localInner=${localInner} district=${district} center=${center} pending=${Object.keys(st.pending || {}).length} bytes=${safe(() => JSON.stringify(st).length, -1)}`);
}

// ---- per-turn observation ----
function ownerSnapshot() {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const m = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = owner({ x, y });
  return { w, h, m };
}
function changedTiles(a, b) {
  const out = [];
  for (let i = 0; i < a.m.length; i++) if (a.m[i] !== b.m[i]) out.push({ x: i % a.w, y: Math.floor(i / a.w), from: a.m[i], to: b.m[i] });
  return out;
}
function unitSnap() {
  return missionaries().map((u) => ({ id: safe(() => ComponentID.toLogString(u.id), "?"), loc: { x: u.location.x, y: u.location.y }, moves: safe(() => u.Movement.movementMovesRemaining, "?"), queued: !!safe(() => Units.getQueuedOperationDestination(u.id), null), ch: charges(u) }));
}
let totals = { flipsNearMissionary: 0, onFlipped: 0, districtFlipsNearMissionary: 0, idleWithMoves: 0, gone: 0 };

async function observeTurn(label) {
  const t0 = ownerSnapshot();
  const u0 = unitSnap();
  await later(9000); // both mods act on PlayerTurnActivated; purchasePlot lands ~3 s later, AutoMissionary at +0.9/+2.4 s
  const t1 = ownerSnapshot();
  const u1 = unitSnap();
  const ch = changedTiles(t0, t1);
  const ids1 = new Set(u1.map((u) => u.id));
  const gone = u0.filter((u) => !ids1.has(u.id)).length;
  let near = 0, on = 0, dnear = 0;
  for (const c of ch) {
    const close = u1.filter((u) => dist(u.loc, c) <= 1);
    if (close.length) { near++; if (districtName(c) !== "none") dnear++; }
    if (u1.some((u) => dist(u.loc, c) === 0)) on++;
  }
  const moved = u1.filter((u) => { const p = u0.find((q) => q.id === u.id); return p && (p.loc.x !== u.loc.x || p.loc.y !== u.loc.y); }).length;
  const idle = u1.filter((u) => typeof u.moves === "number" && u.moves > 0 && !u.queued && u.ch !== 0).length;
  totals.flipsNearMissionary += near; totals.onFlipped += on; totals.districtFlipsNearMissionary += dnear; totals.idleWithMoves += idle; totals.gone += gone;
  emit(`OBS ${label}: age=${ageType()} turn=${safe(() => Game.turn)} ownerChanges=${ch.length} missionaries=${u1.length} moved=${moved} idleWithMoves=${idle} gone=${gone} flipsNearMissionary=${near} (district ${dnear}) onFlipped=${on} jsErrors=${jsErrors} amAuto=${safe(() => globalThis.AutoMissionarySettings.isAutoSpread(), "absent")}`);
  if (near) emit(`OBS-NEAR ${label}: ${ch.filter((c) => u1.some((u) => dist(u.loc, c) <= 1)).slice(0, 8).map((c) => `${key(c)} ${c.from}->${c.to} ${districtName(c)}`).join(" | ")}`);
  if (u1.length) emit(`UNITS ${label}: ${u1.slice(0, 8).map((u) => `${u.id}@${key(u.loc)} mv=${u.moves} ch=${u.ch}${u.queued ? " q" : ""}`).join(" ")}`);
}

let turnsSeen = 0, lastTurn = -1, lastTurnAt = 0, busy = false, finished = false;
function endTurn() {
  if (finished) return;
  try {
    if (Date.now() - lastTurnAt > 90000 && typeof Autoplay !== "undefined") {
      emit(`ENDTURN stuck on turn ${safe(() => Game.turn)} blocker=${blockerName()}: one Autoplay turn`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      lastTurnAt = Date.now();
    } else if (!busy && safe(() => Players.get(local).isTurnActive, false)) {
      safe(() => UI.Player.deselectAllUnits());
      if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
    }
  } catch (e) { emit("ENDTURN threw " + e); }
  setTimeout(endTurn, 4000);
}
async function onNewTurn(t) {
  busy = true;
  const k = ++turnsSeen;
  emit(`TURN k=${k} turn=${t} age=${ageType()} blocker=${blockerName()}`);
  await observeTurn(`T${k}`);
  invariants(`T${k}`);
  if (k >= MAX_TURNS || (ageType() === "AGE_EXPLORATION" && startAge === "AGE_ANTIQUITY_RELOADED" && safe(() => Game.turn, 0) >= EXP_TURNS)) {
    finished = true;
    emit(`DONE harness am-soak finished turns=${k} age=${ageType()} totals=${js(totals)} jsErrors=${jsErrors}`);
    return;
  }
  if (k % SEED_EVERY === 0) seed(`T${k}`);
  topUpMissionaries(`T${k}`);
  if (amPresent() && !safe(() => globalThis.AutoMissionarySettings.isAutoSpread(), false)) emit(`AM auto-spread found OFF at T${k}; re-enabled ${amEnable()}`);
  busy = false;
}
function turnPoll() {
  if (finished) return;
  const t = safe(() => Game.turn, -1);
  if (!busy && t !== lastTurn && safe(() => Players.get(local).isTurnActive, false)) {
    lastTurn = t; lastTurnAt = Date.now();
    onNewTurn(t).catch((e) => { emit("onNewTurn threw " + e); busy = false; });
  }
  setTimeout(turnPoll, 1000);
}
let startAge = "?";
async function run() {
  local = GameContext.localPlayerID;
  startAge = ageType();
  // A reload into Exploration with Game.turn small means we came through a transition in this run.
  if (startAge === "AGE_EXPLORATION" && safe(() => Game.turn, 99) <= 3) startAge = "AGE_ANTIQUITY_RELOADED";
  lastTurn = safe(() => Game.turn, 0); lastTurnAt = Date.now();
  emit(`AMSOAK start turn=${lastTurn} age=${ageType()} startAge=${startAge} local=${local} amPresent=${amPresent()} amSet=${amEnable()} religion=${religionType()} missionaries=${missionaries().length} cdConfig=${js(safe(() => { const c = culturalDiffusion.config(); return { claimOnlyUnowned: c.claimOnlyUnowned, aiCultureFlips: c.aiCultureFlips, flipMaxDistance: c.flipMaxDistance, maxFlipsPerTurn: c.maxFlipsPerTurn }; }, "cd absent"))}`);
  invariants("T0-pre");
  seed("T0");
  topUpMissionaries("T0");
  emit(`T0 runNow=${js(safe(() => culturalDiffusion.runNow(), "ERR"))}`);
  await later(8000);
  invariants("T0-post");
  busy = false;
  turnPoll();
  endTurn();
}
emit("attached am-soak");
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
