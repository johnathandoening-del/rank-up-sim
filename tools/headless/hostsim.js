'use strict';
/* The page ↔ bot-worker protocol, simulated end to end: one engine plays the PAGE (a solo match under the lockstep
 * rules, bot seats input-driven — exactly what index.html builds), a second engine plays the WORKER (it only ever
 * restores the page's last quiet position, replays the inputs since and plans). Checks every request: the worker's
 * rebuilt position must equal the page's, and every bot input must be applied. A regression test for ai/host.js +
 * ai/worker.js without a browser.
 *   node tools/headless/hostsim.js [games=4] [tierA=basic-1] [tierB=basic-1] */
const { createEngine } = require('./engine');
const { newMatch } = require('./match');
const nopaint = require('./nopaint');
const brain = require('./brain');
const { planOpts } = require('../../ai/tiers');
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];

function game(g, tierA, tierB) {
  const seed = process.env.SEED ? Number(process.env.SEED) : 31000 + g * 17, c0 = process.env.CLS0 || CLASSES[(g * 4 + 1) % 15], c1 = process.env.CLS1 || CLASSES[(g * 9 + 6) % 15];
  const page = createEngine({ seed }); nopaint.install(page);
  // MODE=1v1v1 / royale4: three or four bot seats in a turn order drawn from the game number
  const mode = process.env.MODE || null, seatList = mode === 'royale4' ? ['player', 'ai', 'ai2', 'ai3'] : mode === '1v1v1' ? ['player', 'ai', 'ai2'] : null;
  const classes = seatList ? Object.fromEntries(seatList.map((w, i) => [w, CLASSES[(g * 4 + 1 + i * 5) % 15]])) : null;
  const order = seatList ? seatList.slice().sort((a, b) => ((a.charCodeAt(a.length - 1) * (g + 3)) % 7) - ((b.charCodeAt(b.length - 1) * (g + 3)) % 7)) : null;
  const bots = seatList ? Object.fromEntries(seatList.map((w) => [w, w === 'player' ? tierA : tierB])) : { player: tierA, ai: tierB };
  newMatch({ engine: page, seed, cls0: classes ? classes.player : c0, cls1: classes ? classes.ai : c1, firstSeat: process.env.FIRST != null ? Number(process.env.FIRST) : g % 2,
    solo: { bots }, mode: mode || undefined, order: order || undefined, classes: classes || undefined });
  if (seatList) console.log(`  ${mode}: order ${order.join(' > ')}, classes ${seatList.map((w) => classes[w]).join('/')}`);
  brain.install(page);                                  // (the page uses only __S / __M read-only helpers from it)
  const worker = createEngine({ seed: 1 }); nopaint.install(worker); brain.install(worker);
  // the page's bookkeeping (host.js): last quiet position before an input + the inputs since
  let anchor = null, path = [];
  const snap = () => {
    const fns = page.run(`(function(){ var out = []; (function walk(v, p, seen){ if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v); for (var k in v) { if (typeof v[k] === 'function') out.push(p + '.' + k); else walk(v[k], p + '.' + k, seen); } })(G, 'G', new Set()); return out; })()`);
    if (fns.length && !snap.told) { snap.told = 1; console.log('  functions inside G at a quiet point:', fns.slice(0, 5)); }
    return page.run('__S.snap()');    // the same copy the page's host makes (ai/state.js: functions skipped, shared references kept)
  };
  const note = (a) => { if (!anchor || page.run('__S.quiet()')) { anchor = snap(); path = [a]; } else path.push(a); };
  const t0 = Date.now(); let inputs = 0, mism = 0, slow = 0;
  for (let steps = 0; steps < 4000; steps++) {
    const d = page.run('__M.decider()');
    if (d.kind === 'over' || d.kind === 'none') break;
    const tier = bots[d.seat] || tierB;
    if (!anchor) { anchor = snap(); path = []; }
    // the worker: restore + replay + plan
    const tw = Date.now();
    worker.ctx.__anchor = anchor; worker.ctx.__path = path;
    worker.run('__S.restore({ G: __anchor.G, rng: __anchor.rng, cq: __anchor.cq || [] }); __dropTimeouts(); __B.noteApplied(null)');
    for (const a of path) { worker.run('ruCanApplyNow({}); ruApplyAction(' + JSON.stringify(a) + ')'); worker.settle(10000); worker.run('__B.noteApplied(' + JSON.stringify(a) + ')'); }
    const wsig = worker.run('ruStateSig()'), psig = page.run('ruStateSig()');
    worker.run('ruCanApplyNow({})'); const moveSig = worker.run('ruStateSig()');     // the bot decides after the pre-input checkpoint
    if (wsig !== psig) {
      mism++;
      if (mism <= 2) {
        console.log(`  game ${g} step ${steps}: the worker rebuilt a different position (page ${psig}, worker ${wsig}); path ${path.map((a) => JSON.stringify(a)).join(' ')}`);
        const J = (e) => JSON.parse(e.run('JSON.stringify(G)')), out = [];
        (function diff(a, b, p) { if (out.length > 12 || a === b) return; if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) { out.push(p + ': page ' + JSON.stringify(a) + ' | worker ' + JSON.stringify(b)); return; }
          new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => diff(a[k], b[k], p + '.' + k)); })(J(page), J(worker), 'G');
        const extra = (e) => e.run('JSON.stringify({ mode: G.mode, SF: !!(typeof SF !== "undefined" && SF), cq: (window._RUcq||[]).length, mq: (typeof _modalQueue !== "undefined" ? _modalQueue.length : -1), modal: document.getElementById("modal").classList.contains("open"), picker: document.getElementById("picker-modal").classList.contains("open"), settle: window.ruSettlePending && ruSettlePending() })');
        console.log('    G differences:', out.length ? out : '(none: the difference is outside G)');
        console.log('    page  ', extra(page));
        console.log('    worker', extra(worker));
      }
    }
    const opts = Object.assign(planOpts(tier, page.run('G._turnNo||0'), seed ^ (d.seat === 'player' ? 0x51 : 0xA7)), { seed: (seed * 31 + steps) >>> 0 });
    const r = worker.run('__B.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(opts) + ')');
    const ms = Date.now() - tw; if (ms > 30000) { slow++; console.log(`  game ${g} step ${steps}: worker took ${ms} ms`); }
    const move = r && r.move; if (!move) { console.log(`  game ${g} step ${steps}: no move (${r && r.why})`); break; }
    const a = Object.assign({}, move, { s: d.seat, sig: moveSig });
    if (process.env.TRACE_STEP && steps === Number(process.env.TRACE_STEP)) console.log('  TRACE', JSON.stringify(d), 'quiet', page.run('__S.quiet()'), page.run('JSON.stringify({ modalOpen: document.getElementById("modal").classList.contains("open"), owner: document.getElementById("modal")._ruOwner, stash: !!document.getElementById("modal")._ruStash, mq: _modalQueue.length, SF: !!SF, title: document.getElementById("m-title").textContent })'), 'move', JSON.stringify(move));
    // the page (host.js): settle, the host's copy, the pre-input checkpoint (which must reach the bot's position), the input
    page.run('ruSettleNow()'); note(a);
    if (!page.run('ruCanApplyNow(' + JSON.stringify(a) + ')')) { mism++; console.log(`  game ${g} step ${steps}: the page's checkpoint did not reach the bot's position`); }
    page.run('ruApplyAction(' + JSON.stringify(a) + ')'); page.settle(10000); inputs++;
    const errs = page.errors.length + worker.errors.length;
    if (errs) { console.log(`  game ${g} step ${steps}: errors`, page.errors.concat(worker.errors).slice(0, 3)); page.errors.length = 0; worker.errors.length = 0; }
  }
  const res = page.run('({ over: !!G.gameOver, w: G.__winner || null, t: G._turnNo || 0, out: Object.keys(G.eliminated || {}) })');
  if (seatList) console.log(`  eliminated: ${res.out.join(', ') || '-'}`);
  console.log(`game ${g} ${c0} vs ${c1}: ${res.over ? 'winner ' + res.w : 'UNFINISHED'} turn ${res.t}, ${inputs} inputs, ${mism} mismatches, ${Math.round((Date.now() - t0) / 1000)} s`);
  return { mism, over: res.over };
}

const [n, tA, tB] = process.argv.slice(2);
let bad = 0;
for (let g = 0; g < Number(n || 4); g++) { const r = game(g, tA || 'basic-1', tB || 'basic-1'); if (r.mism || !r.over) bad++; }
console.log(bad ? `\n${bad} game(s) with problems` : '\nOK: the worker always rebuilt the page\'s exact position and every game finished');
process.exitCode = bad ? 1 : 0;
