// cdh-game-run13.js - game scope, deployed as ui/cdh-game.js. Cultural Diffusion harness run 13 (dev only).
//
// ONE QUESTION: can a mod move a unit it does not own off a plot the border is taking, and if not, what does the
// engine do instead? The 1.1.1 eviction (ui/cd-units.js) is built on UNITOPERATION_TELEPORT_TO and is UNWATCHED.
// Three recorded signals say it may not work, so this run does not test one verb - it bakes off every candidate and
// reads the UNIT'S LOCATION afterwards rather than trusting canStart:
//   - engine-closed.md: an operation sent under another player's id is refused, and `canStart` SUCCEEDS anyway.
//   - engine-closed.md: canStart checks request shape, not placement; confirm every write with a deferred re-read.
//   - emigration engine-probe README: canStart(UNITOPERATION_TELEPORT_TO) answered FALSE for one of our own units.
//
// Stages (each emits its own VERDICT line; the tail of the log answers the whole question):
//   S1 SURFACE   read-only: which move/teleport/place names exist on Game.UnitOperations / UnitCommands /
//                WorldBuilder / Units on THIS build, plus the UnitOperationTypes enum members.
//   S2 OWN       control: the bake-off against one of OUR units. Tells us whether each verb works AT ALL.
//   S3 FOREIGN   the decisive stage: the same bake-off against a FOREIGN unit (civilian preferred).
//   S4 OVERRUN   claim the plot a foreign unit stands on with the mod's eviction OFF, then watch 3 turns: does the
//                BASE GAME eject it, does it walk out, or is it stuck? (The reported symptom, never yet watched.)
//   S5 MOD       the same fixture with the eviction ON: did cd-units fire, did the unit move, was the claim skipped?
//
// Deploy the mod with debug: true. S4/S5 relax requireAdjacency/flipMaxDistance so a plot a real foreign unit happens
// to stand on can be claimed at all; nothing else about the claim path is changed.
// Tagged [CDH] in Logs/UI.log.

import { runPass } from "/cultural-diffusion/ui/cd-pass.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const MAX_TURNS = 14;
const WATCH_TURNS = 3;      // how long S4 watches a unit left inside our border
const SEED_STOCK = 50000;   // far above any ownership bar, so the seeded plot wins its own pass
// Every candidate for "move this unit off that plot", cheapest/most-specific first.
const VERBS = ["UNITOPERATION_TELEPORT_TO", "UNITOPERATION_MOVE_TO", "UNITOPERATION_SWAP_UNITS",
  "UNITOPERATION_TELEPORT_TO_CITY"];

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
function key(l) { return l.x + "," + l.y; }
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function nearest(l, cities) {
  let best = null; let bd = 1e9;
  for (const c of cities) { const d = dist(c.location, l); if (d < bd) { bd = d; best = c; } }
  return best ? { city: best, d: bd } : null;
}
function landClean(l) {
  return safe(() => {
    if (GameplayMap.isWater(l.x, l.y)) return false;
    const blocked = typeof GameplayMap.isImpassable === "function" ? GameplayMap.isImpassable(l.x, l.y) : GameplayMap.isMountain(l.x, l.y);
    return !blocked;
  }, false);
}

// --- unit reads (the shapes watched in the emigration probe) ---------------------------------------------------------
function unitsAt(l) {
  return safe(() => (MapUnits.getUnits(l.x, l.y) || []).map((cid) => {
    const u = Units.get(cid);
    return u ? { cid: u.id || cid, owner: u.owner, type: safe(() => GameInfo.Units.lookup(u.type).UnitType, "?"), loc: u.location } : null;
  }).filter(Boolean), []);
}
function playerUnits(pid) {
  const raw = safe(() => Players.get(pid)?.Units?.getUnits?.(), null) || safe(() => Players.get(pid)?.Units?.getUnitIds?.(), null) || [];
  return safe(() => raw.map((u) => {
    const unit = (u && u.location) ? u : Units.get(u);
    return unit ? { cid: unit.id || u, owner: unit.owner, type: safe(() => GameInfo.Units.lookup(unit.type).UnitType, "?"), loc: unit.location } : null;
  }).filter(Boolean), []);
}
/** Where a unit is NOW, by component id (null when it no longer exists). */
function whereIsUnit(cid) {
  const u = safe(() => Units.get(cid), null);
  return u && u.location ? { x: u.location.x, y: u.location.y } : null;
}
function isCivilian(type) { return /SETTLER|MIGRANT|MERCHANT|MISSIONARY|SCOUT|TRADE|EXPLORER/.test(type || ""); }

