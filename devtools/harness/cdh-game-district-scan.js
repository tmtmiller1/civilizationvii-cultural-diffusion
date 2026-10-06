// cdh-game-district-scan.js: game scope. Which plots carry a district id that no longer resolves? (dev only)
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

let religionEvents = 0;
safe(() => engine.on("CityReligionChanged", () => religionEvents++));
safe(() => engine.on("RuralReligionChanged", () => religionEvents++));
safe(() => engine.on("UrbanReligionChanged", () => religionEvents++));

let turnsSeen = 0, lastTurn = -1, finished = false;
function endTurn() {
  if (finished) return;
  safe(() => { if (Players.get(local).isTurnActive && !GameContext.hasSentTurnComplete()) { UI.Player.deselectAllUnits(); GameContext.sendTurnComplete(); } });
  setTimeout(endTurn, 5000);
}
function turnPoll() {
  if (finished) return;
  const t = safe(() => Game.turn, -1);
  if (t !== lastTurn && safe(() => Players.get(local).isTurnActive, false)) {
    lastTurn = t;
    const k = ++turnsSeen;
    scan(`T${k}`);
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
  turnPoll();
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
