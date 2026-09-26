// cdh-game-parity.js - game scope, deployed as ui/cdh-game.js. The Civ V parity probes P1-P7 (dev only).
//
// One run answers every probe in docs/civ-v-parity-spec.md and watches the new river rule (§1) against the real
// map. Every stage prints its own VERDICT line, so the log tail answers the questions without reading the run.
//
//   P3  SURFACE   every GameplayMap member with "river" in its name, and whether any EDGE-level river read exists
//   P1  RIVERS    a whole-map scan of getRiverType / isRiver / isNavigableRiver / getRiverName: are minor rivers
//                 stored per tile, do tiles of one river share a name, do river tiles form 1-wide chains (tiles) or
//                 2-wide bands (edge flags on both banks)? Plus an 11x11 text window and a SHOT of the same spot.
//   P2  CHANNEL   isWater / terrain / isNavigableRiver / isImpassable on one navigable-river tile
//   P6  COMBAT    unit.Combat / isCombat on our own and foreign units, and the UnitMoved payload
//   P5  CAPTURE   log every CityTransfered (and city add/remove, war declarations) over the run
//   P7  DEAD      owners present on the map vs Players alive: does any defeated player still own plots?
//   P4  GOLD      Treasury.changeGoldBalance on a rival: inline, +3 s, and after a turn, then reversed
//   E   RIVER     the §1 rule end to end: clear the field, seed known stocks next to real river tiles, run ONE pass
//                 with culturalDiffusion.runNow(), read what each neighbour received. Expected with defaults
//                 (rate 0.055): follow 1.65x plain, cross 1/1.5x plain, and NOTHING crosses below 2x threshold.
//
// Seeds are placed beyond flipMaxDistance from every local city and away from our land, so a pass can never turn a
// seed into a purchasePlot. The whole field is cleared first; the run's autosaves are restored by run-harness.sh.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { stepMods } from "/cultural-diffusion/ui/cd-terrain.js";
import { diffusionDelivered } from "/cultural-diffusion/ui/cd-field.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";

const TAG = "[CDH]";
const STATE_KEY = "CulturalDiffusionState_v2";
const TURNS = 14; // run 1 used 6; the wider window gives P5 more chance of an AI-vs-AI capture
const GOLD_DELTA = 37;

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
function terrainName(l) {
  return safe(() => String(GameInfo.Terrains.lookup(GameplayMap.getTerrainType(l.x, l.y))?.TerrainType || GameplayMap.getTerrainType(l.x, l.y)), "?");
}
function biomeName(l) {
  return safe(() => String(GameInfo.Biomes.lookup(GameplayMap.getBiomeType(l.x, l.y))?.BiomeType || GameplayMap.getBiomeType(l.x, l.y)), "?");
}
function featureName(l) {
  return safe(() => { const f = GameplayMap.getFeatureType(l.x, l.y); return f < 0 ? "-" : String(GameInfo.Features.lookup(f)?.FeatureType || f); }, "?");
}
function riverName(l) { return safe(() => String(GameplayMap.getRiverName(l.x, l.y) || ""), ""); }
function riverType(l) { return safe(() => GameplayMap.getRiverType(l.x, l.y), null); }
function isNav(l) { return safe(() => !!GameplayMap.isNavigableRiver(l.x, l.y), false); }
function isRiverTile(l) { return safe(() => !!GameplayMap.isRiver(l.x, l.y), false); }
/** "N" navigable, "M" minor, "" none - the same three-way read cd-terrain.js makes. */
function kindOf(l) {
  if (isNav(l)) return "N";
  const rt = riverType(l);
  const none = safe(() => RiverTypes.NO_RIVER, 0);
  return (typeof rt === "number" && rt >= 0 && rt !== none) ? "M" : "";
}

