// cd-pressure-lens.js
//
// The Cultural Pressure lens: a read-only map overlay that tints every simulated frontier tile whose
// leading culture differs from its owner in the leader's banner color, deepening as the tile nears
// capture. Pressure is read off the persisted culture field and scored with the same flip gates the
// pass uses (cd-field pressureVerdict), age-adjusted, so the map and the sim agree. It never touches
// ownership. Self-registers from its own <UIScripts> entry in the HUD context (LensManager/WorldUI).

import LensManager from "/core/ui/lenses/lens-manager.js";
import { loadState, tileClaimBy } from "/cultural-diffusion/ui/cd-state.js";
import { pressureVerdict, passCanAct } from "/cultural-diffusion/ui/cd-field.js";
import { ownerAt, localPlayerId } from "/cultural-diffusion/ui/cd-plots.js";
import { ageContext } from "/cultural-diffusion/ui/cd-age-config.js";
import { applyTunableOverrides, getPressureLensEnabled } from "/cultural-diffusion/ui/cd-settings.js";
import { localCityList, cityListOf, claimInScope, claimGateBlocked } from "/cultural-diffusion/ui/cd-eligibility.js";
import { isMajorPlayer, withCentreCache } from "/cultural-diffusion/ui/cd-borders.js";
import { civDisplayColor, hexToFloat4 } from "/cultural-diffusion/ui/cd-lens-colors.js";

export const LENS = "cd-pressure-lens";
const LAYER = "cd-pressure-layer";
const HEX_GRID = 1; // OVERLAY_PRIORITY.HEX_GRID, inlined
const FALLBACK_HEX = "#c9a24c"; // the mod's gold, when a contender's banner color can't be resolved
// Alpha ramps with capture progress so the frontier reads faint->vivid as tiles near a flip.
const MIN_ALPHA = 0.18;
const MAX_ALPHA = 0.78;
// Skip near-zero-pressure tiles so the overlay marks the genuine contested front, not every field tile.
const MIN_PROGRESS = 0.08;

function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/**
 * A copy of CONFIG with the ownership bar raised for the current age, matching the pass's ageContext
 * (cd-pass.js), so the verdict the lens computes matches what the pass would decide this turn. Also
 * pulls the player's saved preset into CONFIG first (the HUD isolate boots CONFIG at its shipped defaults).
 * @returns {import("/cultural-diffusion/ui/cd-config.js").CdConfig} Age-adjusted config.
 */
function ageAdjustedCfg() {
  try {
    applyTunableOverrides();
  } catch (_) {
    /* Options layer unavailable in this context; fall back to CONFIG defaults. */
  }
  return ageContext().ageCfg;
}

function aliveIds() {
  /** @type {Set<number>} */
  const set = new Set();
  try {
    const alive = typeof Players !== "undefined" && Players.getAlive ? Players.getAlive() : null;
    if (Array.isArray(alive)) for (const p of alive) if (p && typeof p.id === "number") set.add(p.id);
  } catch (_) {
    /* ignore */
  }
  return set;
}

/** Civ ids that appear in the field but no longer have a living player (their stock is ignored). */
function deadOwnersOf(field, alive) {
  if (!alive.size) return []; // couldn't read alive players: don't wrongly treat everyone as dead
  /** @type {number[]} */
  const dead = [];
  for (const k of Object.keys(field)) {
    for (const civ of Object.keys(field[k])) {
      const pid = parseInt(civ, 10);
      if (!alive.has(pid) && dead.indexOf(pid) < 0) dead.push(pid);
    }
  }
  return dead;
}

function lensState() {
  try {
    const st = loadState();
    return { field: st.field || {}, claims: st.claims || {}, state: st };
  } catch (_) {
    return null;
  }
}

/**
 * Every simulated tile with a border shift the pass can make (passCanAct: our culture leading, or with recede on a
 * rival leading on a tile the mod claimed for us) and non-trivial capture progress. Each entry carries the leader
 * (for color) and the progress (for alpha).
 * @returns {{x:number, y:number, leader:number, progress:number}[]} Contested tiles.
 */
function pressureTiles() {
  const st = lensState();
  if (!st) return [];
  const { field, claims } = st;
  const cfg = ageAdjustedCfg();
  const me = localPlayerId();
  const dead = deadOwnersOf(field, aliveIds());
  const env = { field, claims, cfg, me, dead, ctx: { me, cities: localCityList(me), state: st.state, cfg },
    ctxFor: leaderContexts(st.state, cfg) };
  /** @type {{x:number, y:number, leader:number, progress:number}[]} */
  const out = [];
  // Every contested rival tile asks whether it sits in a protected core; read the settlement centers once.
  withCentreCache(() => {
    for (const k of Object.keys(field)) {
      const entry = contestedEntry(k, env);
      if (entry) out.push(entry);
    }
  });
  return out.concat(leaningCentres(st.state, cfg));
}

