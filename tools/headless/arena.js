'use strict';
/* Arena: many headless matches between two policies, in parallel worker threads. Every deal is played twice with the
 * seats swapped (same seed, same classes), so the luck of the deal cancels out of the comparison.
 *   node tools/headless/arena.js <deals> '<policyA json>' '<policyB json>' [workers=14] [classA] [classB]
 * ARENA_OUT=<file> also writes every game's result (and the summary) there as JSON.
 * Policies: {"kind":"random"} | {"kind":"brain", N, worlds, width, maxEvals, ms, ...}. Prints A's score. */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const { play, deal } = require('./game');      // the game loop itself (shared with replay.js)

if (isMainThread) {
  const [dealsArg, aArg, bArg, wArg, clsA, clsB] = process.argv.slice(2);
  const deals = Number(dealsArg || 7), polA = JSON.parse(aArg || '{"kind":"brain","N":1}'), polB = JSON.parse(bArg || '{"kind":"random"}');
  const W = Math.min(Number(wArg || 14), os.cpus().length);
  const jobs = [];
  for (let k = 0; k < deals; k++) {
    const dl = deal(k, clsA, clsB);
    jobs.push(Object.assign({ aSeat: 'player', polA, polB, maxMs: 30 * 60000 }, dl));
    jobs.push(Object.assign({ aSeat: 'ai', polA, polB, maxMs: 30 * 60000 }, dl));   // same deal, seats swapped
  }
  const results = []; let next = 0, live = 0; const t0 = Date.now();
  const report = () => {
    const c = { A: 0, B: 0, draw: 0, unfinished: 0 }; results.forEach((r) => c[r.winner]++);
    const dec = c.A + c.B;
    console.log(`\nA ${JSON.stringify(polA)}\nB ${JSON.stringify(polB)}`);
    console.log(`${results.length} games (${deals} deals × both seats) in ${Math.round((Date.now() - t0) / 1000)} s: A ${c.A}, B ${c.B}, draw ${c.draw}, unfinished ${c.unfinished} → A wins ${dec ? (100 * c.A / dec).toFixed(1) : '-'}% of decided`);
    const ms = (who) => { const n = results.reduce((a, r) => a + r.stat[who].n, 0), t = results.reduce((a, r) => a + r.stat[who].ms, 0); return n ? Math.round(t / n) + ' ms/decision' : '-'; };
    console.log(`time: A ${ms('A')}, B ${ms('B')}; avg turns ${(results.reduce((a, r) => a + r.turns, 0) / Math.max(1, results.length)).toFixed(1)}`);
    const errs = results.flatMap((r) => r.errors); if (errs.length) console.log('errors:', errs.slice(0, 3).map((e) => e.slice(0, 160)));
    const bad = results.filter((r) => r.winner === 'B' || r.winner === 'unfinished').slice(0, 6);
    if (bad.length) console.log('A did not win:', bad.map((r) => `${r.cls.join('/')} A=${r.aSeat} ${r.winner} t${r.turns}`).join(' | '));
    if (process.env.ARENA_OUT) require('fs').writeFileSync(process.env.ARENA_OUT, JSON.stringify({ polA, polB, counts: c, aShare: dec ? c.A / dec : null, results }, null, 1));
  };
  const spawn = () => {
    if (next >= jobs.length) { if (live === 0) report(); return; }
    const job = jobs[next++]; live++;
    const w = new Worker(__filename, { workerData: job });
    w.on('message', (r) => { results.push(r); process.stdout.write(r.winner === 'A' ? 'A' : r.winner === 'B' ? 'B' : '.'); });
    w.on('error', (e) => { results.push({ winner: 'unfinished', turns: 0, stat: { A: { n: 0, ms: 0 }, B: { n: 0, ms: 0 } }, errors: [String(e && e.message)], cls: [job.cls0, job.cls1], aSeat: job.aSeat }); });
    w.on('exit', () => { live--; spawn(); });
  };
  for (let i = 0; i < W; i++) spawn();
} else {
  parentPort.postMessage(play(workerData));
}
module.exports = { play };
