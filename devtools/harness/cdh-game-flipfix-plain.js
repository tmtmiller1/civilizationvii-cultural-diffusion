// cdh-game-flipfix.js: game scope. Which way of moving an IMPROVED tile between civilizations survives the age
// transition? (dev only; run with NO_MOD=1 from AugustusAnt136, the mod's own flips replaced by this script's)
//
// Watched 2026-10-06: city.purchasePlot on a rival's rural-district tile destroys the district and improvement, leaves
// the plot pointing at a district the buyer never finished creating, and a save with enough of those crashes the
// Antiquity->Exploration setup (AsyncWorker1 0x308) with every mod off. Healing the tiles in place afterwards did not
// help (0x210). Moving them again did. So the fix has to be in how the flip itself is done. Each turn until the
// countdown's last 3 turns, PER_TURN improved rival tiles next to another major's land are moved, one way:
//   plain    purchasePlot only (what the shipped mod does; expected to doom the save)
//   rebuild  purchasePlot, then CREATE_ELEMENT DISTRICT_RURAL + the original improvement for the new owner
//   demolish DESTROY_ELEMENT constructibles + district (plot becomes unowned, as National Parks watched), then
//            purchasePlot of the now-unowned plot, then CREATE_ELEMENT district + original improvement
//   bare     demolish, purchasePlot, no rebuild (tile arrives empty)
// Then play into Exploration turn 3.