// ---------------------------------------------------------------- P3 surface
function p3Surface() {
  const names = new Set();
  safe(() => { for (const k in GameplayMap) names.add(k); });
  safe(() => { for (const k of Object.getOwnPropertyNames(GameplayMap)) names.add(k); });
  let proto = safe(() => Object.getPrototypeOf(GameplayMap), null);
  let hops = 0;
  while (proto && proto !== Object.prototype && hops++ < 5) {
    for (const k of safe(() => Object.getOwnPropertyNames(proto), [])) names.add(k);
    proto = safe(() => Object.getPrototypeOf(proto), null);
  }
  const river = [...names].filter((n) => /river/i.test(n)).sort();
  const edge = [...names].filter((n) => /crossing|edge|direction/i.test(n)).sort();
  emit(`P3 GameplayMap members=${names.size} river=[${river.join(",")}] edgeLike=[${edge.join(",")}]`);
  for (const n of ["isRiverCrossing", "isRiverConnection", "getRiverEdge", "isRiverEdge", "getRiverFlowDirection", "isCliffCrossing", "isAdjacentToRivers", "isRiver", "getRiverType", "getRiverName", "isNavigableRiver"]) {
    emit(`P3 typeof GameplayMap.${n}=${safe(() => typeof GameplayMap[n], "?")}`);
  }
  emit(`P3 RiverTypes=${js(safe(() => RiverTypes))} DirectionTypes=${js(safe(() => DirectionTypes))}`);
  // MapRivers is used by the shipped map-utilities.js (isRiverConnectedToOcean); TerrainBuilder writes rivers.
  for (const g of ["MapRivers", "TerrainBuilder", "WorldBuilder"]) {
    const obj = safe(() => globalThis[g], undefined);
    if (!obj) { emit(`P3 ${g}: absent in the game scope`); continue; }
    const ms = new Set();
    safe(() => { for (const k in obj) ms.add(k); });
    safe(() => { for (const k of Object.getOwnPropertyNames(obj)) ms.add(k); });
    let pr = safe(() => Object.getPrototypeOf(obj), null); let hop = 0;
    while (pr && pr !== Object.prototype && hop++ < 5) { for (const k of safe(() => Object.getOwnPropertyNames(pr), [])) ms.add(k); pr = safe(() => Object.getPrototypeOf(pr), null); }
    const rv = [...ms].filter((n) => /river|crossing|edge/i.test(n)).sort();
    emit(`P3 ${g} members=${ms.size} riverLike=[${rv.join(",")}]`);
    for (const n of rv) river.push(`${g}.${n}`);
  }
  const edgeReads = river.filter((n) => /crossing|connection|edge/i.test(n));
  emit(`P3 VERDICT edge-level river read: ${edgeReads.length ? "FOUND " + edgeReads.join(",") : "NONE (tile reads only)"}`);
  return edgeReads;
}

// ---------------------------------------------------------------- P1 scan
let SCAN = null; // { w, h, at: Map key->{l,kind,name,isR,rt,own} }
function scanMap() {
  const w = safe(() => GameplayMap.getGridWidth(), 0);
  const h = safe(() => GameplayMap.getGridHeight(), 0);
  const at = new Map();
  const c = { tiles: 0, minor: 0, nav: 0, isRiverTrue: 0, isRiverNotTyped: 0, typedNotIsRiver: 0, namedMinor: 0, namedNav: 0, water: 0 };
  const names = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = { x, y };
      const kind = kindOf(l);
      const isR = isRiverTile(l);
      const name = kind ? riverName(l) : "";
      const row = { l, kind, name, isR, rt: riverType(l), own: owner(l), water: isWater(l) };
      at.set(key(l), row);
      c.tiles++;
      if (row.water) c.water++;
      if (kind === "M") { c.minor++; if (name) c.namedMinor++; }
      if (kind === "N") { c.nav++; if (name) c.namedNav++; }
      if (isR) c.isRiverTrue++;
      if (isR && !kind) c.isRiverNotTyped++;
      if (kind && !isR) c.typedNotIsRiver++;
      if (name) names.set(name, (names.get(name) || 0) + 1);
    }
  }
  SCAN = { w, h, at };
  emit(`P1 SCAN ${w}x${h} tiles=${c.tiles} water=${c.water} minor=${c.minor} navigable=${c.nav} isRiver=${c.isRiverTrue} `
    + `isRiverButNoType=${c.isRiverNotTyped} typedButNotIsRiver=${c.typedNotIsRiver} namedMinor=${c.namedMinor}/${c.minor} namedNav=${c.namedNav}/${c.nav} distinctNames=${names.size}`);
  const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([n, k]) => `${n}(${safe(() => Locale.compose(n), "?")})x${k}`);
  emit(`P1 NAMES ${top.join(" | ")}`);
  return c;
}

/** Chain (tiles) or band (edge flags on both banks)? Count, per river tile, its river neighbours of the same name. */
function connectivity(kind) {
  const hist = [0, 0, 0, 0, 0, 0, 0];
  let n = 0, diffName = 0, adjBank = 0, adjBankTrue = 0, onRiverAdj = 0, onRiverAdjTrue = 0;
  for (const row of SCAN.at.values()) {
    if (row.kind !== kind) continue;
    n++;
    let same = 0;
    for (const nb of neighbours(row.l)) {
      const r = SCAN.at.get(key(nb));
      if (!r || r.kind !== kind) continue;
      if (!row.name || !r.name || row.name === r.name) same++; else diffName++;
    }
    hist[Math.min(6, same)]++;
    if (n <= 200) {
      onRiverAdj++; if (safe(() => GameplayMap.isAdjacentToRivers(row.l.x, row.l.y, 1), null) === true) onRiverAdjTrue++;
      for (const nb of neighbours(row.l)) {
        const r = SCAN.at.get(key(nb));
        if (!r || r.kind || r.water) continue;
        adjBank++; if (safe(() => GameplayMap.isAdjacentToRivers(nb.x, nb.y, 1), null) === true) adjBankTrue++;
      }
    }
  }
  const mean = n ? hist.reduce((a, k, i) => a + k * i, 0) / n : 0;
  emit(`P1 CONNECT ${kind === "M" ? "minor" : "navigable"} tiles=${n} sameNameRiverNeighbours histogram[0..6]=${js(hist)} mean=${r2(mean)} `
    + `differentNamePairs=${diffName} isAdjacentToRivers(onRiverTile)=${onRiverAdjTrue}/${onRiverAdj} isAdjacentToRivers(bankTile)=${adjBankTrue}/${adjBank}`);
  return { n, hist, mean, diffName };
}

