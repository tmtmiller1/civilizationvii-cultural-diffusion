// cdh-game-borders6.js - game scope, deployed as ui/cdh-game.js. Border-expansion imagery, take 6 (dev only).
//
// Take 4 proved the SAVE was never the problem: every one of the local player's cities measured
// maxOwnedRing=3, the base game's limit, so the "before" state was vanilla all along. What failed was the
// PICTURE. Two things made a wide frame unreadable:
//   * A neighbouring civ's territory sat in frame in a near-identical purple, so tiles four and five rings
//     out - none of them ours - read as this city's. That is what the rejected 04-border-before.jpg showed.
//   * `lookAtPlot` was called again before the "after" shot, and the camera did not land identically, so the
//     pair was not the same view twice.
//
// So take 5: pick the city with the FEWEST foreign-owned tiles near it (a frontier that faces open land, not
// another empire), aim ONCE at the midpoint between the city and the land culture is about to take, and never
// touch the camera again - the two shots differ only by what the mod did between them. That worked (Leeds,
// foreignWithin6=1, one empire's colour in frame) but framed too tight: the border left the picture instead of
// moving across it, so the "after" reads as a line that vanished.
//
// Take 6 keeps all of that and frames the FRONTIER rather than the midpoint, one step wider, so the old border
// and the new one are both inside the picture and the eye can see the line move.
//
//   01-border-before   the city's vanilla footprint, with the open frontier it faces
//   02-border-after    the identical camera, once culture has claimed that frontier
//
// Seeds ABOVE the ownership bar and DOES run passes: the claims are the subject. Claims land about three
// seconds after `purchasePlot` (cd-pending.js), so every pass is followed by a wait. Never call
// `setActiveLens` - `fxs-default-lens` is the yield-icon view. The pressure layer is off because the runner
// patched its default in the DEPLOYED cd-settings.js (PATCH=...).

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { runPass } from "/cultural-diffusion/ui/cd-pass.js";
import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const SEED = 9000;        // well over the bar: these tiles are meant to flip
const PASSES = 6;         // maxFlipsPerTurn is 8, so up to ~48 tiles - a bulge you cannot miss
const VANILLA = 3;        // CONFIG.baseGrowthRadius: the base game's last ring

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function cityName(c) { return safe(() => Locale.compose(c.name), "?"); }
function ourTiles(centre, r) { return inRadius(centre, r).filter((p) => owner(p) === local).length; }

function closePopups(left, done) {
  const showing = safe(() => TechCivicPopupManager.isShowing(), "?");
  if (showing !== true || left <= 0) { emit(`POPUPS showing=${showing}`); done(); return; }
  safe(() => TechCivicPopupManager.closePopup());
  setTimeout(() => closePopups(left - 1, done), 1000);
}

/** Every local city centre, so a tile can be attributed to the nearest one. */
function centres() { return localCities().map((c) => ({ name: cityName(c), loc: c.location })); }

/** The nearest local city centre to a plot. */
function nearestCentre(p, all) {
  let best = null;
  for (const c of all) {
    const d = dist(p, c.loc);
    if (!best || d < best.d) best = { c, d };
  }
  return best;
}

/**
 * Owned tiles by ring for ONE city, counting only tiles this city is the nearest local city to. Without the
 * attribution a neighbour's ring-2 tile reads as this city's ring-5 and every city looks over-expanded.
 */
function ringCensus(city, all) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  let maxRing = 0;
  for (const p of inRadius(city.loc, 6)) {
    if (owner(p) !== local) continue;
    const near = nearestCentre(p, all);
    if (!near || near.c.loc.x !== city.loc.x || near.c.loc.y !== city.loc.y) continue;
    const d = dist(city.loc, p);
    if (d > 6) continue;
    counts[d] += 1;
    if (d > maxRing) maxRing = d;
  }
  return { counts, maxRing };
}

/** Tiles near a city owned by SOMEONE ELSE. A frame with none of these has only one empire's colour in it. */
function foreignWithin(city, r) {
  let n = 0;
  for (const p of inRadius(city.loc, r)) {
    const o = owner(p);
    if (o >= 0 && o !== local) n += 1;
  }
  return n;
}

/** The middle of the land culture is about to take, so the camera can frame the city AND the frontier. */
function centroid(tiles) {
  if (!tiles.length) return null;
  let x = 0, y = 0;
  for (const p of tiles) { x += p.x; y += p.y; }
  return { x: Math.round(x / tiles.length), y: Math.round(y / tiles.length) };
}