const VARIANT = "plain";
const PER_TURN = 4;
const STOP_BEFORE_END = 3;
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function until(fn, ms = 5000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (safe(fn, false)) return true; await later(step); } return safe(fn, false); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
let local = -1;
const ageType = () => safe(() => GameInfo.Ages.lookup(Game.age).AgeType, "?");
const owner = (x, y) => safe(() => GameplayMap.getOwner(x, y), -9);
const locOf = (i) => GameplayMap.getLocationFromIndex(i);
function dname(l) { return safe(() => { const d = Districts.getAtLocation(l); if (!d) return "none"; for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return k; return "t" + d.type; }, "?"); }
function dangling(x, y) { const id = safe(() => MapCities.getDistrict(x, y), null); return !!id && !safe(() => Districts.get(id), null); }
function consAt(x, y) {
  return safe(() => (MapConstructibles.getConstructibles(x, y) || []).map((cid) => { const inst = Constructibles.getByComponentID(cid); const def = inst && GameInfo.Constructibles.lookup(inst.type); return { id: cid, type: def ? def.ConstructibleType : "?", index: def ? def.$index : -1, cls: def ? def.ConstructibleClass : "?" }; }), []);
}
function majors() { return safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []); }
function nearestCity(pid, l, max = 7) {
  let best = null;
  for (const c of safe(() => Players.get(pid).Cities.getCities() || [], [])) { const d = GameplayMap.getPlotDistance(c.location.x, c.location.y, l.x, l.y); if (d <= max && (!best || d < best.d)) best = { c, d }; }
  return best ? best.c : null;
}
const moved = new Set();
function pickTargets(n) {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight(); const ms = majors(); const out = [];
  // Scan from a rotating row so the same corner of the map is not drained every turn.
  const y0 = (safe(() => Game.turn, 0) * 7) % h;
  for (let dy = 0; dy < h && out.length < n; dy++) {
    const y = (y0 + dy) % h;
    for (let x = 0; x < w && out.length < n; x++) {
      const k = x + "," + y; if (moved.has(k)) continue;
      const a = owner(x, y); if (a < 0 || !ms.includes(a) || safe(() => GameplayMap.isWater(x, y), true)) continue;
      const l = { x, y }; if (dname(l) !== "RURAL") continue;
      const cons = consAt(x, y); if (!cons.some((c) => c.cls === "IMPROVEMENT")) continue;
      const nb = safe(() => GameplayMap.getPlotIndicesInRadius(x, y, 1).map(locOf), []);
      if (nb.some((q) => dname(q) === "CITY_CENTER")) continue;
      const b = [...new Set(nb.map((q) => owner(q.x, q.y)))].find((o) => o >= 0 && o !== a && ms.includes(o));
      if (b == null) continue;
      const city = nearestCity(b, l); if (!city) continue;
      out.push({ l, a, b, city, cons });
    }
  }
  return out;
}
const sender = () => GameContext.localPlayerID;
function destroy(t) {
  const d = safe(() => Districts.getAtLocation(t.l), null);
  for (const c of t.cons) safe(() => Game.PlayerOperations.sendRequest(sender(), "DESTROY_ELEMENT", { Kind: "CONSTRUCTIBLE", Owner: c.id.owner, LocalID: c.id.id }));
  if (d) safe(() => Game.PlayerOperations.sendRequest(sender(), "DESTROY_ELEMENT", { Kind: "DISTRICT", Owner: d.id.owner, LocalID: d.id.id }));
}
function rebuild(t) {
  const imp = t.cons.find((c) => c.cls === "IMPROVEMENT");
  safe(() => Game.PlayerOperations.sendRequest(sender(), "CREATE_ELEMENT", { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: { ...t.l }, Parent: t.city.id, Owner: t.b }));
  if (imp) safe(() => Game.PlayerOperations.sendRequest(sender(), "CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: imp.index, Location: { ...t.l }, Parent: t.city.id, Owner: t.b }));
}
const tally = { moves: 0, landed: 0, dangling: 0, withDistrict: 0, withImprovement: 0, unownedAfterDestroy: 0 };
async function moveOne(t, label) {
  const k = t.l.x + "," + t.l.y; moved.add(k); tally.moves++;
  const before = t.cons.map((c) => c.type.replace("IMPROVEMENT_", "")).join("+");
  let note = "";
  if (VARIANT === "demolish" || VARIANT === "bare") {
    destroy(t);
    const un = await until(() => owner(t.l.x, t.l.y) === -1, 6000);
    if (un) tally.unownedAfterDestroy++;
    note += ` unowned=${un}`;
  }
  safe(() => t.city.purchasePlot(t.l));
  const landed = await until(() => owner(t.l.x, t.l.y) === t.b, 6000);
  if (landed) tally.landed++;
  if (landed && (VARIANT === "rebuild" || VARIANT === "demolish")) { rebuild(t); await later(1500); }
  const dg = dangling(t.l.x, t.l.y); if (dg) tally.dangling++;
  const dn = dname(t.l); if (dn === "RURAL") tally.withDistrict++;
  const after = consAt(t.l.x, t.l.y); if (after.some((c) => c.cls === "IMPROVEMENT")) tally.withImprovement++;
  emit(`MOVE ${label} ${k} ${t.a}->${t.b} via ${t.city.location.x},${t.city.location.y} landed=${landed}${note} before=${before} after=${after.map((c) => c.type.replace("IMPROVEMENT_", "")).join("+") || "-"} district=${dn} dangling=${dg}`);
}
function ageLeft() { const m = safe(() => Game.AgeProgressManager, null); return safe(() => m.getMaxAgeProgressionPoints() - m.getCurrentAgeProgressionPoints(), 99); }
let lastTurn = -1, lastTurnAt = Date.now(), busy = false, finished = false, expTurns = 0, turnsSeen = 0;
async function onTurn(t) {
  busy = true; turnsSeen++;
  const age = ageType();
  emit(`TURN k=${turnsSeen} turn=${t} age=${age} left=${ageLeft()} tally=${js(tally)}`);
  if (age === "AGE_EXPLORATION") { expTurns++; if (expTurns >= 3) { finished = true; emit(`DONE harness flipfix finished variant=${VARIANT} tally=${js(tally)}`); return; } }
  else if (ageLeft() > STOP_BEFORE_END) {
    const targets = pickTargets(PER_TURN);
    for (const tg of targets) await moveOne(tg, `T${t}`);
  } else emit(`HOLD turn=${t}: last ${STOP_BEFORE_END} turns, no moves`);
  busy = false;
}
function endTurn() {
  if (finished) return;
  const t = safe(() => Game.turn, -1);
  if (!busy && t !== lastTurn && safe(() => Players.get(local).isTurnActive, false)) {
    lastTurn = t; lastTurnAt = Date.now();
    onTurn(t).catch((e) => { emit("onTurn threw " + e); busy = false; });
  } else if (!busy && Date.now() - lastTurnAt > 50000 && typeof Autoplay !== "undefined") {
    safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
    lastTurnAt = Date.now(); emit("ENDTURN stuck: one Autoplay turn");
  } else if (!busy) safe(() => { if (Players.get(local).isTurnActive && !GameContext.hasSentTurnComplete()) { UI.Player.deselectAllUnits(); GameContext.sendTurnComplete(); } });
  setTimeout(endTurn, 3000);
}
function run() {
  local = GameContext.localPlayerID;
  emit(`FLIPFIX start variant=${VARIANT} turn=${safe(() => Game.turn)} age=${ageType()} left=${ageLeft()}`);
  endTurn();
}
emit("attached flipfix-" + VARIANT);
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { try { run(); } catch (e) { emit("run threw " + e); } }, 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
