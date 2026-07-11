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
  const d = districtAt(loc);
  return {
    loc,
    owningCity: owningCityIdAt(loc),
    owner: owningPlayerIdAt(loc),
    isWater: safe(() => GameplayMap?.isWater?.(loc.x, loc.y), null),
    resource: safe(() => GameplayMap?.getResourceType?.(loc.x, loc.y), null),
    district: safe(() => GameplayMap?.getDistrictType?.(loc.x, loc.y), null),
    // (D) developed-state: how many constructibles sit here + who owns the district. A
    // rival flip that keeps constructibleCount>0 and flips districtOwner to us = the tile
    // came across DEVELOPED, not stripped.
    constructibleCount: safe(() => constructiblesAt(loc).length, null),
    districtOwner: d.owner,
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

// --- Q-WORK: can a BEYOND-RING-3 owned tile be worked / settled? ----------------
//
// The deciding rules live in native C++ (no JS/DB work-range constant), so the only way
// to know is to ASK the engine at runtime. canStart(...) is READ-ONLY - it returns
// {Success, Plots, ...} without mutating - so most of Q-WORK is answered safely, before
// any destructive placement. See docs/future-features.md 3.

// Plot index for a {x,y} via the XY converter (the shape GetTilePlacementInfo wants).
export function plotIndexXY(loc) {
  return safe(() => {
    const i = GameplayMap?.getIndexFromXY?.(loc.x, loc.y);
    return typeof i === "number" ? i : -1;
  }, -1);
}

// READ-ONLY: would the engine let the local player assign a worker onto this plot?
// The make-or-break (1c) signal - true on a far owned tile => the outer ring is workable.
export function canAssignWorker(playerId, plotIdx) {
  return safe(() => {
    if (plotIdx < 0 || typeof Game?.PlayerOperations?.canStart !== "function") return { success: false, reason: "no-api" };
    const op = (typeof PlayerOperationTypes !== "undefined") ? PlayerOperationTypes.ASSIGN_WORKER : "ASSIGN_WORKER";
    const res = Game.PlayerOperations.canStart(playerId, op, { Location: plotIdx, Amount: 1 }, false);
    return { success: !!res?.Success, reasons: res?.FailureReasons || null };
  }, { success: false, reason: "throw" });
}

// READ-ONLY: is this plot index in the owning city's EXPAND-claimable set? (settle test, 1a)
export function expandPlotsInclude(cityCID, plotIdx) {
  return safe(() => {
    if (plotIdx < 0 || !cityCID || typeof Game?.CityCommands?.canStart !== "function") return { success: false, includes: false, count: 0 };
    const cmd = (typeof CityCommandTypes !== "undefined") ? CityCommandTypes.EXPAND : "EXPAND";
    const res = Game.CityCommands.canStart(cityCID, cmd, {}, false);
    const plots = (res && Array.isArray(res.Plots)) ? res.Plots : [];
    return { success: !!res?.Success, includes: plots.indexOf(plotIdx) >= 0, count: plots.length };
  }, { success: false, includes: false, count: 0 });
}

// READ-ONLY: per-tile worker placement info (IsBlocked = not workable right now).
export function tilePlacement(city, plotIdx) {
  return safe(() => {
    if (plotIdx < 0 || typeof city?.Workers?.GetTilePlacementInfo !== "function") return null;
    const info = city.Workers.GetTilePlacementInfo(plotIdx);
    if (!info) return null;
    return { isBlocked: !!info.IsBlocked, numWorkers: info.NumWorkers ?? null, maxWorkers: info.MaxWorkers ?? null };
  }, null);
}

// READ-ONLY: a plot's yields AS WORKED BY a given city - the "is it actually productive" read.
export function yieldsWithCity(loc, cityCID) {
  return safe(() => {
    if (!cityCID || typeof GameplayMap?.getYieldsWithCity !== "function") return null;
    const y = GameplayMap.getYieldsWithCity(loc.x, loc.y, cityCID);
    if (y == null) return null;
    if (typeof y === "number") return { total: y };
    // Array/obj of per-yield values -> sum defensively.
    let total = 0;
    try { for (const v of (Array.isArray(y) ? y : Object.values(y))) if (typeof v === "number") total += v; } catch (_) { /* ignore */ }
    return { total, raw: y };
  }, null);
}

// READ-ONLY: constructibles on a plot (a placed rural district is the worked improvement).
export function constructiblesAt(loc) {
  return safe(() => {
    if (typeof MapConstructibles?.getConstructibles !== "function") return [];
    const c = MapConstructibles.getConstructibles(loc.x, loc.y);
    return Array.isArray(c) ? c : [];
  }, []);
}

// DESTRUCTIVE (opt-in): actually assign a worker onto the plot (confirms the read above).
export function assignWorker(playerId, plotIdx) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    if (plotIdx < 0 || typeof Game?.PlayerOperations?.sendRequest !== "function") return { ok: false, reason: "no-api" };
    const op = (typeof PlayerOperationTypes !== "undefined") ? PlayerOperationTypes.ASSIGN_WORKER : "ASSIGN_WORKER";
    const chk = Game.PlayerOperations.canStart(playerId, op, { Location: plotIdx, Amount: 1 }, false);
    if (!chk?.Success) return { ok: false, reason: "canStart-false" };
    Game.PlayerOperations.sendRequest(playerId, op, { Location: plotIdx, Amount: 1 });
    return { ok: true, reason: "called" };
  }, { ok: false, reason: "throw" });
}

