'use strict';
/* The 14 bot tiers → thinking settings for the bot's plan(). Strength comes ONLY from thinking: lookahead N (turns
 * played forward — the table, including the occasional deeper/shallower turn), how many hidden-information worlds
 * are imagined, search width, effort, and how often a lesser line is played (temp, in evaluation units). Every tier
 * gets the same cards and the same luck.
 *
 * Effort is counted in positions evaluated (fixed mode), not seconds: a tier plays the same on every device (a slow
 * one simply takes longer), and a game replays identically. Values other than N are calibrated by measured win rates.
 *   N: base lookahead, occ: the occasional value, every: ~1 turn in 'every' uses occ (0 = never). */
var TIERS = {
  'inept-1':         { N: 1, occ: 2, every: 15, worlds: 1, maxWorlds: 1,  width: 1, evals: 300,   temp: 40 },
  'maladroit-1':     { N: 1, occ: 2, every: 10, worlds: 1, maxWorlds: 2,  width: 1, evals: 500,   temp: 20 },
  'basic-1':         { N: 1, occ: 2, every: 7,  worlds: 2, maxWorlds: 2,  width: 1, evals: 800,   temp: 10 },
  'skilled-1':       { N: 2, occ: 1, every: 5,  worlds: 2, maxWorlds: 3,  width: 2, evals: 1200,  temp: 6 },
  'skilled-2':       { N: 2, occ: 3, every: 7,  worlds: 2, maxWorlds: 4,  width: 2, evals: 1600,  temp: 4 },
  'talented-1':      { N: 3, occ: 2, every: 7,  worlds: 3, maxWorlds: 5,  width: 2, evals: 2200,  temp: 2.5 },
  'talented-2':      { N: 3, occ: 4, every: 10, worlds: 3, maxWorlds: 6,  width: 2, evals: 3000,  temp: 1.5 },
  'dCandidate-1':    { N: 4, occ: 3, every: 7,  worlds: 3, maxWorlds: 6,  width: 2, evals: 4000,  temp: 1 },
  'dCandidate-2':    { N: 4, occ: 4, every: 0,  worlds: 4, maxWorlds: 8,  width: 3, evals: 5000,  temp: 0.6 },
  'dCandidate-3':    { N: 4, occ: 5, every: 10, worlds: 4, maxWorlds: 8,  width: 3, evals: 6000,  temp: 0.35 },
  'distinguished-1': { N: 4, occ: 5, every: 7,  worlds: 5, maxWorlds: 10, width: 3, evals: 7500,  temp: 0.2 },
  'distinguished-2': { N: 5, occ: 5, every: 0,  worlds: 5, maxWorlds: 12, width: 3, evals: 9000,  temp: 0.1 },
  'distinguished-3': { N: 5, occ: 6, every: 10, worlds: 6, maxWorlds: 14, width: 4, evals: 11000, temp: 0.05 },
  'distinguished-4': { N: 7, occ: 7, every: 0,  worlds: 8, maxWorlds: 16, width: 4, evals: 14000, temp: 0 },
};
var ORDER = Object.keys(TIERS);

// N for this turn: base, or the occasional value about 1 turn in 'every' (rolled from the bot's own seed and the
// turn number — the same turn always gets the same answer, and the game's own randomness is never touched).
function nForTurn(key, turnNo, botSeed) {
  var t = TIERS[key]; if (!t) return 1;
  if (!t.every || t.occ === t.N) return t.N;
  var x = ((botSeed >>> 0) ^ Math.imul(turnNo + 1, 2654435761)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12;
  return (x % t.every) === 0 ? t.occ : t.N;
}
// plan() options for a tier at a given turn. scale (0..1] shrinks the effort (fast batch testing only).
function planOpts(key, turnNo, botSeed, scale) {
  var t = TIERS[key] || TIERS['basic-1']; scale = scale || 1;
  var N = nForTurn(key, turnNo, botSeed);
  return { kind: 'brain', fixed: true, N: N, worlds: t.worlds, maxWorlds: t.maxWorlds, width: t.width,
    evals: Math.max(150, Math.round(t.evals * scale)), temp: t.temp, topK: N >= 5 ? 4 : 6, safetyMs: 45000 };
}

// Loadable as a Node module (the headless tools) and as a classic script (the page, the bot worker).
(function (root) { var m = { TIERS: TIERS, ORDER: ORDER, nForTurn: nForTurn, planOpts: planOpts };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; root.RUAI.tiers = m; }
})(typeof self !== 'undefined' ? self : this);
