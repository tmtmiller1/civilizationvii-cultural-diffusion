// cdh-game-run26.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 26 (dev only).
//
// The naval half of the strand guard, which is implemented but NOT yet watched. Run 25 established that the
// domain read resolves and that 126 naval units exist; this checks the guard's own arithmetic against REAL
// ships, and takes a pen fixture if the map offers one.
//
//   N1 READ-ONLY, against every foreign ship near us: does `strandableUnitAt` resolve DOMAIN_SEA, and does
//      `legalExits` count its WATER neighbours rather than reporting the zero it used to? A ship that still
//      reports 0 exits on open water means the domain rule is not reaching it.
//   N2 EMBARKED units: a LAND-domain unit standing on water. If the engine models embarkation that way, the
//      guard would call water blocked for it and read it as immobile - worth knowing even if rare.
//   N3 PEN (opportunistic): a foreign ship whose water neighbours are all ours-or-buyable inside
//      flipMaxDistance. Buy all but one, ask the guard, then let the pass run - the naval twin of run 24.
//      Reports honestly when the map offers no such fixture.
//
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { runPass } from "/cultural-diffusion/ui/cd-pass.js";
import { strandableUnitAt, legalExits, wouldStrandForeignUnit } from "/cultural-diffusion/ui/cd-units.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const SEED_STOCK = 50000;
const WATCH_TURNS = 3;
const MAX_TURNS = 10;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function neighbours(l) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, 1)
    .map((i) => GameplayMap.getLocationFromIndex(i)).filter((p) => p && !(p.x === l.x && p.y === l.y)), []);
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function nearest(l, cities) {
  let best = null; let bd = 1e9;
  for (const c of cities) { const d = dist(c.location, l); if (d < bd) { bd = d; best = c; } }
  return best ? { city: best, d: bd } : null;
}
function gold() { return safe(() => Players.get(local).Treasury.goldBalance, null); }
function refundBuy(city, l) {
  const g0 = gold();
  safe(() => city.purchasePlot(l));
  const g1 = gold();
  const spent = (typeof g0 === "number" && typeof g1 === "number") ? Math.max(0, g0 - g1) : 0;
  if (spent > 0) safe(() => Players.get(local).Treasury.changeGoldBalance(spent));
}
function unitRow(u, cid) {
  const def = safe(() => GameInfo.Units.lookup(u.type), null);
  return u ? { cid: u.id || cid, owner: u.owner, type: def && def.UnitType, domain: def && def.Domain,
    loc: u.location ? { x: u.location.x, y: u.location.y } : null } : null;
}
function foreignUnits() {
  const out = [];
  for (const p of safe(() => Players.getAlive() || [], [])) {
    const pid = safe(() => p.id, -1);
    if (pid === local) continue;
    if (safe(() => !!Players.get(local).Diplomacy.isAtWarWith(pid), true)) continue; // at war: never stranded
    for (const u of safe(() => p.Units?.getUnits?.() || [], [])) {
      const row = unitRow((u && u.location) ? u : safe(() => Units.get(u), null), u);
      if (row && row.loc && row.loc.x >= 0) out.push(row);
    }
  }
  return out;
}

function stageN1N2(units) {
  const cities = localCities();
  const ships = units.filter((u) => u.domain === "DOMAIN_SEA")
    .sort((a, b) => (nearest(a.loc, cities)?.d ?? 99) - (nearest(b.loc, cities)?.d ?? 99));
  emit(`N1 foreign peaceful ships n=${ships.length}`);
  for (const s of ships.slice(0, 5)) {
    const seen = safe(() => strandableUnitAt(s.loc, local), "ERR");
    emit(`N1 ${key(s.loc)} type=${s.type} owner=${s.owner} onWater=${isWater(s.loc)} ourRing=${nearest(s.loc, cities)?.d} `
      + `strandableUnitAt=${J(seen)} exitsAsSea=${safe(() => legalExits(s.loc, local, null, null, "DOMAIN_SEA"), "ERR")} `
      + `exitsAsLand=${safe(() => legalExits(s.loc, local, null, null, "DOMAIN_LAND"), "ERR")} `
      + `waterNbrs=${neighbours(s.loc).filter(isWater).length}`);
  }
  const bad = ships.slice(0, 5).filter((s) => {
    const seen = safe(() => strandableUnitAt(s.loc, local), null);
    return !seen || seen.domain !== "DOMAIN_SEA";
  });
  emit(`N1 VERDICT => ` + (ships.length === 0 ? "no peaceful foreign ship found - naval path unverified here"
    : bad.length ? `DOMAIN READ FAILS on ${bad.length} of the sampled ships - the naval rule is not reaching them`
      : "the guard sees foreign ships as DOMAIN_SEA and counts their water neighbours as exits"));

  const embarked = units.filter((u) => u.domain === "DOMAIN_LAND" && isWater(u.loc));
  emit(`N2 embarked (LAND domain standing on water) n=${embarked.length} ${J(embarked.slice(0, 4))}`);
  emit(`N2 VERDICT => ` + (embarked.length === 0 ? "none on the map: embarkation does not show up as a LAND unit on water here"
    : "LAND-domain units DO stand on water when embarked; the guard calls water blocked for them, so an "
      + "embarked unit reads as already immobile and is never protected - a known limit, recorded"));
}