// DESTRUCTIVE (opt-in): create a worked rural district bound to a city (map-cheat verb).
// NOTE: Game.PlayerOperations.sendRequest is FIRE-AND-FORGET - it returns void, so its return
// value is NOT a success signal (reading res.Success always yields false, the "op-failed" red
// herring seen in the 2026-07-09 run even when the district actually placed). The authoritative
// check is a DEFERRED re-read of constructiblesAt(loc); here we only report that the request was
// dispatched without throwing.
export function createRuralDistrict(loc, ownerId, cityCID) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    if (typeof Game?.PlayerOperations?.sendRequest !== "function") return { ok: false, reason: "no-api" };
    const args = { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: loc, Owner: ownerId };
    if (cityCID) args.Parent = cityCID;
    Game.PlayerOperations.sendRequest(0, "CREATE_ELEMENT", args);
    return { ok: true, reason: "sent" };
  }, { ok: false, reason: "throw" });
}

// READ-ONLY (C): a city's specialist/worker cap and current worker count - so we can see
// whether working a far tile CONSUMES the city's cap (the feedback-loop brake).
export function cityWorkerCap(city) {
  return safe(() => {
    const cap = city?.Workers?.getCityWorkerCap?.();
    return typeof cap === "number" ? cap : null;
  }, null);
}
export function cityNumWorkers(city) {
  return safe(() => {
    const n = city?.Workers?.getNumWorkers?.(false);
    return typeof n === "number" ? n : null;
  }, null);
}

// READ-ONLY: the owning city's CENTER location for a plot, or null.
export function ownerCityCenter(loc) {
  return safe(() => {
    const cid = owningCityCID(loc);
    if (!cid) return null;
    const city = Cities?.get?.(cid);
    const l = city?.location;
    return (l && typeof l.x === "number") ? { x: l.x, y: l.y } : null;
  }, null);
}

// READ-ONLY: hex distance between two plots (engine metric).
export function plotDistanceXY(a, b) {
  return safe(() => {
    if (typeof GameplayMap?.getPlotDistance === "function") return GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y);
    return -1;
  }, -1);
}

// READ-ONLY: how DEEP a plot sits inside its OWNER's footprint (rings from that city's
// center). 1 = core ring, <=3 = inside the normal worked footprint, >3 = the owner's
// frontier. Answers "is this a rival FRONTIER tile or one INSIDE their 3-ring?".
export function ownerRingDepth(loc) {
  const center = ownerCityCenter(loc);
  if (!center) return -1;
  return plotDistanceXY(loc, center);
}

