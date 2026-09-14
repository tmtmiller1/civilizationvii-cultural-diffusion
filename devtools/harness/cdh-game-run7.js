// cdh-game-run7.js - game scope, deployed as ui/cdh-game.js. Run 7 (dev only).
// Deploy the mod with debug, recedeBorders and growthBuffer on, as run 3 had. Three questions in one route:
//   CRASH  Run 3 crashed at the Antiquity -> Exploration transition; run 5 replayed the route with the current build and
//          no harness tests and did not crash. This run replays run 3's first-turn harness tests (R3 citizen EXPAND to a
//          far tile, R4 destroy/recreate and far creates, R7 rival tile purchase + recede seed) on the current build, and
//          ends the same 25 turns. If it crashes, those tests are implicated; if not, run 3's old build is the remaining
//          suspect. After the transition this script only watches (run 3 crashed before GameStarted, so its re-run never
//          acted either).
//   WAR    Each turn: for every rival major, the engine's Diplomacy.isAtWarWith and the mod's own atWar (cd-borders.js).
//          Run 3 saw player 3 read as at war on turn 136, then saw the mod take player 3's tiles on turns 155-156.
//   LENS   After 180s alive in the new age: switch on the Cultural Pressure lens and log LENS ACTIVE for a screenshot.
// Tagged [CDH] in Logs/UI.log.

import LensManager from "/core/ui/lenses/lens-manager.js";
import { atWar as cdAtWar } from "/cultural-diffusion/ui/cd-borders.js";

const TAG = "[CDH]";
const TURNS = 25;
const STATE_KEY = "CulturalDiffusionState_v2";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ageType() { return safe(() => GameInfo.Ages.lookup(Game.age).AgeType, "?"); }

