// cdh-game-pedia.js - game scope, deployed as ui/cdh-game.js. First in-game look at the Civilopedia section (1.4.0).
//
// No turns are played. The run answers, from the live game:
//   DB      did data/cd-civilopedia.xml reach the compiled gameplay DB (section, pages, layouts, search terms)?
//   MODEL   does the pedia model list the section, and does each page resolve a title and chapter bodies?
//   RENDER  open each page and read the DRAWN DOM: chapter headers, every paragraph's key, empty or unresolved text.
//   SEARCH  do the search terms and a bare page id find the right page (the box and open-civilopedia use search())?
// A page whose text failed the key convention draws a title and nothing else, with no log line, so RENDER is the
// check that matters. Each page is also photographed: SHOT pedia-<page>.
//
// Pattern from the Emigration mod's eep-modtest143.js, which watched that mod's pedia render on 1.5.0.
import { ContextManager } from "/core/ui/context-manager/context-manager.js";
import { instance as Pedia } from "/base-standard/ui/civilopedia/model-civilopedia.js";

const TAG = "[CDH]";
const HOLD = 9000; // the runner polls every 4 s; hold each page past a capture
const SECTION = "CULTURAL_DIFFUSION";
const PAGES = ["CD_OVERVIEW", "CD_FAQ", "CD_ABOUT", "CD_FIELD", "CD_TERRAIN", "CD_CLAIMS", "CD_GROWTH", "CD_STRENGTH",
  "CD_BALANCE", "CD_EMIGRATION", "CD_CITIES", "CD_RECEDE", "CD_RIVALFLIPS", "CD_CONQUEST", "CD_LENS", "CD_OPTIONS"];
const BRIDGE = { sectionID: "CONCEPTS", pageID: "CD_CULTURAL_BORDERS" };
const SEARCHES = { "Shift+C": "CD_LENS", "Conquest": "CD_CONQUEST", "Cultural Power Index": "CD_STRENGTH",
  "Forward settling": "CD_OVERVIEW", "CD_CLAIMS": "CD_CLAIMS", "CULTURAL_DIFFUSION": "CD_OVERVIEW" };

function emit(m) { try { console.error(TAG + " " + m); } catch (_) {} }
function J(o) { try { return JSON.stringify(o); } catch (e) { return "unserializable:" + e; } }
function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { return fb === undefined ? ("ERR:" + e) : fb; } }
function later(ms) { return new Promise((r) => setTimeout(r, ms)); }
let done = false;

async function dismissPopups() {
  for (let i = 0; i < 6; i++) {
    const open = safe(() => Array.from(document.querySelectorAll("*")).filter((e) => /^SCREEN-/.test(e.tagName)
      && e.tagName !== "SCREEN-CIVILOPEDIA" && e.querySelector("fxs-button, fxs-hero-button")), []);
    const dialogs = safe(() => Array.from(document.querySelectorAll("screen-dialog-box")), []);
    if (!open.length && !dialogs.length) return;
    for (const e of [...open, ...dialogs]) {
      emit("POPUP dismissing " + e.tagName.toLowerCase());
      const btns = Array.from(e.querySelectorAll("fxs-button, fxs-hero-button"));
      safe(() => btns[btns.length - 1].dispatchEvent(new CustomEvent("action-activate", { bubbles: true })));
    }
    await later(2500);
  }
}

function dbChecks() {
  const q = (sql) => safe(() => Database.query("gameplay", sql), "ERR");
  // Each result row carries a "$index" field first, so read the first column that is not it (run 1 read $index: 0).
  const one = (sql) => {
    const r = q(sql);
    const col = Array.isArray(r) && r[0] ? Object.entries(r[0]).find(([k]) => k !== "$index") : null;
    return col ? col[1] : r;
  };
  emit("DB section=" + J(q(`select SectionID, Icon, Name from CivilopediaSections where SectionID='${SECTION}'`)));
  emit("DB pages=" + one(`select count(*) from CivilopediaPages where SectionID='${SECTION}'`)
    + " groups=" + one(`select count(*) from CivilopediaPageGroups where SectionID='${SECTION}'`)
    + " layouts=" + one("select count(*) from CivilopediaPageLayouts where PageLayoutID like 'CD_%'")
    + " chapters=" + one("select count(*) from CivilopediaPageLayoutChapters where PageLayoutID like 'CD_%'")
    + " terms=" + one("select count(*) from CivilopediaPageSearchTerms where PageID like 'CD_%'")
    + " bridge=" + one("select count(*) from CivilopediaPages where SectionID='CONCEPTS' and PageID='CD_CULTURAL_BORDERS'"));
}

