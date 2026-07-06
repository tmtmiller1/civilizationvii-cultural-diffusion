// cd-probe-api.js
//
// Thin, single-player-guarded wrappers around the plot-ownership engine calls the
// Cultural Diffusion mod would use. This is the ONE place the probe touches the
// engine, so any API drift is a one-file fix. All calls are verified against the
// shipping 1.4.1 UI and the published cheat panels:
//   - WorldBuilder.MapPlots.setOwnership(playerId, {x,y})   (base tuner-input.js:96,206)
//   - city.purchasePlot({x,y})                               (tuner City-panel PurchasePlot)
//   - Game.CityCommands.canStart/sendRequest(id, EXPAND, {X,Y})  (native adjacency grow)
//   - GameplayMap.getOwningCityFromXY(x,y) -> city ComponentID   (emigration-events.js)
//   - GameplayMap.getPlotIndicesInRadius / getLocationFromIndex  (radius enumeration)
//
// Ambient engine globals (Players, Cities, Game, GameContext, GameplayMap,
// WorldBuilder, Configuration, UI, PlayerIds) are provided by the UI isolate and
// need no import.

import { emitLine } from "./cd-probe-emit.js";

const LOG = (...a) => emitLine(`api: ${a.join(" ")}`);

function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

// --- Single-player guard (same detection as the cheat panel) --------------
export function isMultiplayer() {
  return safe(() => {
    const cfg = (typeof Configuration !== "undefined") ? Configuration.getGame?.() : null;
    if (cfg) {
      if (typeof cfg.isAnyMultiplayer === "boolean") return cfg.isAnyMultiplayer;
      return !!(cfg.isNetworkMultiplayer || cfg.isHotseat);
    }
    if (typeof UI !== "undefined" && typeof UI.isMultiplayer === "function") return UI.isMultiplayer();
    return false;
  }, false);
}

export function guardSP() {
  if (isMultiplayer()) { LOG("blocked - multiplayer game"); return false; }
  return true;
}

export function localPlayerId() {
  return safe(() => GameContext.localPlayerID, -1);
}

// --- Reads ----------------------------------------------------------------

// Owning city ComponentID at a plot (null if unowned, undefined if unavailable).
export function owningCityIdAt(loc) {
  return safe(() => {
    if (typeof GameplayMap === "undefined" || !GameplayMap.getOwningCityFromXY) return undefined;
    const c = GameplayMap.getOwningCityFromXY(loc.x, loc.y);
    return c ? c.id : null;
  }, undefined);
}

// Owning player id at a plot, if the engine exposes it (fallback: -1/undefined).
export function owningPlayerIdAt(loc) {
  return safe(() => {
    if (typeof GameplayMap === "undefined") return undefined;
    if (typeof GameplayMap.getOwner === "function") return GameplayMap.getOwner(loc.x, loc.y);
    return undefined;
  }, undefined);
}

export function mapDims() {
  return safe(() => {
    const w = GameplayMap?.getGridWidth?.();
    const h = GameplayMap?.getGridHeight?.();
    return (typeof w === "number" && typeof h === "number") ? { w, h } : null;
  }, null);
}

// All plot {x,y} within `r` rings of a center, using the verified index helpers.
export function plotsInRadius(center, r) {
  return safe(() => {
    if (!GameplayMap?.getPlotIndicesInRadius) return [];
    const idxs = GameplayMap.getPlotIndicesInRadius(center.x, center.y, r) || [];
    const out = [];
    for (const idx of idxs) {
      const loc = GameplayMap.getLocationFromIndex?.(idx);
      if (loc && typeof loc.x === "number") out.push({ x: loc.x, y: loc.y });
    }
    return out;
  }, []);
}

// A compact yield/worked snapshot for a plot, so the probe can compare owner state
// before/after a flip (Q-YIELD). All reads are defensive - a build that renames one
// field degrades to null, never throws.
export function plotSnapshot(loc) {
  return {
    loc,
    owningCity: owningCityIdAt(loc),
    owner: owningPlayerIdAt(loc),
    isWater: safe(() => GameplayMap?.isWater?.(loc.x, loc.y), null),
    resource: safe(() => GameplayMap?.getResourceType?.(loc.x, loc.y), null),
    district: safe(() => GameplayMap?.getDistrictType?.(loc.x, loc.y), null),
    revealed: safe(() => {
      const pid = localPlayerId();
      return GameplayMap?.getRevealedState?.(pid, loc.x, loc.y);
    }, null),
  };
}

// --- Local-player cities ----------------------------------------------------

export function localCities() {
  return safe(() => {
    const p = Players?.get?.(localPlayerId());
    return p?.Cities?.getCities?.() || [];
  }, []);
}

export function cityLoc(city) {
  return safe(() => {
    const loc = city?.location;
    return (loc && typeof loc.x === "number") ? { x: loc.x, y: loc.y } : null;
  }, null);
}

// --- The flip verbs (the whole point of the probe) --------------------------

// Q-BEYOND-CAP: how many plots the city can claim RIGHT NOW via native EXPAND.
// EXPAND only offers plots while city.Growth.isReadyToPlacePopulation, so a value
// of 0 for a settled city is expected - that is exactly the "normal cap" the mod
// wants to exceed by other means.
export function expandPlotCount(city) {
  return safe(() => {
    const cityID = city?.id;
    if (!cityID) return 0;
    const cmd = (typeof CityCommandTypes !== "undefined") ? CityCommandTypes.EXPAND : "EXPAND";
    const res = Game.CityCommands?.canStart?.(cityID, cmd, {}, false);
    return (res && res.Plots) ? res.Plots.length : 0;
  }, 0);
}

