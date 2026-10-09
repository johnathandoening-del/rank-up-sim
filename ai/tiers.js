'use strict';
/* The 14 bot tiers -> thinking settings for the bot's plan(). Strength comes ONLY from thinking — every tier gets the
 * same cards and the same luck:
 *   noise   how much the tier misjudges each position it weighs (evaluation units, sd of a Gaussian; 0 = sees it as it
 *           is). The dial that separates the tiers: measured on the paired planner, noise 0 beats noise 4 77%, 4 beats
 *           8 76%, 8 beats 14 79%, 14 beats 22 66%, 22 beats 35 63% ... 90 plays about like random moves. The schedule
 *           spaces the 14 tiers evenly in strength (logits of win odds) from about random to the best the bot plays.
 *   N       lookahead (turns played forward — the user's table, including the occasional deeper/shallower turn);
 *   worlds, maxWorlds  hidden-information worlds imagined (at least / at most); width  search width;
 *   evals   effort per decision, counted in positions (fixed: the same thought on every device; a slow one just takes
 *           longer — ~0.3-0.5 ms each on a desktop).
 *   occ: the occasional N, every: ~1 turn in 'every' uses occ (0 = never). */
var TIERS = {
  'inept-1':         { N: 1, occ: 2, every: 15, worlds: 1, maxWorlds: 2,  width: 1, evals: 600,   noise: 84 },
  'maladroit-1':     { N: 1, occ: 2, every: 10, worlds: 2, maxWorlds: 3,  width: 1, evals: 900,   noise: 38 },
  'basic-1':         { N: 1, occ: 2, every: 7,  worlds: 2, maxWorlds: 3,  width: 2, evals: 1200,  noise: 26 },
  'skilled-1':       { N: 2, occ: 1, every: 5,  worlds: 2, maxWorlds: 4,  width: 2, evals: 1600,  noise: 19 },
  'skilled-2':       { N: 2, occ: 3, every: 7,  worlds: 3, maxWorlds: 5,  width: 2, evals: 2000,  noise: 14 },
  'talented-1':      { N: 3, occ: 2, every: 7,  worlds: 3, maxWorlds: 6,  width: 2, evals: 2600,  noise: 12 },
  'talented-2':      { N: 3, occ: 4, every: 10, worlds: 3, maxWorlds: 6,  width: 3, evals: 3200,  noise: 10.3 },
  'dCandidate-1':    { N: 4, occ: 3, every: 7,  worlds: 4, maxWorlds: 8,  width: 3, evals: 4000,  noise: 8.4 },
  'dCandidate-2':    { N: 4, occ: 4, every: 0,  worlds: 4, maxWorlds: 8,  width: 3, evals: 4500,  noise: 6.9 },
  'dCandidate-3':    { N: 4, occ: 5, every: 10, worlds: 5, maxWorlds: 10, width: 3, evals: 5000,  noise: 5.5 },
  'distinguished-1': { N: 4, occ: 5, every: 7,  worlds: 5, maxWorlds: 10, width: 3, evals: 6000,  noise: 4.1 },
  'distinguished-2': { N: 5, occ: 5, every: 0,  worlds: 6, maxWorlds: 12, width: 4, evals: 7000,  noise: 2.7 },
  'distinguished-3': { N: 5, occ: 6, every: 10, worlds: 6, maxWorlds: 14, width: 4, evals: 8000,  noise: 1.4 },
  'distinguished-4': { N: 7, occ: 7, every: 0,  worlds: 8, maxWorlds: 16, width: 4, evals: 10000, noise: 0 },
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
// d (the decision: __M.decider()) sets how much of the tier's effort it gets — a whole turn the full effort, choosing
// which card to switchdraw a third, a prompt's answer two fifths — and how long a slow device may take at most.
function planOpts(key, turnNo, botSeed, scale, d) {
  var t = TIERS[key] || TIERS['basic-1']; scale = scale || 1;
  var N = nForTurn(key, turnNo, botSeed);
  var part = !d ? 1 : (d.kind === 'modal' || d.kind === 'pick') ? 0.4 : d.mode === 'switchdraw' ? 0.33 : 1;
  return { kind: 'brain', fixed: true, N: N, worlds: t.worlds, maxWorlds: t.maxWorlds, width: t.width,
    evals: Math.max(150, Math.round(t.evals * scale * part)), noise: t.noise || 0, topK: N >= 5 ? 4 : 6,
    safetyMs: Math.round(25000 * part) + 5000 };
}

// Loadable as a Node module (the headless tools) and as a classic script (the page, the bot worker).
(function (root) { var m = { TIERS: TIERS, ORDER: ORDER, nForTurn: nForTurn, planOpts: planOpts };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; root.RUAI.tiers = m; }
})(typeof self !== 'undefined' ? self : this);
