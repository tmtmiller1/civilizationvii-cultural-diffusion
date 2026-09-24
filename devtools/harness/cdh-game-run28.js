// cdh-game-run28.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 28 (dev only).
//
// Closes the last two gaps in the strand guard. Works on ANY save, and says plainly when a save cannot host
// the fixture rather than passing quietly.
//
//   A  ACCESS API. The guard counts any plot that is not ours as a destination for a foreign unit. Run 27's
//      census says that is roughly right - 9 of 10 sampled units standing in a third party's territory were
//      at PEACE with its owner, so access is routinely granted and blocking third-party land outright would
//      refuse claims along every shared frontier. But "roughly right" leaves units wedged against a third
//      party's border unprotected (run 27: 7 such units, none near us). If the engine exposes an access read
//      - open borders, alliance, treaty - the guard can judge those plots exactly instead of defaulting.
//      This reflects the Diplomacy / Player surface for anything access-shaped and TRIES the promising names
//      read-only against a real pair of players.
//   N  NAVAL PEN. Run 26 and 27 found no bay on AugustusAnt136: nearest peaceful ship 10 rings out, claims
//      only survive inside about 7. This reports the nearest peaceful ships on WHATEVER save it is run
//      against and, if one is pennable, buys all but one of its water neighbours and asks the guard.
//
// Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { legalExits, wouldStrandForeignUnit, strandableUnitsAt } from "/cultural-diffusion/ui/cd-units.js";

const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function impassable(l) {
  return safe(() => (typeof GameplayMap.isImpassable === "function" ? !!GameplayMap.isImpassable(l.x, l.y) : false), false);
}
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
function atWar(a, b) { return safe(() => !!Players.get(a).Diplomacy.isAtWarWith(b), null); }

// --- A: is there an access read? ---------------------------------------------------------------------------------
function reflectNames(obj, label) {
  const hits = safe(() => {
    const out = [];
    for (const k in obj) if (/border|access|treaty|alli|passage|enter|agreement|relation|pact/i.test(k)) out.push(k);
    return out;
  }, "ERR");
  emit(`A SURFACE ${label} = ${J(hits)}`);
  return Array.isArray(hits) ? hits : [];
}
function stageA() {
  const dip = safe(() => Players.get(local)?.Diplomacy, null);
  const names = reflectNames(dip, "Players.get(local).Diplomacy");
  reflectNames(safe(() => Players.get(local), null), "Players.get(local)");
  reflectNames(typeof DiplomacyPlayerRelationships !== "undefined" ? DiplomacyPlayerRelationships : null,
    "DiplomacyPlayerRelationships");
  reflectNames(typeof Game !== "undefined" ? Game.Diplomacy : null, "Game.Diplomacy");
  // Try each access-shaped name read-only against a real peaceful major, and against ourselves as a control.
  const majors = safe(() => Players.getAlive().filter((p) => p.isMajor && p.id !== local).map((p) => p.id), []);
  const peaceful = majors.find((m) => atWar(local, m) === false);
  const hostile = majors.find((m) => atWar(local, m) === true);
  emit(`A PAIRS peacefulMajor=${peaceful} hostileMajor=${hostile}`);
  for (const n of names) {
    if (typeof safe(() => dip[n], null) !== "function") continue;
    emit(`A TRY ${n}(peaceful=${peaceful})=${J(safe(() => dip[n](peaceful), "THREW"))} `
      + `${n}(hostile=${hostile})=${J(safe(() => dip[n](hostile), "THREW"))} `
      + `${n}(self=${local})=${J(safe(() => dip[n](local), "THREW"))}`);
  }
  emit(`A VERDICT => ` + (names.length === 0
    ? "no access-shaped name on any surface: third-party plots cannot be judged, keep the permissive default"
    : "candidate names above - a name that separates the peaceful pair from the hostile one is the access read"));
}

// --- N: the naval pen, on whatever save this is ------------------------------------------------------------------
function foreignShips() {
  const out = [];
  for (const p of safe(() => Players.getAlive() || [], [])) {
    const pid = safe(() => p.id, -1);
    if (pid === local || atWar(local, pid) !== false) continue;
    for (const u of safe(() => p.Units?.getUnits?.() || [], [])) {
      const unit = safe(() => (u && u.location ? u : Units.get(u)), null);
      if (!unit || !unit.location) continue;
      const def = safe(() => GameInfo.Units.lookup(unit.type), null);
      if (!def || def.Domain !== "DOMAIN_SEA") continue;
      const loc = { x: unit.location.x, y: unit.location.y };
      if (!isWater(loc)) continue;
      out.push({ cid: unit.id || u, owner: pid, type: def.UnitType, loc });
    }
  }
  return out;
}
async function stageN() {
  const cities = localCities();
  const rows = foreignShips().map((s) => {
    const wet = neighbours(s.loc).filter((p) => isWater(p) && !impassable(p));
    const near = nearest(s.loc, cities);
    return { s, near, wet, takeable: wet.filter((p) => owner(p) === local || owner(p) === -1).length };
  }).filter((r) => r.near).sort((a, b) => a.near.d - b.near.d);
  emit(`N SHIPS n=${rows.length} nearest=${J(rows.slice(0, 6).map((r) => ({ at: key(r.s.loc), type: r.s.type, owner: r.s.owner, ring: r.near.d, wet: r.wet.length, takeable: r.takeable })))}`);
  const site = rows.find((r) => r.near.d <= 7 && r.wet.length >= 2 && r.takeable === r.wet.length);
  if (!site) { emit("N VERDICT => no pennable ship on THIS save either; the naval case stays unwatched"); return; }
  const centre = site.s.loc;
  const theGap = site.wet[0];
  emit(`N PEN centre=${key(centre)} ship=${site.s.type} owner=${site.s.owner} ring=${site.near.d} wet=${site.wet.length} gap=${key(theGap)}`);
  for (const p of site.wet.slice(1)) if (owner(p) !== local) refundBuy(nearest(p, cities).city, p);
  await later(6000);
  const seen = safe(() => strandableUnitsAt(centre, local), "ERR");
  const before = safe(() => legalExits(centre, local, null, null, { water: true, land: false }), "ERR");
  const after = safe(() => legalExits(centre, local, key(theGap), null, { water: true, land: false }), "ERR");
  const verdict = safe(() => wouldStrandForeignUnit(theGap, local), "ERR");
  emit(`N RESULT ringNowOurs=${site.wet.slice(1).filter((p) => owner(p) === local).length}/${site.wet.length - 1} `
    + `strandableUnitsAt=${J(seen)} exitsNow=${before} exitsAfterClaim=${after} wouldStrand=${verdict}`);
  emit(`N VERDICT => ` + (verdict === true && after === 0
    ? "CONFIRMED on a real ship: the guard sees it as sea-going and refuses the claim that takes its last water"
    : `NOT confirmed (exitsNow=${before} exitsAfter=${after} verdict=${verdict}) - the pen did not close`));
}

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 run28 turn=${safe(() => Game.turn)} local=${local} cities=${localCities().length}`);
  stageA();
  await stageN();
  setTimeout(() => emit("DONE harness run28 finished"), 2000);
}

emit("attached run28");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => emit("run threw " + e)); }, 8000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