/** An 11x11 text window around a minor river near our cities, and a SHOT of the same spot. */
async function p1Window() {
  const cities = localCities();
  let best = null;
  for (const c of cities) {
    for (const p of inRadius(c.location, 7)) {
      const r = SCAN.at.get(key(p));
      if (!r || r.kind !== "M") continue;
      const same = neighbours(p).filter((nb) => (SCAN.at.get(key(nb)) || {}).kind === "M").length;
      if (!best || same > best.same) best = { p, same };
    }
  }
  if (!best) { emit("P1 WINDOW no minor river within 7 of a local city"); return null; }
  const cx = best.p.x, cy = best.p.y;
  const legend = new Map();
  const letter = (name) => {
    if (!name) return "-";
    if (!legend.has(name)) legend.set(name, String.fromCharCode(97 + legend.size));
    return legend.get(name);
  };
  emit(`P1 WINDOW centre=${cx},${cy} rows top(y+5)..bottom(y-5), cols x-5..x+5; kind: N navigable, M minor, ~ water, . land, then name letters`);
  for (let dy = 5; dy >= -5; dy--) {
    let k = "", nm = "";
    for (let dx = -5; dx <= 5; dx++) {
      const r = SCAN.at.get(key({ x: cx + dx, y: cy + dy }));
      if (!r) { k += " "; nm += " "; continue; }
      k += r.kind || (r.water ? "~" : ".");
      nm += r.kind ? letter(r.name) : (r.water ? "~" : ".");
    }
    emit(`P1 y=${String(cy + dy).padStart(3)} ${((cy + dy) % 2) ? " " : ""}${k}   ${((cy + dy) % 2) ? " " : ""}${nm}`);
  }
  emit(`P1 LEGEND ${[...legend.entries()].map(([n, l]) => `${l}=${n}(${safe(() => Locale.compose(n), "?")})`).join(" ")}`);
  safe(() => { Camera.lookAtPlot({ x: cx, y: cy }, { zoom: 0.25 }); });
  await later(8000);
  emit("SHOT p1-window");
  await later(4000);
  return { x: cx, y: cy };
}

// ---------------------------------------------------------------- P2 channel
function p2Channel() {
  let pick = null;
  const cities = localCities();
  for (const row of SCAN.at.values()) {
    if (row.kind !== "N") continue;
    const d = Math.min(...cities.map((c) => dist(c.location, row.l)), 99);
    if (!pick || d < pick.d) pick = { row, d };
  }
  if (!pick) { emit("P2 VERDICT no navigable river on this map (open)"); return; }
  const l = pick.row.l;
  emit(`P2 tile=${key(l)} distToOurCity=${pick.d} isWater=${safe(() => GameplayMap.isWater(l.x, l.y))} terrain=${terrainName(l)} biome=${biomeName(l)} feature=${featureName(l)} `
    + `isNavigableRiver=${safe(() => GameplayMap.isNavigableRiver(l.x, l.y))} getRiverType=${riverType(l)} isRiver=${safe(() => GameplayMap.isRiver(l.x, l.y))} `
    + `isImpassable=${safe(() => GameplayMap.isImpassable(l.x, l.y))} isLake=${safe(() => GameplayMap.isLake(l.x, l.y))} isCoastalLand=${safe(() => GameplayMap.isCoastalLand(l.x, l.y))} `
    + `name=${riverName(l)} owner=${owner(l)}`);
  emit(`P2 VERDICT navigable tile isWater=${isWater(l)} -> ${isWater(l) ? "WATER to the engine (cd-terrain must keep its river override)" : "NOT water (Terrains.Water=0 holds at runtime)"}`);
}

// ---------------------------------------------------------------- P6 combat
const moved = { total: 0, local: 0, foreign: 0, logged: 0, combatTrue: 0, combatFalse: 0, combatUnknown: 0 };
function describeUnit(u) {
  return safe(() => {
    const type = String(GameInfo.Units.lookup(u.type)?.UnitType || u.type);
    const combat = u.Combat;
    return `${type} owner=${u.owner} at=${js(u.location)} typeofCombat=${typeof combat} isCombat=${safe(() => combat?.isCombat, "?")} canAttack=${safe(() => combat?.canAttack, "?")} `
      + `unit.isCombat=${safe(() => u.isCombat, "?")} strength=${safe(() => combat?.getMeleeStrength?.() ?? combat?.meleeStrength, "?")}`;
  }, "ERR");
}
function p6Units() {
  const alive = safe(() => Players.getAlive(), []);
  let shown = 0;
  for (const p of alive) {
    const units = safe(() => p.Units.getUnits() || [], []);
    for (const u of units.slice(0, p.id === local ? 6 : 2)) {
      emit(`P6 ${p.id === local ? "OWN" : "FOREIGN"} ${describeUnit(u)}`);
      shown++;
    }
    if (shown > 30) break;
  }
  safe(() => engine.on("UnitMoved", (d) => {
    moved.total++;
    const u = safe(() => Units.get(d.unit), null);
    const own = safe(() => u?.owner, null);
    if (own === local) moved.local++; else moved.foreign++;
    const ic = safe(() => u?.Combat?.isCombat, undefined);
    if (ic === true) moved.combatTrue++; else if (ic === false) moved.combatFalse++; else moved.combatUnknown++;
    if (moved.logged < 8) { moved.logged++; emit(`P6 UnitMoved keys=${js(Object.keys(d || {}))} unit=${js(d?.unit)} loc=${js(d?.location)} -> ${u ? describeUnit(u) : "Units.get failed"}`); }
  }));
}