/**
 * A settlement's center never flips as a tile; it shows the settlement's own progress instead: the leader's color,
 * deepening with each pass of clear culture toward cityFlipHoldPasses (cd-city-flip.js).
 * @param {*} state Saved state. @param {*} cfg Live config.
 * @returns {{x:number, y:number, leader:number, progress:number}[]} One entry per leaning settlement.
 */
function leaningCentres(state, cfg) {
  if (!cfg.cityFlips || !state || !state.cityHold) return [];
  const need = Math.max(1, Math.floor(cfg.cityFlipHoldPasses));
  return Object.keys(state.cityHold).map((k) => {
    const loc = unkey(k);
    const h = state.cityHold[k];
    return { x: loc.x, y: loc.y, leader: h.by, progress: Math.min(1, h.n / need) };
  }).filter((e) => isFinite(e.x) && isFinite(e.y));
}

/**
 * One field tile as a lens entry, or null when the pass could never act on it: passCanAct (with AI flips on,
 * another major that leads is a claimant too), enough progress, and every claim gate asked for whoever would claim.
 */
function contestedEntry(k, env) {
  const { field, claims, cfg, me, dead } = env;
  const loc = unkey(k);
  if (!isFinite(loc.x) || !isFinite(loc.y)) return null;
  const owner = ownerAt(loc);
  const v = pressureVerdict(field[k], owner, dead, cfg);
  const aiLead = aiLeads(v.leader, me, cfg);
  const flags = { recede: cfg.recedeBorders, aiFlips: aiLead };
  if (!passCanAct(v.leader, owner, me, tileClaimBy(claims[k], me), flags)) return null;
  if (v.progress < MIN_PROGRESS) return null;
  if (v.leader === me && !claimable(loc, owner, env.ctx)) return null; // ...nor on a tile every other gate refuses
  if (aiLead && !claimable(loc, owner, env.ctxFor(v.leader))) return null;
  return { x: loc.x, y: loc.y, leader: v.leader, progress: v.progress };
}

function aiLeads(leader, me, cfg) {
  return !!cfg.aiCultureFlips && leader >= 0 && leader !== me && isMajorPlayer(leader);
}

/** A cached eligibility context per leading player (its own city list), for the AI-flip gates. */
function leaderContexts(state, cfg) {
  /** @type {Map<number, *>} */
  const cache = new Map();
  return (pid) => {
    if (!cache.has(pid)) cache.set(pid, { me: pid, cities: cityListOf(pid), state, cfg });
    return cache.get(pid);
  };
}

/**
 * Whether the pass could actually take this tile, asking cd-eligibility rather than a private copy of the
 * rules; the lens used to tint a rival's protected core, a war front, a tile out of range or on cooldown,
 * and (once minor settlements gained a protection floor) a city-state's ring-1 that would never resolve.
 * Only asked for tiles our culture leads; a recede cession is the recede step's business, not this gate's.
 * @param {{x:number,y:number}} loc Plot. @param {number} owner Current owner. @param {*} ctx Lens context.
 * @returns {boolean} True when the pass could claim it.
 */
function claimable(loc, owner, ctx) {
  if (!claimInScope(loc, ctx)) return false;
  return !claimGateBlocked(loc, owner, ctx.me, ctx.cfg, { cities: ctx.cities });
}

/** Quantize a leader + progress into a small key so near-identical fills share one addPlots batch. */
function batchKey(leader, progress) {
  return leader + ":" + Math.round(progress * 12); // ~12 alpha steps per contender
}

/**
 * Group contested tiles into a handful of (leader color x progress-alpha) batches, so the overlay is
 * painted in a few addPlots calls instead of one per tile.
 * @param {{x:number, y:number, leader:number, progress:number}[]} tiles Contested tiles.
 * @returns {{fill:*, plots:{x:number,y:number}[]}[]} Fill batches.
 */
function batches(tiles) {
  /** @type {Map<string, {fill:*, plots:{x:number,y:number}[]}>} */
  const groups = new Map();
  for (const t of tiles) {
    const key = batchKey(t.leader, t.progress);
    let g = groups.get(key);
    if (!g) {
      const alpha = MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * t.progress;
      g = { fill: hexToFloat4(civDisplayColor(t.leader, FALLBACK_HEX), alpha), plots: [] };
      groups.set(key, g);
    }
    g.plots.push({ x: t.x, y: t.y });
  }
  return [...groups.values()];
}

