// cdh-game-borders.js - game scope, deployed as ui/cdh-game.js. Border-expansion imagery (dev only).
//
// The lens shots show the mod's READOUT. This shows the mod's EFFECT: a border pushed out past the normal city
// footprint. A single frame cannot say "this border grew", so the pair is the point - the same camera, before and
// after the mod claims a batch of tiles.
//
//   01-border-before   the city's border as the base game left it
//   02-border-after    the same view once culture has taken the frontier ring
//   03-border-edge     close on the new edge, where the border bulges past the city's own rings
//
// Unlike the lens shots this seeds ABOVE the ownership bar and DOES run passes: here the claims are the subject.
// Claims land about three seconds after `purchasePlot` (cd-pending.js), so each pass is followed by a wait before
// anything is photographed.
//
// Two things learned the hard way about getting a CLEAN map:
//   * The Cultural Pressure layer paints whenever it is ENABLED - it is not gated on being the active lens. (Suite
//     shot 01, taken before any lens call, already showed the paint; that is also why an earlier "lens off vs lens
//     on" pair measured 1.47% and 1.44% coloured pixels.) So the layer is DISABLED here, not swapped.
//   * Never call `setActiveLens`. `fxs-default-lens` is the yield-icon view, and calling it is what put badges over
//     three earlier attempts. Leaving the loaded view alone gives a clean map.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { runPass } from "/cultural-diffusion/ui/cd-pass.js";
import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const SEED = 9000;        // well over the bar: these tiles are meant to flip
const PASSES = 4;         // maxFlipsPerTurn is 8, so up to ~32 tiles - a visible bulge

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

/** The city with the most claimable open land around it, and the ring to seed. */
function pickCity() {
  let best = null;
  for (const c of localCities()) {
    const ring = inRadius(c.location, CONFIG.flipMaxDistance)
      .filter((p) => dist(c.location, p) > CONFIG.baseGrowthRadius)
      .filter((p) => !isWater(p) && owner(p) === -1)
      .filter((p) => inRadius(p, 1).some((n) => owner(n) === local));
    if (!best || ring.length > best.ring.length) best = { city: c, ring };
  }
  return best && best.ring.length >= 6 ? best : null;
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
  const centre = pick.city.location;
  emit(`S0 borders city=${cityName(pick.city)} at=${key(centre)} claimable=${pick.ring.length} ` +
    `ownedWithin6=${ourTiles(centre, 6)}`);

  // LensManager is NOT touched at all: disabling the layer through it redraws the default lens's yield-icon
  // overlay, which is what put badges over every earlier attempt. The lens is off because the runner patched its
  // default in the deployed cd-settings.js (PATCH=...), so nothing here has to ask the UI for anything.
  emit(`LENS untouched; active=${safe(() => LensManager.getActiveLens(), "?")} ` +
    `layer=${safe(() => LensManager.isLayerEnabled("cd-pressure-layer"), "?")}`);
  await new Promise((done) => closePopups(6, done));
  safe(() => UI.Player.deselectAllUnits());
  aim(centre, 0.65, "before");
  await later(12000);
  emit(`BEFORE ownedWithin6=${ourTiles(centre, 6)}`);
  emit("SHOT 01-border-before");
  await later(3000);

  // Claim the frontier: seed hard, then run passes, waiting for each batch of writes to land.
  seed(pick.ring);
  let claimed = 0;
  for (let i = 0; i < PASSES; i++) {
    const r = safe(() => runPass(), "threw");
    await later(7000);
    claimed = ourTiles(centre, 6);
    emit(`PASS ${i + 1} ${J(r)} ownedWithin6=${claimed}`);
  }
  emit(`AFTER ownedWithin6=${claimed} (was ${ourTiles(centre, 6)})`);

  // Same camera, so the pair reads as one view changing.
  aim(centre, 0.65, "after");
  await later(10000);
  emit("SHOT 02-border-after");
  await later(3000);

  // Close on the new edge.
  aim(centre, 0.45, "edge");
  await later(9000);
  emit("SHOT 03-border-edge");
  await later(3000);

  emit("DONE harness borders finished");
}

emit("attached borders");
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