// ---------------------------------------------------------------- P5 capture + P7 dead
const events = { CityTransfered: 0, CityAddedToMap: 0, CityRemovedFromMap: 0, PlayerDefeat: 0, DiplomacyDeclareWar: 0 };
function p5Subscribe() {
  for (const ev of Object.keys(events)) {
    safe(() => engine.on(ev, (d) => {
      events[ev]++;
      const own = safe(() => d?.cityID?.owner ?? d?.owner ?? d?.player, "?");
      if (ev === "CityTransfered" || events[ev] <= 3) {
        const c = safe(() => Cities.get(d.cityID), null);
        emit(`P5 ${ev} #${events[ev]} owner=${own} local=${own === local} from=${js(d?.fromPlayer)} city=${safe(() => Locale.compose(c.name), "?")} at=${js(safe(() => c?.location))} `
          + `fromIsMajor=${safe(() => Players.get(d.fromPlayer)?.isMajor, "?")} payload=${js(d).slice(0, 300)}`);
      }
    }));
  }
}
function p7Dead() {
  const alive = safe(() => Players.getAlive().map((p) => p.id), []);
  const ever = safe(() => Players.getEverAlive?.().map((p) => p.id), null);
  const owners = new Map();
  for (const row of SCAN.at.values()) if (row.own >= 0) owners.set(row.own, (owners.get(row.own) || 0) + 1);
  const rows = [...owners.entries()].map(([pid, n]) => {
    const p = safe(() => Players.get(pid), null);
    return `${pid}:${n}tiles alive=${safe(() => p?.isAlive, "?")} major=${safe(() => p?.isMajor, "?")} cities=${safe(() => p?.Cities?.getCities()?.length, "?")}`;
  });
  emit(`P7 alive=${js(alive)} everAlive=${js(ever)} plotOwners=[${rows.join(" ; ")}]`);
  const dead = [...owners.keys()].filter((pid) => safe(() => Players.get(pid)?.isAlive, true) === false);
  const defeated = (ever || []).filter((pid) => alive.indexOf(pid) < 0);
  for (const pid of new Set([...dead, ...defeated])) {
    const p = safe(() => Players.get(pid), null);
    emit(`P7 player ${pid}: isAlive=${safe(() => p?.isAlive)} isMajor=${safe(() => p?.isMajor)} isMinor=${safe(() => p?.isMinor)} isIndependent=${safe(() => p?.isIndependent)} `
      + `civ=${safe(() => GameInfo.Civilizations.lookup(p.civilizationType)?.CivilizationType, "?")} leader=${safe(() => GameInfo.Leaders.lookup(p.leaderType)?.LeaderType, "?")} `
      + `cities=${safe(() => p?.Cities?.getCities()?.length, "?")} everAliveIncludes=${(ever || []).indexOf(pid) >= 0}`);
    const plots = [...SCAN.at.values()].filter((r) => r.own === pid).map((r) => r.l);
    for (const l of plots.slice(0, 12)) {
      emit(`P7 plot ${key(l)} owner=${owner(l)} owningCity=${js(safe(() => GameplayMap.getOwningCityFromXY(l.x, l.y)))} district=${safe(() => { const d = Districts.getAtLocation(l); return d ? String(GameInfo.Districts.lookup(d.type)?.DistrictType) : "-"; }, "?")} `
        + `terrain=${terrainName(l)} distToOurCity=${minCityDist(l)}`);
    }
  }
  emit(`P7 VERDICT defeated players=${js(defeated)} dead owners still holding plots=${js(dead.map((pid) => pid + ":" + owners.get(pid)))} `
    + (defeated.length ? (dead.length ? "-> a defeated player KEEPS plots" : "-> defeated players hold NO plots") : "-> no defeated player in this save; open"));
}

