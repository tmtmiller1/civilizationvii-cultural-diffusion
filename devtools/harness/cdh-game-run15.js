// cdh-game-run15.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 15 (dev only).
//
// TWO questions, both left open by runs 13-14, and they have to be answered together because the first one
// CONFOUNDED the second one last time.
//
//   Q1 REVERSION  A plot we bought stopped being ours. Both earlier runs: plot 90,41 read owner=3 on the turn after a
//                 CONFIRMED purchase (owner=us, attached to a city, 2 s after the call), with the mod's own pass
//                 disabled. Is that general - does a claim near a rival silently revert - or is it about that plot?
//   Q2 TRAP       Can a foreign unit actually be STUCK inside our borders? Run 14 looked like "no, it walks out", but
//                 the plot had reverted by the turn it moved, so the unit was never in our territory when it left.
//                 The report also allows three different mechanisms, only one of which is ours:
//                   (a) our border closed over/around it; (b) it entered legally and lost access later; (c) it was
//                   never stuck - an idle AI Settler looks identical from outside, and war ejects it either way.
//                 (c) is separated by a MAP fact, not a unit API: a unit standing on our land with all six neighbours
//                 ours is enclosed by definition. One with an unowned neighbour that still does not move was idle.
//
// Instruments, rather than inferring from turn snapshots:
//   EV   engine.on PlotOwnershipChanged / CityTransfered / CityAddedToMap / CityRemovedFromMap - every ownership
//        change with its location and owner, so a reversion is WATCHED as it happens, with a timestamp and a culprit.
//   MAP  every settlement on the map once (owner, isMajor/isMinor/isIndependent, location) so "near a rival" is a
//        measured distance rather than a guess.
//   A    three plots bought at different distances from the nearest rival settlement, each confirmed, then owner +
//        owningCity re-read every turn: does reversion track distance to THEIR settlement rather than to ours?
//   B    the enclosure: buy the plot a foreign unit stands on AND all six of its neighbours, confirm each, then watch.
//        Every turn: where is the unit, how many of the seven plots are still ours, and does it have a non-ours
//        neighbour to step to. Verdict distinguishes TRAPPED-BY-US / LEFT-WHILE-ENCLOSED / ENCLOSURE-BROKE.
//
// The mod's own pass stays disabled: this measures the ENGINE, not the mod.
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

const TAG = "[CDH]";
const MAX_TURNS = 14;
const WATCH_TURNS = 5;      // long enough that an idle AI settler is distinguishable from a stuck one

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
function neighbours(l) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, 1)
    .map((i) => GameplayMap.getLocationFromIndex(i))
    .filter((p) => p && !(p.x === l.x && p.y === l.y)), []);
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
  return { call, spent };
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

// --- EV: watch ownership change as it happens ------------------------------------------------------------------------
const evts = [];
function hookEvents() {
  const add = (name, fn) => safe(() => engine.on(name, (d) => {
    const row = { ev: name, turn: safe(() => Game.turn, -1), ...fn(d) };
    evts.push(row);
    if (watched.has(row.at)) emit(`EV ${J(row)}`);          // a plot we are tracking: report immediately
  }));
  add("PlotOwnershipChanged", (d) => ({ at: d && d.location ? key(d.location) : "?", owner: d && (d.owner ?? d.player) }));
  add("CityTransfered", (d) => ({ at: d && d.location ? key(d.location) : "?", from: d && d.originalOwner, to: d && d.newOwner, city: d && d.cityID }));
  add("CityAddedToMap", (d) => ({ at: d && d.location ? key(d.location) : "?", owner: d && d.player, city: d && d.cityID }));
  add("CityRemovedFromMap", (d) => ({ at: d && d.location ? key(d.location) : "?", owner: d && d.player, city: d && d.cityID }));
  emit("EV hooks attached: PlotOwnershipChanged, CityTransfered, CityAddedToMap, CityRemovedFromMap");
}
const watched = new Set();   // plot keys we care about, so the log is not flooded

