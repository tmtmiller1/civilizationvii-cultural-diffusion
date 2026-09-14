// cdh-game-run6.js - game scope, deployed as ui/cdh-game.js. Run 6 (dev only).
// Question: does the SHIPPED build, whose modinfo has no AffectsSavedGames override, run inside an existing save that
// was made without it? Deploy dist/cultural-diffusion unchanged and enable it. This harness attaches to any save (its own
// modinfo sets AffectsSavedGames=0), presses Begin, and reports whether Cultural Diffusion's console object exists. The
// monitor also watches UI.log for the mod's boot line, and Modding.log lists the mods the load activated.
// Tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}

emit(`attached run6 cdConsole=${typeof globalThis.culturalDiffusion}`);
let beginTries = 0;
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    setTimeout(() => {
      const booted = typeof globalThis.culturalDiffusion === "object";
      emit(`R6 GameStarted turn=${safe(() => Game.turn)} cdConsole=${typeof globalThis.culturalDiffusion} `
        + `verdict=${booted ? "SHIPPED-BUILD-RUNS-IN-OLD-SAVE" : "SHIPPED-BUILD-NOT-LOADED-IN-OLD-SAVE"}`);
      emit("DONE run6");
    }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
