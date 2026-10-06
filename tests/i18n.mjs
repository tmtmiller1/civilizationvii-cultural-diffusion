// tests/i18n.mjs: every string a player sees can be translated (adapted from National Parks' tests/i18n.test.mjs).
//
// text/en_us is the source of truth (see text/README.md). This checks that every LOC_ key the code, data and modinfo
// use has English text; that no tag is defined twice (a duplicate tag makes the game drop the whole file); that the UI
// sets no display text of its own; and, for each translation folder, that it holds exactly the English tags, under the
// right Language, with the same {placeholders} and [icon:...] tags, and is registered in the modinfo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const files = (dir, ext) => fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));

/** The folder name and the Language attribute the game expects for it. */
export const LANGUAGES = {
  de_de: "de_DE", es_es: "es_ES", fr_fr: "fr_FR", it_it: "it_IT", ja_jp: "ja_JP", ko_kr: "ko_KR",
  pl_pl: "pl_PL", pt_br: "pt_BR", ru_ru: "ru_RU", zh_cn: "zh_Hans_CN", zh_hk: "zh_Hant_HK",
};

/** Base-game keys the mod uses without defining. */
const BASE_KEYS = new Set(["LOC_MODULE_BASE_STANDARD_NAME", "LOC_UI_CONTENT_MGR_SUBTITLE",
  "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION"]);

/** Prefixes the code completes at run time; the completed keys are checked below. */
const PREFIXES = new Set(["LOC_CD_PRESET", "LOC_OPTIONS_GROUP", "LOC_PEDIA"]);

/** tag -> text, for every Row (English) or Replace (translation) in the given files. */
function textsIn(paths) {
  const out = new Map();
  const dups = [];
  for (const p of paths) {
    for (const m of read(p).matchAll(/<(?:Row|Replace)\s+Tag="([A-Z0-9_]+)"[^>]*>\s*<Text>([\s\S]*?)<\/Text>/g)) {
      if (out.has(m[1])) dups.push(m[1]);
      out.set(m[1], m[2]);
    }
  }
  return { texts: out, dups };
}

const english = textsIn(files("text/en_us", ".xml"));

test("i18n: no English tag is defined twice", () => {
  assert.deepEqual(english.dups, []);
});

test("i18n: every key the code, data and modinfo use has English text", () => {
  const sources = [...files("ui", ".js"), ...files("data", ".xml"), "cultural-diffusion.modinfo"];
  const missing = new Set();
  for (const p of sources) {
    // Comments name keys by pattern; only code and data count.
    const body = read(p).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const m of body.matchAll(/LOC_[A-Z0-9_]*[A-Z0-9]/g)) {
      const key = m[0];
      if (BASE_KEYS.has(key) || PREFIXES.has(key) || english.texts.has(key)) continue;
      missing.add(`${key} (${p})`);
    }
  }
  // Keys built at run time: one preset label per preset, and an Options row's tooltip is its label + "_DESCRIPTION".
  const presets = read("ui/cd-config.js").match(/export const PRESETS = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(presets, "ui/cd-config.js: PRESETS not found");
  for (const [, name] of presets[1].matchAll(/^ {2}([A-Za-z]+):/gm)) {
    if (!english.texts.has(`LOC_CD_PRESET_${name.toUpperCase()}`)) missing.add(`LOC_CD_PRESET_${name.toUpperCase()}`);
  }
  for (const m of read("ui/cd-options.js").matchAll(/addCheckbox\([^)]*"(LOC_[A-Z0-9_]+)"\)/g)) {
    if (!english.texts.has(m[1] + "_DESCRIPTION")) missing.add(m[1] + "_DESCRIPTION (ui/cd-options.js)");
  }
  if (!english.texts.has("LOC_OPTIONS_GROUP_CULTURAL_DIFFUSION")) missing.add("LOC_OPTIONS_GROUP_CULTURAL_DIFFUSION");
  assert.deepEqual([...missing], []);
});

test("i18n: the UI sets no display text that is not a key", () => {
  const offenders = [];
  for (const p of files("ui", ".js")) {
    read(p).split("\n").forEach((line, n) => {
      // A literal assigned to a visible property, a button caption that is not a key, or a literal message handed
      // to the notification surface.
      if (/\.(textContent|innerText|innerHTML)\s*=\s*["'`][^"'`]*[A-Za-z]{2}/.test(line)) offenders.push(`${p}:${n + 1}`);
      if (/setAttribute\("(caption|data-tooltip-content)",\s*"(?!LOC_)[^"]*[A-Za-z]/.test(line)) offenders.push(`${p}:${n + 1}`);
      if (/raiseToast\(\s*["'`]/.test(line)) offenders.push(`${p}:${n + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

const marks = (s) => [...s.matchAll(/\{[0-9]+_[A-Za-z]+[^}]*\}|\[icon:[A-Z0-9_]+\]/g)].map((m) => m[0].replace(/:.*\}$/, "}")).sort();

test("i18n: each translation has exactly the English tags, its Language, and the same placeholders", () => {
  const folders = fs.readdirSync("text", { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "en_us");
  for (const d of folders) {
    const lang = LANGUAGES[d.name];
    assert.ok(lang, `text/${d.name}: not a folder the game knows (use one of ${Object.keys(LANGUAGES).join(", ")})`);
    const paths = files(path.join("text", d.name), ".xml");
    for (const p of paths) {
      for (const m of read(p).matchAll(/<Replace\s+Tag="[A-Z0-9_]+"\s+Language="([^"]+)"/g)) {
        assert.equal(m[1], lang, `${p}: Language="${m[1]}", expected "${lang}"`);
      }
      assert.ok(!/<Row\s+Tag=/.test(read(p)), `${p}: translations use <Replace Tag=... Language=...>, not <Row>`);
    }
    const { texts, dups } = textsIn(paths);
    assert.deepEqual(dups, [], `text/${d.name}: tags defined twice`);
    const want = [...english.texts.keys()].filter((k) => !texts.has(k));
    const extra = [...texts.keys()].filter((k) => !english.texts.has(k));
    assert.deepEqual({ missing: want, extra }, { missing: [], extra: [] }, `text/${d.name}`);
    for (const [k, v] of texts) assert.deepEqual(marks(v), marks(english.texts.get(k)), `text/${d.name} ${k}: placeholders or icons differ`);
  }
});

test("i18n: each translation is registered in the modinfo for the menu and the game", () => {
  const modinfo = read("cultural-diffusion.modinfo");
  const folders = fs.readdirSync("text", { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "en_us");
  for (const d of folders) {
    const lang = LANGUAGES[d.name];
    const count = (file) => modinfo.split(`<Item locale="${lang}">text/${d.name}/${file}</Item>`).length - 1;
    assert.equal(count("ModText.xml"), 2, `text/${d.name}/ModText.xml: register it in the shell group and the game group`);
    assert.equal(count("PediaText.xml"), 1, `text/${d.name}/PediaText.xml: register it in the game group`);
  }
  for (const m of modinfo.matchAll(/<Item locale="([^"]+)">text\/([a-z_]+)\//g)) {
    assert.ok(fs.existsSync(path.join("text", m[2])), `modinfo names text/${m[2]}, which does not exist`);
    assert.equal(LANGUAGES[m[2]], m[1], `modinfo: text/${m[2]} registered as ${m[1]}`);
  }
});