// --- MAP: the geography, measured ------------------------------------------------------------------------------------
let settlements = [];
function mapSettlements() {
  settlements = [];
  for (const p of safe(() => Players.getAlive() || [], [])) {
    const pid = safe(() => p.id, -1);
    const kind = safe(() => (p.isMajor ? "major" : p.isIndependent ? "independent" : p.isMinor ? "citystate" : "other"), "?");
    for (const c of safe(() => p.Cities?.getCities?.() || [], [])) {
      const loc = safe(() => c.location, null);
      if (loc) settlements.push({ pid, kind, at: key(loc), name: cityName(c) });
    }
  }
  emit(`MAP settlements n=${settlements.length} ${J(settlements)}`);
}
/** Nearest settlement NOT ours, as {pid, kind, at, d}. */
function nearestForeignSettlement(l) {
  let best = null;
  for (const s of settlements) {
    if (s.pid === local) continue;
    const [x, y] = s.at.split(",").map(Number);
    const d = dist(l, { x, y });
    if (!best || d < best.d) best = { ...s, d };
  }
  return best;
}

// --- A: does a confirmed claim stay ours? ---------------------------------------------------------------------------
const tracked = [];   // {k, loc, label, boughtTurn, cityId, history:[]}
async function buyAndConfirm(loc, city, label) {
  const before = { owner: owner(loc), city: owningCity(loc) };
  const buy = refundBuy(city, loc);
  const reads = [];
  for (const ms of [2000, 3000, 3000]) {
    await later(ms);
    reads.push({ owner: owner(loc), city: owningCity(loc) });
  }
  const landed = reads[reads.length - 1].owner === local;
  const foreign = nearestForeignSettlement(loc);
  emit(`A BUY ${label} ${key(loc)} ourCity=${cityName(city)} ourRing=${dist(city.location, loc)} `
    + `nearestForeign=${J(foreign)} buy=${J(buy)} before=${J(before)} reads=${J(reads)} => ${landed ? "LANDED" : "DID-NOT-LAND"}`);
  watched.add(key(loc));
  if (landed) tracked.push({ k: key(loc), loc, label, boughtTurn: safe(() => Game.turn, -1), cityId: reads[2].city, history: [] });
  return landed;
}

/** Three plots at increasing distance from the nearest foreign settlement, all within buying reach of one of ours. */
function reversionTargets() {
  const cities = localCities();
  const out = [];
  for (const c of cities) {
    for (let r = 4; r <= 6; r++) {
      for (const p of safe(() => GameplayMap.getPlotIndicesInRadius(c.location.x, c.location.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), [])) {
        if (dist(c.location, p) !== r) continue;
        if (owner(p) !== -1 || !landClean(p)) continue;
        const f = nearestForeignSettlement(p);
        out.push({ loc: { x: p.x, y: p.y }, city: c, ring: r, foreignD: f ? f.d : 99 });
      }
    }
  }
  out.sort((a, b) => a.foreignD - b.foreignD);
  const near = out[0];
  const mid = out[Math.floor(out.length / 2)];
  const far = out[out.length - 1];
  return [near, mid, far].filter(Boolean);
}

