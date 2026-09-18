// cdh-game-run12.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 12 (dev only).
// Two 1.1.0 release gates, on AugustusAnt136 via cdh-shell-run5.js. Deploy the mod with recedeBorders: true and
// debug: true.
//   R9 CEDE   run 4's untested cession: against a rival at PEACE with us, buy an unowned tile beyond ring 3 touching both
//             our land and theirs, then seed the mod's state with our claim on it and a dominant rival stock, so the
//             mod's OWN recede step cedes it (pending) and confirms it a pass later. Retried each turn until a peaceful
//             rival qualifies (player 3 is at war on turn 136 and at peace from 137, per run 7).
//   LENS      the shipped lens's pressureTiles() and the tooltip's resolve(), called directly: no painted tile may be
//             one the pass never acts on (passCanAct), an AI-led unowned tile must show no progress row, and the
//             seeded rival-led claim must be painted and show progress while recede is on.
// Ends turns one at a time. No other game actions. Tagged [CDH] in Logs/UI.log.

import { loadState } from "/cultural-diffusion/ui/cd-state.js";
import { pressureVerdict } from "/cultural-diffusion/ui/cd-field.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { civLabel } from "/cultural-diffusion/ui/cd-lens-colors.js";
import { __test as LensT } from "/cultural-diffusion/ui/cd-pressure-lens.js";
import { __test as TipT } from "/cultural-diffusion/ui/cd-pressure-tooltip.js";

const TAG = "[CDH]";
const TURNS_AFTER_SEED = 3; // seed turn + send + land + confirm
const MAX_TURNS = 12;       // AugustusAnt136 starts on turn 136; stop by 148, well before the age change at 160
const MIN_PROGRESS = 0.08;  // the lens's own cut-off (cd-pressure-lens.js)
const STATE_KEY = "CulturalDiffusionState_v2";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
function key(l) { return l.x + "," + l.y; }
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function owningCity(l) {
  return safe(() => {
    const c = GameplayMap.getOwningCityFromXY(l.x, l.y);
    const id = c && c.id;
    if (typeof id === "number") return id;
    if (id && typeof id.id === "number") return id.id;
    return -1;
  }, -9);
}
function cityIdNum(c) { return safe(() => (typeof c.id === "number" ? c.id : c.id.id), -1); }
function where(l) { return { owner: owner(l), city: owningCity(l) }; }
function inRadius(center, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(center.x, center.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function cityName(c) { return safe(() => Locale.compose(c.name), "?"); }
function gold(pid) { return safe(() => Players.get(pid).Treasury.goldBalance, null); }
function refundBuy(pid, city, l) {
  const g0 = gold(pid);
  const call = safe(() => { city.purchasePlot(l); return "called"; }, "throw");
  const g1 = gold(pid);
  const spent = (typeof g0 === "number" && typeof g1 === "number") ? Math.max(0, g0 - g1) : 0;
  if (spent > 0) safe(() => Players.get(pid).Treasury.changeGoldBalance(spent));
  return { call, spent };
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function nearest(l, cities) {
  let best = null; let bd = 1e9;
  for (const c of cities) { const d = dist(c.location, l); if (d < bd) { bd = d; best = c; } }
  return best ? { city: best, d: bd } : null;
}
function touches(l, pid) { return inRadius(l, 1).some((n) => !(n.x === l.x && n.y === l.y) && owner(n) === pid); }
function landClean(l) {
  return safe(() => {
    if (GameplayMap.isWater(l.x, l.y)) return false;
    const blocked = typeof GameplayMap.isImpassable === "function" ? GameplayMap.isImpassable(l.x, l.y) : GameplayMap.isMountain(l.x, l.y);
    if (blocked) return false;
    return GameplayMap.getRevealedState(local, l.x, l.y) > 0;
  }, false);
}
function atWar(pid) { return safe(() => !!Players.get(local).Diplomacy.isAtWarWith(pid), null); }

// --- R9: the mod's own cession against a rival at peace --------------------------------------------------------------
async function seedPeacefulCede(cities) {
  const majors = safe(() => Players.getAlive().filter((p) => p.id !== local && p.isMajor).map((p) => p.id), []);
  const peace = majors.filter((m) => atWar(m) === false);
  emit(`R9 majors=${J(majors.map((m) => ({ id: m, war: atWar(m) })))}`);
  let pick = null;
  const seen = new Set();
  for (const c of cities) {
    for (const l of inRadius(c.location, 6)) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      if (owner(l) !== -1 || !landClean(l) || !touches(l, local)) continue;
      if (cities.some((cc) => dist(cc.location, l) <= 3)) continue;
      for (const m of peace) {
        if (!touches(l, m)) continue;
        const rc = nearest(l, safe(() => Players.get(m).Cities.getCities() || [], []));
        if (!rc || rc.d > 6) continue;
        const mine = nearest(l, cities);
        if (!pick || rc.d < pick.rc.d) pick = { loc: l, rival: m, rc, mine };
      }
    }
  }
  if (!pick) { emit(`R9 skipped: no unowned beyond-ring-3 tile touching both our land and a peaceful rival (peaceful=${J(peace)})`); return null; }
  refundBuy(local, pick.mine.city, pick.loc);
  await later(4000);
  const k = key(pick.loc);
  if (owner(pick.loc) !== local) { emit(`R9 buy did not land: ${J(where(pick.loc))}`); return null; }
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  d.field[k] = { [String(local)]: 400, [String(pick.rival)]: 5000 };
  d.claims[k] = { by: local, city: owningCity(pick.loc), turn: d.monoTurn };
  delete d.locked[k];
  const w = safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); return "set"; }, "throw");
  emit(`R9 SEED ${k} rival=${pick.rival} war=${atWar(pick.rival)} rivalCity=${cityName(pick.rc.city)} d=${pick.rc.d} ourCity=${cityName(pick.mine.city)} `
    + `ourRing=${pick.mine.d} write=${w} where=${J(where(pick.loc))}`);
  return { k, loc: pick.loc, rival: pick.rival };
}


