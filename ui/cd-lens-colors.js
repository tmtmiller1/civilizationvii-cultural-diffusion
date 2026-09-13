// cd-lens-colors.js
//
// Readable per-civ display colours + a float4 helper for the Cultural Pressure lens/tooltip. A trim of
// the sibling Emigration mod's emigration-civ-colors.js so this mod stays standalone (no cross-mod
// import): prefer a civ's PRIMARY banner colour, fall back to SECONDARY when the primary is a dark
// grey/black, then lift any still-dark colour to a minimum lightness so it never vanishes on the dark
// map canvas. Off-engine / unresolved civs fall back to the caller's hex.
//
// Import-less on purpose (like cd-config.js / emigration-civ-colors.js) so it can live in <ImportFiles>
// and still expose its exports to the lens UIScripts that import it.

const MIN_L_GREY = 0.65; // greys need more lift (no hue to aid readability)
const MIN_L_SAT = 0.5;
const DARK_GREY_MAX_L = 0.42; // a primary worth replacing with the secondary: dark AND nearly colourless
const DARK_GREY_MAX_S = 0.3;
const FALLBACK_HEX = "#888888";

/**
 * Parse a `#RRGGBB`/`#AARRGGBB` or `rgb()/rgba()` colour into 0-255 channels, or null.
 * @param {*} input Colour string.
 * @returns {{r:number, g:number, b:number}|null} Channels or null.
 */
function parse(input) {
  if (typeof input !== "string") return null;
  const hex = input.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (hex) {
    const v = hex[1].slice(-6);
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
  }
  const m = input.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) } : null;
}

/** Format RGB (0-255) as `#RRGGBB`. @param {number} r @param {number} g @param {number} b @returns {string} */
function toHex(r, g, b) {
  const h2 = (/** @type {number} */ n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + h2(r) + h2(g) + h2(b);
}

/** RGB (0-255) -> HSL. @param {number} r @param {number} g @param {number} b @returns {{h:number,s:number,l:number}} */
function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** Base RGB (0-1) for an HSL hue sector. @param {number} hp @param {number} c @param {number} x */
function hslBase(hp, c, x) {
  if (hp < 1) return { r: c, g: x, b: 0 };
  if (hp < 2) return { r: x, g: c, b: 0 };
  if (hp < 3) return { r: 0, g: c, b: x };
  if (hp < 4) return { r: 0, g: x, b: c };
  if (hp < 5) return { r: x, g: 0, b: c };
  return { r: c, g: 0, b: x };
}

/** HSL -> `#RRGGBB`. @param {number} h @param {number} s @param {number} l @returns {string} */
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const base = hslBase(hp, c, x);
  const m = l - c / 2;
  const ch = (/** @type {number} */ v) => Math.round((v + m) * 255);
  return toHex(ch(base.r), ch(base.g), ch(base.b));
}

/** Whether a colour is a dark, nearly-colourless grey/black. @param {{r:number,g:number,b:number}} c */
function isDarkGrey(c) {
  const { s, l } = rgbToHsl(c.r, c.g, c.b);
  return l < DARK_GREY_MAX_L && s < DARK_GREY_MAX_S;
}

/** Lift a colour to the minimum readable lightness on the dark canvas. @param {string} color @returns {string} */
function safeColor(color) {
  const ch = parse(color);
  if (!ch) return color;
  const { h, s, l } = rgbToHsl(ch.r, ch.g, ch.b);
  const minL = MIN_L_GREY + (MIN_L_SAT - MIN_L_GREY) * Math.min(1, Math.max(0, s));
  return l >= minL ? toHex(ch.r, ch.g, ch.b) : hslToHex(h, s, minL);
}

/** Prefer the more readable of a civ's two banner colours. @param {*} primary @param {*} secondary @returns {*} */
function preferReadable(primary, secondary) {
  const p = parse(primary);
  if (!p || !isDarkGrey(p)) return primary;
  const s = parse(secondary);
  return s && !isDarkGrey(s) ? secondary : primary;
}

/** A live player's banner colour string via UI.Player, or undefined. @param {number} pid @param {string} fn */
function bannerColor(pid, fn) {
  try {
    if (typeof UI !== "undefined" && UI.Player && typeof UI.Player[fn] === "function") {
      const c = UI.Player[fn](pid);
      if (typeof c === "string" && c.length > 0) return c;
    }
  } catch (_) {
    /* unresolved player */
  }
  return undefined;
}

/**
 * A civ's readable display colour (`#RRGGBB`) for the dark map canvas: its banner colour (primary, or
 * the secondary when the primary is a dark grey), lifted to a readable lightness. Falls back to
 * `fallbackHex` off-engine or when no banner colour is available.
 * @param {number} pid Civ/player id.
 * @param {string} [fallbackHex] Fallback `#RRGGBB`.
 * @returns {string} A readable `#RRGGBB`.
 */
export function civDisplayColor(pid, fallbackHex = FALLBACK_HEX) {
  const primary = bannerColor(pid, "getPrimaryColorValueAsString");
  if (!primary) return fallbackHex;
  const readable = safeColor(preferReadable(primary, bannerColor(pid, "getSecondaryColorValueAsString")));
  const ch = parse(readable);
  return ch ? toHex(ch.r, ch.g, ch.b) : fallbackHex;
}

/**
 * A best-effort localized display name for a civ/player (for tooltip row labels), degrading to
 * `#<id>` when unresolved. Never throws.
 * @param {number} pid Player id.
 * @param {string} [fallback] Fallback label.
 * @returns {string} A display label.
 */
export function civLabel(pid, fallback) {
  const name = composeTag(playerNameTag(pid));
  if (name) return name;
  return fallback != null ? fallback : "#" + pid;
}

/** The best available name text-key for a player, or null. @param {number} pid @returns {*} */
function playerNameTag(pid) {
  try {
    const p = typeof Players !== "undefined" && Players.get ? Players.get(pid) : null;
    if (!p) return null;
    return p.civilizationFullName || p.civilizationName || p.name || p.leaderName || null;
  } catch (_) {
    return null; // unresolved player
  }
}

/** Locale.compose a tag, returning null when unresolved (empty / still a LOC_ key). @param {*} tag */
function composeTag(tag) {
  if (!tag) return null;
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      const s = Locale.compose(tag);
      if (typeof s === "string" && s && !s.startsWith("LOC_")) return s;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * A `#RRGGBB` colour as the engine's plot-overlay float4 {x,y,z,w} (0-1 RGBA). Every channel is
 * finite-clamped - a NaN reaching the Metal plot overlay is a known Mac crash vector.
 * @param {string} hex A `#RRGGBB` colour.
 * @param {number} [alpha] Alpha 0..1.
 * @returns {{x:number, y:number, z:number, w:number}} Float4 RGBA.
 */
export function hexToFloat4(hex, alpha = 1) {
  const ch = parse(hex) || { r: 136, g: 136, b: 136 };
  const unit = (/** @type {number} */ n) => (typeof n === "number" && isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
  return { x: unit(ch.r / 255), y: unit(ch.g / 255), z: unit(ch.b / 255), w: unit(alpha) };
}
