// cdh-game-run10.js - game scope, deployed as ui/cdh-game.js. Run 10 (dev only): does the Cultural Pressure lens paint
// contested tiles? Run 9 switched the lens on after 12 turns, but no tile was contested yet, so nothing could be painted.
// Loads AugustusAnt136 (via cdh-shell-run5.js) and ends turns one at a time. Each turn it rebuilds the lens's own
// contested-tile list with the lens's own imports and gates. Once enough tiles are contested, or at the turn cap (before
// the turn-160 age change), it shoots the map around the most advanced tile with the lens off, then on, then closer. It
// also logs the readout the hover panel would show for the top tiles. No other game actions. Tagged [CDH] in UI.log.

import LensManager from "/core/ui/lenses/lens-manager.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { loadState } from "/cultural-diffusion/ui/cd-state.js";
import { pressureVerdict } from "/cultural-diffusion/ui/cd-field.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { applyTunableOverrides } from "/cultural-diffusion/ui/cd-settings.js";
import { civLabel } from "/cultural-diffusion/ui/cd-lens-colors.js";

const TAG = "[CDH]";
const MAX_TURNS = 21; // AugustusAnt136 starts on turn 136; stop by turn 157, before the age change at 160
const MIN_PROGRESS = 0.08; // the lens's own cut-off (cd-pressure-lens.js)
const ENOUGH_TILES = 4;
const STRONG_PROGRESS = 0.35;
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}

let local = -1;

// The same age-adjusted config the lens builds (cd-pressure-lens.js ageAdjustedCfg).
function lensCfg() {
  safe(() => applyTunableOverrides());
  const bar = safe(() => { const a = CONFIG.byAge && CONFIG.byAge[currentAgeKey()]; return a && typeof a.ownerBar === "number" ? a.ownerBar : 1; }, 1);
  return { ...CONFIG, minimumOwner: CONFIG.minimumOwner * Math.max(0.1, bar) };
}

// The lens's pressureTiles(), rebuilt: tiles whose leading culture is not the owner, at or above the lens's cut-off.
function contested() {
  const field = safe(() => loadState().field || {}, {});
  const cfg = lensCfg();
  const alive = new Set(safe(() => Players.getAlive().map((p) => p.id), []));
  const dead = [];
  if (alive.size) for (const k of Object.keys(field)) for (const c of Object.keys(field[k])) { const id = parseInt(c, 10); if (!alive.has(id) && dead.indexOf(id) < 0) dead.push(id); }
  const out = [];
  let ourStockOffOwned = 0;
  for (const k of Object.keys(field)) {
    const [x, y] = k.split(",").map(Number);
    const owner = ownerAt({ x, y });
    if ((field[k][String(local)] || 0) > 0 && owner !== local) ourStockOffOwned++;
    const v = safe(() => pressureVerdict(field[k], owner, dead, cfg), null);
    if (!v || v.leader < 0 || v.leader === owner || v.progress < MIN_PROGRESS) continue;
    out.push({ x, y, owner, leader: v.leader, progress: v.progress, stocks: field[k] });
  }
  out.sort((a, b) => b.progress - a.progress);
  return { tiles: out, fieldSize: Object.keys(field).length, ourStockOffOwned };
}

function readout(t) {
  const rows = Object.keys(t.stocks).map((c) => `${civLabel(parseInt(c, 10))}=${Math.round(t.stocks[c])}`).join(" ");
  const owner = t.owner < 0 ? "unowned" : civLabel(t.owner);
  return `tile=${t.x},${t.y} owner=${owner} leader=${civLabel(t.leader)} progress=${Math.round(t.progress * 100)}% stocks: ${rows}`;
}

function lensShots(c) {
  const top = c.tiles[0];
  const at = top ? { x: top.x, y: top.y } : safe(() => Players.get(local).Cities.getCities()[0].location, null);
  const wide = at ? safe(() => { Camera.lookAtPlot(at, { zoom: 0.6 }); return "zoom0.6"; }, "no-camera") : "no-target";
  setTimeout(() => {
    emit(`LENS OFF SHOT active=${safe(() => LensManager.getActiveLens(), "?")} camera=${wide} at=${at ? at.x + "," + at.y : "-"} contested=${c.tiles.length}`);
    setTimeout(() => {
      const set = safe(() => { LensManager.setActiveLens("cd-pressure-lens"); return "called"; }, "throw");
      setTimeout(() => {
        emit(`LENS ACTIVE set=${set} active=${safe(() => LensManager.getActiveLens(), "?")} layerEnabled=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")}`);
        for (const t of c.tiles.slice(0, 4)) emit("READOUT " + readout(t));
        setTimeout(() => {
          const close = at ? safe(() => { Camera.lookAtPlot(at, { zoom: 0.3 }); return "zoom0.3"; }, "no-camera") : "no-target";
          setTimeout(() => {
            emit(`LENS CLOSE SHOT camera=${close} active=${safe(() => LensManager.getActiveLens(), "?")}`);
            setTimeout(() => emit("DONE run10"), 12000);
          }, 6000);
        }, 12000);
      }, 5000);
    }, 12000);
  }, 6000);
}

let n = 0; let endTurnTimer = null; let blockedTries = 0; let shot = false;
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
  if (who !== GameContext.localPlayerID || n === 0 || shot) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  // The mod's pass runs on this same event; read the field a few seconds later so this turn's pass has landed.
  setTimeout(() => {
    const c = contested();
    const top = c.tiles[0];
    emit(`TURN n=${n} turn=${safe(() => Game.turn)} field=${c.fieldSize} ourStockOffOwned=${c.ourStockOffOwned} contested=${c.tiles.length} top=${top ? top.x + "," + top.y + "@" + Math.round(top.progress * 100) + "%" : "-"}`);
    const ready = c.tiles.length >= ENOUGH_TILES || (top && top.progress >= STRONG_PROGRESS);
    if (ready || n > MAX_TURNS) { shot = true; lensShots(c); return; }
    endTurn();
  }, 8000);
});

emit("attached run10");
let beginTries = 0;
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    setTimeout(() => { local = GameContext.localPlayerID; emit(`R10 start turn=${safe(() => Game.turn)}`); n = 1; setTimeout(endTurn, 3000); }, 8000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