// --- S1: what this build actually exposes ----------------------------------------------------------------------------
function reflect(obj, label) {
  const names = safe(() => {
    const out = [];
    for (const k in obj) if (/move|teleport|place|swap|position|reloc/i.test(k)) out.push(k);
    return out;
  }, "ERR");
  emit(`S1 ${label} moveish=${J(names)}`);
}
function surface() {
  emit(`S1 UnitOperations present=${typeof Game?.UnitOperations} canStart=${typeof Game?.UnitOperations?.canStart} `
    + `sendRequest=${typeof Game?.UnitOperations?.sendRequest}`);
  reflect(Game?.UnitOperations, "Game.UnitOperations");
  reflect(Game?.UnitCommands, "Game.UnitCommands");
  reflect(typeof WorldBuilder !== "undefined" ? WorldBuilder : null, "WorldBuilder");
  reflect(typeof WorldBuilder !== "undefined" ? WorldBuilder?.MapUnits : null, "WorldBuilder.MapUnits");
  reflect(typeof Units !== "undefined" ? Units : null, "Units");
  const enums = safe(() => Object.keys(UnitOperationTypes || {}).filter((k) => /TELEPORT|MOVE|SWAP/i.test(k)), "ERR");
  emit(`S1 UnitOperationTypes moveish=${J(enums)}`);
}

// --- S2/S3: the bake-off -------------------------------------------------------------------------------------------
/** A plot near `from` that looks like somewhere a land unit could legally stand, and is not ours. */
function candidateDest(from, wantForeign) {
  for (const r of [1, 2, 3]) {
    for (const p of inRadius(from, r)) {
      if (p.x === from.x && p.y === from.y) continue;
      if (dist(from, p) !== r) continue;
      if (!landClean(p)) continue;
      if (wantForeign && owner(p) === local) continue;
      if (unitsAt(p).length) continue;      // an occupied plot is a different refusal
      return p;
    }
  }
  return null;
}

/**
 * For one unit, try every verb and report what the UNIT'S LOCATION says afterwards - never what canStart said.
 * @returns {Promise<object[]>} One row per verb.
 */
async function bakeOff(label, unit) {
  const rows = [];
  for (const op of VERBS) {
    const before = whereIsUnit(unit.cid);
    if (!before) { rows.push({ op, skipped: "unit gone" }); continue; }
    const dest = candidateDest(before, true);
    if (!dest) { rows.push({ op, skipped: "no candidate destination" }); continue; }
    const args = { X: dest.x, Y: dest.y };
    const canBare = safe(() => Game.UnitOperations.canStart(unit.cid, op, {}, false), "throw");
    const canArgs = safe(() => Game.UnitOperations.canStart(unit.cid, op, args, false), "throw");
    const plots = safe(() => (canBare && Array.isArray(canBare.Plots)) ? canBare.Plots.length : null, null);
    emit(`${label} ${op} canStart{}=${J(canBare && canBare.Success)} plots=${plots} canStart{X,Y}=${J(canArgs && canArgs.Success)} dest=${key(dest)}`);
    const sent = safe(() => { Game.UnitOperations.sendRequest(unit.cid, op, args); return "sent"; }, "threw");
    await later(3000);
    const at3 = whereIsUnit(unit.cid);
    await later(5000);
    const at8 = whereIsUnit(unit.cid);
    const moved = !!(at8 && (at8.x !== before.x || at8.y !== before.y));
    const row = { op, canStart: !!(canArgs && canArgs.Success), plots, sent, from: key(before),
      at3: at3 ? key(at3) : "gone", at8: at8 ? key(at8) : "gone", wanted: key(dest), moved,
      landedWhereAsked: !!(at8 && at8.x === dest.x && at8.y === dest.y) };
    rows.push(row);
    emit(`${label} ${op} => ${moved ? "MOVED" : "NO-MOVE"} ${J(row)}`);
    if (moved) break; // the first verb that actually works is the answer; stop poking this unit
  }
  return rows;
}

