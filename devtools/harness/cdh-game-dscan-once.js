// cdh-game-dscan-once.js: game scope. Count plots carrying a dangling district id in a save, then stop (dev only).
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function run() {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  let n = 0; const ex = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = safe(() => MapCities.getDistrict(x, y), null);
    if (id && !safe(() => Districts.get(id), null)) { n++; if (ex.length < 40) ex.push(`${x},${y}/p${safe(() => GameplayMap.getOwner(x, y))}`); }
  }
  const m = safe(() => Game.AgeProgressManager, null);
  emit(`DSCAN1 turn=${safe(() => Game.turn)} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} countdown=${safe(() => m.ageCountdownStarted)} cur=${safe(() => m.getCurrentAgeProgressionPoints())} max=${safe(() => m.getMaxAgeProgressionPoints())} dangling=${n} ${ex.join(" ")}`);
  emit("DONE harness dscan-once finished");
}
emit("attached dscan-once");
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { setTimeout(run, 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
