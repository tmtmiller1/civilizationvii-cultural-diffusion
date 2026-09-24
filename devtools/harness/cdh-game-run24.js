// cdh-game-run24.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 18 (dev only).
//
// CONFIRMATION run: watch the two fixes WORK, with the mod's own pass ENABLED (runs 14-17 disabled it to
// measure the engine; this one measures the MOD).
//
//   RUN-18 CORRECTION: stage G checked the UNIT's distance from our cities but not the GAP's, and the gap it
//   left (79,39) was ~7 rings from Megiddo - outside flipMaxDistance (6), so the pass ignored it for a
//   reason that had nothing to do with the guard. Run 18's "guard held" line measured nothing. Every ring
//   plot must now be inside flipMaxDistance, and the run asserts the guard's own debug line as the proof.
//
//   G  THE STRAND GUARD. Run 17 proved the mod can freeze a peaceful major's unit by claiming every plot
//      around it (enclosedTurns 5/5). Rebuild that situation with ONE gap left open, seed the mod's field
//      so the pass wants that gap, then run the pass. The fix works if the pass REFUSES it
//      (`skip flip ...: would strand a foreign unit`), the plot stays unowned, and the unit keeps moving
//      over the following turns instead of freezing.
//   V  VILLAGE CORE PROTECTION. An Independent Power reports `cities: 0`, so `isCoreProtected`'s city-list
//      route is blind to a village centre; the fix adds a MAP read (`isCityCenterAt`). Validate that read
//      against the live engine on our OWN centres first - it failed twice in earlier harnesses - then find
//      any minor-owned centre, report what the gates now say, and seed the mod's field on the centre to see
//      whether the pass refuses it.
//
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { isCoreProtected, atWar, rivalClaimAllowed } from "/cultural-diffusion/ui/cd-borders.js";
import { isCityCenterAt, districtTypeNameAt } from "/cultural-diffusion/ui/cd-plots.js";
import { wouldStrandForeignUnit, hasStrandableUnit, legalExits } from "/cultural-diffusion/ui/cd-units.js";
import { runPass } from "/cultural-diffusion/ui/cd-pass.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const MAX_TURNS = 12;
const WATCH_TURNS = 4;
const SEED_STOCK = 50000;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
function key(l) { return l.x + "," + l.y; }
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function neighbours(l) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, 1)
    .map((i) => GameplayMap.getLocationFromIndex(i)).filter((p) => p && !(p.x === l.x && p.y === l.y)), []);
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
function seedStock(loc, extra) {
  const k = key(loc);
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  d.field[k] = { [String(local)]: SEED_STOCK, ...(extra || {}) };
  delete d.locked[k]; delete d.claims[k]; delete d.pending[k];
  return safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); return "set"; }, "throw");
}
function playerKinds() {
  return safe(() => (Players.getAlive() || []).map((p) => ({
    pid: safe(() => p.id, -1), major: safe(() => p.isMajor, null), indep: safe(() => p.isIndependent, null),
    minor: safe(() => p.isMinor, null), cities: safe(() => (p.Cities?.getCities?.() || []).length, "ERR"),
    war: safe(() => atWar(local, safe(() => p.id, -1)), "ERR")
  })), []);
}

