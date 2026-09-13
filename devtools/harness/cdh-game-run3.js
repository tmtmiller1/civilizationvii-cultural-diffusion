// cdh-game-run3.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 3 (dev only).
// Deploy the mod with recedeBorders: true AND debug: true for this run. In the first local turn:
//   R3 EXPAND   give the city with the most frontier a pending citizen, order it onto a far tile we just bought
//               (the offered list may be advisory); control = an offered plot
//   R4 CREATE   destroy + recreate a ring<=3 improvement (control), then create on a far tile both that type and the
//               rural table's own pick for the far tile's terrain
//   R7 RECEDE   buy a rival tile touching our land, then seed the mod's state with a claim on it and a dominant rival
//               stock, so the mod's OWN recede step cedes it (pending) and confirms it next pass
// then ends TURNS turns with NO culture seeding, so the mod's natural pace to a first claim is measured.
// Tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
const TURNS = 25;
const STATE_KEY = "CulturalDiffusionState_v2";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

// Unowned frontier beyond ring 3 that touches our land, grouped by nearest city.
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
  const idx = safe(() => GameplayMap.getIndexFromLocation(F.loc), -1);
  const before = snap(c);
  emit(`R3 ${cityName(c)} town=${c.isTown} addRuralPopulation(+1) -> ${safe(() => { c.addRuralPopulation(1); return "ok"; })} far=${key(F.loc)} ring=${F.d} where=${J(where(F.loc))}`);
  await later(1500);
  const can = safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.EXPAND, {}, false), null);
  const plots = (can && can.Plots) || [];
  const canFar = safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.EXPAND, { X: F.loc.x, Y: F.loc.y }, false), null);
  emit(`R3 canStart success=${!!(can && can.Success)} offered=${plots.length} offersFar=${plots.indexOf(idx) >= 0} canStartFarXY=${!!(canFar && canFar.Success)} `
    + `why=${J(canFar && canFar.FailureReasons)} pending=${safe(() => c.pendingPopulation)} maxOfferedRing=${plots.reduce((m, p) => Math.max(m, dist(c.location, GameplayMap.getLocationFromIndex(p))), 0)}`);
  const r = safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.EXPAND, { X: F.loc.x, Y: F.loc.y }), "ERR");
  await later(4000);
  const farTypes = plotTypes(F.loc); const afterFar = snap(c);
  emit(`R3 sendRequest EXPAND far -> ${J(r)} plotNow=${J(farTypes)} before=${J(before)} after=${J(afterFar)}`);
  let verdict = farTypes.length ? "FAR-EXPAND-PLACED" : "FAR-EXPAND-REJECTED";
  if (!farTypes.length && plots.length && afterFar && afterFar.pending > 0) {
    const ctl = GameplayMap.getLocationFromIndex(plots[0]);
    const r2 = safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.EXPAND, { X: ctl.x, Y: ctl.y }), "ERR");
    await later(4000);
    const ctlTypes = plotTypes(ctl);
    emit(`R3 CONTROL offered ${key(ctl)} ring=${dist(c.location, ctl)} -> ${J(r2)} plotNow=${J(ctlTypes)} after=${J(snap(c))}`);
    verdict += ctlTypes.length ? "(control placed)" : "(control ALSO failed)";
  }
  emit("R3 VERDICT " + verdict);
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
  if (idx == null) { emit(`${label} no index for ${type}`); return false; }
  const before = snap(c);
  send("CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: idx, Location: l, Parent: c.id, Owner: c.owner });
  await later(4500);
  const now = plotTypes(l);
  emit(`${label} ${key(l)} ring=${dist(c.location, l)} terrain=${J(terrainOf(l))} where=${J(where(l))} create ${type} -> plotNow=${J(now)} before=${J(before)} after=${J(snap(c))}`);
  return now.indexOf(type) >= 0;
}
async function createFar(c, farTiles) {
  const t = improvedPlot(c);
  let control = "SKIPPED";
  if (t) {
    send("DESTROY_ELEMENT", { Kind: "CONSTRUCTIBLE", Owner: t.elem.owner, LocalID: t.elem.id });
    await later(4000);
    control = (await createOn("R4 CONTROL", c, t.loc, t.type)) ? "RECREATED" : "FAILED";
  }
  const results = [];
  for (const f of farTiles) {
    const pick = ruralPick(f.loc);
    if (pick) results.push(`${key(f.loc)} pick ${pick}: ${(await createOn("R4 FAR-PICK", c, f.loc, pick)) ? "PLACED" : "REJECTED"}`);
    if (t && t.type !== pick) results.push(`${key(f.loc)} copy ${t.type}: ${(await createOn("R4 FAR-COPY", c, f.loc, t.type)) ? "PLACED" : "REJECTED"}`);
  }
  emit(`R4 VERDICT control=${control}${t ? "(" + t.type + ")" : ""} far=${J(results)}`);
}

