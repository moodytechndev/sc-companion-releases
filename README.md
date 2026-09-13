# SC Companion

A lightweight overlay for Star Citizen. Tracks refinery jobs and commodity prices, and fires alerts when your kiosk opens or a job completes — no alt-tab required.

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
