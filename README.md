# SC Companion

A compact Electron overlay for Star Citizen — keeps mission-critical data visible while you play without alt-tabbing.

---

## Features

| Tab | What it does |
|-----|-------------|
| **Timers** | Refinery job countdown timers with auto-detection from the game log |
| **Prices** | Live buy/sell commodity prices from UEX Corp; pre-loaded at startup |
| **Inventory** | Ore cargo valuation — shows best sell price and terminal per group |
| **Mining** | Per-ore location data with share % and signature counts (always visible) |
| **Aaron Halo** | QT drop calculator — picks the exact HUD distance to cut engines for any band |
| **Crafting** | Planned |

---

## Tech Stack

- **Electron 31** — `contextIsolation: true`, `nodeIntegration: false`
- **electron-store 8.2** — persistent key-value store (jobs, price cache, settings)
- **electron-updater 6** — GitHub Releases auto-update
- **electron-builder 26** — NSIS installer, `--win x64`
- **UEX Corp API v2.0** — `https://api.uexcorp.space/2.0/` (commodities, prices)
- No frontend framework — single-page vanilla JS in `renderer/index.html`

---

## Quick Start

```bash
npm install
npm start          # dev — opens window immediately
npm run dist       # production build → dist/
```

> **Note:** The first `npm run dist` takes a while — it downloads the Electron binary if not cached.

---

## Directory Structure

```
SC-Companion/
├── main.js              # Main process: BrowserWindow, IPC, fetch, auto-updater
├── preload.js           # contextBridge — exposes window.api to renderer
├── renderer/
│   └── index.html       # Entire UI (single file, vanilla JS + inline CSS)
├── build/
│   └── installer.nsh    # NSIS custom installer script
├── dist/                # Build output (gitignored except archive/)
│   └── archive/         # Previous release installers
├── icon.png
└── package.json
```

---

## Architecture Notes

### IPC Pattern
All renderer→main communication goes through `preload.js`:
```js
// preload.js
contextBridge.exposeInMainWorld('api', {
  getCommodities: () => ipcRenderer.invoke('api:getCommodities'),
  // ...
});

// renderer calls:
const data = await api.getCommodities();
```

### Price Caching (Stale-While-Revalidate)
Prices are loaded from `electron-store` at startup so the Prices tab is populated instantly. A background fetch via `api:getBulkPrices` (UEX bulk endpoint → typed fallback → per-commodity batch) overwrites the cache and re-renders silently.

### KeyHook.exe
`KeyHook.exe` is a native binary for the global shortcut toggle. It **must** be listed under `asarUnpacked` in `package.json` — it cannot run from inside the asar archive.

### Window Behavior
The overlay is frameless, always-on-top (configurable), and draggable via `-webkit-app-region: drag` on the titlebar. Opacity is adjustable per-session.

---

## Build & Release

1. Make your changes to `renderer/index.html`, `main.js`, or `preload.js`
2. Bump `version` in `package.json`
3. Move the previous installer from `dist/` → `dist/archive/vX.X.X/`
4. Run `npm run dist`
5. New installer appears in `dist/SC Companion Setup X.X.X.exe`
6. Create a GitHub Release tagged `vX.X.X` and upload the `.exe` — auto-updater picks it up

---

## API Reference

| Endpoint | Used for |
|----------|---------|
| `GET /commodities` | Full commodity list (name, id, type) |
| `GET /commodities_prices` | Bulk price rows (sell + buy) |
| `GET /commodities_prices?id_commodity=N` | Single commodity prices |

---

## Dev Notes

- `npm start` vs `npm run dev` — both work; `dev` sets `--dev` flag (no auto-updater check)
- The renderer is intentionally one file for easy distribution inside the asar
- `electron-store` data lives in `%APPDATA%\sc-companion\` on Windows
- HUD GM distances are computed via ray-sphere intersection math against UEX station coordinates