// READ-ONLY (D): the district on a plot + its owner (map-cheat used MapCities.getDistrict).
// Lets us tell whether a captured rival tile keeps its improvement (transferred to us) or
// is stripped to bare land.
export function districtAt(loc) {
  return safe(() => {
    const d = (typeof MapCities?.getDistrict === "function") ? MapCities.getDistrict(loc.x, loc.y) : null;
    if (!d) return { present: false, owner: null, type: null };
    const owner = (typeof d.owner === "number") ? d.owner : (d.owner?.id ?? null);
    return { present: true, owner, type: d.type ?? null };
  }, { present: false, owner: null, type: null });
}

// --- Phase 5: city-center detection + city-transfer DISCOVERY --------------------------------
// There is NO known runtime "cede/annex a city" call (EFFECT_CITY_TRANSFER_OWNER is a DATA
// modifier; WorldBuilder exposes only MapPlots.*; Cities.* are getters). So Phase 5 must DISCOVER
// the API at runtime: detect a city-center tile, reflect the API surface for transfer-ish names,
// and canStart-test (READ-ONLY) any transfer operation before anything destructive is attempted.

// The City object sitting at / owning a plot, or null.
export function cityAt(loc) {
  return safe(() => {
    if (typeof Cities?.getAtLocation === "function") {
      const c = Cities.getAtLocation(loc.x, loc.y);
      if (c) return c;
    }
    const cid = owningCityCID(loc);
    return cid ? (Cities?.get?.(cid) || null) : null;
  }, null);
}

// Is this plot a city CENTER (the settlement core), not just owned territory? A plot is a center
// if a City sits exactly at it, or its district type reads as a city center.
export function isCityCenterAt(loc) {
  return safe(() => {
    if (typeof Cities?.getAtLocation === "function" && Cities.getAtLocation(loc.x, loc.y)) return true;
    const city = cityAt(loc);
    const l = city?.location;
    if (l && l.x === loc.x && l.y === loc.y) return true;
    const dt = GameplayMap?.getDistrictType?.(loc.x, loc.y);
    return typeof dt === "string" ? /CITY_CENTER/.test(dt) : false;
  }, false);
}

// The district type NAME at a plot ("DISTRICT_RURAL" / "DISTRICT_URBAN" / "DISTRICT_CITY_CENTER" /
// ...), resolving the engine's numeric district-type enum to a string so rural-vs-urban capture
// classification works (getDistrictType returns a NUMBER, not a name).
export function districtTypeNameAt(loc) {
  return safe(() => {
    let t = GameplayMap?.getDistrictType?.(loc.x, loc.y);
    if (t == null) t = (typeof MapCities?.getDistrict === "function") ? MapCities.getDistrict(loc.x, loc.y)?.type : null;
    if (t == null) return null;
    if (typeof t === "string") return t;
    const def = GameInfo?.Districts?.lookup?.(t);
    return def?.DistrictType || String(t);
  }, null);
}

// All player ids that currently exist (alive), so Phase 5 can find ANY rival/minor city on the
// known map for its cede-ability discovery, not just one adjacent to us.
export function allPlayerIds() {
  return safe(() => {
    if (typeof Players?.getAlive === "function") {
      const arr = Players.getAlive() || [];
      return arr.map((p) => (typeof p === "number" ? p : (p?.id ?? null))).filter((x) => typeof x === "number");
    }
    const out = [];
    for (let i = 0; i < 64; i += 1) { const p = safe(() => Players?.get?.(i), null); if (p && p.Cities) out.push(i); }
    return out;
  }, []);
}

// major | minor | unknown - so Phase 5 can branch annex (major) vs absorb/disband (minor/city-state).
export function playerKind(pid) {
  return safe(() => {
    const p = Players?.get?.(pid);
    if (!p) return "unknown";
    const read = (k) => (typeof p[k] === "function" ? safe(() => p[k](), undefined) : p[k]);
    if (read("isMinor") === true || read("isIndependent") === true || read("isCityState") === true) return "minor";
    if (read("isMajor") === true) return "major";
    return "unknown";
  }, "unknown");
}

