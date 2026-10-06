// cdh-game-dangle-flipflip.js (from heal2): heal every dangling district id by flipping the tile to a neighbouring
// civilization (clears the half-made record), flipping it back to its owner (a bare-tile purchase), then CREATE_ELEMENT
// DISTRICT_RURAL plus the improvement the engine itself would place there (District_FreeConstructibles: resource, then
// feature, then terrain/biome/river, lowest Priority wins), then transition.
// cdh-game-dangle.js: game scope. Does moving a tile that carries a DANGLING district id (an id MapCities still
// returns, from an earlier district-tile move, that Districts.get cannot resolve) in the last Antiquity turn crash the
// age transition? (dev only, run with NO_MOD=1 on CDH-AM-Ant159, an amsoak-ant1 autosave one turn before the crash)
// MODE "dangling": move the three tiles with a dangling id. "bare": three clean bare tiles. "none": move nothing.
const MODE = "flipflip";
const SETS = { dangling: ["84,29", "91,39", "79,37"], bare: ["92,40", "88,24", "86,25"], none: [] };
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
let local = -1;
const ageType = () => safe(() => GameInfo.Ages.lookup(Game.age).AgeType, "?");
function dangling(x, y) { const id = safe(() => MapCities.getDistrict(x, y), null); return !!id && !safe(() => Districts.get(id), null); }
function buyerFor(x, y, a) {
  const majors = safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []);
  const nb = safe(() => GameplayMap.getPlotIndicesInRadius(x, y, 1).map((i) => GameplayMap.getLocationFromIndex(i)), []);
  const owners = [...new Set(nb.map((n) => safe(() => GameplayMap.getOwner(n.x, n.y), -1)))].filter((o) => o >= 0 && o !== a && majors.includes(o));
  for (const b of owners) {
    let best = null;
    for (const c of safe(() => Players.get(b).Cities.getCities() || [], [])) { const d = GameplayMap.getPlotDistance(c.location.x, c.location.y, x, y); if (d <= 7 && (!best || d < best.d)) best = { c, d, b }; }
    if (best) return best;
  }
  return null;
}

function danglingList() {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight(); const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dangling(x, y)) out.push({ x, y });
  return out;
}

