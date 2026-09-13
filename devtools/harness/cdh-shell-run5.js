// cdh-shell-run5.js - shell scope, deployed as ui/cdh-shell.js for run 5. Auto-loads AugustusAnt136 from the main
// menu. (Run 3's autosaves AutoSave_00_0160 and AutoSave_01_0001 rotated out: the game keeps only ten autosaves.
// AugustusAnt136 is also a hand-played save, so it does not resume Autoplay when loaded.) File names are matched by
// substring, since the save list may report them with or without the extension.
import SaveLoadData from "/core/ui/save-load/model-save-load.js";
import { Options } from "/core/ui/options/model-options.js";

const TARGET = "AugustusAnt136";
const QUERY_DONE = "model-save-load-query-complete";
function emit(m) { try { console.error("[CDH] shell " + m); } catch (_) { /* ignore */ } }
let fired = false;

// In-engine check of the "options disappear after closing Settings" fix, against the real OptionsModel: are the mod's
// options present after init, gone after reInitOptions (the rebuild Settings triggers), and back after the next init?
function optionsCheck(where) {
  try {
    const ids = ["cd-preset", "cd-growth-buffer", "cd-recede", "cd-debug"];
    const has = () => JSON.stringify(ids.map((id) => Options.data.has(id)));
    const before = has();
    Options.init();
    const afterInit = has();
    Options.reInitOptions();
    const afterReInit = has();
    Options.init();
    const afterRebuild = has();
    emit(`OPTIONS ${where} before=${before} afterInit=${afterInit} afterReInit=${afterReInit} afterRebuild=${afterRebuild} `
      + `reinitCallbacks=${Options.optionsReInitCallbacks.length} verdict=${afterRebuild === JSON.stringify(ids.map(() => true)) ? "SURVIVES-REBUILD" : "LOST-ON-REBUILD"}`);
  } catch (e) { emit("OPTIONS check threw " + e); }
}
setTimeout(() => optionsCheck("shell"), 8000);

function tryLoad() {
  if (fired) return;
  try {
    const saves = SaveLoadData.saves || [];
    const save = saves.find((s) => s && typeof s.fileName === "string" && s.fileName.indexOf(TARGET) >= 0);
    if (!save) {
      const autos = saves.filter((s) => s && /AutoSave/.test(String(s.fileName))).slice(0, 6).map((s) => s.fileName);
      emit("save list has " + saves.length + " entries; " + TARGET + " not found yet; autosaves seen " + JSON.stringify(autos));
      return;
    }
    emit("found " + save.fileName + " turn " + save.currentTurn + " age " + save.hostAge
      + " missingMods=" + save.missingMods.length + " unowned=" + save.unownedMods.length);
    if (save.missingMods.length || save.unownedMods.length) {
      emit("cannot load: mods missing/unowned " + JSON.stringify(save.missingMods)); fired = true; return;
    }
    fired = true;
    try { Configuration.editGame()?.reset(GameModeTypes.SINGLEPLAYER); } catch (e) { emit("reset threw " + e); }
    emit("handleLoadSave returned " + SaveLoadData.handleLoadSave(save, ServerType.SERVER_TYPE_NONE));
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

emit("attached run5");
try { window.addEventListener(QUERY_DONE, () => { emit("query complete"); setTimeout(tryLoad, 500); }); } catch (e) { emit("listener failed " + e); }
setTimeout(query, 15000);
setTimeout(() => { if (!fired) { emit("retrying query"); query(); } }, 45000);
