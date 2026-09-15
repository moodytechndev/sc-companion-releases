# SC Companion

Star Citizen companion overlay — refinery timers, commodity prices, mining tools, and inventory tracking.

> **Download the latest release** from the [Releases page](https://github.com/moodytechndev/sc-companion-releases/releases/latest).

---

## Features

- **Refinery Timers** — track active refinery jobs with countdown timers and completion alerts
- **Commodity Prices** — live buy/sell prices from UEX Corp; filter by inventory or search by name
- **Mining Tools** — ore location lookup, Aaron Halo scanner, and yield calculators
- **Inventory** — track mined/crafted stock, mark items in transit, and view by ore or location
- **Always-on-top overlay** — stays visible over Star Citizen with adjustable opacity
- **Auto-updater** — notifies you when a new version is available

---

## How to Use

### Installation

1. Download `SC Companion Setup x.x.x.exe` from the [latest release](https://github.com/moodytechndev/sc-companion-releases/releases/latest)
2. Run the installer — choose your install location
3. Launch **SC Companion** from the desktop shortcut or Start menu

### Show / Hide the Overlay

- Use the keyboard shortcut (default: shown in **Settings → Shortcut**) to toggle the overlay at any time
- Click the tray icon to show or hide the window
- Right-click the tray icon for quick options including Quit

### Refinery Timers

1. Click **+** to add a new job — enter the station, ore, method, and duration
2. Jobs count down live; a desktop notification fires when a job completes
3. Click the job row to expand details; use the trash icon to remove finished jobs

### Commodity Prices

- Browse all tradeable commodities with best sell and buy prices
- Use the **filter chips** at the top to narrow to:
  - **All** — every commodity
  - **Favorites** — starred commodities
  - **In Transit** — items currently marked in-transit in your inventory
- Click any commodity row to see the top terminals and a buy/sell breakdown
- Prices refresh automatically on launch; click **Refresh** to update manually

### Mining Tools

- **Ore Locations** — look up which rocks carry a specific ore
- **Scanner** — Aaron Halo reference cards by commodity type
- **Yield Calculator** — estimate refined output from raw SCU

### Inventory

Track your mined or crafted stock across locations.

**Adding items:**
1. Click **+ Add** at the top of the Inventory tab
2. Enter ore name, quantity, unit (SCU / cSCU), quality %, and location

**Organizing:**
- Items are grouped by **ore type** by default; toggle **By Location** to group by station
- Expand a group to see individual boxes; each box is editable in place

**Moving to transit:**
1. Expand an ore or location card
2. Check the boxes you want to move
3. Click the **🚚 / 🚀** transit button in the action bar — items move to the *In Transit* container
4. From the *In Transit* card, select items and either **Move out** to a new location or **💰 Sell** to remove them

### Settings

| Setting | What it does |
|---|---|
| Shortcut | Global hotkey to show/hide the overlay |
| Opacity | Window transparency (10–100%) |
| Always on top | Keep overlay above other windows |
| Resizable | Allow window resize |
| Close behavior | Minimize to tray or quit on close |
| Price Data Source | UEX Corp (active); SC Trader (coming soon) |
| In-Transit Icon | Choose 🚚 Truck or 🚀 Rocket for transit items |
| Log Path | Path to your Star Citizen `game.log` for auto-detection |
| Bug Report | Send a report directly to the development Discord |

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
