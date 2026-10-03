'use strict';
/* Fit the evaluation weights to self-play outcomes: logistic regression with no bias (the evaluation is antisymmetric),
 * L2-regularised, terms standardised for the fit and mapped back to raw terms. Prints held-out accuracy and log-loss
 * against the current hand-set weights, and writes weights JSON usable by __B.setWeights.
 *   node tools/headless/fit.js <data.jsonl[,more.jsonl]> <out-weights.json> [l2=1e-3] */
const fs = require('fs');
const [files, out, l2Arg] = process.argv.slice(2);
const rows = files.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const keys = Object.keys(rows[0].t);
const X = rows.map((r) => keys.map((k) => r.t[k] || 0)), Y = rows.map((r) => r.y);
const idx = X.map((_, i) => i).sort(() => Math.random() - 0.5), cut = Math.floor(idx.length * 0.8);
const tr = idx.slice(0, cut), te = idx.slice(cut);
const sd = keys.map((_, j) => { const v = tr.map((i) => X[i][j]); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length) || 1; });
const Z = (i) => X[i].map((x, j) => x / sd[j]);
const l2 = Number(l2Arg || 1e-3);
const sig = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
let w = keys.map(() => 0);
for (let ep = 0; ep < 400; ep++) {
  const g = keys.map(() => 0);
  for (const i of tr) { const z = Z(i); const p = sig(z.reduce((a, x, j) => a + x * w[j], 0)); const e = p - Y[i]; z.forEach((x, j) => { g[j] += e * x; }); }
  w = w.map((wj, j) => wj - 0.5 * (g[j] / tr.length + l2 * wj));
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
console.log(`held-out: fitted acc ${(100 * fitted.acc).toFixed(1)}% log-loss ${fitted.ll.toFixed(3)} | v0 weights acc ${(100 * base.acc).toFixed(1)}% log-loss ${base.ll.toFixed(3)}`);
const wObj = {}; keys.forEach((k, j) => { wObj[k] = Math.round(raw[j] * 1e4) / 1e4; });
console.log('weights (raw terms):', JSON.stringify(wObj));
fs.writeFileSync(out, JSON.stringify({ w: wObj, trainedOn: rows.length, acc: fitted.acc, ll: fitted.ll }, null, 1));
