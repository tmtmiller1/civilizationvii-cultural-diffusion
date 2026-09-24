// cdh-game-run17.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 17 (dev only).
//
// The reporter's TWO anomalies, each with the mistake that spoiled the earlier runs corrected.
//
// I  THE ABSORBED INDEPENDENT (read-only). Run 15 found that `Players.get(pid).Cities.getCities()` enumerates NOTHING
//    for an Independent Power (its settlement map listed only majors and city-states), while run 13 watched the mod
//    flip tiles "was owner 33" - so in this save `atWar(me, 33)` is FALSE and independent land is claimable. If
//    getCities() cannot see a village, then `isCoreProtected` - which finds city centres by walking getCities() -
//    cannot protect a village CENTRE, and taking a minor's centre plot absorbs the settlement (the mod's own Phase-5
//    probe note). This stage calls the SHIPPED gates against a REAL village centre and reports what they say. No writes.
//
// II THE TRAPPED SETTLER. Runs 14-15 used Independent Powers' units, which are hostile-by-default and may enter our
//    borders freely, so they could never be trapped by trespass. The report says "another civilisation's Settler",
//    i.e. a MAJOR AT PEACE with us - the only kind trespass binds. This stage builds a REAL enclosure around one:
//    every neighbour of its plot must be ours or buyable, so `enclosed` is a map fact, not a hope. Then it watches five
//    turns: a unit that never moves while enclosed is the reported symptom, caused by us. A unit that walks out proves
//    trespass does not strand it. Run 15's pen had one neighbour owned by a third player and the unit left through it.
//
// Purchases are issued in one batch and confirmed in ONE pass, so the whole pen is built inside a single turn of ours
// (AI units do not move during our turn) instead of taking a minute of confirm waits.
//
// TWO run-16 corrections:
//   * PEN DISTANCE. Run 16's pen was 8 rings from the city that bought it and the ENGINE RELEASED EVERY PLOT at the
//     turn roll, so the cage dissolved in the same turn the unit moved - inconclusive for the third time. Run 15 kept
//     nine plots at rings 4-7 for five turns, so a pen is only built at ring <= 6 now (the mod's own flipMaxDistance),
//     and the site scan RE-RUNS EVERY TURN until a peaceful major's unit wanders into that range.
//   * CENTRE DETECTION. Run 16 read district types to find a village centre and got "?" for every plot, so it found
//     none. A settlement centre is now "the owning CITY's location is this plot", which needs no district enum.
//
// The mod's own pass stays disabled: this measures the ENGINE and the mod's PURE gates, not the pass.
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { isCoreProtected, atWar, rivalClaimAllowed } from "/cultural-diffusion/ui/cd-borders.js";

const TAG = "[CDH]";
const MAX_TURNS = 14;
const WATCH_TURNS = 5;
const MAX_PEN_RING = 6;     // run 15 kept rings 4-7 for five turns; run 16 lost every plot at ring 8

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
/** The owning city's own location, or null - a settlement CENTRE is a plot that equals it. */
function owningCityLoc(l) {
  return safe(() => {
    const c = GameplayMap.getOwningCityFromXY(l.x, l.y);
    const loc = c && c.location;
    return loc && typeof loc.x === "number" ? { x: loc.x, y: loc.y } : null;
  }, null);
}
function isCityCentreAt(l) {
  const c = owningCityLoc(l);
  return !!(c && c.x === l.x && c.y === l.y);
}
function districtName(l) { const c = owningCityLoc(l); return c ? `owningCity@${c.x},${c.y}` : "none"; }
function neighbours(l) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, 1)
    .map((i) => GameplayMap.getLocationFromIndex(i))
    .filter((p) => p && !(p.x === l.x && p.y === l.y)), []);
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
function refundBuy(city, l) {
  const g0 = gold();
  const call = safe(() => { city.purchasePlot(l); return "called"; }, "threw");
  const g1 = gold();
  const spent = (typeof g0 === "number" && typeof g1 === "number") ? Math.max(0, g0 - g1) : 0;
  if (spent > 0) safe(() => Players.get(local).Treasury.changeGoldBalance(spent));
  return call;
}
function unitRow(u, cid) {
  return u ? { cid: u.id || cid, owner: u.owner, type: safe(() => GameInfo.Units.lookup(u.type).UnitType, "?"),
    loc: u.location ? { x: u.location.x, y: u.location.y } : null } : null;
}
function playerUnits(pid) {
  const raw = safe(() => Players.get(pid)?.Units?.getUnits?.(), null) || safe(() => Players.get(pid)?.Units?.getUnitIds?.(), null) || [];
  return safe(() => raw.map((u) => unitRow((u && u.location) ? u : Units.get(u), u)).filter(Boolean), []);
}
function whereIsUnit(cid) {
  const u = safe(() => Units.get(cid), null);
  return u && u.location ? { x: u.location.x, y: u.location.y } : null;
}

