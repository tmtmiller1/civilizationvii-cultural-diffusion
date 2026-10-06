// cdh-game-war-read.js: game scope, read-only. The local player's diplomatic state with every major: at war, met,
// joint events (DECLARE_WAR headers), and any pending deal sessions. For the peace-deal screen that opened for a player
// the log says we were not at war with (cdfix-ant2, turn 152-153). (dev only)
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
function run() {
  const me = GameContext.localPlayerID;
  const P = Players.get(me);
  emit(`WARREAD turn=${safe(() => Game.turn)} me=${me}`);
  for (const p of safe(() => Players.getAlive().filter((q) => q.isMajor && q.id !== me), [])) {
    const atWar = safe(() => P.Diplomacy.isAtWarWith(p.id), "?");
    const met = safe(() => P.Diplomacy.hasMet(p.id), "?");
    const joint = safe(() => Game.Diplomacy.getJointEvents(me, p.id, false) || [], []);
    const wars = joint.filter((e) => e.actionTypeName === "DIPLOMACY_ACTION_DECLARE_WAR").map((e) => `${e.actionTypeName}#${e.uniqueID} init=${e.initialPlayer}`);
    const names = joint.map((e) => e.actionTypeName).filter(Boolean);
    const sessions = safe(() => Game.DiplomacySessions?.getSessions?.(me, p.id) || null, null);
    emit(`WAR p${p.id} ${safe(() => Locale.compose(p.name), "?")} atWar=${atWar} met=${met} jointEvents=${joint.length} wars=${js(wars)} kinds=${js([...new Set(names)])} sessions=${js(sessions)}`);
  }
  emit("DONE harness war-read finished");
}
emit("attached war-read");
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { setTimeout(() => { try { run(); } catch (e) { emit("run threw " + e); } }, 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