// The engine's own rule for the free improvement a rural district gets (District_FreeConstructibles).
function pickImprovement(x, y) {
  const res = safe(() => { const r = GameplayMap.getResourceType(x, y); return r >= 0 ? GameInfo.Resources.lookup(r)?.ResourceType : null; }, null);
  const feat = safe(() => { const f = GameplayMap.getFeatureType(x, y); return f >= 0 ? GameInfo.Features.lookup(f)?.FeatureType : null; }, null);
  const terr = safe(() => GameInfo.Terrains.lookup(GameplayMap.getTerrainType(x, y))?.TerrainType, null);
  const biome = safe(() => GameInfo.Biomes.lookup(GameplayMap.getBiomeType(x, y))?.BiomeType, null);
  const river = safe(() => { const r = GameplayMap.getRiverType(x, y); return r === RiverTypes.RIVER_NAVIGABLE ? "RIVER_NAVIGABLE" : r === RiverTypes.RIVER_MINOR ? "RIVER_MINOR" : null; }, null);
  let best = null;
  for (const row of safe(() => GameInfo.District_FreeConstructibles, [])) {
    if (row.DistrictType !== "DISTRICT_RURAL") continue;
    if (row.ResourceType && row.ResourceType !== res) continue;
    if (row.FeatureType && row.FeatureType !== feat) continue;
    if (row.TerrainType && row.TerrainType !== terr) continue;
    if (row.BiomeType && row.BiomeType !== biome) continue;
    if (row.RiverType && row.RiverType !== river) continue;
    if (!row.ResourceType && !row.FeatureType && !row.TerrainType && !row.BiomeType && !row.RiverType) continue;
    if (!best || row.Priority < best.Priority) best = row;
  }
  const def = best && safe(() => GameInfo.Constructibles.lookup(best.ConstructibleType), null);
  return def ? { type: def.ConstructibleType, index: def.$index, why: `${res || feat || terr || "?"} p${best.Priority}` } : null;
}
function cityFor(pid, l, max) {
  let best = null;
  for (const c of safe(() => Players.get(pid).Cities.getCities() || [], [])) { const d = GameplayMap.getPlotDistance(c.location.x, c.location.y, l.x, l.y); if (d <= max && (!best || d < best.d)) best = { c, d }; }
  return best;
}
function neighbourBuyer(l, owner) {
  const majors = safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []);
  const nb = safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, 1).map((i) => GameplayMap.getLocationFromIndex(i)), []);
  const adj = [...new Set(nb.map((n) => safe(() => GameplayMap.getOwner(n.x, n.y), -1)))].filter((o) => o >= 0 && o !== owner && majors.includes(o));
  for (const b of adj) { const c = cityFor(b, l, 7); if (c) return { ...c, b, adj: true }; }
  for (const b of majors) { if (b === owner) continue; const c = cityFor(b, l, 7); if (c) return { ...c, b, adj: false }; }
  return null;
}
async function clearAll() {
  const list = danglingList();
  const jobs = [];
  emit(`FLIPFLIP start: dangling=${list.length}`);
  // Step 1: flip every damaged tile to a neighbouring civilization.
  for (const l of list) {
    const owner = safe(() => GameplayMap.getOwner(l.x, l.y), -1);
    const home = cityFor(owner, l, 7);
    const away = neighbourBuyer(l, owner);
    if (!home || !away) { emit(`FLIPFLIP skip ${l.x},${l.y} owner=${owner} home=${!!home} away=${!!away}`); continue; }
    safe(() => away.c.purchasePlot(l));
    jobs.push({ l, owner, home: home.c, away });
  }
  await later(6000);
  let awayOk = 0;
  for (const j of jobs) { const o = safe(() => GameplayMap.getOwner(j.l.x, j.l.y), -9); j.awayLanded = o === j.away.b; if (j.awayLanded) awayOk++; j.clearedAway = !dangling(j.l.x, j.l.y); }
  emit(`FLIPFLIP step1: sent=${jobs.length} awayLanded=${awayOk} cleared=${jobs.filter((j) => j.clearedAway).length} ${jobs.filter((j) => !j.clearedAway).map((j) => j.l.x + "," + j.l.y + (j.awayLanded ? "(landed)" : "(stayed)")).join(" ")}`);
  // Step 2: flip them back to their owner (bare tiles now).
  for (const j of jobs) if (j.awayLanded) safe(() => j.home.purchasePlot(j.l));
  await later(8000);
  let backOk = 0;
  for (const j of jobs) { const o = safe(() => GameplayMap.getOwner(j.l.x, j.l.y), -9); j.backLanded = o === j.owner; if (j.backLanded) backOk++; }
  emit(`FLIPFLIP step2: backLanded=${backOk}/${jobs.filter((j) => j.awayLanded).length} dangling=${danglingList().length}`);
  // Step 3: rebuild district + the engine-chosen improvement for the owner.
  let rebuilt = 0;
  for (const j of jobs) {
    if (!j.backLanded || dangling(j.l.x, j.l.y)) continue;
    const imp = pickImprovement(j.l.x, j.l.y);
    safe(() => Game.PlayerOperations.sendRequest(GameContext.localPlayerID, "CREATE_ELEMENT", { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: { ...j.l }, Parent: j.home.id, Owner: j.owner }));
    if (imp) safe(() => Game.PlayerOperations.sendRequest(GameContext.localPlayerID, "CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: imp.index, Location: { ...j.l }, Parent: j.home.id, Owner: j.owner }));
    rebuilt++;
  }
  await later(4000);
  const whole = jobs.filter((j) => j.backLanded && safe(() => Districts.getAtLocation(j.l), null) && safe(() => (MapConstructibles.getConstructibles(j.l.x, j.l.y) || []).length > 0, false)).length;
  const left = danglingList();
  emit(`FLIPFLIP done: rebuilt=${rebuilt} whole=${whole} dangling=${left.length} ${left.map((l) => l.x + "," + l.y + "/p" + safe(() => GameplayMap.getOwner(l.x, l.y))).join(" ")} owners=${jobs.map((j) => safe(() => GameplayMap.getOwner(j.l.x, j.l.y), "?") === j.owner ? "=" : "X").join("")}`);
  return left.length === 0;
}
async function moves() {
  for (const k of SETS[MODE]) {
    const [x, y] = k.split(",").map(Number);
    const a = safe(() => GameplayMap.getOwner(x, y), -1);
    const b = buyerFor(x, y, a);
    emit(`MOVE ${k} owner=${a} dangling=${dangling(x, y)} -> ${b ? b.b : "no buyer"}`);
    if (b) safe(() => b.c.purchasePlot({ x, y }));
  }
  await later(6000);
  for (const k of SETS[MODE]) { const [x, y] = k.split(",").map(Number); emit(`LANDED ${k} owner=${safe(() => GameplayMap.getOwner(x, y))} dangling=${dangling(x, y)}`); }
}
let lastTurn = -1, lastTurnAt = Date.now(), seenExp = 0, finished = false;
function endTurn() {
  if (finished) return;
  const t = safe(() => Game.turn, -1);
  if (t !== lastTurn) { lastTurn = t; lastTurnAt = Date.now(); emit(`TURN turn=${t} age=${ageType()}`); if (ageType() === "AGE_EXPLORATION") { seenExp++; if (seenExp >= 3) { finished = true; emit(`DONE harness dangle finished mode=${MODE}: reached Exploration turn ${t}`); return; } } }
  if (Date.now() - lastTurnAt > 45000 && typeof Autoplay !== "undefined") {
    safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
    lastTurnAt = Date.now(); emit("ENDTURN stuck: one Autoplay turn");
  } else safe(() => { if (Players.get(local).isTurnActive && !GameContext.hasSentTurnComplete()) { UI.Player.deselectAllUnits(); GameContext.sendTurnComplete(); } });
  setTimeout(endTurn, 4000);
}
async function run() {
  local = GameContext.localPlayerID;
  const m = safe(() => Game.AgeProgressManager, null);
  emit(`DANGLE start mode=${MODE} turn=${safe(() => Game.turn)} age=${ageType()} countdown=${safe(() => m.ageCountdownStarted)} cur=${safe(() => m.getCurrentAgeProgressionPoints())} max=${safe(() => m.getMaxAgeProgressionPoints())}`);
  if (ageType() === "AGE_ANTIQUITY") { const ok = await clearAll(); emit(`CLEARED all=${ok}`); }
  else emit("after transition: no moves");
  endTurn();
}
emit("attached dangle-" + MODE);
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => run().catch((e) => emit("run threw " + e)), 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
