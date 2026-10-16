// cd-city-panel.js
//
// The Cultural Diffusion section in the game's City Details panel (Citizen Growth tab), through a decorator the way
// Partisans and Emigration add theirs. For the settlement the panel shows: whose culture its people lean to and how
// far along the hold is, or what holds it, then the culture on the center and who holds the countryside. The numbers
// come from the same snapshot the hover readout uses, so the two always agree. Refreshes on the panel's own
// "update-city-details" event.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { settlementOutlookAt } from "/cultural-diffusion/ui/cd-city-flip.js";
import { readoutSnapshot, settlementValueText } from "/cultural-diffusion/ui/cd-pressure-tooltip.js";
import { cityLoc } from "/cultural-diffusion/ui/cd-plots.js";
import { civLabel } from "/cultural-diffusion/ui/cd-lens-colors.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";

const UPDATE_EVENT = "update-city-details";
const SECTION_ID = "cd-city-section";

function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {string} key @param {...*} args @returns {string} The text in the game's language, or the key. */
function text(key, ...args) {
  const s = safe(() => Locale.compose(key, ...args), "");
  return typeof s === "string" && s.length ? s : key;
}

/**
 * The section's lines for one settlement, pure given the readout's answer: a text key with its arguments, or text
 * the readout already composed (the hold wording the two share).
 * @param {*} o settlementOutlookAt's answer, or null when no major's settlement stands there.
 * @param {(pid:number) => string} civ A civilization's display name.
 * @param {boolean} on Whether settlement flips are on.
 * @returns {{key?:string, args?:*[], text?:string}[]} Empty when there's nothing to say.
 */
export function panelLines(o, civ, on) {
  if (!on) return [{ key: "LOC_CD_PANEL_OFF", args: [] }];
  if (!o) return [];
  const calm = [{ key: "LOC_CD_PANEL_CALM", args: [civ(o.owner)] }];
  if (o.leader < 0 || o.leader === o.owner) return calm;
  const value = settlementValueText(o);
  if (value === null) return calm; // a city-state's or independent's culture leads: it can never take the settlement
  return [
    { key: "LOC_CD_CITY_FLIP_ROW", args: [civ(o.leader)] },
    { text: value },
    { key: "LOC_CD_PANEL_CENTRE", args: [civ(o.leader), Math.round(o.lead), civ(o.owner), Math.round(o.ownerStock)] },
    { key: "LOC_CD_PANEL_LAND", args: [civ(o.leader), o.land.leaderOwned, civ(o.owner), o.land.ownerRural] }
  ];
}

/**
 * The city the panel shows, or null. With nothing selected the engine hands back a null id, and `Cities.get(null)`
 * logs a script error even inside a try, so the id is checked first.
 * @returns {*}
 */
function selectedCity() {
  const id = safe(() => UI.Player.getHeadSelectedCity(), null);
  return id && typeof id === "object" ? safe(() => Cities.get(id), null) : null;
}

/** @param {HTMLElement} host @returns {HTMLElement} A fresh section element in place of the last. */
function replaceSection(host) {
  const prev = host.querySelector(`#${SECTION_ID}`);
  if (prev) prev.remove();
  const sec = document.createElement("div");
  sec.id = SECTION_ID;
  sec.classList.add("mx-3", "my-2");
  host.appendChild(sec);
  return sec;
}

/** @param {HTMLElement} sec @param {string} content @param {boolean} header */
function addLine(sec, content, header) {
  const p = document.createElement("div");
  p.classList.add(header ? "font-title-base" : "font-body-sm", header ? "uppercase" : "text-accent-2", "my-1");
  p.textContent = content;
  sec.appendChild(p);
}

class CityPanel {
  /** @param {*} panel The panel-city-details component. */
  constructor(panel) {
    this.panel = panel;
    this.onUpdate = () => this.refresh();
  }

  beforeAttach() {}

  afterAttach() {
    this.refresh();
    safe(() => window.addEventListener(UPDATE_EVENT, this.onUpdate), null);
  }

  beforeDetach() {}

  afterDetach() {
    safe(() => window.removeEventListener(UPDATE_EVENT, this.onUpdate), null);
  }

  onAttributeChanged() {}

  refresh() {
    safe(() => {
      const root = this.panel && this.panel.Root;
      const host = root && root.querySelector("#city-details-tab-growth fxs-scrollable");
      if (host) render(host, linesForSelected());
    }, null);
  }
}

/** The section's lines for the city the panel shows. */
function linesForSelected() {
  const city = selectedCity();
  const at = city ? cityLoc(city) : null;
  const outlook = at && CONFIG.cityFlips ? settlementOutlookAt(at, readoutSnapshot()) : null;
  return panelLines(outlook, (pid) => civLabel(pid, "#" + pid), !!CONFIG.cityFlips);
}

/** @param {HTMLElement} host @param {{key?:string, args?:*[], text?:string}[]} lines */
function render(host, lines) {
  if (!lines.length) {
    const prev = host.querySelector(`#${SECTION_ID}`);
    if (prev) prev.remove();
    return;
  }
  const sec = replaceSection(host);
  addLine(sec, text("LOC_MOD_CULTURAL_DIFFUSION_NAME"), true);
  for (const line of lines) addLine(sec, line.text !== undefined ? line.text : text(line.key, ...line.args), false);
}

/** Register the decorator. @returns {boolean} Whether the game offers one. */
export function installPanel() {
  if (!safe(() => typeof Controls.decorate === "function", false)) {
    dlog("Controls.decorate unavailable; no City Details section");
    return false;
  }
  safe(() => Controls.decorate("panel-city-details", (panel) => new CityPanel(panel)), null);
  return true;
}

installPanel();
