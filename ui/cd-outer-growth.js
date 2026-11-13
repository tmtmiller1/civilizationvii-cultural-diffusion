// cd-outer-growth.js
//
// The growth screen offers claimed tiles past ring 3. When a settlement grows, the game lists the tiles it may develop
// (PlacePopulation.updateExpandPlots, from the engine's EXPAND answer, always within three rings). This adds the city's
// own outer tiles that touch land it has developed, in the same highlight, and sends a click on one of them to
// placeOuterCitizen (cd-outer-place.js) instead of the engine's EXPAND, which places nothing past ring 3.
//
// Every patch keeps the original and falls back to it on any failure, and runs once however often the script loads.

import { PlacePopulation } from "/base-standard/ui/place-population/model-place-population.js";
import { BuildingPlacementManager } from "/base-standard/ui/building-placement/building-placement-manager.js";
import { InterfaceMode } from "/core/ui/interface-modes/interface-modes.js";
// Loaded for its side effect: it registers the growth screen's handler, which commitPlot is patched on.
import "/base-standard/ui/interface-modes/interface-mode-acquire-tile.js";
import { outerCandidates, placeOuterCitizen } from "/cultural-diffusion/ui/cd-outer-place.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";

const MODE = "INTERFACEMODE_ACQUIRE_TILE";
const MARK = "__cdOuterGrowth";

/** @param {()=>*} fn @param {*} fallback */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** Outer plots offered on the screen now, with the city they were offered for. */
const offered = new Map();

/**
 * The yield change shown when hovering an outer tile, in the shape BuildingPlacementManager's placement data has.
 * GameplayMap.getYieldsWithCity answers [yieldHash, amount] pairs for the tile as the city would work it; on a claimed
 * ring-4 tile it gave Production 1, Culture 3, Happiness 2, the city's own gain a turn after the farm went down
 * (lab, 2026-11-12, probe-history.md). Zeros when it can't be read.
 * @param {number} plotIndex @param {*} cityId
 * @returns {{plotID:number, yieldChanges:number[], changeDetails:*[], overbuiltConstructibleID:number}}
 */
export function outerYieldPreview(plotIndex, cityId) {
  const n = safe(() => GameInfo.Yields.length, 0) || 0;
  const yieldChanges = new Array(n).fill(0);
  const pairs = safe(() => GameplayMap.getYieldsWithCity(plotIndex, cityId), null);
  if (Array.isArray(pairs)) {
    for (const pair of pairs) {
      if (!Array.isArray(pair) || !Number.isFinite(pair[1])) continue;
      for (let i = 0; i < n; i++) {
        if (safe(() => GameInfo.Yields[i].$hash, null) === pair[0]) yieldChanges[i] += pair[1];
      }
    }
  }
  return { plotID: plotIndex, yieldChanges, changeDetails: [], overbuiltConstructibleID: -1 };
}

/**
 * The expand list with this city's outer tiles added after the engine's own.
 * @param {*} model PlacePopulation. @param {*} cityId
 * @returns {number} How many outer tiles were added.
 */
export function appendOuterPlots(model, cityId) {
  for (const [p] of offered) if (isOfferedOuter(p, cityId)) offered.delete(p);
  const city = safe(() => Cities.get(cityId), null);
  if (!city) return 0;
  const have = new Set((model.expandPlots || []).map((e) => e.plotIndex));
  let added = 0;
  for (const p of outerCandidates(city)) {
    if (have.has(p)) continue;
    const loc = safe(() => GameplayMap.getLocationFromIndex(p), null);
    const owner = city.owner ?? cityId.owner;
    const raw = loc ? safe(() => Districts.getFreeConstructible({ x: loc.x, y: loc.y }, owner), null) : null;
    model.expandPlots.push({ plotIndex: p, constructibleType: raw });
    offered.set(p, cityId);
    added++;
  }
  if (added) safe(() => model.ExpandPlotDataUpdatedEvent.trigger(model.expandPlots));
  return added;
}

/** Whether a plot index is an outer tile offered for this city. */
export function isOfferedOuter(plotIndex, cityId) {
  const c = offered.get(plotIndex);
  return !!c && safe(() => c.id === cityId.id && c.owner === cityId.owner, false);
}

function patchModel() {
  if (PlacePopulation[MARK]) return;
  const original = PlacePopulation.updateExpandPlots;
  if (typeof original !== "function") return;
  PlacePopulation.updateExpandPlots = function (id) {
    const r = original.call(this, id);
    try {
      if (!this.isResettling) appendOuterPlots(this, id);
    } catch (e) {
      dlog(`outer growth: list patch threw ${String(e)}`);
    }
    return r;
  };
  PlacePopulation[MARK] = true;
}

function patchPreview() {
  const bpm = BuildingPlacementManager;
  if (!bpm || bpm[MARK] || typeof bpm.getImprovementYieldChanges !== "function") return;
  const original = bpm.getImprovementYieldChanges;
  bpm.getImprovementYieldChanges = function (type, plotIndex) {
    let r;
    try {
      r = original.call(this, type, plotIndex);
    } catch (_) {
      r = undefined;
    }
    if (r || !offered.has(plotIndex)) return r;
    return safe(() => outerYieldPreview(plotIndex, offered.get(plotIndex)), r);
  };
  bpm[MARK] = true;
}

/** After an outer placement: refresh the screen the way a native one does, or leave it when nobody is waiting. */
function settleScreen(handler, cityId) {
  const ready = safe(() => Cities.get(cityId).Growth.isReadyToPlacePopulation, false);
  if (ready && typeof handler.updatePlotOverlay === "function") {
    safe(() => handler.updatePlotOverlay());
  } else if (safe(() => InterfaceMode.getCurrent(), "") === MODE) {
    safe(() => InterfaceMode.switchToDefault());
  }
  handler.isPlotProposed = false;
}

function patchHandler() {
  const handler = safe(() => InterfaceMode.getInterfaceModeHandler(MODE), null);
  if (!handler || handler[MARK] || typeof handler.commitPlot !== "function") return false;
  const original = handler.commitPlot;
  handler.commitPlot = function (plot) {
    const context = safe(() => this.Context, null);
    const cityId = context && !context.UnitID ? context.CityID : null;
    const index = safe(() => GameplayMap.getIndexFromLocation(plot), -1);
    if (!cityId || !isOfferedOuter(index, cityId)) return original.call(this, plot);
    const type = safe(() => PlacePopulation.addImprovementType, "");
    safe(() => UI.sendAudioEvent(type ? "placement-activate-" + type : "placement-activate"));
    placeOuterCitizen(cityId, { x: plot.x, y: plot.y }).then((res) => {
      dlog(`outer growth: ${plot.x},${plot.y} ${res.reason}`);
      settleScreen(this, cityId);
    }, (e) => {
      dlog(`outer growth: placement threw ${String(e)}`);
      settleScreen(this, cityId);
    });
    return undefined;
  };
  handler[MARK] = true;
  return true;
}

function install() {
  safe(patchModel);
  safe(patchPreview);
  // The handler registers when its own module loads; try now and again once the engine is ready.
  if (!safe(patchHandler, false)) {
    safe(() => engine.whenReady.then(() => {
      if (!safe(patchHandler, false)) setTimeout(() => safe(patchHandler, false), 1000);
    }));
  }
}

install();
