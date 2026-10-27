// Shared by the browser (guest stats) and server.mjs (signed-in stats).
export const MAX_GUESSES = 8;

// Hard (ranked fighters) keeps the original keys; Easy (champions) has its own.
export const MODES = ['daily', 'unlimited', 'easyDaily', 'easyUnlimited'];
export const isDailyMode = (mode) => mode === 'daily' || mode === 'easyDaily';
export const statKey = (difficulty, mode) => (difficulty === 'easy' ? `easy${mode[0].toUpperCase()}${mode.slice(1)}` : mode);

export function emptyModeStats() {
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: Array(MAX_GUESSES).fill(0), lastDay: null, lastWinDay: null };
}

export function emptyStats() {
  return Object.fromEntries(MODES.map((m) => [m, emptyModeStats()]));
}

// "2026-10-26" -> whole days since epoch.
export function dayNumber(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayNumber(value));
}

// Returns a new stats object with one finished game folded in.
export function applyResult(stats, { mode, won, guessCount, day }) {
  const s = structuredClone(stats[mode] ?? emptyModeStats());
  s.played += 1;
  if (won) {
    s.wins += 1;
    s.dist[Math.min(guessCount, MAX_GUESSES) - 1] += 1;
    // Daily streaks need consecutive days; unlimited streaks need consecutive wins.
    const continues = !isDailyMode(mode) || (s.lastWinDay && dayNumber(day) - dayNumber(s.lastWinDay) === 1);
    s.streak = continues ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    if (isDailyMode(mode)) s.lastWinDay = day;
  } else {
    s.streak = 0;
  }
  if (isDailyMode(mode)) s.lastDay = day;
  return { ...emptyStats(), ...stats, [mode]: s };
}

// A daily streak lapses if yesterday's puzzle wasn't won.
export function currentStreak(modeStats, mode, today) {
  if (isDailyMode(mode) && modeStats.lastWinDay && dayNumber(today) - dayNumber(modeStats.lastWinDay) > 1) return 0;
  return modeStats.streak;
}

// Accepts untrusted JSON (guest stats imported at sign-up) and returns a clean copy.
export function sanitizeStats(raw) {
  const out = emptyStats();
  for (const mode of MODES) {
    const r = raw?.[mode];
    if (!r || typeof r !== 'object') continue;
    const n = (v) => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0);
    const s = out[mode];
    s.played = n(r.played);
    s.wins = Math.min(n(r.wins), s.played);
    s.streak = Math.min(n(r.streak), s.wins);
    s.maxStreak = Math.max(Math.min(n(r.maxStreak), s.wins), s.streak);
    if (Array.isArray(r.dist)) s.dist = s.dist.map((_, i) => n(r.dist[i]));
    s.lastDay = isDay(r.lastDay) ? r.lastDay : null;
    s.lastWinDay = isDay(r.lastWinDay) ? r.lastWinDay : null;
  }
  return out;
}
