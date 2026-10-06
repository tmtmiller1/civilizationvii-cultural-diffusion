// cdh-game-district-flip.js (from cdh-game-district-scan.js): game scope. Which plots carry a district id that no longer resolves? (dev only)
//
// bz-map-trix's religion layer (bz-religion-layer.js:50) throws "Cannot read properties of null (reading 'cityId')"
// when MapCities.getDistrict(x, y) returns an id and Districts.get(id) returns null. It rescans the whole map on every
// religion change and stops at the first such plot, so each conversion throws once (213 times in amsoak-exp1, where
// AutoMissionary converted cities all game). This scans every plot for that state, at load and after a few turns, with
// nothing else acting (run with NO_MOD=1), to learn whether those plots come from a save's history or from play.

const TURNS = 3;
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
let local = -1;

function scan(label) {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  let withId = 0, dangling = 0, noCity = 0;
  const ex = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = safe(() => MapCities.getDistrict(x, y), null);
    if (!id) continue;
    withId++;
    const d = safe(() => Districts.get(id), null);
    if (!d) {
      dangling++;
      if (ex.length < 15) {
        ex.push(`${x},${y} idx=${y * w + x} owner=${safe(() => GameplayMap.getOwner(x, y))} id=${safe(() => ComponentID.toLogString(id), js(id))} atLoc=${safe(() => Districts.getAtLocation({ x, y })?.type ?? "null")} city=${safe(() => MapCities.getCity(x, y) ? ComponentID.toLogString(MapCities.getCity(x, y)) : "none")} revealed=${safe(() => GameplayMap.getRevealedState(GameContext.localObserverID, x, y))}`);
      }
    } else if (!d.cityId) noCity++;
  }
  emit(`SCAN ${label}: grid=${w}x${h} plotsWithDistrictId=${withId} dangling=${dangling} villages(noCity)=${noCity}`);
  for (const e of ex) emit(`DANGLING ${label}: ${e}`);
}


// Flip test: move FLIPS owned tiles (with a district, or bare for the control) to an adjacent major with purchasePlot,
// then check the flipped plots themselves for a dangling district id.
const FLIP_MODE = "district";
const FLIPS = 8;
const flipped = [];
function dname(l) { return safe(() => { const d = Districts.getAtLocation(l); if (!d) return "none"; for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return k; return "t" + d.type; }, "?"); }
function flipWave() {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const majors = safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []);
  for (let y = 0; y < h && flipped.length < FLIPS; y++) for (let x = 0; x < w && flipped.length < FLIPS; x++) {
    const l = { x, y }; const a = safe(() => GameplayMap.getOwner(x, y), -1);
    if (a < 0 || !majors.includes(a) || safe(() => GameplayMap.isWater(x, y), true)) continue;
    const dn = dname(l);
    if (/CITY_CENTER|URBAN/.test(dn)) continue;
    if ((FLIP_MODE === "district") !== (dn === "RURAL")) continue;
    const nb = safe(() => GameplayMap.getPlotIndicesInRadius(x, y, 1).map((i) => GameplayMap.getLocationFromIndex(i)), []);
    if (nb.some((n) => dname(n) === "CITY_CENTER")) continue;
    const b = nb.map((n) => safe(() => GameplayMap.getOwner(n.x, n.y), -1)).find((o) => o >= 0 && o !== a && majors.includes(o));
    if (b == null) continue;
    let best = null;
    for (const c of safe(() => Players.get(b).Cities.getCities() || [], [])) { const d = GameplayMap.getPlotDistance(c.location.x, c.location.y, x, y); if (d <= 7 && (!best || d < best.d)) best = { c, d }; }
    if (!best) continue;
    const before = safe(() => ComponentID.toLogString(MapCities.getDistrict(x, y)), "none");
    safe(() => best.c.purchasePlot(l));
    flipped.push({ l, a, b, before });
  }
  emit(`FLIPS sent ${flipped.length} mode=${FLIP_MODE}`);
}
function checkFlipped(label) {
  let dang = 0, moved = 0;
  for (const f of flipped) {
    const id = safe(() => MapCities.getDistrict(f.l.x, f.l.y), null);
    const d = id ? safe(() => Districts.get(id), null) : null;
    const o = safe(() => GameplayMap.getOwner(f.l.x, f.l.y), -9);
    if (o === f.b) moved++;
    if (id && !d) dang++;
    emit(`FLIPPED ${label} ${f.l.x},${f.l.y} ${f.a}->${f.b} owner=${o} idBefore=${f.before} idNow=${id ? safe(() => ComponentID.toLogString(id), "?") : "none"} resolves=${!!d} dist=${dname(f.l)} city=${d ? safe(() => ComponentID.toLogString(d.cityId), "?") : "-"}`);
  }
  emit(`CHECK ${label}: landed=${moved}/${flipped.length} danglingOnFlipped=${dang}`);
}

let religionEvents = 0;
safe(() => engine.on("CityReligionChanged", () => religionEvents++));
safe(() => engine.on("RuralReligionChanged", () => religionEvents++));
safe(() => engine.on("UrbanReligionChanged", () => religionEvents++));

let turnsSeen = 0, lastTurn = -1, finished = false;
let lastTurnAt = Date.now(), lastSeenTurn = -1;
function endTurn() {
  if (finished) return;
  const t = safe(() => Game.turn, -1);
  if (t !== lastSeenTurn) { lastSeenTurn = t; lastTurnAt = Date.now(); }
  if (Date.now() - lastTurnAt > 45000 && typeof Autoplay !== "undefined") {
    safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
    lastTurnAt = Date.now(); emit("ENDTURN stuck: one Autoplay turn");
  } else safe(() => { if (Players.get(local).isTurnActive && !GameContext.hasSentTurnComplete()) { UI.Player.deselectAllUnits(); GameContext.sendTurnComplete(); } });
  setTimeout(endTurn, 5000);
}
function turnPoll() {
  if (finished) return;
  const t = safe(() => Game.turn, -1);
  if (t !== lastTurn && safe(() => Players.get(local).isTurnActive, false)) {
    lastTurn = t;
    const k = ++turnsSeen;
    scan(`T${k}`);
    checkFlipped(`T${k}`);
    emit(`RELIGION events so far ${religionEvents}`);
    if (k >= TURNS) { finished = true; emit(`DONE harness district-scan finished`); return; }
  }
  setTimeout(turnPoll, 2000);
}
function run() {
  local = GameContext.localPlayerID;
  lastTurn = safe(() => Game.turn, 0);
  emit(`DSCAN start turn=${lastTurn} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)}`);
  scan("T0");
  flipWave();
  setTimeout(() => { checkFlipped("4s"); scan("T0+4s"); }, 4000);
  setTimeout(() => { checkFlipped("15s"); scan("T0+15s"); turnPoll(); }, 15000);
  endTurn();
}
emit("attached district-scan");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { try { run(); } catch (e) { emit("run threw " + e); } }, 10000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
