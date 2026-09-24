// cdh-game-shots.js - game scope, deployed as ui/cdh-game.js. Release imagery for v1.2.0 (dev only).
//
// Produces the captures for the GitHub release and the Workshop page. Nothing here is a test; it drives the game
// into states worth photographing and emits `SHOT <name>` when a view has settled, which run-harness.sh grabs by
// WINDOW ID (never the whole display).
//
// The pattern is run 11's, which is the one that worked: close the queued tech/civic popup first (it sits centred
// over the map and ruined earlier captures), aim the camera beside the subject rather than at it so the tile is not
// under any centred UI, switch the lens, and wait long enough for the overlay to redraw before shooting.
//
// Shots, in order:
//   01-borders     the culture-expanded frontier, lens off - what the mod does to a map
//   02-lens-off    a contested frontier, lens off
//   03-lens-on     the same view with the Cultural Pressure lens on - the pair shows what the lens adds
//   04-lens-wide   the same lens, pulled back, so the whole contested front reads
//
// Culture is SEEDED so the front is photogenic on the first local turn instead of waiting ~18 passes for organic
// contest (run 3's first organic claim was pass 18).
//
// The seed sits BELOW the ownership bar on purpose. The first version of this script seeded high and then ran a pass,
// which CLAIMED the very tiles it wanted to photograph: once a tile is ours the lens correctly paints nothing, so the
// lens-on and lens-off shots came out identical (measured: 1.44% vs 1.47% lens-coloured pixels). A contested frontier
// is what the lens is for, so the seed aims at roughly 70% of the bar - high progress, no flip.
//
// The lens-off shot also must NOT switch to another lens: `fxs-default-lens` turns on the YIELD ICON overlay and
// buried the first attempt's map under badges. Leave the game's own view alone instead.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
// ~70% of the age-adjusted ownership bar: the lens paints hard (progress is value/target) while the pass leaves the
// tile alone, so the front stays contested for the camera.
function seedStock() {
  const bar = safe(() => {
    const age = (CONFIG.byAge && CONFIG.byAge[currentAgeKey()]) || {};
    return CONFIG.minimumOwner * (age.ownerBar != null ? age.ownerBar : 1);
  }, CONFIG.minimumOwner);
  return Math.max(40, Math.round(bar * 0.7));
}

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

/** Close the queued tech/civic popup: it is centred over the map and spoiled earlier captures. */
function closePopups(left, done) {
  const showing = safe(() => TechCivicPopupManager.isShowing(), "?");
  if (showing !== true || left <= 0) { emit(`POPUPS showing=${showing} tries-left=${left}`); done(); return; }
  safe(() => TechCivicPopupManager.closePopup());
  setTimeout(() => closePopups(left - 1, done), 1000);
}

/**
 * Seed our culture onto the frontier ring of the city with the most open land around it, and run one pass so the
 * borders in shot 01 are genuinely the mod's work rather than the base game's.
 * @returns {{city:*, ring:{x:number,y:number}[]}|null} What was seeded.
 */
function seedFrontier() {
  const cities = localCities();
  let best = null;
  for (const c of cities) {
    const ring = inRadius(c.location, 5)
      .filter((p) => dist(c.location, p) >= 4 && dist(c.location, p) <= 5)
      .filter((p) => !isWater(p) && owner(p) !== local);
    if (!best || ring.length > best.ring.length) best = { city: c, ring };
  }
  if (!best || !best.ring.length) return null;
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  const stock = seedStock();
  for (const p of best.ring) d.field[key(p)] = { [String(local)]: stock };
  safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); });
  emit(`SEED city=${cityName(best.city)} at=${key(best.city.location)} ring=${best.ring.length} stock=${seedStock()} (below the bar on purpose)`);
  return best;
}

/** Aim beside the subject, so it sits left of centre and clear of any centred UI. */
function aimAt(loc, zoom) {
  const aim = { x: loc.x + 4, y: loc.y };
  const r = safe(() => { Camera.lookAtPlot(aim, { zoom }); return `zoom${zoom}`; }, "no-camera");
  emit(`CAMERA at=${key(loc)} aim=${key(aim)} ${r}`);
}

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 shots turn=${safe(() => Game.turn)} local=${local} cities=${localCities().length}`);
  const seeded = seedFrontier();
  if (!seeded) { emit("SHOTS no seedable frontier; aborting"); return; }
  const subject = seeded.city.location;

  // NO pass. Running one claimed the seeded tiles and left the lens with nothing to paint.
  emit("PASS skipped on purpose: a claimed tile is no longer contested and the lens would paint nothing");
  await later(3000);

  await new Promise((done) => closePopups(6, done));
  safe(() => UI.Player.deselectAllUnits());
  await later(2000);

  // 01: the border and the front as the player sees them - no lens call at all. Switching to
  // "fxs-default-lens" here turned ON the yield-icon overlay and buried the map in badges.
  emit(`LENS at start=${safe(() => LensManager.getActiveLens(), "?")}`);
  aimAt(subject, 0.5);
  await later(9000);
  emit("SHOT 01-borders");
  await later(3000);

  // 02 / 03: the contested front, lens off then on, same framing - the pair is the point.
  aimAt(subject, 0.35);
  await later(8000);
  emit("SHOT 02-lens-off");
  await later(3000);
  const set = safe(() => { LensManager.setActiveLens("cd-pressure-lens"); return "called"; }, "throw");
  emit(`LENS set=${set} active=${safe(() => LensManager.getActiveLens(), "?")}`);
  await later(14000);   // the overlay needs time to redraw; run 11 shot too early and caught the old view
  emit(`LENS active=${safe(() => LensManager.getActiveLens(), "?")} layer=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")}`);
  emit("SHOT 03-lens-on");
  await later(3000);

  // 04: same lens, wider, so the whole front reads rather than a few tiles.
  aimAt(subject, 0.6);
  await later(9000);
  emit("SHOT 04-lens-wide");
  await later(4000);

  emit("DONE harness shots finished");
}

emit("attached shots");
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
