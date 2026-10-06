// cdh-game-ant-read.js: game scope. Read-only look at an end-of-Antiquity autosave from amsoak-ant1 (dev only):
// the age reads the 1.4.1 guard used, and the district on every tile Cultural Diffusion moved on turns 158-160.
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
const TILES = ["92,40", "89,49", "90,50", "84,28", "87,25", "85,41", "92,41", "93,40", "90,48", "84,29", "86,25", "91,50", "88,24", "85,40", "93,41", "91,39", "79,34", "79,37"];
function dname(l) { return safe(() => { const d = Districts.getAtLocation(l); if (!d) return "none"; for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return k; return "t" + d.type; }, "?"); }
function run() {
  const m = safe(() => Game.AgeProgressManager, null);
  emit(`AGE turn=${safe(() => Game.turn)} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} countdown=${safe(() => m.ageCountdownStarted)} cur=${safe(() => m.getCurrentAgeProgressionPoints())} max=${safe(() => m.getMaxAgeProgressionPoints())} over=${safe(() => m.isAgeOver)}`);
  for (const k of TILES) {
    const [x, y] = k.split(",").map(Number);
    const id = safe(() => MapCities.getDistrict(x, y), null);
    emit(`TILE ${k} owner=${safe(() => GameplayMap.getOwner(x, y))} district=${dname({ x, y })} idDangling=${!!id && !safe(() => Districts.get(id), null)}`);
  }
  emit("DONE harness ant-read finished");
}
emit("attached ant-read");
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(run, 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
