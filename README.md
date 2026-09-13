# SC Companion

A lightweight overlay for Star Citizen. Tracks refinery jobs and commodity prices, and fires alerts when your kiosk opens or a job completes — no alt-tab required.

## Just want to run it?

Download the latest release — no Node.js, no terminal, no setup required.

👉 **[SC Companion v1.3.1 — Download ZIP](https://github.com/moodytechndev/sc-companion-releases/releases/latest)**

1. Download `SC-Companion-v1.3.1.zip` from the Assets section
2. Extract the zip anywhere on your PC
3. Open the extracted folder and run **SC Companion.exe**

That's it. The app launches to your system tray.

> See [Known Issues](#known-issues) for current limitations before reporting bugs.

---

## Requirements

- [Node.js](https://nodejs.org) v18 or later
- Windows 10 / 11

---

## Option A — Run from source (no installer)

Prefer to see exactly what's running? This path skips any installer entirely. The app runs directly through Electron, which npm downloads from its official registry.

```
1. Clone or download this repo
2. Open a terminal in the folder
3. npm install
4. Double-click launch.vbs  — or run: npm start
```

The overlay launches silently to the system tray. Click the tray icon or press your hotkey (default: **Insert**) to show/hide.

> **About KeyHook.exe** — this small binary detects your hotkey even when Star Citizen has focus. Its full source is in `KeyHook.cs`. If you'd rather compile it yourself than trust the included binary, see the note at the bottom.

---

## Option B — Build a distributable

Produces a packaged zip and installer in `dist/` that you can share with others.

```
1. Clone or download this repo
2. Open a terminal in the folder
3. npm install
4. npm run dist
```

Output appears in the `dist/` folder.

---

## Game log path

SC Companion watches your Star Citizen `game.log` to detect refinery events. The default path is:

```
C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\game.log
```

If SC is installed elsewhere, open the **Settings** tab in the app and update the path.

---

## Hotkey

Default toggle: **Insert**. Change it any time in the **Settings** tab. The first time you set a hotkey the app creates a Windows scheduled task (`SCCompanionHook`) to detect it while Star Citizen has focus — you'll see a one-time UAC prompt.

> ⚠️ **Note:** Show/hide toggle behavior may be unreliable in some scenarios. See [Known Issues](#known-issues).

> ⚠️ **KeyHook.exe** is a pre-compiled binary required for hotkey detection while Star Citizen has focus. Its full source is in `KeyHook.cs`. If you'd prefer to compile it yourself rather than trust the included binary, see [Compiling KeyHook.exe yourself](#compiling-keyhookexe-yourself).

---

## How to Use

Once the overlay is running, press your hotkey (default: **Insert**) to show or hide it. It lives in your system tray when hidden.

### ⛏ Refinery Tab

Track active refinery jobs with live countdown timers.

1. Click **+ Add Refinery Job**
2. Enter the ores/materials, refinery method, duration (copy it directly from the in-game UI), location, and any notes
3. Click **▶ Start Timer** — your job appears as a card with a progress bar and countdown
4. When the job completes, a **Deliver** button appears — click it to log what you pulled from the cargo elevator and automatically add it to your inventory

**Auto-detection:** If your game log path is configured in Settings, the overlay auto-opens when you walk up to a refinery kiosk in-game.

---

### ⛰ Mining Tab

Two views, toggle with the chips at the top:

- **Ore Locations** — search any ore to see every location it spawns, including share percentage and radar signature count
- **Station Bonuses** — select a station from the dropdown to see its refinery bonuses

---

### 📈 Prices Tab

Live commodity prices pulled from UEX Corp.

- Search by name or use the filter chips (All / Minerals / Raw Ore / Refined / In Inventory)
- Click any commodity to expand a ranked list of the best sell locations with terminal names and current prices

---

### 🔧 Craft Tab

Two views, toggle with the chips at the top:

- **My Blueprints** — browse all craftable items; mark ones you own, filter by category, sort by name or craft time; items highlight green when you have all ingredients in inventory
- **Inventory** — track your ore and material stockpiles; add entries with ore type, quality %, box sizes, and location; sort by ore name or SCU quantity

---

### ⚙ Settings

Click the gear icon in the bottom-right corner.

| Setting | Description |
|---|---|
| Language | Switch between English, Deutsch, Français, Español |
| Window Opacity | Adjust how transparent the overlay is |
| Show / Hide Key | Change the toggle hotkey (Insert, F8–F11, Scroll Lock, Pause, Home, End) |
| Close Button | Choose whether ✕ minimizes to tray or quits the app |
| Clear Completed Jobs | Remove all finished refinery jobs |
| Clear All Jobs | Remove every tracked job |
| Game Log Path | Path to `game.log` for auto-detection of refinery kiosk events |
| Backup & Restore | Export or import all jobs, inventory, and settings as a JSON file |

---

## Planned Updates

- **Language support** — French, Spanish, and German localizations

---

## Known Issues

- **Close behavior** — The close/quit setting may not apply consistently; the window can behave unexpectedly when closed depending on how the app was launched.
- **Show / Hide** — The overlay show and hide toggle may not respond reliably in all scenarios, particularly when Star Citizen has focus.

These are being tracked for a future release.

---

## Compiling KeyHook.exe yourself

If you'd rather not trust the pre-built binary, compile it from `KeyHook.cs` using the .NET SDK:

```
# Install the .NET SDK from https://dotnet.microsoft.com/download, then:
csc KeyHook.cs
```

Replace the `KeyHook.exe` in the repo folder with your compiled output before launching.
