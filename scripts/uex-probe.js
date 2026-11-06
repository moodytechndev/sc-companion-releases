// Probes which UEX API calls work with a user's secret key, and prints only the SHAPE of each
// answer (field names and types, never values), so the output is safe to paste back.
//
// Run it yourself in a terminal; the key never goes into a file or into chat:
//   PowerShell:  $env:UEX_SECRET_KEY = '<your key from your UEX profile>'; node scripts/uex-probe.js
//   Optional:    $env:UEX_TOKEN = '<app token from uexcorp.space/api/apps>'
//   Then clear:  Remove-Item Env:UEX_SECRET_KEY
//
// It only sends GET requests (no messages, no changes) and about 8 requests in total.
const https = require('https');

const BASE = 'https://api.uexcorp.space/2.0';
const SECRET = process.env.UEX_SECRET_KEY || '';
const TOKEN = process.env.UEX_TOKEN || '';

function get(path, headers, base = BASE) {
  return new Promise((resolve) => {
    const req = https.get(base + path, { headers: { 'User-Agent': 'SC-Companion-probe/1.0', Accept: 'application/json', ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ http: res.statusCode, json, headers: res.headers });
      });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({ http: 0, json: null }); });
    req.on('error', () => resolve({ http: 0, json: null }));
  });
}

// { id: 1, name: 'x', list: [{...}] }  ->  { id: 'number', name: 'string', list: [{...}] }
function shape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : [];
  if (typeof v === 'object') {
    if (depth > 3) return 'object';
    const out = {};
    for (const k of Object.keys(v)) out[k] = shape(v[k], depth + 1);
    return out;
  }
  return typeof v;
}

async function probe(label, path, headers, base) {
  const r = await get(path, headers, base);
  const j = r.json || {};
  console.log(`\n== ${label}\n   GET ${path.replace(/(hash|id_negotiation)=[^&]+/, '$1=<hidden>')}\n   http ${r.http} | status ${j.status} | ${j.message || ''}`);
  const lim = Object.entries(r.headers || {}).filter(([k]) => /limit|remaining|retry/i.test(k));
  if (lim.length) console.log('   rate-limit headers:', lim.map(([k, v]) => `${k}=${v}`).join(', '));
  if (j.data !== undefined && j.data !== null) console.log('   data shape:', JSON.stringify(shape(j.data), null, 1).replace(/\n/g, '\n   '));
  return r;
}

(async () => {
  if (!SECRET) { console.log('Set UEX_SECRET_KEY first (see the top of this file).'); process.exit(1); }
  const bearer = TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {};

  // Safe facts about the two values (never the values): are they different, and is the length plausible?
  console.log(`secret key: ${SECRET.length} characters | app token: ${TOKEN.length} characters | the two are the same value: ${TOKEN && SECRET === TOKEN ? 'YES (one of them was pasted twice)' : 'no'}`);
  console.log(`either value has spaces, quotes or a "Bearer " prefix: ${/[\s"']|^bearer/i.test(SECRET + '|' + TOKEN) ? 'YES' : 'no'}`);

  // Does the token work at all, on either host, with and without the "Bearer " word?
  if (TOKEN) {
    for (const [name, base] of [['api.uexcorp.space', 'https://api.uexcorp.space/2.0'], ['api.uexcorp.uk', 'https://api.uexcorp.uk/2.0']]) {
      await probe(`token only, ${name}, "Bearer <token>"`, '/user_notifications', { Authorization: 'Bearer ' + TOKEN }, base);
      await probe(`token only, ${name}, raw token`, '/user_notifications', { Authorization: TOKEN }, base);
    }
  }

  // 1. which header name does the secret key go in?
  await probe('negotiations, header "secret_key"', '/marketplace_negotiations', { ...bearer, secret_key: SECRET });
  await probe('negotiations, header "secret-key"', '/marketplace_negotiations', { ...bearer, 'secret-key': SECRET });

  // 2. does it need the app token as well?
  if (TOKEN) await probe('negotiations, secret_key and NO bearer', '/marketplace_negotiations', { secret_key: SECRET });

  // 2b. the messages of your first negotiation: which parameter selects it, and what a message looks like
  const neg = await get('/marketplace_negotiations', { ...bearer, secret_key: SECRET });
  const first = neg.json && Array.isArray(neg.json.data) && neg.json.data[0];
  if (first) {
    await probe('messages, by hash', '/marketplace_negotiations_messages?hash=' + encodeURIComponent(first.hash), { ...bearer, secret_key: SECRET });
    await probe('messages, by id_negotiation', '/marketplace_negotiations_messages?id_negotiation=' + first.id, { ...bearer, secret_key: SECRET });
  } else {
    console.log('\n(no negotiation on this account, so the message calls were skipped)');
  }

  // 3. what can the key read?
  await probe('notifications', '/user_notifications', { ...bearer, secret_key: SECRET });

  // 4. your own listings, to see whether a listing carries an id the app could start a deal from
  await probe('favorites', '/marketplace_favorites', { ...bearer, secret_key: SECRET });

  // 5. public checks, no key
  await probe('public listings, sell, no key', '/marketplace_listings?operation=sell', {});
  console.log('\nDone. Paste everything above back (it contains field names only).');
})();