// ---------------------------------------------------------------- P4 gold
// Run 1: Treasury.changeGoldBalance(+37) on rival 1 changed NOTHING (inline, +3 s, and the across-turn delta was
// exactly the rival's own net income), and the -37 reversal did nothing either. Run 2 adds the controls that
// make that a verdict: the same verb on the LOCAL player (the mod's own refund path), the grantYield fallback on
// the rival, and a member listing of both Treasury objects.
const gold = { pid: -1, trials: [], expectedNet: null };
function goldOf(pid) { return safe(() => Players.get(pid).Treasury.goldBalance, null); }
function netGold(pid) {
  return safe(() => {
    const p = Players.get(pid);
    const yt = YieldTypes.YIELD_GOLD;
    return p.Stats?.getNetYield?.(yt) ?? p.Treasury?.goldYield ?? p.Treasury?.getNetGold?.() ?? "?";
  }, "?");
}
function members(obj) {
  const ms = new Set();
  safe(() => { for (const k in obj) ms.add(k); });
  let pr = safe(() => Object.getPrototypeOf(obj), null); let hop = 0;
  while (pr && pr !== Object.prototype && hop++ < 5) { for (const k of safe(() => Object.getOwnPropertyNames(pr), [])) ms.add(k); pr = safe(() => Object.getPrototypeOf(pr), null); }
  return [...ms].sort();
}
async function trial(label, pid, apply) {
  const g0 = goldOf(pid);
  const ret = safe(() => apply(), "THREW");
  const g1 = goldOf(pid);
  await later(3000);
  const g2 = goldOf(pid);
  const t = { label, pid, g0, g1, g2, ret };
  gold.trials.push(t);
  emit(`P4 ${label} pid=${pid} returned=${js(ret)} g0=${r2(g0)} inline=${r2(g1 - g0)} at+3s=${r2(g2 - g0)}`);
  return t;
}
async function p4Gold() {
  const rival = safe(() => Players.getAlive().find((p) => p.id !== local && p.isMajor && (p.Cities?.getCities()?.length || 0) > 0), null);
  if (!rival) { emit("P4 VERDICT no rival major alive; open"); return; }
  gold.pid = rival.id;
  emit(`P4 Treasury members local=[${members(safe(() => Players.get(local).Treasury, {})).join(",")}]`);
  emit(`P4 Treasury members rival=[${members(safe(() => rival.Treasury, {})).join(",")}] Players.grantYield=${typeof Players.grantYield}`);
  emit(`P4 rival=${rival.id} gold=${r2(goldOf(rival.id))} net/turn=${netGold(rival.id)} local gold=${r2(goldOf(local))} net/turn=${netGold(local)}`);
  // control: the verb the mod uses on OUR OWN treasury
  await trial("A local changeGoldBalance(+37)", local, () => Players.get(local).Treasury.changeGoldBalance(GOLD_DELTA));
  await trial("A' local changeGoldBalance(-37) restore", local, () => Players.get(local).Treasury.changeGoldBalance(-GOLD_DELTA));
  // the rival, both verbs
  await trial("B rival changeGoldBalance(+37)", rival.id, () => rival.Treasury.changeGoldBalance(GOLD_DELTA));
  await trial("C rival Players.grantYield(GOLD,+37)", rival.id, () => Players.grantYield(rival.id, YieldTypes.YIELD_GOLD, GOLD_DELTA));
  gold.expectedNet = netGold(rival.id);
  gold.gBeforeTurn = goldOf(rival.id);
}
function p4AfterTurn() {
  if (gold.pid < 0) return;
  const g3 = goldOf(gold.pid);
  const delta = g3 - gold.gBeforeTurn;
  emit(`P4 rival across the turn: before=${r2(gold.gBeforeTurn)} after=${r2(g3)} delta=${r2(delta)} ownNetIncome=${gold.expectedNet} (a landed grant would show as delta - income = ${r2(delta - (typeof gold.expectedNet === "number" ? gold.expectedNet : 0))})`);
  // reverse whatever landed so the rival is left as found
  for (const t of gold.trials) {
    if (t.pid !== gold.pid || !(Math.abs(t.g2 - t.g0) > 0.01)) continue;
    if (t.label.startsWith("B")) safe(() => Players.get(gold.pid).Treasury.changeGoldBalance(-GOLD_DELTA));
    if (t.label.startsWith("C")) safe(() => Players.grantYield(gold.pid, YieldTypes.YIELD_GOLD, -GOLD_DELTA));
  }
  const say = (t) => `${t.label.split(" ")[0]}=${Math.abs(t.g2 - t.g0) > 0.01 ? "LANDED" : "NO"}`;
  emit(`P4 VERDICT ${gold.trials.map(say).join(" ")} => ` + (gold.trials.some((t) => t.pid === gold.pid && Math.abs(t.g2 - t.g0) > 0.01)
    ? "gold CAN be granted to an AI (see which verb)"
    : (gold.trials[0] && Math.abs(gold.trials[0].g2 - gold.trials[0].g0) > 0.01 ? "NEITHER verb reaches an AI treasury from the UI context, although the same verb moves OUR gold" : "no verb moved any gold, including ours - the read or the verb is off")));
}