let local = -1;
const YIELDS = ["YIELD_FOOD", "YIELD_PRODUCTION", "YIELD_GOLD", "YIELD_SCIENCE", "YIELD_CULTURE", "YIELD_HAPPINESS"];
function send(op, args, sender) { return safe(() => Game.PlayerOperations.sendRequest(sender == null ? local : sender, op, args), "ERR"); }
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
function where(l) { return { owner: owner(l), city: owningCity(l) }; }
function inRadius(center, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(center.x, center.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function cityName(c) { return safe(() => Locale.compose(c.name), "?"); }
function plotTypes(l) {
  return safe(() => (MapConstructibles.getConstructibles(l.x, l.y) || []).map((id) => {
    const i = Constructibles.getByComponentID(id); const info = i ? GameInfo.Constructibles.lookup(i.type) : null;
    return info ? info.ConstructibleType : "?";
  }), []);
}
function gold(pid) { return safe(() => Players.get(pid).Treasury.goldBalance, null); }
function refundBuy(pid, city, l) {
  const g0 = gold(pid);
  const call = safe(() => { city.purchasePlot(l); return "called"; }, "throw");
  const g1 = gold(pid);
  const spent = (typeof g0 === "number" && typeof g1 === "number") ? Math.max(0, g0 - g1) : 0;
  if (spent > 0) safe(() => Players.get(pid).Treasury.changeGoldBalance(spent));
  return { call, spent };
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function nearest(l, cities) {
  let best = null; let bd = 1e9;
  for (const c of cities) { const d = dist(c.location, l); if (d < bd) { bd = d; best = c; } }
  return best ? { city: best, d: bd } : null;
}
function touches(l, pid) { return inRadius(l, 1).some((n) => !(n.x === l.x && n.y === l.y) && owner(n) === pid); }
function landClean(l) {
  return safe(() => {
    if (GameplayMap.isWater(l.x, l.y)) return false;
    const blocked = typeof GameplayMap.isImpassable === "function" ? GameplayMap.isImpassable(l.x, l.y) : GameplayMap.isMountain(l.x, l.y);
    if (blocked) return false;
    if (GameplayMap.getRevealedState(local, l.x, l.y) <= 0) return false;
    return (MapUnits.getUnits(l.x, l.y) || []).length === 0;
  }, false);
}
function snap(c) {
  if (!c) return null;
  const net = {};
  for (const y of YIELDS) net[y.slice(6)] = safe(() => Math.round(c.Yields.getNetYield(YieldTypes[y]) * 10) / 10, null);
  return { pop: safe(() => c.population, null), rural: safe(() => c.ruralPopulation, null), pending: safe(() => c.pendingPopulation, null), net };
}
function typeName(table, col, id) { return safe(() => { const r = GameInfo[table].lookup(id); return r ? r[col] : null; }, null); }
function terrainOf(l) {
  return {
    ter: typeName("Terrains", "TerrainType", safe(() => GameplayMap.getTerrainType(l.x, l.y), -1)),
    feat: typeName("Features", "FeatureType", safe(() => GameplayMap.getFeatureType(l.x, l.y), -1)),
    res: typeName("Resources", "ResourceType", safe(() => GameplayMap.getResourceType(l.x, l.y), -1)),
    bio: typeName("Biomes", "BiomeType", safe(() => GameplayMap.getBiomeType(l.x, l.y), -1))
  };
}
let FREE = null;
function ruralPick(l) {
  if (!FREE) {
    FREE = safe(() => Database.query("gameplay", "SELECT ConstructibleType, ResourceType, FeatureType, TerrainType, BiomeType, RiverType "
      + "FROM District_FreeConstructibles WHERE DistrictType='DISTRICT_RURAL' ORDER BY Priority ASC") || [], []);
  }
  const t = terrainOf(l);
  const ok = (r) => !r.RiverType && (!r.ResourceType || r.ResourceType === t.res) && (!r.FeatureType || r.FeatureType === t.feat)
    && (!r.TerrainType || r.TerrainType === t.ter) && (!r.BiomeType || r.BiomeType === t.bio);
  const row = (FREE || []).find((r) => !/EMIG|HAWAII|INCA|EXPEDITION/.test(r.ConstructibleType) && ok(r));
  return row ? row.ConstructibleType : null;
}

// --- WAR: the engine's reading and the mod's reading, every turn ---------------------------------------------------
function majors() { return safe(() => Players.getAlive().filter((p) => p.id !== local && p.isMajor).map((p) => p.id), []); }
function warLine(turn) {
  const rows = majors().map((pid) => {
    const eng = safe(() => !!Players.get(local).Diplomacy.isAtWarWith(pid), "E");
    const mod = safe(() => !!cdAtWar(local, pid), "E");
    return `${pid}:${eng ? 1 : 0}/${mod ? 1 : 0}${eng === mod ? "" : "!"}`;
  });
  emit(`WAR turn=${turn} engine/mod ${rows.join(" ")}`);
}

// --- run 3's first-turn tests, unchanged in substance ---------------------------------------------------------------
function frontierByCity(cities) {
  const seen = new Set(); const by = new Map();
  for (const c of cities) {
    for (const l of inRadius(c.location, 5)) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      if (owner(l) !== -1 || !landClean(l) || !touches(l, local)) continue;
      if (cities.some((cc) => dist(cc.location, l) <= 3)) continue;
      const n = nearest(l, cities);
      if (!by.has(n.city)) by.set(n.city, []);
      by.get(n.city).push({ loc: l, city: n.city, d: n.d });
    }
  }
  return by;
}

async function expandFar(c, F) {
  const before = snap(c);
  emit(`R3 ${cityName(c)} addRuralPopulation(+1) -> ${safe(() => { c.addRuralPopulation(1); return "ok"; })} far=${key(F.loc)} ring=${F.d}`);
  await later(1500);
  const can = safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.EXPAND, {}, false), null);
  const plots = (can && can.Plots) || [];
  const r = safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.EXPAND, { X: F.loc.x, Y: F.loc.y }), "ERR");
  await later(4000);
  const farTypes = plotTypes(F.loc); const afterFar = snap(c);
  emit(`R3 EXPAND far -> ${J(r)} plotNow=${J(farTypes)} before=${J(before)} after=${J(afterFar)}`);
  if (!farTypes.length && plots.length && afterFar && afterFar.pending > 0) {
    const ctl = GameplayMap.getLocationFromIndex(plots[0]);
    const r2 = safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.EXPAND, { X: ctl.x, Y: ctl.y }), "ERR");
    await later(4000);
    emit(`R3 CONTROL ${key(ctl)} -> ${J(r2)} plotNow=${J(plotTypes(ctl))}`);
  }
}

function improvedPlot(c) {
  return safe(() => {
    for (const p of c.getPurchasedPlots()) {
      const l = GameplayMap.getLocationFromIndex(p);
      const d = dist(c.location, l);
      if (d < 1 || d > 3) continue;
      const dd = Districts.getAtLocation(l); if (!dd) continue;
      const ids = dd.getConstructibleIdsOfClass(ConstructibleClasses.IMPROVEMENT) || [];
      if (!ids.length) continue;
      const inst = Constructibles.getByComponentID(ids[0]); const info = inst ? GameInfo.Constructibles.lookup(inst.type) : null;
      if (!info || /FISHING/.test(info.ConstructibleType) || GameplayMap.getResourceType(l.x, l.y) !== -1) continue;
      return { loc: l, elem: ids[0], type: info.ConstructibleType, d };
    }
    return null;
  }, null);
}
async function createOn(label, c, l, type) {
  const idx = safe(() => GameInfo.Constructibles.lookup(type).$index, null);
  if (idx == null) { emit(`${label} no index for ${type}`); return; }
  send("CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: idx, Location: l, Parent: c.id, Owner: c.owner });
  await later(4500);
  emit(`${label} ${key(l)} create ${type} -> plotNow=${J(plotTypes(l))}`);
}
async function createFar(c, farTiles) {
  const t = improvedPlot(c);
  if (t) {
    send("DESTROY_ELEMENT", { Kind: "CONSTRUCTIBLE", Owner: t.elem.owner, LocalID: t.elem.id });
    await later(4000);
    await createOn("R4 CONTROL", c, t.loc, t.type);
  }
  for (const f of farTiles) {
    const pick = ruralPick(f.loc);
    if (pick) await createOn("R4 FAR-PICK", c, f.loc, pick);
    if (t && t.type !== pick) await createOn("R4 FAR-COPY", c, f.loc, t.type);
  }
}

async function seedRecede(cities) {
  const ids = majors();
  let pick = null;
  for (const c of cities) {
    for (const l of inRadius(c.location, 6)) {
      const o = owner(l);
      if (ids.indexOf(o) < 0 || !landClean(l) || !touches(l, local)) continue;
      const rc = nearest(l, safe(() => Players.get(o).Cities.getCities() || [], []));
      if (!rc || rc.d <= 0 || rc.d > 6) continue;
      const mine = nearest(l, cities);
      if (!pick || mine.d < pick.mine.d) pick = { loc: l, rival: o, rc, mine };
    }
  }
  if (!pick) { emit("R7 skipped"); return; }
  refundBuy(local, pick.mine.city, pick.loc);
  await later(4000);
  const k = key(pick.loc);
  if (owner(pick.loc) !== local) { emit(`R7 buy did not land: ${J(where(pick.loc))}`); return; }
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  d.field[k] = { [String(local)]: 400, [String(pick.rival)]: 5000 };
  d.claims[k] = { by: local, city: owningCity(pick.loc), turn: d.monoTurn };
  delete d.locked[k];
  const w = safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); return "set"; }, "throw");
  emit(`R7 SEED ${k} rival=${pick.rival} write=${w} where=${J(where(pick.loc))}`);
}