// --- Phase 5 REAL path #2: REVOLT MARKER (base-game CityRevolt) --------------------------------
// Place a hidden marker constructible carrying the CityRevolt modifier on a rival city center; the
// base-game revolt system then transfers the settlement (to an adjacency/culture candidate = us,
// since diffusion has surrounded it). No war, no occupation, works on majors.

// $index of a constructible type name (the Type payload CREATE_ELEMENT wants), or null.
export function constructibleIndexByType(typeName) {
  return safe(() => {
    const def = GameInfo?.Constructibles?.lookup?.(typeName);
    if (def && typeof def.$index === "number") return def.$index;
    return null;
  }, null);
}

// DESTRUCTIVE (opt-in): CREATE_ELEMENT a hidden marker constructible onto a city (incl. an enemy's).
// Base-game CREATE_ELEMENT payload: Kind CONSTRUCTIBLE, Parent=city.id, Owner=city.owner,
// Location=city.location. requesterId drives the op (recipient resolution may be requester-sensitive).
export function createCityMarker(requesterId, city, typeValue) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    if (typeof Game?.PlayerOperations?.sendRequest !== "function" || !city) return { ok: false, reason: "no-api" };
    const args = { Kind: "CONSTRUCTIBLE", Type: typeValue, Location: city.location, Parent: city.id, Owner: city.owner };
    const chk = safe(() => Game.PlayerOperations.canStart(requesterId, "CREATE_ELEMENT", args, false), null);
    Game.PlayerOperations.sendRequest(requesterId, "CREATE_ELEMENT", args);
    return { ok: true, reason: "sent", canStart: (chk && typeof chk.Success === "boolean") ? chk.Success : null };
  }, { ok: false, reason: "throw" });
}

// READ-ONLY: are `me` and `target` at war? (Players.get(me).Diplomacy.isAtWarWith - verified call.)
export function isAtWarWith(me, target) {
  return safe(() => {
    const d = Players?.get?.(me)?.Diplomacy;
    if (!d || typeof d.isAtWarWith !== "function") return null;
    return !!d.isAtWarWith(target);
  }, null);
}

// PlayerOperationTypes keys that look like a diplomatic-action initiator (for war declaration).
export function diplomacyActionOps() {
  return enumMatch("PlayerOperationTypes", /DIPLOMA|DIPLO_|DECLARE_WAR|DIPLOMATIC_ACTION/i);
}

// Op-type enum keys that could OCCUPY/CAPTURE/RAZE a city (a possible "enabler" if the deal path
// won't cede an un-occupied city) - so we can see what city-conquest ops exist on this build.
export function occupyOps() {
  const re = /OCCUP|CAPTUR|RAZE|CONQUER|CITY_.*(CAPTUR|TAKE|SEIZE)|SEIZE|ANNEX|LIBERAT/i;
  return {
    player: enumMatch("PlayerOperationTypes", re),
    city: enumMatch("CityOperationTypes", re),
    cityCommand: enumMatch("CityCommandTypes", re),
    unit: enumMatch("UnitOperationTypes", re),
    unitCommand: enumMatch("UnitCommandTypes", re),
  };
}

// DESTRUCTIVE (opt-in): declare war on `target`. Diplomatic actions are initiated through
// Game.PlayerOperations.sendRequest with the action's Type (research-notes + live call site in
// mod 3616394832). We try each diplomacy-action op type, canStart-gated, with the documented
// arg shape { Amount, Player1, Player2, ID, Type: DIPLOMACY_ACTION_DECLARE_WAR }.
export function declareWar(me, target) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const DAT = (typeof DiplomacyActionTypes !== "undefined") ? DiplomacyActionTypes : {};
    const warType = DAT.DIPLOMACY_ACTION_DECLARE_WAR ?? DAT.DIPLOMACY_ACTION_DECLARE_FORMAL_WAR;
    if (warType == null || typeof Game?.PlayerOperations?.sendRequest !== "function") return { ok: false, reason: "no-api" };
    const args = { Amount: 1, Player1: me, Player2: target, ID: target, Type: warType };
    const ops = diplomacyActionOps().map((o) => o.value);
    for (const op of ops) {
      const chk = safe(() => Game.PlayerOperations.canStart(me, op, args, false), null);
      if (chk && chk.Success) { Game.PlayerOperations.sendRequest(me, op, args); return { ok: true, reason: `sent(${op})` }; }
    }
    if (ops.length) { Game.PlayerOperations.sendRequest(me, ops[0], args); return { ok: true, reason: "sent-nocheck" }; }
    return { ok: false, reason: "no-op-type" };
  }, { ok: false, reason: "throw" });
}

