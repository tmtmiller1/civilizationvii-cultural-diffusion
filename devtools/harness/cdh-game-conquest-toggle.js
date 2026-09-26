// cdh-game-conquest-toggle.js - game scope, deployed as ui/cdh-game.js. WATCH the Options checkbox drive conquest.
//
// The conquest runs switched the feature on by patching the deployed cd-config.js. This run uses NO patch: the only
// way the feature turns on is the real "armies hold the ground they occupy" checkbox in the Options screen, clicked
// through its fxs-checkbox component (the same toggle() a mouse click runs) and committed with the screen's Confirm.
//
//   T0   boot: live config + saved setting (expected off: nothing saved, default false)
//   O1   open Options, read the cd-conquest checkbox (expected unchecked), SHOT, Confirm
//   OFF  plant a combat unit on an enemy tile and hold it for OFF_TURNS passes: no counter, no flip expected
//   O2   open Options, click the checkbox, SHOT, Confirm; saved setting + live config after the next pass
//   ON   keep holding: the tile should be taken once the hold reaches conquestBufferTurns
//   O3   click it off again the same way; the live config should read false after the next pass
// Turns are rolled the gold2 way (send anyway, no Autoplay - Autoplay would move our unit).

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { getConquestFlip } from "/cultural-diffusion/ui/cd-settings.js";
import { hostileCombatOccupants, conquerable } from "/cultural-diffusion/ui/cd-conquest.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const UNIT_TYPES = ["UNIT_SPEARMAN", "UNIT_WARRIOR", "UNIT_ARCHER"];
const OFF_TURNS = 6;   // one more than the shipped buffer of 5: a flip would have landed by now if the box were ignored
const ON_TURNS = 9;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function impassable(l) { return safe(() => !!GameplayMap.isImpassable(l.x, l.y), false); }
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function neighbours(p) { return inRadius(p, 1).filter((n) => n.x !== p.x || n.y !== p.y); }
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function readState() {
  return safe(() => { const raw = Configuration.getGame().getValue(STATE_KEY); const s = raw ? JSON.parse(raw) : null; return (s && (s.data || s)) || {}; }, {});
}
function savedSlice() {
  return safe(() => { const raw = localStorage.getItem("modSettings"); return raw ? (JSON.parse(raw)["cultural-diffusion"] ?? null) : null; });
}
function unitsAt(l) {
  return safe(() => {
    const out = [];
    for (const cid of MapUnits.getUnits(l.x, l.y)) {
      const u = Units.get(cid);
      if (u) out.push({ owner: u.owner, type: safe(() => GameInfo.Units.lookup(u.type).UnitType, "?"), combat: safe(() => u.Combat?.isCombat, "?") });
    }
    return out;
  }, []);
}
function enemies() {
  return safe(() => Players.getAlive().filter((p) => p.id !== local && p.isMajor && Players.get(local).Diplomacy.isAtWarWith(p.id)).map((p) => p.id), []);
}
function citiesOf(pid) { return safe(() => Players.get(pid).Cities.getCities() || [], []); }
function settings(label) {
  emit(`${label} SETTING liveConfig.conquestFlip=${CONFIG.conquestFlip} getConquestFlip()=${safe(() => getConquestFlip())} savedSlice=${js(savedSlice())}`);
}

/** The best plant site among an enemy's tiles: touching our land, conquerable, empty, far from its cities. */
function findSite(enemyIds) {
  let best = null;
  for (const e of enemyIds) {
    const eCities = citiesOf(e).map((c) => c.location);
    for (const c of localCities()) {
      for (const t of inRadius(c.location, 7)) {
        if (owner(t) !== e || isWater(t) || impassable(t)) continue;
        if (!conquerable(t, e)) continue;
        if (!neighbours(t).some((n) => owner(n) === local)) continue;
        if (unitsAt(t).length) continue;
        const dEnemy = Math.min(...eCities.map((cl) => dist(cl, t)), 99);
        const dOurs = dist(c.location, t);
        if (!best || dEnemy > best.dEnemy || (dEnemy === best.dEnemy && dOurs < best.dOurs)) best = { e, t, dEnemy, dOurs };
      }
    }
  }
  return best;
}