// ---------------------------------------------------------------- E river field
function readField() {
  return safe(() => { const raw = Configuration.getGame().getValue(STATE_KEY); const s = raw ? JSON.parse(raw) : null; return (s && (s.data || s)).field || {}; }, {});
}
function writeSeeds(seeds) {
  const field = {};
  for (const [k, v] of Object.entries(seeds)) field[k] = { [String(local)]: v };
  safe(() => { Configuration.editGame().setValue(STATE_KEY, JSON.stringify({ v: 2, data: { field, claims: {}, locked: {}, pending: {}, monoTurn: 0 } })); });
}
function stockAt(field, l) { return (field[key(l)] && field[key(l)][String(local)]) || 0; }
function minCityDist(l) { return Math.min(...localCities().map((c) => dist(c.location, l)), 99); }
function landNoRiver(l) { const r = SCAN.at.get(key(l)); return !!r && !r.kind && !r.water && !safe(() => GameplayMap.isImpassable(l.x, l.y), false); }
/** The LIVE config (a preset chosen in Options can raise the bar or shrink the field), else the shipped one. */
let cfg = CONFIG;
function inRegionSafe(l) {
  // inside the field (<= fieldRadius of a local city), away from centres, not ours and not touching our land
  const d = minCityDist(l);
  if (d > cfg.fieldRadius - 1 || d < 3) return false;
  if (owner(l) === local) return false;
  return !neighbours(l).some((n) => owner(n) === local);
}
function farFrom(l, used) { return used.every((u) => dist(u, l) >= 4); }
/** A plain step: not blocked and no terrain modifier at all, so the control tile measures the bare rate. */
function plainStep(src, dst, v) { const m = stepMods(src, dst, v, cfg); return !m.blocked && m.bonus === 0 && m.malus === 0 && m.maxFactor === 1; }
/** Prefer a neighbour whose step carries no terrain malus; fall back to any that passes `ok`. */
function pick(nbs, ok, src, v) { return nbs.find((n) => ok(n) && !stepMods(src, n, v, cfg).blocked && stepMods(src, n, v, cfg).malus === 0) || nbs.find(ok); }

/** A river tile with a same-kind, same-name river neighbour and a plain no-river land neighbour. */
function findFollowSite(kind, used, v) {
  for (const row of SCAN.at.values()) {
    if (row.kind !== kind || !inRegionSafe(row.l) || !farFrom(row.l, used)) continue;
    const nbs = neighbours(row.l);
    if (nbs.some((n) => owner(n) === local)) continue;
    const sameRiver = (n) => { const r = SCAN.at.get(key(n)); return !!r && r.kind === kind && (!r.name || !row.name || r.name === row.name); };
    const r1 = pick(nbs, sameRiver, row.l, v);
    // Run 1 picked a same-river tile under rainforest, whose feature gate (4.5x) blocks at 299 and hid the follow
    // bonus. A follow site is only usable when the follow step itself is open.
    if (!r1 || stepMods(row.l, r1, v, cfg).blocked) continue;
    const k = nbs.find((n) => landNoRiver(n) && plainStep(row.l, n, v));
    if (k) return { r0: row.l, r1, k, name: row.name };
  }
  return null;
}
/** A no-river land tile with a river neighbour of `kind` and a plain no-river land neighbour. */
function findCrossSite(kind, used, v) {
  for (const row of SCAN.at.values()) {
    if (row.kind || row.water || !inRegionSafe(row.l) || !farFrom(row.l, used)) continue;
    if (!landNoRiver(row.l)) continue;
    const nbs = neighbours(row.l);
    const r = pick(nbs, (n) => (SCAN.at.get(key(n)) || {}).kind === kind, row.l, v);
    const l = nbs.find((n) => landNoRiver(n) && plainStep(row.l, n, v));
    if (r && l) return { b: row.l, r, l };
  }
  return null;
}
function modsLine(label, src, dst, v) {
  const m = stepMods(src, dst, v, cfg);
  return `${label} ${key(src)}->${key(dst)} [${terrainName(dst)}/${biomeName(dst)}/${featureName(dst)} kind=${kindOf(dst)} name=${riverName(dst)}] `
    + `blocked=${m.blocked} bonus=${r2(m.bonus)} malus=${r2(m.malus)} maxFactor=${r2(m.maxFactor)} expect=${r2(diffusionDelivered(v, 0, m, cfg))}`;
}

