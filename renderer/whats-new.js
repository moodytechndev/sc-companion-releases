// The "What's new" popup. One entry per release, newest first.
// RELEASE STEP: add an entry for the new version here, in plain words a player would use (no code names).
// The popup shows every entry newer than the version the user last opened and not newer than the one they run,
// so someone who skips a release still sees what they missed.
const WHATS_NEW = [
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
