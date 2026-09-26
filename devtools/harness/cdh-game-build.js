// cdh-game-build.js - game scope, deployed as ui/cdh-game.js. The Civ V parity BUILD against the real engine (dev only).
//
// Run with the deployed config patched to `conquestFlip: true, aiCultureFlips: true` (run-harness.sh PATCH). The point
// is to watch the new modules load and run inside GameFace and to see each new path act on the real map at least once:
//
//   B0 BOOT      the mod booted (its boot line), culturalDiffusion.config() shows the toggles, no module error
//   B1 AI FLIP   seed a mature RIVAL stock on an unowned tile beside a rival major's land, inside our region and
//                within flipMaxDistance of that rival's city; one pass; the rival's city must take it (aiFlips or
//                aiPending in the result, then the owner read at +5 s)
//   B2 FOREIGN   seed a foreign stock on OUR capital's tile; one pass; the foreign stock must grow past decay
//                (population-strength injection) and the owner's stock must gain the converted share
//   B3 FLOOR     after a pass, owned region tiles carry the owner floor (rows valued 1)
//   B4 CAPTURE   call the CityTransfered handler with a real city's ComponentID (a transfer to its own owner, which
//                exercises getPurchasedPlots and the field rewrite without any engine write); the field rows of that
//                city must be rewritten (every stock x0.45, owner +0.75 of the lost)
//   B5 CONQUEST  the sweep runs (held count) and the occupant read on a tile under one of our own units returns a
//                list without throwing; a war is needed to watch a flip, and this save has none, so that stays open
//   then 4 turns so the pending AI flip is confirmed from the live map, and DONE.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { onCityTransfered } from "/cultural-diffusion/ui/cd-capture.js";
import { hostileCombatOccupants, conquerable } from "/cultural-diffusion/ui/cd-conquest.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const TURNS = 4;

function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
function r2(v) { return typeof v === "number" ? Math.round(v * 100) / 100 : String(v); }

let local = -1;
const key = (l) => l.x + "," + l.y;
function dist(a, b) { return safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99); }
function owner(l) { return safe(() => GameplayMap.getOwner(l.x, l.y), -9); }
function isWater(l) { return safe(() => !!GameplayMap.isWater(l.x, l.y), false); }
function inRadius(c, r) {
  return safe(() => GameplayMap.getPlotIndicesInRadius(c.x, c.y, r).map((i) => GameplayMap.getLocationFromIndex(i)), []);
}
function neighbours(p) { return inRadius(p, 1).filter((n) => n.x !== p.x || n.y !== p.y); }
function localCities() { return safe(() => Players.get(local).Cities.getCities() || [], []); }
function readState() {
  return safe(() => { const raw = Configuration.getGame().getValue(STATE_KEY); const s = raw ? JSON.parse(raw) : null; return (s && (s.data || s)) || {}; }, {});
}
function writeField(field) {
  safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: { field, claims: {}, locked: {}, pending: {}, occupation: {}, monoTurn: 0 } })); });
}
function stock(field, l, pid) { const row = field[key(l)]; return (row && row[String(pid)]) || 0; }

/** A rival MAJOR city inside our region, and an unowned land tile beside that rival's land, 4-6 from its centre. */
function findAiSite() {
  const ours = localCities();
  for (const p of safe(() => Players.getAlive(), [])) {
    if (p.id === local || !p.isMajor) continue;
    for (const c of safe(() => p.Cities.getCities() || [], [])) {
      const cl = c.location;
      const dOurs = Math.min(...ours.map((o) => dist(o.location, cl)), 99);
      if (dOurs > 6) continue; // the tile must sit inside OUR field region too
      for (const t of inRadius(cl, 6)) {
        const d = dist(cl, t);
        if (d < 4 || isWater(t) || owner(t) !== -1) continue;
        if (Math.min(...ours.map((o) => dist(o.location, t)), 99) > CONFIG.fieldRadius) continue;
        if (Math.min(...ours.map((o) => dist(o.location, t)), 99) <= 3) continue; // not inside our natural ring
        if (!neighbours(t).some((n) => owner(n) === p.id)) continue;
        if (neighbours(t).some((n) => owner(n) === local)) continue; // keep OUR flip path out of it
        return { rival: p.id, city: c, cityLoc: cl, tile: t, d, dOurs, name: safe(() => Locale.compose(c.name), "?") };
      }
    }
  }
  return null;
}

