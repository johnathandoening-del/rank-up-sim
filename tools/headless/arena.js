'use strict';
/* Arena: many headless matches between two policies, in parallel worker threads. Every deal is played twice with the
 * seats swapped (same seed, same classes), so the luck of the deal cancels out of the comparison.
 *   node tools/headless/arena.js <deals> '<policyA json>' '<policyB json>' [workers=14] [classA] [classB]
 * ARENA_OUT=<file> also writes every game's result (and the summary) there as JSON.
 * Policies: {"kind":"random"} | {"kind":"brain", N, worlds, width, maxEvals, ms, ...}. Prints A's score. */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// One match. aSeat: which engine seat policy A plays. Returns the winner as 'A' | 'B' | 'draw' | 'unfinished'.
function play(job) {
  const { createEngine } = require('./engine');
  const { newMatch } = require('./match');
  const nopaint = require('./nopaint');
  const brain = require('./brain');
  const eng = createEngine({ seed: job.seed }); nopaint.install(eng);
  const m = newMatch({ engine: eng, seed: job.seed, cls0: job.cls0, cls1: job.cls1, firstSeat: job.firstSeat, evo: job.evo });
  brain.install(eng);
  // A side may think with another version of the bot (pol.brainFile: a module exporting BRAIN_CODE) — an A/B test of
  // the bot itself. Each version is its own __B (its own plans and memory); every version hears every input.
  const brains = { '': '__B' };
  [job.polA, job.polB].forEach((pol) => { if (pol.brainFile && !brains[pol.brainFile]) {
    const nm = '__Balt' + Object.keys(brains).length;
    eng.run('var __Bmain = __B;'); eng.run(require(require('path').resolve(pol.brainFile)).BRAIN_CODE); eng.run(nm + ' = __B; __B = __Bmain;');
    brains[pol.brainFile] = nm; } });
  const allB = (code) => Object.values(brains).forEach((nm) => eng.run(nm + code));
  allB('.noteApplied(null)');
  const rnd = mulberry32(job.seed * 977 + (job.aSeat === 'player' ? 1 : 2));
  job.wcache = {};
  const t0 = Date.now(), stat = { A: { n: 0, ms: 0 }, B: { n: 0, ms: 0 } };
  let steps = 0, last = '', stale = 0, stop = null;     // stop: why an unfinished game ended
  while (steps < 6000 && Date.now() - t0 < job.maxMs) {
    const d = eng.run('__M.decider()');
    if (d.kind === 'over' || d.kind === 'none') break;
    const who = d.seat === job.aSeat ? 'A' : 'B', pol = who === 'A' ? job.polA : job.polB;
    let move = null; const t = Date.now();
    if (pol.kind === 'random') {
      const L = eng.run('__M.legal(' + JSON.stringify(d.seat) + ')');
      if (!L.length) { stop = 'no legal move'; break; }
      move = L[Math.floor(rnd() * L.length)];
      const adv = L.find((x) => x.t === 'adv' || x.t === 'sdDone'); if (adv && rnd() < 0.3) move = adv;
    } else {
      // a tier policy turns into this turn's thinking settings (N with its occasional bump, worlds, width, time, temp)
      const opts = pol.kind === 'tier' ? require('./tiers').planOpts(pol.key, eng.run('G._turnNo||0'), job.seed * 7 + (who === 'A' ? 1 : 2), pol.scale || 1, d) : pol;
      // each side thinks with its own evaluation weights (null = the built-in starting weights)
      const BN = brains[pol.brainFile || ''];
      eng.run(BN + '.setWeights(' + JSON.stringify(pol.weightsFile ? (job.wcache[pol.weightsFile] || (job.wcache[pol.weightsFile] = JSON.parse(require('fs').readFileSync(pol.weightsFile, 'utf8')))) : null) + ')');
      const r = eng.run(BN + '.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(Object.assign({ seed: job.seed * 31 + steps }, opts)) + ')');
      if (!r || !r.move) { stop = 'no move: ' + (r && r.why); break; }
      move = r.move;
    }
    stat[who].ms += Date.now() - t; stat[who].n++;
    eng.run('__H.apply(' + JSON.stringify(move) + ')'); eng.settle(10000);
    allB('.noteApplied(' + JSON.stringify(move) + ')');
    steps++;
    const sg = eng.run('ruStateSig()'); if (sg === last) { if (++stale > 200) { stop = 'stuck: 200 inputs changed nothing (' + JSON.stringify(eng.run('__M.decider()')).slice(0, 160) + ')'; break; } } else { stale = 0; last = sg; }
  }
  if (!stop && steps >= 6000) stop = '6000 inputs'; else if (!stop && Date.now() - t0 >= job.maxMs) stop = 'time limit';
  const w = eng.run('G.__winner || null'), over = eng.run('!!G.gameOver');
  return { reason: eng.run('G.__reason || null'), mp: eng.run('[G.player.mp, G.ai.mp, G.player.cas, G.ai.cas, G.player.deck.length, G.ai.deck.length]'), stop: over ? null : stop, winner: !over ? 'unfinished' : w === job.aSeat ? 'A' : (w && w !== 'draw' ? 'B' : 'draw'), turns: eng.run('G._turnNo||0'), seed: job.seed, cls: [job.cls0, job.cls1], aSeat: job.aSeat, firstSeat: job.firstSeat, steps, stat, sec: Math.round((Date.now() - t0) / 1000), errors: eng.errors.slice(0, 2) };
}

if (isMainThread) {
  const [dealsArg, aArg, bArg, wArg, clsA, clsB] = process.argv.slice(2);
  const deals = Number(dealsArg || 7), polA = JSON.parse(aArg || '{"kind":"brain","N":1}'), polB = JSON.parse(bArg || '{"kind":"random"}');
  const W = Math.min(Number(wArg || 14), os.cpus().length);
  const jobs = [];
  for (let k = 0; k < deals; k++) {
    const seed = 50000 + k * 13, c0 = clsA || CLASSES[(k * 7 + 3) % 15], c1 = clsB || CLASSES[(k * 11 + 5) % 15], firstSeat = k % 2;
    jobs.push({ seed, cls0: c0, cls1: c1, firstSeat, aSeat: 'player', polA, polB, maxMs: 30 * 60000 });
    jobs.push({ seed, cls0: c0, cls1: c1, firstSeat, aSeat: 'ai', polA, polB, maxMs: 30 * 60000 });   // same deal, seats swapped
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