// --- LENS: the shipped lens list and readout against the pass's reach ---------------------------------------------
function hasProgressRow(plot) {
  const out = safe(() => TipT.resolve(plot), "ERR");
  if (out === "ERR" || out === null) return { rows: out === null ? 0 : -1, progress: false };
  return { rows: out.rows.length, progress: out.rows.some((r) => typeof r.value === "string" && /%$/.test(r.value)) };
}
function lensCheck(label) {
  const st = safe(() => loadState(), null) || { field: {}, claims: {} };
  const tiles = safe(() => LensT.pressureTiles(), "ERR");
  if (tiles === "ERR") { emit(`LENS ${label} pressureTiles threw`); return; }
  const recede = !!CONFIG.recedeBorders;
  const bad = tiles.filter((t) => {
    if (t.leader === local) return false;
    const k = key(t);
    return !(recede && owner(t) === local && st.claims[k] && st.claims[k].by === local);
  });
  // The 1.1.0 lens's rule (leader is not the owner), for counting what the fix now leaves unpainted.
  const alive = new Set(safe(() => Players.getAlive().map((p) => p.id), []));
  const dead = [];
  const old = [];
  for (const k of Object.keys(st.field)) {
    const [x, y] = k.split(",").map(Number);
    const o = owner({ x, y });
    const v = safe(() => pressureVerdict(st.field[k], o, dead, CONFIG), null);
    if (v && v.leader >= 0 && v.leader !== o && v.progress >= MIN_PROGRESS && alive.has(v.leader)) old.push({ x, y, owner: o, leader: v.leader, progress: v.progress });
  }
  const painted = new Set(tiles.map(key));
  const dropped = old.filter((t) => !painted.has(key(t)));
  const seedPainted = cedeTile ? painted.has(cedeTile.k) : null;
  emit(`LENS ${label} painted=${tiles.length} notActionable=${bad.length} oldRuleTiles=${old.length} dropped=${dropped.length} `
    + `seedPainted=${seedPainted} recede=${recede} => ${bad.length === 0 ? "LENS-OK" : "LENS-PAINTS-UNREACHABLE " + J(bad.slice(0, 5))}`);
  for (const t of dropped.slice(0, 4)) {
    const tip = hasProgressRow(t);
    emit(`LENS dropped ${key(t)} owner=${t.owner < 0 ? "unowned" : civLabel(t.owner)} leader=${civLabel(t.leader)} `
      + `progress=${Math.round(t.progress * 100)}% tipRows=${tip.rows} tipProgress=${tip.progress} => ${tip.progress ? "TIP-SHOWS-UNREACHABLE" : "TIP-OK"}`);
  }
  if (cedeTile && owner(cedeTile.loc) === local) {
    const tip = hasProgressRow(cedeTile.loc);
    emit(`LENS seed ${cedeTile.k} painted=${seedPainted} tipRows=${tip.rows} tipProgress=${tip.progress} `
      + `=> ${seedPainted && tip.progress ? "SEED-SHOWN" : "SEED-NOT-SHOWN"}`);
  }
}

