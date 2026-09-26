// cd-pressure-tooltip.js
//
// The Cultural Pressure lens's cursor panel: while the lens is active and the cursor is over a
// simulated tile, a readout shows each contending culture's stock, the target the leader must reach,
// the capture progress and a rough turns-to-flip, all from the same cd-field pressureVerdict the lens
// and the pass use. Self-contained DOM panel + cursor wiring, loaded as its OWN <UIScripts> entry in
// the HUD context; it reads the hovered plot's field row directly. Reads only.

import LensManager from "/core/ui/lenses/lens-manager.js";
import PlotCursor from "/core/ui/input/plot-cursor.js";
import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { loadState } from "/cultural-diffusion/ui/cd-state.js";
import { pressureVerdict, estimateTurnsToFlip, passCanAct } from "/cultural-diffusion/ui/cd-field.js";
import { localCityList, cityListOf, claimInScope, claimGateBlocked } from "/cultural-diffusion/ui/cd-eligibility.js";
import { isMajorPlayer } from "/cultural-diffusion/ui/cd-borders.js";
import { ownerAt, plotsInRadius, localPlayerId } from "/cultural-diffusion/ui/cd-plots.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { applyTunableOverrides } from "/cultural-diffusion/ui/cd-settings.js";
import { civDisplayColor, civLabel } from "/cultural-diffusion/ui/cd-lens-colors.js";
import { LENS } from "/cultural-diffusion/ui/cd-pressure-lens.js";

const PANEL_ID = "cd-pressure-panel";
const STYLE_ID = "cd-pressure-panel-style";
const CURSOR_OFFSET = 36; // px gap from the cursor so the panel clears the tile being read
// ms the loaded field snapshot is cached before a reload. The snapshot carries the claim CONTEXT too
// (cd-eligibility), so for up to this long the readout can still offer progress on a tile that has just gone
// on cooldown or had a verb sent. Sub-second staleness in a hover panel is the deliberate trade for not
// re-reading the whole field on every mouse move; `__test.clearSnapshot` exists so the parity suite can pin
// the fresh behavior rather than the cache.
const FIELD_TTL = 1500;
const MAX_CONTENDERS = 3; // cap the per-civ stock rows so the panel stays compact
const FALLBACK_HEX = "#c9a24c";

let _panel = /** @type {HTMLElement|null} */ (null);
let _mouseX = 0;
let _mouseY = 0;
let _rafPending = false;
let _wired = false;
let _curKey = /** @type {string|null} */ (null);
/** @type {{at:number, field:Record<string, Record<string, number>>, cfg:*, dead:number[]}|null} */
let _snap = null;

/** Escape a value for safe interpolation into panel HTML. @param {*} s @returns {string} */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Best-effort localize of a LOC tag, degrading to a plain-English fallback. @param {string} tag @param {string} fb */
function t(tag, fb) {
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      const s = Locale.compose(tag);
      if (typeof s === "string" && s && s !== tag && !s.startsWith("LOC_")) return s;
    }
  } catch (_) {
    /* ignore */
  }
  return fb;
}

/** The panel stylesheet (matches the Emigration lens panels' look). @returns {string} CSS. */
function css() {
  const id = "#" + PANEL_ID;
  return (
    id + "{position:fixed;pointer-events:none;z-index:9999;display:none;max-width:22rem;" +
    "background:rgba(8,10,16,0.96);border:0.0555rem solid rgba(201,162,76,0.5);border-radius:0.3rem;" +
    "padding:0.4rem 0.6rem;color:#e5d2ac;font-size:var(--dg-fs-85);" +
    'font-family:"BodyFont","BodyFont-JP","BodyFont-KR","BodyFont-SC","BodyFont-TC";}' +
    id + " .t{color:#f3c34c;font-weight:bold;margin-bottom:0.2rem;}" +
    id + " .r{display:flex;align-items:center;gap:0.35rem;line-height:1.55;}" +
    id + " .sw{width:0.62rem;height:0.62rem;border-radius:50%;flex:0 0 auto;}" +
    id + " .val{margin-left:auto;padding-left:0.6rem;}" +
    id + " .sep{border-top:0.0555rem solid rgba(201,162,76,0.25);margin:0.25rem 0;}"
  );
}

