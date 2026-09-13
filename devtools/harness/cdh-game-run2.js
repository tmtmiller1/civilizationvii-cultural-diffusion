// cdh-game-run2.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 2 (dev only).
// Run 1 (cdh-game.js, run1-antiquity-turn136-UI.log) settled: purchasePlot works for us and for a rival but lands
// AFTER the call; owned territory blocks founding; setOwnership(NO_PLAYER) does not release a city-attached tile;
// Game.age is a hash. Run 2, in the first local turn:
//   R1 SEED     write a mature Cultural Diffusion stock onto a frontier tile, so the mod's OWN pass shows the new
//               pending -> confirmed path on the real engine over the next turns
//   R2 RELEASE  three variants on tiles we buy: setOwnership(me) then (NO_PLAYER); destroy the plot's district then
//               (NO_PLAYER); plain (NO_PLAYER) read after 10s
//   R3 EXPAND   give a city a pending citizen, then order it onto a far claimed tile directly (the offered list may
//               be advisory); control = an offered plot
//   R4 CREATE   destroy + recreate a ring<=3 improvement (proven control), then create the same type on a far tile
//   R5 AGE      GameInfo.Ages.lookup(Game.age).AgeType on the real engine
// then ends TURNS turns so the seeded flip is sent, lands, and is confirmed. Tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
const TURNS = 4;
const STATE_KEY = "CulturalDiffusionState_v2";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
const NO_PLAYER = safe(() => (PlayerIds.NO_PLAYER != null ? PlayerIds.NO_PLAYER : -1), -1);
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
function setOwner(pid, l) { return safe(() => { WorldBuilder.MapPlots.setOwnership(pid, l); return "called"; }, "throw"); }
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
  return { pop: safe(() => c.population, null), rural: safe(() => c.ruralPopulation, null), urban: safe(() => c.urbanPopulation, null),
    pending: safe(() => c.pendingPopulation, null), plots: safe(() => c.getPurchasedPlots().length, null), net };
}
function typeName(table, col, id) { return safe(() => { const r = GameInfo[table].lookup(id); return r ? r[col] : null; }, null); }
function terrainOf(l) {
  return {
    ter: typeName("Terrains", "TerrainType", safe(() => GameplayMap.getTerrainType(l.x, l.y), -1)),
    feat: typeName("Features", "FeatureType", safe(() => GameplayMap.getFeatureType(l.x, l.y), -1)),
    res: typeName("Resources", "ResourceType", safe(() => GameplayMap.getResourceType(l.x, l.y), -1))
  };
}

// Unowned frontier tiles beyond ring 3 of every local city that touch our land, nearest-first per city.
function frontier(cities) {
  const seen = new Set(); const out = [];
  for (const c of cities) {
    for (const l of inRadius(c.location, 5)) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      if (owner(l) !== -1 || !landClean(l) || !touches(l, local)) continue;
      if (cities.some((cc) => dist(cc.location, l) <= 3)) continue;
      const n = nearest(l, cities);
      out.push({ loc: l, city: n.city, d: n.d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
function take(list, used, pred) {
  const i = list.findIndex((t) => !used.has(key(t.loc)) && (!pred || pred(t)));
  if (i < 0) return null;
  used.add(key(list[i].loc));
  return list[i];
}

function cdRaw() { return safe(() => Configuration.getGame().getValue(STATE_KEY), null); }
function cdTile(k) {
  return safe(() => {
    const raw = cdRaw(); if (!raw) return { state: false };
    const s = JSON.parse(raw); const d = s.data || s;
    return { stock0: d.field && d.field[k] ? Math.round(d.field[k]["0"] || 0) : 0, claim: (d.claims || {})[k] || null,
      pending: (d.pending || {})[k] || null, locked: (d.locked || {})[k] || 0, claims: Object.keys(d.claims || {}).length,
      pendingN: Object.keys(d.pending || {}).length };
  }, { state: "ERR" });
}

// --- R1: seed a mature stock the mod's own pass will act on -----------------------------------------------------
function seedStock(t) {
  const k = key(t.loc);
  const raw = cdRaw();
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: { field: {}, claims: {}, locked: {}, pending: {}, monoTurn: 0 } };
  const d = s.data || s;
  d.field = d.field || {};
  d.field[k] = Object.assign({}, d.field[k] || {}, { [String(local)]: 5000 });
  const ok = safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify(s.data ? s : { v: 2, data: d })); return "set"; }, "throw");
  emit(`R1 SEED loc=${k} city=${cityName(t.city)} d=${t.d} write=${ok} stateHadRaw=${!!raw} now=${J(cdTile(k))} where=${J(where(t.loc))}`);
  return k;
}

