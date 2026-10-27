import { MAX_GUESSES, emptyStats, applyResult, currentStreak, dayNumber, sanitizeStats, statKey } from './stats.js';
import { COUNTRIES } from './countries.js';

const LAUNCH_DAY = '2026-10-26'; // Daily #1
const WEIGHT_ORDER = [115, 125, 135, 145, 155, 170, 185, 205, 265];
const SHORT_DIVISION = {
  Strawweight: 'Straw', Flyweight: 'Fly', Bantamweight: 'Bantam', Featherweight: 'Feather', Lightweight: 'Light',
  Welterweight: 'Welter', Middleweight: 'Middle', 'Light Heavyweight': 'Light Heavy', Heavyweight: 'Heavy',
};
// Hard mode keeps the original (pre-Easy) storage keys so existing games carry over.
const prefix = (d) => (d === 'easy' ? 'octagonle:easy:' : 'octagonle:');
const KEYS = {
  stats: 'octagonle:stats',
  mode: 'octagonle:mode',
  difficulty: 'octagonle:difficulty',
  silhouette: 'octagonle:silhouette',
  seenHelp: 'octagonle:seenHelp',
  unlimited: (d) => `${prefix(d)}unlimited`,
  recent: (d) => `${prefix(d)}recent`,
  daily: (d, day) => `${prefix(d)}daily:${day}`,
};
const POOL_FILES = { hard: 'data/fighters.json', easy: 'data/champions.json' };
const DIFFICULTY = {
  easy: { label: 'Easy', daily: 'Daily Champion', unlimited: 'Unlimited Champions', noMatch: 'No UFC champion by that name' },
  hard: { label: 'Hard', daily: 'Daily Fighter', unlimited: 'Unlimited Fighters', noMatch: 'No active UFC fighter by that name' },
};
const ICON = {
  up: '<svg class="arrow" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg class="arrow" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
};

// localStorage can throw (private mode, blocked storage); the game still works without it.
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let pools = {};              // { easy: [...], hard: [...] }
let fighters = [];           // the active pool
let byId = new Map();
let user = null;             // { username, stats, today } when signed in
let serverAvailable = true;  // false when hosted as static files only
let difficulty = 'hard';
let mode = 'daily';
let game = null;             // { difficulty, mode, day, answer, guesses, done, won, recorded }

// ---------- dates & answer selection ----------

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Everyone gets the same fighter on the same date. Each cycle through the roster is
// a fresh shuffle, so no fighter repeats until all of them have been used.
function dailyAnswer(day, d = difficulty) {
  const ids = pools[d].map((f) => f.id).sort();
  const n = dayNumber(day);
  const rand = mulberry32(Math.floor(n / ids.length) * 7919 + (d === 'easy' ? 4242 : 1337));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return pools[d].find((f) => f.id === ids[n % ids.length]);
}

function dailyNumber(day) {
  return dayNumber(day) - dayNumber(LAUNCH_DAY) + 1;
}

function pickUnlimitedAnswer() {
  const recent = store.get(KEYS.recent(difficulty), []);
  const pool = fighters.filter((f) => !recent.includes(f.id));
  const pick = pool[Math.floor(Math.random() * pool.length)];
  store.set(KEYS.recent(difficulty), [pick.id, ...recent].slice(0, Math.min(50, fighters.length - 1)));
  return pick;
}

function useDifficulty(d) {
  difficulty = d;
  fighters = pools[d];
  byId = new Map(fighters.map((f) => [f.id, f]));
}

// Champions' ages are computed from their birth dates so they stay current.
function ageOn(dob, date = new Date()) {
  const [y, m, d] = dob.split('-').map(Number);
  return date.getFullYear() - y - (date.getMonth() + 1 < m || (date.getMonth() + 1 === m && date.getDate() < d) ? 1 : 0);
}

// ---------- game state ----------