async function run() {
  local = GameContext.localPlayerID;
  const cities = localCities();
  emit(`S0 run7 turn=${safe(() => Game.turn)} age=${ageType()} cd=${J(safe(() => { const c = globalThis.culturalDiffusion.config(); return { debug: c.debug, recede: c.recedeBorders, buffer: c.growthBuffer }; }, null))}`);
  warLine(safe(() => Game.turn, -1));
  const by = frontierByCity(cities);
  let best = null;
  for (const [c, list] of by) if (!best || list.length > best.list.length) best = { c, list };
  if (best && best.list.length >= 3) {
    const reserved = best.list.slice(0, 3);
    for (const t of reserved) refundBuy(local, best.c, t.loc);
    await later(4500);
    const landed = reserved.filter((t) => owner(t.loc) === local && owningCity(t.loc) >= 0);
    emit(`S2 ${cityName(best.c)} landed=${J(reserved.map((t) => ({ k: key(t.loc), ...where(t.loc) })))}`);
    if (landed[0]) await expandFar(best.c, landed[0]);
    if (landed.length > 1) await createFar(best.c, landed.slice(1));
  } else emit("R3/R4 skipped");
  await seedRecede(cities);
  emit("ACTIONS done; ending turns as run 3 did");
  setTimeout(endTurn, 3000);
}

let mode = "loading";
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
  if (who !== GameContext.localPlayerID) return;
  const turn = safe(() => Game.turn, -1);
  if (local < 0) local = GameContext.localPlayerID;
  setTimeout(() => warLine(turn), 4000);
  if (mode !== "antiquity") { emit(`TURN turn=${turn} age=${ageType()} mode=${mode}`); return; }
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  emit(`TURN n=${n} turn=${turn} age=${ageType()}`);
  if (n > TURNS) { emit("ANTIQUITY turns done"); return; }
  setTimeout(endTurn, 8000);
});

// --- after the transition: watch only, then the lens smoke test ------------------------------------------------------
function explorationWatch() {
  mode = "exploration";
  local = GameContext.localPlayerID;
  const attachedAt = Date.now();
  emit(`E1 new age turn=${safe(() => Game.turn)} age=${ageType()}`);
  let beats = 0;
  const beat = setInterval(() => {
    beats++;
    emit(`E2 alive ${Math.round((Date.now() - attachedAt) / 1000)}s turn=${safe(() => Game.turn)}`);
    if (beats * 15 >= 180) { clearInterval(beat); emit("DONE run7 survived 180s into the new age"); lensTest(); }
  }, 15000);
}

function lensTest() {
  const before = safe(() => LensManager.getActiveLens(), "?");
  const set = safe(() => { LensManager.setActiveLens("cd-pressure-lens"); return "called"; }, "throw");
  setTimeout(() => {
    emit(`LENS ACTIVE before=${before} set=${set} active=${safe(() => LensManager.getActiveLens(), "?")} `
      + `layerEnabled=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")} claims=${J(safe(() => Object.keys(JSON.parse(Configuration.getGame().getValue(STATE_KEY)).data.claims).length, "?"))}`);
  }, 4000);
}

emit("attached run7");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    emit(`LOAD GameStarted age=${ageType()}`);
    setTimeout(() => {
      if (ageType() === "AGE_ANTIQUITY") { mode = "antiquity"; n = 1; run().catch((e) => emit("run threw " + e + " " + (e && e.stack))); }
      else explorationWatch();
    }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