/** Age-adjusted config (raise minimumOwner by the current age's ownerBar), matching the lens/pass. */
function ageAdjustedCfg() {
  try {
    applyTunableOverrides();
  } catch (_) {
    /* Options layer unavailable - fall back to CONFIG defaults. */
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

/** Currently-alive player ids. @returns {Set<number>} */
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

/** Dead civ ids referenced in the field (their stock is ignored). @returns {number[]} */
function deadOwnersOf(field, alive) {
  if (!alive.size) return [];
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

/** The loaded field, claims, local player, age config and dead owners, cached on a short TTL (read per mousemove). */
function snapshot() {
  const now = Date.now();
  if (_snap && now - _snap.at < FIELD_TTL) return _snap;
  let field = {};
  let claims = {};
  let state = null;
  try {
    const st = loadState();
    field = st.field || {};
    claims = st.claims || {};
    state = st;
  } catch (_) {
    field = {};
  }
  const cfg = ageAdjustedCfg();
  const me = localPlayerId();
  _snap = { at: now, field, claims, me, cfg, state, dead: deadOwnersOf(field, aliveIds()),
    ctx: { me, cities: localCityList(me), state, cfg } };
  return _snap;
}

/** The currently hovered map plot {x,y}, or null (from the engine's PlotCursor singleton). */
function hoveredPlot() {
  try {
    const c = PlotCursor && PlotCursor.plotCursorCoords;
    return c && typeof c.x === "number" && typeof c.y === "number" ? c : null;
  } catch (_) {
    return null;
  }
}

/** Whether the pressure lens is the active lens right now. */
function lensActive() {
  try {
    return typeof LensManager.getActiveLens === "function" && LensManager.getActiveLens() === LENS;
  } catch (_) {
    return false;
  }
}

/** The leader's largest stock among a plot's neighbors (for the turns estimate). */
function strongestNeighborStock(field, plot, leader) {
  let best = 0;
  const civ = String(leader);
  for (const n of plotsInRadius(plot, 1)) {
    if (n.x === plot.x && n.y === plot.y) continue;
    const row = field[n.x + "," + n.y];
    const v = row && row[civ];
    if (typeof v === "number" && v > best) best = v;
  }
  return best;
}

/** A rounded value string. @param {number} v @returns {string} */
function amt(v) {
  return String(Math.round(v));
}

/** The turns-to-flip display string, or null when there is no pending flip. */
function turnsText(verdict, field, plot, cfg) {
  const turns = estimateTurnsToFlip(verdict, strongestNeighborStock(field, plot, verdict.leader), cfg);
  if (turns == null) return null;
  if (turns === 0) return t("LOC_CD_PRESSURE_READY", "ready to flip");
  if (!isFinite(turns)) return t("LOC_CD_PRESSURE_STALLED", "stalled");
  return t("LOC_CD_PRESSURE_TURNS_APPROX", "~") + turns + " " + t("LOC_CD_PRESSURE_TURNS_UNIT", "turns");
}

/**
 * The per-civ stock rows for a tile (largest first, capped), each marked when it is the current owner.
 * @param {Record<string, number>} row The tile's field row.
 * @param {number} owner The tile's current owner (-1 = unowned).
 * @param {number[]} dead Dead civ ids to skip.
 * @returns {{color:string, name:string, value:string}[]} Rows.
 */
function contenderRows(row, owner, dead) {
  /** @type {{civ:number, value:number}[]} */
  const civs = [];
  for (const civ of Object.keys(row)) {
    const pid = parseInt(civ, 10);
    if (dead.indexOf(pid) >= 0) continue;
    const v = row[civ];
    if (typeof v === "number" && v > 0) civs.push({ civ: pid, value: v });
  }
  civs.sort((a, b) => b.value - a.value);
  const ownerSuffix = t("LOC_CD_PRESSURE_OWNER_SUFFIX", " (owner)");
  return civs.slice(0, MAX_CONTENDERS).map((c) => ({
    color: civDisplayColor(c.civ, FALLBACK_HEX),
    name: civLabel(c.civ, "#" + c.civ) + (c.civ === owner ? ownerSuffix : ""),
    value: amt(c.value)
  }));
}

/**
 * Whether the pass would really move this tile: `passCanAct` plus, for a tile our culture leads, every other
 * claim gate (cd-eligibility.js). Without the second half the readout counted down turns to a flip that a
 * protected core, a war front, range, a cooldown or a minor settlement's protected ring would refuse.
 * @param {{x:number,y:number}} plot Hovered plot. @param {number} owner Current owner.
 * @param {*} v Pressure verdict. @param {*} snap Tooltip snapshot. @param {string} k Plot key.
 * @returns {boolean} True when the flip rows should be shown.
 */
function actionableHere(plot, owner, v, snap, k) {
  const aiLead = !!snap.cfg.aiCultureFlips && v.leader >= 0 && v.leader !== snap.me && isMajorPlayer(v.leader);
  const flags = { recede: snap.cfg.recedeBorders, aiFlips: aiLead };
  if (!passCanAct(v.leader, owner, snap.me, snap.claims[k]?.by === snap.me, flags)) return false;
  if (v.leader !== snap.me && !aiLead) return true; // a recede cession: the recede step's business, not this gate's
  // Our own claim, or - with AI flips on - the leader's: the same gates, asked for whoever would claim.
  const ctx = v.leader === snap.me
    ? snap.ctx
    : { me: v.leader, cities: cityListOf(v.leader), state: snap.state, cfg: snap.cfg };
  if (!claimInScope(plot, ctx)) return false;
  return !claimGateBlocked(plot, owner, v.leader, snap.cfg, null);
}

/**
 * Turn the hovered plot into the panel's title + rows, or null when there is nothing to show.
 * @param {{x:number,y:number}} plot The hovered plot.
 * @returns {{title:string, rows:{color:string,name:string,value:string}[]}|null} Display, or null.
 */
function resolve(plot) {
  const snap = snapshot();
  const k = plot.x + "," + plot.y;
  const row = snap.field[k];
  if (!row) return null; // not a simulated tile
  const owner = ownerAt(plot);
  const v = pressureVerdict(row, owner, snap.dead, snap.cfg);
  if (v.leader < 0) return null; // no living culture on this tile
  const rows = contenderRows(row, owner, snap.dead);
  if (!rows.length) return null;
  // A shift the pass will make: add the capture progress and turns rows. A leader the pass never acts for (an AI on
  // unowned land, or on our land the mod did not claim or with recede off) shows its stocks only.
  const actionable = actionableHere(plot, owner, v, snap, k);
  if (actionable && v.progress > 0) {
    rows.push({ __sep: true });
    rows.push({
      color: "transparent",
      name: t("LOC_CD_PRESSURE_PROGRESS", "Capture progress"),
      value: Math.round(v.progress * 100) + "%"
    });
    const turns = turnsText(v, snap.field, plot, snap.cfg);
    if (turns) rows.push({ color: "transparent", name: t("LOC_CD_PRESSURE_TURNS", "At current pace"), value: turns });
  }
  return { title: t("LOC_CD_PRESSURE_TITLE", "Cultural Pressure"), rows };
}

/** Build the panel inner HTML from a title + rows (a `__sep` row renders a divider). */
function buildHTML(title, rows) {
  let h = `<div class="t">${esc(title)}</div>`;
  for (const r of rows) {
    if (r.__sep) {
      h += '<div class="sep"></div>';
      continue;
    }
    const sw = r.color && r.color !== "transparent"
      ? `<span class="sw" style="background:${esc(r.color)}"></span>`
      : '<span class="sw" style="background:transparent"></span>';
    const val = r.value != null && r.value !== "" ? `<span class="val">${esc(r.value)}</span>` : "";
    h += `<div class="r">${sw}<span class="nm">${esc(r.name)}</span>${val}</div>`;
  }
  return h;
}

/** Inject the stylesheet + create the (hidden) panel element once. */
function ensurePanel() {
  if (_panel) return _panel;
  if (typeof document === "undefined") return null;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css();
    (document.head || document.documentElement).appendChild(st);
  }
  _panel = document.createElement("div");
  _panel.id = PANEL_ID;
  document.body.appendChild(_panel);
  return _panel;
}

/** Position the panel near the cursor (offset so it clears the tile), clamped on screen. */
function place(panel) {
  const w = panel.offsetWidth || 220;
  const h = panel.offsetHeight || 90;
  let x = _mouseX + CURSOR_OFFSET;
  let y = _mouseY + CURSOR_OFFSET;
  if (x + w > window.innerWidth) x = _mouseX - w - CURSOR_OFFSET;
  if (y + h > window.innerHeight) y = _mouseY - h - CURSOR_OFFSET;
  const maxX = Math.max(0, window.innerWidth - w - 4);
  const maxY = Math.max(0, window.innerHeight - h - 4);
  panel.style.left = Math.min(Math.max(0, x), maxX) + "px";
  panel.style.top = Math.min(Math.max(0, y), maxY) + "px";
}

/** Hide the panel. */
function hide() {
  if (_panel) _panel.style.display = "none";
  _curKey = null;
}

/** Recompute + show/hide the panel for the currently hovered tile (lens-gated). */
function render() {
  if (!lensActive()) {
    hide();
    return;
  }
  const plot = hoveredPlot();
  const out = plot ? resolve(plot) : null;
  if (!out || !out.rows.length || !plot) {
    hide();
    return;
  }
  const panel = ensurePanel();
  if (!panel) return;
  const key = plot.x + "," + plot.y;
  if (key !== _curKey) {
    panel.innerHTML = buildHTML(out.title, out.rows);
    _curKey = key;
  }
  panel.style.display = "block";
  place(panel);
}

/** Coalesce renders to at most one per animation frame. */
function scheduleRender() {
  if (_rafPending) return;
  const raf = typeof window !== "undefined" && window.requestAnimationFrame;
  if (!raf) {
    render();
    return;
  }
  _rafPending = true;
  raf(() => {
    _rafPending = false;
    render();
  });
}

/** Wire the shared cursor/plot listeners once. */
function wire() {
  if (_wired || typeof window === "undefined" || typeof document === "undefined") return;
  _wired = true;
  window.addEventListener("mousemove", (/** @type {*} */ ev) => {
    _mouseX = ev.clientX;
    _mouseY = ev.clientY;
    scheduleRender();
  }, true);
  window.addEventListener("cursor-updated", scheduleRender);
  window.addEventListener("plot-cursor-coords-updated", scheduleRender);
}

/** Introspection for the in-game harness (devtools/harness), which checks the shipped logic directly. */
export const __test = { resolve, clearSnapshot: () => { _snap = null; } };

// -- Self-registration (runs on UIScript load, in the HUD context) ---------------------------
try {
  wire();
} catch (e) {
  console.error("[CulturalDiffusion.pressurepanel] registration failed", e);
}
