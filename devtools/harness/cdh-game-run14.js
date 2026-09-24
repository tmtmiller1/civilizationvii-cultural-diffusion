// cdh-game-run14.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 14 (dev only).
//
// ONE QUESTION, the one run 13 failed to execute: when a plot's owner ACTUALLY CHANGES under a foreign unit, does the
// ENGINE move that unit off by itself?
//
// Run 13 settled only the script surface: no callable unit operation moves any unit (ours or a rival's), and
// UNITOPERATION_TELEPORT_TO is not even in the runtime enum. That says nothing about the engine's own C++ behaviour on
// an ownership change - and the base game plainly does relocate units when borders close. If it does that for OUR
// claim too, then cd-units.js is unnecessary rather than impossible, and the mod should simply claim and let the engine
// sort the occupant out.
//
// Run 13's S4 never tested it: the purchase on the occupied plot never landed, so no ownership change was ever
// observed. This run fixes exactly that - it does not conclude anything until it has CONFIRMED we own the plot.
//
//   A CANDIDATES  every foreign unit standing on an unowned land plot near our cities, with the nearest city that
//                 might buy it. Logged so a failure to find a fixture is visible rather than silent.
//   B BUY+CONFIRM refunded purchasePlot on that plot, then owner re-read at +2/+5/+8 s and next turn. NOT a fixture
//                 until the owner reads as us. Tries the next candidate, and the next turn, until one lands.
//   C WATCH       once the plot IS ours: where is the unit at +2/+5/+8 s, does it still have legal moves
//                 (Movement/getReachableMovement), and where is it over the following turns.
//   D VERDICT     NATIVE-BUMP (engine moved it off within seconds) / LEFT-ON-ITS-TURN / STUCK-ON-OUR-PLOT (the
//                 reported symptom, and the only case where the mod needs to do anything at all).
//
// The mod's own pass is irrelevant here and stays out of the way: the harness buys the plot directly.
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

const TAG = "[CDH]";
const MAX_TURNS = 12;
const WATCH_TURNS = 3;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
function key(l) { return l.x + "," + l.y; }
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function owningCity(l) {
  return safe(() => {
    const c = GameplayMap.getOwningCityFromXY(l.x, l.y);
    const id = c && c.id;
    if (typeof id === "number") return id;
    if (id && typeof id.id === "number") return id.id;
    return -1;
  }, -9);
}
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function cityName(c) { return safe(() => Locale.compose(c.name), "?"); }
function nearest(l, cities) {
  let best = null; let bd = 1e9;
  for (const c of cities) { const d = dist(c.location, l); if (d < bd) { bd = d; best = c; } }
  return best ? { city: best, d: bd } : null;
}
function landClean(l) {
  return safe(() => {
    if (GameplayMap.isWater(l.x, l.y)) return false;
    const blocked = typeof GameplayMap.isImpassable === "function" ? GameplayMap.isImpassable(l.x, l.y) : GameplayMap.isMountain(l.x, l.y);
    return !blocked;
  }, false);
}
function gold() { return safe(() => Players.get(local).Treasury.goldBalance, null); }

/** purchasePlot with the cost put straight back, exactly as the mod does it. */
function refundBuy(city, l) {
  const g0 = gold();
  const call = safe(() => { city.purchasePlot(l); return "called"; }, "threw");
  const g1 = gold();
  const spent = (typeof g0 === "number" && typeof g1 === "number") ? Math.max(0, g0 - g1) : 0;
  if (spent > 0) safe(() => Players.get(local).Treasury.changeGoldBalance(spent));
  return { call, spent };
}

