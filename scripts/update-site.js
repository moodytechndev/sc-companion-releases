// Release step: writes the version in package.json (and the built installer's size) into the website's
// SC-Tools page, so the saved page and its search-engine data match the release.
// The page also looks up the latest release itself when opened; this keeps the static copy honest.
//
//   npm run site            edits ..\MoodyPirate\Website\SC-Tools\index.html (or $SITE_DIR)
//   SITE_DIR=<folder> npm run site
//
// It only edits the file. Commit and push the site yourself.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const siteDir = process.env.SITE_DIR || path.resolve(root, '..', 'MoodyPirate', 'Website');
const page = path.join(siteDir, 'SC-Tools', 'index.html');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const exe = path.join(root, 'dist', `SC-Companion-Setup-${version}.exe`);

if (!fs.existsSync(page)) { console.error('Site page not found:', page); process.exit(1); }
const size = fs.existsSync(exe) ? `~${Math.round(fs.statSync(exe).size / 1048576)} MB` : null;
if (!size) console.log(`No ${path.basename(exe)} in dist, so the size is left as it is.`);

let html = fs.readFileSync(page, 'utf8');
const before = html;
const fields = [
  ['version badge', /(id="dl-badge">)v[0-9.]+(<)/, `$1v${version}$2`],
  ['version', /(id="dl-version">)[0-9.]+(<)/, `$1${version}$2`],
  ['download link', /(id="dl-btn" href="https:\/\/github\.com\/moodytechndev\/sc-companion-releases\/releases\/download\/)v[0-9.]+\/SC-Companion-Setup-[0-9.]+\.exe(")/, `$1v${version}/SC-Companion-Setup-${version}.exe$2`],
  ['structured data version', /("softwareVersion": ")[0-9.]+(")/, `$1${version}$2`],
];
if (size) fields.push(['size', /(id="dl-size">)~[0-9]+ MB(<)/, `$1${size}$2`]);

let missing = 0;
for (const [label, re, to] of fields) {
  if (!re.test(html)) { console.error(`Could not find the ${label} in the page. Has its markup changed?`); missing++; continue; }
  html = html.replace(re, to);
}
if (missing) process.exit(1);
if (html === before) { console.log(`The site already shows ${version}${size ? ', ' + size : ''}. Nothing to change.`); process.exit(0); }
fs.writeFileSync(page, html);
console.log(`Site updated to ${version}${size ? ', ' + size : ''}: ${page}`);
console.log('Commit and push it from the site folder when you are ready.');