async function plant(site) {
  for (const type of UNIT_TYPES) {
    const r = safe(() => Game.PlayerOperations.sendRequest(local, "CREATE_ELEMENT", {
      IndependentIndex: -1, Kind: "UNIT", Location: site.t, Owner: local, Type: type
    }), "THREW");
    await later(3000);
    const us = unitsAt(site.t);
    emit(`PLANT ${type} at ${key(site.t)} request=${js(r)} unitsOnTile(+3s)=${js(us)}`);
    if (us.some((u) => u.owner === local && u.combat === true)) return type;
  }
  return null;
}

// ---------------------------------------------------------------- the Options screen, driven like a player
let CM = null;
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = safe(fn, null); if (v) return v; await later(250); }
  return null;
}
/**
 * Open Options on the Add-ons tab, read the cd-conquest checkbox, optionally click it, SHOT, then Confirm.
 * @returns {Promise<{before:string|null, after:string|null, clicked:boolean}>}
 */
async function optionsPass(label, click) {
  if (!CM) CM = (await import("/core/ui/context-manager/context-manager.js")).ContextManager;
  safe(() => CM.push("screen-options", { singleton: true, createMouseGuard: true, attributes: { "selected-tab": "0" } }));
  const cb = await waitFor(() => document.querySelector('fxs-checkbox[optionID="cd-conquest"]'), 15000);
  if (!cb) {
    emit(`${label} OPTIONS the cd-conquest checkbox never appeared in the Options screen`);
    return { before: null, after: null, clicked: false };
  }
  await later(1500);
  const label2 = safe(() => cb.parentElement?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120), "?");
  safe(() => {
    let s = cb.parentElement;
    while (s && s.tagName !== "FXS-SCROLLABLE") s = s.parentElement;
    s?.component?.scrollIntoView?.(cb.parentElement);
  });
  await later(1500);
  const before = cb.getAttribute("selected");
  emit(`${label} OPTIONS checkbox found; row text="${label2}" selected=${before}`);
  emit(`SHOT ${label}-before`);
  await later(4000);
  let after = before;
  if (click) {
    const r = safe(() => { cb.component.toggle(); return "ok"; });
    await later(1000);
    after = cb.getAttribute("selected");
    emit(`${label} OPTIONS clicked (component.toggle ${r}); selected ${before} -> ${after}`);
    settings(`${label} after-click`);
    emit(`SHOT ${label}-after`);
    await later(4000);
  }
  const confirm = document.querySelector("#options-confirm");
  safe(() => confirm.dispatchEvent(new CustomEvent("action-activate", { bubbles: true, detail: { x: 0, y: 0 } })));
  const closed = await waitFor(() => !document.querySelector("screen-options"), 8000);
  emit(`${label} OPTIONS confirm pressed; screen closed=${!!closed}`);
  if (!closed) safe(() => CM.pop("screen-options"));
  settings(`${label} after-confirm`);
  return { before, after, clicked: click };
}

// ---------------------------------------------------------------- the hold
let site = null;
let phase = "OFF";
let n = 0;             // turns rolled in the current phase
let offFlip = false;
let onFlipTurn = -1;
const verdicts = [];

function report(label) {
  const st = readState();
  const k = key(site.t);
  const us = unitsAt(site.t);
  emit(`${label} tile=${k} owner=${owner(site.t)} liveConfig=${CONFIG.conquestFlip} occupation=${js((st.occupation || {})[k])} pending=${js((st.pending || {})[k])} locked=${js((st.locked || {})[k])} units=${js(us)} occupants=${js(safe(() => hostileCombatOccupants(site.t, owner(site.t))))}`);
  return { owner: owner(site.t), ours: us.some((u) => u.owner === local) };
}

