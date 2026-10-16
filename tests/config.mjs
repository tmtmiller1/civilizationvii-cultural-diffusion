// tests/config.mjs: presets and defaults integrity.
import assert from "node:assert/strict";
import { CONFIG, CONFIG_DEFAULTS, PRESETS, PRESET_NAMES } from "/cultural-diffusion/ui/cd-config.js";

// Defaults are frozen and match CONFIG at load.
assert.ok(Object.isFrozen(CONFIG_DEFAULTS), "CONFIG_DEFAULTS is frozen");
assert.equal(CONFIG_DEFAULTS.flipThreshold, CONFIG.flipThreshold);

// The four intensity presets exist in order, Custom first.
assert.deepEqual(PRESET_NAMES.slice(0, 1), ["Custom"]);
for (const name of ["Custom", "Low", "Medium", "High"]) {
  assert.ok(PRESET_NAMES.includes(name), `preset ${name} present`);
}

// Custom applies no overrides; the others are partial profiles of known keys.
assert.deepEqual(PRESETS.Custom, {}, "Custom applies nothing");
const validKeys = new Set(Object.keys(CONFIG));
for (const name of PRESET_NAMES) {
  for (const key of Object.keys(PRESETS[name])) {
    assert.ok(validKeys.has(key), `preset ${name} key ${key} is a real config field`);
    assert.equal(typeof PRESETS[name][key], typeof CONFIG[key], `preset ${name}.${key} type matches`);
  }
}

// Intensity should scale: Low diffuses slower, decays faster, and needs more culture to own
// a tile than High, so Low reaches less far, less quickly.
assert.ok(PRESETS.Low.diffusionRate < PRESETS.High.diffusionRate, "Low diffuses slower than High");
assert.ok(PRESETS.Low.decayRate > PRESETS.High.decayRate, "Low decays faster than High");
assert.ok(PRESETS.Low.minimumOwner > PRESETS.High.minimumOwner, "Low has a higher ownership bar");
assert.ok(PRESETS.Low.flipMaxDistance <= PRESETS.High.flipMaxDistance, "Low reaches no farther than High");

// Per-age tuning damps later ages: injection falls and the ownership bar rises Antiquity->Modern.
const { ANTIQUITY, EXPLORATION, MODERN } = CONFIG.byAge;
assert.ok(ANTIQUITY.injectionScale >= EXPLORATION.injectionScale && EXPLORATION.injectionScale >= MODERN.injectionScale, "injection damps in later ages");
assert.ok(ANTIQUITY.ownerBar <= EXPLORATION.ownerBar && EXPLORATION.ownerBar <= MODERN.ownerBar, "ownership bar rises in later ages");

// The Civilopedia's Limits line states the caps the code has, in every language: maxFlipsPerTurn is a cap per path
// (your claims, other civilizations' claims, recede and conquest each count their own: cd-pass.js, cd-ai-flips.js,
// cd-recede.js, cd-conquest.js), and each preset's per-city cap. It once said "At most 8 tiles change hands per
// turn", one cap for everything, and left out High's 140.
{
  const fs = await import("node:fs");
  const caps = [CONFIG.maxFlipsPerTurn, ...["Low", "Medium", "High"].map((n) => PRESETS[n].maxDiffusionPlots)];
  const tag = "LOC_PEDIA_CULTURAL_DIFFUSION_PAGE_CD_CLAIMS_CHAPTER_SAFE_PARA_1";
  for (const lang of fs.readdirSync("text", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const xml = fs.readFileSync(`text/${lang}/PediaText.xml`, "utf8");
    const m = xml.match(new RegExp(`Tag="${tag}"[^>]*><Text>([\\s\\S]*?)</Text>`));
    assert.ok(m, `${lang}: the Limits paragraph exists`);
    const numbers = m[1].match(/[0-9]+/g).map(Number);
    for (const n of caps) assert.ok(numbers.includes(n), `${lang}: the Limits paragraph states ${n}`);
  }
  const en = fs.readFileSync("text/en_us/PediaText.xml", "utf8");
  assert.ok(!/At most [0-9]+ tiles change hands per turn/.test(en), "en_us: no single per-turn cap for every path");
}

console.log("config.mjs OK");
