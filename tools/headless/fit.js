'use strict';
/* Fit the evaluation weights to self-play outcomes: logistic regression with no bias (the evaluation is antisymmetric),
 * L2-regularised, terms standardised for the fit and mapped back to raw terms. Prints held-out accuracy and log-loss
 * against the current hand-set weights, and writes weights JSON usable by __B.setWeights.
 *   node tools/headless/fit.js <data.jsonl[,more.jsonl]> <out-weights.json> [l2=1e-3] */
const fs = require('fs');
const [files, out, l2Arg] = process.argv.slice(2);
// FIT_EVERY=k keeps every k-th position (positions of one game are strongly correlated; a big run needs no more)
const EVERY = Number(process.env.FIT_EVERY || 1);
const rows = files.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter((l, i) => l && i % EVERY === 0).map((l) => JSON.parse(l))).filter((r) => r.type !== 'game');
// rows with raw features get their terms from the bot's own terms() (one definition; refit after changing it)
const B = (() => { const win = {}; require('vm').runInNewContext(require('./brain').CODE, { window: win, Date, Math }); return win.__B; })();
rows.forEach((r) => { if (r.f) r.t = B.terms(r.f); });
const ONLY = process.env.FIT_TERMS ? process.env.FIT_TERMS.split(',') : null;
const keys = Object.keys(rows[0].t).filter((k) => !ONLY || ONLY.includes(k));
const X = rows.map((r) => keys.map((k) => r.t[k] || 0)), Y = rows.map((r) => r.y);
// held-out split BY GAME (positions of one game are strongly correlated; a split by position would leak)
const gid = (r, i) => (r.g != null ? 'g' + r.g : 'f' + Math.floor(i / 60));
// (a seeded shuffle: every run of the same data uses the same split, so fits can be compared)
let seedS = Number(process.env.FIT_SEED || 7) >>> 0; const rnd = () => { seedS = (seedS + 0x6D2B79F5) >>> 0; let t = Math.imul(seedS ^ (seedS >>> 15), 1 | seedS); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const games = [...new Set(rows.map(gid))].sort(); for (let i = games.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [games[i], games[j]] = [games[j], games[i]]; }
const testG = new Set(games.slice(Math.floor(games.length * 0.8)));
const tr = [], te = []; rows.forEach((r, i) => (testG.has(gid(r, i)) ? te : tr).push(i));
const sd = keys.map((_, j) => { const v = tr.map((i) => X[i][j]); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length) || 1; });
const Z = (i) => X[i].map((x, j) => x / sd[j]);
const l2 = Number(l2Arg || 1e-3);
const sig = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
// Known directions (the rules decide them, not the data): more Morale / fewer Casualties / more Deck / a lethal
// threat is never bad for the side that has it. A fitted weight may not take the wrong sign — correlated terms
// otherwise produce weights like "low Morale is good", which a search would then actively seek out.
const SIGN = { mv: 1, mpRaw: 1, mpLow: 1, mpHigh: 1, cv: 1, casRaw: -1, casHigh: -1, casNeg: 1, deck: 1, deckRaw: 1, deckLow: -1,
  lethal: 1, danger: -1, locked: -1, promo: 1, threat: 1, beats: 1, threatT: 1, rank: 1, rankRP: 1, flank: 1, maxNP: 1, hand: 1 };
const signs = keys.map((k) => (process.env.FIT_FREE ? 0 : SIGN[k] || 0));
// Full-batch Adam with the sign constraints applied after every step (projected), to convergence.
const ZT = tr.map(Z), YT = tr.map((i) => Y[i]);
let w = keys.map(() => 0); const m1 = keys.map(() => 0), m2 = keys.map(() => 0);
const proj = (v, j) => (signs[j] > 0 ? Math.max(0, v) : signs[j] < 0 ? Math.min(0, v) : v);
function trainLoss(){ let ll = 0; for (let n = 0; n < ZT.length; n++) { const p = sig(ZT[n].reduce((a, x, j) => a + x * w[j], 0)); ll -= YT[n] ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9); } return ll / ZT.length; }
for (let ep = 1; ep <= 1500; ep++) {
  const g = keys.map(() => 0);
  for (let n = 0; n < ZT.length; n++) { const z = ZT[n]; const p = sig(z.reduce((a, x, j) => a + x * w[j], 0)); const e = p - YT[n]; for (let j = 0; j < z.length; j++) g[j] += e * z[j]; }
  const lr = 0.05 / Math.sqrt(1 + ep / 300);
  w = w.map((wj, j) => { const gj = g[j] / ZT.length + l2 * wj; m1[j] = 0.9 * m1[j] + 0.1 * gj; m2[j] = 0.999 * m2[j] + 0.001 * gj * gj;
    const mh = m1[j] / (1 - Math.pow(0.9, ep)), vh = m2[j] / (1 - Math.pow(0.999, ep)); return proj(wj - lr * mh / (Math.sqrt(vh) + 1e-8), j); });
}
function score(wts, scaled) {
  let ll = 0, acc = 0;
  for (const i of te) { const z = scaled ? Z(i) : X[i]; const p = sig(z.reduce((a, x, j) => a + x * wts[j], 0)); ll += -(Y[i] ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9)); acc += (p > 0.5) === (Y[i] === 1) ? 1 : 0; }
  return { ll: ll / te.length, acc: acc / te.length };
}
const fitted = score(w, true);
const raw = w.map((wj, j) => wj / sd[j]);
const W0 = { mv: 1, cv: 1, deck: 1, rank: 1.2, rankRP: 0, flank: 0.6, fieldN: 2.0, hand: 0.8, bank: 0.5, actions: 0.7, delta: 0, area: 0, maxNP: 0, tempo: 0 };
let bestS = 0.01, bestLL = Infinity;
for (const s of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]) { const r = score(keys.map((k) => (W0[k] || 0) * s), false); if (r.ll < bestLL) { bestLL = r.ll; bestS = s; } }
const base = score(keys.map((k) => (W0[k] || 0) * bestS), false);
console.log(`${rows.length} positions (${tr.length} train / ${te.length} test)`);
console.log(`train log-loss ${trainLoss().toFixed(3)}`);
console.log(`held-out: fitted acc ${(100 * fitted.acc).toFixed(1)}% log-loss ${fitted.ll.toFixed(3)} | v0 weights acc ${(100 * base.acc).toFixed(1)}% log-loss ${base.ll.toFixed(3)}`);
const wObj = {}; keys.forEach((k, j) => { wObj[k] = Math.round(raw[j] * 1e4) / 1e4; });
console.log('weights (raw terms):', JSON.stringify(wObj));
fs.writeFileSync(out, JSON.stringify({ w: wObj, trainedOn: rows.length, acc: fitted.acc, ll: fitted.ll }, null, 1));
