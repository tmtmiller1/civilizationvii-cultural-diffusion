// cdh-game-district-repair.js (from cdh-game-district-flip.js): flip rural tiles, then try to replace the dangling
// district id with CREATE_ELEMENT. R1 = DISTRICT_RURAL then the original improvement; R2 = the improvement only.: game scope. Which plots carry a district id that no longer resolves? (dev only)
//
// bz-map-trix's religion layer (bz-religion-layer.js:50) throws "Cannot read properties of null (reading 'cityId')"
// when MapCities.getDistrict(x, y) returns an id and Districts.get(id) returns null. It rescans the whole map on every
// religion change and stops at the first such plot, so each conversion throws once (213 times in amsoak-exp1, where
// AutoMissionary converted cities all game). This scans every plot for that state, at load and after a few turns, with
// nothing else acting (run with NO_MOD=1), to learn whether those plots come from a save's history or from play.

const TURNS = 2;
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

function cons(l) {
  return safe(() => (MapConstructibles.getConstructibles(l.x, l.y) || []).map((c) => { const i = Constructibles.getByComponentID(c); const d = i && GameInfo.Constructibles.lookup(i.type); return d ? d.ConstructibleType : "?"; }), []);
}
function improvementIndex(names) {
  for (const n of names) { const d = safe(() => GameInfo.Constructibles.lookup(n), null); if (d && d.ConstructibleClass === "IMPROVEMENT") return d.$index; }
  return null;
}
function ownerCity(l, owner) {
  let best = null;
  for (const c of safe(() => Players.get(owner).Cities.getCities() || [], [])) { const d = GameplayMap.getPlotDistance(c.location.x, c.location.y, l.x, l.y); if (!best || d < best.d) best = { c, d }; }
  return best ? best.c : null;
}
function repair(label) {
  let i = 0;
  for (const f of flipped) {
    const id = safe(() => MapCities.getDistrict(f.l.x, f.l.y), null);
    if (!(id && !safe(() => Districts.get(id), null))) continue;
    const owner = safe(() => GameplayMap.getOwner(f.l.x, f.l.y), -1);
    const city = ownerCity(f.l, owner);
    const imp = improvementIndex(f.before);
    const method = (i++ % 2 === 0) ? "R1" : "R2";
    f.method = method;
    const send = (args) => safe(() => Game.PlayerOperations.sendRequest(GameContext.localPlayerID, "CREATE_ELEMENT", args), "threw");
    let r1 = "-", r2 = "-";
    if (method === "R1") r1 = send({ Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: { ...f.l }, Parent: city.id, Owner: owner });
    if (imp != null) r2 = send({ Kind: "CONSTRUCTIBLE", Type: imp, Location: { ...f.l }, Parent: city.id, Owner: owner });
    emit(`REPAIR ${label} ${f.l.x},${f.l.y} ${method} owner=${owner} city=${city ? city.location.x + "," + city.location.y : "none"} imp=${imp} r1=${r1} r2=${r2}`);
  }
}
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
    const before = cons(l);
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
    emit(`FLIPPED ${label} ${f.l.x},${f.l.y} ${f.method || ""} ${f.a}->${f.b} owner=${o} consBefore=${f.before.join("+")} consNow=${cons(f.l).join("+")} resolves=${!!d} dist=${dname(f.l)} `);
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
  setTimeout(() => { checkFlipped("5s"); repair("5s"); }, 5000);
  setTimeout(() => { checkFlipped("12s"); scan("T0+12s"); }, 12000);
  setTimeout(() => { checkFlipped("20s"); turnPoll(); }, 20000);
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
