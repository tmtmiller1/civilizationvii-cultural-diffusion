// cd-probe-lens.js, game scope, read-only.
//
// Feasibility stage for the Cultural Pressure lens and hover tooltip
// (docs/potential-future-features.md section 1). The lens paints from the mod's persisted culture
// field, read in the HUD context via cd-state.loadState(). Two questions, answered from engine
// reads only:
//
//   H1  CD-LENS-STATE    can a HUD-context UIScript read the GameConfiguration-persisted field at
//                        all? If this stage (same isolate kind as the lens) reads 0 field tiles
//                        while Cultural Diffusion is enabled and a few turns in, the lens is a no-op.
//   H2  CD-LENS-VERDICT  does the flip-gate math give a sane leader and capture progress on real
//                        field data, and do a contender's banner color and display name resolve?
//
// Self-contained: it copies loadState()'s read and a trim of cd-field pressureVerdict instead of
// importing /cultural-diffusion/..., because a cross-mod import that fails to resolve takes the
// whole probe down. The copy uses the shipped default flip constants (the Medium preset), enough
// for the read and the math, not the live sim's age-adjusted bar.
//
// Needs both "Cultural Diffusion" and this probe enabled, and a few turns played so the mod's pass
// has populated the field.

import { emitLine, emitSection, newRunId } from "./cd-probe-emit.js";
import { hudVerdict } from "./cd-probe-hud.js";

const STATE_KEY = "CulturalDiffusionState_v2"; // must match cd-state.js STATE_KEY
// Shipped flip constants (cd-config.js defaults, Medium preset). The live lens age-adjusts
// minimumOwner by the current age's ownerBar; the base value is close enough here.
const MIN_OWNER = 300;
const FLIP_RATIO = 0.65;
const MIN_PROGRESS = 0.08; // must match cd-pressure-lens.js so "contested" counts agree
const MAX_SAMPLES = 6;

/** @param {()=>*} fn @param {*} fallback @returns {*} */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {*} v @param {number} d @returns {number} */
function num(v, d) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/**
 * Read the persisted culture field the way cd-state.loadState() does, from the HUD context:
 * Configuration.getGame().getValue(STATE_KEY) -> JSON.parse -> unwrap the {v,data} envelope -> .field.
 * @returns {{readable:boolean, present:boolean, rawLen:number, field:Record<string,Record<string,number>>}}
 */
function readField() {
  const g = safe(() => Configuration?.getGame?.(), null);
  if (!g || typeof g.getValue !== "function") return { readable: false, present: false, rawLen: 0, field: {} };
  const raw = safe(() => g.getValue(STATE_KEY), null);
  if (typeof raw !== "string" || !raw.length) return { readable: true, present: false, rawLen: 0, field: {} };
  const parsed = safe(() => JSON.parse(raw), null);
  const payload = parsed && typeof parsed === "object"
    ? (typeof parsed.v === "number" && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed)
    : null;
  const field = payload && typeof payload.field === "object" && payload.field ? payload.field : {};
  return { readable: true, present: true, rawLen: raw.length, field };
}

/** The owning player id at a plot, or -1. @param {number} x @param {number} y @returns {number} */
function ownerAtXY(x, y) {
  return safe(() => {
    if (typeof GameplayMap?.getOwner !== "function") return -1;
    const o = GameplayMap.getOwner(x, y);
    return typeof o === "number" ? o : -1;
  }, -1);
}

/** Currently-alive player ids. @returns {Set<number>} */
function aliveIds() {
  /** @type {Set<number>} */
  const set = new Set();
  const alive = safe(() => (typeof Players !== "undefined" && Players.getAlive ? Players.getAlive() : null), null);
  if (Array.isArray(alive)) for (const p of alive) if (p && typeof p.id === "number") set.add(p.id);
  return set;
}

/** The strongest living culture on a tile. @param {Record<string,number>} civMap @param {Set<number>} alive */
function strongest(civMap, alive) {
  let owner = -1;
  let value = 0;
  for (const key of Object.keys(civMap)) {
    const pid = parseInt(key, 10);
    if (alive.size && !alive.has(pid)) continue; // ignore a dead civ's decaying stock
    const v = num(civMap[key], 0);
    if (v > value) {
      value = v;
      owner = pid;
    }
  }
  return { owner, value };
}

/**
 * A trim of cd-field.pressureVerdict. If the flip gates change there, change them here.
 * @param {Record<string,number>} civMap @param {number} currentOwner @param {Set<number>} alive
 * @returns {{leader:number, leaderValue:number, incumbent:number, target:number, progress:number, willFlip:boolean}}
 */
