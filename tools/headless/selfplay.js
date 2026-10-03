'use strict';
/* Self-play data for learning the evaluation: brain-vs-brain games in parallel workers. At the start of every turn the
 * position's evaluation terms are recorded from BOTH seats' points of view; when the game ends each record is labelled
 * 1 (that seat won) / 0 (lost). Output: JSON lines appended to <out>.
 *   node tools/headless/selfplay.js <games> <out.jsonl> '<policy json>' [workers=14] [weights.json] */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'); const os = require('os');
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];

function game(job) {
  const { createEngine } = require('./engine'); const { newMatch } = require('./match');
  const nopaint = require('./nopaint'); const brain = require('./brain');
  const eng = createEngine({ seed: job.seed }); nopaint.install(eng);
  const m = newMatch({ engine: eng, seed: job.seed, cls0: job.cls0, cls1: job.cls1, firstSeat: job.firstSeat, evo: job.evo });
  brain.install(eng); eng.run('__B.noteApplied(null)');
  if (job.weights) eng.run('__B.setWeights(' + JSON.stringify(job.weights) + ')');
  const recs = []; let lastTurn = -1, steps = 0; const t0 = Date.now();
  while (steps < 6000 && Date.now() - t0 < job.maxMs) {
    const d = eng.run('__M.decider()'); if (d.kind === 'over' || d.kind === 'none') break;
    const tn = eng.run('G._turnNo||0');
    if (tn !== lastTurn && eng.run('__S.quiet()')) {
      lastTurn = tn;
      ['player', 'ai'].forEach((w) => recs.push({ w, t: eng.run('__B.terms(__B.features(' + JSON.stringify(w) + '))'), turn: tn, cls: w === 'player' ? job.cls0 : job.cls1 }));
    }
    const r = eng.run('__B.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(Object.assign({ seed: job.seed * 31 + steps }, job.pol)) + ')');
    if (!r || !r.move) break;
    eng.run('__H.apply(' + JSON.stringify(r.move) + ')'); eng.settle(10000); eng.run('__B.noteApplied(' + JSON.stringify(r.move) + ')');
    steps++;
  }
  const w = eng.run('G.__winner || null'), over = eng.run('!!G.gameOver');
  if (!over || !w || w === 'draw') return { over, w, recs: [] };
  recs.forEach((r) => { r.y = r.w === w ? 1 : 0; });
  return { over, w, turns: eng.run('G._turnNo||0'), recs };
}

if (isMainThread) {
  const [gArg, out, polArg, wArg, weightsFile] = process.argv.slice(2);
  const games = Number(gArg || 14);
  const pol = JSON.parse(polArg || '{"kind":"brain","N":1,"worlds":2,"maxWorlds":3,"width":2,"maxEvals":2500,"ms":1200}');
  const W = Math.min(Number(wArg || 14), os.cpus().length);
  const weights = weightsFile ? JSON.parse(fs.readFileSync(weightsFile, 'utf8')) : null;
  const base = 70000 + Math.floor(Math.random() * 100000);
  const jobs = Array.from({ length: games }, (_, k) => ({ seed: base + k * 17, cls0: CLASSES[(base + k * 7) % 15], cls1: CLASSES[(base + k * 11 + 4) % 15], firstSeat: k % 2, evo: k % 3 !== 0, pol, weights, maxMs: 25 * 60000 }));
  let next = 0, live = 0, done = 0, rows = 0; const t0 = Date.now();
  const spawn = () => {
    if (next >= jobs.length) { if (live === 0) console.log(`\n${done} games, ${rows} labelled positions -> ${out} (${Math.round((Date.now() - t0) / 1000)} s)`); return; }
    const job = jobs[next++]; live++;
    const wk = new Worker(__filename, { workerData: job });
    wk.on('message', (r) => { done++; if (r.recs.length) { fs.appendFileSync(out, r.recs.map((x) => JSON.stringify(x)).join('\n') + '\n'); rows += r.recs.length; } process.stdout.write(r.over ? '+' : '.'); });
    wk.on('error', () => { done++; process.stdout.write('x'); });
    wk.on('exit', () => { live--; spawn(); });
  };
  for (let i = 0; i < W; i++) spawn();
} else parentPort.postMessage(game(workerData));