function loadGame() {
  const day = todayStr();
  if (mode === 'daily') {
    let saved = store.get(KEYS.daily(difficulty, day));
    // A signed-in player who finished today's fighter on another device sees that result.
    const remote = user?.today?.[statKey(difficulty, 'daily')];
    if (remote && !saved?.done) saved = { guesses: remote.guesses, recorded: true };
    game = { difficulty, mode, day, answer: dailyAnswer(day), guesses: saved?.guesses ?? [], recorded: !!saved?.recorded };
  } else {
    let saved = store.get(KEYS.unlimited(difficulty));
    if (!saved || !byId.has(saved.answer)) saved = { answer: pickUnlimitedAnswer().id, guesses: [] };
    game = { difficulty, mode, day, answer: byId.get(saved.answer), guesses: saved.guesses, recorded: !!saved.recorded };
  }
  game.guesses = game.guesses.filter((id) => byId.has(id)).slice(0, MAX_GUESSES);
  updateDone();
  saveGame();
  renderAll();
}

function newUnlimitedGame() {
  store.set(KEYS.unlimited(difficulty), null);
  loadGame();
  $('#guess-input').focus();
}

function updateDone() {
  game.won = game.guesses.includes(game.answer.id);
  game.done = game.won || game.guesses.length >= MAX_GUESSES;
}

function saveGame() {
  const data = { guesses: game.guesses, done: game.done, recorded: game.recorded };
  if (game.mode === 'daily') store.set(KEYS.daily(game.difficulty, game.day), data);
  else store.set(KEYS.unlimited(game.difficulty), { ...data, answer: game.answer.id });
}

function guestStats() {
  return sanitizeStats(store.get(KEYS.stats, emptyStats()));
}

function stats() {
  return user ? user.stats : guestStats();
}

async function submitGuess(fighter) {
  if (game.done || game.guesses.includes(fighter.id)) return;
  game.guesses.push(fighter.id);
  updateDone();
  saveGame();
  closeSuggestions();
  $('#guess-input').value = '';
  renderAll(fighter.id);
  if (game.done) {
    await recordResult();
    setTimeout(showEndModal, 5 * 180 + 700); // let the tiles finish flipping
  }
}

async function recordResult() {
  if (game.recorded) return;
  game.recorded = true;
  saveGame();
  const result = { mode: statKey(game.difficulty, game.mode), won: game.won, guesses: game.guesses, day: game.day };
  if (user) {
    try {
      user = (await api('POST', '/api/result', result)).user;
    } catch (err) {
      toast(`Couldn't save to your account: ${err.message}`);
    }
  } else {
    store.set(KEYS.stats, applyResult(guestStats(), { ...result, guessCount: game.guesses.length }));
  }
}

// ---------- comparison ----------

function compareFighters(g, a) {
  const numeric = (gv, av, range) => (gv === av ? 'green' : Math.abs(gv - av) <= range ? 'yellow' : 'red');
  const arrow = (gv, av) => (av > gv ? 'up' : av < gv ? 'down' : null);
  const gw = WEIGHT_ORDER.indexOf(g.weight);
  const aw = WEIGHT_ORDER.indexOf(a.weight);
  const gc = COUNTRIES[g.country];
  const ac = COUNTRIES[a.country];
  return [
    { label: 'Gender', main: g.gender === 'M' ? 'Male' : 'Female', status: g.gender === a.gender ? 'green' : 'red' },
    {
      label: 'Weight', main: `${g.weight}`, sub: divisionLabel(g),
      status: g.division === a.division ? 'green' : Math.abs(gw - aw) <= 1 ? 'yellow' : 'red',
      arrow: arrow(g.weight, a.weight),
    },
    {
      label: 'Country', main: g.country, flag: gc?.code,
      status: g.country === a.country ? 'green' : gc && ac && gc.continent === ac.continent ? 'yellow' : 'red',
    },
    { label: 'Age', main: g.age, status: numeric(g.age, a.age, 2), arrow: arrow(g.age, a.age) },
    { label: 'Height', main: formatHeight(g.height), status: numeric(g.height, a.height, 2), arrow: arrow(g.height, a.height) },
  ];
}

function divisionLabel(f) {
  const base = f.division.replace("Women's ", '');
  return `${f.gender === 'F' ? "W. " : ''}${SHORT_DIVISION[base] ?? base}`;
}

