// cdh-game-lenscheck.js - game scope, deployed as ui/cdh-game.js. Does the pressure overlay leak? (dev only)
//
// THE QUESTION: does the Cultural Pressure shading appear when the player has a DIFFERENT lens selected?
//
// Why it is open: while shooting release imagery, a frame taken before any `setActiveLens` call already showed the
// shading, with `getActiveLens()` reporting `fxs-default-lens`. That is either a leak or a misread of the image.
// The code looks correctly gated - `PressureLens.activeLayers` holds the layer, and the layer implements
// `applyLayer` / `removeLayer` - so this measures the behaviour instead of re-reading the source.
//
// Sequence, with the layer's own enabled flag logged at every step and a frame at each:
//   A  untouched at load        - the state a player opens the game in
//   B  Cultural Pressure active - the shading SHOULD be here
//   C  switched AWAY to another lens - the shading MUST be gone. If it is still painted, `removeLayer` is not
//      clearing the overlay, and a player on another lens keeps seeing culture shading.
//   D  switched away a second time via the mod's own Shift+C path (toggleLens), which is how a player turns it off
//
// Seeds a contested block first, because with nothing contested there is nothing to paint and every frame would
// look identical - the mistake that cost two imagery runs.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { __test as LensT } from "/cultural-diffusion/ui/cd-pressure-lens.js";
import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const LAYER = "cd-pressure-layer";
const LENS = "cd-pressure-lens";

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
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

/** active lens + whether the layer is enabled + how many tiles the lens would paint. */
function state(label) {
  const s = {
    active: safe(() => LensManager.getActiveLens(), "?"),
    layerEnabled: safe(() => LensManager.isLayerEnabled(LAYER), "?"),
    wouldPaint: safe(() => LensT.pressureTiles().length, "ERR")
  };
  emit(`STATE ${label} active=${s.active} layerEnabled=${s.layerEnabled} wouldPaint=${s.wouldPaint}`);
  return s;
}

function seedBlock() {
  const cities = localCities();
  let best = null;
  for (const c of cities) {
    const ring = inRadius(c.location, 5)
      .filter((p) => dist(c.location, p) >= 4 && dist(c.location, p) <= 5)
      .filter((p) => !isWater(p) && owner(p) === -1)
      .filter((p) => inRadius(p, 1).some((n) => owner(n) === local));
    if (!best || ring.length > best.ring.length) best = { city: c, ring };
  }
  if (!best || best.ring.length < 3) return null;
  const bar = safe(() => {
    const age = (CONFIG.byAge && CONFIG.byAge[currentAgeKey()]) || {};
    return CONFIG.minimumOwner * (age.ownerBar != null ? age.ownerBar : 1);
  }, CONFIG.minimumOwner);
  const stock = Math.max(40, Math.round(bar * 0.7));
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  for (const p of best.ring) d.field[key(p)] = { [String(local)]: stock };
  safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); });
  const cx = Math.round(best.ring.reduce((a, p) => a + p.x, 0) / best.ring.length);
  const cy = Math.round(best.ring.reduce((a, p) => a + p.y, 0) / best.ring.length);
  emit(`SEED tiles=${best.ring.length} stock=${stock} centre=${cx},${cy}`);
  return { x: cx, y: cy };
}

async function run() {
  local = GameContext.localPlayerID;
  const centre = seedBlock();
  if (!centre) { emit("LENSCHECK no seedable block; aborting"); return; }
  await later(2000);
  safe(() => { Camera.lookAtPlot(centre, { zoom: 0.35 }); });
  await later(8000);

  const a = state("A-untouched");
  emit("SHOT A-untouched");
  await later(4000);

  safe(() => LensManager.setActiveLens(LENS));
  await later(12000);
  const b = state("B-pressure-active");
  emit("SHOT B-pressure-active");
  await later(4000);

  safe(() => LensManager.setActiveLens("fxs-default-lens"));
  await later(12000);
  const c = state("C-switched-away");
  emit("SHOT C-switched-away");
  await later(4000);

  emit(`VERDICT layerEnabled A=${a.layerEnabled} B=${b.layerEnabled} C=${c.layerEnabled} => ` +
    (c.layerEnabled === true
      ? "LEAK: the layer is still enabled after switching to another lens - a player on another lens keeps the shading"
      : a.layerEnabled === true
        ? "LEAK AT LOAD: the layer is enabled before the lens was ever selected"
        : "GATED CORRECTLY by the layer flag - compare the frames to be sure the OVERLAY follows the flag"));
  emit("DONE harness lenscheck finished");
}

emit("attached lenscheck");
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