// --- G: the strand guard, with the mod's pass doing the claiming ------------------------------------------------------
let gap = null;
let refusedAtTest = null;   // did the pass refuse the culpable claim AT THE MOMENT the unit was penned?
function penWithOneGap(kinds) {
  const peaceful = new Set(kinds.filter((k) => k.major === true && k.pid !== local && k.war === false).map((k) => k.pid));
  const cities = localCities();
  const rows = [];
  for (const pid of peaceful) {
    for (const u of playerUnits(pid)) {
      if (!u.loc || u.loc.x < 0 || !landClean(u.loc) || owner(u.loc) !== -1) continue;
      const near = nearest(u.loc, cities);
      if (!near || near.d > CONFIG.flipMaxDistance) continue;
      const ring = neighbours(u.loc).filter((p) => landClean(p));
      const usable = ring.filter((p) => owner(p) === local || owner(p) === -1);
      if (ring.length < 3 || usable.length !== ring.length) continue;
      // Every ring plot must be a plot the PASS could claim, or "it was left alone" proves nothing about
      // the guard (run 18's gap was outside flipMaxDistance and was skipped for that reason instead).
      const reach = ring.map((p) => ({ p, d: nearest(p, cities)?.d ?? 99 }));
      const tooFar = reach.filter((x) => x.d > CONFIG.flipMaxDistance || x.d <= CONFIG.baseGrowthRadius);
      if (tooFar.length) continue;
      rows.push({ u, near, ring });
    }
  }
  emit(`G SITES n=${rows.length} ${J(rows.slice(0, 5).map((r) => ({ at: key(r.u.loc), unit: r.u.type, owner: r.u.owner, ring: r.near.d, ringLand: r.ring.length })))}`);
  return rows[0] || null;
}
async function buildGapPen(kinds) {
  if (gap) return true;
  const site = penWithOneGap(kinds);
  if (!site) { emit("G no site: no peaceful major's unit inside flipMaxDistance with a buyable ring"); return false; }
  const centre = { x: site.u.loc.x, y: site.u.loc.y };
  const theGap = site.ring[0];                       // the one plot we leave open for the mod to want
  for (const p of site.ring.slice(1)) if (owner(p) !== local) refundBuy(nearest(p, localCities()).city, p);
  // Run 21: the ring's LAND plots were bought but the unit still had a second exit (water/edge plots are
  // not in `ring`), so the pass legitimately took the gap and then the other exit in the same pass. Buy
  // every non-ours neighbour except the gap, so exactly one exit remains.
  for (const p of neighbours(centre)) {
    if (p.x === theGap.x && p.y === theGap.y) continue;
    if (owner(p) === local || !landClean(p)) continue;
    const near = nearest(p, localCities());
    if (near) refundBuy(near.city, p);
  }
  await later(6000);
  const ringState = site.ring.map((p) => ({ at: key(p), owner: owner(p), isGap: p.x === theGap.x && p.y === theGap.y }));
  const write = seedStock(theGap);                   // make the pass WANT the gap
  gap = { cid: site.u.cid, type: site.u.type, unitOwner: site.u.owner, centre, loc: theGap, ring: site.ring, history: [] };
  emit(`G PEN centre=${key(centre)} unit=${site.u.type} owner=${site.u.owner} gap=${key(theGap)} seed=${write} ring=${J(ringState)}`);
  // Run 19 failed here with no explanation in the log, so ask the guard directly, and look at the shape
  // of the engine's unit list - `Array.isArray` on it was the suspected cause.
  const raw = safe(() => MapUnits?.getUnits?.(centre.x, centre.y), null);
  emit(`G SHAPE MapUnits.getUnits(${key(centre)}) typeof=${typeof raw} isArray=${Array.isArray(raw)} `
    + `ctor=${safe(() => raw && raw.constructor && raw.constructor.name, "?")} length=${safe(() => raw && raw.length, "?")} `
    + `iterable=${safe(() => !!(raw && raw[Symbol.iterator]), "?")}`);
  const direct = safe(() => wouldStrandForeignUnit(theGap, local), "ERR");
  emit(`G DIRECT hasStrandableUnit(centre)=${safe(() => hasStrandableUnit(centre, local), "ERR")} `
    + `legalExitsNow=${safe(() => legalExits(centre, local, null), "ERR")} `
    + `legalExitsAfterClaim=${safe(() => legalExits(centre, local, key(theGap)), "ERR")} `
    + `wouldStrandForeignUnit(gap)=${direct} => ${direct === true ? "guard SAYS REFUSE - the pass must now leave it"
      : "guard says allow - the pass will take it and the fix is still wrong"}`);
  const res = safe(() => runPass(), "threw");
  await later(3000);
  const took = owner(theGap) === local;
  const gapRing = nearest(theGap, localCities())?.d;
  refusedAtTest = !took;
  emit(`G PASS ${J(res)} gap=${key(theGap)} gapRing=${gapRing} flipMaxDistance=${CONFIG.flipMaxDistance} `
    + `gapOwner=${owner(theGap)} unitAt=${J(whereIsUnit(site.u.cid))} => `
    + (took ? "TOOK THE GAP (guard did NOT hold)" : "LEFT THE GAP - check for the guard's own log line"));
  emit(`G PROOF the pass must have logged "skip flip ${key(theGap)}: would strand a foreign unit"; `
    + `if that line is absent the gap was skipped for another reason and this stage proves nothing`);
  return true;
}
function gapState() {
  if (!gap) return null;
  const at = whereIsUnit(gap.cid);
  const here = at || gap.centre;
  const escapes = neighbours(here).filter((p) => landClean(p) && owner(p) !== local).length;
  return { unitAt: at ? key(at) : "gone", gapOwner: owner(gap.loc), escapes,
    onOurLand: owner(here) === local,
    immobile: escapes === 0,                      // no legal destination at all: the reported symptom
    onCentre: !!(at && at.x === gap.centre.x && at.y === gap.centre.y) };
}

