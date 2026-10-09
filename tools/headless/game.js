'use strict';
/* One headless match between two policies — the game loop the arena runs in its worker threads and replay.js runs to
 * look at one game again. A game is reproducible from its job (seed, classes, first seat, policies): the bots think in
 * fixed effort and draw their randomness from their own seeds.
 *   job:   { seed, cls0, cls1, firstSeat, aSeat, polA, polB, maxMs, evo }
 *   hooks: { onInput(info, eng) }  — after every input: { step, seat, who, turn, phase, prompt, move, plan, log } (+ engine)
 *          { explain(step, info) } — return true to have the bot also list every candidate it weighed at this step
 *          (thought again afresh, after the real decision; the game itself is not changed by it)
 * Policies: {"kind":"random"} | {"kind":"brain", N, worlds, width, evals, fixed, ...} | {"kind":"tier", key, scale};
 * any brain policy may name another bot version (brainFile: a module exporting BRAIN_CODE) or weights (weightsFile). */
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// One match. aSeat: which engine seat policy A plays. Returns the winner as 'A' | 'B' | 'draw' | 'unfinished'.
function play(job, hooks) {
  hooks = hooks || {};
  const { createEngine } = require('./engine');
  const { newMatch } = require('./match');
  const nopaint = require('./nopaint');
  const brain = require('./brain');
  const eng = createEngine({ seed: job.seed }); nopaint.install(eng);
  newMatch({ engine: eng, seed: job.seed, cls0: job.cls0, cls1: job.cls1, firstSeat: job.firstSeat, evo: job.evo });
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
  const wcache = {};
  const t0 = Date.now(), stat = { A: { n: 0, ms: 0 }, B: { n: 0, ms: 0 } };
  let steps = 0, last = '', stale = 0, stop = null;     // stop: why an unfinished game ended
  while (steps < 6000 && Date.now() - t0 < job.maxMs) {
    const d = eng.run('__M.decider()');
    if (d.kind === 'over' || d.kind === 'none') break;
    const who = d.seat === job.aSeat ? 'A' : 'B', pol = who === 'A' ? job.polA : job.polB;
    let move = null, r = null; const t = Date.now();
    if (pol.kind === 'random') {
      const L = eng.run('__M.legal(' + JSON.stringify(d.seat) + ')');
      if (!L.length) { stop = 'no legal move'; break; }
      move = L[Math.floor(rnd() * L.length)];
      const adv = L.find((x) => x.t === 'adv' || x.t === 'sdDone'); if (adv && rnd() < 0.3) move = adv;
    } else {
      // a tier policy turns into this turn's thinking settings (N with its occasional bump, worlds, width, effort, noise)
      const opts = pol.kind === 'tier' ? require('./tiers').planOpts(pol.key, eng.run('G._turnNo||0'), job.seed * 7 + (who === 'A' ? 1 : 2), pol.scale || 1, d) : pol;
      // each side thinks with its own evaluation weights (null = the built-in starting weights)
      const BN = brains[pol.brainFile || ''];
      eng.run(BN + '.setWeights(' + JSON.stringify(pol.weightsFile ? (wcache[pol.weightsFile] || (wcache[pol.weightsFile] = JSON.parse(require('fs').readFileSync(pol.weightsFile, 'utf8')))) : null) + ')');
      const o = Object.assign({ seed: job.seed * 31 + steps }, opts);
      r = eng.run(BN + '.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(o) + ')');
      if (!r || !r.move) { stop = 'no move: ' + (r && r.why); break; }
      move = r.move;
      if (hooks.explain && r.why === 'search' && hooks.explain(steps, { seat: d.seat, who, turn: eng.run('G._turnNo||0'), phase: eng.run('G.phase') })) {
        const x = eng.run(BN + '.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(Object.assign({}, o, { explain: true })) + ')');
        r = Object.assign({}, r, { ranked: x && x.ranked });
      }
    }
    stat[who].ms += Date.now() - t; stat[who].n++;
    const before = hooks.onInput ? { turn: eng.run('G._turnNo||0'), phase: eng.run('G.phase') } : null;
    if (hooks.onInput) eng.run('__logRing.length = 0');            // (the bot's own simulations wrote there too)
    eng.run('__H.apply(' + JSON.stringify(move) + ')'); eng.settle(10000);
    allB('.noteApplied(' + JSON.stringify(move) + ')');
    if (hooks.onInput) hooks.onInput({ step: steps, seat: d.seat, who, turn: before.turn, phase: before.phase, prompt: d.kind === 'modal' || d.kind === 'pick' ? d : null, move, plan: r, log: eng.run('__logRing.slice()') }, eng);
    steps++;
    const sg = eng.run('ruStateSig()'); if (sg === last) { if (++stale > 200) { stop = 'stuck: 200 inputs changed nothing (' + JSON.stringify(eng.run('__M.decider()')).slice(0, 160) + ')'; break; } } else { stale = 0; last = sg; }
  }
  if (!stop && steps >= 6000) stop = '6000 inputs'; else if (!stop && Date.now() - t0 >= job.maxMs) stop = 'time limit';
  const w = eng.run('G.__winner || null'), over = eng.run('!!G.gameOver');
  return { reason: eng.run('G.__reason || null'), mp: eng.run('[G.player.mp, G.ai.mp, G.player.cas, G.ai.cas, G.player.deck.length, G.ai.deck.length]'), stop: over ? null : stop, winner: !over ? 'unfinished' : w === job.aSeat ? 'A' : (w && w !== 'draw' ? 'B' : 'draw'), turns: eng.run('G._turnNo||0'), seed: job.seed, cls: [job.cls0, job.cls1], aSeat: job.aSeat, firstSeat: job.firstSeat, steps, stat, sec: Math.round((Date.now() - t0) / 1000), errors: eng.errors.slice(0, 2) };
}

// The arena's deals: deal k is the same seed, classes and first seat in every arena run.
function deal(k, clsA, clsB) { return { seed: 50000 + k * 13, cls0: clsA || CLASSES[(k * 7 + 3) % 15], cls1: clsB || CLASSES[(k * 11 + 5) % 15], firstSeat: k % 2 }; }

module.exports = { play, deal, CLASSES, mulberry32 };