async function run() {
  local = GameContext.localPlayerID;
  const foes = enemies();
  emit(`T0 BOOT turn=${safe(() => Game.turn)} local=${local} buffer=${CONFIG.conquestBufferTurns} atWarWith=${js(foes)}`);
  settings("T0");
  const o1 = await optionsPass("O1", false);
  verdicts.push(`default: checkbox selected=${o1.before}, live config ${CONFIG.conquestFlip}`);
  if (!foes.length) { emit("VERDICT at war with no major; nothing to hold"); emit("DONE harness conquest-toggle finished"); return; }
  site = findSite(foes);
  if (!site) { emit("VERDICT no plant site"); emit("DONE harness conquest-toggle finished"); return; }
  emit(`SITE enemy=${site.e} tile=${key(site.t)} dEnemyCity=${site.dEnemy} dOurCity=${site.dOurs}`);
  if (!(await plant(site))) { emit("VERDICT could not plant a unit"); emit("DONE harness conquest-toggle finished"); return; }
  emit(`OFF PASS runNow=${js(safe(() => culturalDiffusion.runNow(), "ERR"))}`);
  report("OFF0");
  n = 0;
  setTimeout(endTurn, 3000);
}

async function afterTurn() {
  n++;
  emit(`TURN phase=${phase} n=${n} turn=${safe(() => Game.turn)}`);
  const r = report(`${phase}${n}`);
  if (phase === "OFF") {
    if (r.owner === local) offFlip = true;
    if (!r.ours) { emit("VERDICT the planted unit left the tile during the OFF hold; inconclusive"); finish(); return; }
    if (n >= OFF_TURNS) {
      verdicts.push(`OFF: ${offFlip ? "TILE WAS TAKEN although the box was off (DEFECT)" : `held ${n} turns with the box off, tile stayed player ${r.owner}'s, no occupation counter`}`);
      const o2 = await optionsPass("O2", true);
      verdicts.push(`click: selected ${o2.before} -> ${o2.after}, saved ${js(savedSlice())}`);
      emit(`ON PASS runNow=${js(safe(() => culturalDiffusion.runNow(), "ERR"))}`);
      report("ON0");
      verdicts.push(`after one pass the live config reads ${CONFIG.conquestFlip}`);
      phase = "ON"; n = 0;
    }
  } else if (phase === "ON") {
    if (r.owner === local && onFlipTurn < 0) onFlipTurn = n;
    if (onFlipTurn > 0 && n >= onFlipTurn + 1) {
      verdicts.push(`ON: TILE TAKEN after ${onFlipTurn} turn(s) with the box on`);
      await turnOff(); return;
    }
    if (n >= ON_TURNS) {
      verdicts.push(`ON: ${r.ours ? "tile NOT taken within " + n + " turns although the unit held it" : "the unit left the tile; inconclusive"}`);
      await turnOff(); return;
    }
  }
  setTimeout(endTurn, 4000);
}

async function turnOff() {
  const o3 = await optionsPass("O3", true);
  safe(() => culturalDiffusion.runNow());
  verdicts.push(`off again: selected ${o3.before} -> ${o3.after}, saved ${js(savedSlice())}, live config after a pass ${CONFIG.conquestFlip}`);
  finish();
}

function finish() {
  for (const v of verdicts) emit("VERDICT " + v);
  emit("DONE harness conquest-toggle finished");
}

// ---------------------------------------------------------------- turns, no Autoplay
let endTimer = null; let tries = 0; let rolling = false;
function endTurn() {
  rolling = true;
  try {
    if (!Players.get(local).isTurnActive) return;
    tries++;
    safe(() => UI.Player.deselectAllUnits());
    if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  if (tries < 30) endTimer = setTimeout(endTurn, 5000); else emit("ENDTURN gave up after 30 tries");
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || !rolling) return;
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  rolling = false; tries = 0;
  setTimeout(() => { afterTurn().catch((e) => { emit("afterTurn threw " + e); finish(); }); }, 5000);
});

emit("attached conquest-toggle");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => { emit("run threw " + e); emit("DONE harness conquest-toggle finished"); }); }, 12000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