// --- V: village core protection ---------------------------------------------------------------------------------------
function stageV(kinds) {
  // The map read failed twice in earlier harnesses, so validate it on the live engine first.
  const own = localCities().map((c) => ({ at: key(c.location), name: cityName(c), centre: isCityCenterAt(c.location),
    district: districtTypeNameAt(c.location) }));
  emit(`V SELFTEST ourCentres=${J(own)}`);
  const offCentre = safe(() => neighbours(localCities()[0].location)[0], null);
  emit(`V SELFTEST nonCentre=${offCentre ? key(offCentre) : "?"} isCityCenterAt=${offCentre ? isCityCenterAt(offCentre) : "?"}`);

  const minors = new Set(kinds.filter((k) => k.major === false).map((k) => k.pid));
  const seen = new Set();
  const centres = [];
  for (const c of localCities()) {
    for (const p of inRadius(c.location, 14)) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const o = owner(p);
      if (!minors.has(o) || !isCityCenterAt(p)) continue;
      const kind = kinds.find((x) => x.pid === o) || {};
      centres.push({ at: k, ownerPid: o, indep: kind.indep, cities: kind.cities, war: kind.war,
        ourRing: dist(c.location, p), district: districtTypeNameAt(p) });
    }
  }
  emit(`V MINOR-CENTRES n=${centres.length} ${J(centres)}`);
  for (const c of centres.slice(0, 3)) {
    const [x, y] = c.at.split(",").map(Number);
    const loc = { x, y };
    emit(`V GATE ${c.at} ownerPid=${c.ownerPid} indep=${c.indep} ownerCities=${c.cities} atWar=${c.war} `
      + `isCoreProtected(owner,0)=${safe(() => isCoreProtected(loc, c.ownerPid, 0), "ERR")} `
      + `rivalClaimAllowed=${safe(() => rivalClaimAllowed(loc, c.ownerPid, local, CONFIG), "ERR")} => `
      + (safe(() => isCoreProtected(loc, c.ownerPid, 0), false) ? "CENTRE PROTECTED" : "CENTRE UNPROTECTED"));
  }
  return centres;
}
let villageTest = null;
async function pressVillage(centres) {
  const pick = centres.find((c) => c.indep === true) || centres[0];
  if (!pick) { emit("V no minor centre within 14 rings - the pass test cannot run here"); return; }
  const [x, y] = pick.at.split(",").map(Number);
  const loc = { x, y };
  const write = seedStock(loc, { [String(pick.ownerPid)]: 10 });
  const before = owner(loc);
  const res = safe(() => runPass(), "threw");
  await later(3000);
  villageTest = { at: pick.at, ownerPid: pick.ownerPid, before, after: owner(loc) };
  emit(`V PRESS ${pick.at} seed=${write} pass=${J(res)} ownerBefore=${before} ownerAfter=${owner(loc)} => `
    + (owner(loc) === local ? "THE PASS TOOK A SETTLEMENT CENTRE (protection failed)" : "centre held"));
}