// Verb A - WorldBuilder hard flip. Repaints owner; may be cosmetic (Q-YIELD).
export function flipViaSetOwnership(playerId, loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    if (typeof WorldBuilder === "undefined" || !WorldBuilder.MapPlots?.setOwnership) {
      return { ok: false, reason: "no-api" };
    }
    WorldBuilder.MapPlots.setOwnership(playerId, loc);
    return { ok: true, reason: "called" };
  }, { ok: false, reason: "throw" });
}

// Verb B - city.purchasePlot. The integrated, city-attached path.
export function flipViaPurchasePlot(cityOrId, loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const city = (cityOrId && typeof cityOrId.purchasePlot === "function")
      ? cityOrId : Cities?.get?.(cityOrId);
    if (!city || typeof city.purchasePlot !== "function") return { ok: false, reason: "no-api" };
    city.purchasePlot(loc);
    return { ok: true, reason: "called" };
  }, { ok: false, reason: "throw" });
}

// --- Integration reads (Q-INTEGRATE / Q-CODEX): is a flipped tile REAL city land? -----
//
// The open question the original probe left unanswered (spec Q-YIELD caveat): does a
// bare `setOwnership` flip produce an INTEGRATED city tile (attached to a living city,
// buildable) or an ORPHAN tile (owner set, but no owning city, inert)? This matters
// because the Han Shi Dafu codex - and every "owned-tile" ability - behaves completely
// differently in the two worlds. These reads settle it, hands-off.

// Plot index for a {x,y} (the id used inside city plot lists / canStart .Plots).
export function plotIndex(loc) {
  return safe(() => {
    if (typeof GameplayMap?.getIndexFromLocation !== "function") return -1;
    const i = GameplayMap.getIndexFromLocation(loc);
    return typeof i === "number" ? i : -1;
  }, -1);
}

// The owning city's ComponentID at a plot (the object canStart wants), or null.
// Unowned reads back as a ComponentID with id === -1, so we normalize that to null.
export function owningCityCID(loc) {
  return safe(() => {
    if (typeof GameplayMap?.getOwningCityFromXY !== "function") return null;
    const c = GameplayMap.getOwningCityFromXY(loc.x, loc.y);
    if (!c) return null;
    const idNum = (typeof c.id === "number") ? c.id : (c.id && typeof c.id.id === "number" ? c.id.id : null);
    if (idNum == null || idNum === -1) return null;
    return c;
  }, null);
}

// Every plot index a city owns (culturally-grown + bought). Legacy name; it frames the
// whole city in the base UI's city-zoomer, i.e. it is the full owned set, not gold-only.
export function purchasedPlots(city) {
  return safe(() => {
    const p = city?.getPurchasedPlots?.();
    return Array.isArray(p) ? p : [];
  }, []);
}

// $index of a constructible type (e.g. "BUILDING_LIBRARY"), or -1 if absent on this build.
export function constructibleIndex(typeName) {
  return safe(() => {
    const def = GameInfo?.Constructibles?.lookup?.(typeName);
    return (def && typeof def.$index === "number") ? def.$index : -1;
  }, -1);
}

// The valid placement plots for a constructible in a city (the BUILD op the production
// screen uses). { success, plots:[plotIndex,...] }. If plots includes our flipped tile,
// the player can actually build that thing there - i.e. develop science on diffused land.
export function buildablePlots(cityCID, constructibleIdx) {
  return safe(() => {
    if (constructibleIdx < 0 || !cityCID) return { success: false, plots: [] };
    if (typeof Game?.CityOperations?.canStart !== "function") return { success: false, plots: [] };
    const op = (typeof CityOperationTypes !== "undefined") ? CityOperationTypes.BUILD : "BUILD";
    const res = Game.CityOperations.canStart(cityCID, op, { ConstructibleType: constructibleIdx }, false);
    return { success: !!res?.Success, plots: (res && Array.isArray(res.Plots)) ? res.Plots : [] };
  }, { success: false, plots: [] });
}

// Un-claim (return a plot to nobody). Used to restore state after a destructive test.
export function unclaim(loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const NO_PLAYER = (typeof PlayerIds !== "undefined" && PlayerIds.NO_PLAYER != null)
      ? PlayerIds.NO_PLAYER : -1;
    if (!WorldBuilder?.MapPlots?.setOwnership) return { ok: false, reason: "no-api" };
    WorldBuilder.MapPlots.setOwnership(NO_PLAYER, loc);
    return { ok: true, reason: "called" };
  }, { ok: false, reason: "throw" });
}

// Presence report - which primitives even exist on this build.
export function apiPresence() {
  return {
    setOwnership: safe(() => typeof WorldBuilder?.MapPlots?.setOwnership === "function", false),
    getOwningCityFromXY: safe(() => typeof GameplayMap?.getOwningCityFromXY === "function", false),
    getOwner: safe(() => typeof GameplayMap?.getOwner === "function", false),
    getPlotIndicesInRadius: safe(() => typeof GameplayMap?.getPlotIndicesInRadius === "function", false),
    cityCommands: safe(() => typeof Game?.CityCommands?.canStart === "function", false),
    purchasePlot: safe(() => {
      const c = localCities()[0];
      return !!c && typeof c.purchasePlot === "function";
    }, false),
    worldBuilder: safe(() => typeof WorldBuilder !== "undefined", false),
  };
}

export { LOG };
