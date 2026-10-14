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
  - [Hangar](#hangar)
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
- **Refinery profit** — every job with a yield shows what it is worth (output × today's best sell price, less the refinery fee), and delivered jobs are kept in a **Profit** tab with totals, a per-method comparison and history
- **Experimental refinery capture** — screenshot + OCR the in-game refinery job screen to pre-fill a new job for you to review, or — from the terminal's PROCESSING screen — **import jobs that are already running**, skipping any the app already tracks
- **Full inventory system** — track ore and materials by box, grouped by ore type or by location, with quality, box size, split/merge of stacked boxes, and bulk move/sell/in-transit actions
- **Blueprints & crafting** — browse craftable items, see what you can craft **right now** from your stock, plan material quality against the resulting stats, build a shopping list for what you're missing, and craft straight from chosen inventory boxes
- **Assets & ships** — track everything you own; add your ships and see, swap and exchange their stock components, liveries and component sizes
- **Built-in Erkul calculator** — the Erkul DPS/loadout calculator runs inside the app
- **Illustrated user guide** — open it from the **?** button in the status bar; every section has annotated screenshots
- **Hover hints** — short "what does this do" descriptions on controls, in English, Deutsch, Français and Español (can be turned off)
- **Bring everything home** — one click in Settings sets all your inventory, assets and ships to your home base after a game update (with undo)
- **Backup & restore** — export everything (jobs, inventory, assets, ships, settings) to a file and restore it later or on another PC
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

**📷 Capture (experimental)**: turn it on under **Settings → Refinery Job Capture**. On the terminal's **PROCESSING** screen (one panel per running work order) it reads each work order — materials with quality and yield, and the time left — and opens an **Import running jobs** dialog: jobs already in the app are recognised and left unticked, doubtful numbers are highlighted, and everything is editable before you import. On the job **setup** screen it works as described below.  With the in-game refinery job screen visible, click **📷 Capture** — the app checks Star Citizen is running, takes four screenshots in quick succession, about half a second apart (scroll a long material list while it counts), then reads them with OCR — enlarging the material table, method and station name so small text reads cleanly — and pre-fills the Add Job form with whatever it recognised: materials with quality and yield, the method, the duration and the station. It **never** starts a job by itself — you review and correct the form first. Anything it couldn't read is left blank to fill in by hand.

**Collecting a finished job**: click **Delivered** on a ready job. A modal lets you record the actual box sizes and quantities you pulled from the cargo elevator for each ore in that job (pre-filled with a suggested box breakdown if you entered an expected yield when creating the job). Confirming adds those boxes straight into your **Hangar → Inventory**, automatically tagged with the job's location and marked **in-transit**, and removes the completed job from the list.

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

### Hangar

Four views: **My Blueprints**, **Inventory**, **Assets**, and **Ships**.

**My Blueprints**
- Browse craftable item blueprints (sourced from an external blueprint database, cached locally after first load)
- Toggle each one as **Owned** to track your collection
- Set the filter to **Craftable now** (it shows a live count) to see only what your current inventory can make. On every card the ingredient chips show your stock: **green** = enough (at or above the material's minimum quality), **amber** = some (with how much you hold), plain = none
- **Click a card** for its window: base stats, a **Global Quality** slider (0–999) plus per-part quality, the Base/Crafted stat table, which missions drop it, and a **Shopping list**
- The **Shopping list** shows only what you're short of, with where to mine it (top spots from the ore reference) and the cheapest known shop price, plus a rough cost for the shortfall
- Under each part you can pick the **inventory box** to use — its quality is used and the SCU is deducted when you **Craft & add to assets**
- Ship components show a size badge (**S0**–**S6**). Filter by Owned/Missing/All, by category, or by size, search by name, and sort alphabetically, by craft time, or by size (blueprints with no size, like armor, sort last)

**Inventory** — the core stock tracker
- **+ Add** opens a form: pick the ore/material, its quality %, one or more box sizes (SCU), and a location (pick from known Star Citizen stations or type a custom one). The location you used last is **remembered** — so adding a run of boxes to the same place is one pick, not many (the Add Asset, Add Ship and Add Job dialogs remember theirs too)
- Toggle **By Location** / **By Ore** to change how the list is grouped
- Each box shows a **locked box size** (fixed once created — it can't be changed afterward, only the amount inside it can), a read-only **fill %**, and an editable **Remainder** — the actual SCU currently in that box. Editing the Remainder is the only way to adjust how full a box is
- **Identical boxes condense** into a single `×N` row automatically. Use **Split** on a condensed row to pull a chosen number of boxes back out into their own line for individual editing or moving, and **↩ Merge** to fold them back together
- Select boxes with their checkboxes to **bulk move** them to a new location, mark them **in-transit** (🚚/🚀), or — from the In-Transit section — **move out** to a real location or **Sell**
- The yield dropdown (Raw SCU / ×70–95%) previews what your stock is worth after a refinery yield penalty, without changing your actual tracked quantities
- The bottom bar shows total SCU and an estimated aUEC value, calculated from the best known sell price for each ore you're holding

**Assets**
- Assets that aren't fitted to a ship are listed first under **Not attached**. Everything installed on a ship sits in a collapsible **Attached to ships** group below, grouped by ship and in slot order; each row says which ship and slot it's on, and clicking that opens the ship's component window. Ships themselves are managed on the **Ships** tab
- A tracker for everything you own or craft — ship components, armor, weapons, gear, vehicles: name, type (dropdown), optional size (shown for ship components), location (dropdown — the same station list as Inventory, plus Custom…), and free-text notes. Picking a ship-component type is what lets the ship window offer the asset for the right slot. Click the **✎** on any asset to edit it; crafted and stock details are kept
- Every ship you add brings its **stock components** into Assets automatically (one per weapon, shield, power plant, cooler, quantum drive, radar, mining laser or salvage head slot), tagged **stock** with grade and maker. A stock part you've swapped out of a ship shows under **Not attached**, free to fit elsewhere. The **All / Mine & crafted / Stock parts** filter switches between them, and search also matches the ship and slot a part is on
- Installing and swapping is done from the ship's component window, not on this page

**Ships**
- Two sub-tabs: **My Ships** and **Erkul DPS Calculator**
- **My Ships** is your owned-ship list. **+ Add** opens a searchable picker of every ship and vehicle from UEX Corp's database; pick one and optionally add a nickname, a location (dropdown — the same station list as Inventory, plus Custom…), and notes
- **Click a ship** to open its components. At the top of that window you can change the ship's **location** and **notes** at any time — they save as soon as you change them. The app pulls the ship's stock loadout (weapons, shields, power plants, coolers, quantum drives, radar, mining lasers, salvage heads) from the Star Citizen Wiki API and caches it on the ship. Each slot shows the stock item, and a dropdown lets you swap in one of your assets — matching assets are listed first, other assets below. Swapping is an exchange: the stock part stays in your Assets (free to fit elsewhere), and picking **Stock** puts it back. An asset can only be installed in one slot at a time; pick **Stock** to revert. Each slot shows its size, and assets whose type and size fit are listed first (an asset with no size recorded is assumed to fit). You can still pick a mismatched part from the other group, but the slot will flag it in red. **↻ Refresh stock data** re-downloads the loadout
- The ship's modal also has a **Livery** section. **Change ▼** lists every livery that fits that ship (pulled from the Star Citizen Wiki API, with how it's obtained — Subscriber, Luminalia, etc.), with a search box and a **Preview** image for each. Pick **Use** to record which livery the ship wears, or **Stock livery** to clear it. The choice shows on the ship card. This is a note-keeping field — it doesn't change anything in the game
- **Erkul DPS Calculator** runs the real [erkul.games](https://erkul.games/calculator) calculator inside the app. Erkul only renders its calculator on a wide screen (about 1000px+), so the overlay automatically widens while this tab is open and returns to its previous size when you leave. Erkul is a separate site with its own data — the app can't read your loadout out of it
- Removing a ship also removes its stock parts from Assets (a stock part fitted on another ship is kept as an ordinary asset); your crafted and manually added assets are never touched. Deleting an installed asset empties that slot — **↻ Refresh stock data** brings back any stock part you deleted

**Crafting → Assets**
- In a blueprint's details view, **＋ Add as crafted asset** saves the item to Assets using the quality values currently set on the sliders (install it on a ship afterwards from the Ships page)

---

## Settings — Full Reference

| Setting | What it does |
|---|---|
| **Language** | Switches the UI to English, Deutsch, Français, or Español |
| **Window Opacity** | Slider from 30–100% transparency for the whole overlay |
| **Show / Hide Key** | The global hotkey that toggles the overlay, even while Star Citizen has focus. Choose from Insert (default), F8–F11, Scroll Lock, Pause, Home, or End, then click **Set** |
| **Close Button** | Controls what the titlebar ✕ does: **Minimize to Tray** (default, keeps the app running) or **Quit App** |
| **Price Data Source** | **UEX Corp** (default), or **SC Trade Tools** — a community-reported feed from [sc-trade.tools](https://sc-trade.tools). The SC Trade Tools data is sparser than UEX's (it only covers stations players have recently reported) and is refreshed about hourly, so a quiet station can show no prices; obvious outlier reports are filtered out. The list of commodities and stations always comes from UEX. Switching clears the cached prices and reloads from the new source. The active source's logo sits at the top right of the Prices tab — click it to open that site |
| **Hover Hints** | **On** (default) shows a short description when you hover over a button, tab, chip, dropdown or card for about a third of a second; **Off** turns all of them off, including the browser-style tooltips. The descriptions follow the language setting (English, Deutsch, Français, Español) |
| **In-Transit Icon** | Choose whether in-transit inventory items show a 🚚 truck or 🚀 rocket icon |
| **Refinery Job Capture** *(experimental)* | **Manual entry** (default) hides the 📷 Capture button; **Auto-detect on capture** shows it on the Refinery → Active Jobs screen. Capture only ever pre-fills the Add Job form — you always review it before the job starts |
| **Clear Completed Jobs** | Removes every refinery job whose timer has already finished, keeping active ones |
| **Clear All Jobs** | Removes every tracked refinery job, finished or not |
| **Game Log Path** | Points the app at your Star Citizen `game.log` so it can watch it in the background. It currently tracks your last-known in-game station, laying the groundwork for future automation like auto-detecting refinery completions. The app looks for the log automatically at Star Citizen's default install path if you haven't set one yourself; the status dot shows whether a watcher is currently attached |
| **Bring everything home** | After a game update returns your gear to your home base: **Bring home…** asks for the place (the four landing zones — Area 18, Lorville, New Babbage, Orison — are listed first, then every station and your own custom names), lets you tick inventory boxes / assets / ships / cargo in transit, shows how many things will move, and applies it. Ship stock parts follow their ship. **Undo** (next to the button) restores every location |
| **Backup & Restore** | **Export** saves all your jobs, inventory, assets, ships, blueprint ownership, and settings to a JSON file you choose. **Import** loads one back in, overwriting the matching data — useful for moving to a new PC or recovering after a reinstall |
| **Report a Bug** | Sends a short description straight to the developer's Discord via a webhook, along with your app version and OS — no account or email needed. You can optionally attach a screenshot of the screen you were on, the last refinery capture (the screen it read plus the text it got), a fresh grab of the game window, or images you pick — each is previewed first and nothing is attached unless you tick or add it |

The bottom of the Settings tab also shows the current app version and a reminder that prices come from UEX Corp, a community-maintained trade database.

---

## Status Bar

The bar along the bottom of the window (always visible) shows:

- A colored dot + text for the UEX Corp connection status (green = connected, yellow = loading, red = unreachable)
- The number of currently active refinery jobs
- A 🔓/🔒 button that locks the window to its current size (disables resizing) — handy once you've got it positioned how you like
- The **?** button, which opens the illustrated **user guide** (searchable, with annotated screenshots of every screen)
- The ⚙ Settings shortcut

---

## Data & Privacy

Everything you track — jobs, inventory, assets, ships, blueprint ownership, and settings — is stored **locally only**, on your own machine, via Electron's local storage. Nothing is uploaded anywhere except:

- **Commodity/station prices**: fetched live from the public [UEX Corp](https://uexcorp.space) API
- **Blueprint data**: fetched from an external blueprint database and cached locally after the first load
- **Bug reports**: only sent if you explicitly use the Report a Bug button. They contain the text you typed plus your app version and OS — and any screenshots or images you chose to attach (each is previewed first; game screens can show your character name and balance, so look before you send). The app keeps the screen you were on, and the last refinery capture, in memory only so they can be offered; they are never sent unless you tick them
- **Update checks**: the app pings GitHub Releases to check for new versions on launch and every 3 hours while running

---

## Building from Source

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Sanity-check the code before a release (syntax + calls to undefined functions)
npm run check

# Re-generate the user-guide screenshots (renderer/help/*.webp)
npm run help-images

# Build Windows installer
npm run dist
```

Requires Node.js 18+ and a Windows environment for the installer build.

**The user guide.** Its text and the numbered pointers live in `renderer/help-content.js`. `npm run help-images` launches the real app on a throw-away profile with demo data, outlines each listed element with its number, and saves the screenshots — so the numbers in the image and the legend beside it always match. Re-run it whenever a screen changes, and run `npm run check` before packaging.

---

## License

MIT — see [LICENSE](LICENSE) for details.
© 2026 Moody Technical Development Solutions
