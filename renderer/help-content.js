// User guide content — read by the in-app Help view AND by scripts/capture-help.js,
// which drives the real app, outlines each `points[].sel` element with its number,
// and saves the screenshot to renderer/help/<file>. Because the numbers in the image
// and the legend below it both come from `points`, they can't drift apart.
//
// Shot fields:
//   file      output image under renderer/help/
//   title     heading shown above the image
//   caption   one line under the image (optional)
//   viewport  {w, h} CSS pixels the screenshot is taken at
//   setup     JS (async function body) that puts the app into the state to photograph
//   after     JS run after the capture to tidy up (close modals etc.)
//   points    [{sel, text, contains?, nth?, at?}] — `sel` is a CSS selector; `contains` picks
//             the first match whose text includes it; `nth` picks the nth match; `at` is the
//             badge corner: tl (default) | tr | bl | br. Every point must resolve, or the
//             generator reports it (the legend and the image would otherwise disagree).
//
// To refresh the images after changing the UI:  node scripts/capture-help.js

const HELP_SECTIONS = [
  {
    id: 'start', icon: '🚀', title: 'Getting started',
    intro: [
      'SC Companion is an always-on-top overlay for Star Citizen: refinery timers, live commodity prices, mining references, and a full inventory / crafting / ship tracker — without alt-tabbing.',
      'Everything you enter is stored on your own PC. Prices come from UEX Corp; blueprints from sc-craft.tools; ship data from the Star Citizen Wiki.',
    ],
    shots: ['overview'],
    tips: [
      '**Show / hide:** press **Insert** (changeable in Settings) at any time, even while the game has focus.',
      '**Move and resize:** drag the title bar to move the window and drag its edges to resize. The 🔓 button in the status bar locks the size once you have it how you like.',
      '**Closing:** ✕ hides the overlay to the system tray by default. Click the tray icon to bring it back, or right-click it to quit.',
      '**Hover hints:** hold the mouse over almost anything for a short description. Turn them off in Settings → Hover Hints.',
      '**Updates:** a blue banner appears when a new version is available — click Download, then Update Now.',
    ],
  },
  {
    id: 'mining', icon: '⛰', title: 'Mining',
    intro: ['Three reference tools for the mining side of the game. Pick one with the chips under the tab bar.'],
    shots: ['mining-locations', 'mining-scanner-ref', 'mining-scanner-scan', 'mining-halo'],
    howto: [
      '**Find where to mine something:** Ore Locations → type the ore name in the search box.',
      '**Identify a rock from your scanner:** Scanner → Scan → type the RS number your ship shows.',
      '**Read the whole signature table:** Scanner → Reference, then filter by rarity or location.',
      '**Plan a quantum drop into the Aaron Halo:** Aaron Halo → pick a preset route, or choose From / To / Band yourself.',
    ],
    tips: [
      'Clicking an ore in Ore Locations selects it. The Scanner Reference then shows only the signatures for the ores you selected — handy for planning a trip around one mineral.',
      'Reference and Scan use the same data; Reference shows every cluster size at once, Scan tells you which ore and how many rocks a single number means.',
    ],
  },
  {
    id: 'refinery', icon: '⛏', title: 'Refinery',
    intro: [
      'Track every refinery job with a live countdown, get a desktop notification when it finishes, and record exactly what you collected so it lands in your inventory.',
    ],
    shots: ['refinery-jobs', 'refinery-add', 'refinery-import', 'refinery-deliver', 'refinery-bonuses', 'refinery-profit'],
    howto: [
      '**Start a job:** + Add Refinery Job → add the ore(s), pick the method, enter the duration shown on the in-game terminal, set the location, then Start Timer.',
      '**Let the app read the screen (experimental):** with the in-game refinery job screen visible, click 📷 Capture. It takes four shots in quick succession (scroll the list while the button counts if it is long), then reads them and pre-fills the form. You always review it before starting. Turn the button on under Settings → Refinery Job Capture.',
      '**Bring in jobs that are already running:** open the terminal\'s PROCESSING screen (the one with a panel per work order) and click 📷 Capture. A dialog lists each work order with its materials, quality, yield and time left. Jobs the app already tracks are recognised and left unticked; tick or untick the rest, fix any highlighted number, then Import.',
      '**Collect a finished job:** when the card turns green click Delivered, enter the boxes you pulled from the cargo elevator, then Add to Inventory.',
      '**Choose where to refine:** Station Bonuses lists a station\'s yield bonus or penalty for every material.',
      '**See what a job is worth:** enter each ore\'s yield and every job card shows an estimated value and net profit. Delivered jobs are kept in the Profit tab with totals and a per-method comparison.',
    ],
    tips: [
      'Refining Construction Rubble, Pieces or Salvage produces **Construction Materials** — the delivery window shows this and saves it under the refined name.',
      'Quality and expected yield are optional when starting a job, but entering them pre-fills a suggested box breakdown when you collect.',
      'The profit figures use today\'s best sell price of the refined material, less the **refinery fee** (the TOTAL COST on the terminal — Capture reads it, or type it into the job). With no fee entered the card shows the value "before the refinery fee"; after two delivered jobs with a known fee for a method, the fee is estimated from them and marked "est.".',
    ],
  },
  {
    id: 'prices', icon: '📈', title: 'Prices',
    intro: ['Live buy and sell prices from UEX Corp, browsable by commodity or by station.'],
    shots: ['prices-commodity', 'prices-station'],
    howto: [
      '**Where does this sell best?** Commodity → search or filter → click the commodity.',
      '**What does this station trade?** Station → choose the station from the dropdown.',
      '**Buy here:** Buy opens Add Inventory pre-filled and marks the cargo as in transit.',
      '**Sell here:** Sell finds your in-transit stock of that commodity, shows the payout, and removes it from inventory when you confirm.',
    ],
    tips: [
      'A greyed-out Buy or Sell means that station does not trade that commodity in that direction.',
      'The numbers next to each commodity in the list are the best sell price and the margin over the cheapest buy price.',
    ],
  },
  {
    id: 'blueprints', icon: '📐', title: 'Hangar — Blueprints',
    intro: [
      'Browse every craftable item, mark the ones you own, see what you can make right now, and plan the quality of each material.',
    ],
    shots: ['hangar-blueprints', 'hangar-blueprint-detail'],
    howto: [
      '**See what you can craft now:** set the filter to Craftable now. Green ingredient chips are covered, amber ones are partly covered.',
      '**Plan a craft:** click a blueprint to open its window. Set Global Quality, or fine-tune each part, and read the resulting stats.',
      '**Craft from your own boxes:** under each part, pick the inventory box to use. Its quality is used and its SCU is deducted when you craft.',
      '**Add the result to Assets:** ＋ Craft & add to assets records the crafted item with the qualities you chose.',
    ],
    tips: [
      'Quality runs 0–999. A box\'s quality in Inventory uses the same scale.',
      'Only some stats have a verifiable base value (weapon damage multiplier, armor temperature). Everything else shows the percentage change, not an invented absolute number.',
      'Mission lists show mission names and drop chance; the data source has no mission locations.',
    ],
  },
  {
    id: 'inventory', icon: '📦', title: 'Hangar — Inventory',
    intro: ['Track ore and materials box by box, grouped by ore or by location.'],
    shots: ['hangar-inventory'],
    howto: [
      '**Add stock:** + Add → pick the material, quality, one or more box sizes, and where it is. The last location you used is remembered, so adding several boxes to the same place is quick.',
      '**Move or sell several boxes:** tick their checkboxes, then use the bar that appears to move them, mark them in transit, or sell them.',
      '**Edit one box in a stack:** Split pulls a number of identical boxes out of the ×N row so they can be edited individually; ↩ Merge folds them back.',
    ],
    tips: [
      'A box\'s size is fixed once created. The percentage is read-only — change the amount left with the Remainder (SCU) field.',
      'The yield dropdown previews what your stock is worth after a refinery yield penalty without changing anything.',
    ],
  },
  {
    id: 'assets', icon: '🧰', title: 'Hangar — Assets',
    intro: [
      'Everything you own or crafted: ship parts, armor, weapons, gear. Every ship you add also brings its stock components here.',
    ],
    shots: ['hangar-assets'],
    howto: [
      '**Add something:** + Add → choose a type, location and notes.',
      '**Edit it later:** the ✎ button on any asset.',
      '**See what is fitted where:** the Attached to ships group lists each part with its ship and slot; click that line to open the ship.',
    ],
    tips: [
      'Fitting and swapping parts is done from the ship\'s window (Ships), not here.',
    ],
  },
  {
    id: 'ships', icon: '🛸', title: 'Hangar — Ships',
    intro: [
      'Your owned ships, their components, liveries, and a built-in Erkul DPS calculator.',
    ],
    shots: ['hangar-ships', 'hangar-ship-modal', 'hangar-livery', 'hangar-erkul'],
    howto: [
      '**Add a ship:** + Add → search UEX\'s list → pick it → choose a location → Save Ship. Its stock components appear in Assets.',
      '**Swap a part:** click the ship, then use the dropdown under a slot. Matching assets are listed first; choose Stock to put the original back.',
      '**Change livery:** in the ship window click Change ▼ under Livery, preview, and click Use.',
      '**Run a loadout through Erkul:** Ships → Erkul DPS Calculator (the window widens while it is open).',
    ],
    tips: [
      'An asset can only be fitted to one slot at a time. Fitting a crafted part moves the stock part back into Assets, free to use elsewhere.',
      '**↻ Refresh stock data** (bottom of the ship window) re-downloads the loadout and restores any stock part you deleted.',
      'Slot size is checked: a part of the wrong size is flagged in red but not blocked.',
      'Erkul is a separate website with its own data; the app cannot read your loadout back out of it.',
    ],
  },
  {
    id: 'settings', icon: '⚙', title: 'Settings & your data',
    intro: ['Everything is saved on this PC. Back it up from Settings if you reinstall or change machines.'],
    shots: ['settings-top', 'settings-bottom'],
    tips: [
      '**Backup & Restore:** Export saves jobs, inventory, assets, ships, blueprint ownership and settings to one file; Import loads it back (overwriting what is there).',
      '**Price Data Source:** UEX Corp (default) or SC Trade Tools, a community-reported feed. SC Trade Tools covers fewer stations and refreshes about hourly, so a quiet station can show no prices; the logo at the top right of the Prices tab shows which source you are on (click it to open that site).',
      '**Game Log Path:** points the app at Star Citizen\'s Game.log so it can notice where you are. It is found automatically in the default install location.',
      '**Report a Bug:** sends your text, the app version and your OS to the developer. You can also attach a screenshot of the screen you were on, the last refinery capture, a fresh grab of the game window, or your own images — each one is previewed first, and nothing is attached unless you tick or add it.',
    ],
  },
  {
    id: 'faq', icon: '❔', title: 'Troubleshooting',
    intro: [],
    faq: [
      ['Prices or ship data will not load', 'Check your internet connection, then reopen the tab. The app keeps the last prices it fetched, so it still opens offline.'],
      ['The overlay is not visible over the game', 'Run Star Citizen in borderless / windowed mode — exclusive fullscreen can cover any overlay. Press Insert to confirm it has not been hidden.'],
      ['Capture filled in nothing', 'Make sure the refinery job screen is fully visible and not covered by another window, then try again. Capture is experimental; you can always type the job in manually.'],
      ['A part will not fit a slot', 'The slot shows the size it accepts. Make the asset\'s size match, or choose a part of the right size.'],
      ['A stock part is missing from Assets', 'Open the ship and click ↻ Refresh stock data — it restores any stock parts that were deleted.'],
      ['Where is my data stored?', 'Locally, in the app\'s own data folder. Use Settings → Export to keep a copy.'],
    ],
  },
];

