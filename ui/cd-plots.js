// cd-plots.js
//
// All GameplayMap reads the diffusion engine needs. Every read is defensive: an unreadable engine
// call degrades to a neutral value and never throws into the pass. The verbs that MUTATE ownership
// live in cd-ownership.js. An UNOWNED plot returns getOwner() === -1 and getOwningCityFromXY().id === -1.

const NO_OWNER = -1;

/**
 * @param {()=>*} fn Thunk.
 * @param {*} fallback Fallback.
 * @returns {*} fn() or fallback on throw.
 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @returns {number} The local (human) player id, or -1. */
export function localPlayerId() {
  return safe(() => {
    const id = GameContext?.localPlayerID;
    return typeof id === "number" ? id : NO_OWNER;
  }, NO_OWNER);
}

/** @returns {boolean} True when this is any multiplayer game (diffusion is single-player only). */
export function isMultiplayer() {
  return safe(() => !!Configuration?.getGame?.()?.isAnyMultiplayer, false);
}

/** @returns {{w:number, h:number}} Map grid dimensions (0x0 if unavailable). */
export function mapDims() {
  return safe(() => ({
    w: GameplayMap?.getGridWidth?.() || 0,
    h: GameplayMap?.getGridHeight?.() || 0
  }), { w: 0, h: 0 });
}

/**
 * The owning player id at a plot, or -1 when unowned/unavailable.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {number} Owner player id (-1 = none).
 */
export function ownerAt(loc) {
  return safe(() => {
    if (typeof GameplayMap?.getOwner !== "function") return NO_OWNER;
    const o = GameplayMap.getOwner(loc.x, loc.y);
    return typeof o === "number" ? o : NO_OWNER;
  }, NO_OWNER);
}

/**
 * The owning city's numeric id at a plot, or -1 when unowned/unavailable.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {number} City id (-1 = none).
 */
export function owningCityIdAt(loc) {
  return safe(() => {
    if (typeof GameplayMap?.getOwningCityFromXY !== "function") return NO_OWNER;
    const c = GameplayMap.getOwningCityFromXY(loc.x, loc.y);
    const id = c && c.id;
    if (typeof id === "number") return id;
    if (id && typeof id.id === "number") return id.id;
    return NO_OWNER;
  }, NO_OWNER);
}

/**
 * True when a plot is unowned (empty frontier land).
 * @param {{x:number,y:number}} loc Plot.
 * @returns {boolean} Whether nobody owns it.
 */
export function isUnowned(loc) {
  const owner = ownerAt(loc);
  const city = owningCityIdAt(loc);
  return owner < 0 || city < 0;
}

/**
 * True when a plot is water (diffusion targets land only).
 * @param {{x:number,y:number}} loc Plot.
 * @returns {boolean} Whether it is water.
 */
export function isWater(loc) {
  return safe(() => !!GameplayMap?.isWater?.(loc.x, loc.y), false);
}

/**
 * True when a plot cannot be entered by a land unit at all (mountains and anything else the engine calls
 * impassable). Water has its own read; this is the terrain that blocks movement without being sea.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {boolean} Whether the plot is impassable.
 */
export function isImpassable(loc) {
  return safe(() => {
    if (typeof GameplayMap?.isImpassable === "function") return !!GameplayMap.isImpassable(loc.x, loc.y);
    return !!GameplayMap?.isMountain?.(loc.x, loc.y);
  }, false);
}

/**
 * True when a plot lies in the given player's DISTANT LANDS (the far hemisphere - only reachable
 * from the Exploration age). Base-game Player method: Players.get(pid).isDistantLands({x,y}).
 * Fails OPEN (false = treat as home lands) when unreadable, so a missing API never over-blocks.
 * @param {number} playerId Player id.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {boolean} Whether the plot is distant lands for that player.
 */
export function isDistantLands(playerId, loc) {
  return safe(() => {
    const p = Players?.get?.(playerId);
    return !!(p && typeof p.isDistantLands === "function" && p.isDistantLands({ x: loc.x, y: loc.y }));
  }, false);
}

/**
 * The district type NAME at a plot ("DISTRICT_CITY_CENTER" / "DISTRICT_URBAN" / "DISTRICT_RURAL"), or
 * null. `getDistrictType` returns a numeric enum, so it is resolved through GameInfo.Districts.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {string|null} District type name, or null when unreadable.
 */