// --- units -----------------------------------------------------------------------------------------------------------
function unitRow(u, cid) {
  return u ? { cid: u.id || cid, owner: u.owner, type: safe(() => GameInfo.Units.lookup(u.type).UnitType, "?"),
    loc: u.location ? { x: u.location.x, y: u.location.y } : null } : null;
}
function unitsAt(l) {
  return safe(() => (MapUnits.getUnits(l.x, l.y) || []).map((cid) => unitRow(Units.get(cid), cid)).filter(Boolean), []);
}
function playerUnits(pid) {
  const raw = safe(() => Players.get(pid)?.Units?.getUnits?.(), null) || safe(() => Players.get(pid)?.Units?.getUnitIds?.(), null) || [];
  return safe(() => raw.map((u) => unitRow((u && u.location) ? u : Units.get(u), u)).filter(Boolean), []);
}
function whereIsUnit(cid) {
  const u = safe(() => Units.get(cid), null);
  return u && u.location ? { x: u.location.x, y: u.location.y } : null;
}
/** Can this unit still legally go anywhere? The "trapped" symptom, read rather than inferred. */
function mobility(cid) {
  const u = safe(() => Units.get(cid), null);
  if (!u) return { gone: true };
  return {
    moves: safe(() => u.Movement?.movementMovesRemaining, null),
    maxMoves: safe(() => u.Movement?.maxMoves, null),
    reachable: safe(() => (Units.getReachableMovement ? Units.getReachableMovement(cid) : u.Movement?.getReachableMovement?.())?.length, null)
  };
}

// --- A: candidates ---------------------------------------------------------------------------------------------------
function candidates() {
  const cities = localCities();
  const others = safe(() => Players.getAlive().filter((p) => p.id !== local).map((p) => p.id), []);
  const out = [];
  for (const pid of others) {
    for (const u of playerUnits(pid)) {
      if (!u.loc || u.loc.x < 0 || !landClean(u.loc)) continue;
      if (owner(u.loc) !== -1) continue;                    // unowned plots only: nothing else to argue with
      const near = nearest(u.loc, cities);
      if (!near || near.d > 8) continue;
      out.push({ unit: u, loc: u.loc, city: near.city, cityName: cityName(near.city), ring: near.d });
    }
  }
  return out.sort((a, b) => a.ring - b.ring);
}

// --- B: buy and CONFIRM ----------------------------------------------------------------------------------------------
/** Buy the plot and only report success once the OWNER READS AS US. Nothing is concluded from the call itself. */
async function buyAndConfirm(c) {
  const before = { owner: owner(c.loc), unit: whereIsUnit(c.unit.cid) };
  const buy = refundBuy(c.city, c.loc);
  const reads = [];
  for (const ms of [2000, 3000, 3000]) {
    await later(ms);
    reads.push({ owner: owner(c.loc), city: owningCity(c.loc), unit: whereIsUnit(c.unit.cid) });
  }
  const landed = reads[reads.length - 1].owner === local;
  emit(`B BUY ${key(c.loc)} unit=${c.unit.type} owner=${c.unit.owner} city=${c.cityName} ring=${c.ring} `
    + `buy=${J(buy)} before=${J(before)} reads=${J(reads)} => ${landed ? "OWNERSHIP-LANDED" : "DID-NOT-LAND"}`);
  return landed;
}

// --- C/D: what the engine does with the occupant ----------------------------------------------------------------------
let fixture = null;         // { loc, cid, type, unitOwner, claimedAtTurn, seen: [] }
async function takeFixture(c) {
  const ok = await buyAndConfirm(c);
  if (!ok) return false;
  const at = whereIsUnit(c.unit.cid);
  fixture = { loc: c.loc, cid: c.unit.cid, type: c.unit.type, unitOwner: c.unit.owner, claimedAtTurn: safe(() => Game.turn, -1),
    startedOnPlot: !!(at && at.x === c.loc.x && at.y === c.loc.y), seen: [] };
  // The seconds right after the ownership change are where a native bump would show up.
  for (const ms of [2000, 3000, 3000]) {
    await later(ms);
    const now = whereIsUnit(c.unit.cid);
    fixture.seen.push({ t: ms, at: now ? key(now) : "gone", onPlot: !!(now && now.x === c.loc.x && now.y === c.loc.y) });
  }
  emit(`C CLAIMED ${key(c.loc)} unit=${c.type || c.unit.type} owner=${c.unit.owner} startedOnPlot=${fixture.startedOnPlot} `
    + `seconds=${J(fixture.seen)} mobility=${J(mobility(c.unit.cid))} plotUnits=${J(unitsAt(c.loc))}`);
  const bumpedAtOnce = fixture.startedOnPlot && fixture.seen.some((s) => !s.onPlot);
  emit(`C EARLY VERDICT ${key(c.loc)} => ${!fixture.startedOnPlot ? "UNIT-HAD-ALREADY-STEPPED-OFF (retry for a clean fixture)"
    : bumpedAtOnce ? "NATIVE-BUMP: the engine moved it off within seconds of the ownership change"
      : "STILL-ON-OUR-PLOT after 8s (watching turns)"}`);
  return true;
}

