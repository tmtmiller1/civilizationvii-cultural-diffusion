// check-locale.mjs - check one translation folder against the English: node devtools/check-locale.mjs <folder>
//
// The same rules as tests/i18n.test.mjs, for one folder, so a translator can check their own work while other
// folders are still being written: each file under text/en_us has a twin under text/<folder> holding a <Replace> row
// for exactly the same tags, with the folder's Language, the same {placeholders} and [icon:...] tags, the same
// [B]/[BLIST]/[LI] markup counts, and no tag twice. Prints every problem and exits 1 on any.
import fs from "node:fs";
import path from "node:path";

const LANGUAGES = {
  de_de: "de_DE", es_es: "es_ES", fr_fr: "fr_FR", it_it: "it_IT", ja_jp: "ja_JP", ko_kr: "ko_KR",
  pl_pl: "pl_PL", pt_br: "pt_BR", ru_ru: "ru_RU", zh_cn: "zh_Hans_CN", zh_hk: "zh_Hant_HK",
};
const folder = process.argv[2];
const lang = LANGUAGES[folder];
if (!lang) { console.error(`usage: node devtools/check-locale.mjs <${Object.keys(LANGUAGES).join("|")}>`); process.exit(2); }

const problems = [];
const rows = (xml, kind) => [...xml.matchAll(new RegExp(`<${kind}\\s+Tag="([A-Z0-9_]+)"([^>]*)>\\s*<Text>([\\s\\S]*?)</Text>`, "g"))];
const placeholders = (s) => [...s.matchAll(/\{([0-9]+_[A-Za-z]+)/g)].map((m) => m[1]).sort();
const icons = (s) => [...s.matchAll(/\[icon:[A-Z0-9_]+\]/g)].map((m) => m[0]).sort();
const markup = (s) => ["[B]", "[/B]", "[BLIST]", "[LI]", "[/LIST]"].map((t) => s.split(t).length - 1).join(",");

for (const file of fs.readdirSync("text/en_us").filter((f) => f.endsWith(".xml"))) {
  const en = new Map(rows(fs.readFileSync(path.join("text/en_us", file), "utf8"), "Row").map((m) => [m[1], m[3]]));
  const p = path.join("text", folder, file);
  if (!fs.existsSync(p)) { problems.push(`${p}: missing`); continue; }
  const xml = fs.readFileSync(p, "utf8");
  if (/<Row\s+Tag=/.test(xml)) problems.push(`${p}: uses <Row>; translations use <Replace Tag=... Language=...>`);
  if (!/<LocalizedText>/.test(xml)) problems.push(`${p}: no <LocalizedText> block`);
  const seen = new Map();
  for (const m of rows(xml, "Replace")) {
    const [, tag, attrs, text] = m;
    if (seen.has(tag)) problems.push(`${p}: ${tag} defined twice`);
    seen.set(tag, text);
    const l = attrs.match(/Language="([^"]+)"/);
    if (!l || l[1] !== lang) problems.push(`${p}: ${tag} Language="${l ? l[1] : ""}", expected "${lang}"`);
    if (!en.has(tag)) { problems.push(`${p}: ${tag} is not an English tag`); continue; }
    const e = en.get(tag);
    if (placeholders(text).join() !== placeholders(e).join()) problems.push(`${p}: ${tag} placeholders ${placeholders(text)} vs English ${placeholders(e)}`);
    if (icons(text).join() !== icons(e).join()) problems.push(`${p}: ${tag} icons differ from the English`);
    if (markup(text) !== markup(e)) problems.push(`${p}: ${tag} [B]/[BLIST]/[LI] markup differs from the English`);
    if (!text.trim()) problems.push(`${p}: ${tag} is empty`);
  }
  for (const tag of en.keys()) if (!seen.has(tag)) problems.push(`${p}: ${tag} missing`);
}

if (problems.length) {
  console.error(`${folder}: ${problems.length} problem(s)`);
  for (const x of problems) console.error("  - " + x);
  process.exit(1);
}
console.log(`${folder}: ok`);
