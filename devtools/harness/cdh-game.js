// cdh-game.js - game scope. Cultural Diffusion hands-free harness (dev only, never shipped).
// Loaded into the save by cdh-shell.js. Presses Begin Game itself, then, in the first local turn:
//   T1 FLIP     our city's purchasePlot on an unowned tile beyond ring 3 (owner read inline AND after 3s -
//               cd-pass.js books a flip on the INLINE read, so an async-only write would silently book nothing)
//   T2 RIVAL    our purchasePlot on a rival tile touching our land, then CEDE it back via the rival's own city
//   T3 RELEASE  setOwnership(NO_PLAYER) on a second tile we just bought (the recede release verb)
//   T4 SETTLE   a spawned settler's FOUND_CITY check: unowned plot vs neighbouring rival-owned plot vs our own
//               far claimed plot (does owned territory block founding?)
//   T5 DEVELOP  CREATE_ELEMENT improvement on our far claimed tile and on a ring<=3 control: does the city gain
//               population / yields, and does the engine offer the far tile to a worker?
// then ends TURNS turns (1-turn Autoplay only when a blocker persists) so the mod's own debug pass logs each turn.
// Self-contained on purpose: no imports from /cultural-diffusion, so a mod load failure cannot kill the harness.
// Every line is tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
const TURNS = 12;
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
const NO_PLAYER = safe(() => (PlayerIds.NO_PLAYER != null ? PlayerIds.NO_PLAYER : -1), -1);
const NO_RESOURCE = safe(() => (ResourceTypes.NO_RESOURCE != null ? ResourceTypes.NO_RESOURCE : -1), -1);
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
function release(l) { return safe(() => { WorldBuilder.MapPlots.setOwnership(NO_PLAYER, l); return "called"; }, "throw"); }
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function allCities() {
  const out = [];
  for (const p of safe(() => Players.getAlive(), []) || []) for (const c of safe(() => p.Cities.getCities(), []) || []) out.push(c);
  return out;
}
function majorIds() { return safe(() => Players.getAlive().filter((p) => p.id !== local && p.isMajor).map((p) => p.id), []); }
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
function noResource(l) { return safe(() => GameplayMap.getResourceType(l.x, l.y) === NO_RESOURCE, false); }
function snap(c) {
  if (!c) return null;
  const net = {};
  for (const y of YIELDS) net[y.slice(6)] = safe(() => Math.round(c.Yields.getNetYield(YieldTypes[y]) * 10) / 10, null);
  return { pop: safe(() => c.population, null), rural: safe(() => c.ruralPopulation, null), urban: safe(() => c.urbanPopulation, null),
    pending: safe(() => c.pendingPopulation, null), plots: safe(() => c.getPurchasedPlots().length, null), net };
}

// --- improvement choice: the rural district's own terrain table, resource > river > feature > terrain -------
let FREE = null;
function freeRows() {
  if (!FREE) {
    FREE = safe(() => Database.query("gameplay",
      "SELECT ConstructibleType, ResourceType, FeatureType, TerrainType, RiverType, BiomeType, Priority FROM District_FreeConstructibles "
      + "WHERE DistrictType='DISTRICT_RURAL' ORDER BY Priority ASC") || [], []);
  }
  return FREE;
}
function typeName(table, col, id) { return safe(() => { const r = GameInfo[table].lookup(id); return r ? r[col] : null; }, null); }
function improvementFor(l) {
  const res = typeName("Resources", "ResourceType", safe(() => GameplayMap.getResourceType(l.x, l.y), -1));
  const feat = typeName("Features", "FeatureType", safe(() => GameplayMap.getFeatureType(l.x, l.y), -1));
  const ter = typeName("Terrains", "TerrainType", safe(() => GameplayMap.getTerrainType(l.x, l.y), -1));
  const bio = typeName("Biomes", "BiomeType", safe(() => GameplayMap.getBiomeType(l.x, l.y), -1));
  const nav = safe(() => !!GameplayMap.isNavigableRiver(l.x, l.y), false);
  const ok = (r) => (!r.ResourceType || r.ResourceType === res) && (!r.FeatureType || r.FeatureType === feat)
    && (!r.TerrainType || r.TerrainType === ter) && (!r.BiomeType || r.BiomeType === bio)
    && (!r.RiverType || (r.RiverType === "RIVER_NAVIGABLE" && nav));
  const rows = (freeRows() || []).filter((r) => !/EMIG|HAWAII|INCA|EXPEDITION/.test(r.ConstructibleType) && ok(r));
  return { res, feat, ter, bio, nav, pick: rows.length ? rows[0].ConstructibleType : null, rows: (freeRows() || []).length };
}