function verdict(civMap, currentOwner, alive) {
  const { owner, value } = strongest(civMap, alive);
  const incumbent = currentOwner >= 0 ? num(civMap[String(currentOwner)], 0) : 0;
  const target = currentOwner < 0 ? MIN_OWNER : Math.max(MIN_OWNER, incumbent / FLIP_RATIO);
  const pending = owner >= 0 && owner !== currentOwner;
  let progress = pending && target > 0 ? value / target : 0;
  progress = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const willFlip = pending && value > MIN_OWNER && (currentOwner < 0 || value * FLIP_RATIO > incumbent);
  return { leader: owner, leaderValue: value, incumbent, target, progress, willFlip };
}

/** Whether a contender's banner color resolves (the lens's civDisplayColor path). @param {number} pid */
function colorResolves(pid) {
  return safe(() => {
    const c = typeof UI !== "undefined" && UI.Player && typeof UI.Player.getPrimaryColorValueAsString === "function"
      ? UI.Player.getPrimaryColorValueAsString(pid)
      : null;
    return typeof c === "string" && c.length > 0 ? c : null;
  }, null);
}

/** A best-effort civ display name (the tooltip's civLabel path). @param {number} pid @returns {string} */
function nameOf(pid) {
  return safe(() => {
    const p = typeof Players !== "undefined" && Players.get ? Players.get(pid) : null;
    const rawTag = p && (p.civilizationFullName || p.civilizationName || p.name || p.leaderName);
    if (rawTag && typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      const s = Locale.compose(rawTag);
      if (typeof s === "string" && s && !s.startsWith("LOC_")) return s;
    }
    return "#" + pid;
  }, "#" + pid);
}

/**
 * Read the persisted field, score every tile, and report whether the HUD can see the field (H1) and
 * whether the verdict math and colour/name resolution look sane on real data (H2).
 * @param {string} trigger Why the stage ran.
 * @returns {{ok:boolean, tiles:number, contested:number}}
 */
export function runLensProbe(trigger) {
  const runId = newRunId();
  const { readable, present, rawLen, field } = readField();

  if (!readable) {
    hudVerdict("CD-LENS: cannot read GameConfiguration here - H1 UNKNOWN (not a HUD isolate?)", "cdlens");
    emitLine("Q-LENS-STATE readable=false (Configuration.getGame().getValue unavailable in this context)");
    return { ok: false, tiles: 0, contested: 0 };
  }

  const keys = Object.keys(field);
  const tiles = keys.length;

  if (!present || tiles === 0) {
    hudVerdict(
      "CD-LENS: HUD reads the store but the culture field is EMPTY - enable Cultural Diffusion and play "
      + "a few turns near a border, then watch this line (H1 pending, not yet refuted)",
      "cdlens"
    );
    emitLine(`Q-LENS-STATE readable=true present=${present} tiles=0 rawLen=${rawLen} - field not populated yet`);
    return { ok: true, tiles: 0, contested: 0 };
  }

  // H1 holds: the HUD isolate sees a populated field. Now score it (H2).
  const alive = aliveIds();
  let contested = 0;
  const samples = [];
  for (const k of keys) {
    const i = k.indexOf(",");
    const x = parseInt(k.slice(0, i), 10);
    const y = parseInt(k.slice(i + 1), 10);
    if (!isFinite(x) || !isFinite(y)) continue;
    const owner = ownerAtXY(x, y);
    const v = verdict(field[k], owner, alive);
    const isContested = v.leader >= 0 && v.leader !== owner && v.progress >= MIN_PROGRESS;
    if (!isContested) continue;
    contested += 1;
    if (samples.length < MAX_SAMPLES) {
      samples.push({
        x, y, owner, leader: v.leader, leaderValue: Math.round(v.leaderValue),
        incumbent: Math.round(v.incumbent), progressPct: Math.round(v.progress * 100), willFlip: v.willFlip,
        colorOk: !!colorResolves(v.leader), name: nameOf(v.leader)
      });
    }
  }

  const top = samples[0];
  const h2 = top
    ? `top tile (${top.x},${top.y}) leader=${top.name} ${top.progressPct}% color=${top.colorOk ? "ok" : "FALLBACK"}`
    : "no contested tiles yet (all frontier is settled or below the floor)";
  hudVerdict(`CD-LENS: HUD SEES field = ${tiles} tiles, ${contested} contested - H1 CONFIRMED. ${h2}`, "cdlens");

  emitLine(`Q-LENS-STATE readable=true present=true tiles=${tiles} contested=${contested} rawLen=${rawLen}`);
  emitLine(`Q-LENS-VERDICT ${h2}`);
  emitSection(runId, "cd_lens", { trigger, tiles, contested, rawLen, samples });
  return { ok: true, tiles, contested };
}
