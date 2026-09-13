// cdh-shell.js - shell scope. Auto-loads TARGET_SAVE from the main menu so the harness runs hands-free.
// Pattern proven by the Emigration engine probe (tower_mods/emigration/devtools/engine-probe/eep-shell.js).
import SaveLoadData from "/core/ui/save-load/model-save-load.js";

const TARGET_SAVE = "AugustusAnt136.Civ7Save";
const QUERY_DONE = "model-save-load-query-complete";
function emit(m) { try { console.error("[CDH] shell " + m); } catch (_) { /* ignore */ } }
let fired = false;

function tryLoad() {
  if (fired) return;
  try {
    const save = (SaveLoadData.saves || []).find((s) => s && s.fileName === TARGET_SAVE);
    if (!save) { emit("save list has " + (SaveLoadData.saves || []).length + " entries; " + TARGET_SAVE + " not found yet"); return; }
    emit("found " + save.fileName + " turn " + save.currentTurn + " age " + save.hostAge
      + " missingMods=" + save.missingMods.length + " unowned=" + save.unownedMods.length);
    if (save.missingMods.length || save.unownedMods.length) {
      emit("cannot load: mods missing/unowned " + JSON.stringify(save.missingMods)); fired = true; return;
    }
    fired = true;
    try { Configuration.editGame()?.reset(GameModeTypes.SINGLEPLAYER); } catch (e) { emit("reset threw " + e); }
    const ok = SaveLoadData.handleLoadSave(save, ServerType.SERVER_TYPE_NONE);
    emit("handleLoadSave returned " + ok);
  } catch (e) { emit("tryLoad threw " + e); }
}

function query() {
  try {
    const options = SaveLocationCategories.AUTOSAVE | SaveLocationCategories.NORMAL | SaveLocationCategories.QUICKSAVE
      | SaveLocationOptions.LOAD_METADATA;
    SaveLoadData.querySaveGameList(SaveLocations.LOCAL_STORAGE, SaveTypes.SINGLE_PLAYER, options, SaveFileTypes.GAME_STATE);
    emit("queried save list");
  } catch (e) { emit("query threw " + e); }
}

emit("attached");
try { window.addEventListener(QUERY_DONE, () => { emit("query complete"); setTimeout(tryLoad, 500); }); } catch (e) { emit("listener failed " + e); }
setTimeout(query, 15000);
setTimeout(() => { if (!fired) { emit("retrying query"); query(); } }, 45000);
