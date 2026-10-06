// cd-teardown.js
//
// How an improved tile changes hands without damaging the save. `city.purchasePlot` on a tile that still carries a
// rural district destroys the district and its improvement, leaves the plot pointing at a district record for the
// buyer that is never completed, and a game that has collected enough of those crashes natively in the next age's
// setup (AsyncWorker1, null read through an id list). Rebuilding the tile afterwards does not undo that; the damage is
// done inside the purchase. Tearing the district down first does: the plot is demolished with the engine's own
// DESTROY_ELEMENT (constructibles, then the district), bought once the teardown shows on the map, and then the
// district and the original improvement are recreated for the new owner, so a farm arrives as a farm. Watched
// 2026-10-06 on game 1.5.0 (devtools/harness/cdh-game-flipfix*.js): 56 and 55 such flips through the Antiquity
// transition with no crash, every tile keeping its improvement; the same count of plain purchases, or purchases
// followed by a rebuild, crashed it.
//
// Leaf module: no import from the pass. The caller supplies the buy (cd-ownership's refunded purchasePlot) so the
// gold handling stays in one place. Everything here is fire-and-forget like every gameplay write; the chain reports
// what it saw through the returned promise, which only the harness and the tests read.

/** @param {()=>*} fn Thunk. @param {*} fallback @returns {*} fn() or fallback. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @returns {number} The id that sends PlayerOperations: the local player (the engine gates the op to it). */
function sender() {
  return safe(() => GameContext.localPlayerID, -1);
}

/**
 * What stands on a plot, read straight off the map.
 * @param {{x:number,y:number}} loc Plot.
 * @returns {{districtId:*, districtType:string|null, resolvable:boolean, constructibles:PlotConstructible[]}}
 *   `districtId` is what `MapCities.getDistrict` holds (null when none); `resolvable` whether `Districts.get` knows
 *   it (false = the half-made record a plain purchase leaves); `districtType` "RURAL" / "URBAN" / "CITY_CENTER" /
 *   "WILDERNESS" or null.
 */
/** @typedef {{id:*, type:string, index:number, cls:string}} PlotConstructible */
export function plotInventory(loc) {
  const districtId = safe(() => MapCities.getDistrict(loc.x, loc.y), null) || null;
  const district = districtId ? safe(() => Districts.get(districtId), null) : null;
  let districtType = null;
  if (district && typeof DistrictTypes !== "undefined") {
    for (const k of Object.keys(DistrictTypes)) {
      if (DistrictTypes[k] === district.type) districtType = k;
    }
  }
  const constructibles = safe(() => (MapConstructibles.getConstructibles(loc.x, loc.y) || []).map((id) => {
    const inst = Constructibles.getByComponentID(id);
    const def = inst ? GameInfo.Constructibles.lookup(inst.type) : null;
    return { id, type: def ? def.ConstructibleType : "?", index: def ? def.$index : -1, cls: def ? def.ConstructibleClass : "?" };
  }), []);
  return { districtId, districtType, resolvable: !!district, constructibles };
}

/**
 * Why a tile must not change hands by culture at all: an urban district, a city center, or a wonder. Culture moves
 * rural land; buildings and wonders stay with their city.
 * @param {ReturnType<typeof plotInventory>} inv Plot inventory.
 * @returns {string|null} A short reason, or null when the tile may move.
 */
export function flipRefusedFor(inv) {
  if (inv.districtType === "URBAN" || inv.districtType === "CITY_CENTER") return "district-" + inv.districtType.toLowerCase();
  if (inv.constructibles.some((c) => c.cls === "WONDER")) return "wonder";
  return null;
}

/**
 * Whether the plot carries anything the purchase would mangle: a district record (whole or half-made) or any
 * constructible.
 * @param {ReturnType<typeof plotInventory>} inv Plot inventory.
 * @returns {boolean} True when the flip must tear down first.
 */
export function needsTeardown(inv) {
  return !!inv.districtId || inv.constructibles.length > 0;
}

/**
 * Demolish what stands on the plot with the engine's own DESTROY_ELEMENT: every constructible, then the district,
 * by the id the map holds (a half-made record is destroyed by its id too).
 * @param {ReturnType<typeof plotInventory>} inv Plot inventory.
 * @returns {number} How many requests were sent.
 */
export function teardown(inv) {
  let sent = 0;
  const ops = safe(() => Game.PlayerOperations, null);
  if (!ops || typeof ops.sendRequest !== "function") return 0;
  const me = sender();
  for (const c of inv.constructibles) {
    if (safe(() => { ops.sendRequest(me, "DESTROY_ELEMENT", { Kind: "CONSTRUCTIBLE", Owner: c.id.owner, LocalID: c.id.id }); return true; }, false)) sent++;
  }
  if (inv.districtId) {
    if (safe(() => { ops.sendRequest(me, "DESTROY_ELEMENT", { Kind: "DISTRICT", Owner: inv.districtId.owner, LocalID: inv.districtId.id }); return true; }, false)) sent++;
  }
  return sent;
}