// --- R2: release variants ---------------------------------------------------------------------------------------
async function releaseVariants(tiles) {
  const [v1, v2, v3] = tiles;
  if (v1) { setOwner(local, v1.loc); await later(1500); emit(`R2 V1 after setOwnership(me) ${key(v1.loc)} ${J(where(v1.loc))}`); setOwner(NO_PLAYER, v1.loc); }
  if (v2) {
    const did = safe(() => Districts.getIdAtLocation(v2.loc), null);
    emit(`R2 V2 district at ${key(v2.loc)} = ${J(did)}`);
    if (did && did.id != null && did.id !== -1) send("DESTROY_ELEMENT", { Kind: "DISTRICT", Owner: did.owner, LocalID: did.id });
    await later(2000);
    setOwner(NO_PLAYER, v2.loc);
  }
  if (v3) setOwner(NO_PLAYER, v3.loc);
  await later(4000);
  emit(`R2 at 4s V1(set me -> none)=${v1 ? J(where(v1.loc)) : "-"} V2(destroy district -> none)=${v2 ? J(where(v2.loc)) : "-"} V3(none)=${v3 ? J(where(v3.loc)) : "-"}`);
  await later(6000);
  const verdict = (t) => (t ? (owner(t.loc) < 0 ? "RELEASED" : "STILL-OWNED") : "n/a");
  emit(`R2 VERDICT at 10s V1=${verdict(v1)} ${v1 ? J(where(v1.loc)) : ""} V2=${verdict(v2)} ${v2 ? J(where(v2.loc)) : ""} V3=${verdict(v3)} ${v3 ? J(where(v3.loc)) : ""}`);
}

// --- R3: order a pending citizen onto a far claimed tile ---------------------------------------------------------
async function expandFar(F) {
  const c = F.city;
  const idx = safe(() => GameplayMap.getIndexFromLocation(F.loc), -1);
  const before = snap(c);
  emit(`R3 ${cityName(c)} addRuralPopulation(+1) -> ${safe(() => { c.addRuralPopulation(1); return "ok"; })} farTile=${key(F.loc)} ring=${dist(c.location, F.loc)} where=${J(where(F.loc))}`);
  await later(1500);
  const can = safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.EXPAND, {}, false), null);
  const plots = (can && can.Plots) || [];
  const canFar = safe(() => Game.CityCommands.canStart(c.id, CityCommandTypes.EXPAND, { X: F.loc.x, Y: F.loc.y }, false), null);
  emit(`R3 canStart EXPAND success=${!!(can && can.Success)} offered=${plots.length} offersFar=${plots.indexOf(idx) >= 0} `
    + `canStartWithFarXY=${!!(canFar && canFar.Success)} why=${J(canFar && canFar.FailureReasons)} pending=${safe(() => c.pendingPopulation)}`);
  const r = safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.EXPAND, { X: F.loc.x, Y: F.loc.y }), "ERR");
  await later(4000);
  const afterFar = snap(c);
  const farTypes = plotTypes(F.loc);
  emit(`R3 sendRequest EXPAND far ${key(F.loc)} -> ${J(r)} plotNow=${J(farTypes)} before=${J(before)} after=${J(afterFar)}`);
  let verdict = farTypes.length ? "FAR-EXPAND-PLACED" : "FAR-EXPAND-REJECTED";
  if (!farTypes.length && plots.length && afterFar && afterFar.pending > 0) {
    const ctl = GameplayMap.getLocationFromIndex(plots[0]);
    const r2 = safe(() => Game.CityCommands.sendRequest(c.id, CityCommandTypes.EXPAND, { X: ctl.x, Y: ctl.y }), "ERR");
    await later(4000);
    const ctlTypes = plotTypes(ctl);
    emit(`R3 CONTROL EXPAND offered ${key(ctl)} ring=${dist(c.location, ctl)} -> ${J(r2)} plotNow=${J(ctlTypes)} after=${J(snap(c))}`);
    verdict += ctlTypes.length ? "(control placed)" : "(control ALSO failed - inconclusive)";
  }
  emit("R3 VERDICT " + verdict);
}

