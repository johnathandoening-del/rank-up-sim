'use strict';
/* The 14 bot tiers → thinking settings for brain.plan(). Strength comes ONLY from thinking — lookahead N (the user's
 * table, including the occasional deeper/shallower turn), how many hidden-information worlds are sampled, search
 * width, thinking time, and how often a lesser line is played (temp). Every tier gets the same cards and the same
 * luck. Values other than N are starting points, calibrated by measured win rates (arena.js / ladder runs).
 *   N: base lookahead (turns), occ: the occasional value, every: ~1 turn in 'every' uses occ (0 = never). */
const TIERS = {
  'inept-1':         { N: 1, occ: 2, every: 15, worlds: 1, maxWorlds: 1, width: 1, ms: 400,   temp: 40 },
  'maladroit-1':     { N: 1, occ: 2, every: 10, worlds: 1, maxWorlds: 2, width: 1, ms: 600,   temp: 20 },
  'basic-1':         { N: 1, occ: 2, every: 7,  worlds: 2, maxWorlds: 2, width: 1, ms: 800,   temp: 10 },
  'skilled-1':       { N: 2, occ: 1, every: 5,  worlds: 2, maxWorlds: 3, width: 2, ms: 1200,  temp: 6 },
  'skilled-2':       { N: 2, occ: 3, every: 7,  worlds: 2, maxWorlds: 4, width: 2, ms: 1600,  temp: 4 },
  'talented-1':      { N: 3, occ: 2, every: 7,  worlds: 3, maxWorlds: 5, width: 2, ms: 2200,  temp: 2.5 },
  'talented-2':      { N: 3, occ: 4, every: 10, worlds: 3, maxWorlds: 6, width: 2, ms: 3000,  temp: 1.5 },
  'dCandidate-1':    { N: 4, occ: 3, every: 7,  worlds: 3, maxWorlds: 6, width: 2, ms: 3500,  temp: 1 },
  'dCandidate-2':    { N: 4, occ: 4, every: 0,  worlds: 4, maxWorlds: 8, width: 3, ms: 4500,  temp: 0.6 },
  'dCandidate-3':    { N: 4, occ: 5, every: 10, worlds: 4, maxWorlds: 8, width: 3, ms: 5500,  temp: 0.35 },
  'distinguished-1': { N: 4, occ: 5, every: 7,  worlds: 5, maxWorlds: 10, width: 3, ms: 7000,  temp: 0.2 },
  'distinguished-2': { N: 5, occ: 5, every: 0,  worlds: 5, maxWorlds: 12, width: 3, ms: 8500,  temp: 0.1 },
  'distinguished-3': { N: 5, occ: 6, every: 10, worlds: 6, maxWorlds: 14, width: 4, ms: 10000, temp: 0.05 },
  'distinguished-4': { N: 7, occ: 7, every: 0,  worlds: 8, maxWorlds: 16, width: 4, ms: 12000, temp: 0 },
};
const ORDER = Object.keys(TIERS);

// N for this turn: base, or the occasional value about 1 turn in 'every' (rolled once per turn from the bot's own
// stream — the same turn always gets the same answer).
function nForTurn(key, turnNo, botSeed) {
  const t = TIERS[key]; if (!t) return 1;
  if (!t.every || t.occ === t.N) return t.N;
  let x = ((botSeed >>> 0) ^ Math.imul(turnNo + 1, 2654435761)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12;
  return (x % t.every) === 0 ? t.occ : t.N;
}
// plan() options for a tier at a given turn. scale (0..1] shrinks the thinking time for fast batch testing.
function planOpts(key, turnNo, botSeed, scale) {
  const t = TIERS[key]; scale = scale || 1;
  return { kind: 'brain', N: nForTurn(key, turnNo, botSeed), worlds: t.worlds, maxWorlds: t.maxWorlds, width: t.width,
    ms: Math.max(150, Math.round(t.ms * scale)), maxEvals: Math.round(400000 * scale), temp: t.temp, topK: t.N >= 5 ? 4 : 6 };
}
module.exports = { TIERS, ORDER, nForTurn, planOpts };