/**
 * Recreate the rural district and the improvement for the new owner, attached to the buying city.
 * @param {{x:number,y:number}} loc Plot.
 * @param {*} cityId The buying city's ComponentID (`city.id`).
 * @param {number} owner New owner.
 * @param {number} improvementIndex The improvement's `$index`, or -1 for a district alone.
 * @returns {boolean} Whether the requests went out.
 */
export function rebuild(loc, cityId, owner, improvementIndex) {
  const ops = safe(() => Game.PlayerOperations, null);
  if (!ops || typeof ops.sendRequest !== "function" || !cityId) return false;
  const me = sender();
  const at = { x: loc.x, y: loc.y };
  const ok = safe(() => { ops.sendRequest(me, "CREATE_ELEMENT", { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: at, Parent: cityId, Owner: owner }); return true; }, false);
  if (ok && improvementIndex >= 0) {
    safe(() => ops.sendRequest(me, "CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: improvementIndex, Location: at, Parent: cityId, Owner: owner }));
  }
  return ok;
}

/** @param {{x:number,y:number}} loc Plot. @returns {number} Owner id, or -9 when unreadable. */
function ownerOf(loc) {
  return safe(() => GameplayMap.getOwner(loc.x, loc.y), -9);
}

/**
 * Wait until `test()` holds, polling, or until `maxMs` has passed.
 * @param {()=>boolean} test Condition. @param {number} maxMs Cap. @param {number} pollMs Poll interval.
 * @returns {Promise<boolean>} Whether the condition held.
 */
function until(test, maxMs, pollMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (safe(test, false)) return resolve(true);
      if (Date.now() - t0 >= maxMs) return resolve(safe(test, false));
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

/**
 * The whole flip of an improved tile: teardown, wait for it to show, buy, wait for the owner to change, rebuild.
 * Returns at once; the promise reports what happened for logs and tests.
 * @param {Object} a Arguments.
 * @param {{x:number,y:number}} a.loc Plot.
 * @param {number} a.playerId New owner.
 * @param {*} a.city The buying city (needs `.id`).
 * @param {()=>{ok:boolean, reason:string, cost?:number}} a.buy The purchase (cd-ownership's refunded purchasePlot).
 * @param {ReturnType<typeof plotInventory>} a.inv The plot inventory read before the flip.
 * @param {number} [a.pollMs] Poll interval (tests shorten it).
 * @param {number} [a.teardownWaitMs] How long to wait for the teardown to show before buying anyway.
 * @param {number} [a.landWaitMs] How long to wait for the owner change before giving up on the rebuild.
 * @returns {Promise<TeardownOutcome>} What happened, once the chain has run.
 */
/**
 * @typedef {Object} TeardownOutcome
 * @property {number} torn Requests sent by the teardown.
 * @property {boolean} cleared Whether the teardown showed on the map before the buy.
 * @property {{ok:boolean, reason:string, cost?:number}} buy The purchase's result.
 * @property {boolean} landed Whether the owner changed in time.
 * @property {boolean} rebuilt Whether the rebuild requests went out.
 * @property {boolean} restored Whether the tile was given back to its previous owner because the buy never landed.
 * @property {string|null} improvement The improvement put back, or null.
 */
export function flipWithTeardown({ loc, playerId, city, buy, inv, pollMs = 250, teardownWaitMs = 6000,
  landWaitMs = 8000 }) {
  const improvement = inv.constructibles.find((c) => c.cls === "IMPROVEMENT") || null;
  const improvementType = improvement ? improvement.type : null;
  const index = improvement ? improvement.index : -1;
  // Remembered so a purchase that never lands gives the tile back to its owner whole, instead of leaving them a
  // bare plot (watched twice in the first soak of this path: the teardown showed, the buy did not land).
  const prevOwner = ownerOf(loc);
  const prevCityId = safe(() => MapCities.getCity(loc.x, loc.y), null) || null;
  const torn = teardown(inv);
  const cleared = () => {
    const now = plotInventory(loc);
    return now.constructibles.length === 0 && !now.resolvable;
  };
  const restore = () => (prevOwner >= 0 && prevCityId ? rebuild(loc, prevCityId, prevOwner, index) : false);
  return until(cleared, teardownWaitMs, pollMs).then((wasCleared) => {
    const res = buy();
    if (!res.ok) {
      const restored = restore();
      return {
        torn, cleared: wasCleared, buy: res, landed: false, rebuilt: false, restored, improvement: improvementType
      };
    }
    return until(() => ownerOf(loc) === playerId, landWaitMs, pollMs).then((landed) => {
      const rebuilt = landed ? rebuild(loc, safe(() => city.id, null), playerId, index) : false;
      const restored = landed ? false : restore();
      return { torn, cleared: wasCleared, buy: res, landed, rebuilt, restored, improvement: improvementType };
    });
  });
}
