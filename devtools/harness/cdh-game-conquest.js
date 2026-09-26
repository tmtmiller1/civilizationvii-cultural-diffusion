// cdh-game-conquest.js - game scope, deployed as ui/cdh-game.js. WATCH a conquest flip end to end (dev only).
//
// Run with the deployed config patched to `conquestFlip: true` (run-harness.sh PATCH). Scripts cannot move a unit
// (harness run 13), so the run PLANTS one: a combat unit of ours is created with the CREATE_ELEMENT request the
// Emigration mod uses for its migrants (watched working), on a tile that an enemy MAJOR owns, that touches our land,
// is not a settlement centre or urban district, and is as far from that enemy's cities as the frontier allows (so
// the unit is less likely to be attacked before the buffer runs out). Then the mod's own pass does the rest:
//
//   C0  boot + toggles; which majors we are at war with
//   C1  the site and the plant; the occupant read on the tile must name us
//   C2  one immediate pass (culturalDiffusion.runNow()) starts the count at 1
//   Cn  each turn: the occupation counter for the tile, its owner, whether our unit is still standing there, the
//       claim / pending record; the mod's pass log carries `conquest x,y: taken from player ...`
//   VERDICT  the tile reads as ours (or pending then confirmed) once the hold reaches conquestBufferTurns
// Turns are rolled the gold2 way (send anyway, no Autoplay - Autoplay would move our unit).

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { hostileCombatOccupants, conquerable } from "/cultural-diffusion/ui/cd-conquest.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const UNIT_TYPES = ["UNIT_SPEARMAN", "UNIT_WARRIOR", "UNIT_ARCHER"];
let TURNS = 9;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function impassable(l) { return safe(() => !!GameplayMap.isImpassable(l.x, l.y), false); }
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function neighbours(p) { return inRadius(p, 1).filter((n) => n.x !== p.x || n.y !== p.y); }
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function readState() {
  return safe(() => { const raw = Configuration.getGame().getValue(STATE_KEY); const s = raw ? JSON.parse(raw) : null; return (s && (s.data || s)) || {}; }, {});
}
function unitsAt(l) {
  return safe(() => {
    const out = [];
    for (const cid of MapUnits.getUnits(l.x, l.y)) {
      const u = Units.get(cid);
      if (u) out.push({ owner: u.owner, type: safe(() => GameInfo.Units.lookup(u.type).UnitType, "?"), combat: safe(() => u.Combat?.isCombat, "?"), hp: safe(() => u.Health?.damage ?? u.damage, "?") });
    }
    return out;
  }, []);
}
function enemies() {
  return safe(() => Players.getAlive().filter((p) => p.id !== local && p.isMajor && Players.get(local).Diplomacy.isAtWarWith(p.id)).map((p) => p.id), []);
}
function citiesOf(pid) { return safe(() => Players.get(pid).Cities.getCities() || [], []); }

/** The best plant site among an enemy's tiles: touching our land, conquerable, empty, far from its cities. */
function findSite(enemyIds) {
  let best = null;
  const ours = localCities();
  for (const e of enemyIds) {
    const eCities = citiesOf(e).map((c) => c.location);
    for (const c of ours) {
      for (const t of inRadius(c.location, 7)) {
        if (owner(t) !== e || isWater(t) || impassable(t)) continue;
        if (!conquerable(t, e)) continue;
        if (!neighbours(t).some((n) => owner(n) === local)) continue;
        if (unitsAt(t).length) continue;
        const dEnemy = Math.min(...eCities.map((cl) => dist(cl, t)), 99);
        const dOurs = dist(c.location, t);
        if (!best || dEnemy > best.dEnemy || (dEnemy === best.dEnemy && dOurs < best.dOurs)) best = { e, t, dEnemy, dOurs };
      }
    }
  }
  return best;
}

async function plant(site) {
  for (const type of UNIT_TYPES) {
    const r = safe(() => Game.PlayerOperations.sendRequest(local, "CREATE_ELEMENT", {
      IndependentIndex: -1, Kind: "UNIT", Location: site.t, Owner: local, Type: type
    }), "THREW");
    await later(3000);
    const us = unitsAt(site.t);
    emit(`C1 PLANT ${type} at ${key(site.t)} request=${js(r)} unitsOnTile(+3s)=${js(us)}`);
    if (us.some((u) => u.owner === local && u.combat === true)) return type;
  }
  return null;
}

