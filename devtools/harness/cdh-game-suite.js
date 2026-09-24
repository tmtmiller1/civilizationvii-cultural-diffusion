// cdh-game-suite.js - game scope, deployed as ui/cdh-game.js. The full release-imagery suite (dev only).
//
// Six captures covering what a player actually sees. Each emits `SHOT <name>` once its view has settled;
// run-harness.sh grabs the game WINDOW by id (never the display).
//
//   01-hero-borders     culture-expanded border, no overlays - the mod's effect on a map
//   02-lens-contested   the Cultural Pressure lens, camera ON the painted front and zoomed in
//   03-lens-panel       the same, with the game's Lenses list open on Cultural Pressure
//   04-frontier-rival   our cultural border meeting a rival's territory
//   05-options          Options > Mods > Cultural Diffusion, the whole settings surface
//   06-lens-wide        the front in context, for a header image
//
// Framing lessons from the first two attempts, both of which wasted a run:
//   * Aim AT the subject. Run 11's recipe aims four columns east to dodge centred pop-ups, which put the paint in
//     the top-left corner and made the cities the subject instead.
//   * Seed BELOW the ownership bar and never run a pass: a claimed tile is not contested, so the lens has nothing
//     to paint (the first attempt's lens-on and lens-off frames measured 1.44% and 1.47% coloured pixels).
//   * Do not switch to `fxs-default-lens` for a clean map - it is the yield-icon overlay.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { __test as LensT } from "/cultural-diffusion/ui/cd-pressure-lens.js";
import LensManager from "/core/ui/lenses/lens-manager.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";

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
function atWar(pid) { return safe(() => !!Players.get(local).Diplomacy.isAtWarWith(pid), null); }

function closePopups(left, done) {
  const showing = safe(() => TechCivicPopupManager.isShowing(), "?");
  if (showing !== true || left <= 0) { emit(`POPUPS showing=${showing}`); done(); return; }
  safe(() => TechCivicPopupManager.closePopup());
  setTimeout(() => closePopups(left - 1, done), 1000);
}

/** ~70% of the age-adjusted ownership bar: strong lens progress, no flip. */
function seedStock() {
  const bar = safe(() => {
    const age = (CONFIG.byAge && CONFIG.byAge[currentAgeKey()]) || {};
    return CONFIG.minimumOwner * (age.ownerBar != null ? age.ownerBar : 1);
  }, CONFIG.minimumOwner);
  return Math.max(40, Math.round(bar * 0.7));
}

/**
 * Seed a compact block of contested tiles and return its CENTRE, so the camera can sit on the paint rather than
 * beside it. Prefers tiles that are unowned and touch our land, which are the ones the lens will actually paint
 * under the v1.2.0 gates.
 * @returns {{centre:{x:number,y:number}, city:*, n:number}|null} The seeded block.
 */
function seedBlock() {
  const cities = localCities();
  let best = null;
  for (const c of cities) {
    const ring = inRadius(c.location, 5)
      .filter((p) => dist(c.location, p) >= 4 && dist(c.location, p) <= 5)
      .filter((p) => !isWater(p) && owner(p) === -1)
      .filter((p) => inRadius(p, 1).some((n) => owner(n) === local));   // adjacency gate
    if (!best || ring.length > best.ring.length) best = { city: c, ring };
  }
  if (!best || best.ring.length < 3) return null;
  const raw = safe(() => Configuration.getGame().getValue(STATE_KEY), null);
  let s = safe(() => (raw ? JSON.parse(raw) : null), null);
  if (!s || typeof s !== "object") s = { v: 2, data: {} };
  const d = s.data || s;
  d.field = d.field || {}; d.claims = d.claims || {}; d.locked = d.locked || {}; d.pending = d.pending || {};
  d.monoTurn = d.monoTurn || 0;
  const stock = seedStock();
  for (const p of best.ring) d.field[key(p)] = { [String(local)]: stock };
  safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: d })); });
  const cx = Math.round(best.ring.reduce((a, p) => a + p.x, 0) / best.ring.length);
  const cy = Math.round(best.ring.reduce((a, p) => a + p.y, 0) / best.ring.length);
  emit(`SEED city=${cityName(best.city)} tiles=${best.ring.length} stock=${stock} centre=${cx},${cy}`);
  return { centre: { x: cx, y: cy }, city: best.city, n: best.ring.length };
}

