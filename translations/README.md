# Translating SC Companion

Thank you for helping! SC Companion is a free overlay for Star Citizen. Three spreadsheets need
translating — add **one new column** to each, headed with your language code (for example
`it` for Italian, `tr` for Turkish, `ko` for Korean, `zh` for Chinese, `uk` for Ukrainian).

| File | What it is | Rows |
|---|---|---|
| `ui-strings.csv` | Buttons, tab names, settings and dialogs | ~110 |
| `hover-hints.csv` | The short tooltip shown when you hover a control | ~190 |
| `guide-strings.csv` | The illustrated user guide (sections, steps, tips, FAQ and screenshot captions) | ~230 |

The existing languages (German, French, Spanish, Polish, Portuguese, Russian, Japanese) are
there as a reference, including how they handled the game terms.

## Rules

1. **Keep the placeholders exactly**: `{0}`, `{n}` are filled in by the app (a version number, a
   number of jobs, a station name). Move them where your language needs them, but don't
   change or translate them.
2. **Keep game and in-app names in English** when the app itself shows them in English:
   *SCU, cSCU, Quantanium, Aaron Halo, Erkul, UEX, Capture, Custom…, Sell, Assets, Ships,
   Insert* and the rarity names *Common / Uncommon / Rare / Epic / Legendary*. Ore and
   material names are not translated by this app.
3. **Keep emoji and symbols** at the start of a string (⛏ 📦 ✓ ▶ ✔ ✎ ✕ + → ↑ ↓).
4. **Keep it short.** This is a small overlay window — long labels wrap or get cut. If a
   translation is much longer than the English, find a shorter wording.
5. **Plurals** (`status.activeJobs_…`): give the form for each count your language needs.
   `_one` is 1, `_other` is the general plural. Languages with more forms (Polish, Russian,
   Czech, Arabic…) also fill `_few` and `_many`; leave those blank if your language doesn't
   have them.
6. **Hints** are full sentences telling someone what a control does — write them the way a
   helpful tooltip would read in your language, not word for word.
7. If a row is unclear, leave it empty — the app falls back to English for anything left blank.

## Sending it back

Send the files back as they are (UTF-8 CSV — Excel and Google Sheets both handle it; if
Excel asks, choose "CSV UTF-8"). If you are on Excel, please re-save as **CSV UTF-8** so
accents and non-Latin letters survive.

## For the developer

```
node scripts/translations.js export     # regenerate these files from the app
node scripts/translations.js import     # merge returned columns into renderer/i18n.js and help-translations.js
```

A new language also needs one line in the language dropdown in `renderer/index.html`; the
import command prints it.