// --- run -------------------------------------------------------------------------------------------------------------
let tried = 0;
async function tryFixture() {
  if (fixture && fixture.startedOnPlot) return;
  const list = candidates();
  emit(`A CANDIDATES n=${list.length} ${J(list.slice(0, 6).map((c) => ({ plot: key(c.loc), unit: c.unit.type, owner: c.unit.owner, ring: c.ring, city: c.cityName })))}`);
  for (const c of list.slice(0, 3)) {
    tried++;
    if (await takeFixture(c)) { if (fixture.startedOnPlot) return; }
  }
}

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 run14 turn=${safe(() => Game.turn)} local=${local} gold=${gold()} bump=${CONFIG.bumpForeignUnits}`);
  // The mod must not race us for these plots while we test the engine's own behaviour.
  CONFIG.diffusionEnabled = false;
  emit("S0 mod pass DISABLED for this run: the harness buys the plots itself");
  await tryFixture();
  emit("ACTIONS done; ending turns");
  setTimeout(endTurn, 6000);
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

function finalVerdict() {
  if (!fixture) { emit(`D VERDICT no fixture: no foreign unit stood on a plot we could buy in ${n} turns (tried ${tried})`); return; }
  const at = whereIsUnit(fixture.cid);
  const onPlot = !!(at && at.x === fixture.loc.x && at.y === fixture.loc.y);
  const early = fixture.startedOnPlot && fixture.seen.some((s) => !s.onPlot);
  emit(`D VERDICT plot=${key(fixture.loc)} unit=${fixture.type} owner=${fixture.unitOwner} startedOnPlot=${fixture.startedOnPlot} `
    + `ourPlot=${owner(fixture.loc) === local} unitAt=${at ? key(at) : "gone"} mobility=${J(mobility(fixture.cid))} => `
    + (!fixture.startedOnPlot ? "INCONCLUSIVE: the unit stepped off before the claim landed"
      : early ? "NATIVE-BUMP: engine relocated the occupant on the ownership change - the mod needs NO eviction"
        : onPlot ? "STUCK-ON-OUR-PLOT: the engine did NOT relocate it, and it has not left - the reported symptom"
          : "LEFT-ON-ITS-OWN-TURN: not bumped, but not trapped either"));
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(async () => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
    if (fixture) {
      const at = whereIsUnit(fixture.cid);
      emit(`C WATCH n=${n} plot=${key(fixture.loc)} owner=${owner(fixture.loc)} unitAt=${at ? key(at) : "gone"} `
        + `onPlot=${!!(at && at.x === fixture.loc.x && at.y === fixture.loc.y)} mobility=${J(mobility(fixture.cid))} `
        + `plotUnits=${J(unitsAt(fixture.loc))}`);
    }
    await tryFixture().catch((e) => emit("tryFixture threw " + e));
    const done = (fixture && fixture.startedOnPlot && n - 1 >= WATCH_TURNS) || n >= MAX_TURNS;
    if (done) { finalVerdict(); setTimeout(() => emit("DONE harness run14 finished"), 3000); return; }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run14");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    emit("LOAD GameStarted");
    setTimeout(() => { n = 1; run().catch((e) => emit("run threw " + e + " " + (e && e.stack))); }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