/** A plot on our border that faces a rival's territory, for the frontier shot. */
function rivalFrontier() {
  for (const c of localCities()) {
    for (const p of inRadius(c.location, 7)) {
      if (owner(p) !== local) continue;
      for (const n of inRadius(p, 1)) {
        const o = owner(n);
        if (o >= 0 && o !== local && safe(() => Players.get(o).isMajor, false)) {
          return { at: p, rival: o, war: atWar(o) };
        }
      }
    }
  }
  return null;
}

function aim(loc, zoom, label) {
  const r = safe(() => { Camera.lookAtPlot(loc, { zoom }); return `zoom${zoom}`; }, "no-camera");
  emit(`CAMERA ${label} at=${key(loc)} ${r}`);
}
function lensCount() { return safe(() => LensT.pressureTiles().length, "ERR"); }

async function run() {
  local = GameContext.localPlayerID;
  emit(`S0 suite turn=${safe(() => Game.turn)} local=${local} lensAtStart=${safe(() => LensManager.getActiveLens(), "?")}`);
  const block = seedBlock();
  if (!block) { emit("SUITE no seedable contested block; aborting"); return; }
  await later(2000);
  emit(`LENS would paint ${lensCount()} tile(s) after seeding`);

  await new Promise((done) => closePopups(6, done));
  safe(() => UI.Player.deselectAllUnits());
  await later(3000);

  // 01 hero: the border, no lens. Whatever view the game loaded with is left alone except for the camera.
  aim(block.city.location, 0.55, "hero");
  await later(9000);
  emit("SHOT 01-hero-borders");
  await later(2000);

  // 02 lens, camera ON the painted block and close.
  const set = safe(() => { LensManager.setActiveLens("cd-pressure-lens"); return "called"; }, "throw");
  emit(`LENS set=${set} active=${safe(() => LensManager.getActiveLens(), "?")} paints=${lensCount()}`);
  aim(block.centre, 0.3, "lens-close");
  await later(14000);
  emit("SHOT 02-lens-contested");
  await later(2000);

  // 03 the same with the Lenses list open, so the mod's lens is visibly one of the game's.
  const open = safe(() => { ContextManager.push("lens-panel", { singleton: true }); return "pushed"; }, "throw");
  emit(`LENSPANEL ${open}`);
  await later(6000);
  emit("SHOT 03-lens-panel");
  await later(2000);
  safe(() => ContextManager.pop("lens-panel"));

  // 04 our border against a rival's.
  const fr = rivalFrontier();
  emit(`FRONTIER ${J(fr && { at: key(fr.at), rival: fr.rival, war: fr.war })}`);
  if (fr) {
    aim(fr.at, 0.35, "rival-frontier");
    await later(9000);
    emit("SHOT 04-frontier-rival");
    await later(2000);
  }

  // 05 the settings surface.
  const opts = safe(() => { ContextManager.push("screen-options", { singleton: true, createMouseGuard: true }); return "pushed"; }, "throw");
  emit(`OPTIONS ${opts}`);
  await later(8000);
  emit("SHOT 05-options");
  await later(2000);
  safe(() => ContextManager.pop("screen-options"));
  await later(3000);

  // 06 wide, for a header.
  aim(block.centre, 0.6, "wide");
  await later(9000);
  emit("SHOT 06-lens-wide");
  await later(3000);

  emit(`DONE harness suite finished paints=${lensCount()}`);
}

emit("attached suite");
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
