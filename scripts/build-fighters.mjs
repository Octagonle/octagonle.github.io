// Builds the two fighter pools and downloads headshots.
//   Hard: public/data/fighters.json  = every fighter on Wikipedia's "List of current UFC fighters"
//         (debuted fighters plus recent signings)
//   Easy: public/data/champions.json = the Hard fighters who have held a UFC title, undisputed or interim,
//         per Wikipedia's "List of UFC champions"
// Bios and transparent headshots come from ufc.com, with Wikipedia filling any gaps.
// Usage: npm run build:fighters
import { mkdir, writeFile, access, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRIES } from '../public/js/countries.js';
import { shuffledPick } from '../public/js/daily.js';

const KNOWN_COUNTRIES = new Set(Object.keys(COUNTRIES));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = path.join(ROOT, 'public', 'img', 'fighters');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const BASE = 'https://www.ufc.com';
const WIKI = 'https://en.wikipedia.org/w/index.php?action=raw&title=';
const UA = { 'User-Agent': 'OctagonleDataBuild/1.0 (fan-made UFC guessing game; data build script)' };

// Sanity floor for an update to be published (the roster is normally ~650, champions ~47).
const MIN_FIGHTERS = { hard: 450, easy: 30 };

const DIVISIONS = {
  "Women's Strawweight": 115, "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145,
  Flyweight: 125, Bantamweight: 135, Featherweight: 145, Lightweight: 155,
  Welterweight: 170, Middleweight: 185, 'Light Heavyweight': 205, Heavyweight: 265,
};

const COUNTRY_ALIASES = {
  'United States': 'USA', 'United States of America': 'USA', 'U.S.A.': 'USA', US: 'USA',
  'United Kingdom': 'England', UK: 'England', 'Republic of Korea': 'South Korea', Korea: 'South Korea',
  'Russian Federation': 'Russia', 'Czechia': 'Czech Republic', 'The Netherlands': 'Netherlands', Holland: 'Netherlands',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina', 'Türkiye': 'Turkey', 'Canary Islands': 'Spain',
};
// Fighters whose birthplace field lists only a US state / province.
const US_STATES = new Set(['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']);

// Manual fixes, keyed by ufc.com slug.
const OVERRIDES = {
  'khamzat-chimaev': { country: 'Russia' },
};

// Roster name -> ufc.com slug, where the name doesn't slugify to the right URL.
const SLUG_OVERRIDES = {
  'Abusupiyan Magomedov': 'abus-magomedov',
  'Wesley Schultz': 'wes-schultz',
  'Ben Johnston': 'benjamin-johnston',
  'Ezra Elliott': 'ezra-elliot',
};

// Wikipedia flag codes (a mix of ISO and IOC), used when ufc.com has no birthplace.
const FLAG_CODES = {
  USA: 'USA', BRA: 'Brazil', RUS: 'Russia', MEX: 'Mexico', AUS: 'Australia', CAN: 'Canada', CHN: 'China', ENG: 'England',
  FRA: 'France', POL: 'Poland', KOR: 'South Korea', JPN: 'Japan', SRB: 'Serbia', PER: 'Peru', GEO: 'Georgia',
  NZL: 'New Zealand', AZE: 'Azerbaijan', ARG: 'Argentina', KGZ: 'Kyrgyzstan', KAZ: 'Kazakhstan', VEN: 'Venezuela',
  ESP: 'Spain', ECU: 'Ecuador', UZB: 'Uzbekistan', UKR: 'Ukraine', TUR: 'Turkey', SCO: 'Scotland', NGR: 'Nigeria',
  NGA: 'Nigeria', MDA: 'Moldova', MAR: 'Morocco', ITA: 'Italy', AUT: 'Austria', ZAF: 'South Africa', RSA: 'South Africa',
  WAL: 'Wales', TJK: 'Tajikistan', POR: 'Portugal', PRT: 'Portugal', NED: 'Netherlands', NLD: 'Netherlands',
  MNG: 'Mongolia', LTU: 'Lithuania', LIT: 'Lithuania', JAM: 'Jamaica', IRE: 'Ireland', IRL: 'Ireland', IND: 'India',
  GER: 'Germany', DEU: 'Germany', CZE: 'Czech Republic', CUB: 'Cuba', CRO: 'Croatia', HRV: 'Croatia', BEL: 'Belgium',
  ARM: 'Armenia', UGA: 'Uganda', UAE: 'United Arab Emirates', ARE: 'United Arab Emirates', THA: 'Thailand',
  SWE: 'Sweden', SVK: 'Slovakia', SUI: 'Switzerland', CHE: 'Switzerland', ROU: 'Romania', PSE: 'Palestine',
  PAN: 'Panama', NOR: 'Norway', MNE: 'Montenegro', MMR: 'Myanmar', MYA: 'Myanmar', ISL: 'Iceland', IRQ: 'Iraq',
  IRN: 'Iran', INA: 'Indonesia', IDN: 'Indonesia', HUN: 'Hungary', FIN: 'Finland', DRC: 'DR Congo', COD: 'DR Congo',
  DOM: 'Dominican Republic', DNK: 'Denmark', DEN: 'Denmark', COL: 'Colombia', CMR: 'Cameroon', CHL: 'Chile',
  CHI: 'Chile', BHR: 'Bahrain', ALB: 'Albania', AGO: 'Angola', ANG: 'Angola', ABW: 'Aruba', GBR: 'England',
};