// --- I: the independent's village against the SHIPPED gates (read-only) -----------------------------------------------
function playerKinds() {
  return safe(() => (Players.getAlive() || []).map((p) => ({
    pid: safe(() => p.id, -1),
    major: safe(() => p.isMajor, null), minor: safe(() => p.isMinor, null), indep: safe(() => p.isIndependent, null),
    cities: safe(() => (p.Cities?.getCities?.() || []).length, "ERR"),
    units: safe(() => (p.Units?.getUnits?.() || []).length, "ERR"),
    war: safe(() => atWar(local, safe(() => p.id, -1)), "ERR")
  })), []);
}
/** Plots near our cities owned by a NON-major, with whether each is a settlement centre. */
function minorTerritory(kinds) {
  const minors = new Set(kinds.filter((k) => k.major === false).map((k) => k.pid));
  const seen = new Set();
  const out = [];
  for (const c of localCities()) {
    for (const p of inRadius(c.location, 8)) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const o = owner(p);
      if (!minors.has(o)) continue;
      out.push({ at: k, ownerPid: o, centre: isCityCentreAt(p), district: districtName(p), city: owningCity(p),
        ourRing: dist(c.location, p) });
    }
  }
  return out;
}
function stageI() {
  const kinds = playerKinds();
  emit(`I PLAYERS ${J(kinds)}`);
  const terr = minorTerritory(kinds);
  const centres = terr.filter((t) => t.centre);
  emit(`I MINOR-TERRITORY plots=${terr.length} centres=${centres.length} sample=${J(terr.slice(0, 8))}`);
  emit(`I CENTRES ${J(centres)}`);
  for (const c of centres.slice(0, 4)) {
    const [x, y] = c.at.split(",").map(Number);
    const loc = { x, y };
    const protectedAt0 = safe(() => isCoreProtected(loc, c.ownerPid, 0), "ERR");
    const protectedAnyOwner = safe(() => isCoreProtected(loc, -1, 0), "ERR");
    const claimable = safe(() => rivalClaimAllowed(loc, c.ownerPid, local, CONFIG), "ERR");
    emit(`I GATE centre=${c.at} ownerPid=${c.ownerPid} atWar=${safe(() => atWar(local, c.ownerPid), "ERR")} `
      + `isCoreProtected(owner)=${protectedAt0} isCoreProtected(any)=${protectedAnyOwner} rivalClaimAllowed=${claimable} => `
      + (claimable ? "THE MOD WOULD TAKE THIS VILLAGE CENTRE" : "blocked"));
  }
  if (!centres.length) emit("I no minor settlement centre within 8 rings of our cities - cannot test the gates here");
}