async function riverField() {
  cfg = safe(() => culturalDiffusion.config(), null) || CONFIG;
  const age = currentAgeKey();
  const bar = cfg.minimumOwner * ((cfg.byAge && cfg.byAge[age] && cfg.byAge[age].ownerBar) || 1);
  const used = [];
  const plan = {};
  const seeds = {};
  const STRONG = Math.min(299, Math.floor(bar) - 1); // above the 2x river gate (200), below the ownership bar
  const WEAK = 150;   // above the diffusion threshold (100), below the river gate
  emit(`E CFG age=${age} bar=${bar} STRONG=${STRONG} fieldRadius=${cfg.fieldRadius} rate=${cfg.diffusionRate} threshold=${cfg.cultureThreshold} riverCross=${js(cfg.terrainRiverCross)} navFollow=${cfg.navigableFollowBonus}/${cfg.navigableFollowMax}`);
  const minorCross = findCrossSite("M", used, WEAK);
  if (minorCross) { used.push(minorCross.b); plan.minorCross = minorCross; seeds[key(minorCross.b)] = WEAK; }
  const minorFollow = findFollowSite("M", used, STRONG);
  if (minorFollow) { used.push(minorFollow.r0); plan.minorFollow = minorFollow; seeds[key(minorFollow.r0)] = STRONG; }
  const minorCrossStrong = findCrossSite("M", used, STRONG);
  if (minorCrossStrong) { used.push(minorCrossStrong.b); plan.minorCrossStrong = minorCrossStrong; seeds[key(minorCrossStrong.b)] = STRONG; }
  const navFollow = findFollowSite("N", used, STRONG);
  if (navFollow) { used.push(navFollow.r0); plan.navFollow = navFollow; seeds[key(navFollow.r0)] = STRONG; }
  const navCross = findCrossSite("N", used, STRONG);
  if (navCross) { used.push(navCross.b); plan.navCross = navCross; seeds[key(navCross.b)] = STRONG; }
  emit(`E PLAN sites=${js(Object.keys(plan))} seeds=${js(seeds)}`);
  if (!Object.keys(plan).length) { emit("E VERDICT no usable river site in the field region; open"); return; }

  // What cd-terrain classifies each real step as, before the pass runs.
  if (plan.minorCross) { emit("E MODS " + modsLine("minorCross bank->river(weak)", plan.minorCross.b, plan.minorCross.r, WEAK)); emit("E MODS " + modsLine("minorCross bank->land(weak)", plan.minorCross.b, plan.minorCross.l, WEAK)); }
  if (plan.minorFollow) { emit("E MODS " + modsLine("minorFollow river->river", plan.minorFollow.r0, plan.minorFollow.r1, STRONG)); emit("E MODS " + modsLine("minorFollow river->land", plan.minorFollow.r0, plan.minorFollow.k, STRONG)); }
  if (plan.minorCrossStrong) { emit("E MODS " + modsLine("minorCrossStrong bank->river", plan.minorCrossStrong.b, plan.minorCrossStrong.r, STRONG)); emit("E MODS " + modsLine("minorCrossStrong bank->land", plan.minorCrossStrong.b, plan.minorCrossStrong.l, STRONG)); }
  if (plan.navFollow) { emit("E MODS " + modsLine("navFollow river->river", plan.navFollow.r0, plan.navFollow.r1, STRONG)); emit("E MODS " + modsLine("navFollow river->land", plan.navFollow.r0, plan.navFollow.k, STRONG)); }
  if (plan.navCross) { emit("E MODS " + modsLine("navCross bank->river", plan.navCross.b, plan.navCross.r, STRONG)); emit("E MODS " + modsLine("navCross bank->land", plan.navCross.b, plan.navCross.l, STRONG)); }

  const before = readField();
  emit(`E FIELD before: tiles=${Object.keys(before).length} (cleared and re-seeded now)`);
  writeSeeds(seeds);
  const res = safe(() => culturalDiffusion.runNow(), "ERR");
  const f = readField();
  emit(`E PASS runNow=${js(res)} fieldTiles=${Object.keys(f).length}`);
  const v = {};
  // actual stock received, next to what cd-field predicts for that step at the seed value (unpaced); the
  // actual/expected ratio should be the same constant (the age pace) on every line, or the map read differs
  const rep = (label, l, src, seed) => {
    const s = stockAt(f, l); v[label] = s;
    const e = diffusionDelivered(seed, 0, stepMods(src, l, seed, cfg), cfg);
    return `${label}=${r2(s)} (expect ${r2(e)}, x${e ? r2(s / e) : "-"})`;
  };
  const P = plan;
  if (P.minorCross) emit(`E READ minorCross(weak ${WEAK}): seed=${r2(stockAt(f, P.minorCross.b))} ${rep("mcRiver", P.minorCross.r, P.minorCross.b, WEAK)} ${rep("mcLand", P.minorCross.l, P.minorCross.b, WEAK)}`);
  if (P.minorFollow) emit(`E READ minorFollow(${STRONG}): seed=${r2(stockAt(f, P.minorFollow.r0))} ${rep("mfRiver", P.minorFollow.r1, P.minorFollow.r0, STRONG)} ${rep("mfLand", P.minorFollow.k, P.minorFollow.r0, STRONG)}`);
  if (P.minorCrossStrong) emit(`E READ minorCrossStrong(${STRONG}): seed=${r2(stockAt(f, P.minorCrossStrong.b))} ${rep("msRiver", P.minorCrossStrong.r, P.minorCrossStrong.b, STRONG)} ${rep("msLand", P.minorCrossStrong.l, P.minorCrossStrong.b, STRONG)}`);
  if (P.navFollow) emit(`E READ navFollow(${STRONG}): seed=${r2(stockAt(f, P.navFollow.r0))} ${rep("nfRiver", P.navFollow.r1, P.navFollow.r0, STRONG)} ${rep("nfLand", P.navFollow.k, P.navFollow.r0, STRONG)}`);
  if (P.navCross) emit(`E READ navCross(${STRONG}): seed=${r2(stockAt(f, P.navCross.b))} ${rep("ncRiver", P.navCross.r, P.navCross.b, STRONG)} ${rep("ncLand", P.navCross.l, P.navCross.b, STRONG)}`);

  const verdicts = [];
  if (plan.minorCross) verdicts.push(`gate: river got ${r2(v.mcRiver)} land got ${r2(v.mcLand)} => ${v.mcRiver === 0 && v.mcLand > 0 ? "HELD (nothing crosses below 2x threshold)" : "FAILED"}`);
  if (plan.minorFollow) verdicts.push(`minor follow/land ratio=${r2(v.mfLand ? v.mfRiver / v.mfLand : NaN)} (expect ~1.65, old rule 1.65 too) => ${v.mfRiver > v.mfLand ? "along>plain" : "FAILED"}`);
  if (plan.minorCrossStrong) verdicts.push(`minor cross/land ratio=${r2(v.msLand ? v.msRiver / v.msLand : NaN)} (expect ~0.67; OLD rule gave 1.65) => ${v.msRiver > 0 && v.msRiver < v.msLand ? "across<plain HELD" : "FAILED"}`);
  if (plan.navFollow) verdicts.push(`navigable follow/land ratio=${r2(v.nfLand ? v.nfRiver / v.nfLand : NaN)} (expect ~2.0) => ${v.nfRiver > v.nfLand ? "along>plain" : "FAILED"}`);
  if (plan.navCross) verdicts.push(`navigable cross/land ratio=${r2(v.ncLand ? v.ncRiver / v.ncLand : NaN)} (expect ~0.67) => ${v.ncRiver > 0 && v.ncRiver < v.ncLand ? "across<plain HELD" : "FAILED"}`);
  for (const line of verdicts) emit("E VERDICT " + line);
}