function modelChecks() {
  const sec = safe(() => Pedia.sections.find((s) => s.sectionID === SECTION), null);
  emit("MODEL section=" + J(sec && { tab: sec.tabText, icon: sec.icon, sort: sec.sortIndex })
    + " order=" + safe(() => Pedia.sections.map((s) => s.sectionID).join(","), "?"));
  const pages = safe(() => Pedia.getPages(SECTION) || [], []);
  emit("MODEL pages=" + pages.length + " first=" + safe(() => pages[0].pageID, "?")
    + " tabs=" + J(pages.map((p) => p.tabText)));
  const groups = safe(() => (Pedia.pageGroupsBySection.get(SECTION) || []).map((g) => g.tabText), []);
  emit("MODEL groups=" + J(groups));
}

function pediaRoot() { return safe(() => document.querySelector("screen-civilopedia"), null); }
function inspectPage(pageID) {
  const root = pediaRoot();
  if (!root) return { open: false };
  const headers = Array.from(root.querySelectorAll("fxs-header")).map((h) => h.getAttribute("title") || "").filter(Boolean);
  const paras = Array.from(root.querySelectorAll("div[data-l10n-id].font-body.text-base.m-3"));
  const keys = paras.map((p) => p.getAttribute("data-l10n-id") || "");
  const empty = paras.filter((p) => !String(p.textContent || "").trim()).map((p) => p.getAttribute("data-l10n-id") || "(no key)");
  const unresolved = keys.filter((k) => k && safe(() => Locale.compose(k), k) === k);
  const chars = paras.reduce((n, p) => n + String(p.textContent || "").length, 0);
  const rawMarkup = paras.filter((p) => /\[(B|LI|BLIST|icon)[:\]]/.test(String(p.textContent || ""))).length;
  return { open: true, pageID, headers, paragraphs: paras.length, chars, empty, unresolved, rawMarkup };
}

async function shootPages() {
  safe(() => ContextManager.push("screen-civilopedia", { singleton: true, createMouseGuard: true }));
  await later(5000);
  if (!pediaRoot()) {
    safe(() => window.dispatchEvent(new CustomEvent("hotkey-open-civilopedia")));
    await later(5000);
  }
  emit("RENDER pedia open=" + !!pediaRoot());
  let pass = 0, fail = 0;
  const all = [...PAGES.map((pageID) => ({ sectionID: SECTION, pageID })), BRIDGE];
  for (const page of all) {
    const ok = safe(() => Pedia.navigateTo(page), false);
    await later(3500);
    const r = inspectPage(page.pageID);
    const good = ok === true && r.open && r.paragraphs > 0 && !r.empty.length && !r.unresolved.length && !r.rawMarkup;
    good ? pass++ : fail++;
    emit("RENDER " + (good ? "OK  " : "FAIL") + " " + page.pageID + " navigate=" + ok + " " + J(r));
    emit("SHOT pedia-" + page.pageID.toLowerCase().replace(/_/g, "-"));
    await later(HOLD);
  }
  emit("RENDER VERDICT pass=" + pass + " fail=" + fail + " of " + all.length);
}

function searchChecks() {
  let pass = 0;
  for (const [term, want] of Object.entries(SEARCHES)) {
    const hits = safe(() => Pedia.search(term, 5).map((r) => r.page.sectionID + "/" + r.page.pageID), []);
    const ok = Array.isArray(hits) && hits.some((h) => h.endsWith("/" + want));
    if (ok) pass++;
    emit("SEARCH " + (ok ? "OK  " : "FAIL") + " '" + term + "' want " + want + " got " + J(hits));
  }
  emit("SEARCH VERDICT pass=" + pass + " of " + Object.keys(SEARCHES).length);
}

async function run() {
  emit("pedia run turn=" + safe(() => Game.turn));
  await later(6000);
  await dismissPopups();
  try { dbChecks(); } catch (e) { emit("DB threw " + e); }
  try { modelChecks(); } catch (e) { emit("MODEL threw " + e); }
  try { searchChecks(); } catch (e) { emit("SEARCH threw " + e); }
  try { await shootPages(); } catch (e) { emit("RENDER threw " + e + " " + (e && e.stack)); }
  safe(() => ContextManager.pop("screen-civilopedia"));
  finish("done");
}
function finish(why) {
  if (done) return;
  done = true;
  emit("VERDICT reason=" + why);
  setTimeout(() => emit("DONE harness pedia finished"), 3000);
}

emit("pedia harness attached");
let beginTries = 0;
function loadStateName() { return safe(() => { const s = UI.getGameLoadingState(); for (const k of Object.keys(UIGameLoadingState)) if (UIGameLoadingState[k] === s) return k; return String(s); }, "?"); }
function beginPoll() {
  const st = loadStateName();
  if (st === "GameStarted") {
    setTimeout(() => { run().catch((e) => { emit("run threw " + e); finish("run threw"); }); }, 10000);
    return;
  }
  beginTries++;
  if (st === "WaitingToStart" || st === "WaitingForUIReady" || beginTries % 5 === 0) safe(() => UI.notifyUIReady());
  if (beginTries < 90) setTimeout(beginPoll, 2000); else { emit("LOAD gave up"); emit("DONE harness pedia finished"); }
}
setTimeout(beginPoll, 3000);