// --- B: the enclosure ------------------------------------------------------------------------------------------------
let pen = null;   // {cid, type, unitOwner, centre, ring:[loc], boughtTurn, history:[]}
async function buildPen() {
  const cities = localCities();
  const cands = [];
  for (const p of safe(() => Players.getAlive().filter((x) => x.id !== local).map((x) => x.id), [])) {
    for (const u of playerUnits(p)) {
      if (!u.loc || u.loc.x < 0 || !landClean(u.loc) || owner(u.loc) !== -1) continue;
      const near = nearest(u.loc, cities);
      if (!near || near.d > 7) continue;
      cands.push({ u, near });
    }
  }
  emit(`B CANDIDATES n=${cands.length} ${J(cands.slice(0, 5).map((c) => ({ at: key(c.u.loc), unit: c.u.type, owner: c.u.owner, ring: c.near.d })))}`);
  const pick = cands.find((c) => /SETTLER|MIGRANT|SCOUT|MERCHANT/.test(c.u.type)) || cands[0];
  if (!pick) { emit("B no foreign unit on unowned land within reach"); return false; }
  const centre = { x: pick.u.loc.x, y: pick.u.loc.y };
  const ring = neighbours(centre).filter((p) => landClean(p));
  emit(`B PEN target ${key(centre)} unit=${pick.u.type} owner=${pick.u.owner} ringLand=${ring.length}`);
  await buyAndConfirm(centre, pick.near.city, "pen-centre");
  for (const p of ring) {
    if (owner(p) === local) { watched.add(key(p)); continue; }
    if (owner(p) !== -1) { watched.add(key(p)); continue; }   // someone else's: cannot buy it, note and move on
    const near = nearest(p, cities);
    if (near) await buyAndConfirm(p, near.city, "pen-ring");
  }
  pen = { cid: pick.u.cid, type: pick.u.type, unitOwner: pick.u.owner, centre, ring,
    boughtTurn: safe(() => Game.turn, -1), history: [] };
  emit(`B PEN built ${key(centre)} ${J(penState())}`);
  return true;
}
function penState() {
  if (!pen) return null;
  const at = whereIsUnit(pen.cid);
  const onCentre = !!(at && at.x === pen.centre.x && at.y === pen.centre.y);
  const ringOurs = pen.ring.filter((p) => owner(p) === local).length;
  const escapes = neighbours(at || pen.centre).filter((p) => landClean(p) && owner(p) !== local).length;
  return { unitAt: at ? key(at) : "gone", onCentre, centreOwner: owner(pen.centre), ringOurs, ringTotal: pen.ring.length,
    nonOursNeighbours: escapes, enclosed: onCentre && owner(pen.centre) === local && escapes === 0 };
}

// --- run -------------------------------------------------------------------------------------------------------------
async function run() {
  local = GameContext.localPlayerID;
  CONFIG.diffusionEnabled = false;
  emit(`S0 run15 turn=${safe(() => Game.turn)} local=${local} gold=${gold()} modPass=DISABLED`);
  hookEvents();
  mapSettlements();
  const targets = reversionTargets();
  emit(`A TARGETS ${J(targets.map((t) => ({ at: key(t.loc), ourRing: t.ring, foreignD: t.foreignD })))}`);
  const labels = ["near-rival", "mid", "far-from-rival"];
  for (let i = 0; i < targets.length; i++) await buyAndConfirm(targets[i].loc, targets[i].city, labels[i] || "extra");
  await buildPen();
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

function verdicts() {
  for (const t of tracked) {
    const kept = t.history.filter((h) => h.owner === local).length;
    emit(`A VERDICT ${t.label} ${t.k} boughtTurn=${t.boughtTurn} nowOwner=${owner(t.loc)} nowCity=${owningCity(t.loc)} `
      + `turnsKept=${kept}/${t.history.length} history=${J(t.history)} => `
      + (owner(t.loc) === local ? "STAYED-OURS" : `REVERTED to ${owner(t.loc)}`));
  }
  if (!pen) { emit("B VERDICT no pen was built"); return; }
  const st = penState();
  const moved = pen.history.some((h) => !h.onCentre);
  const everEnclosed = pen.history.some((h) => h.enclosed) || false;
  emit(`B VERDICT centre=${key(pen.centre)} unit=${pen.type} owner=${pen.unitOwner} everEnclosed=${everEnclosed} `
    + `moved=${moved} now=${J(st)} history=${J(pen.history)} => `
    + (!everEnclosed ? "ENCLOSURE-NEVER-HELD: plots reverted before the unit was ever surrounded by our land"
      : moved ? "LEFT-WHILE-ENCLOSED: a unit CAN leave our territory, so trespass does not strand it"
        : "TRAPPED-BY-US: enclosed by our claims and it never moved - the reported symptom, caused by the mod"));
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)} events=${evts.length}`);
    for (const t of tracked) {
      const row = { n, turn: safe(() => Game.turn, -1), owner: owner(t.loc), city: owningCity(t.loc) };
      t.history.push(row);
      emit(`A WATCH ${t.label} ${t.k} ${J(row)}`);
    }
    if (pen) {
      const st = penState();
      pen.history.push({ n, ...st });
      emit(`B WATCH n=${n} ${J(st)}`);
    }
    const done = n >= WATCH_TURNS + 1 || n >= MAX_TURNS;
    if (done) { verdicts(); setTimeout(() => emit("DONE harness run15 finished"), 3000); return; }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run15");
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