function pickOwnUnit() {
  const mine = playerUnits(local).filter((u) => u.loc && landClean(u.loc) && u.loc.x >= 0);
  return mine.find((u) => isCivilian(u.type)) || mine[0] || null;
}
function foreignUnits() {
  const others = safe(() => Players.getAlive().filter((p) => p.id !== local).map((p) => p.id), []);
  const out = [];
  for (const pid of others) for (const u of playerUnits(pid)) if (u.loc && u.loc.x >= 0 && landClean(u.loc)) out.push(u);
  return out;
}
function pickForeignUnit() {
  const all = foreignUnits();
  const civ = all.filter((u) => isCivilian(u.type));
  const cities = localCities();
  const byNearness = (a, b) => (nearest(a.loc, cities)?.d ?? 99) - (nearest(b.loc, cities)?.d ?? 99);
  return civ.sort(byNearness)[0] || all.sort(byNearness)[0] || null;
}

// --- S4/S5: claim the plot a foreign unit is standing on -------------------------------------------------------------
/** A foreign unit standing on a plot this mod could be made to claim (unowned land within reach of our city). */
function overrunFixture() {
  const cities = localCities();
  for (const u of foreignUnits().sort((a, b) => (nearest(a.loc, cities)?.d ?? 99) - (nearest(b.loc, cities)?.d ?? 99))) {
    if (owner(u.loc) >= 0) continue;                     // unowned land only: no war/core gates in the way
    const near = nearest(u.loc, cities);
    if (!near || near.d > CONFIG.flipMaxDistance) continue;
    if (near.d <= CONFIG.baseGrowthRadius) continue;     // the base game owns the inner rings
    return { unit: u, loc: { x: u.loc.x, y: u.loc.y }, city: near };
  }
  return null;
}
function seedStock(loc) {
  const k = key(loc);
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  d.field[k] = { [String(local)]: SEED_STOCK };
  delete d.locked[k]; delete d.claims[k]; delete d.pending[k];
  const w = safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); return "set"; }, "throw");
  return w;
}
/** Seed the unit's plot and run ONE pass in the same tick, so the unit cannot wander off in between. */
function claimOverUnit(fix, label) {
  const k = key(fix.loc);
  const before = whereIsUnit(fix.unit.cid);
  const w = seedStock(fix.loc);
  const res = safe(() => runPass(), "threw");
  emit(`${label} SEED ${k} write=${w} unit=${fix.unit.type} owner=${fix.unit.owner} ourCity=${safe(() => Locale.compose(fix.city.city.name), "?")} `
    + `ring=${fix.city.d} bump=${CONFIG.bumpForeignUnits} pass=${J(res)} ownerBefore=${owner(fix.loc)} unitBefore=${J(before)}`);
  return { k, loc: fix.loc, cid: fix.unit.cid, type: fix.unit.type, unitOwner: fix.unit.owner, before, label };
}
function overrunStatus(t) {
  const st = safe(() => {
    const raw = Configuration.getGame().getValue(STATE_KEY);
    const d = raw ? (JSON.parse(raw).data || {}) : {};
    return { claim: (d.claims || {})[t.k] || null, pending: (d.pending || {})[t.k] || null };
  }, "ERR");
  const at = whereIsUnit(t.cid);
  return { k: t.k, owner: owner(t.loc), unitAt: at ? key(at) : "gone",
    unitStillOnPlot: !!(at && at.x === t.loc.x && at.y === t.loc.y), state: st };
}

