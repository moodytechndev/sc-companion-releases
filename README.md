# SC Companion

A lightweight overlay for Star Citizen. Sits on top of your game to track refinery jobs, commodity prices, and fire alerts when your kiosk opens or a job completes — no alt-tab required.

## Requirements

- [Node.js](https://nodejs.org) (v18 or later)
- Windows 10 / 11

## Running from source

```
1. Clone or download this repo
2. Open a terminal in the folder
3. npm install
4. Double-click launch.vbs
```

The overlay launches silently in the system tray. Click the tray icon to show/hide, or use your configured hotkey (default: Insert).

## Game log path

SC Companion watches your Star Citizen `game.log` to detect refinery events. The default path is:

```
C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\game.log
```

If your SC install is in a different location, open the Settings tab inside the app and update the log path.

## Hotkey

The default toggle hotkey is **Insert**. You can change it in the Settings tab. The app uses a Windows scheduled task (`SCCompanionHook`) to detect the hotkey even when Star Citizen has focus — you'll see a one-time UAC prompt the first time you set or change the hotkey.

## Building a distributable

```
npm install
npm run dist
```

The packaged zip will appear in the `dist/` folder.