/** The minor-protection floor, against a real city-state's ring-1. */
function stageM(kinds, centres) {
  const pick = centres[0];
  if (!pick) { emit("M no minor centre in range"); return; }
  const [x, y] = pick.at.split(",").map(Number);
  const centre = { x, y };
  const ring1 = neighbours(centre).filter((p) => owner(p) === pick.ownerPid);
  emit(`M centre=${pick.at} ownerPid=${pick.ownerPid} minorProtectRadius=${CONFIG.minorProtectRadius} `
    + `ring1Owned=${J(ring1.map(key))}`);
  for (const p of ring1.slice(0, 3)) {
    const withFloor = safe(() => rivalClaimAllowed(p, pick.ownerPid, local, CONFIG), "ERR");
    const withoutFloor = safe(() => rivalClaimAllowed(p, pick.ownerPid, local, { ...CONFIG, minorProtectRadius: -1 }), "ERR");
    emit(`M GATE ${key(p)} claimAllowedWithFloor=${withFloor} withoutFloor=${withoutFloor} => `
      + (withFloor === false && withoutFloor === true ? "FLOOR IS WHAT PROTECTS IT"
        : withFloor === false ? "protected (by something else too)" : "STILL CLAIMABLE - floor did not hold"));
  }
}

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 run24 turn=${safe(() => Game.turn)} local=${local} modPass=${CONFIG.diffusionEnabled} `
    + `protectTrappedUnits=${CONFIG.protectTrappedUnits} coreProtectRadius=${CONFIG.coreProtectRadius} debug=${CONFIG.debug}`);
  const kinds = playerKinds();
  emit(`S0 kinds ${J(kinds.filter((k) => k.major === false))}`);
  const centres = stageV(kinds);
  stageM(kinds, centres);
  await buildGapPen(kinds);
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
  if (villageTest) {
    emit(`V VERDICT centre=${villageTest.at} ownerPid=${villageTest.ownerPid} nowOwner=${owner({ x: +villageTest.at.split(",")[0], y: +villageTest.at.split(",")[1] })} => `
      + (owner({ x: +villageTest.at.split(",")[0], y: +villageTest.at.split(",")[1] }) === local
        ? "FAILED: the pass holds a settlement centre" : "HELD: the pass never took the settlement centre"));
  } else emit("V VERDICT not run (no minor centre in range)");
  if (!gap) { emit("G VERDICT no pen built"); return; }
  const moves = gap.history.map((h) => h.unitAt);
  const everImmobile = gap.history.some((h) => h.immobile);
  const distinct = new Set(moves).size;
  // Taking the gap LATER is correct and designed: once the unit has moved on, the plot is just a plot.
  // The guard is judged on the seeded claim, and on the unit never being left with nowhere to go.
  emit(`G VERDICT centre=${key(gap.centre)} gap=${key(gap.loc)} unit=${gap.type} owner=${gap.unitOwner} `
    + `refusedWhenPenned=${refusedAtTest} everImmobile=${everImmobile} distinctPositions=${distinct} `
    + `unitPositions=${J(moves)} => `
    + (refusedAtTest === false ? "FAILED: the pass took the culpable claim while the unit was penned"
      : everImmobile ? "FAILED: the unit was left with no legal destination at some point"
        : distinct > 1 ? "HELD: the culpable claim was refused and the unit moved away freely"
          : "HELD (weak): the claim was refused, but the unit never moved, so its mobility is unproven"));
}

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(async () => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
    if (gap) { const st = gapState(); gap.history.push({ n, ...st }); emit(`G WATCH n=${n} ${J(st)}`); }
    else await buildGapPen(playerKinds()).catch((e) => emit("buildGapPen threw " + e));
    if (villageTest) emit(`V WATCH n=${n} centre=${villageTest.at} owner=${owner({ x: +villageTest.at.split(",")[0], y: +villageTest.at.split(",")[1] })}`);
    const watched = gap ? gap.history.length : 0;
    if ((gap && watched >= WATCH_TURNS) || n >= MAX_TURNS) { verdicts(); setTimeout(() => emit("DONE harness run24 finished"), 3000); return; }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run24");
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
