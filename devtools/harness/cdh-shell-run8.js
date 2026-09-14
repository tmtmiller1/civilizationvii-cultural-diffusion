// cdh-shell-run8.js - shell scope, deployed as ui/cdh-shell.js for run 8. Starts a genuinely NEW single-player game the
// way the main menu's "Play Now" does: reset the game configuration to single player, then engine.call("startGame").
// (The first stand-in, the turn-1 save AugustusAnt1, cannot load: it requires an uninstalled dev mod.) If the game is
// still in the shell 90s later, fall back to the earliest early-Antiquity save that has no missing or unowned mods.
import SaveLoadData from "/core/ui/save-load/model-save-load.js";

const CANDIDATES = [
  "AchaemenidAnt1", "AugustusAnt11", "AminaAnt11", "AchaemenidAnt14", "AugustusAnt14", "AchaemenidAnt15",
  "AugustusAnt18", "AchaemenidAnt19", "AugustusAnt19", "AugustusAnt21", "AugustusAnt23"
];
const QUERY_DONE = "model-save-load-query-complete";
function emit(m) { try { console.error("[CDH] shell " + m); } catch (_) { /* ignore */ } }
let fired = false;
let fallbackArmed = false;

function baseName(s) { return String(s && s.fileName).replace(/\.Civ7Save$/, ""); }

function tryLoad() {
  if (fired || !fallbackArmed) return;
  try {
    const saves = SaveLoadData.saves || [];
    for (const name of CANDIDATES) {
      const save = saves.find((s) => baseName(s) === name);
      if (!save) continue;
      if (save.missingMods.length || save.unownedMods.length) {
        emit(`skip ${name}: missing=${JSON.stringify(save.missingMods)} unowned=${save.unownedMods.length}`);
        continue;
      }
      fired = true;
      emit(`fallback loading ${save.fileName} turn ${save.currentTurn}`);
      try { Configuration.editGame()?.reset(GameModeTypes.SINGLEPLAYER); } catch (e) { emit("reset threw " + e); }
      emit("handleLoadSave returned " + SaveLoadData.handleLoadSave(save, ServerType.SERVER_TYPE_NONE));
      return;
    }
    emit("no loadable candidate save found");
  } catch (e) { emit("tryLoad threw " + e); }
}

function query() {
  try {
    const options = SaveLocationCategories.NORMAL | SaveLocationOptions.LOAD_METADATA;
    SaveLoadData.querySaveGameList(SaveLocations.LOCAL_STORAGE, SaveTypes.SINGLE_PLAYER, options, SaveFileTypes.GAME_STATE);
    emit("queried save list");
  } catch (e) { emit("query threw " + e); }
}

emit("attached run8b");
try { window.addEventListener(QUERY_DONE, () => setTimeout(tryLoad, 500)); } catch (e) { emit("listener failed " + e); }
setTimeout(() => {
  try { Configuration.editGame()?.reset(GameModeTypes.SINGLEPLAYER); emit("config reset to single player"); } catch (e) { emit("reset threw " + e); }
  try { engine.call("startGame"); emit("startGame called (Play Now)"); } catch (e) { emit("startGame threw " + e); }
  setTimeout(() => { emit("still in the shell 90s after startGame; falling back to an early save"); fallbackArmed = true; query(); }, 90000);
}, 12000);