// ---------------------------------------------------------------- turns
let n = 0; let endTurnTimer = null; let blockedTries = 0;
function endTurn() {
  try {
    const me = Players.get(local);
    if (!me.isTurnActive || GameContext.hasSentTurnComplete()) return;
    const b = String(Game.Notifications.getEndTurnBlockingType(local));
    if (b !== String(EndTurnBlockingTypes.NONE)) {
      blockedTries++;
      if (blockedTries >= 3 && typeof Autoplay !== "undefined") {
        safe(() => { Autoplay.setTurns(1); Autoplay.setReturnAsPlayer(local); Autoplay.setObserveAsPlayer(local); Autoplay.setActive(true); });
        blockedTries = 0; endTurnTimer = setTimeout(endTurn, 30000); return;
      }
      endTurnTimer = setTimeout(endTurn, 4000); return;
    }
    safe(() => UI.Player.deselectAllUnits()); GameContext.sendTurnComplete();
  } catch (e) { emit("ENDTURN threw " + e); }
  endTurnTimer = setTimeout(() => { if (safe(() => Players.get(local).isTurnActive, false) && !GameContext.hasSentTurnComplete()) endTurn(); }, 12000);
}
function finish() {
  emit(`P6 VERDICT UnitMoved total=${moved.total} local=${moved.local} foreign=${moved.foreign} Combat.isCombat true=${moved.combatTrue} false=${moved.combatFalse} unknown=${moved.combatUnknown} `
    + `=> ${moved.total === 0 ? "no UnitMoved seen (open)" : (moved.combatUnknown === moved.total ? "unit not classifiable from the event" : "a moved unit CAN be classed combat/civilian via Units.get(d.unit).Combat.isCombat")}`);
  emit(`P5 VERDICT over ${n - 1} turns: CityTransfered=${events.CityTransfered} CityAddedToMap=${events.CityAddedToMap} CityRemovedFromMap=${events.CityRemovedFromMap} PlayerDefeat=${events.PlayerDefeat} DiplomacyDeclareWar=${events.DiplomacyDeclareWar} `
    + `=> ${events.CityTransfered ? "CityTransfered fired in the UI context (see payload owners)" : "no capture happened in this window; AI-vs-AI delivery still open"}`);
  emit("DONE harness parity finished");
}
engine.on("PlayerTurnActivated", (d) => {
  const who = d && (d.player ?? d.Player);
  if (who !== GameContext.localPlayerID || n === 0) return;
  if (endTurnTimer) { clearTimeout(endTurnTimer); endTurnTimer = null; }
  n++; blockedTries = 0;
  emit(`TURN n=${n} turn=${safe(() => Game.turn)}`);
  if (n === 2) setTimeout(p4AfterTurn, 3000);
  if (n > TURNS) { setTimeout(finish, 6000); return; }
  setTimeout(endTurn, 8000);
});

async function run() {
  local = GameContext.localPlayerID;
  emit(`PARITY start turn=${safe(() => Game.turn)} local=${local} age=${safe(() => GameInfo.Ages.lookup(Game.age)?.AgeType, "?")} cities=${localCities().length}`);
  p5Subscribe();
  p3Surface();
  scanMap();
  connectivity("M");
  connectivity("N");
  p2Channel();
  p7Dead();
  p6Units();
  await p1Window();
  await riverField();
  await p4Gold();
  n = 1;
  setTimeout(endTurn, 3000);
}

emit("attached parity");
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