// --- II: a true enclosure around a MAJOR-AT-PEACE unit -----------------------------------------------------------------
let pen = null;
function peacefulMajors(kinds) {
  return new Set(kinds.filter((k) => k.major === true && k.pid !== local && k.war === false).map((k) => k.pid));
}
/** A unit of a major we are at PEACE with, on unowned land, whose whole ring is ours or buyable. */
function penSite(kinds) {
  const pids = peacefulMajors(kinds);
  emit(`II peaceful majors ${J([...pids])}`);
  const cities = localCities();
  const rows = [];
  for (const pid of pids) {
    for (const u of playerUnits(pid)) {
      if (!u.loc || u.loc.x < 0 || !landClean(u.loc) || owner(u.loc) !== -1) continue;
      const near = nearest(u.loc, cities);
      if (!near || near.d > 8) continue;
      const ring = neighbours(u.loc);
      const land = ring.filter((p) => landClean(p));
      const usable = land.filter((p) => owner(p) === local || owner(p) === -1);
      rows.push({ u, near, ring: land, usable: usable.length, land: land.length,
        blocked: land.length - usable.length });
    }
  }
  rows.sort((a, b) => a.blocked - b.blocked || a.near.d - b.near.d);
  // Run 16: a pen 8 rings out was released wholesale at the turn roll. Only ring <= MAX_PEN_RING survives.
  for (const r of rows) r.tooFar = r.near.d > MAX_PEN_RING;
  emit(`II SITES n=${rows.length} ${J(rows.slice(0, 6).map((r) => ({ at: key(r.u.loc), unit: r.u.type, owner: r.u.owner, ring: r.near.d, land: r.land, usable: r.usable, blocked: r.blocked, tooFar: r.tooFar })))}`);
  return rows.find((r) => r.blocked === 0 && !r.tooFar) || null;
}
async function buildPen(kinds) {
  const site = penSite(kinds);
  if (!site) { emit("II no site where a peaceful major's unit can be fully enclosed"); return false; }
  const centre = { x: site.u.loc.x, y: site.u.loc.y };
  const plots = [centre, ...site.ring];
  // One batch, then ONE confirm pass: the whole pen closes inside this turn of ours.
  for (const p of plots) {
    if (owner(p) === local) continue;
    const near = nearest(p, localCities());
    if (near) refundBuy(near.city, p);
  }
  await later(6000);
  const state = plots.map((p) => ({ at: key(p), owner: owner(p), city: owningCity(p) }));
  const ours = state.filter((s) => s.owner === local).length;
  emit(`II PEN centre=${key(centre)} unit=${site.u.type} owner=${site.u.owner} plots=${plots.length} ours=${ours} ${J(state)}`);
  pen = { cid: site.u.cid, type: site.u.type, unitOwner: site.u.owner, centre, ring: site.ring, history: [] };
  emit(`II PEN state ${J(penState())}`);
  return true;
}
function penState() {
  if (!pen) return null;
  const at = whereIsUnit(pen.cid);
  const onCentre = !!(at && at.x === pen.centre.x && at.y === pen.centre.y);
  const here = at || pen.centre;
  const escapes = neighbours(here).filter((p) => landClean(p) && owner(p) !== local).length;
  return { unitAt: at ? key(at) : "gone", onCentre, standingOnOurLand: owner(here) === local,
    ringOurs: pen.ring.filter((p) => owner(p) === local).length, ringTotal: pen.ring.length,
    escapeNeighbours: escapes, enclosed: owner(here) === local && escapes === 0 };
}

async function run() {
  local = GameContext.localPlayerID;
  CONFIG.diffusionEnabled = false;
  emit(`S0 run17 turn=${safe(() => Game.turn)} local=${local} gold=${gold()} modPass=DISABLED`);
  const kinds = playerKinds();
  stageI();
  await buildPen(kinds);   // retried every turn if no site qualifies yet
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

function verdict() {
  if (!pen) { emit("II VERDICT no pen built"); return; }
  const enclosedTurns = pen.history.filter((h) => h.enclosed).length;
  const movedWhileEnclosed = pen.history.some((h, i) => i > 0 && pen.history[i - 1].enclosed && h.unitAt !== pen.history[i - 1].unitAt);
  const st = penState();
  emit(`II VERDICT centre=${key(pen.centre)} unit=${pen.type} owner=${pen.unitOwner} enclosedTurns=${enclosedTurns}/${pen.history.length} `
    + `movedWhileEnclosed=${movedWhileEnclosed} now=${J(st)} history=${J(pen.history)} => `
    + (enclosedTurns === 0 ? "ENCLOSURE-NEVER-HELD (inconclusive)"
      : movedWhileEnclosed ? "LEFT-WHILE-ENCLOSED: trespass does NOT strand a unit"
        : "TRAPPED-BY-US: enclosed by our claims for every watched turn and it never moved"));
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
    if (pen) {
      const st = penState();
      pen.history.push({ n, ...st });
      emit(`II WATCH n=${n} ${J(st)}`);
      if (st.ringOurs === 0 && st.ringTotal > 0) emit(`II PEN DISSOLVED at n=${n}: the engine released our plots, cage gone`);
    } else {
      buildPen(playerKinds()).then((ok) => { if (ok) emit(`II PEN built late on turn ${safe(() => Game.turn)}`); })
        .catch((e) => emit("buildPen threw " + e));
    }
    const watched = pen ? pen.history.length : 0;
    if ((pen && watched >= WATCH_TURNS) || n >= MAX_TURNS) { verdict(); setTimeout(() => emit("DONE harness run17 finished"), 3000); return; }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run17");
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
