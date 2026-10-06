// cdh-game-soak-control.js (generated from cdh-game-soak.js): the same turn rolling with the mod DISABLED.
// cdh-game-soak.js: game scope. Long soak of the SHIPPED mod with invariant checks every turn (dev only).
//
// Every turn, after the mod's own pass has run, checks what the mod promises against the live map:
//   localInner  an AI culture claim inside one of the local player's rings 1-3 (README: never)
//   district    a claim (by anyone) on an urban or city-center tile
//   center      a city-center tile owned by someone other than the city's owner (corruption)
//   stale       a claim whose tile is no longer owned by the claimant
//   pending     verbs still waiting to land, and their age
//   bytes       size of the persisted state blob
// Every SEED_EVERY turns it seeds heavy culture on contested frontier tiles, so every flip path is exercised.
// control: imports nothing from the mod

const SOAK_TURNS = 40;
const SEED_EVERY = 5;
const TAG = "[CDH]";
function emit(m) { try { console.error(TAG + " " + m); } catch (_) { /* ignore */ } }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
function js(v) { return safe(() => JSON.stringify(v), String(v)); }
let local = -1;
const owner = (l) => safe(() => GameplayMap.getOwner(l.x, l.y), -9);
const isWater = (l) => safe(() => !!GameplayMap.isWater(l.x, l.y), true);
const locOf = (i) => GameplayMap.getLocationFromIndex(i);
const dist = (a, b) => safe(() => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y), 99);
const unkey = (k) => { const [x, y] = k.split(",").map(Number); return { x, y }; };
function ring(l, r) { return safe(() => GameplayMap.getPlotIndicesInRadius(l.x, l.y, r).map(locOf), []); }
function districtName(l) {
  return safe(() => {
    const d = Districts.getAtLocation(l);
    if (!d) return "none";
    for (const k of Object.keys(DistrictTypes)) if (DistrictTypes[k] === d.type) return k;
    return "type" + d.type;
  }, "?");
}
function majors() { return safe(() => Players.getAlive().filter((p) => p.isMajor).map((p) => p.id), []); }
function allCities() {
  const out = [];
  for (const p of safe(() => Players.getAlive(), [])) for (const c of safe(() => p.Cities.getCities() || [], [])) out.push({ c, owner: p.id, loc: { x: c.location.x, y: c.location.y } });
  return out;
}
function blockerName() {
  return safe(() => {
    const b = Game.Notifications.getEndTurnBlockingType(local);
    for (const k of Object.keys(EndTurnBlockingTypes)) if (EndTurnBlockingTypes[k] === b) return k;
    return String(b);
  }, "?");
}

function seed(label) { emit(`SEED ${label}: skipped (control)`); }
function seedUnused(label) {
  const st = loadState();
  const cfg = safe(() => culturalDiffusion.config(), {});
  const maxD = Math.max(4, cfg.flipMaxDistance || 6);
  const cities = allCities();
  let n = 0;
  for (const p of majors()) {
    let mine = 0;
    for (const cr of cities.filter((c) => c.owner === p)) {
      for (const l of ring(cr.loc, maxD)) {
        if (mine >= 40) break;
        const d = dist(cr.loc, l);
        if (d < 3 || isWater(l)) continue;
        const o = owner(l);
        if (o === p) continue;
        if (!ring(l, 1).some((q) => owner(q) === p)) continue;
        const k = l.x + "," + l.y;
        st.field[k] = { ...(st.field[k] || {}), [String(p)]: 4000 };
        mine++; n++;
      }
    }
  }
  const bytes = saveState(st);
  emit(`SEED ${label}: ${n} frontier tiles seeded, state bytes=${bytes}`);
}

