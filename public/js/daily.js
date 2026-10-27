// Daily answer selection, shared by the game and the weekly data build.
// The build writes public/data/daily.json (difficulty -> date -> fighter id) weeks ahead, so a roster
// update never changes a day's fighter. shuffledPick() covers dates the schedule doesn't have.
import { dayNumber } from './stats.js';

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same fighter for everyone on a given date. Each cycle through the pool is a fresh shuffle,
// so no fighter repeats until all of them have been used.
export function shuffledPick(ids, day, difficulty) {
  const sorted = [...ids].sort();
  const n = dayNumber(day);
  const rand = mulberry32(Math.floor(n / sorted.length) * 7919 + (difficulty === 'easy' ? 4242 : 1337));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  return sorted[n % sorted.length];
}