export function districtTypeNameAt(loc) {
  return safe(() => {
    const t = GameplayMap?.getDistrictType?.(loc.x, loc.y);
    if (t == null) return null;
    if (typeof t === "string") return t;
    return GameInfo?.Districts?.lookup?.(t)?.DistrictType || null;
  }, null);
}

/**
 * Whether a SETTLEMENT CENTER sits on this plot, read straight off the MAP rather than from a player's
 * city list. That distinction matters: an Independent Power reports NO cities through
 * `Players.get(pid).Cities.getCities()` (watched, harness runs 15-17), so anything that finds centers by
 * walking a city list is blind to a village. Three routes, because none is available everywhere:
 * `Cities.getAtLocation`, the owning city's own location, then the district type.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {boolean} True when a settlement center occupies the plot.
 */
export function isCityCenterAt(loc) {
  if (safe(() => !!Cities?.getAtLocation?.(loc.x, loc.y), false)) return true;
  const at = owningCityLocAt(loc);
  if (at && at.x === loc.x && at.y === loc.y) return true;
  return /CITY_CENTER/.test(districtTypeNameAt(loc) || "");
}

/**
 * The location of the city that owns a plot, or null. Read through `Cities.get` when the map hands back
 * a ComponentID rather than a city object.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {{x:number,y:number}|null} The owning city's own plot.
 */
function owningCityLocAt(loc) {
  return safe(() => {
    const cid = GameplayMap?.getOwningCityFromXY?.(loc.x, loc.y);
    if (!cid) return null;
    const city = safe(() => Cities?.get?.(cid), null) || cid;
    const at = city && city.location;
    return at && typeof at.x === "number" ? { x: at.x, y: at.y } : null;
  }, null);
}

/**
 * The plots within hex-radius `r` of a center, as {x,y} locations.
 * @param {{x:number,y:number}} center Center plot.
 * @param {number} r Radius in rings.
 * @returns {{x:number,y:number}[]} Plot locations (never null).
 */
export function plotsInRadius(center, r) {
  return safe(() => {
    const idx = GameplayMap?.getPlotIndicesInRadius?.(center.x, center.y, r);
    if (!Array.isArray(idx)) return [];
    /** @type {{x:number,y:number}[]} */
    const out = [];
    for (const i of idx) {
      const loc = GameplayMap?.getLocationFromIndex?.(i);
      if (loc && typeof loc.x === "number") out.push({ x: loc.x, y: loc.y });
    }
    return out;
  }, []);
}

/**
 * The {x,y} location of a city (or null).
 * @param {*} city City object.
 * @returns {{x:number,y:number}|null} Location.
 */
export function cityLoc(city) {
  return safe(() => {
    const loc = city?.location;
    return loc && typeof loc.x === "number" ? { x: loc.x, y: loc.y } : null;
  }, null);
}

/**
 * The numeric id of a city (best-effort across ComponentID shapes).
 * @param {*} city City object.
 * @returns {number} City id, or -1.
 */
export function cityIdOf(city) {
  return safe(() => {
    const id = city?.id;
    if (typeof id === "number") return id;
    if (id && typeof id.id === "number") return id.id;
    return NO_OWNER;
  }, NO_OWNER);
}

/**
 * Append one alive player's cities to `out` as {city, owner, isCityState} rows, honoring the
 * city-state filter. Kept separate so allSettlements stays flat.
 * @param {*} player Engine player.
 * @param {boolean} includeCityStates Whether minors are included.
 * @param {{city:*, owner:number, isCityState:boolean}[]} out Accumulator.
 */
function collectPlayerCities(player, includeCityStates, out) {
  if (!player || !player.isAlive) return;
  const isCityState = player.isMajor === false || player.isMinor === true;
  if (isCityState && !includeCityStates) return;
  const cities = safe(() => player.Cities?.getCities?.(), null);
  if (!cities) return;
  const owner = typeof player.id === "number" ? player.id : NO_OWNER;
  for (const city of cities) out.push({ city, owner, isCityState });
}

/**
 * Every alive major (and optionally minor) player's cities as a flat list of
 * {city, owner, isCityState} rows.
 * @param {boolean} includeCityStates Whether to include minors.
 * @returns {{city:*, owner:number, isCityState:boolean}[]} Rows.
 */
export function allSettlements(includeCityStates) {
  return safe(() => {
    const alive = Players?.getAlive?.();
    if (!Array.isArray(alive)) return [];
    /** @type {{city:*, owner:number, isCityState:boolean}[]} */
    const out = [];
    for (const player of alive) collectPlayerCities(player, includeCityStates, out);
    return out;
  }, []);
}

export { NO_OWNER };