// READ-ONLY: a city's happiness/unrest state - so we can see whether the revolt marker is actually
// applying CityRevolt pressure (unhappiness dropping / unrest turning on) or is inert.
export function cityHappiness(city) {
  return safe(() => {
    const h = city?.Happiness;
    if (!h) return null;
    const num = (v, f) => (typeof v === "number" ? v : (typeof f === "function" ? f.call(h) : null));
    return {
      value: num(h.Value, h.getValue),
      unhappiness: (typeof h.getUnhappiness === "function") ? safe(() => {
        const u = h.getUnhappiness();
        if (u == null) return null;
        if (typeof u === "number") return u;
        try { return JSON.stringify(u).slice(0, 120); } catch (_) { return String(u); }
      }, null) : null,
      hasUnrest: (typeof h.hasUnrest === "boolean") ? h.hasUnrest : (typeof h.hasUnrest === "function" ? !!h.hasUnrest() : null),
      turnsOfUnrest: num(h.turnsOfUnrest, h.getTurnsOfUnrest),
      netPerTurn: num(h.netHappinessPerTurn, h.getNetHappinessPerTurn),
    };
  }, null);
}

// The suzerain player id of a minor/city-state (or null). Fealty's default lets you transfer a
// city-state's city only when you're its SUZERAIN, so this says whether a target is takeable.
export function suzerainOf(pid) {
  return safe(() => {
    const inf = Players?.get?.(pid)?.Influence;
    if (!inf || typeof inf.getSuzerain !== "function") return null;
    const s = inf.getSuzerain();
    return (typeof s === "number") ? s : null;
  }, null);
}

// Reflect an object's own + prototype property names matching `re` (transfer-API discovery). Safe:
// name enumeration only, never invokes a getter.
export function reflectNames(obj, re) {
  return safe(() => {
    if (obj == null) return [];
    const out = new Set();
    let o = obj;
    for (let depth = 0; depth < 4 && o && o !== Object.prototype; depth += 1) {
      for (const k of Object.getOwnPropertyNames(o)) { if (re.test(k)) out.add(k); }
      o = Object.getPrototypeOf(o);
    }
    return Array.from(out);
  }, []);
}

// Keys of a global enum object (e.g. PlayerOperationTypes) matching `re`, with their values.
export function enumMatch(enumName, re) {
  return safe(() => {
    const g = (typeof globalThis !== "undefined") ? globalThis : {};
    const e = g[enumName];
    if (!e || typeof e !== "object") return [];
    return Object.keys(e).filter((k) => re.test(k)).map((k) => ({ key: k, value: e[k] }));
  }, []);
}

// READ-ONLY: canStart a candidate city-transfer operation on a target city (no mutation).
export function cityTransferCanStart(scope, pid, opValue, args) {
  return safe(() => {
    const g = (typeof globalThis !== "undefined") ? globalThis : {};
    const api = scope === "player" ? Game?.PlayerOperations : (scope === "city" ? Game?.CityOperations : Game?.CityCommands);
    if (!api || typeof api.canStart !== "function") return { ok: false, reason: "no-api" };
    const res = api.canStart(pid, opValue, args || {}, false);
    return { ok: !!res?.Success, success: !!res?.Success, plots: Array.isArray(res?.Plots) ? res.Plots.length : null, reasons: res?.FailureReasons || null };
  }, { ok: false, reason: "throw" });
}

