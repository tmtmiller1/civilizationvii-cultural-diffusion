// cd-capture.js
//
// Culture transfer when a city changes hands (Civ V CityCultureOnCapture, docs/civ-v-parity-spec.md §5). On the
// engine's `CityTransfered` event, every culture on each of the captured city's tiles loses `captureLoss` of its
// stock and the new owner gains `captureGain` of the total lost, so a conquered region starts leaning toward its
// conqueror at once instead of keeping the old owner's full stock against a conqueror starting from zero. The
// change is to the persisted field only; no engine write happens here, so there is no verb risk and the same
// arithmetic applies to a capture between two AI civilizations (watched 2026-09-25: the event reaches the UI
// context for transfers with no local party). Saved immediately, so a save-and-reload before the next pass keeps it.
//
// Payload shape (watched): { fromPlayer, transferType, cityID: { owner: <new owner>, id, type } }.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog, log } from "/cultural-diffusion/ui/cd-log.js";
import { loadState, saveState } from "/cultural-diffusion/ui/cd-state.js";
import { applyCaptureTransfer } from "/cultural-diffusion/ui/cd-field.js";
import { plotsInRadius, owningCityIdAt, cityIdOf, cityLoc } from "/cultural-diffusion/ui/cd-plots.js";

/** @param {()=>*} fn Thunk. @param {*} fallback Fallback. @returns {*} fn() or fallback. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {{x:number,y:number}} p Plot. @returns {string} Plot key. */
function key(p) {
  return `${p.x},${p.y}`;
}

/** The city's own plots from `getPurchasedPlots` (plot indices), or null when the read is unavailable. */
function purchasedPlots(city) {
  return safe(() => {
    const idx = city?.getPurchasedPlots?.();
    if (!idx) return null;
    /** @type {{x:number,y:number}[]} */
    const out = [];
    for (const i of idx) {
      const l = safe(() => GameplayMap?.getLocationFromIndex?.(i), null);
      if (l && typeof l.x === "number") out.push({ x: l.x, y: l.y });
    }
    return out;
  }, null);
}

/**
 * Every plot a city owns, center included: `getPurchasedPlots` when the build has it, else a scan of the plots
 * within `fieldRadius` whose owning city is this one.
 * @param {*} city Engine city.
 * @returns {{x:number,y:number}[]} Plots (empty when the city is unreadable).
 */
export function cityPlots(city) {
  const center = cityLoc(city);
  if (!center) return [];
  const id = cityIdOf(city);
  let plots = purchasedPlots(city);
  if (!plots || !plots.length) {
    plots = plotsInRadius(center, Math.max(1, CONFIG.fieldRadius)).filter((p) => owningCityIdAt(p) === id);
  }
  if (!plots.some((p) => p.x === center.x && p.y === center.y)) plots.push(center);
  return plots;
}

/**
 * Apply the capture arithmetic to every listed plot that has a field row. Plots the field never reached carry no
 * culture and are skipped. Mutates `state.field`.
 * @param {import("/cultural-diffusion/ui/cd-state.js").CdState} state Loaded state.
 * @param {{x:number,y:number}[]} plots The captured city's plots.
 * @param {number} newOwner The conqueror.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Tiles rewritten.
 */
export function transferCityCulture(state, plots, newOwner, cfg) {
  let n = 0;
  for (const p of plots) {
    const row = state.field[key(p)];
    if (!row) continue;
    applyCaptureTransfer(row, newOwner, cfg);
    n++;
  }
  return n;
}

/**
 * `CityTransfered` handler: rewrite the captured city's tiles in the persisted field and save at once.
 * @param {*} data Event payload ({ fromPlayer, transferType, cityID }).
 * @returns {number} Tiles rewritten (0 when off, unreadable, or outside the field).
 */
export function onCityTransfered(data) {
  try {
    if (!CONFIG.captureTransfer) return 0;
    const cid = data && data.cityID;
    const newOwner = cid && typeof cid.owner === "number" ? cid.owner : -1;
    const city = newOwner >= 0 ? safe(() => Cities?.get?.(cid), null) : null;
    if (!city) {
      dlog(`capture: city ${JSON.stringify(cid)} not readable; no transfer`);
      return 0;
    }
    return transferForCity(city, newOwner, data && data.fromPlayer);
  } catch (e) {
    dlog(`onCityTransfered threw ${String(e)}`);
    return 0;
  }
}

/** Load, rewrite and save the field for one captured city; logs the outcome. @returns {number} Tiles rewritten. */
function transferForCity(city, newOwner, fromPlayer) {
  const plots = cityPlots(city);
  const state = loadState();
  const n = transferCityCulture(state, plots, newOwner, CONFIG);
  if (n > 0) {
    saveState(state);
    log(`capture: city ${cityIdOf(city)} now player ${newOwner}'s (from ${fromPlayer}); `
      + `culture transferred on ${n} of ${plots.length} tile(s)`);
  } else {
    dlog(`capture: city ${cityIdOf(city)} to player ${newOwner} lies outside the simulated field; nothing to transfer`);
  }
  return n;
}