const HELP_SHOTS = {
  'overview': {
    file: 'overview.webp', title: 'The main window', viewport: { w: 440, h: 620 },
    setup: "switchTab('mining'); switchMiningView('locations', document.querySelector('#mining-chips .chip'));",
    points: [
      { sel: '#titlebar', text: '**Title bar.** Drag it to move the window. ─ minimizes; ✕ hides the overlay to the tray.' },
      { sel: '#tabs', text: '**Main tabs:** Mining, Refinery, Prices and Hangar. Each one has its own sub-views.' },
      { sel: '#mining-chips', text: '**Sub-view chips.** Every tab has a row like this to switch between its views.' },
      { sel: '#mining-view-locations .search-bar', text: '**Search box.** Most lists have one — it filters as you type.' },
      { sel: '.mining-row', text: '**A list row.** Rows are clickable; here, clicking an ore selects it.' },
      { sel: '#api-status', text: '**Price feed status.** Green means live UEX Corp data.' },
      { sel: '#active-jobs-label', text: '**Active refinery jobs** currently running.' },
      { sel: '#lock-btn', text: '**Lock window size** so it cannot be resized by accident.' },
      { sel: '#help-btn', text: '**User guide** — this document.' },
      { sel: '#settings-btn', text: '**Settings:** language, hotkey, backup and more.' },
    ],
  },

  'mining-locations': {
    file: 'mining-locations.webp', title: 'Ore Locations', viewport: { w: 440, h: 620 },
    setup: "switchTab('mining'); switchMiningView('locations', document.querySelector('#mining-chips .chip')); const i = document.getElementById('mining-search'); i.value = 'Quantainium'; i.dispatchEvent(new Event('input'));",
    points: [
      { sel: '#mining-view-locations .search-bar', text: 'Search by ore **or** by place — type "Daymar" to see everything found there.' },
      { sel: '.mining-ore', text: 'The ore. Click the row to select it; selected ores filter the Scanner Reference.' },
      { sel: '.mining-loc', text: 'A place it can be mined. The percentage is the share of rocks there; the number under it is the radar signature range.' },
    ],
  },

  'mining-scanner-ref': {
    file: 'mining-scanner-ref.webp', title: 'Scanner — Reference', viewport: { w: 440, h: 620 },
    setup: "switchTab('mining'); switchMiningView('scanner', [...document.querySelectorAll('#mining-chips .chip')].find(c => /Scanner/.test(c.textContent))); setScannerMode('ref', document.querySelector('#scanner-mode-chips .chip'));",
    points: [
      { sel: '#scanner-mode-chips', text: '**Reference** (the table below) or **Scan** (type a number). Reference is the default.' },
      { sel: '#scanner-tier-chips', text: '**Rarity filter** — show only Legendary, Epic, Rare, Uncommon or Common signatures.' },
      { sel: '#scanner-loc-select', text: '**Location filter** — only ores that can be found at the place you choose.' },
      { sel: '#scanner-results table', text: '**The table.** Base is one rock; ×2 … ×6 are the readings you will see when that many rocks sit in one cluster.' },
    ],
  },

  'mining-scanner-scan': {
    file: 'mining-scanner-scan.webp', title: 'Scanner — Scan', viewport: { w: 440, h: 620 },
    setup: "switchTab('mining'); switchMiningView('scanner', [...document.querySelectorAll('#mining-chips .chip')].find(c => /Scanner/.test(c.textContent))); setScannerMode('scan', [...document.querySelectorAll('#scanner-mode-chips .chip')][1]); const i = document.getElementById('scanner-input'); i.value = '6340'; i.dispatchEvent(new Event('input'));",
    after: "setScannerMode('ref', document.querySelector('#scanner-mode-chips .chip'));",
    points: [
      { sel: '#scanner-mode-chips', text: 'Switch to **Scan** mode.' },
      { sel: '#scanner-input', text: '**Type the RS signature** your scanner shows for a rock or cluster.' },
      { sel: '#scanner-results > *', text: '**Matches,** best first. It tells you the ore and how many rocks make up that number.' },
    ],
  },

  'mining-halo': {
    file: 'mining-halo.webp', title: 'Aaron Halo', viewport: { w: 440, h: 700 },
    setup: "switchTab('mining'); switchMiningView('halo', [...document.querySelectorAll('#mining-chips .chip')].find(c => /Halo/.test(c.textContent))); applyHaloPreset('cru-l1','arc-l3',5);",
    points: [
      { sel: '#mining-view-halo .btn-sm', text: '**Route presets** — click one to fill in From, To and Band.' },
      { sel: '#halo-from', text: '**From** — the Lagrange station you quantum travel from.' },
      { sel: '#halo-to', text: '**To** — where you are heading.' },
      { sel: '#halo-band', text: '**Band** (1–10) — which belt band to drop into. Higher bands are denser.' },
      { sel: '#halo-result', text: '**Result:** the HUD numbers to watch, where to cut your drive, the band\'s density, and its best ores.' },
    ],
  },

  'refinery-jobs': {
    file: 'refinery-jobs.webp', title: 'Active jobs', viewport: { w: 440, h: 700 },
    setup: "switchTab('refinery'); switchRefineryView('jobs');",
    points: [
      { sel: '#refinery-chips', text: '**Active Jobs**, **Station Bonuses** or **Profit**.' },
      { sel: '#panel-refinery .panel-header button', contains: 'Add Refinery Job', text: '**+ Add Refinery Job** — start tracking a new job.' },
      { sel: '#capture-job-btn', text: '**📷 Capture** (experimental) — reads the in-game job screen and pre-fills the form.' },
      { sel: '#jobs-list .card:not(.ready)', text: '**A running job.** Ore, location, method, a progress bar and the time left.' },
      { sel: '#jobs-list .card:not(.ready) .job-edit', text: '**✎ Edit** the job; **✕** next to it removes it.' },
      { sel: '#jobs-list .card.ready .deliver-btn', text: '**Delivered** — appears when the timer is done. Click it to record what you collected.' },
    ],
  },

  'refinery-add': {
    file: 'refinery-add.webp', title: 'Adding a job', viewport: { w: 440, h: 760 },
    setup: "openAddJob(); resetOreRows(['Quantainium','Gold'], ['850','700'], ['120','80']); document.getElementById('job-method').selectedIndex = 3; document.getElementById('job-h').value = '2'; document.getElementById('job-m').value = '30'; document.getElementById('job-location').selectedIndex = 4;",
    after: "closeModal();",
    points: [
      { sel: '#ore-rows', text: '**Ore / materials.** Type or pick each one, with its quality (0–100) and expected yield in cSCU. Add more rows with **+ Add Ore**.' },
      { sel: '#job-method', text: '**Refinery method** used for the job.' },
      { sel: '#job-h', text: '**Duration** — copy the time shown on the in-game terminal.' },
      { sel: '#job-cost', text: '**Refinery fee** (optional) — the TOTAL COST shown on the terminal. Capture fills it in; it is what the profit estimate subtracts.' },
      { sel: '#job-location', text: '**Station** where the job is running.' },
      { sel: '#modal-submit', text: '**Start Timer** — creates the job and begins the countdown.' },
    ],
  },

  'refinery-import': {
    file: 'refinery-import.webp', title: 'Importing running jobs', viewport: { w: 440, h: 800 },
    setup: "switchTab('refinery'); openImportJobs({ location: 'Orbituary', workOrders: [ { index: 1, remainingSeconds: 66900, progress: 0.844, rows: [ { name: 'Iron', quality: 325, yield: 355, clean: true }, { name: 'Iron', quality: 907, yield: 63, clean: false }, { name: 'Titanium', quality: 516, yield: 5, clean: true }, { name: 'Aslarite', quality: 287, yield: 64, clean: true } ] }, { index: 2, remainingSeconds: 78060, progress: 0.039, rows: [ { name: 'Construction Materials', quality: null, yield: 15240, clean: true } ] } ] }); await new Promise(r => setTimeout(r, 300));",
    after: "closeImportJobs();",
    points: [
      { sel: '#import-jobs-location', text: '**Station** the jobs are running at — filled in from the terminal when it is read.' },
      { sel: '#import-jobs-list > div:first-child', text: '**One card per running work order.** Tick the ones to bring in; jobs the app already tracks show "Already in your jobs" and start unticked.' },
      { sel: '.import-rem-h', text: '**Time left** — read from the terminal; correct it if it looks wrong.' },
      { sel: '.import-q', nth: 1, text: '**Quality and yield** per material. A number the reader was not sure of is highlighted — check it against the terminal.' },
      { sel: '#import-jobs-btn', text: '**Import** adds the ticked work orders as running jobs, with the progress they have already made.' },
    ],
  },

  'refinery-deliver': {
    file: 'refinery-deliver.webp', title: 'Collecting a finished job', viewport: { w: 440, h: 700 },
    setup: "const j = jobs.find(x => (Date.now() - x.startTime) / 1000 >= x.durationSeconds); deliverJob(j.id);",
    after: "closeDeliverModal();",
    points: [
      { sel: '#deliver-ore-list .deliver-ore-row', text: '**One block per ore.** Construction salvage shows the refined name it becomes.' },
      { sel: '.deliver-quality', text: '**Quality** of what came out — pre-filled from the job.' },
      { sel: '.deliver-box-rows', text: '**Boxes.** Enter how many boxes of each size you pulled. If you entered an expected yield it is already split into boxes.' },
      { sel: '#deliver-modal-overlay .modal-actions .btn', text: '**Add to Inventory** — saves the boxes (marked in transit, at the job\'s location) and removes the job.' },
    ],
  },

  'refinery-bonuses': {
    file: 'refinery-bonuses.webp', title: 'Station Bonuses', viewport: { w: 440, h: 620 },
    setup: "switchTab('refinery'); switchRefineryView('bonuses'); const s = document.getElementById('station-select'); s.selectedIndex = 1; renderBonuses();",
    after: "switchRefineryView('jobs');",
    points: [
      { sel: '#station-select', text: '**Choose a station.**' },
      { sel: '#bonuses-list > *', text: '**Each material** with that station\'s yield bonus or penalty, best first. Use it to decide where to refine a given ore.' },
    ],
  },

  'refinery-profit': {
    file: 'refinery-profit.webp', title: 'Profit', viewport: { w: 440, h: 800 },
    setup: "switchTab('refinery'); switchRefineryView('profit'); await new Promise(r => setTimeout(r, 2500)); renderProfit();",
    after: "switchRefineryView('jobs');",
    wait: 1500,
    points: [
      { sel: '#refinery-chips .chip:nth-child(3)', text: '**Profit** — estimates for your jobs.' },
      { sel: '#profit-body > div:first-child', text: '**Totals** for delivered jobs: how many, net profit after fees, aUEC per refinery hour, and the best method so far.' },
      { sel: '[data-profit="live"]', at: 'tr', text: '**In progress or waiting** — what your running jobs are worth right now.' },
      { sel: '[data-profit="methods"]', at: 'tr', text: '**By refining method** — average net per job and per hour, to see which method pays best for you.' },
      { sel: '[data-profit="history"]', at: 'tr', text: '**History** — each delivered job with its sold value and fee. Estimates are recorded at the moment you deliver.' },
    ],
  },

  'prices-commodity': {
    file: 'prices-commodity.webp', title: 'Commodity prices', viewport: { w: 440, h: 860 },
    setup: "switchTab('prices'); switchPricesView('commodity', document.querySelector('#prices-view-chips .chip')); const c = commodities.find(x => x.name === 'Agricultural Supplies') || commodities[0]; const row = document.querySelector('.commodity-item[data-com-id=\"' + c.id + '\"]'); selectCom(c, row); row.scrollIntoView({ block: 'center' });",
    wait: 3000,
    points: [
      { sel: '#prices-view-chips', text: '**Commodity** or **Station** view.' },
      { sel: '#com-search-bar', text: '**Search** by name or code.' },
      { sel: '#price-chips', text: '**Filters:** All, Minerals, Raw Ore, Refined, or only what you hold in inventory.' },
      { sel: '.commodity-item.selected', text: '**A commodity.** The numbers on the right are its best sell price and its margin over the cheapest buy price.' },
      { sel: '#prices-best-buy', text: '**Cheapest place to buy** it.' },
      { sel: '#prices-list', text: '**Top places that pay the most** for it. Click a row to see everything that terminal trades.' },
    ],
  },

  'prices-station': {
    file: 'prices-station.webp', title: 'Station prices — Buy and Sell', viewport: { w: 440, h: 700 },
    setup: "switchTab('prices'); switchPricesView('station', [...document.querySelectorAll('#prices-view-chips .chip')][1]); const s = document.getElementById('prices-station-select'); for (let i = 0; i < 60 && s.options.length < 5; i++) await new Promise(r => setTimeout(r, 500)); const o = [...s.options].findIndex(x => /(Lorville|Area 18|New Babbage).*TDD/i.test(x.text)); s.selectedIndex = o > 0 ? o : Math.min(4, s.options.length - 1); s.dispatchEvent(new Event('change'));",
    after: "switchPricesView('commodity', document.querySelector('#prices-view-chips .chip'));",
    wait: 3500,
    points: [
      { sel: '#prices-station-select', text: '**Pick a station** (or terminal) to list everything it trades.' },
      { sel: '.station-row-actions button:not([disabled])', nth: 0, text: '**Buy** opens Add Inventory pre-filled and marks it in transit. **Sell** (shown) sells your in-transit stock of that commodity here.' },
      { sel: '.station-row-actions button[disabled]', nth: 2, text: 'A **greyed-out** button means the station does not trade it in that direction.' },
    ],
  },

  'hangar-blueprints': {
    file: 'hangar-blueprints.webp', title: 'Blueprints', viewport: { w: 440, h: 760 },
    setup: "switchTab('crafting'); switchCraftingView('owned', document.querySelector('#crafting-chips .chip')); document.getElementById('owned-filter').value='all'; document.getElementById('owned-search').value='cannon'; renderOwned();",
    after: "document.getElementById('owned-search').value=''; renderOwned();",
    points: [
      { sel: '#crafting-chips', text: '**Hangar views:** My Blueprints, Inventory, Assets and Ships.' },
      { sel: '#owned-search', text: '**Search** by name or category.' },
      { sel: '#owned-filter', text: '**Filter:** All, Owned, Missing, or **Craftable now** (with a live count).' },
      { sel: '#owned-size-filter', text: '**Size filter** for ship components (S0–S6).' },
      { sel: '#owned-sort', text: '**Sort** by name, craft time or size.' },
      { sel: '.craft-card.craftable', text: '**Green outline = you can craft it right now** from your inventory.' },
      { sel: '.craft-card .craft-ing.stocked', text: '**Green chip:** you have enough of that material in your inventory (at or above the minimum quality).' },
      { sel: '.craft-card .craft-ing.partial', text: '**Amber chip:** you have some, but not enough — it shows how much you hold. A plain chip means none.' },
      { sel: '.craft-card .craft-owned-btn', text: '**+ Own / ✓ Owned** — track which blueprints you have. Click the card itself for details.' },
    ],
  },

  'hangar-blueprint-detail': {
    file: 'hangar-blueprint-detail.webp', title: 'Blueprint details', viewport: { w: 440, h: 1500 },
    setup: "switchTab('crafting'); switchCraftingView('owned', document.querySelector('#crafting-chips .chip')); document.getElementById('owned-search').value = ''; document.getElementById('owned-filter').value = 'all'; renderOwned(); const bp = allBlueprints.find(b => b.name === '10-Series Greatsword Cannon'); openBpDetails(bp.blueprint_id); updateBpGlobalQuality(bp.blueprint_id, 650); setBpSource(bp.blueprint_id, 0, 0, String(craftInventory.findIndex(b => b.name === 'Iron')));",
    after: "closeBpDetailsModal();",
    wait: 900,
    points: [
      { sel: '#bp-global-quality', text: '**Global Quality** (0–999) sets every material at once. Parts with a box chosen keep that box\'s own quality.' },
      { sel: '#bp-src-0 select', text: '**Take it from a box:** choose which inventory box supplies this part. Its quality is used and the SCU is deducted when you craft.' },
      { sel: '#bp-mod-0-0', at: 'tr', text: '**Effect line:** the stat this material changes and by how much at its current quality.' },
      { sel: '#bp-qual-slider-1', text: '**Per-part quality** — drag to fine-tune a material that has no box chosen.' },
      { sel: '#bp-stat-table', text: '**Stat table:** base value and the crafted result. Stats with no known base show the percentage change.' },
      { sel: '#bp-shopping', text: '**Shopping list:** what you are short of, where to mine it, and the cheapest shop price.' },
      { sel: '#bp-add-asset-btn', text: '**Craft & add to assets** — records the item and uses up the chosen boxes.' },
    ],
  },

  'hangar-inventory': {
    file: 'hangar-inventory.webp', title: 'Inventory', viewport: { w: 440, h: 760 },
    setup: "switchTab('crafting'); switchCraftingView('inventory', [...document.querySelectorAll('#crafting-chips .chip')].find(c => c.getAttribute('onclick').includes('inventory'))); const h = document.querySelector('.inv-ore-hdr'); if (h) h.click();",
    points: [
      { sel: '#inv-search', text: '**Search** by ore or location.' },
      { sel: '#crafting-view-inventory .btn-sm', contains: 'Add', text: '**+ Add** — add boxes of a material.' },
      { sel: '#inv-view-toggle', text: '**Group by ore or by location.**' },
      { sel: '#inv-sort', text: '**Sort order.**' },
      { sel: '#inv-yield', text: '**Yield preview** — what the stock is worth after a refinery yield penalty. Does not change your data.' },
      { sel: '.inv-ore-hdr', text: '**A group.** Click to expand; the totals and value are on the right.' },
      { sel: '#inv-total', text: '**Totals:** SCU held and its estimated value at the best known sell prices.' },
    ],
  },

  'hangar-assets': {
    file: 'hangar-assets.webp', title: 'Assets', viewport: { w: 440, h: 760 },
    setup: "switchTab('crafting'); switchCraftingView('assets', [...document.querySelectorAll('#crafting-chips .chip')].find(c => c.getAttribute('onclick').includes('assets')));",
    points: [
      { sel: '#assets-search', text: '**Search** by name, type, ship or slot.' },
      { sel: '#assets-source', text: '**Filter:** all, only yours and crafted, or only stock parts.' },
      { sel: '#crafting-view-assets .btn-sm', contains: 'Add', text: '**+ Add** — record a part, gear or vehicle.' },
      { sel: '#assets-list > div:not(.card)', nth: 0, text: '**Not attached** — assets that are not fitted to any ship.' },
      { sel: '#assets-list a[onclick*="openShipModal"]', text: '**Attached to…** — which ship and slot a part is fitted to. Click it to open that ship.' },
      { sel: '#assets-list .job-edit', nth: 0, text: '**✎ Edit** an asset\'s name, type, size, location or notes.' },
    ],
  },

  'hangar-ships': {
    file: 'hangar-ships.webp', title: 'My Ships', viewport: { w: 440, h: 700 },
    setup: "switchTab('crafting'); switchCraftingView('ships', [...document.querySelectorAll('#crafting-chips .chip')].find(c => c.getAttribute('onclick').includes('ships'))); switchShipsSub('list');",
    points: [
      { sel: '#ships-sub-list', text: '**My Ships** (this page) and the **Erkul DPS Calculator**.' },
      { sel: '#ships-search', text: '**Search** your ships.' },
      { sel: '#crafting-view-ships .btn-sm', contains: 'Add', text: '**+ Add** — pick a ship from the UEX list.' },
      { sel: '#ships-list .card', nth: 0, text: '**A ship.** Click anywhere on the card to open its components. It shows maker, cargo, crew, location and any livery or custom parts.' },
    ],
  },

  'hangar-ship-modal': {
    file: 'hangar-ship-modal.webp', title: 'A ship\'s components', viewport: { w: 440, h: 1100 },
    setup: "openShipModal(craftShips[0].uid);",
    after: "closeShipModal();",
    wait: 1500,
    points: [
      { sel: '#ship-edit-location-select', text: '**Location** — where the ship is kept. Saved as soon as you change it.' },
      { sel: '#ship-edit-notes', text: '**Notes** — saved when you leave the field.' },
      { sel: '#ship-modal-body > div:nth-child(2)', text: '**Livery** — the paint the ship wears. Change ▼ opens the list.' },
      { sel: '#ship-modal-body select', nth: 0, text: '**Slot dropdown:** Stock (the original part), then matching assets, then other assets. Pick one to fit it.' },
    ],
  },

  'hangar-livery': {
    file: 'hangar-livery.webp', title: 'Choosing a livery', viewport: { w: 440, h: 900 },
    setup: "openShipModal(craftShips[0].uid); await new Promise(r => setTimeout(r, 1500)); await toggleLiveryPanel(); await new Promise(r => setTimeout(r, 1500)); const l = (liveryCache[craftShips[0].paintTag] || [])[0]; if (l) previewLivery(l.uuid);",
    after: "closeShipModal();",
    wait: 2500,
    points: [
      { sel: '#livery-search', text: '**Search** the liveries that fit this ship.' },
      { sel: '#ship-livery-results button', contains: 'Hide', text: '**Preview / Hide** shows or closes the picture and description of the paint.' },
      { sel: '#ship-livery-results button', contains: 'Use', text: '**Use** records it as the livery the ship wears. **Stock livery** clears it.' },
    ],
  },

  'hangar-erkul': {
    file: 'hangar-erkul.webp', title: 'Erkul DPS Calculator', viewport: { w: 1040, h: 700 },
    setup: "switchTab('crafting'); switchCraftingView('ships', [...document.querySelectorAll('#crafting-chips .chip')].find(c => c.getAttribute('onclick').includes('ships'))); switchShipsSub('erkul');",
    after: "switchShipsSub('list');",
    wait: 9000,
    points: [
      { sel: '#ships-sub-erkul', text: 'The **Erkul DPS Calculator** sub-tab. The overlay widens while it is open.' },
      { sel: '#ships-pane-erkul > div:first-child', text: '**Navigation:** back, forward, reload, and **Browser ↗** to open the page in your web browser.' },
      { sel: '#erkul-host', text: '**Erkul itself** — a separate site with its own data, running inside the app.' },
    ],
  },

  'settings-top': {
    file: 'settings-top.webp', title: 'Settings (1 of 2)', viewport: { w: 440, h: 700 },
    setup: "await new Promise(r => switchTab('settings', r)); const s = document.querySelector('#panel-settings .scroll-area') || document.getElementById('panel-settings'); s.scrollTop = 0;",
    points: [
      { sel: '#language-select', text: '**Language** — English, Deutsch, Français, Español.' },
      { sel: '#opacity-range', text: '**Window Opacity** — how see-through the overlay is.' },
      { sel: '#shortcut-select', text: '**Show / Hide key** — works even while the game has focus.' },
      { sel: '#close-behavior-select', text: '**Close Button** — hide to tray, or quit.' },
      { sel: '#hover-hints-select', text: '**Hover Hints** — the descriptions you see when you hover over things.' },
      { sel: '#refinery-capture-select', text: '**Refinery Job Capture** — shows or hides the 📷 Capture button.' },
    ],
  },

  'settings-bottom': {
    file: 'settings-bottom.webp', title: 'Settings (2 of 2)', viewport: { w: 440, h: 700 },
    setup: "await new Promise(r => switchTab('settings', r)); const s = document.querySelector('#panel-settings .scroll-area') || document.getElementById('panel-settings'); s.scrollTop = s.scrollHeight;",
    points: [
      { sel: '#log-path-input', text: '**Game.log path** — found automatically; set it only if the game is installed somewhere unusual.' },
      { sel: '#panel-settings button', contains: 'Export', text: '**Export** saves everything to a backup file.' },
      { sel: '#panel-settings button', contains: 'Import', text: '**Import** restores from a backup file (overwrites current data).' },
      { sel: '#bug-report-input', text: '**Report a bug** — describe the problem, add screenshots if they help, and press Send.' },
      { sel: '#settings-version', text: 'The installed **version**.' },
    ],
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { HELP_SECTIONS, HELP_SHOTS };