let site = null;
let planted = null;
let firstSeen = -1;

function report(label) {
  if (!site) return;
  const st = readState();
  const k = key(site.t);
  const us = unitsAt(site.t);
  emit(`${label} tile=${k} owner=${owner(site.t)} occupation=${js((st.occupation || {})[k])} pending=${js((st.pending || {})[k])} claim=${js((st.claims || {})[k])} locked=${js((st.locked || {})[k])} units=${js(us)} occupants=${js(safe(() => hostileCombatOccupants(site.t, owner(site.t))))}`);
  return { owner: owner(site.t), ours: us.some((u) => u.owner === local), occ: (st.occupation || {})[k] };
}

async function run() {
  local = GameContext.localPlayerID;
  const cfg = safe(() => culturalDiffusion.config(), null);
  const foes = enemies();
  emit(`C0 BOOT turn=${safe(() => Game.turn)} local=${local} config=${cfg ? js({ conquest: cfg.conquestFlip, buffer: cfg.conquestBufferTurns, adjacency: cfg.requireAdjacency, ai: cfg.aiCultureFlips, safety: cfg.claimOnlyUnowned }) : "ABSENT"} atWarWith=${js(foes)}`);
  if (!cfg || !cfg.conquestFlip) { emit("C0 VERDICT conquestFlip is not on in the deployed config; abort"); emit("DONE harness conquest finished"); return; }
  if (!foes.length) { emit("C0 VERDICT we are at war with no major in this save; a conquest flip cannot be watched here"); emit("DONE harness conquest finished"); return; }
  TURNS = Math.max(4, Math.floor(cfg.conquestBufferTurns)) + 4;
  site = findSite(foes);
  if (!site) { emit("C1 VERDICT no enemy-owned, conquerable, empty tile touching our land inside the region"); emit("DONE harness conquest finished"); return; }
  emit(`C1 SITE enemy=${site.e} tile=${key(site.t)} dEnemyCity=${site.dEnemy} dOurCity=${site.dOurs} district=${js(safe(() => GameInfo.Districts.lookup(GameplayMap.getDistrictType(site.t.x, site.t.y))?.DistrictType, null))}`);
  planted = await plant(site);
  if (!planted) { emit("C1 VERDICT could not create a combat unit on the tile; nothing to hold it with"); emit("DONE harness conquest finished"); return; }
  const res = safe(() => culturalDiffusion.runNow(), "ERR");
  emit(`C2 PASS runNow=${js(res)}`);
  report("C2");
  n = 1;
  setTimeout(endTurn, 3000);
}

// ---------------------------------------------------------------- turns, no Autoplay
let n = 0; let endTimer = null; let tries = 0;
function endTurn() {
  try {
    if (!Players.get(local).isTurnActive) return;
    tries++;
    if (tries > 18 && typeof Autoplay !== "undefined") {
      emit(`ENDTURN turn${n} AUTOPLAY engaged after ${tries} tries (this would move the unit)`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      endTimer = setTimeout(endTurn, 30000); return;
    }
    safe(() => UI.Player.deselectAllUnits());
    if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTimer = setTimeout(endTurn, 5000);
}
function finish() {
  const r = report("FINAL");
  const won = r && r.owner === local;
  emit(`VERDICT ${won ? `CONQUEST FLIP LANDED: ${key(site.t)} is ours after the hold` : (r && !r.ours ? "the planted unit did not survive / stay on the tile; no flip could be watched" : "the hold never reached the buffer or the flip did not land")}`);
  emit("DONE harness conquest finished");
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  n++; tries = 0;
  setTimeout(() => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
    const r = report(`C${n}`);
    if (r && r.owner === local && firstSeen < 0) firstSeen = n;
    if (n > TURNS || (firstSeen > 0 && n >= firstSeen + 1)) { finish(); return; }
    setTimeout(endTurn, 4000);
  }, 5000);
});

emit("attached conquest");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => emit("run threw " + e)); }, 12000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