function formatHeight(inches) {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

// ---------- rendering ----------

function headshot(f, cls = 'headshot') {
  return `<img class="${cls}" src="${esc(f.img)}" alt="${esc(f.name)}" loading="lazy" data-initials="${esc(f.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}">`;
}

// Replace broken headshots with the fighter's initials.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.initials) return;
  const ph = document.createElement('div');
  ph.className = `${img.className} ph`;
  ph.textContent = img.dataset.initials;
  img.replaceWith(ph);
}, true);

function rowHtml(f, animate) {
  const tiles = compareFighters(f, game.answer).map((t, i) => {
    const style = animate ? `animation-delay:${i * 0.18}s` : 'animation:none';
    const long = String(t.main).length > 8 ? ' long' : '';
    return `<div class="tile ${t.status}" style="${style}" title="${esc(t.label)}">
      <span class="t-label">${esc(t.label)}</span>
      ${t.flag ? `<img class="flag" src="https://flagcdn.com/w40/${t.flag}.png" alt="" loading="lazy">` : ''}
      <span class="t-main${long}">${esc(t.main)}${t.arrow ? ICON[t.arrow] : ''}</span>
      ${t.sub ? `<span class="t-sub">${esc(t.sub)}</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="row">
    <div class="fighter-cell${f.id === game.answer.id ? ' correct' : ''}">
      ${headshot(f)}
      <div style="min-width:0">
        <div class="fighter-name">${esc(f.name)}</div>
        ${f.nickname ? `<div class="fighter-nick">"${esc(f.nickname)}"</div>` : ''}
      </div>
    </div>
    ${tiles}
  </div>`;
}

function renderAll(animateId = null) {
  document.querySelectorAll('.mode-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  document.querySelectorAll('.diff-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.difficulty === difficulty);
    b.setAttribute('aria-checked', b.dataset.difficulty === difficulty);
  });

  // Newest guess on top, right under the search box.
  $('#rows').innerHTML = [...game.guesses].reverse().map((id) => rowHtml(byId.get(id), id === animateId)).join('');
  $('#board-empty').hidden = game.guesses.length > 0;

  const input = $('#guess-input');
  input.disabled = game.done;
  input.placeholder = game.done ? 'Game over' : `Guess ${game.guesses.length + 1} of ${MAX_GUESSES}`;
  $('#guess-box').hidden = game.done;

  renderMystery();

  const bar = $('#result-bar');
  bar.hidden = !game.done;
  if (game.done) {
    $('#result-text').textContent = game.won
      ? `✅ Got it in ${game.guesses.length}/${MAX_GUESSES}: ${game.answer.name}`
      : `❌ It was ${game.answer.name}`;
    $('#btn-next').hidden = game.mode !== 'unlimited';
  }
  renderAccountButton();
}

function renderMystery() {
  const silhouetteOn = store.get(KEYS.silhouette, false);
  const img = $('#mystery-img');
  const toggle = $('#silhouette-toggle');
  toggle.checked = silhouetteOn;
  toggle.disabled = game.done;

  const showImg = game.done || silhouetteOn;
  img.hidden = !showImg;
  $('#mystery-q').hidden = showImg;
  if (showImg && img.getAttribute('src') !== game.answer.img) img.src = game.answer.img;
  img.classList.toggle('silhouette', !game.done);
  img.classList.toggle('photo', !!game.answer.photo);
  img.alt = game.done ? game.answer.name : 'Mystery fighter silhouette';

  const labels = DIFFICULTY[game.difficulty];
  $('#mystery-label').textContent = game.done
    ? game.answer.name
    : game.mode === 'daily' ? `${labels.daily} #${dailyNumber(game.day)}` : labels.unlimited;
  $('#mystery-sub').textContent = game.done
    ? `${game.answer.division} · ${game.answer.country}`
    : `${MAX_GUESSES - game.guesses.length} ${MAX_GUESSES - game.guesses.length === 1 ? 'guess' : 'guesses'} left`;
}

function renderAccountButton() {
  const btn = $('#btn-account');
  const avatar = btn.querySelector('.avatar');
  btn.classList.toggle('signed-in', !!user);
  avatar.hidden = !user;
  avatar.textContent = user ? user.username[0] : '';
  btn.title = user ? `Signed in as ${user.username}` : 'Sign in';
}

// ---------- search / autocomplete ----------

let suggestionList = [];
let activeIndex = -1;

function searchFighters(query) {
  const q = normalize(query.trim());
  if (!q) return [];
  const tokens = q.split(/\s+/);
  return fighters
    .filter((f) => !game.guesses.includes(f.id))
    .map((f) => {
      const name = normalize(f.name);
      const words = name.split(/[\s-]+/);
      const nick = normalize(f.nickname ?? '');
      let score = -1;
      if (name.startsWith(q)) score = 3;
      else if (tokens.every((t) => words.some((w) => w.startsWith(t)))) score = 2;
      else if (name.includes(q)) score = 1;
      else if (nick && nick.includes(q)) score = 0;
      return { f, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name))
    .slice(0, 8)
    .map((x) => x.f);
}

function renderSuggestions() {
  const ul = $('#suggestions');
  const query = $('#guess-input').value;
  suggestionList = searchFighters(query);
  if (!query.trim()) return closeSuggestions();
  activeIndex = suggestionList.length ? 0 : -1;
  ul.innerHTML = suggestionList.length
    ? suggestionList.map((f, i) => `<li role="option" data-id="${esc(f.id)}" class="${i === activeIndex ? 'active' : ''}">
        ${headshot(f, '')}
        <div><div class="s-name">${esc(f.name)}</div><div class="s-meta">${esc(f.division)} · ${esc(f.country)}</div></div>
      </li>`).join('')
    : `<li class="s-empty">${DIFFICULTY[difficulty].noMatch}</li>`;
  ul.hidden = false;
}

function setActive(i) {
  const items = [...$('#suggestions').querySelectorAll('li[data-id]')];
  if (!items.length) return;
  activeIndex = (i + items.length) % items.length;
  items.forEach((li, idx) => li.classList.toggle('active', idx === activeIndex));
  items[activeIndex].scrollIntoView({ block: 'nearest' });
}

function closeSuggestions() {
  $('#suggestions').hidden = true;
  suggestionList = [];
  activeIndex = -1;
}

// ---------- modals ----------

let modalCleanup = null;

function openModal(html, onOpen) {
  modalCleanup?.();
  modalCleanup = null;
  $('#modal-body').innerHTML = html;
  $('#modal-backdrop').hidden = false;
  modalCleanup = onOpen?.($('#modal-body')) ?? null;
}

function closeModal() {
  modalCleanup?.();
  modalCleanup = null;
  $('#modal-backdrop').hidden = true;
}

function statGridHtml(s, m) {
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  return `<div class="stat-grid">
    <div><div class="num">${s.played}</div><div class="lbl">Played</div></div>
    <div><div class="num">${pct}</div><div class="lbl">Win %</div></div>
    <div><div class="num">${currentStreak(s, m, todayStr())}</div><div class="lbl">Current streak</div></div>
    <div><div class="num">${s.maxStreak}</div><div class="lbl">Max streak</div></div>
  </div>`;
}

function distributionHtml(s, highlight) {
  const max = Math.max(1, ...s.dist);
  return `<div class="dist">${s.dist.map((n, i) => `
    <div class="dist-row"><span>${i + 1}</span>
      <div class="dist-bar${highlight === i + 1 ? ' hl' : ''}" style="width:${Math.max(8, (n / max) * 100)}%">${n}</div>
    </div>`).join('')}</div>`;
}

function guestNoteHtml() {
  if (user) return `<p class="note">Saved to your account, <strong>${esc(user.username)}</strong>.</p>`;
  if (!serverAvailable) return '<p class="note">Stats are saved on this device.</p>';
  return '<p class="note">Playing as a guest: stats are saved on this device only. <button class="link-btn" data-open="account">Sign in</button> to keep them on your account.</p>';
}

function showStatsModal() {
  const view = { difficulty, mode };
  const seg = (name, value, label) => `<button data-${name}="${value}" class="${view[name] === value ? 'active' : ''}">${label}</button>`;
  const render = () => {
    const key = statKey(view.difficulty, view.mode);
    const s = stats()[key];
    const isCurrent = game.difficulty === view.difficulty && game.mode === view.mode;
    const last = isCurrent && game.done && game.won ? game.guesses.length : null;
    return `<h2 id="modal-title">Statistics</h2>
      <div class="seg">${seg('difficulty', 'easy', 'Easy')}${seg('difficulty', 'hard', 'Hard')}</div>
      <div class="seg">${seg('mode', 'daily', 'Daily')}${seg('mode', 'unlimited', 'Unlimited')}</div>
      ${statGridHtml(s, key)}
      <h3>Guess distribution</h3>
      ${s.wins ? distributionHtml(s, last) : '<p class="note" style="margin-top:0">No wins yet. Go get one.</p>'}
      ${guestNoteHtml()}`;
  };
  openModal(render(), (body) => {
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-difficulty], [data-mode]');
      if (!btn) return;
      Object.assign(view, btn.dataset.difficulty ? { difficulty: btn.dataset.difficulty } : { mode: btn.dataset.mode });
      body.innerHTML = render();
    });
  });
}