/** Unowned, non-water land past the vanilla ring that touches our territory - what culture could take. */
function claimableRing(city) {
  return inRadius(city.loc, CONFIG.flipMaxDistance)
    .filter((p) => dist(city.loc, p) > VANILLA)
    .filter((p) => !isWater(p) && owner(p) === -1)
    .filter((p) => inRadius(p, 1).some((n) => owner(n) === local));
}

/** Distance to the closest OTHER local city - a lone city makes a frame whose border is unambiguous. */
function isolation(city, all) {
  let best = 99;
  for (const c of all) {
    if (c.loc.x === city.loc.x && c.loc.y === city.loc.y) continue;
    const d = dist(city.loc, c.loc);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Score every city, log the census, and pick one whose own footprint stops at the vanilla ring. Preference:
 * vanilla-looking first, then the most claimable land, then the most isolated.
 */
function pickCity() {
  const all = centres();
  const rows = [];
  for (const city of all) {
    const { counts, maxRing } = ringCensus(city, all);
    const ring = claimableRing(city);
    const iso = isolation(city, all);
    const foreign = foreignWithin(city, 6);
    rows.push({ city, counts, maxRing, ring, iso, foreign });
    emit(`CENSUS ${city.name} at=${key(city.loc)} maxOwnedRing=${maxRing} ` +
      `rings=[${counts.join(",")}] claimablePastRing${VANILLA}=${ring.length} nearestOtherCity=${iso} ` +
      `foreignWithin6=${foreign}`);
  }
  const usable = rows.filter((r) => r.ring.length >= 6);
  const vanilla = usable.filter((r) => r.maxRing <= VANILLA);
  const pool = vanilla.length ? vanilla : usable;
  if (!pool.length) return null;
  // Fewest foreign tiles first: a second empire's colour in the frame is what made take 4 unreadable.
  // Only then the most land to take, so the change is big enough to see.
  pool.sort((a, b) => (a.foreign - b.foreign) || (b.ring.length - a.ring.length) || (b.iso - a.iso));
  const pick = pool[0];
  emit(`PICK ${pick.city.name} vanillaFootprint=${pick.maxRing <= VANILLA} maxOwnedRing=${pick.maxRing} ` +
    `foreignWithin6=${pick.foreign} (candidates vanilla=${vanilla.length}/${usable.length})`);
  return pick;
}

function seed(ring) {
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  for (const p of ring) d.field[key(p)] = { [String(local)]: SEED };
  safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); });
}

function aim(loc, zoom, label) {
  const r = safe(() => { Camera.lookAtPlot(loc, { zoom }); return `zoom${zoom}`; }, "no-camera");
  emit(`CAMERA ${label} at=${key(loc)} ${r}`);
}

async function run() {
  local = GameContext.localPlayerID;
  const pick = pickCity();
  if (!pick) { emit("BORDERS no city with claimable open land; aborting"); return; }
  const centre = pick.city.loc;
  const all = centres();

  emit(`LENS untouched; active=${safe(() => LensManager.getActiveLens(), "?")} ` +
    `layer=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")}`);
  await new Promise((done) => closePopups(6, done));
  safe(() => UI.Player.deselectAllUnits());

  // ONE aim for both shots. The midpoint between the city and the land about to be claimed keeps the city
  // and the frontier in the same frame; the camera is never touched again, so the pair is the same view.
  // Centre on the land about to be claimed, not on the city: that keeps the ring-3 border (which the claims
  // start from) and the ring-5 border (where they end up) both in shot.
  const target = centroid(pick.ring);
  const frame = target || centre;
  emit(`FRAME city=${key(centre)} frontier=${target ? key(target) : "none"} camera=${key(frame)}`);
  aim(frame, 0.45, "pair");
  await later(12000);
  const b = ringCensus(pick.city, all);
  emit(`BEFORE city=${pick.city.name} maxOwnedRing=${b.maxRing} rings=[${b.counts.join(",")}] ` +
    `ownedWithin6=${ourTiles(centre, 6)}`);
  emit("SHOT 01-border-before");
  await later(3000);

  seed(pick.ring);
  for (let i = 0; i < PASSES; i++) {
    const r = safe(() => runPass(), "threw");
    await later(7000);
    emit(`PASS ${i + 1} ${J(r)} ownedWithin6=${ourTiles(centre, 6)}`);
  }
  const a = ringCensus(pick.city, all);
  emit(`AFTER city=${pick.city.name} maxOwnedRing=${a.maxRing} rings=[${a.counts.join(",")}] ` +
    `ownedWithin6=${ourTiles(centre, 6)}`);

  // NO second aim: the camera has not moved since the before shot.
  await later(6000);
  emit("SHOT 02-border-after");
  await later(3000);

  emit("DONE harness borders6 finished");
}

emit("attached borders6");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => emit("run threw " + e)); }, 10000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