// DESTRUCTIVE (opt-in): actually send a candidate city-transfer operation. Guarded; only called
// when canStart succeeded and AUTO.CITY_TRANSFER_MUTATE is on.
export function cityTransferSend(scope, pid, opValue, args) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const api = scope === "player" ? Game?.PlayerOperations : (scope === "city" ? Game?.CityOperations : Game?.CityCommands);
    if (!api || typeof api.sendRequest !== "function") return { ok: false, reason: "no-api" };
    api.sendRequest(pid, opValue, args || {});
    return { ok: true, reason: "sent" };
  }, { ok: false, reason: "throw" });
}

// --- Phase 5 REAL path: Game.DiplomacyDeals city cession (the Fealty-mod primitive) --------------
// Cities transfer through the diplomacy DEAL system, and for minor/Independent/city-state owners
// the deal can be FORCE-ACCEPTED (they can't refuse). Flow (base peace-deal panel, verified):
//   dealId = { direction: OUTGOING, player1: me, player2: owner }
//   clearWorkingDeal(dealId) -> getPossibleWorkingDealItems(dealId, owner, CITIES)
//   pick the item whose .cityId matches the target (subType OFFER) -> addItemToWorkingDeal
//   sendWorkingDeal(dealId, ACCEPTED)

// Presence of the DiplomacyDeals surface + the enums the cession needs.
export function diplomacyDealsPresence() {
  return safe(() => {
    const DD = Game?.DiplomacyDeals;
    const has = (m) => !!DD && typeof DD[m] === "function";
    const g = (typeof globalThis !== "undefined") ? globalThis : {};
    const enums = (n) => (g[n] && typeof g[n] === "object") ? Object.keys(g[n]) : [];
    return {
      present: !!DD,
      methods: ["getWorkingDeal", "clearWorkingDeal", "addItemToWorkingDeal", "removeItemFromWorkingDeal",
        "getPossibleWorkingDealItems", "sendWorkingDeal", "getWorkingDealItem"].filter(has),
      cityTransferTypes: enums("DiplomacyDealItemCityTransferTypes"),
      itemTypes: enums("DiplomacyDealItemTypes"),
      proposalActions: enums("DiplomacyDealProposalActions"),
    };
  }, { present: false, methods: [], cityTransferTypes: [], itemTypes: [], proposalActions: [] });
}

// READ-ONLY-ish: builds a SCRATCH working deal (not committed) and enumerates the owner's offerable
// cities, returning the deal item for the target city (or null) + context. clearWorkingDeal only
// resets the scratch deal for this player pair - it doesn't commit anything.
export function cityCedeItem(me, targetOwner, targetCityIdNum, opts) {
  return safe(() => {
    const DD = Game?.DiplomacyDeals;
    if (!DD || typeof DD.getPossibleWorkingDealItems !== "function") return { ok: false, reason: "no-api", item: null, dealId: null };
    const dir = (typeof DiplomacyDealDirection !== "undefined") ? DiplomacyDealDirection.OUTGOING : 0;
    const citiesType = (typeof DiplomacyDealItemTypes !== "undefined") ? DiplomacyDealItemTypes.CITIES : "CITIES";
    const dealId = { direction: dir, player1: me, player2: targetOwner };
    if (typeof DD.clearWorkingDeal === "function") DD.clearWorkingDeal(dealId);
    const items = DD.getPossibleWorkingDealItems(dealId, targetOwner, citiesType) || [];
    const CT = (typeof DiplomacyDealItemCityTransferTypes !== "undefined") ? DiplomacyDealItemCityTransferTypes : {};
    // At war the correct transfer type is CEDE_OCCUPIED (a conquered city ceded); at peace it is
    // OFFER. The war path passes { cede: true } so we prefer/construct a CEDE_OCCUPIED item.
    const want = (opts && opts.cede && CT.CEDE_OCCUPIED != null) ? CT.CEDE_OCCUPIED : (CT.OFFER != null ? CT.OFFER : null);
    const idOf = (d) => (d?.cityId && typeof d.cityId === "object") ? d.cityId.id : d?.cityId;
    let item = items.find((d) => (want == null || d.subType === want) && (targetCityIdNum == null || idOf(d) === targetCityIdNum))
      || items.find((d) => targetCityIdNum == null || idOf(d) === targetCityIdNum) || null;
    let synthetic = false;
    // "Game it": if the engine's enumeration is empty (no offer surfaced), CONSTRUCT the city deal
    // item ourselves so the mutate path can try addItemToWorkingDeal + force-accept anyway.
    if (!item && targetCityIdNum != null && targetCityIdNum >= 0) {
      item = { type: citiesType, subType: want != null ? want : (CT.OFFER ?? CT.CEDE_OCCUPIED ?? 0), cityId: { id: targetCityIdNum } };
      synthetic = true;
    }
    return { ok: true, reason: synthetic ? "synthetic" : "enumerated", dealId, count: items.length, subTypes: items.map((d) => d.subType), item, synthetic, wantSubType: want };
  }, { ok: false, reason: "throw", item: null, dealId: null, synthetic: false });
}