async function seedRecede(cities) {
  const majors = safe(() => Players.getAlive().filter((p) => p.id !== local && p.isMajor).map((p) => p.id), []);
  let pick = null;
  for (const c of cities) {
    for (const l of inRadius(c.location, 6)) {
      const o = owner(l);
      if (majors.indexOf(o) < 0 || !landClean(l) || !touches(l, local)) continue;
      const rc = nearest(l, safe(() => Players.get(o).Cities.getCities() || [], []));
      if (!rc || rc.d <= 0 || rc.d > 6) continue;
      const mine = nearest(l, cities);
      if (!pick || mine.d < pick.mine.d) pick = { loc: l, rival: o, rc, mine };
    }
  }
  if (!pick) { emit("R7 skipped: no rival tile touching our land with a rival city within 6"); return null; }
  const war = safe(() => Players.get(local).Diplomacy.isAtWarWith(pick.rival), "?");
  refundBuy(local, pick.mine.city, pick.loc);
  await later(4000);
  const k = key(pick.loc);
  if (owner(pick.loc) !== local) { emit(`R7 buy did not land: ${J(where(pick.loc))}`); return null; }
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
  emit(`R7 SEED ${k} rival=${pick.rival} rivalCity=${cityName(pick.rc.city)} d=${pick.rc.d} ourCity=${cityName(pick.mine.city)} atWar=${war} `
    + `rivalTouches=${touches(pick.loc, pick.rival)} write=${w} where=${J(where(pick.loc))}`);
  return { k, loc: pick.loc, rival: pick.rival };
}

let recedeTile = null; let farWatch = [];
async function run() {
  local = GameContext.localPlayerID;
  const cities = localCities();
  emit(`S0 turn=${safe(() => Game.turn)} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} recedeConfig=${safe(() => globalThis.culturalDiffusion.config().recedeBorders)} debug=${safe(() => globalThis.culturalDiffusion.config().debug)}`);
  const by = frontierByCity(cities);
  let best = null;
  for (const [c, list] of by) if (!best || list.length > best.list.length) best = { c, list };
  if (!best || best.list.length < 3) { emit(`R3/R4 skipped: best frontier city has ${best ? best.list.length : 0} tiles`); }
  else {
    const reserved = best.list.slice(0, 3);
    emit(`S1 city=${cityName(best.c)} town=${best.c.isTown} frontierTiles=${best.list.length} reserved=${J(reserved.map((t) => ({ k: key(t.loc), ring: t.d, terrain: terrainOf(t.loc) })))}`);
    for (const t of reserved) refundBuy(local, best.c, t.loc);
    await later(4500);
    const landed = reserved.filter((t) => owner(t.loc) === local && owningCity(t.loc) >= 0);
    emit(`S2 landed=${J(reserved.map((t) => ({ k: key(t.loc), ...where(t.loc) })))}`);
    farWatch = landed;
    if (landed[0]) await expandFar(best.c, landed[0]);
    if (landed.length > 1) await createFar(best.c, landed.slice(1));
  }
  recedeTile = await seedRecede(cities);
  emit("ACTIONS done; ending turns (no culture seeding: natural pace)");
  setTimeout(endTurn, 3000);
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
function cdSummary() {
  return safe(() => {
    const raw = Configuration.getGame().getValue(STATE_KEY); if (!raw) return { state: false };
    const d = (JSON.parse(raw).data) || {};
    const r = recedeTile ? { k: recedeTile.k, ...where(recedeTile.loc), claim: (d.claims || {})[recedeTile.k] || null, pending: (d.pending || {})[recedeTile.k] || null } : null;
    return { bytes: raw.length, field: Object.keys(d.field || {}).length, claims: Object.keys(d.claims || {}).length, pending: Object.keys(d.pending || {}).length, recede: r };
  }, { state: "ERR" });
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => emit(`TURN n=${n} turn=${safe(() => Game.turn)} cd=${J(cdSummary())} far=${J(farWatch.map((t) => ({ k: key(t.loc), types: plotTypes(t.loc) })))}`), 5000);
  if (n > TURNS) { setTimeout(() => emit("DONE harness run3 finished"), 6000); return; }
  setTimeout(endTurn, 8000);
});

emit("attached run3");
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