// --- N3: the naval pen, if the map offers one ------------------------------------------------------------------------
let pen = null;
function seedStock(loc) {
  const k = key(loc);
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  d.field[k] = { [String(local)]: SEED_STOCK };
  delete d.locked[k]; delete d.claims[k]; delete d.pending[k];
  return safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); return "set"; }, "throw");
}
async function stageN3(units) {
  const cities = localCities();
  const rows = [];
  for (const u of units) {
    if (u.domain !== "DOMAIN_SEA" || !isWater(u.loc)) continue;
    const near = nearest(u.loc, cities);
    if (!near || near.d > CONFIG.flipMaxDistance) continue;
    const wet = neighbours(u.loc).filter(isWater);
    const usable = wet.filter((p) => owner(p) === local || owner(p) === -1);
    const reachable = wet.every((p) => (nearest(p, cities)?.d ?? 99) <= CONFIG.flipMaxDistance);
    rows.push({ u, near, wet, usable: usable.length, blocked: wet.length - usable.length, reachable });
  }
  emit(`N3 SITES n=${rows.length} ${J(rows.slice(0, 5).map((r) => ({ at: key(r.u.loc), type: r.u.type, owner: r.u.owner, ring: r.near.d, wet: r.wet.length, usable: r.usable, blocked: r.blocked, reachable: r.reachable })))}`);
  const site = rows.find((r) => r.blocked === 0 && r.reachable && r.wet.length >= 2);
  if (!site) { emit("N3 no naval pen available on this map: the water case stays UNWATCHED"); return false; }
  const centre = { x: site.u.loc.x, y: site.u.loc.y };
  const theGap = site.wet[0];
  for (const p of site.wet.slice(1)) if (owner(p) !== local) refundBuy(nearest(p, cities).city, p);
  await later(6000);
  const write = seedStock(theGap);
  const direct = safe(() => wouldStrandForeignUnit(theGap, local), "ERR");
  emit(`N3 PEN centre=${key(centre)} ship=${site.u.type} owner=${site.u.owner} gap=${key(theGap)} seed=${write} `
    + `exitsNow=${safe(() => legalExits(centre, local, null, null, "DOMAIN_SEA"), "ERR")} `
    + `exitsAfter=${safe(() => legalExits(centre, local, key(theGap), null, "DOMAIN_SEA"), "ERR")} `
    + `wouldStrand=${direct}`);
  const res = safe(() => runPass(), "threw");
  await later(3000);
  emit(`N3 PASS ${J(res)} gapOwner=${owner(theGap)} => ${owner(theGap) === local ? "TOOK THE GAP (guard did not hold)" : "LEFT THE GAP"}`);
  pen = { cid: site.u.cid, loc: theGap, centre, type: site.u.type, refusedAtTest: owner(theGap) !== local, history: [] };
  return true;
}

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 run26 turn=${safe(() => Game.turn)} local=${local} diffuseAcrossWater=${CONFIG.diffuseAcrossWater} `
    + `protectTrappedUnits=${CONFIG.protectTrappedUnits}`);
  const units = foreignUnits();
  stageN1N2(units);
  await stageN3(units);
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

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
    if (pen) {
      const u = safe(() => Units.get(pen.cid), null);
      const at = u && u.location ? { x: u.location.x, y: u.location.y } : null;
      const exits = at ? safe(() => legalExits(at, local, null, null, "DOMAIN_SEA"), "ERR") : "gone";
      pen.history.push({ n, at: at ? key(at) : "gone", exits, gapOwner: owner(pen.loc) });
      emit(`N3 WATCH n=${n} ${J(pen.history[pen.history.length - 1])}`);
    }
    if ((pen && pen.history.length >= WATCH_TURNS) || n >= MAX_TURNS) {
      if (pen) {
        const moved = new Set(pen.history.map((h) => h.at)).size > 1;
        const stuck = pen.history.some((h) => h.exits === 0);
        emit(`N3 VERDICT gap=${key(pen.loc)} ship=${pen.type} refusedWhenPenned=${pen.refusedAtTest} `
          + `everZeroExits=${stuck} moved=${moved} history=${J(pen.history)} => `
          + (!pen.refusedAtTest ? "FAILED: the pass took the ship's last water"
            : stuck ? "FAILED: the ship was left with no water to move to"
              : "HELD: the culpable claim was refused and the ship kept its water"));
      }
      setTimeout(() => emit("DONE harness run26 finished"), 3000);
      return;
    }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run26");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { n = 1; run().catch((e) => emit("run threw " + e)); }, 8000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