// DESTRUCTIVE (opt-in): add the city item to the working deal and FORCE-ACCEPT it (minor/IP path).
export function sendCityCession(dealId, item) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    const DD = Game?.DiplomacyDeals;
    if (!DD || typeof DD.sendWorkingDeal !== "function") return { ok: false, reason: "no-api" };
    if (item && typeof DD.addItemToWorkingDeal === "function") DD.addItemToWorkingDeal(dealId, item);
    const ACCEPTED = (typeof DiplomacyDealProposalActions !== "undefined") ? DiplomacyDealProposalActions.ACCEPTED : 1;
    DD.sendWorkingDeal(dealId, ACCEPTED);
    return { ok: true, reason: "sent-accepted" };
  }, { ok: false, reason: "throw" });
}

// DESTRUCTIVE (opt-in): city.Growth.claimPlot - attach a plot to a SPECIFIC city.
export function growthClaimPlot(city, loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  return safe(() => {
    if (typeof city?.Growth?.claimPlot !== "function") return { ok: false, reason: "no-api" };
    city.Growth.claimPlot(loc);
    return { ok: true, reason: "called" };
  }, { ok: false, reason: "throw" });
}

// --- Q-VERB: is a claim FREE + INTEGRATED, or does it cost gold? -----------------
// The Phase-0 gate. Read the player's gold balance SYNCHRONOUSLY around each verb call so
// we catch a gold deduction (which is applied at the call), while the ownership/integration
// settles async and is read on a deferred pass. Accessor confirmed in game code:
// Players.get(pid).Treasury.goldBalance.
export function playerGold(pid) {
  return safe(() => {
    const t = Players?.get?.(pid)?.Treasury;
    if (!t) return null;
    if (typeof t.goldBalance === "number") return t.goldBalance;
    if (typeof t.getGoldBalance === "function") return t.getGoldBalance();
    return null;
  }, null);
}

// Grant (amount > 0) or deduct (amount < 0) gold to a player - the WRITE twin of playerGold.
// PREFERS Treasury.changeGoldBalance (a BALANCE-only poke, izica's dev-panel path) over
// Players.grantYield, on purpose: the demographics mod's "Gold Per Turn" metric reads
// Stats.getNetYield(YIELD_GOLD), and grantYield injects into that yield stat (would spike the
// metric), whereas changeGoldBalance only moves the balance and never touches the yield rate.
// So the refund is invisible to BOTH demographics gold metrics (balance nets zero; rate untouched).
// grantYield is only a last-resort fallback if changeGoldBalance is absent on this build.
export function grantGold(pid, amount) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  if (!amount) return { ok: true, reason: "noop-zero" };
  return safe(() => {
    const t = Players?.get?.(pid)?.Treasury;
    if (t && typeof t.changeGoldBalance === "function") { t.changeGoldBalance(amount); return { ok: true, reason: "changeGoldBalance", amount }; }
    if (typeof Players?.grantYield === "function") {
      const yt = (typeof YieldTypes !== "undefined") ? YieldTypes.YIELD_GOLD : undefined;
      if (yt != null) { Players.grantYield(pid, yt, amount); return { ok: true, reason: "grantYield-FALLBACK", amount }; }
    }
    return { ok: false, reason: "no-api" };
  }, { ok: false, reason: "throw" });
}

