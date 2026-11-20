// The "What's new" popup. One entry per release, newest first.
// RELEASE STEP: add an entry for the new version here, in plain words a player would use (no code names).
// The popup shows every entry newer than the version the user last opened and not newer than the one they run,
// so someone who skips a release still sees what they missed.
const WHATS_NEW = [
  { version: '2.0.2', items: [
    "New: ships in Prices > Buy have an I bought this button. It opens Add Ship with that ship already picked, so a ship you buy in the game goes into your Hangar in a few clicks. A ship you already own shows how many are in your Hangar.",
  ] },
  { version: '2.0.1', items: [
    "New: Refinery > Station Bonuses has a second dropdown. Pick an ore and every station is ranked for it, best first, so you can see where to refine it. Tap a row to open that station.",
    "Crafting now uses the game's own files, so it works offline and no longer waits on another website. Blueprints that were missing are in, and the Special tag is gone.",
    "Each blueprint now shows your real chance of getting it from each contract, for example 7.7%. Rewards from events are marked as event rewards.",
    "The blueprints every player starts with (the Behr pistol and rifle with their magazines, and the CDS light armor) are ticked as owned the first time you open Crafting. You can untick them.",
    "Updated for game patch 4.10.201.",
  ] },
  { version: '2.0.0', items: [
    "New: Launcher button (Settings > Launcher button). A small round button with the logo appears on screen while the overlay is hidden. Click it to bring the app back, drag it where you like, right-click it to hide it. A green number shows refinery jobs that are ready. It can be clicked whenever the game shows a mouse cursor, such as mobiGlas and menus.",
    "New: Prices > Buy. Type a ship or an item and see which shops sell it, where they are and what they charge (prices come from players, so check the date shown).",
    "New: Profit > Sold. When you press Sell in your inventory (or in Prices), the app asks how many boxes of each size you sold and what each sale paid, and keeps it, so you can see what you really sold. Boxes you do not sell stay in your inventory.",
    "New: when you collect a refinery job, tick Keep on an ore you are not selling. It still goes into your inventory but is left out of the profit estimate.",
  ] },
  { version: '1.6.14', items: [
    "Updated for the new game patch (4.10.200): the item list now has the new items and their new names, and Special blueprints include the new Raider Camo armor and weapons that are not on sc-craft.tools yet.",
    "Fixed: refinery capture now reads the ores the game renamed (Raw Ice, Raw Silicon, Raw Ouratite and Hephaestanite (R)) as Ice, Silicon, Ouratite and Hephaestanite.",
  ] },
  { version: '1.6.13', items: [
    "New: Settings > OBS Window Capture. If OBS shows a frozen picture of the app, set the source's Capture Method to Windows 10 (1903 and up). If you need OBS's older method, turn on Compatibility here: the window becomes solid with square corners, and the app restarts.",
  ] },
  { version: '1.6.12', items: [
    "Fixed: signing in to UEX (Settings > UEX account) failed with \"Error #1\". The sign-in window was blocking the captcha on the UEX login page, and now lets it work.",
  ] },
  { version: '1.6.11', items: [
    "New: this What's New window. It appears once after each update, and Settings > What's New shows it again any time.",
    'Fixed: Window Opacity is now remembered. It used to go back to fully solid every time the app started.',
  ] },
  { version: '1.6.10', items: [
    'Settings > Text Size: a slider makes the whole app bigger or smaller (85% to 160%). The window grows with it and the size is remembered.',
    'Refinery capture can now take the whole screen when the game window comes back black, and it tells you what to change if the screen cannot be captured at all.',
  ] },
  { version: '1.6.9', items: [
    'New Market tab (Prices > Market): browse what players sell and look for on the UEX marketplace, search, filter and sort.',
    'Watchlist: describe what you want and get a Windows notification when a matching listing appears.',
    'Message sellers and chat from inside the app, and follow your deals in My deals. This needs a verified UEX account (Settings > UEX account).',
  ] },
];