// --- run ------------------------------------------------------------------------------------------------------------
let ownRows = null; let foreignRows = null;
let tracked = [];           // S4/S5 fixtures being watched
let s4Turn = -1; let s5Done = false;

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 turn=${safe(() => Game.turn)} local=${local} bump=${CONFIG.bumpForeignUnits} rings=${CONFIG.bumpMaxRings} debug=${CONFIG.debug}`);
  surface();

  const own = pickOwnUnit();
  emit(`S2 ownUnit=${J(own && { type: own.type, loc: own.loc })}`);
  if (own) ownRows = await bakeOff("S2 OWN", own);
  else emit("S2 no own unit on clean land - control did not run");

  const foreign = pickForeignUnit();
  emit(`S3 foreignUnit=${J(foreign && { type: foreign.type, owner: foreign.owner, loc: foreign.loc, ourRing: nearest(foreign.loc, localCities())?.d })}`);
  if (foreign) foreignRows = await bakeOff("S3 FOREIGN", foreign);
  else emit("S3 no foreign unit found - the decisive stage did not run");

  const ownWorked = (ownRows || []).filter((r) => r.moved).map((r) => r.op);
  const foreignWorked = (foreignRows || []).filter((r) => r.moved).map((r) => r.op);
  const lied = (foreignRows || []).filter((r) => r.canStart && !r.moved).map((r) => r.op);
  emit(`S3 VERDICT ownMoved=${J(ownWorked)} foreignMoved=${J(foreignWorked)} canStartSaidYesButNothingMoved=${J(lied)} `
    + `=> ${foreignWorked.length ? "FOREIGN-UNIT-MOVABLE via " + foreignWorked[0] : "NO VERB MOVED A FOREIGN UNIT"}`);

  // S4: the overrun, with the mod's eviction OFF - what does the base game do?
  CONFIG.requireAdjacency = false;      // the fixture is wherever a real foreign unit happens to stand
  CONFIG.flipMaxDistance = 12;
  CONFIG.bumpForeignUnits = false;
  const fix = overrunFixture();
  emit(`S4 fixture=${J(fix && { plot: key(fix.loc), unit: fix.unit.type, owner: fix.unit.owner, ring: fix.city.d })}`);
  if (fix) { tracked.push(claimOverUnit(fix, "S4")); s4Turn = n; }
  else emit("S4 no foreign unit on claimable unowned land yet - retried each turn");
  emit("ACTIONS done; ending turns");
  setTimeout(endTurn, 6000);
}

/** S5 runs once S4 has been watched: same fixture shape, eviction ON. */
function maybeS5() {
  if (s5Done || s4Turn < 0 || n - s4Turn < WATCH_TURNS) return;
  CONFIG.bumpForeignUnits = true;
  const fix = overrunFixture();
  if (!fix) { emit("S5 no second fixture available"); s5Done = true; return; }
  tracked.push(claimOverUnit(fix, "S5"));
  s5Done = true;
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

engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  setTimeout(() => {
    emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
    for (const t of tracked) emit(`${t.label} WATCH n=${n} ${J(overrunStatus(t))}`);
    if (s4Turn < 0) {                       // S4 never got a fixture; keep trying
      const fix = overrunFixture();
      if (fix) { CONFIG.bumpForeignUnits = false; tracked.push(claimOverUnit(fix, "S4")); s4Turn = n; }
    }
    maybeS5();
    if (n >= MAX_TURNS || (s5Done && tracked.length && n - s4Turn >= WATCH_TURNS + 2)) {
      for (const t of tracked) {
        const st = overrunStatus(t);
        emit(`${t.label} VERDICT plot=${t.k} unit=${t.type} owner=${t.unitOwner} claimed=${st.owner === local} `
          + `unitStillOnPlot=${st.unitStillOnPlot} unitAt=${st.unitAt} => `
          + (st.owner === local && st.unitStillOnPlot ? "CLAIMED-AND-UNIT-STUCK (the reported symptom)"
            : st.owner === local ? "CLAIMED-AND-UNIT-LEFT"
              : "CLAIM-SKIPPED"));
      }
      setTimeout(() => emit("DONE harness run13 finished"), 3000);
      return;
    }
    setTimeout(endTurn, 5000);
  }, 8000);
});

emit("attached run13");
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