// READ-ONLY: the player's net GOLD yield-per-turn RATE - the EXACT value the demographics mod's
// "Gold Per Turn" metric reads (Players.get(pid).Stats.getNetYield(YieldTypes.YIELD_GOLD)). The
// refund reads this before/after to PROVE it didn't move the rate metric.
export function netGoldYield(pid) {
  return safe(() => {
    const stats = Players?.get?.(pid)?.Stats;
    if (!stats || typeof stats.getNetYield !== "function") return null;
    const yt = (typeof YieldTypes !== "undefined") ? YieldTypes.YIELD_GOLD : undefined;
    if (yt == null) return null;
    const v = stats.getNetYield(yt);
    return (typeof v === "number") ? v : null;
  }, null);
}

// True when a plot is water (skip - we want clean land targets for the verb test).
export function isWaterAt(loc) {
  return safe(() => !!GameplayMap?.isWater?.(loc.x, loc.y), false);
}

// READ-ONLY: the local player's revealed state for a plot. 0 = hidden (fog, undrawn), 1 =
// revealed (explored, drawn dimmed), 2 = visible. Used to skip fully-hidden tiles so a claim
// lands somewhere the player can actually SEE the border change.
export function revealedStateAt(loc) {
  return safe(() => {
    const pid = localPlayerId();
    const s = GameplayMap?.getRevealedState?.(pid, loc.x, loc.y);
    return typeof s === "number" ? s : null;
  }, null);
}

// --- Q-FOUND: can the owner found a NEW settlement on an owned outer tile? -------
// There is NO settler-free settle-validity read in VII 1.4.1 - founding is gated by a
// SETTLER unit's UNITOPERATION_FOUND_CITY (Game.UnitOperations). So Q-FOUND is
// opportunistic: it works only when the local player has a settler, and it reflects the
// engine's own min-city-range / owned-territory rules.

// A local unit that can found a city (its Units def has FoundCity), or null.
export function localSettlerId() {
  return safe(() => {
    const p = Players?.get?.(localPlayerId());
    const raw = safe(() => p?.Units?.getUnits?.(), null) || safe(() => p?.Units?.getUnitIds?.(), null) || [];
    for (const u of raw) {
      const unit = (u && u.type != null) ? u : safe(() => Units?.get?.(u), null);
      const t = unit?.type;
      const def = (t != null) ? safe(() => GameInfo?.Units?.lookup?.(t), null) : null;
      if (def && (def.FoundCity === true || def.FoundCity === 1)) return unit?.id ?? u;
    }
    return null;
  }, null);
}

// The plot indices where a settler may LEGALLY found right now (engine-gated).
export function settlerFoundPlots(unitId) {
  return safe(() => {
    let plots = [];
    const unit = safe(() => Units?.get?.(unitId), null);
    if (unit && typeof unit.getActivationOperationPlots === "function") {
      const p = unit.getActivationOperationPlots("UNITOPERATION_FOUND_CITY", false);
      if (Array.isArray(p)) plots = p;
    }
    if (!plots.length && typeof Game?.UnitOperations?.canStart === "function") {
      const res = Game.UnitOperations.canStart(unitId, "UNITOPERATION_FOUND_CITY", {}, false);
      if (res && Array.isArray(res.Plots)) plots = res.Plots;
    }
    return plots;
  }, []);
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
    // Q-WORK primitives (making a beyond-ring-3 owned tile usable/worked).
    assignWorker: safe(() => typeof Game?.PlayerOperations?.canStart === "function", false),
    getYieldsWithCity: safe(() => typeof GameplayMap?.getYieldsWithCity === "function", false),
    getTilePlacementInfo: safe(() => {
      const c = localCities()[0];
      return !!c && typeof c.Workers?.GetTilePlacementInfo === "function";
    }, false),
    growthClaimPlot: safe(() => {
      const c = localCities()[0];
      return !!c && typeof c.Growth?.claimPlot === "function";
    }, false),
    mapConstructibles: safe(() => typeof MapConstructibles?.getConstructibles === "function", false),
    playerOpsCreateElement: safe(() => typeof Game?.PlayerOperations?.sendRequest === "function", false),
  };
}

export { LOG };