async function run() {
  local = GameContext.localPlayerID;
  const cfg = safe(() => culturalDiffusion.config(), null);
  emit(`B0 BOOT turn=${safe(() => Game.turn)} local=${local} config=${cfg ? js({ ai: cfg.aiCultureFlips, conquest: cfg.conquestFlip, foreign: cfg.foreignCultureInCities, capture: cfg.captureTransfer, floor: cfg.ownerFloor, buffer: cfg.conquestBufferTurns }) : "culturalDiffusion console ABSENT (module load failure?)"}`);
  if (!cfg) { emit("B0 VERDICT the mod did not boot; nothing else can run"); emit("DONE harness build finished"); return; }

  const site = findAiSite();
  const cap = localCities()[0];
  const capLoc = cap && cap.location;
  const field = {};
  if (site) field[key(site.tile)] = { [String(site.rival)]: 5000 };
  if (capLoc && site) field[key(capLoc)] = { [String(local)]: 5000, [String(site.rival)]: 500 };
  emit(`B1 SITE ${site ? `rival=${site.rival} city=${site.name}@${key(site.cityLoc)} tile=${key(site.tile)} dRivalCity=${site.d} dOurs=${site.dOurs} owner=${owner(site.tile)}` : "NONE (no rival city inside the region)"}`);
  emit(`B2 CAPITAL ${capLoc ? key(capLoc) : "none"} population=${safe(() => cap.population)} seeded rival stock 500 beside our 5000`);
  writeField(field);
  const before = readState().field || {};

  const res = safe(() => culturalDiffusion.runNow(), "ERR");
  emit(`B PASS runNow=${js(res)}`);
  const f = readState().field || {};

  // B1: did the rival's city take the tile?
  if (site) {
    await later(5000);
    const own = owner(site.tile);
    emit(`B1 AI-FLIP result aiFlips=${res.aiFlips} aiPending=${res.aiPending} owner(+5s)=${own} claim=${js((readState().claims || {})[key(site.tile)])} pending=${js((readState().pending || {})[key(site.tile)])}`);
    emit(`B1 VERDICT ${own === site.rival ? "AI FLIP LANDED: the rival's city took the seeded tile" : (res.aiPending > 0 || res.aiFlips > 0 ? "sent but not landed at +5 s (check the confirm line next pass)" : "NO AI FLIP: the pass did not act (read the gates)")}`);
  }
  // B2: foreign injection + conversion on our capital tile
  if (capLoc && site) {
    const rBefore = stock(before, capLoc, site.rival), rAfter = stock(f, capLoc, site.rival);
    const decayOnly = rBefore - rBefore * CONFIG.decayRate - CONFIG.decayFlat;
    emit(`B2 FOREIGN rival stock on our capital: before=${r2(rBefore)} decayOnly=${r2(decayOnly)} after=${r2(rAfter)} ours before=${r2(stock(before, capLoc, local))} after=${r2(stock(f, capLoc, local))}`);
    emit(`B2 VERDICT ${rAfter > decayOnly + 5 ? "FOREIGN GROUP PUMPED by the city's population (and converted a little)" : (rAfter < decayOnly && rAfter > 0 ? "only converted, not pumped (population read 0?)" : "NOT ACTED ON")}`);
  }
  // B3: owner floor rows
  let floorRows = 0, ours = 0;
  for (const k of Object.keys(f)) { const row = f[k]; const v = row[String(local)]; if (v === CONFIG.ownerFloor) floorRows++; if (v > 0) ours++; }
  emit(`B3 FLOOR rows at exactly the floor=${floorRows} rows with our culture=${ours} total rows=${Object.keys(f).length}`);
  emit(`B3 VERDICT ${floorRows > 20 ? "OWNER FLOOR written across our territory" : "floor rows missing"}`);
  // B4: capture handler on a real city (transfer to its own owner: pure field arithmetic, no engine write)
  if (site) {
    const cid = site.city.id;
    const centreBefore = stock(readState().field || {}, site.cityLoc, site.rival);
    // give the centre a stock to rewrite (a fresh field has only what one pass injected)
    const st = readState(); st.field[key(site.cityLoc)] = { [String(site.rival)]: 1000 };
    safe(() => Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: st })));
    const n = safe(() => onCityTransfered({ fromPlayer: site.rival, transferType: 0, cityID: cid }), "ERR");
    const after = stock(readState().field || {}, site.cityLoc, site.rival);
    emit(`B4 CAPTURE handler on ${site.name} cid=${js(cid)} purchasedPlots=${safe(() => site.city.getPurchasedPlots().length, "n/a")} rewrote=${n} centre stock 1000 -> ${r2(after)} (expect 1000*0.45 + 550*0.75 = 862.5; before the seed it was ${r2(centreBefore)})`);
    emit(`B4 VERDICT ${Math.abs(after - 862.5) < 0.01 ? "CAPTURE TRANSFER applied through the real city reads" : "unexpected value"}`);
  }
  // B5: conquest reads on a tile under one of our units
  const u = safe(() => Players.get(local).Units.getUnits().find((x) => x.Combat && x.Combat.isCombat && x.location && x.location.x >= 0), null);
  if (u) {
    const l = u.location;
    emit(`B5 CONQUEST reads at ${key(l)} (our ${safe(() => GameInfo.Units.lookup(u.type).UnitType)}): owner=${owner(l)} conquerable=${js(safe(() => conquerable(l, owner(l))))} occupants=${js(safe(() => hostileCombatOccupants(l, owner(l))))} sweep held=${res.occupied} conquests=${res.conquests}`);
  }
  emit("B5 VERDICT reads ran without throwing; a flip by occupation needs a war and stays unwatched in this save");
  n = 1;
  setTimeout(endTurn, 3000);
}

// ---------------------------------------------------------------- turns (no Autoplay; see cdh-game-gold2.js)
let n = 0; let endTimer = null; let tries = 0;
function endTurn() {
  try {
    if (!Players.get(local).isTurnActive) return;
    tries++;
    if (tries > 18 && typeof Autoplay !== "undefined") {
      emit(`ENDTURN turn${n} AUTOPLAY engaged after ${tries} tries`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      endTimer = setTimeout(endTurn, 30000); return;
    }
    safe(() => UI.Player.deselectAllUnits());
    if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTimer = setTimeout(endTurn, 5000);
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  n++; tries = 0;
  emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
  if (n > TURNS) { setTimeout(() => emit("DONE harness build finished"), 4000); return; }
  setTimeout(endTurn, 6000);
});

emit("attached build");
let beginTries = 0;
function loadStateName() {
  return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?");
}
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") { emit("LOAD GameStarted"); setTimeout(() => { run().catch((e) => emit("run threw " + e)); }, 12000); return; }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else emit("LOAD gave up");
}
setTimeout(beginPoll, 3000);