/** @type {{turn:number, batches:*[]}|null} Per-turn cache of the batched paints. */
let _cache = null;

function lensTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : -1;
  } catch (_) {
    return -1;
  }
}

/** The batched paints, memoized for the current turn (toggling off/on within a turn reuses them). */
function cachedBatches() {
  const t = lensTurn();
  if (_cache && _cache.turn === t) return _cache.batches;
  const b = batches(pressureTiles());
  _cache = { turn: t, batches: b };
  return b;
}

/** The lens layer: an overlay of plot fills colored by the contender about to take each frontier tile. */
class PressureLensLayer {
  constructor() {
    this.group = WorldUI.createOverlayGroup("CdPressureOverlay", HEX_GRID);
    this.overlay = this.group.addPlotOverlay();
  }

  clear() {
    this.group.clearAll();
    this.overlay.clear();
  }

  /** Lens-layer lifecycle: init (no-op; built in the constructor). */
  initLayer() {}

  /** Lens-layer lifecycle: paint each contested tile in its contender's color at a progress alpha. */
  applyLayer() {
    this.clear();
    for (const b of cachedBatches()) {
      if (!b.plots.length) continue;
      try {
        this.overlay.addPlots(b.plots, { fillColor: b.fill });
      } catch (e) {
        console.error("[CulturalDiffusion.lens] addPlots failed", e); // one bad batch must not kill the lens
      }
    }
  }

  removeLayer() {
    this.clear();
  }
}

/** The lens: the pressure layer plus the hex grid. */
class PressureLens {
  constructor() {
    this.activeLayers = new Set([LAYER, "fxs-hexgrid-layer"]);
    this.allowedLayers = new Set([]);
  }
}

/** Decorates the base `lens-panel` to add a "Cultural Pressure" radio button next to the built-in lenses. */
class PressureLensPanelDecorator {
  /** @param {*} component The lens-panel component. */
  constructor(component) {
    this.component = component;
  }

  beforeAttach() {}

  /** Add the Cultural Pressure lens button once the panel exists (unless disabled in Options). */
  afterAttach() {
    try {
      if (!getPressureLensEnabled()) return;
      this.component.createLensButton("LOC_CD_LENS_PRESSURE", LENS, "lens-group");
    } catch (e) {
      console.error("[CulturalDiffusion.lens] createLensButton failed", e);
    }
  }

  beforeDetach() {}

  afterDetach() {}
}

/** Toggle the pressure lens on/off (Shift+C); falls back to the default lens when off. */
function toggleLens() {
  try {
    if (!getPressureLensEnabled()) return;
    const cur = LensManager.getActiveLens ? LensManager.getActiveLens() : void 0;
    LensManager.setActiveLens(cur === LENS ? "fxs-default-lens" : LENS);
  } catch (_) {
    /* ignore */
  }
}

/** @param {*} el An element. @returns {boolean} Whether it takes typed text (the chat, a save or city name box). */
function isTextEntry(el) {
  const tag = String(el?.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "fxs-textbox" || el?.isContentEditable === true;
}

/** @param {*} ev Keyboard event. @returns {boolean} Shift+C with no other modifier, and not a held key's repeat. */
function isShiftC(ev) {
  if (!ev || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.repeat) return false;
  return ev.key === "C" || ev.key === "c";
}

/**
 * Whether a keydown is the lens key: Shift+C with no other modifier, once per press, and not while typing.
 * @param {*} ev Keyboard event.
 * @returns {boolean} True when it should toggle the lens.
 */
function isLensKey(ev) {
  if (!isShiftC(ev)) return false;
  const focused = typeof document !== "undefined" ? document.activeElement : null;
  return !isTextEntry(ev.target) && !isTextEntry(focused);
}

/** Introspection for the in-game harness (devtools/harness), which checks the shipped logic directly. */
export const __test = { pressureTiles };

// self-registration (runs on UIScript load, in the HUD context)
try {
  LensManager.registerLensLayer(LAYER, new PressureLensLayer());
  LensManager.registerLens(LENS, new PressureLens());
} catch (e) {
  console.error("[CulturalDiffusion.lens] registration failed", e);
}
try {
  if (typeof Controls !== "undefined" && typeof Controls.decorate === "function") {
    Controls.decorate("lens-panel", (/** @type {*} */ c) => new PressureLensPanelDecorator(c));
  }
} catch (e) {
  console.error("[CulturalDiffusion.lens] lens-panel decorate failed", e);
}
try {
  window.addEventListener("keydown", (/** @type {*} */ ev) => {
    if (isLensKey(ev)) toggleLens();
  });
} catch (_) {
  /* ignore */
}
