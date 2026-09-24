// cd-diagnostics.js
//
// Debug-only per-pass diagnostics for otherwise silent failures: an injector whose engine reads come
// back 0, a first claimable ring whose stock never reaches the ownership bar, and a persisted state
// blob that keeps growing. Every line is a dlog except the state-size WARNING, which is logged
// unconditionally once the blob passes STATE_WARN_BYTES. Read-only.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog, log } from "/cultural-diffusion/ui/cd-log.js";
import { plotsInRadius } from "/cultural-diffusion/ui/cd-plots.js";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { cityCultureCap } from "/cultural-diffusion/ui/cd-field.js";

/** Always warn once the persisted state blob grows past this many characters. */
export const STATE_WARN_BYTES = 512 * 1024;

/** @param {*} v @returns {string} A compact number for a log line. */
function fmt(v) {
  return typeof v === "number" && isFinite(v) ? String(Math.round(v * 100) / 100) : String(v);
}

/**
 * @param {Record<string, Record<string, number>>} field Culture field.
 * @param {string} k Plot key. @param {number} civ Civ id.
 * @returns {number} That civ's stock on the tile (0 when absent).
 */
function stockAt(field, k, civ) {
  return (field[k] && field[k][String(civ)]) || 0;
}

/** Each injector's inputs, strength, and resulting city-tile stock against its cap. */
function logInjectors(injectors, next) {
  for (const [k, inj] of injectors) {
    dlog(`inject ${k} civ=${inj.civ} culture=${fmt(inj.culture)} vitality=${fmt(inj.vitality)} `
      + `strength=${fmt(inj.strength)} stock=${fmt(stockAt(next, k, inj.civ))} cap=${fmt(cityCultureCap(inj.strength, CONFIG))}`);
  }
}

/** Per local city, the best stock on the first ring the mod may claim, against the ownership bar. */
function logFrontier(cities, next, me, ageCfg) {
  const ring = Math.max(1, Math.floor(CONFIG.baseGrowthRadius)) + 1;
  for (const c of cities) {
    let best = 0;
    let over = 0;
    let n = 0;
    for (const p of plotsInRadius(c.loc, ring)) {
      if (hexDistance(c.loc, p) !== ring) continue;
      const v = stockAt(next, `${p.x},${p.y}`, me);
      n++;
      if (v > best) best = v;
      if (v > ageCfg.minimumOwner) over++;
    }
    dlog(`frontier city=${c.id} ring=${ring} best=${fmt(best)} bar=${fmt(ageCfg.minimumOwner)} over=${over}/${n} `
      + `centre=${fmt(stockAt(next, `${c.loc.x},${c.loc.y}`, me))}`);
  }
}

/**
 * Debug: log every injector and every local city's first claimable ring. No-op unless CONFIG.debug.
 * @param {Map<string, {civ:number, strength:number, culture:number, vitality:number}>} injectors Injectors.
 * @param {{id:number, loc:{x:number,y:number}}[]} cities Local cities.
 * @param {Record<string, Record<string, number>>} next The updated field.
 * @param {number} me Local player id.
 * @param {{minimumOwner:number}} ageCfg Age-adjusted config (carries the ownership bar).
 */
export function logFieldDiagnostics(injectors, cities, next, me, ageCfg) {
  if (!CONFIG.debug) return;
  logInjectors(injectors, next);
  logFrontier(cities, next, me, ageCfg);
}

/**
 * Persisted-state size + pass time: a dlog every pass, and ALWAYS logged once the blob passes
 * STATE_WARN_BYTES.
 * @param {{field:Object, claims:Object, locked:Object}} state Saved state.
 * @param {number} bytes Length of the persisted blob (saveState's return).
 * @param {number} ms Pass wall time in milliseconds.
 */
export function logStateSize(state, bytes, ms) {
  const line = `state bytes=${bytes} field=${Object.keys(state.field).length} claims=${Object.keys(state.claims).length} `
    + `locked=${Object.keys(state.locked).length} passMs=${ms}`;
  if (bytes > STATE_WARN_BYTES) log(`WARNING large ${line}`);
  else dlog(line);
}
