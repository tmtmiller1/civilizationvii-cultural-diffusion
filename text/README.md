# Translating Cultural Diffusion (`text/`)

Every string a player sees in Cultural Diffusion is a `LOC_*` tag defined here and looked up by the game at run time.
The scripts set no display text of their own (`tests/i18n.mjs` checks this), so a translation needs no code change:
add the language's files here and register them in the modinfo.

## Files

| File | Contents |
| --- | --- |
| `en_us/ModText.xml` | The mod's name and description, the Options rows and their tooltips, the lens name, the Cultural Pressure hover readout and the notifications. |
| `en_us/PediaText.xml` | The Civilopedia: the Cultural Diffusion section and the Cultural Borders page under Game Concepts. Pages and chapters follow the key convention described at the top of the file. |

English is the source of truth. All eleven languages below ship as machine translations (2026-10-06) that use the
game's own words for its terms, taken from the game's l10n files by `devtools/gen-glossary.py` into
`devtools/glossary/` (generated locally, not committed; run `python3 devtools/gen-glossary.py` to rebuild it). To
correct one, edit its `<Text>`; to change the English, edit the English and update every language.
`node devtools/check-locale.mjs <folder>` checks a single folder.

## Two file shapes

English uses an `EnglishText` block with `Row`:

```xml
<Database>
    <EnglishText>
        <Row Tag="LOC_CD_TOAST_GAINED"><Text>Cultural Diffusion: your culture has claimed new territory.</Text></Row>
    </EnglishText>
</Database>
```

Every other language uses a `LocalizedText` block with `Replace` and a `Language` attribute:

```xml
<Database>
    <LocalizedText>
        <Replace Tag="LOC_CD_TOAST_GAINED" Language="de_DE"><Text>...</Text></Replace>
    </LocalizedText>
</Database>
```

**The `Language` value is not the folder name.** Use these exactly (note `zh_cn`):

| Folder | `Language=` | Folder | `Language=` |
| --- | --- | --- | --- |
| `de_de` | `de_DE` | `pl_pl` | `pl_PL` |
| `es_es` | `es_ES` | `pt_br` | `pt_BR` |
| `fr_fr` | `fr_FR` | `ru_ru` | `ru_RU` |
| `it_it` | `it_IT` | `zh_cn` | `zh_Hans_CN` |
| `ja_jp` | `ja_JP` | `ko_kr` | `ko_KR` |
| `zh_hk` | `zh_Hant_HK` (Traditional Chinese) | | |

## Registering a language in the modinfo

`cultural-diffusion.modinfo` loads text in two action groups: `cultural-diffusion-shell` (the main menu's Additional
Content list and Options) loads `ModText.xml`, and `cultural-diffusion-game` loads both files. For German:

```xml
<!-- cultural-diffusion-shell, under <UpdateText> -->
<Item locale="de_DE">text/de_de/ModText.xml</Item>

<!-- cultural-diffusion-game, under <UpdateText> -->
<Item locale="de_DE">text/de_de/ModText.xml</Item>
<Item locale="de_DE">text/de_de/PediaText.xml</Item>
```

## Rules

- **Every tag, in every language.** Each language must hold exactly the English tags. The game loads one language at
  a time, so a tag missing from a translation shows as the raw `LOC_...` key to that language's players.
- **No tag twice.** A duplicate tag makes the game drop the whole file.
- **Keep the placeholders and icons.** `{1_Turns}` is filled in by the game; keep it in whatever position the language
  needs. `{1_Turns: plural 1?turn; other?turns;}` uses the game's plural syntax: translate the words inside and use the
  plural categories the language needs, as the game's own text for that language does. Keep every `[icon:YIELD_...]`.
- **Keep the markup.** `[B]...[/B]` is bold; `[BLIST][LI]...[LI]...[/LIST]` is a bulleted list.
- **Options names match.** The Civilopedia names Options rows (Claim empty land only, Every civilization gains land by
  culture, and so on). Use the same words in the Civilopedia as in the Options label, so a player can find the row.
- **Page titles stay short.** The Civilopedia sidebar cuts titles longer than about 24 characters (about 12 CJK
  characters).
- **Search terms.** Tags with `_TERM_` are words a player types into the Civilopedia search box; translate them as the
  word a player of that language would search for.
