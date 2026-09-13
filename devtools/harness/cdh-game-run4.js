// cdh-game-run4.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 4 (dev only).
// Deploy the mod with recedeBorders: true AND debug: true. In the first local turn:
//   R8 SWAP     one of our cities re-buys a tile attached to ANOTHER of our cities (owner stays us, owning city should
//               change, landing after the call). If it works, releaseInnerClaims can heal a 1.0.6-damaged save by
//               re-parenting instead of the unclaim that does nothing.
//   R9 CEDE     against a rival at PEACE with us: buy an unowned tile beyond ring 3 that touches both our land and theirs,
//               then seed the mod's state with our claim on it and a dominant rival stock, so the mod's OWN recede step
//               cedes it (pending) and confirms it next pass.
// then ends TURNS turns. Tagged [CDH] in Logs/UI.log.

const TAG = "[CDH]";
const TURNS = 3;
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

// --- R8: re-parent a tile between two of our own cities ------------------------------------------------------------
async function swapTest(cities) {
  for (const a of cities) {
    for (const b of cities) {
      if (a === b || dist(a.location, b.location) > 6) continue;
      for (const l of inRadius(a.location, 3)) {
        if (dist(a.location, l) < 1 || dist(b.location, l) > 3 || owner(l) !== local || owningCity(l) !== cityIdNum(a)) continue;
        if (!landClean(l) || cities.some((c) => c.location.x === l.x && c.location.y === l.y)) continue;
        const before = where(l);
        const buy = refundBuy(local, b, l);
        const inline = where(l);
        await later(4000);
        const after = where(l);
        const verdict = after.owner === local && after.city === cityIdNum(b)
          ? (inline.city === cityIdNum(b) ? "REPARENT-WORKS-INLINE" : "REPARENT-WORKS-DEFERRED")
          : "REPARENT-FAILS";
        emit(`R8 SWAP ${key(l)} from ${cityName(a)}(${cityIdNum(a)}, d=${dist(a.location, l)}) to ${cityName(b)}(${cityIdNum(b)}, d=${dist(b.location, l)}) `
          + `before=${J(before)} call=${buy.call} gold=${buy.spent} inline=${J(inline)} after=${J(after)} => ${verdict}`);
        if (verdict !== "REPARENT-FAILS") { refundBuy(local, a, l); await later(3000); emit(`R8 restore ${key(l)} -> ${J(where(l))}`); }
        return verdict;
      }
    }
  }
  emit("R8 skipped: no tile attached to one of our cities within ring 3 of another");
  return null;
}

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

let cedeTile = null;
async function run() {
  local = GameContext.localPlayerID;
  const cities = localCities();
  emit(`S0 turn=${safe(() => Game.turn)} recede=${safe(() => globalThis.culturalDiffusion.config().recedeBorders)} debug=${safe(() => globalThis.culturalDiffusion.config().debug)}`);
  await swapTest(cities);
  cedeTile = await seedPeacefulCede(cities);
  emit("ACTIONS done; ending turns");
  setTimeout(endTurn, 3000);
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
  setTimeout(() => emit(`TURN n=${n} turn=${safe(() => Game.turn)} cede=${J(cedeStatus())}`), 5000);
  if (n > TURNS) { setTimeout(() => emit("DONE harness run4 finished"), 6000); return; }
  setTimeout(endTurn, 8000);
});

emit("attached run4");
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
