// cdh-game-atwar.js: game scope. Does Diplomacy.isAtWarWith crash for a tile-owner id the mod can pass? (dev only)
// cd-borders.js atWar(me, owner) passes GameplayMap.getOwner's id straight into isAtWarWith. Logs before every call.
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function run() {
  const me = GameContext.localPlayerID;
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const owners = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = GameplayMap.getOwner(x, y);
    if (o >= 0) owners.set(o, (owners.get(o) || 0) + 1);
  }
  const rows = [...owners.entries()].sort((a, b) => a[0] - b[0]).map(([id, n]) => {
    const p = safe(() => Players.get(id), null);
    const kind = !p ? "NULL" : p.isAlive === false ? "DEAD" : p.isMajor ? "major" : "minor";
    return { id, n, kind };
  });
  emit(`OWNERS me=${me} ${rows.map((r) => `${r.id}:${r.kind}:${r.n}`).join(" ")}`);
  const order = [...rows.filter((r) => r.kind === "major" || r.kind === "minor"), ...rows.filter((r) => r.kind === "DEAD"), ...rows.filter((r) => r.kind === "NULL")];
  const dip = Players.get(me).Diplomacy;
  for (const r of order) {
    emit(`CALL isAtWarWith(${r.id}) kind=${r.kind} ...`);
    await later(300);
    const v = safe(() => dip.isAtWarWith(r.id));
    emit(`  -> ${v}`);
    await later(300);
  }
  emit("SAFE all real owner ids returned; now the positive control isAtWarWith(99)");
  await later(500);
  emit(`CALL isAtWarWith(99) kind=${safe(() => Players.get(99), null) ? "exists" : "NULL"} ...`);
  await later(300);
  const v = safe(() => dip.isAtWarWith(99));
  emit(`  -> ${v}`);
  emit("DONE harness atwar finished");
}
emit("attached atwar");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => emit("run threw " + e)); }, 10000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
