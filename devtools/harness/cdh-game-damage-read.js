// cdh-game-damage-read.js: game scope, read-only. For every plot with a dangling district id, and for the cities around
// it, read everything the engine exposes, to find what besides the id is damaged (dev only).
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
const idxOf = (x, y) => y * GameplayMap.getGridWidth() + x;
function cityName(c) { return safe(() => Locale.compose(c.name), "?"); }
function dangling(x, y) { const id = safe(() => MapCities.getDistrict(x, y), null); return !!id && !safe(() => Districts.get(id), null); }
function cityReport(c, tag) {
  const pp = safe(() => c.getPurchasedPlots() || [], []);
  const ids = safe(() => c.Districts.getIds() || [], []);
  const bad = ids.filter((id) => !safe(() => Districts.get(id), null)).length;
  const locs = safe(() => Districts.getLocations(ids) || [], []);
  const ppDangling = pp.filter((i) => { const l = GameplayMap.getLocationFromIndex(i); return dangling(l.x, l.y); }).length;
  const ppForeign = pp.filter((i) => { const l = GameplayMap.getLocationFromIndex(i); return GameplayMap.getOwner(l.x, l.y) !== c.owner; }).length;
  const ppOtherCity = pp.filter((i) => { const l = GameplayMap.getLocationFromIndex(i); const oc = safe(() => GameplayMap.getOwningCityFromXY(l.x, l.y), null); return oc && !(oc.id === c.id.id && oc.owner === c.owner); }).length;
  const w = safe(() => c.Workers.GetAllPlacementInfo(), null);
  const wBad = Array.isArray(w) ? w.filter((p) => p && p.PlotIndex != null && GameplayMap.getOwner(GameplayMap.getLocationFromIndex(p.PlotIndex).x, GameplayMap.getLocationFromIndex(p.PlotIndex).y) !== c.owner).length : "n/a";
  const pop = safe(() => `${c.population}/${c.urbanPopulation}/${c.ruralPopulation}`, "?");
  emit(`CITY ${tag} p${c.owner} ${cityName(c)}@${c.location.x},${c.location.y} pop(u/r)=${pop} purchased=${pp.length} ppDangling=${ppDangling} ppOwnedByOthers=${ppForeign} ppOwningCityMismatch=${ppOtherCity} districtIds=${ids.length} unresolvable=${bad} districtLocs=${locs.length} workers=${Array.isArray(w) ? w.length : typeof w} workersOnForeignPlots=${wBad} keysWorkers=${w && w[0] ? Object.keys(w[0]).join(",") : "-"}`);
}
function run() {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const dang = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dangling(x, y)) dang.push({ x, y });
  emit(`DAMAGE turn=${safe(() => Game.turn)} dangling=${dang.length}`);
  const cities = new Map();
  for (const l of dang.slice(0, 12)) {
    const id = MapCities.getDistrict(l.x, l.y);
    const oc = safe(() => GameplayMap.getOwningCityFromXY(l.x, l.y), null);
    const ocCity = oc ? safe(() => Cities.get(oc), null) : null;
    const idOwnerCities = safe(() => Players.get(id.owner).Cities.getCities() || [], []);
    const listedBy = idOwnerCities.filter((c) => safe(() => (c.Districts.getIds() || []).some((d) => d.id === id.id && d.owner === id.owner), false)).map(cityName);
    const purchasedBy = [];
    for (const p of safe(() => Players.getAlive(), [])) for (const c of safe(() => p.Cities.getCities() || [], [])) if (safe(() => (c.getPurchasedPlots() || []).includes(idxOf(l.x, l.y)), false)) { purchasedBy.push(`p${p.id}:${cityName(c)}`); cities.set(c.id.id + ":" + c.owner, c); }
    if (ocCity) cities.set(ocCity.id.id + ":" + ocCity.owner, ocCity);
    emit(`TILE ${l.x},${l.y} owner=${GameplayMap.getOwner(l.x, l.y)} id=${js(id)} idOwnerPlayer=${id.owner} owningCity=${ocCity ? "p" + ocCity.owner + ":" + cityName(ocCity) : js(oc)} inDistrictListOf=${js(listedBy)} inPurchasedPlotsOf=${js(purchasedBy)} cons=${js(safe(() => (MapConstructibles.getConstructibles(l.x, l.y) || []).length, "?"))} districtAtLoc=${safe(() => Districts.getAtLocation(l) ? "yes" : "null")} idAtLoc=${js(safe(() => Districts.getIdAtLocation(l), "ERR"))}`);
  }
  for (const c of cities.values()) cityReport(c, "near-dangling");
  // Player-level district lists: does the buyer's player list hold the unregistered id?
  for (const p of safe(() => Players.getAlive(), [])) {
    const ids = safe(() => p.Districts?.getDistrictIds?.() || [], []);
    const objs = safe(() => p.Districts?.getDistricts?.() || [], []);
    const bad = ids.filter((id) => !safe(() => Districts.get(id), null));
    const danglingHere = dang.filter((l) => GameplayMap.getOwner(l.x, l.y) === p.id).length;
    const listedDangling = dang.filter((l) => { const id = MapCities.getDistrict(l.x, l.y); return ids.some((d) => d.id === id.id && d.owner === id.owner); }).length;
    emit(`PLAYER p${p.id} districtIds=${ids.length} unresolvable=${bad.length} districtObjs=${objs.length} nullObjs=${objs.filter((o) => !o).length} danglingTilesOwned=${danglingHere} danglingIdsInList=${listedDangling} ${bad.slice(0, 5).map(js).join(" ")}`);
  }
  // one clean city for comparison
  const any = safe(() => Players.get(GameContext.localPlayerID).Cities.getCities()[0], null);
  if (any) cityReport(any, "control");
  emit("DONE harness damage-read finished");
}
emit("attached damage-read");
let tries = 0;
function poll() {
  const st = safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
  if (st === "GameStarted") { setTimeout(() => { try { run(); } catch (e) { emit("run threw " + e); } }, 8000); return; }
  tries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || tries % 5 === 0) safe(() => UI.notifyUIReady());
  if (tries < 90) setTimeout(poll, 2000); else emit("LOAD gave up");
}
setTimeout(poll, 3000);