function showEndModal() {
  if (!game.done) return;
  const a = game.answer;
  const m = game.mode;
  const key = statKey(game.difficulty, m);
  const s = stats()[key];
  const html = `
    <div class="reveal-card">
      <div class="verdict ${game.won ? 'win' : 'loss'}">${game.won ? `Winner · ${game.guesses.length}/${MAX_GUESSES}` : 'Defeated · X/8'}</div>
      <img class="big-headshot" src="${esc(a.img)}" alt="${esc(a.name)}" data-initials="${esc(a.name[0])}">
      <div class="r-name" id="modal-title">${esc(a.name)}</div>
      ${a.nickname ? `<div class="r-nick">"${esc(a.nickname)}"</div>` : ''}
      <div class="r-meta">${[a.division, a.country, `${a.age} yrs`, formatHeight(a.height), a.record]
        .filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join(' · ')}</div>
    </div>
    ${statGridHtml(s, key)}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-action="share">${ICON.share} Share</button>
      ${m === 'unlimited' ? `<button class="btn btn-primary" data-action="next">Next fighter ${ICON.next}</button>` : ''}
    </div>
    ${m === 'daily' ? `<div class="countdown"><div class="lbl">Next fighter in</div><div class="time" id="countdown"></div></div>` : ''}
    ${guestNoteHtml()}`;
  openModal(html, (body) => {
    body.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'share') share();
      if (action === 'next') { closeModal(); newUnlimitedGame(); }
    });
    if (m !== 'daily') return null;
    const tick = () => {
      const el = body.querySelector('#countdown');
      if (el) el.textContent = timeUntilMidnight();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  });
}

function timeUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const secs = Math.max(0, Math.floor((midnight - now) / 1000));
  return [secs / 3600, (secs % 3600) / 60, secs % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
}

function showHelpModal() {
  const tile = (cls, text) => `<div class="tile ${cls}"><span class="t-main">${text}</span></div>`;
  openModal(`
    <h2 id="modal-title">How to play</h2>
    <ol class="rules">
      <li>Guess the mystery UFC fighter in <strong>${MAX_GUESSES} tries</strong>.</li>
      <li>Only current UFC fighters are included. <strong>Easy</strong>: fighters who have held a UFC title, interim titles included. <strong>Hard</strong>: every active fighter on the UFC roster.</li>
      <li>Each guess shows how that fighter compares on <strong>gender, weight class, country, age and height</strong>. For champions, weight class is a division they held a title in.</li>
      <li><strong>Daily</strong> has one fighter per day for each difficulty, the same for everyone. <strong>Unlimited</strong> lets you play as many as you want.</li>
      <li>Stuck? Turn on the <strong>silhouette hint</strong>.</li>
    </ol>
    <h3>Colors</h3>
    <div class="legend">
      <div class="legend-item">${tile('green', 'Match')} Exact match.</div>
      <div class="legend-item">${tile('yellow', 'Close')} Close: one weight class away, same continent, or within 2 years / 2 inches.</div>
      <div class="legend-item">${tile('red', 'Miss')} Not close.</div>
      <div class="legend-item">${tile('red', `30${ICON.up}`)} Arrows: the answer is older, taller or heavier (↑) or the opposite (↓).</div>
    </div>`);
}

