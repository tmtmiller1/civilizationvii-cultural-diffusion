// cdh-game-run25.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 25 (dev only).
//
// READ-ONLY. Two questions about the strand guard's notion of "somewhere a unit may go", both raised by the
// mountain bug it already cost four runs to find (runs 19-23).
//
//   F  FEATURES. The compiled DB says impassability lives in TWO tables: Terrains has exactly one impassable
//      row (TERRAIN_MOUNTAIN), while Features has EIGHTEEN - FEATURE_VOLCANO, FEATURE_ICE and sixteen natural
//      wonders (Everest, Uluru, Grand Canyon, Mount Fuji, Thera, ...). The guard calls
//      GameplayMap.isImpassable(x,y). If that reads TERRAIN only, then a unit whose last neighbour is a
//      volcano or a natural wonder reads as mobile and the guard permits the claim that freezes it - the
//      mountain bug again, in seventeen more flavours. This compares, plot by plot, the engine's
//      isImpassable against the feature's own Impassable flag from GameInfo.
//   D  DOMAIN. The guard treats WATER as blocked for every unit, so a naval unit always reads as having zero
//      exits and is never protected - while the pass CAN own water (diffuseAcrossWater is on by default and
//      the +1 buffer claims unowned water). To make blocking domain-aware the mod needs to read a unit's
//      domain; this reports which of the candidate reads actually resolve on a real unit.
//
// No turns, no writes, no pass. Tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }

let local = -1;
const key = (l) => l.x + "," + l.y;
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }

function featureAt(loc) {
  const f = safe(() => GameplayMap.getFeatureType(loc.x, loc.y), null);
  if (f == null || f < 0) return null;
  const def = safe(() => GameInfo.Features.lookup(f), null);
  return def ? { type: def.FeatureType, impassableInDb: !!def.Impassable } : { type: String(f), impassableInDb: null };
}
function terrainAt(loc) {
  const t = safe(() => GameplayMap.getTerrainType(loc.x, loc.y), null);
  const def = t == null ? null : safe(() => GameInfo.Terrains.lookup(t), null);
  return def ? { type: def.TerrainType, impassableInDb: !!def.Impassable } : null;
}

function stageF() {
  const seen = new Set();
  const rows = [];
  for (const c of localCities()) {
    for (const p of inRadius(c.location, 12)) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const f = featureAt(p);
      const t = terrainAt(p);
      const engineSays = safe(() => !!GameplayMap.isImpassable(p.x, p.y), "ERR");
      // Only interesting where the DB calls something impassable, or the engine does.
      if (!(f && f.impassableInDb) && !(t && t.impassableInDb) && engineSays !== true) continue;
      rows.push({ at: k, feature: f && f.type, featureImpassable: f && f.impassableInDb,
        terrain: t && t.type, terrainImpassable: t && t.impassableInDb, engineIsImpassable: engineSays });
    }
  }
  emit(`F PLOTS n=${rows.length} ${J(rows.slice(0, 14))}`);
  const featureBlocked = rows.filter((r) => r.featureImpassable === true);
  const missed = featureBlocked.filter((r) => r.engineIsImpassable !== true);
  const terrainBlocked = rows.filter((r) => r.terrainImpassable === true);
  const terrainMissed = terrainBlocked.filter((r) => r.engineIsImpassable !== true);
  emit(`F COUNTS impassableFeaturePlots=${featureBlocked.length} ofWhichEngineMisses=${missed.length} `
    + `impassableTerrainPlots=${terrainBlocked.length} ofWhichEngineMisses=${terrainMissed.length}`);
  emit(`F MISSED ${J(missed.slice(0, 8))}`);
  emit(`F VERDICT => ` + (featureBlocked.length === 0
    ? "NO impassable-feature plot in range - inconclusive, retry on a map with a volcano/natural wonder nearby"
    : missed.length === 0
      ? "isImpassable COVERS features: the guard is already correct for volcanoes, ice and natural wonders"
      : `isImpassable MISSES features on ${missed.length}/${featureBlocked.length} plots: the guard must read `
        + `GameInfo.Features.Impassable as well, or a unit whose last exit is one of these is trapped`));
}

function stageD() {
  const rows = [];
  for (const p of safe(() => Players.getAlive() || [], [])) {
    const pid = safe(() => p.id, -1);
    const units = safe(() => p.Units?.getUnits?.() || [], []);
    for (const u of units.slice(0, 40)) {
      const unit = safe(() => (u && u.location ? u : Units.get(u)), null);
      if (!unit) continue;
      const def = safe(() => GameInfo.Units.lookup(unit.type), null);
      const domain = def && (def.Domain || def.UnitMovementClass || null);
      if (!domain) continue;
      rows.push({ pid, type: def.UnitType, domain: def.Domain || null, movementClass: def.UnitMovementClass || null,
        coreClass: def.CoreClass || null, formation: def.FormationClass || null,
        onWater: safe(() => !!GameplayMap.isWater(unit.location.x, unit.location.y), "ERR") });
    }
  }
  const naval = rows.filter((r) => /NAVAL|SEA/i.test(`${r.domain} ${r.movementClass} ${r.formation}`) || r.onWater === true);
  emit(`D UNITS n=${rows.length} sample=${J(rows.slice(0, 6))}`);
  emit(`D NAVAL n=${naval.length} ${J(naval.slice(0, 6))}`);
  emit(`D VERDICT => ` + (rows.length === 0 ? "no unit definition resolved - domain reads unavailable"
    : naval.length === 0 ? "domain reads work, but no naval unit on the map to confirm the water case"
      : "domain reads work AND naval units exist: domain-aware blocking is implementable"));
}

function run() {
  local = GameContext.localPlayerID;
  emit(`S0 run25 turn=${safe(() => Game.turn)} local=${local} READ-ONLY`);
  stageF();
  stageD();
  setTimeout(() => emit("DONE harness run25 finished"), 2000);
}

emit("attached run25");
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