const decode = (s) => s
  .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();

async function get(url, as = 'text') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow' });
      if (res.status === 404 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text();
    } catch (err) {
      if (err.final || attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function download(url, file) {
  const dest = path.join(IMG_DIR, file);
  if (!(await access(dest).then(() => true, () => false))) await writeFile(dest, await get(url, 'buffer'));
  return `img/fighters/${file}`;
}

const slugify = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/ø/g, 'o').toLowerCase()
  .replace(/[.']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function ageOn(dob, date = new Date()) {
  const [y, m, d] = dob.split('-').map(Number);
  return date.getFullYear() - y - (date.getMonth() + 1 < m || (date.getMonth() + 1 === m && date.getDate() < d) ? 1 : 0);
}

// ---------- Wikipedia ----------

// Every fighter in the "Debuted fighters" tables of "List of current UFC fighters".
// Each row is one cell per line: flag, name, age, height, nickname, result, ref, UFC record, MMA record.
async function fetchRoster() {
  const wiki = await get(`${WIKI}List_of_current_UFC_fighters`);
  const debuted = wiki.slice(wiki.indexOf('==Debuted fighters=='), wiki.indexOf('==See also=='));
  const roster = [];
  for (const section of debuted.split(/^===/m).slice(1)) {
    // "Light heavyweights (205 lb, 93 kg)===" -> "Light Heavyweight"
    const heading = section.match(/^([^(=]+)/)[1].trim().replace(/s$/, '');
    const division = Object.keys(DIVISIONS).find((d) => d.toLowerCase() === heading.toLowerCase());
    if (!division) continue;
    for (const row of section.split(/^\|-\s*$/m)) {
      const cells = row.split('\n').filter((l) => /^\|(?![-}+])/.test(l)).map((l) => l.slice(1).trim());
      const flagAt = cells.findIndex((c) => /^\{\{(?:#invoke:flag\|icon|flagicon)\|/.test(c));
      if (flagAt < 0) continue;
      const [flagCell, nameCell, ageCell = '', heightCell = '', nickCell = ''] = cells.slice(flagAt);
      const name = parseNameCell(nameCell);
      if (!name) continue;
      const dob = ageCell.match(/(\d{4})\|(\d{1,2})\|(\d{1,2})/);
      const ht = heightCell.match(/ft=(\d)\|in=([\d.]+)/);
      const record = cells.slice(flagAt).reverse().map((c) => c.match(/(\d+)–(\d+)(?:–(\d+))?/)).find(Boolean);
      roster.push({
        ...name,
        division,
        flag: flagCell.match(/\|([A-Z]{3})/)?.[1],
        dob: dob ? `${dob[1]}-${dob[2].padStart(2, '0')}-${dob[3].padStart(2, '0')}` : null,
        height: ht ? Math.round(Number(ht[1]) * 12 + Number(ht[2])) : null,
        nickname: nickCell.match(/^''([^']+)''/)?.[1]?.trim() ?? null,
        record: record ? `${record[1]}-${record[2]}-${record[3] ?? 0}` : null,
      });
    }
  }

  // "Recent signings": fighters under contract who haven't fought yet, or are back from retirement
  // (e.g. Amanda Nunes). Rows: date, flag, name, nickname, division, status, ref, record — with gaps.
  const signings = wiki.slice(wiki.indexOf('== Recent signings =='), wiki.indexOf('==Suspended fighters=='));
  const seen = new Set(roster.map((r) => r.name));
  for (const row of signings.split(/^\|-\s*$/m)) {
    const cells = row.split('\n').filter((l) => /^\|(?![-}+])/.test(l)).map((l) => l.slice(1).trim());
    const flagAt = cells.findIndex((c) => /^\{\{(?:#invoke:flag\|icon|flagicon)\|/.test(c));
    if (flagAt < 0) continue;
    const name = parseNameCell(cells[flagAt + 1].replace(/'''''\*'''''/g, ''));
    const division = Object.keys(DIVISIONS).find((d) => cells.some((c) => c.toLowerCase() === d.toLowerCase()));
    if (!name || !division || seen.has(name.name)) continue;
    const record = cells.at(-1).match(/(\d+)–(\d+)(?:–(\d+))?/);
    roster.push({
      ...name,
      division,
      flag: cells[flagAt].match(/\|([A-Z]{3})/)?.[1],
      dob: null,
      height: null,
      nickname: cells[flagAt + 2]?.match(/^''([^']+)''/)?.[1]?.trim() ?? null,
      record: record ? `${record[1]}-${record[2]}-${record[3] ?? 0}` : null,
    });
  }
  return roster;
}

// "{{sortname|Sean|O'Malley|Sean O'Malley (fighter)}} (c)", "[[Mario Pinto|Mário Pinto]]" or "Zhu Kangjie"
// -> { name, title } where title is the Wikipedia article, if any.
function parseNameCell(cell) {
  const sort = cell.match(/\{\{sortname\|([^|}]+)\|([^|}]+)((?:\|[^}]*)?)\}\}/i);
  if (sort) {
    const name = `${sort[1].trim()} ${sort[2].trim()}`;
    const params = sort[3].split('|').slice(1).map((p) => p.trim());
    const link = params.find((p) => p && !p.includes('='));
    return { name, title: params.some((p) => /^nolink\s*=/.test(p)) ? null : link ?? name };
  }
  const link = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (link) return { name: (link[2] ?? link[1]).trim(), title: link[1].trim() };
  const plain = cell.replace(/<ref[\s\S]*$/, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\(c\)|\(ic\)/gi, '').trim();
  return plain ? { name: plain, title: null } : null;
}

// Names and article titles of everyone who has held a UFC title.
async function fetchChampionKeys() {
  const wiki = await get(`${WIKI}List_of_UFC_champions`);
  // Champion rows look like: | {{flagicon|USA}} [[Article title|Shown name]]<br>{{small|def. …}}
  // and are sometimes wrapped: | {{nowrap|{{flagicon|USA}} [[…]]}}
  const sections = wiki.slice(wiki.indexOf("==Men's championship history=="), wiki.indexOf('==Tournament winners=='));
  const keys = new Set();
  for (const m of sections.matchAll(/^\|\s*(?:\{\{nowrap\|\s*)?\{\{flagicon\|\w+[^}]*\}\}\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gm)) {
    keys.add(m[1].trim());
    keys.add(slugify(m[2] ?? m[1]));
  }
  return keys;
}

// Lead image URL for many Wikipedia articles, 50 per request. Returns Map(title -> url).
async function wikiImages(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400', titles: batch.join('|'),
    });
    const data = JSON.parse(await get(`https://en.wikipedia.org/w/api.php?${params}`));
    const pages = new Map(data.query.pages.map((p) => [p.title, p]));
    const hop = (t, list) => list?.find((x) => x.from === t)?.to ?? t;
    for (const title of batch) {
      const src = pages.get(hop(hop(title, data.query.normalized), data.query.redirects))?.thumbnail?.source;
      if (src) out.set(title, src);
    }
  }
  return out;
}

// ---------- ufc.com ----------

function bioField(html, label) {
  const re = new RegExp(`c-bio__label">${label}</div>\\s*<div class="c-bio__text">([\\s\\S]*?)</div>`);
  const m = html.match(re);
  return m ? decode(decode(m[1].replace(/<[^>]+>/g, ''))) : null; // some fields are double-encoded
}

function normalizeCountry(birthplace) {
  if (!birthplace) return null;
  let c = birthplace.split(',').pop().trim();
  if (US_STATES.has(c)) c = 'USA';
  // "Georgia" is left as the country; add an OVERRIDES entry for anyone born in the US state.
  if (c === 'Georgia') console.warn(`\n  check: "${birthplace}" treated as the country Georgia`);
  return COUNTRY_ALIASES[c] ?? c;
}

// Unknown slugs redirect to a search page (HTTP 200), so check for an actual profile.
const fetchAthletePage = (slug) => get(`${BASE}/athlete/${slug}`)
  .then((html) => (html.includes('hero-profile__name') ? { slug, html } : null), () => null);

// Find a fighter's ufc.com page. Tries likely slugs, then the athlete search, accepting a search
// result only if it clearly shares the fighter's surname. Returns { slug, html } or null.
async function findUfcPage(name) {
  const base = slugify(name);
  const tokens = base.split('-');
  const words = slugify(name.replace(/-/g, '')).split('-'); // "Abdul-Rakhman" -> "abdulrakhman"
  // Korean/Chinese names are written family-name first on Wikipedia, given-name first on ufc.com.
  const guesses = [...new Set([base, words.join('-'), [...words.slice(1), words[0]].join('-'), [...tokens.slice(1), tokens[0]].join('-')])];
  for (const slug of guesses) {
    const page = await fetchAthletePage(slug);
    if (page) return page;
  }

  // ufc.com search doesn't match accented letters, so search the plain spelling.
  const search = await get(`${BASE}/athletes/all?search=${encodeURIComponent(tokens.join(' '))}`).catch(() => '');
  const results = [...new Set([...search.matchAll(/href="\/athlete\/([^"]+)"/g)].map((m) => m[1]))];
  const nameParts = new Set([...tokens, ...words]);
  const surname = new Set([tokens.at(-1), words.at(-1)]);
  const scored = results
    .map((slug) => ({ slug, parts: slug.split('-') }))
    .map((r) => ({ ...r, score: r.parts.filter((p) => nameParts.has(p)).length, surname: r.parts.some((p) => surname.has(p)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  // Accept a clear winner sharing 2+ name parts, or the only result that shares the surname.
  const [top, next] = scored;
  const withSurname = scored.filter((r) => r.surname);
  const best = top?.score >= 2 && top.score > (next?.score ?? 0) ? top : withSurname.length === 1 ? withSurname[0] : null;
  return best ? fetchAthletePage(best.slug) : null;
}

async function fetchUfcBio(name) {
  const page = SLUG_OVERRIDES[name] ? await fetchAthletePage(SLUG_OVERRIDES[name]) : await findUfcPage(name);
  if (!page) return null;
  const { slug, html } = page;
  const og = html.match(/og:image" content="([^"]+)"/)?.[1];
  return {
    slug,
    name: decode(html.match(/<h1 class="hero-profile__name">([^<]+)/)?.[1] ?? '') || null,
    nickname: decode(html.match(/hero-profile__nickname">([^<]+)/)?.[1] ?? '').replace(/^"|"$/g, '').trim() || null,
    record: html.match(/hero-profile__division-body">([^<]+)/)?.[1]?.trim().split(' ')[0].replace(/^0-0-0$/, '') || null,
    age: Number(html.match(/field--name-age[^>]*>(\d+)</)?.[1]) || null,
    height: Math.round(Number(bioField(html, 'Height'))) || null,
    country: normalizeCountry(bioField(html, 'Place of Birth')),
    imgPath: og?.split('/images/')[1] ?? null,
  };
}

// ---------- build ----------

// Runs worker(item) over items, 6 at a time, collecting non-null results.
async function pool(items, worker) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const result = await worker(item);
        if (result) out.push(result);
        if (next % 10 === 0) process.stdout.write('.');
      } catch (err) {
        console.warn(`\n  error ${item.name}: ${err.message}`);
      }
    }
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildFighter(r, images) {
  const ufc = await fetchUfcBio(r.name) ?? {};
  const slug = ufc.slug ?? slugify(r.name);
  const age = r.dob ? ageOn(r.dob) : ufc.age;
  const height = ufc.height ?? r.height;
  const country = OVERRIDES[slug]?.country ?? ufc.country ?? FLAG_CODES[r.flag];
  const wikiImg = r.title && images.get(r.title);

  const missing = [!age && 'age', !height && 'height', !country && 'country', !ufc.imgPath && !wikiImg && 'photo'].filter(Boolean);
  if (missing.length) {
    console.warn(`\n  skip ${r.name}: missing ${missing.join(', ')}${ufc.name ? '' : ' (no ufc.com page; add to SLUG_OVERRIDES?)'}`);
    return null;
  }

  // ufc.com headshots are transparent PNGs; the Wikipedia fallback is an ordinary photo.
  // Brand-new signings sometimes have a headshot URL that ufc.com hasn't published yet (403).
  const ufcImg = ufc.imgPath
    && await download(`${BASE}/images/styles/event_results_athlete_headshot/s3/${ufc.imgPath}`, `${slug}.png`).catch(() => null);
  const img = ufcImg || (wikiImg && await download(wikiImg, `${slug}.jpg`).catch(() => null));
  if (!img) {
    console.warn(`\n  skip ${r.name}: headshot not available yet`);
    return null;
  }

  return {
    id: slug,
    name: ufc.name ?? r.name,
    nickname: OVERRIDES[slug]?.nickname ?? ufc.nickname ?? r.nickname,
    record: ufc.record ?? r.record,
    gender: r.division.startsWith("Women's") ? 'F' : 'M',
    division: r.division,
    weight: DIVISIONS[r.division],
    country,
    age,
    ...(r.dob && { dob: r.dob }),
    height,
    img,
    ...(!ufcImg && { photo: true }),
    // Used to match champions below; removed before writing.
    _keys: [r.title, slugify(r.name), slug].filter(Boolean),
  };
}

async function writePool(file, fighters) {
  const clean = fighters.map(({ _keys, ...f }) => f);
  await writeFile(path.join(DATA_DIR, file), JSON.stringify(clean, null, 1));
  console.log(`Wrote ${clean.length} fighters to public/data/${file}`);
  const unknown = [...new Set(clean.map((f) => f.country))].filter((c) => !KNOWN_COUNTRIES.has(c));
  if (unknown.length) console.warn(`  Add these to public/js/countries.js: ${unknown.join(', ')}`);
}

const readJson = (file, fallback) => readFile(path.join(DATA_DIR, file), 'utf8').then(JSON.parse, () => fallback);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Extends daily.json so every date from yesterday to SCHEDULE_DAYS ahead has a fighter, without ever
// changing a date players may already be playing. Dates a player could be on right now (yesterday to
// tomorrow, covering every time zone) keep whatever the game was already showing; later dates are
// re-picked only if that fighter has left the pool.
const SCHEDULE_DAYS = 60;
function updateSchedule(schedule, difficulty, oldIds, newIds) {
  const today = new Date().toISOString().slice(0, 10);
  const days = { ...schedule[difficulty] };
  for (const day of Object.keys(days)) if (day < addDays(today, -400)) delete days[day];
  const inPool = new Set(newIds);
  // Don't repeat a fighter until most of the pool has had a turn.
  const gap = Math.min(300, Math.floor(newIds.length * 0.8));
  for (let i = -1; i <= SCHEDULE_DAYS; i++) {
    const day = addDays(today, i);
    if (i <= 1) {
      days[day] ??= shuffledPick(oldIds.length ? oldIds : newIds, day, difficulty);
      continue;
    }
    if (days[day] && inPool.has(days[day])) continue;
    const recent = new Set(Array.from({ length: gap }, (_, k) => days[addDays(day, -1 - k)]));
    const choices = newIds.filter((id) => !recent.has(id));
    days[day] = choices[Math.floor(Math.random() * choices.length)];
  }
  schedule[difficulty] = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  await mkdir(IMG_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  console.log('Fetching current UFC roster…');
  const roster = await fetchRoster();
  console.log(`Found ${roster.length} fighters. Fetching photos and bios…`);
  const images = await wikiImages([...new Set(roster.map((r) => r.title).filter(Boolean))]);
  const fighters = await pool(roster, (r) => buildFighter(r, images));
  console.log();
  const championKeys = await fetchChampionKeys();
  const champions = fighters.filter((f) => f._keys.some((k) => championKeys.has(k)));

  // If Wikipedia or ufc.com changed their layout, publish nothing rather than a broken game.
  if (fighters.length < MIN_FIGHTERS.hard || champions.length < MIN_FIGHTERS.easy) {
    throw new Error(`Only ${fighters.length} fighters / ${champions.length} champions found ` +
      `(expected at least ${MIN_FIGHTERS.hard} / ${MIN_FIGHTERS.easy}). Keeping the existing data.`);
  }

  const ids = (list) => list.map((f) => f.id);
  const schedule = await readJson('daily.json', {});
  updateSchedule(schedule, 'hard', ids(await readJson('fighters.json', [])), ids(fighters));
  updateSchedule(schedule, 'easy', ids(await readJson('champions.json', [])), ids(champions));

  await writePool('fighters.json', fighters);
  await writePool('champions.json', champions);
  await writeFile(path.join(DATA_DIR, 'daily.json'), JSON.stringify(schedule, null, 1));
  console.log(`Daily schedule set through ${addDays(new Date().toISOString().slice(0, 10), SCHEDULE_DAYS)}`);

  // Remove headshots of fighters who have left the roster.
  const used = new Set(fighters.map((f) => path.basename(f.img)));
  const stale = (await readdir(IMG_DIR)).filter((file) => !used.has(file));
  await Promise.all(stale.map((file) => unlink(path.join(IMG_DIR, file))));
  if (stale.length) console.log(`Removed ${stale.length} unused headshots`);
}

main().catch((err) => { console.error(err); process.exit(1); });
