// cdh-game-run27.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 27 (dev only).
//
// READ-ONLY survey for the two gaps the strand guard still has.
//
//   T  THIRD-PARTY BORDERS. The guard counts any plot that is not OURS as a destination. But a unit of civ A
//      at peace with civ B cannot enter B's borders either - that is the same trespass rule that froze the
//      Scout in run 17 - so a unit wedged between our land and a third party's can still be immobilised by
//      our claim. The question is whether "another civ's land is closed to you" is the DEFAULT. Census: for
//      every foreign unit on the map, is it standing on a plot owned by a DIFFERENT player? If that is
//      common, access is common (alliances, open borders) and the permissive rule is right. If it is close
//      to zero, third-party land is closed by default and the guard must treat it as blocked.
//      Also sampled: how often a peaceful unit's only non-ours neighbours belong to one other player - the
//      geometry where this would actually bite.
//   S  NAVAL FIXTURE SURVEY. Run 26 found no bay to pen a ship in: the nearest foreign ships were 10-13
//      rings out, and a claim only survives inside ~7 rings of the buying city. Report the nearest foreign
//      ships with their distance and how many of their water neighbours are unowned, so a save that CAN
//      host the fixture is identifiable instead of guessed at.
//
// No writes, no turns, no pass. Tagged [CDH] in Logs/UI.log.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }

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
function nearestOurCity(l) {
  let bd = 1e9;
  for (const c of localCities()) { const d = dist(c.location, l); if (d < bd) bd = d; }
  return bd === 1e9 ? 99 : bd;
}
function atWar(a, b) { return safe(() => !!Players.get(a).Diplomacy.isAtWarWith(b), null); }
function kindOf(pid) {
  return safe(() => {
    const p = Players.get(pid);
    return p.isMajor ? "major" : p.isIndependent ? "independent" : p.isMinor ? "citystate" : "other";
  }, "?");
}
function allUnits() {
  const out = [];
  for (const p of safe(() => Players.getAlive() || [], [])) {
    const pid = safe(() => p.id, -1);
    for (const u of safe(() => p.Units?.getUnits?.() || [], [])) {
      const unit = safe(() => (u && u.location ? u : Units.get(u)), null);
      if (!unit || !unit.location) continue;
      const def = safe(() => GameInfo.Units.lookup(unit.type), null);
      out.push({ pid, type: def && def.UnitType, domain: def && def.Domain,
        loc: { x: unit.location.x, y: unit.location.y } });
    }
  }
  return out;
}

function stageT(units) {
  let inOwn = 0, inNobody = 0, inThird = 0, inOurs = 0;
  const examples = [];
  for (const u of units) {
    if (u.pid === local) continue;
    const o = owner(u.loc);
    if (o < 0) inNobody++;
    else if (o === u.pid) inOwn++;
    else if (o === local) inOurs++;
    else {
      inThird++;
      if (examples.length < 10) {
        examples.push({ unit: u.type, unitOwner: u.pid, unitKind: kindOf(u.pid), plotOwner: o, plotKind: kindOf(o),
          at: key(u.loc), unitAtWarWithPlotOwner: atWar(u.pid, o) });
      }
    }
  }
  emit(`T CENSUS foreignUnits=${units.filter((u) => u.pid !== local).length} onOwnLand=${inOwn} onUnowned=${inNobody} `
    + `onOURland=${inOurs} onTHIRDpartyLand=${inThird}`);
  emit(`T EXAMPLES ${J(examples)}`);
  const peacefulThird = examples.filter((e) => e.unitAtWarWithPlotOwner === false);
  emit(`T VERDICT => ` + (inThird === 0
    ? "NO foreign unit stands in a third party's territory: closed borders are the DEFAULT, so the guard must "
      + "treat another civ's land as blocked for that unit"
    : peacefulThird.length === 0
      ? `all ${inThird} such units are AT WAR with the plot owner (war grants entry), so peaceful entry is still `
        + "unattested and third-party land should be treated as blocked"
      : `${peacefulThird.length} unit(s) stand PEACEFULLY in a third party's territory, so access does happen - `
        + "blocking third-party land outright would over-protect"));

  // Where the geometry would actually bite: a peaceful unit whose only non-ours neighbours are one other civ's.
  const wedged = [];
  for (const u of units) {
    if (u.pid === local || atWar(local, u.pid) !== false) continue;
    const nbrs = neighbours(u.loc).filter((p) => !impassable(p));
    const nonOurs = nbrs.filter((p) => owner(p) !== local);
    if (!nonOurs.length) continue;
    const owners = new Set(nonOurs.map((p) => owner(p)).filter((o) => o >= 0 && o !== u.pid));
    const unownedOrOwn = nonOurs.filter((p) => owner(p) < 0 || owner(p) === u.pid);
    if (owners.size && unownedOrOwn.length <= 1) {
      wedged.push({ unit: u.type, unitOwner: u.pid, at: key(u.loc), ourRing: nearestOurCity(u.loc),
        nonOurs: nonOurs.length, verifiedExits: unownedOrOwn.length, thirdPartyOwners: [...owners] });
    }
  }
  emit(`T WEDGED n=${wedged.length} ${J(wedged.slice(0, 8))}`);
  emit(`T WEDGED-NEAR-US ${J(wedged.filter((w) => w.ourRing <= CONFIG.flipMaxDistance).slice(0, 5))}`);
}

function stageS(units) {
  const ships = units.filter((u) => u.pid !== local && u.domain === "DOMAIN_SEA" && isWater(u.loc))
    .map((u) => {
      const wet = neighbours(u.loc).filter((p) => isWater(p) && !impassable(p));
      return { type: u.type, owner: u.pid, at: key(u.loc), ourRing: nearestOurCity(u.loc),
        wet: wet.length, unownedWet: wet.filter((p) => owner(p) < 0).length,
        oursWet: wet.filter((p) => owner(p) === local).length,
        war: atWar(local, u.pid) };
    })
    .sort((a, b) => a.ourRing - b.ourRing);
  emit(`S SHIPS n=${ships.length} nearest=${J(ships.slice(0, 8))}`);
  const usable = ships.filter((s) => s.war === false && s.ourRing <= 7 && s.wet >= 2 && s.unownedWet + s.oursWet === s.wet);
  emit(`S VERDICT => ` + (usable.length
    ? `${usable.length} ship(s) could be penned on THIS save: ${J(usable.slice(0, 3))}`
    : `no pennable ship on this save (nearest peaceful ship is ${ships.find((s) => s.war === false)?.ourRing ?? "?"} `
      + `rings out; a claim only survives inside about 7). Try a coastal/naval save.`));
}

function run() {
  local = GameContext.localPlayerID;
  emit(`S0 run27 turn=${safe(() => Game.turn)} local=${local} READ-ONLY flipMaxDistance=${CONFIG.flipMaxDistance}`);
  const units = allUnits();
  emit(`S0 units total=${units.length}`);
  stageT(units);
  stageS(units);
  setTimeout(() => emit("DONE harness run27 finished"), 2000);
}

emit("attached run27");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { try { run(); } catch (e) { emit("run threw " + e); } }, 8000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
