// cdh-game-dangle-clear.js (from cdh-game-dangle.js): clear every dangling district id first, then transition.
// cdh-game-dangle.js: game scope. Does moving a tile that carries a DANGLING district id (an id MapCities still
// returns, from an earlier district-tile move, that Districts.get cannot resolve) in the last Antiquity turn crash the
// age transition? (dev only, run with NO_MOD=1 on CDH-AM-Ant159, an amsoak-ant1 autosave one turn before the crash)
// MODE "dangling": move the three tiles with a dangling id. "bare": three clean bare tiles. "none": move nothing.
const MODE = "clear";
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
async function clearAll() {
  for (let round = 1; round <= 4; round++) {
    const list = danglingList();
    emit(`CLEAR round ${round}: dangling=${list.length}`);
    if (!list.length) return true;
    for (const l of list) {
      const a = safe(() => GameplayMap.getOwner(l.x, l.y), -1);
      const b = buyerFor(l.x, l.y, a);
      if (b) safe(() => b.c.purchasePlot(l)); else emit(`CLEAR no buyer for ${l.x},${l.y} owner=${a}`);
    }
    await later(6000);
  }
  const left = danglingList();
  emit(`CLEAR done: dangling=${left.length} ${left.map((l) => l.x + "," + l.y).join(" ")}`);
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
