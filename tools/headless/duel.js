'use strict';
/* Duel: two policies play complete matches on the real engine through the human input layer.
 * Policies: 'random' (a random legal move) | 'brain' (the thinking bot; options via JSON).
 *   node tools/headless/duel.js <games> '<policyA json>' '<policyB json>'
 *   e.g. node tools/headless/duel.js 10 '{"kind":"brain","N":1}' '{"kind":"random"}'          */
const { createEngine } = require('./engine');
const { newMatch } = require('./match');
const nopaint = require('./nopaint');
const brain = require('./brain');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CLASSES = require('./classes')();   // every class the game knows (the engine's registry)

function playMatch(seed, polA, polB, opts) {
  opts = opts || {};
  const eng = createEngine({ seed }); nopaint.install(eng);
  const aSeat = seed % 2 === 0 ? 'player' : 'ai';                  // alternate seats
  const c0 = opts.cls0 || CLASSES[(seed * 7) % CLASSES.length], c1 = opts.cls1 || CLASSES[(seed * 11 + 3) % CLASSES.length];
  const m = newMatch({ engine: eng, seed, cls0: c0, cls1: c1, firstSeat: Math.floor(seed / 2) % 2 });
  brain.install(eng);
  eng.run('__B.noteApplied(null)');
  const rnd = mulberry32(seed * 977 + 5);
  const stats = { A: { decisions: 0, ms: 0, evals: 0 }, B: { decisions: 0, ms: 0, evals: 0 } };
  let steps = 0;
  while (steps < 5000) {
    const d = eng.run('__M.decider()');
    if (d.kind === 'over' || d.kind === 'none') break;
    const who = d.seat === aSeat ? 'A' : 'B', pol = who === 'A' ? polA : polB;
    let move = null; const t0 = Date.now();
    if (pol.kind === 'random') {
      const L = eng.run('__M.legal(' + JSON.stringify(d.seat) + ')');
      if (!L.length) break;
      move = L[Math.floor(rnd() * L.length)];
      const adv = L.find((x) => x.t === 'adv' || x.t === 'sdDone'); if (adv && rnd() < 0.3) move = adv;
    } else {
      const r = eng.run('__B.plan(' + JSON.stringify(d.seat) + ',' + JSON.stringify(Object.assign({ seed: seed * 31 + steps }, pol)) + ')');
      if (!r || !r.move) break;
      move = r.move; stats[who].evals += r.evals || 0;
    }
    stats[who].ms += Date.now() - t0; stats[who].decisions++;
    eng.run('__H.apply(' + JSON.stringify(move) + ')'); eng.settle(10000);
    eng.run('__B.noteApplied(' + JSON.stringify(move) + ')');
    steps++;
  }
  const w = eng.run('G.__winner || null');
  return { winner: w === aSeat ? 'A' : (w && w !== 'draw' ? 'B' : (w || 'none')), turns: eng.run('G._turnNo||0'), cls: [c0, c1], aSeat, steps, stats, errors: eng.errors.slice(0, 3) };
}

if (require.main === module) {
  const games = Number(process.argv[2] || 4);
  const polA = JSON.parse(process.argv[3] || '{"kind":"brain","N":1}'), polB = JSON.parse(process.argv[4] || '{"kind":"random"}');
  let a = 0, b = 0, other = 0;
  for (let g = 0; g < games; g++) {
    const t = Date.now(), r = playMatch(4000 + g, polA, polB);
    if (r.winner === 'A') a++; else if (r.winner === 'B') b++; else other++;
    const per = (s) => s.decisions ? `${(s.ms / s.decisions).toFixed(0)} ms/decision, ${s.decisions} decisions` : '-';
    console.log(`game ${g}: ${r.cls[0]} vs ${r.cls[1]} (A=${r.aSeat}) → ${r.winner} in ${r.turns} turns, ${Math.round((Date.now() - t) / 1000)} s | A ${per(r.stats.A)} | B ${per(r.stats.B)}` + (r.errors.length ? ' | errors: ' + r.errors.join(' || ').slice(0, 200) : ''));
  }
  console.log(`\nA wins ${a}, B wins ${b}, other ${other}`);
}
module.exports = { playMatch };