function showAccountModal(tab = 'login') {
  if (!serverAvailable) {
    openModal(`<h2 id="modal-title">Accounts</h2><p class="note">Sign-in isn't available on this copy of the game. Your stats are still saved on this device.</p>`);
    return;
  }
  if (user) {
    openModal(`
      <h2 id="modal-title">Account</h2>
      <p style="text-align:center">Signed in as <strong>${esc(user.username)}</strong></p>
      ${statGridHtml(user.stats[statKey(difficulty, 'daily')], statKey(difficulty, 'daily'))}
      <p class="note" style="margin-top:4px">${DIFFICULTY[difficulty].label} daily stats</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="stats">All stats</button>
        <button class="btn btn-primary" data-action="logout">Sign out</button>
      </div>`, (body) => {
      body.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'stats') showStatsModal();
        if (action === 'logout') {
          await api('POST', '/api/logout').catch(() => {});
          user = null;
          closeModal();
          loadGame();
          toast('Signed out');
        }
      });
    });
    return;
  }

  const signup = tab === 'signup';
  openModal(`
    <h2 id="modal-title">${signup ? 'Create account' : 'Sign in'}</h2>
    <div class="seg">
      <button data-tab="login" class="${signup ? '' : 'active'}">Sign in</button>
      <button data-tab="signup" class="${signup ? 'active' : ''}">Create account</button>
    </div>
    <form class="form" novalidate>
      <label>Username<input name="username" autocomplete="username" maxlength="20" required></label>
      <label>Password<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
      <p class="form-error" aria-live="polite"></p>
      <button class="btn btn-primary btn-block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="note">${signup ? 'Your guest stats on this device will carry over.' : 'Track your streaks and win % on any device.'}</p>`, (body) => {
    body.querySelector('input').focus();
    body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) showAccountModal(t.dataset.tab);
    });
    body.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type=submit]');
      const errEl = form.querySelector('.form-error');
      const payload = { username: form.username.value.trim(), password: form.password.value, day: todayStr() };
      if (signup) {
        payload.guestStats = guestStats();
        payload.today = {};
        for (const d of ['easy', 'hard']) {
          const saved = store.get(KEYS.daily(d, todayStr()));
          if (saved?.done && saved.recorded) {
            payload.today[statKey(d, 'daily')] = { guesses: saved.guesses, won: saved.guesses.includes(dailyAnswer(todayStr(), d).id) };
          }
        }
      }
      btn.disabled = true;
      errEl.textContent = '';
      try {
        const { user: u } = await api('POST', signup ? '/api/signup' : '/api/login', payload);
        user = u;
        await syncTodayAfterLogin();
        closeModal();
        loadGame();
        toast(signup ? `Welcome, ${user.username}!` : `Welcome back, ${user.username}`);
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

// If today's dailies were finished as a guest before signing in, count them for the account too.
async function syncTodayAfterLogin() {
  const day = todayStr();
  for (const d of ['easy', 'hard']) {
    const key = statKey(d, 'daily');
    const saved = store.get(KEYS.daily(d, day));
    if (user.today?.[key] || !saved?.done) continue;
    const won = saved.guesses.includes(dailyAnswer(day, d).id);
    try {
      user = (await api('POST', '/api/result', { mode: key, won, guesses: saved.guesses, day })).user;
    } catch {}
  }
}

// ---------- share / toast / api ----------

async function share() {
  const rows = game.guesses.map((id) => compareFighters(byId.get(id), game.answer)
    .map((t) => ({ green: '🟩', yellow: '🟨', red: '🟥' }[t.status])).join(''));
  const level = DIFFICULTY[game.difficulty].label;
  const title = game.mode === 'daily' ? `Octagonle ${level} #${dailyNumber(game.day)}` : `Octagonle ${level} Unlimited`;
  const text = `${title} ${game.won ? game.guesses.length : 'X'}/${MAX_GUESSES}\n${rows.join('\n')}\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast("Couldn't share");
  }
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!data) throw Object.assign(new Error('Server unavailable'), { unavailable: true });
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- wiring ----------

function setMode(next) {
  mode = next;
  store.set(KEYS.mode, mode);
  updateHash();
  closeSuggestions();
  loadGame();
}

function setDifficulty(next) {
  useDifficulty(next);
  store.set(KEYS.difficulty, next);
  updateHash();
  closeSuggestions();
  $('#guess-input').value = '';
  loadGame();
}

// Shareable links: #easy, #unlimited, #easy-unlimited (Hard Daily has no hash).
function updateHash() {
  const hash = [difficulty === 'easy' && 'easy', mode === 'unlimited' && 'unlimited'].filter(Boolean).join('-');
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
}

function bindEvents() {
  const input = $('#guess-input');
  input.addEventListener('input', renderSuggestions);
  input.addEventListener('focus', () => input.value && renderSuggestions());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Escape') closeSuggestions();
    else if (e.key === 'Enter') {
      e.preventDefault();
      const f = suggestionList[activeIndex];
      if (f) submitGuess(f);
      else if (input.value.trim()) {
        input.parentElement.classList.remove('shake');
        void input.offsetWidth;
        input.parentElement.classList.add('shake');
      }
    }
  });
  $('#suggestions').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) { e.preventDefault(); submitGuess(byId.get(li.dataset.id)); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) closeSuggestions();
    if (e.target.closest('[data-open="account"]')) showAccountModal();
  });

  document.querySelectorAll('.mode-tab').forEach((t) => t.addEventListener('click', () => t.dataset.mode !== mode && setMode(t.dataset.mode)));
  document.querySelectorAll('.diff-btn').forEach((b) => b.addEventListener('click', () => b.dataset.difficulty !== difficulty && setDifficulty(b.dataset.difficulty)));
  $('#silhouette-toggle').addEventListener('change', (e) => { store.set(KEYS.silhouette, e.target.checked); renderMystery(); });
  $('#btn-help').addEventListener('click', showHelpModal);
  $('#btn-stats').addEventListener('click', () => showStatsModal());
  $('#btn-account').addEventListener('click', () => showAccountModal());
  $('#btn-show-result').addEventListener('click', showEndModal);
  $('#btn-next').addEventListener('click', newUnlimitedGame);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal(); });

  // Roll over to the new daily fighter at local midnight.
  setInterval(() => {
    if (game.mode === 'daily' && game.day !== todayStr()) loadGame();
  }, 30000);
}

async function init() {
  const [hard, easy, me] = await Promise.all([
    fetch(POOL_FILES.hard).then((r) => r.json()),
    fetch(POOL_FILES.easy).then((r) => r.json()),
    api('GET', `/api/me?day=${todayStr()}`).catch((err) => {
      if (err.unavailable) serverAvailable = false;
      return { user: null };
    }),
  ]);
  for (const f of easy) if (f.dob) f.age = ageOn(f.dob);
  pools = { hard, easy };
  user = me.user;
  const hash = location.hash.slice(1);
  useDifficulty(hash ? (hash.includes('easy') ? 'easy' : 'hard') : store.get(KEYS.difficulty, 'hard') === 'easy' ? 'easy' : 'hard');
  mode = hash ? (hash.includes('unlimited') ? 'unlimited' : 'daily') : store.get(KEYS.mode, 'daily') === 'unlimited' ? 'unlimited' : 'daily';
  bindEvents();
  loadGame();
  if (!store.get(KEYS.seenHelp)) {
    store.set(KEYS.seenHelp, true);
    showHelpModal();
  }
}

init();
