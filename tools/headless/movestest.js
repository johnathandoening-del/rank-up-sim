'use strict';
/* Move generation check: play random LEGAL moves through whole games; report legal-move counts by decision kind,
 * probe cost, and that probing never disturbs the game (the fingerprint before/after generating moves is equal). */
const { createEngine } = require('./engine');
const { newMatch } = require('./match');
const nopaint = require('./nopaint');
const moves = require('./moves');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];
const games = Number(process.argv[2] || 4);
const stats = {}; let disturbed = 0, probes = 0, probeMs = 0, totalMoves = 0;
for (let g = 0; g < games; g++) {
  const seed = 900 + g, eng = createEngine({ seed }); nopaint.install(eng);
  const m = newMatch({ engine: eng, seed, cls0: CLASSES[(seed * 2) % 15], cls1: CLASSES[(seed * 5 + 4) % 15], firstSeat: seed % 2 });
  moves.install(eng);
  const rnd = mulberry32(seed);
  let n = 0;
  while (n < 3000) {
    const d = eng.run('__M.decider()'); if (d.kind === 'over' || d.kind === 'none') break;
    const before = m.sig(); const t = Date.now();
    const L = eng.run('__M.legal()'); probeMs += Date.now() - t; probes++;
    if (m.sig() !== before) disturbed++;
    const key = d.kind === 'turn' ? d.kind + ':' + d.phase + (d.mode !== 'normal' ? '/' + d.mode : '') : d.kind;
    const s = stats[key] || (stats[key] = { n: 0, moves: 0, max: 0 }); s.n++; s.moves += L.length; s.max = Math.max(s.max, L.length);
    if (!L.length) { console.log('no legal moves at', JSON.stringify(d)); break; }
    // random legal move, mildly biased toward progress so games advance
    let a = L[Math.floor(rnd() * L.length)];
    const adv = L.find((x) => x.t === 'adv'); if (adv && rnd() < 0.35) a = adv;
    m.apply(a); n++; totalMoves++;
  }
  console.log(`game ${seed}: ${n} moves, turn ${m.turnNo()}, winner ${m.winner()}${eng.errors.length ? ', errors: ' + eng.errors.slice(0, 2).join(' || ').slice(0, 200) : ''}`);
}
console.log('\nlegal moves by decision type (avg / max):');
Object.keys(stats).sort().forEach((k) => console.log(`  ${k.padEnd(22)} ${(stats[k].moves / stats[k].n).toFixed(1).padStart(5)} / ${stats[k].max}   (${stats[k].n} decisions)`));
console.log(`\nprobe: ${(probeMs / probes).toFixed(1)} ms per decision; games disturbed by probing: ${disturbed} of ${probes} decisions`);
