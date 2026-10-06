// cdh-game-landclaim.js: game scope. Can a script use the engine's own plot-transfer verb, PlayerOperationTypes.LAND_CLAIM
// (the Diplomacy "Land Claim" action the Legatus charge unlocks), on a rival's improved tile and on a damaged one? (dev
// only; NO_MOD=1). Reads canStart's verdict, sends anyway, and reads what landed: owner, district, improvement, pointer.
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
let local = -1;
const owner = (x, y) => safe(() => GameplayMap.getOwner(x, y), -9);
function dname(l) { return safe(() => { const d = Districts.getAtLocation(l); if (!d) return "none"; for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return k; return "t" + d.type; }, "?"); }
function dangling(x, y) { const id = safe(() => MapCities.getDistrict(x, y), null); return !!id && !safe(() => Districts.get(id), null); }
function cons(x, y) { return safe(() => (MapConstructibles.getConstructibles(x, y) || []).map((c) => GameInfo.Constructibles.lookup(Constructibles.getByComponentID(c).type).ConstructibleType.replace("IMPROVEMENT_", "")).join("+"), "?"); }
function state(x, y) { return `owner=${owner(x, y)} district=${dname({ x, y })} cons=${cons(x, y) || "-"} dangling=${dangling(x, y)}`; }
function pick(pred, n) {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight(); const out = [];
  const majors = safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []);
  for (let y = 0; y < h && out.length < n; y++) for (let x = 0; x < w && out.length < n; x++) {
    const a = owner(x, y); if (a < 0 || a === local || !majors.includes(a) || safe(() => GameplayMap.isWater(x, y), true)) continue;
    const nb = safe(() => GameplayMap.getPlotIndicesInRadius(x, y, 1).map((i) => GameplayMap.getLocationFromIndex(i)), []);
    if (!nb.some((q) => owner(q.x, q.y) === local)) continue; // next to our land
    if (nb.some((q) => dname(q) === "CITY_CENTER")) continue;
    if (pred(x, y)) out.push({ x, y, a });
  }
  return out;
}
async function run() {
  local = GameContext.localPlayerID;
  const def = safe(() => GameInfo.DiplomacyActions.lookup("DIPLOMACY_ACTION_LAND_CLAIM"), null);
  emit(`LANDCLAIM def=${def ? def.$index + " " + def.DiplomacyActionType : "MISSING"} enum=${safe(() => PlayerOperationTypes.LAND_CLAIM, "?")} turn=${safe(() => Game.turn)} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)}`);
  const charges = safe(() => { const P = Players.get(local); return ["getChargedAbilityCharges", "getNumCharges"].map((f) => f + "=" + (typeof P[f] === "function" ? js(P[f]("CHARGED_ABILITY_LAND_CLAIM")) : typeof P[f])).join(" "); }, "?");
  emit(`LANDCLAIM player charges: ${charges} keys(Players.get(me)) sample=${js(safe(() => Object.getOwnPropertyNames(Object.getPrototypeOf(Players.get(local))).filter((k) => /charge|claim|land/i.test(k)), []))}`);
  const improved = pick((x, y) => dname({ x, y }) === "RURAL" && cons(x, y), 3);
  const bare = pick((x, y) => dname({ x, y }) === "none" && !dangling(x, y), 2);
  const damaged = pick((x, y) => dangling(x, y), 2);
  for (const t of [...improved, ...bare, ...damaged]) {
    const args = { Type: def ? def.$index : 0, X: t.x, Y: t.y };
    const can = safe(() => Game.PlayerOperations.canStart(local, PlayerOperationTypes.LAND_CLAIM, args, false), "threw");
    emit(`CLAIM ${t.x},${t.y} before: ${state(t.x, t.y)} canStart=${js(can)}`);
    safe(() => Game.PlayerOperations.sendRequest(local, PlayerOperationTypes.LAND_CLAIM, args));
  }
  await later(8000);
  for (const t of [...improved, ...bare, ...damaged]) emit(`CLAIM ${t.x},${t.y} after 8s: ${state(t.x, t.y)}`);
  // Also: can the string form or a Location arg shape work?
  if (improved[0]) {
    const t = improved[0];
    const alt = safe(() => Game.PlayerOperations.canStart(local, "LAND_CLAIM", { Type: def ? def.$index : 0, Location: { x: t.x, y: t.y } }, false), "threw");
    emit(`CLAIM alt-args canStart=${js(alt)}`);
  }
  emit("DONE harness landclaim finished");
}
emit("attached landclaim");
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { setTimeout(() => run().catch((e) => emit("run threw " + e)), 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