// --- R4: recreate control, then the same improvement on a far tile ------------------------------------------------
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
      if (!info || /RESOURCE|FISHING/.test(info.ConstructibleType)) continue; // want a terrain improvement a far land tile can take
      return { loc: l, elem: ids[0], type: info.ConstructibleType, terrain: terrainOf(l), d };
    }
    return null;
  }, null);
}
async function createFar(c, farTiles) {
  const t = improvedPlot(c);
  if (!t) { emit(`R4 skipped: no ring<=3 terrain improvement in ${cityName(c)}`); return; }
  const typeIdx = safe(() => GameInfo.Constructibles.lookup(t.type).$index, null);
  send("DESTROY_ELEMENT", { Kind: "CONSTRUCTIBLE", Owner: t.elem.owner, LocalID: t.elem.id });
  await later(4000);
  const mid = plotTypes(t.loc);
  send("CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: typeIdx, Location: t.loc, Parent: c.id, Owner: c.owner });
  await later(4000);
  const ctl = plotTypes(t.loc);
  emit(`R4 CONTROL ${cityName(c)} ${key(t.loc)} ring=${t.d} ${t.type} terrain=${J(t.terrain)} afterDestroy=${J(mid)} afterRecreate=${J(ctl)}`);
  const match = farTiles.find((f) => { const tf = terrainOf(f.loc); return tf.ter === t.terrain.ter && tf.feat === t.terrain.feat; }) || farTiles[0];
  if (!match) { emit("R4 skipped far: no far tile of ours"); return; }
  const before = snap(c);
  send("CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: typeIdx, Location: match.loc, Parent: c.id, Owner: c.owner });
  await later(5000);
  const far = plotTypes(match.loc);
  emit(`R4 FAR ${key(match.loc)} ring=${dist(c.location, match.loc)} terrain=${J(terrainOf(match.loc))} where=${J(where(match.loc))} `
    + `create ${t.type} -> plotNow=${J(far)} before=${J(before)} after=${J(snap(c))}`);
  emit(`R4 VERDICT control=${ctl.indexOf(t.type) >= 0 ? "RECREATED" : "FAILED"} far=${far.length ? "PLACED" : "REJECTED"}`);
}

let seededKey = null; let watch = [];
async function run() {
  local = GameContext.localPlayerID;
  const cities = localCities().filter((c) => !c.isTown).concat(localCities().filter((c) => c.isTown));
  emit(`R5 AGE raw=${safe(() => Game.age)} type=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} turn=${safe(() => Game.turn)} cdConsole=${typeof globalThis.culturalDiffusion}`);
  const list = frontier(cities);
  emit(`S1 frontier=${list.length} cdState=${J(cdTile("none"))}`);
  const used = new Set();

  const seed = take(list, used);
  if (seed) seededKey = seedStock(seed); else emit("R1 skipped: no frontier tile");

  // Buy tiles for R2-R4 now, then let the async writes land before using them.
  const main = cities[0];
  const mainTiles = list.filter((t) => t.city === main);
  const buys = [];
  for (let i = 0; i < 3; i++) { const t = take(list, used); if (t) buys.push(t); }
  const farForMain = [take(mainTiles, used), take(mainTiles, used)].filter(Boolean);
  for (const t of buys.concat(farForMain)) refundBuy(local, t.city, t.loc);
  await later(4000);
  emit(`S2 bought release=${J(buys.map((t) => ({ k: key(t.loc), ...where(t.loc) })))} far=${J(farForMain.map((t) => ({ k: key(t.loc), ring: t.d, ...where(t.loc) })))}`);
  watch = buys.concat(farForMain);

  await releaseVariants(buys);
  const expandTile = farForMain[0] || null;
  if (expandTile && owner(expandTile.loc) === local) await expandFar(expandTile); else emit("R3 skipped: no far tile of the main city");
  await createFar(main, farForMain.slice(1).filter((t) => owner(t.loc) === local));

  emit("ACTIONS done; ending turns");
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

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  const report = () => emit(`TURN n=${n} turn=${safe(() => Game.turn)} seeded=${seededKey}:${J(seededKey ? { ...where(GameplayMap.getLocationFromIndex(GameplayMap.getIndexFromLocation({ x: +seededKey.split(",")[0], y: +seededKey.split(",")[1] }))), cd: cdTile(seededKey) } : null)} `
    + `watch=${J(watch.map((t) => ({ k: key(t.loc), ...where(t.loc), types: plotTypes(t.loc) })))}`);
  setTimeout(report, 5000); // after the mod's own pass ran and its writes had time to land
  if (n > TURNS) { setTimeout(() => emit("DONE harness run2 finished"), 6000); return; }
  setTimeout(endTurn, 8000);
});

emit("attached run2");
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
