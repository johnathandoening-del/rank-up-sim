'use strict';
/* Self-play data for learning the evaluation: brain-vs-brain games in parallel workers. Every quiet position's raw
 * features are recorded from BOTH seats' points of view; when the game ends each record is labelled
 * 1 (that seat won) / 0 (lost). Output: JSON lines appended to <out>.
 *   node tools/headless/selfplay.js <games> <out.jsonl> '<policy json>' [workers=14] [weights.json] */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'); const os = require('os');
const CLASSES = require('./classes')();   // every class the game knows (the engine's registry)

function game(job) {
  const { createEngine } = require('./engine'); const { newMatch } = require('./match');
  const nopaint = require('./nopaint'); const brain = require('./brain');
  const eng = createEngine({ seed: job.seed }); nopaint.install(eng);
  // ddClass: each side's Δ Deck from the game's own class-aware chooser at full size (a top-tier bot's deck)
  if (job.ddClass && job.evo) { const dd = eng.run(`(function(){ window.RU_AI_LEVEL_KEY = window.RU_AI_LEVEL_KEY_A = 'distinguished'; window.RU_AI_LEVEL_NUM = window.RU_AI_LEVEL_NUM_A = 4; return [window.ruBotDeltaDeckFor(${JSON.stringify(job.cls0)}, 'player'), window.ruBotDeltaDeckFor(${JSON.stringify(job.cls1)}, 'ai')]; })()`); job.dd0 = dd[0]; job.dd1 = dd[1]; }
  const m = newMatch({ engine: eng, seed: job.seed, cls0: job.cls0, cls1: job.cls1, firstSeat: job.firstSeat, evo: job.evo, dd0: job.dd0, dd1: job.dd1 });
  brain.install(eng); eng.run('__B.noteApplied(null)');
  if (job.weights) eng.run('__B.setWeights(' + JSON.stringify(job.weights) + ')');
  const recs = [], seenSig = new Set(), built = { player: new Set(), ai: new Set() }; let lastTurn = -1, steps = 0; const t0 = Date.now();
  while (steps < 6000 && Date.now() - t0 < job.maxMs) {
    const d = eng.run('__M.decider()'); if (d.kind === 'over' || d.kind === 'none') break;
    // every quiet position (the positions the search compares: turn starts and between moves), each once
    const tn = eng.run('G._turnNo||0'), sg = eng.run('__S.quiet() ? ruStateSig() : ""');
    if (sg && !seenSig.has(sg)) {
      seenSig.add(sg); lastTurn = tn;
      ['player', 'ai'].forEach((w) => recs.push({ g: job.seed, w, f: eng.run('__B.features(' + JSON.stringify(w) + ')'), turn: tn, cls: w === 'player' ? job.cls0 : job.cls1 }));
    }
    const r = eng.run('__B.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(Object.assign({ seed: job.seed * 31 + steps }, job.pol)) + ')');
    if (!r || !r.move) break;
    eng.run('__H.apply(' + JSON.stringify(r.move) + ')'); eng.settle(10000); eng.run('__B.noteApplied(' + JSON.stringify(r.move) + ')');
    // which Δ cards each side actually assembled (in its Δ Zone at some point)
    if (job.evo) { const dz = eng.run('[G.player.delta && G.player.delta[0] && (G.player.delta[0].baseId || G.player.delta[0].name), G.ai.delta && G.ai.delta[0] && (G.ai.delta[0].baseId || G.ai.delta[0].name)]'); if (dz[0]) built.player.add(dz[0]); if (dz[1]) built.ai.add(dz[1]); }
    steps++;
  }
  const w = eng.run('G.__winner || null'), over = eng.run('!!G.gameOver');
  const gameRec = { type: 'game', g: job.seed, cls: [job.cls0, job.cls1], evo: job.evo, dd: [job.dd0 || [], job.dd1 || []], built: [[...built.player], [...built.ai]], winner: w, over, turns: eng.run('G._turnNo||0') };
  if (!over || !w || w === 'draw') return { over, w, recs: [], gameRec };
  recs.forEach((r) => { r.y = r.w === w ? 1 : 0; });
  const reason = eng.run('G.__reason || null'); recs.forEach((r) => { r.why = reason; });
  return { over, w, reason, turns: eng.run('G._turnNo||0'), recs, gameRec };
}

if (isMainThread) {
  const [gArg, out, polArg, wArg, weightsFile] = process.argv.slice(2);
  const games = Number(gArg || 14);
  const pol = JSON.parse(polArg || '{"kind":"brain","N":1,"worlds":2,"maxWorlds":3,"width":2,"maxEvals":2500,"ms":1200}');
  const W = Math.min(Number(wArg || 14), os.cpus().length);
  const weights = weightsFile ? JSON.parse(fs.readFileSync(weightsFile, 'utf8')) : null;
  const base = 70000 + Math.floor(Math.random() * 100000);
  // every Δ card in the game (for random Δ Decks: each side 0-3 random cards when evolutions are on)
  const AMALG = [...new Set((fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8').match(/"id": "amalg-[a-z]+-\d+"/g) || []).map((x) => x.slice(7, -1)))];
  let rs = (base * 2654435761) >>> 0; const rnd = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const randDeck = () => { const n = Math.floor(rnd() * 4), out = []; while (out.length < n) { const id = AMALG[Math.floor(rnd() * AMALG.length)]; if (out.indexOf(id) === -1) out.push(id); } return out; };
  const jobs = Array.from({ length: games }, (_, k) => { const evo = k % 4 !== 0; return { seed: base + k * 17, cls0: CLASSES[(base + k * 7) % CLASSES.length], cls1: CLASSES[(base + k * 11 + 4) % CLASSES.length], firstSeat: k % 2, evo, dd0: evo ? randDeck() : [], dd1: evo ? randDeck() : [], ddClass: !!pol.ddClass, pol, weights, maxMs: 25 * 60000 }; });
  console.log(`${AMALG.length} Δ cards in the library`);
  let next = 0, live = 0, done = 0, rows = 0; const t0 = Date.now();
  const spawn = () => {
    if (next >= jobs.length) { if (live === 0) console.log(`\n${done} games, ${rows} labelled positions -> ${out} (${Math.round((Date.now() - t0) / 1000)} s)`); return; }
    const job = jobs[next++]; live++;
    const wk = new Worker(__filename, { workerData: job });
    wk.on('message', (r) => { done++; if (r.recs.length) { fs.appendFileSync(out, r.recs.map((x) => JSON.stringify(x)).join('\n') + '\n'); rows += r.recs.length; } if (r.gameRec) fs.appendFileSync(out.replace(/\.jsonl$/, '') + '.games.jsonl', JSON.stringify(r.gameRec) + '\n'); process.stdout.write(r.over ? '+' : '.'); });
    wk.on('error', () => { done++; process.stdout.write('x'); });
    wk.on('exit', () => { live--; spawn(); });
  };
  for (let i = 0; i < W; i++) spawn();
} else parentPort.postMessage(game(workerData));