// --- candidates ---------------------------------------------------------------------------------------------
function unownedFrontier(cities, all) {
  const seen = new Set(); const out = [];
  for (const c of cities) {
    for (const l of inRadius(c.location, 6)) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      if (owner(l) !== -1 || !landClean(l)) continue;
      if (cities.some((cc) => dist(cc.location, l) <= 3)) continue;
      const n = nearest(l, cities); const any = nearest(l, all);
      out.push({ loc: l, touchesMe: touches(l, local), settleDist: any ? any.d : 99, noRes: noResource(l), city: n.city, d: n.d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
function rivalFrontier(cities, all, majors) {
  const seen = new Set(); const out = [];
  for (const c of cities) {
    for (const l of inRadius(c.location, 6)) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      const o = owner(l);
      if (majors.indexOf(o) < 0 || !landClean(l) || !touches(l, local)) continue;
      if (all.some((cc) => cc.location.x === l.x && cc.location.y === l.y)) continue;
      const n = nearest(l, cities);
      out.push({ loc: l, owner: o, city: n.city, d: n.d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

// --- tests --------------------------------------------------------------------------------------------------
async function flipTest(label, l, pid, city) {
  const before = { owner: owner(l), city: owningCity(l) };
  const buy = refundBuy(pid, city, l);
  const inline = { owner: owner(l), city: owningCity(l) };
  await later(3000);
  const after = { owner: owner(l), city: owningCity(l) };
  let verdict = "FAILS";
  if (after.owner === pid && after.city >= 0) verdict = inline.owner === pid ? "WORKS-INLINE" : "WORKS-DEFERRED-ONLY";
  else if (after.owner === pid) verdict = "OWNER-ONLY-ORPHAN";
  emit(`${label} loc=${key(l)} pid=${pid} city=${cityName(city)} before=${J(before)} call=${buy.call} goldSpent=${buy.spent} `
    + `inline=${J(inline)} after=${J(after)} => ${verdict}`);
  return verdict;
}

async function releaseTest(l) {
  const before = { owner: owner(l), city: owningCity(l) };
  const call = release(l);
  const inline = { owner: owner(l), city: owningCity(l) };
  await later(3000);
  const after = { owner: owner(l), city: owningCity(l) };
  let verdict = "FAILS";
  if (after.owner < 0) verdict = inline.owner < 0 ? "WORKS-INLINE" : "WORKS-DEFERRED-ONLY";
  emit(`T3 RELEASE loc=${key(l)} before=${J(before)} call=${call} inline=${J(inline)} after=${J(after)} => ${verdict}`);
}

async function settlerCheck(label, l, settlerOwner) {
  const r = send("CREATE_ELEMENT", { Kind: "UNIT", Type: "UNIT_SETTLER", Location: l, Owner: settlerOwner, IndependentIndex: -1 });
  await later(3000);
  const units = safe(() => MapUnits.getUnits(l.x, l.y) || [], []);
  const u = (units || []).find((x) => x && x.owner === settlerOwner);
  if (!u) { emit(`T4 ${label} settler spawn FAILED send=${J(r)} unitsNow=${J(units)}`); return null; }
  const a = safe(() => Game.UnitOperations.canStart(u, "UNITOPERATION_FOUND_CITY", {}, false), null);
  const b = safe(() => Game.UnitOperations.canStart(u, "UNITOPERATION_FOUND_CITY", { X: l.x, Y: l.y }, false), null);
  const out = { label, loc: key(l), plotOwner: owner(l), plotCity: owningCity(l), settlerOwner,
    canFound: !!(a && a.Success), canFoundXY: !!(b && b.Success),
    reasons: safe(() => a.FailureReasons, null), reasonsXY: safe(() => b.FailureReasons, null) };
  emit("T4 " + J(out));
  send("DESTROY_ELEMENT", { Kind: "UNIT", Owner: u.owner, LocalID: u.id });
  await later(1500);
  return out;
}

async function developTest(label, l) {
  const cid = safe(() => GameplayMap.getOwningCityFromXY(l.x, l.y), null);
  const city = safe(() => Cities.get(cid), null);
  if (!city) { emit(`${label} loc=${key(l)} no owning city (owner=${owner(l)} city=${owningCity(l)})`); return null; }
  const idx = safe(() => GameplayMap.getIndexFromLocation(l), -1);
  const reads = {
    ring: dist(city.location, l),
    assignWorker: safe(() => {
      const r = Game.PlayerOperations.canStart(local, PlayerOperationTypes.ASSIGN_WORKER, { Location: idx, Amount: 1 }, false);
      return { ok: !!(r && r.Success), why: r && r.FailureReasons };
    }, null),
    expandOffers: safe(() => {
      const r = Game.CityCommands.canStart(city.id, CityCommandTypes.EXPAND, {}, false);
      return { has: ((r && r.Plots) || []).indexOf(idx) >= 0, count: ((r && r.Plots) || []).length };
    }, null),
    placementBlocked: safe(() => { const i = city.Workers.GetTilePlacementInfo(idx); return i ? i.IsBlocked : null; }, null),
    yieldsWithCity: safe(() => GameplayMap.getYieldsWithCity(l.x, l.y, city.id), null)
  };
  const pick = improvementFor(l);
  const before = snap(city);
  const typeIdx = pick.pick ? safe(() => GameInfo.Constructibles.lookup(pick.pick).$index, null) : null;
  const r = typeIdx != null
    ? send("CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: typeIdx, Location: l, Parent: city.id, Owner: city.owner })
    : "no-type";
  await later(5000);
  const after = snap(city);
  emit(`${label} loc=${key(l)} city=${cityName(city)} reads=${J(reads)} terrain=${J(pick)} create=${J(r)} `
    + `plotNow=${J(plotTypes(l))} before=${J(before)} after=${J(after)}`);
  return { city, loc: l, before, after };
}

function controlPlot(city) {
  return safe(() => {
    for (const p of city.getPurchasedPlots()) {
      const l = GameplayMap.getLocationFromIndex(p);
      const d = dist(city.location, l);
      if (d < 1 || d > 3 || plotTypes(l).length || !landClean(l)) continue;
      if (improvementFor(l).pick) return l;
    }
    return null;
  }, null);
}

function cdState() {
  return safe(() => {
    const raw = Configuration.getGame().getValue("CulturalDiffusionState_v2");
    if (!raw) return { present: false };
    const s = JSON.parse(raw); const d = s.data || s;
    return { present: true, bytes: raw.length, field: Object.keys(d.field || {}).length, claims: Object.keys(d.claims || {}).length,
      locked: Object.keys(d.locked || {}).length, monoTurn: d.monoTurn };
  }, { present: "ERR" });
}
function farOwnedCount(cities) {
  const seen = new Set(); let n = 0;
  for (const c of cities) {
    for (const l of inRadius(c.location, 7)) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      if (owner(l) === local && cities.every((cc) => dist(cc.location, l) > 3)) n++;
    }
  }
  return n;
}

let devFar = null;
async function run() {
  local = GameContext.localPlayerID;
  const cities = localCities(); const all = allCities(); const majors = majorIds();
  emit(`S0 local=${local} turn=${safe(() => Game.turn)} age=${safe(() => Game.age)} cdConsole=${typeof globalThis.culturalDiffusion} `
    + `cities=${J(cities.map((c) => ({ n: cityName(c), x: c.location.x, y: c.location.y, pop: c.population, town: c.isTown })))} `
    + `majors=${J(majors)} cdState=${J(cdState())} farOwned=${farOwnedCount(cities)} freeRows=${(freeRows() || []).length}`);

  const un = unownedFrontier(cities, all);
  const touching = un.filter((u) => u.touchesMe);
  emit(`S1 unownedBeyond3=${un.length} touchingUs=${touching.length} rivalTouchingUs=${rivalFrontier(cities, all, majors).length}`);

  // T1 flip onto unowned land beyond ring 3.
  const U = touching[0] || null;
  if (U) await flipTest("T1 FLIP-UNOWNED", U.loc, local, U.city); else emit("T1 skipped: no unowned beyond-ring-3 tile touching our land");

  // T2 take a rival frontier tile, then cede it back through the rival's own nearest city.
  const R = rivalFrontier(cities, all, majors)[0] || null;
  if (R) {
    const takeV = await flipTest("T2 TAKE-RIVAL", R.loc, local, R.city);
    const rivalCities = safe(() => Players.get(R.owner).Cities.getCities() || [], []);
    const rn = nearest(R.loc, rivalCities);
    if (takeV.startsWith("WORKS") && rn) await flipTest(`T2 CEDE-BACK(d=${rn.d})`, R.loc, R.owner, rn.city);
    else emit(`T2 cede skipped: take=${takeV} rivalCity=${!!rn}`);
  } else emit("T2 skipped: no rival tile touching our land within 6 of our cities");

  // T3 release a second tile we buy.
  const U3 = touching.find((u) => U && key(u.loc) !== key(U.loc));
  if (U3) {
    const v = await flipTest("T3 BUY-FOR-RELEASE", U3.loc, local, U3.city);
    if (v.startsWith("WORKS")) await releaseTest(U3.loc); else emit("T3 release skipped: buy " + v);
  } else emit("T3 skipped: no second tile");

  // T4 settle denial: unowned control vs a neighbouring rival-owned plot, plus our own far claimed plot (U).
  const spots = un.filter((u) => u.settleDist >= 4 && u.noRes && (!U || key(u.loc) !== key(U.loc)) && (!U3 || key(u.loc) !== key(U3.loc)));
  let P0 = null; let P1 = null;
  for (const a of spots) {
    const b = spots.find((s) => s !== a && dist(s.loc, a.loc) === 1);
    if (b) { P0 = a; P1 = b; break; }
  }
  if (P0 && P1 && majors.length) {
    let rival = majors[0]; let rc = null;
    for (const m of majors) {
      const n = nearest(P1.loc, safe(() => Players.get(m).Cities.getCities() || [], []));
      if (n && (!rc || n.d < rc.d)) { rc = n; rival = m; }
    }
    const buy = rc ? refundBuy(rival, rc.city, P1.loc) : { call: "no-rival-city", spent: 0 };
    await later(3000);
    if (owner(P1.loc) !== rival) { emit(`T4 rival purchasePlot did not take (${J(buy)}); forcing owner via setOwnership`); safe(() => WorldBuilder.MapPlots.setOwnership(rival, P1.loc)); await later(2000); }
    emit(`T4 SETUP P0=${key(P0.loc)} owner=${owner(P0.loc)} P1=${key(P1.loc)} owner=${owner(P1.loc)} city=${owningCity(P1.loc)} rival=${rival} settleDist=${P0.settleDist}/${P1.settleDist}`);
    const c0 = await settlerCheck("P0-unowned-control", P0.loc, local);
    const c1 = await settlerCheck("P1-rival-owned", P1.loc, local);
    let verdict = "INCONCLUSIVE";
    if (c0 && c1) {
      const f0 = c0.canFound || c0.canFoundXY; const f1 = c1.canFound || c1.canFoundXY;
      if (f0 && !f1) verdict = "OWNERSHIP-BLOCKS-FOUNDING";
      else if (f0 && f1) verdict = "OWNERSHIP-DOES-NOT-BLOCK";
      else verdict = "CONTROL-FAILED(no founding on either)";
    }
    emit("T4 VERDICT " + verdict);
  } else emit(`T4 skipped: settle spots=${spots.length} pair=${!!(P0 && P1)} majors=${majors.length}`);
  if (U && owner(U.loc) === local) {
    await settlerCheck("P2-our-far-claim(rival settler)", U.loc, majors[0] != null ? majors[0] : local);
  }

  // T5 development of the far claimed tile, then a ring<=3 control on the same city.
  if (U && owner(U.loc) === local) {
    devFar = await developTest("T5 DEVELOP-FAR", U.loc);
    const cp = devFar ? controlPlot(devFar.city) : null;
    if (cp) await developTest("T5 DEVELOP-CONTROL(ring<=3)", cp); else emit("T5 control skipped: no empty ring<=3 plot with a rural pick");
  } else emit("T5 skipped: no far tile of ours");

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
  const cities = localCities();
  const far = devFar ? { plot: plotTypes(devFar.loc), owner: owner(devFar.loc), city: snap(devFar.city) } : null;
  emit(`TURN n=${n} turn=${safe(() => Game.turn)} cdState=${J(cdState())} farOwned=${farOwnedCount(cities)} devFar=${J(far)}`);
  if (n > TURNS) { emit("DONE harness finished"); return; }
  setTimeout(endTurn, 3000);
});

emit("attached");
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