let cedeTile = null;
let seededAt = -1;
async function trySeed() {
  if (cedeTile) return;
  cedeTile = await seedPeacefulCede(localCities());
  if (cedeTile) { seededAt = n; setTimeout(() => lensCheck("after-seed"), 2500); }
}
async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 turn=${safe(() => Game.turn)} recede=${CONFIG.recedeBorders} debug=${CONFIG.debug}`);
  lensCheck("start");
  await trySeed();
  emit("ACTIONS done; ending turns");
  setTimeout(endTurn, 6000);
}

let n = 0; let endTurnTimer = null; let blockedTries = 0;
function endTurn() {
  try {
    const me = Players.get(local);
    if (!me.isTurnActive || GameContext.hasSentTurnComplete()) return;
    const b = String(Game.Notifications.getEndTurnBlockingType(local));
    if (b !== String(EndTurnBlockingTypes.NONE)) {
      blockedTries++;
      if (blockedTries >= 3 && typeof Autoplay !== "undefined") {
        safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
        blockedTries = 0; endTurnTimer = setTimeout(endTurn, 30000); return;
      }
      endTurnTimer = setTimeout(endTurn, 4000); return;
    }
    safe(() => UI.Player.deselectAllUnits()); GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTurnTimer = setTimeout(() => { if (safe(() => Players.get(local).isTurnActive, false) && !GameContext.hasSentTurnComplete()) endTurn(); }, 12000);
}
function cedeStatus() {
  if (!cedeTile) return null;
  return safe(() => {
    const raw = Configuration.getGame().getValue(STATE_KEY);
    const d = raw ? (JSON.parse(raw).data || {}) : {};
    return { k: cedeTile.k, ...where(cedeTile.loc), claim: (d.claims || {})[cedeTile.k] || null, pending: (d.pending || {})[cedeTile.k] || null,
      locked: (d.locked || {})[cedeTile.k] || 0 };
  }, "ERR");
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(async () => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)} cede=${J(cedeStatus())}`);
    lensCheck("turn" + n);
    await trySeed().catch((e) => emit("seed threw " + e));
    const finished = (seededAt > 0 && n - seededAt >= TURNS_AFTER_SEED) || n >= MAX_TURNS;
    if (finished) { setTimeout(() => emit(`DONE harness run12 finished seeded=${!!cedeTile}`), 3000); return; }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run12");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    emit("LOAD GameStarted");
    setTimeout(() => { n = 1; run().catch((e) => emit("run threw " + e + " " + (e && e.stack))); }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
