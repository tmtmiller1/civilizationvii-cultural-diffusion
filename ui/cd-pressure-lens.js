// cd-pressure-lens.js
//
// The CULTURAL PRESSURE lens (docs/potential-future-features.md §1): a read-only map overlay that
// shows WHERE THE BORDER IS ABOUT TO MOVE NEXT. Every simulated frontier tile whose LEADING culture
// differs from its current owner is tinted in the leader's banner colour, deepening (alpha ramps) as
// the tile nears capture - so a glance reads "these tiles are contested, and the darker ones flip
// soonest." Pairs with the hover tooltip (cd-pressure-tooltip.js), which shows the per-tile arithmetic.
//
// The pressure is read straight off the mod's own persisted culture field (cd-state loadState) and
// scored with the SAME flip gates the pass uses (cd-field pressureVerdict), age-adjusted, so the map
// and the sim agree. Prior art: Civ V drew borders engine-side with no "about to flip" state at all,
// and Civ VI's only contested-frontier visual was the Loyalty pressure lens - this realizes that idea
// on this mod's culture field. Read-only: it paints, it never touches ownership, so it cannot
// destabilize the pass.
//
// Same self-registering pattern as the Emigration lenses: its OWN <UIScripts> entry so it runs in the
// HUD context where LensManager/WorldUI live and a failure here can never break the gameplay pass. The
// only base-game import is LensManager.

import LensManager from "/core/ui/lenses/lens-manager.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { loadState } from "/cultural-diffusion/ui/cd-state.js";
import { pressureVerdict } from "/cultural-diffusion/ui/cd-field.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { applyTunableOverrides, getPressureLensEnabled } from "/cultural-diffusion/ui/cd-settings.js";
import { civDisplayColor, hexToFloat4 } from "/cultural-diffusion/ui/cd-lens-colors.js";

export const LENS = "cd-pressure-lens";
const LAYER = "cd-pressure-layer";
const HEX_GRID = 1; // OVERLAY_PRIORITY.HEX_GRID, inlined
const FALLBACK_HEX = "#c9a24c"; // the mod's gold, when a contender's banner colour can't be resolved
// Alpha ramps with capture progress so the frontier reads faint->vivid as tiles near a flip.
const MIN_ALPHA = 0.18;
const MAX_ALPHA = 0.78;
// Skip near-zero-pressure tiles so the overlay marks the genuine contested front, not every field tile.
const MIN_PROGRESS = 0.08;

/** @param {string} k @returns {{x:number,y:number}} Plot from an "x,y" key. */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/**
 * A COPY of CONFIG with the ownership bar raised for the current age, matching the pass's ageContext
 * (cd-pass.js): the later-age `ownerBar` multiplier scales minimumOwner. flipRatio is unaffected by
 * age, so the verdict the lens computes matches what the pass would decide this turn. Also pulls the
 * player's saved preset into CONFIG first (the HUD isolate boots CONFIG at its shipped defaults).
 * @returns {import("/cultural-diffusion/ui/cd-config.js").CdConfig} Age-adjusted config.
 */
function ageAdjustedCfg() {
  try {
    applyTunableOverrides();
  } catch (_) {
    /* Options layer unavailable in this context - fall back to CONFIG defaults. */
  }
  let bar = 1;
  try {
    const age = CONFIG.byAge && CONFIG.byAge[currentAgeKey()];
    if (age && typeof age.ownerBar === "number") bar = age.ownerBar;
  } catch (_) {
    /* ignore */
  }
  return { ...CONFIG, minimumOwner: CONFIG.minimumOwner * Math.max(0.1, bar) };
}

/** The set of currently-alive player ids (majors + minors), for filtering dead-civ stock. */
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

/**
 * Every simulated tile with a PENDING border shift: its leading culture differs from the current
 * owner and has non-trivial capture progress. Each entry carries the leader (for colour) and the
 * progress (for alpha).
 * @returns {{x:number, y:number, leader:number, progress:number}[]} Contested tiles.
 */
function pressureTiles() {
  let field = {};
  try {
    field = (loadState().field) || {};
  } catch (_) {
    return [];
  }
  const cfg = ageAdjustedCfg();
  const alive = aliveIds();
  const dead = deadOwnersOf(field, alive);
  /** @type {{x:number, y:number, leader:number, progress:number}[]} */
  const out = [];
  for (const k of Object.keys(field)) {
    const loc = unkey(k);
    if (!isFinite(loc.x) || !isFinite(loc.y)) continue;
    const owner = ownerAt(loc);
    const v = pressureVerdict(field[k], owner, dead, cfg);
    if (v.leader < 0 || v.leader === owner) continue; // no pending shift on this tile
    if (v.progress < MIN_PROGRESS) continue;
    out.push({ x: loc.x, y: loc.y, leader: v.leader, progress: v.progress });
  }
  return out;
}

/** Quantize a leader + progress into a small key so near-identical fills share one addPlots batch. */
function batchKey(leader, progress) {
  return leader + ":" + Math.round(progress * 12); // ~12 alpha steps per contender
}

/**
 * Group contested tiles into a handful of (leader colour x progress-alpha) batches, so the overlay is
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

/** The current game turn for the lens cache key, or -1. */
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

/** The lens layer: an overlay of plot fills coloured by the contender about to take each frontier tile. */
class PressureLensLayer {
  constructor() {
    this.group = WorldUI.createOverlayGroup("CdPressureOverlay", HEX_GRID);
    this.overlay = this.group.addPlotOverlay();
  }

  /** Clear the overlay. */
  clear() {
    this.group.clearAll();
    this.overlay.clear();
  }

  /** Lens-layer lifecycle: init (no-op; built in the constructor). */
  initLayer() {}

  /** Lens-layer lifecycle: paint each contested tile in its contender's colour at a progress alpha. */
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

  /** Lens-layer lifecycle: clear on deactivate. */
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

  /** No-op lifecycle hook. */
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

  /** No-op lifecycle hook. */
  beforeDetach() {}

  /** No-op lifecycle hook. */
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

// -- Self-registration (runs on UIScript load, in the HUD context) --------------------------
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
    if (ev && ev.shiftKey && (ev.key === "C" || ev.key === "c")) toggleLens();
  });
} catch (_) {
  /* ignore */
}
