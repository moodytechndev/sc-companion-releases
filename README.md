# SC Companion

Star Citizen companion overlay — refinery timers, commodity prices with station buy/sell tracking, mining tools, and a full inventory system. Runs as a frameless, always-on-top window so it stays visible over the game without alt-tabbing.

> **Download the latest release** from the [Releases page](https://github.com/moodytechndev/sc-companion-releases/releases/latest).

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [First Launch](#first-launch)
- [How to Use](#how-to-use)
  - [Mining](#mining)
  - [Refinery](#refinery)
  - [Prices](#prices)
  - [Craft](#craft)
- [Settings — Full Reference](#settings--full-reference)
- [Status Bar](#status-bar)
- [Data & Privacy](#data--privacy)
- [Building from Source](#building-from-source)
- [License](#license)

---

## Features

- **Refinery job timers** — track multiple active refinery jobs with live countdowns, desktop notifications on completion, and a delivery flow that records exactly what you collected
- **Commodity prices** — live sell/buy prices from UEX Corp, browsable by commodity or by station
- **Station buy/sell tracking** — buy a commodity at a station (marks it in-transit automatically) and sell your in-transit stock back, with a summary of what you made
- **Mining reference tools** — ore location lookup by rock/moon, a signature scanner (both a reference chart and a live RS-signature solver), and an Aaron Halo quantum-drop calculator
- **Full inventory system** — track ore and materials by box, grouped by ore type or by location, with quality %, box size, split/merge of stacked boxes, and bulk move/sell/in-transit actions
- **Blueprint tracking** — browse craftable item blueprints, mark which ones you own, and filter/sort them
- **Asset tracker** — a simple list for ships, vehicles, and components you own
- **Backup & restore** — export everything (jobs, inventory, settings) to a file and restore it later or on another PC
- **Auto-updater** — checks for new versions on launch and every 3 hours while running, with an in-app download/install banner

---

## Installation

1. Download `SC Companion Setup x.x.x.exe` from the [latest release](https://github.com/moodytechndev/sc-companion-releases/releases/latest)
2. Run the installer — you can choose the install location and whether to create desktop/Start Menu shortcuts
3. Launch **SC Companion** from the desktop shortcut or Start Menu

Windows may show a SmartScreen prompt on first run since the app isn't from a high-volume publisher yet — click **More info → Run anyway**. The installer itself is code-signed.

---

## First Launch

- The overlay opens at a default size and remembers its position/size between launches
- **Show / hide**: press **Insert** (the default hotkey — change it in Settings) at any time, even while Star Citizen has focus
- **Tray icon**: click it to show/hide the window; right-click it for a quick menu (Show/Hide, Quit)
- **Closing** the window (✕ in the titlebar) minimizes to tray by default rather than quitting — change this in Settings if you'd rather it quit outright
- The status bar at the bottom shows whether the UEX Corp price feed is connected, how many refinery jobs are active, a window size-lock toggle, and the Settings gear

---

## How to Use

### Mining

The Mining tab has three views, switchable via the chips at the top.

**Ore Locations**
- A searchable list of every mineable ore, each showing the rocks/moons/belts where it's found, with a share percentage and radar signature range per location
- Search filters both ore names and location names at once
- **Click an ore row** to select it — this cross-filters the Scanner tab's Reference view (below) to only show signatures for ores you've selected here. Click it again to deselect, or use the **Clear** button that appears once something's selected

**Scanner**
- Two modes, toggled via the chips: **Reference** and **Scan**
- **Reference** mode shows a table of every mineable signature, grouped by rarity tier (Legendary/Epic/Rare/Uncommon/Common), with the base radar signature and pre-multiplied values for 2–6 rocks in one cluster — handy for reading a scan result without doing math. Filter by tier, by a specific location (using the same location list as Ore Locations), or by ore selections made in the Ore Locations tab
- **Scan** mode is the reverse: type in the raw RS signature number your ship's scanner reads, and it solves for which mineral(s) it could be and how many rocks are clustered together, ranked by confidence (exact match vs. within a small margin)

**Aaron Halo**
- A quantum-travel drop calculator for the Aaron Halo asteroid belt
- Pick a **From** and **To** station and a **Band** (1–10), or use one of the preset route buttons for common routes
- Shows the entry/exit/peak HUD countdown numbers for cutting your quantum drive at the right moment, the band's density tier, its top mineable ores, and a step-by-step "how to drop" guide

### Refinery

**Active Jobs**
1. Click **+ Add Refinery Job**
2. Add one or more ores/materials being refined in this job (each with its own quality % and expected yield in cSCU, both optional but used later for the delivery step)
3. Pick the refinery **Method** used (or leave it as Custom)
4. Enter the **Duration** by copying the countdown shown in the in-game refinery terminal (hours/minutes/seconds)
5. Optionally set the **Location** and any **Notes**
6. Click **Start Timer**

Jobs count down live in the list. When a job's timer hits zero, you get a desktop notification and the card turns green with a **Delivered** button.

**Collecting a finished job**: click **Delivered** on a ready job. A modal lets you record the actual box sizes and quantities you pulled from the cargo elevator for each ore in that job (pre-filled with a suggested box breakdown if you entered an expected yield when creating the job). Confirming adds those boxes straight into your **Craft → Inventory**, automatically tagged with the job's location and marked **in-transit**, and removes the completed job from the list.

**Station Bonuses**
- Pick a station from the dropdown to see its refinery yield bonus/penalty per material, sorted best to worst — useful for choosing where to refine a given ore

### Prices

Two views, toggled via the **Commodity** / **Station** chips at the top.

**Commodity view**
- Search and browse every tradeable commodity with its best-known sell price
- Filter chips: **All**, **Minerals**, **Raw Ore**, **Refined**, or **In Inventory** (only commodities you currently have some quantity of, anywhere)
- Click a commodity to see its top sell locations (ranked, medal icons for the top 3) and the single best buy location above that. Click any location row for a full sell/buy breakdown of every commodity traded at that terminal

**Station view**
- Pick a specific station from the dropdown to see every commodity it trades, with sell and buy prices side by side
- Each row has **Buy** and **Sell** buttons. A button is greyed out and disabled if the station doesn't trade that commodity in that direction (no sell price = they won't buy it from you; no buy price = they don't sell it to you)
- **Buy**: opens the Add Inventory form pre-filled with the commodity and this station as the location — fill in quality/box size/quantity and save. The item is automatically marked **in-transit**
- **Sell**: only works on stock you've marked in-transit (from a Buy here, or from the 🚚/🚀 button in Inventory). If you have some, a modal shows a breakdown of where it's sitting, the total SCU, the price per SCU, and the estimated total payout — confirm to remove it from your tracked inventory and see exactly what you made

### Craft

Three views: **My Blueprints**, **Inventory**, and **Assets**.

**My Blueprints**
- Browse craftable item blueprints (sourced from an external blueprint database, cached locally after first load)
- Toggle each one as **Owned** to track your collection
- Filter by Owned/Missing/All, by category, search by name, and sort alphabetically or by craft time

**Inventory** — the core stock tracker
- **+ Add** opens a form: pick the ore/material, its quality %, one or more box sizes (SCU), and a location (pick from known Star Citizen stations or type a custom one)
- Toggle **By Location** / **By Ore** to change how the list is grouped
- Each box shows a **locked box size** (fixed once created — it can't be changed afterward, only the amount inside it can), a read-only **fill %**, and an editable **Remainder** — the actual SCU currently in that box. Editing the Remainder is the only way to adjust how full a box is
- **Identical boxes condense** into a single `×N` row automatically. Use **Split** on a condensed row to pull a chosen number of boxes back out into their own line for individual editing or moving, and **↩ Merge** to fold them back together
- Select boxes with their checkboxes to **bulk move** them to a new location, mark them **in-transit** (🚚/🚀), or — from the In-Transit section — **move out** to a real location or **Sell**
- The yield dropdown (Raw SCU / ×70–95%) previews what your stock is worth after a refinery yield penalty, without changing your actual tracked quantities
- The bottom bar shows total SCU and an estimated aUEC value, calculated from the best known sell price for each ore you're holding

**Assets**
- A simple tracker for ships, vehicles, and components: name, type, location, and free-text notes

---

## Settings — Full Reference

| Setting | What it does |
|---|---|
| **Language** | Switches the UI to English, Deutsch, Français, or Español |
| **Window Opacity** | Slider from 30–100% transparency for the whole overlay |
| **Show / Hide Key** | The global hotkey that toggles the overlay, even while Star Citizen has focus. Choose from Insert (default), F8–F11, Scroll Lock, Pause, Home, or End, then click **Set** |
| **Close Button** | Controls what the titlebar ✕ does: **Minimize to Tray** (default, keeps the app running) or **Quit App** |
| **Price Data Source** | Currently locked to **UEX Corp**. A **SC Trader** option is planned but not yet available (shown disabled) |
| **In-Transit Icon** | Choose whether in-transit inventory items show a 🚚 truck or 🚀 rocket icon |
| **Clear Completed Jobs** | Removes every refinery job whose timer has already finished, keeping active ones |
| **Clear All Jobs** | Removes every tracked refinery job, finished or not |
| **Game Log Path** | Points the app at your Star Citizen `game.log` so it can watch it in the background. It currently tracks your last-known in-game station, laying the groundwork for future automation like auto-detecting refinery completions. The app looks for the log automatically at Star Citizen's default install path if you haven't set one yourself; the status dot shows whether a watcher is currently attached |
| **Backup & Restore** | **Export** saves all your jobs, inventory, assets, blueprint ownership, and settings to a JSON file you choose. **Import** loads one back in, overwriting the matching data — useful for moving to a new PC or recovering after a reinstall |
| **Report a Bug** | Sends a short description straight to the developer's Discord via a webhook, along with your app version and OS — no account or email needed |

The bottom of the Settings tab also shows the current app version and a reminder that prices come from UEX Corp, a community-maintained trade database.

---

## Status Bar

The bar along the bottom of the window (always visible) shows:

- A colored dot + text for the UEX Corp connection status (green = connected, yellow = loading, red = unreachable)
- The number of currently active refinery jobs
- A 🔓/🔒 button that locks the window to its current size (disables resizing) — handy once you've got it positioned how you like
- The ⚙ Settings shortcut

---

## Data & Privacy

Everything you track — jobs, inventory, assets, blueprint ownership, and settings — is stored **locally only**, on your own machine, via Electron's local storage. Nothing is uploaded anywhere except:

- **Commodity/station prices**: fetched live from the public [UEX Corp](https://uexcorp.space) API
- **Blueprint data**: fetched from an external blueprint database and cached locally after the first load
- **Bug reports**: only sent if you explicitly use the Report a Bug button, and only contain the text you typed plus your app version and OS
- **Update checks**: the app pings GitHub Releases to check for new versions on launch and every 3 hours while running

---

## Building from Source

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build Windows installer
npm run dist
```

Requires Node.js 18+ and a Windows environment for the installer build.

---

## License

MIT — see [LICENSE](LICENSE) for details.
© 2026 Moody Technical Development Solutions
