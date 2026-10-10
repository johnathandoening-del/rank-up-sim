'use strict';
/* Smoke test: play complete matches on the headless engine with a RANDOM input driver (both seats), checking that
 * whole games run, how fast, and that the same seeds give the same game (determinism).
 *   node tools/headless/smoke.js [games=5] [seed=1] */
const { newMatch } = require('./match');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ZONES = ['rank', 'left-flank', 'right-flank', 'rear-flank'];

function randomInput(m, rnd) {
  const pend = m.pending();
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  if (pend.kind === 'modal') return { t: 'modal', i: Math.floor(rnd() * Math.max(1, pend.n)), s: pend.owner };
  if (pend.kind === 'pick') {
    const n = pend.n, want = Math.min(n, Math.max(pend.min || 0, Math.floor(rnd() * ((pend.max || 1) + 1))));
    const ix = []; const order = Array.from({ length: n }, (_, i) => i).sort(() => rnd() - 0.5);
    for (let i = 0; i < order.length && ix.length < (pend.np ? n : want); i++) ix.push(order[i]);
    return { t: 'pick', ix: pend.np ? ix.slice(0, Math.max(1, Math.ceil(n / 2))) : ix, ids: [], s: pend.owner };
  }
  if (pend.kind !== 'turn') return null;
  const seat = pend.owner, o = m.options(seat), opp = seat === 'player' ? 'ai' : 'player', r = rnd();
  if (pend.mode === 'switchdraw') return r < 0.6 && o.hand.length ? { t: 'sd', id: pick(o.hand), first: false, s: seat } : { t: 'sdDone', first: true, s: seat };
  if (pend.mode === 'atk' || pend.mode === 'addon' || (pend.mode && pend.mode !== 'normal')) {
    if (r < 0.15) return { t: 'cancel', s: seat };
    if (pend.mode === 'atk' && o.field.length) return { t: 'zone', o: seat, z: pick(o.field), s: seat };
    if (o.oppField.length && r < 0.85) return { t: 'zone', o: opp, z: pick(o.oppField), s: seat };
    return { t: 'zone', o: seat, z: pick(ZONES), s: seat };
  }
  const ph = pend.phase;
  if (ph === 'draw') return { t: 'adv', s: seat };
  if (r < 0.30 && o.hand.length) return { t: 'hand', id: pick(o.hand), s: seat };
  if (r < 0.40 && o.bank.length && ['main', 'standby', 'battle'].includes(ph)) return { t: 'startSkill', source: 'bank', id: pick(o.bank), s: seat };
  if (r < 0.47 && o.dead.length) return { t: 'areaFx', id: pick(o.dead), i: 0, s: seat };
  if (r < 0.60 && ph === 'battle') return { t: 'atkMode', s: seat };
  if (r < 0.66 && o.delta) return { t: 'delta', w: seat, s: seat };
  if (r < 0.93) return { t: 'adv', s: seat };
  return { t: 'end', s: seat };
}

function playOne(seed, cls0, cls1) {
  const rnd = mulberry32(seed * 7919 + 13);
  const m = newMatch({ seed, cls0, cls1, firstSeat: seed % 2, rngSeed: seed });
  let steps = 0, stale = 0, lastSig = '';
  const trace = [];
  while (steps < 4000) {
    const pend = m.pending();
    if (pend.kind === 'over' || pend.kind === 'none') break;
    const a = randomInput(m, rnd); if (!a) break;
    m.apply(a); steps++;
    const s = m.sig(); trace.push(s);
    if (s === lastSig) { if (++stale > 300) break; } else { stale = 0; lastSig = s; }
  }
  return { steps, winner: m.winner(), turns: m.turnNo(), finalSig: m.sig(), errors: m.eng.errors.slice(0, 6), trace };
}

const games = Number(process.argv[2] || 5), base = Number(process.argv[3] || 1);
const CLASSES = require('./classes')();   // every class the game knows (the engine's registry)
const t0 = Date.now();
let totalSteps = 0, finished = 0;
for (let g = 0; g < games; g++) {
  const seed = base + g, c0 = CLASSES[seed % CLASSES.length], c1 = CLASSES[(seed * 7 + 3) % CLASSES.length];
  const t = Date.now(), r = playOne(seed, c0, c1);
  totalSteps += r.steps; if (r.winner) finished++;
  console.log(`game ${seed} ${c0} vs ${c1}: ${r.steps} inputs, turn ${r.turns}, winner=${r.winner}, ${Date.now() - t} ms` + (r.errors.length ? `\n   errors: ${r.errors.map((e) => e.slice(0, 200)).join('\n           ')}` : ''));
  if (g === 0) {   // determinism: replay the same game, compare every fingerprint
    const again = playOne(seed, c0, c1);
    const same = again.trace.length === r.trace.length && again.trace.every((s, i) => s === r.trace[i]);
    console.log(`   determinism (same seed twice): ${same ? 'IDENTICAL' : 'DIFFERENT'} (${r.trace.length} vs ${again.trace.length} fingerprints)`);
  }
}
const ms = Date.now() - t0;
console.log(`\n${games} games, ${finished} finished with a winner, ${totalSteps} inputs in ${ms} ms (${Math.round(totalSteps / (ms / 1000))} inputs/s)`);
