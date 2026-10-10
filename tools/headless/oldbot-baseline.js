'use strict';
/* Baseline: today's (old) bots playing each other in AI-vs-AI mode on the headless engine, on virtual time, across
 * all CPU cores. Measures how well the current tiers separate — the "before" numbers the rebuild must beat.
 *   node tools/headless/oldbot-baseline.js <strongTier> <strongNum> <weakTier> <weakNum> [games=200] [workers=14] */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

const CLASSES = require('./classes')();   // every class the game knows (the engine's registry)

function playGame(cfg, idx) {
  const { createEngine } = require('./engine');
  const nopaint = require('./nopaint');
  const eng = createEngine({ seed: cfg.seed0 + idx * 7919 });
  nopaint.install(eng);
  const strongSeat = idx % 2 === 0 ? 'player' : 'ai', weakSeat = strongSeat === 'player' ? 'ai' : 'player';
  const c0 = CLASSES[(cfg.seed0 + idx * 13) % CLASSES.length], c1 = CLASSES[(cfg.seed0 * 7 + idx * 5 + 3) % CLASSES.length];
  const setTier = (seat, t, n) => seat === 'player' ? `RU_AI_LEVEL_KEY_A=${JSON.stringify(t)};RU_AI_LEVEL_NUM_A=${n};` : `RU_AI_LEVEL_KEY=${JSON.stringify(t)};RU_AI_LEVEL_NUM=${n};`;
  eng.run(`
    (function(){ var o=window.endGameImmediate; window.endGameImmediate=function(w,r){ if(G&&!G.gameOver) G.__winner=w||'draw'; return o.apply(this,arguments); }; })();
    pCls=${JSON.stringify(c0)}; aCls=${JSON.stringify(c1)};
    ${setTier(strongSeat, cfg.strong[0], cfg.strong[1])}${setTier(weakSeat, cfg.weak[0], cfg.weak[1])}
    window.RU_SPECTATOR_SPEED=1;
    (function(){ var s=document.getElementById('ru135-mode-select'); if(s) s.value='ai-vs-ai'; })();
    ru135SetMode('ai-vs-ai'); startGame();
  `);
  // play on virtual time until the match ends (cap: 6 virtual hours)
  let vt = 0;
  while (vt < 6 * 3600 * 1000) {
    eng.advance(2000); vt += 2000;
    if (eng.run('!!(G&&G.gameOver)')) break;
  }
  const r = eng.run('({w:G.__winner||null, over:!!G.gameOver, turns:G._turnNo||0, first:(G.sideOrder||[])[0]})');
  return { win: !r.over ? 'unfinished' : r.w === strongSeat ? 'strong' : r.w === weakSeat ? 'weak' : 'draw', turns: r.turns, strongCls: strongSeat === 'player' ? c0 : c1, weakCls: strongSeat === 'player' ? c1 : c0, strongFirst: r.first === strongSeat, errors: eng.errors.slice(0, 2) };
}

if (isMainThread) {
  const [st, sn, wt, wn, gamesArg, workersArg] = process.argv.slice(2);
  const cfg = { strong: [st || 'distinguished', Number(sn || 4)], weak: [wt || 'inept', Number(wn || 1)], seed0: 1000 };
  const games = Number(gamesArg || 200), W = Math.min(Number(workersArg || 14), os.cpus().length);
  const t0 = Date.now(); const results = []; let next = 0, live = 0;
  const done = () => {
    const c = { strong: 0, weak: 0, draw: 0, unfinished: 0 }; results.forEach((r) => c[r.win]++);
    const decided = c.strong + c.weak;
    console.log(`\n${cfg.strong.join('-')} vs ${cfg.weak.join('-')}: ${results.length} games in ${Math.round((Date.now() - t0) / 1000)} s`);
    console.log(`  strong wins ${c.strong}, weak wins ${c.weak}, draws ${c.draw}, unfinished ${c.unfinished}  →  strong ${decided ? (100 * c.strong / decided).toFixed(1) : '-'}% of decided games`);
    const avg = results.filter((r) => r.turns).reduce((a, r) => a + r.turns, 0) / Math.max(1, results.filter((r) => r.turns).length);
    console.log(`  average match length: ${avg.toFixed(1)} turns`);
    const errs = results.flatMap((r) => r.errors || []); if (errs.length) console.log('  engine errors (first):', errs.slice(0, 3).map((e) => e.slice(0, 160)));
  };
  const spawn = () => {
    if (next >= games) { if (live === 0) done(); return; }
    const idx = next++; live++;
    const w = new Worker(__filename, { workerData: { cfg, idx } });
    w.on('message', (r) => { results.push(r); if (results.length % 20 === 0) process.stdout.write(`${results.length}..`); });
    w.on('error', (e) => { results.push({ win: 'unfinished', errors: [String(e && e.message)] }); });
    w.on('exit', () => { live--; spawn(); });
  };
  for (let i = 0; i < W; i++) spawn();
} else {
  parentPort.postMessage(playGame(workerData.cfg, workerData.idx));
}