const seen = { localInner: new Set(), district: new Set(), center: new Set() };
function invariants(label) {
  const st = safe(() => culturalDiffusion.state(), null);
  if (!st || typeof st !== "object") { emit(`INV ${label}: no state (${st})`); return; }
  const cities = allCities();
  const localCities = cities.filter((c) => c.owner === local);
  const claims = Object.entries(st.claims || {});
  let stale = 0, localInner = 0, anyInner = 0, district = 0, byAi = 0;
  const examples = [];
  for (const [k, c] of claims) {
    const l = unkey(k);
    const o = owner(l);
    if (o !== c.by) stale++;
    if (c.by !== local) byAi++;
    if (c.by !== local && o === c.by && localCities.some((lc) => dist(lc.loc, l) <= 3)) {
      localInner++;
      if (!seen.localInner.has(k)) { seen.localInner.add(k); examples.push(`localInner ${k} by ${c.by}`); }
    }
    if (o === c.by && cities.some((cc) => cc.owner !== c.by && dist(cc.loc, l) <= 3)) anyInner++;
    const dn = districtName(l);
    if (o === c.by && /URBAN|CITY_CENTER/.test(dn)) {
      district++;
      if (!seen.district.has(k)) { seen.district.add(k); examples.push(`district ${k} ${dn} by ${c.by}`); }
    }
  }
  let center = 0;
  for (const cc of cities) {
    const o = owner(cc.loc);
    if (o !== cc.owner) {
      center++;
      const k = cc.loc.x + "," + cc.loc.y;
      if (!seen.center.has(k)) { seen.center.add(k); examples.push(`center ${k} city owner ${cc.owner} tile owner ${o}`); }
    }
  }
  const pend = Object.entries(st.pending || {});
  const bytes = safe(() => JSON.stringify(st).length, -1);
  emit(`INV ${label}: claims=${claims.length} (ai ${byAi}) stale=${stale} localInner=${localInner} anyInner=${anyInner} district=${district} center=${center} pending=${pend.length} locked=${Object.keys(st.locked || {}).length} field=${Object.keys(st.field || {}).length} occupation=${Object.keys(st.occupation || {}).length} bytes=${bytes}`);
  for (const e of examples.slice(0, 12)) emit(`INV-NEW ${label}: ${e}`);
}

let turnsSeen = 0, startTurn = -1, lastTurn = -1, lastTurnAt = 0, busy = false;
function endTurn2() {
  try {
    if (Date.now() - lastTurnAt > 90000 && typeof Autoplay !== "undefined") {
      emit(`ENDTURN stuck on turn ${safe(() => Game.turn)} blocker=${blockerName()}: one Autoplay turn`);
      safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
      lastTurnAt = Date.now();
    } else if (!busy && safe(() => Players.get(local).isTurnActive, false)) {
      safe(() => UI.Player.deselectAllUnits());
      if (!GameContext.hasSentTurnComplete()) GameContext.sendTurnComplete();
    }
  } catch (e) { emit("ENDTURN threw " + e); }
  setTimeout(endTurn2, 4000);
}
async function onNewTurn(t) {
  busy = true;
  const k = ++turnsSeen; // Game.turn restarts at 1 in a new age
  await later(9000); // the mod's pass runs on PlayerTurnActivated; let its writes land
  emit(`TURN k=${k} turn=${t} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)}`);
  invariants(`T${k}`);
  if (k >= SOAK_TURNS) { emit(`DONE harness soak-control finished, survived ${SOAK_TURNS} turns`); return; }
  if (k % SEED_EVERY === 0) seed(`T${k}`);
  busy = false;
}
function turnPoll() {
  const t = safe(() => Game.turn, -1);
  if (!busy && t !== lastTurn && safe(() => Players.get(local).isTurnActive, false)) {
    lastTurn = t; lastTurnAt = Date.now();
    onNewTurn(t).catch((e) => { emit("onNewTurn threw " + e); busy = false; });
  }
  setTimeout(turnPoll, 2000);
}
async function run() {
  local = GameContext.localPlayerID;
  startTurn = safe(() => Game.turn, 0); lastTurn = startTurn; lastTurnAt = Date.now();
  emit(`SOAK start turn=${startTurn} age=${safe(() => GameInfo.Ages.lookup(Game.age).AgeType)} local=${local} majors=${js(majors())} config=${js(safe(() => { const c = culturalDiffusion.config(); return { claimOnlyUnowned: c.claimOnlyUnowned, aiCultureFlips: c.aiCultureFlips, recedeBorders: c.recedeBorders, growthBuffer: c.growthBuffer, conquestFlip: c.conquestFlip, coreProtectRadius: c.coreProtectRadius, flipMaxDistance: c.flipMaxDistance, debug: c.debug }; }, {}))}`);
  invariants("T0-pre");
  seed("T0");
  const res = safe(() => culturalDiffusion.runNow(), "ERR");
  emit(`T0 runNow=${js(res)}`);
  await later(8000);
  invariants("T0-post");
  busy = false;
  turnPoll();
  endTurn2();
}
emit("attached soak-control");
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
