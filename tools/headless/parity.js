'use strict';
/* Parity: the same seeds + the same input choices, once with the full painting engine and once in no-paint mode.
 * Every per-input state fingerprint must be identical — that proves no-paint mode plays exactly the real game.
 *   node tools/headless/parity.js [games=3] [inputsPerGame=1500] */
const { createEngine } = require('./engine');
const { newMatch } = require('./match');
const nopaint = require('./nopaint');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CLASSES = require('./classes')();   // every class the game knows (the engine's registry)
const ZONES = ['rank', 'left-flank', 'right-flank', 'rear-flank'];

function nextInput(m, rnd) {
  const p = m.pending(), pick = (a) => a[Math.floor(rnd() * a.length)];
  if (p.kind === 'modal') return { t: 'modal', i: Math.floor(rnd() * Math.max(1, p.n)), s: p.owner };
  if (p.kind === 'pick') {
    const order = Array.from({ length: p.n }, (_, i) => i).sort(() => rnd() - 0.5);
    const want = p.np ? Math.max(1, Math.ceil(p.n / 2)) : Math.min(p.n, Math.max(p.min || 0, Math.floor(rnd() * ((p.max || 1) + 1))));
    return { t: 'pick', ix: order.slice(0, want), ids: [], s: p.owner };
  }
  if (p.kind !== 'turn') return null;
  const seat = p.owner, o = m.options(seat), opp = seat === 'player' ? 'ai' : 'player', r = rnd();
  if (p.mode === 'switchdraw') return r < 0.6 && o.hand.length ? { t: 'sd', id: pick(o.hand), first: false, s: seat } : { t: 'sdDone', first: true, s: seat };
  if (p.mode && p.mode !== 'normal') {
    if (r < 0.15) return { t: 'cancel', s: seat };
    if (p.mode === 'atk' && o.field.length) return { t: 'zone', o: seat, z: pick(o.field), s: seat };
    if (o.oppField.length && r < 0.85) return { t: 'zone', o: opp, z: pick(o.oppField), s: seat };
    return { t: 'zone', o: seat, z: pick(ZONES), s: seat };
  }
  if (p.phase === 'draw') return { t: 'adv', s: seat };
  if (r < 0.28 && o.hand.length) return { t: 'hand', id: pick(o.hand), s: seat };
  if (r < 0.36 && o.bank.length && ['main', 'standby', 'battle'].includes(p.phase)) return { t: 'startSkill', source: 'bank', id: pick(o.bank), s: seat };
  if (r < 0.42 && o.dead.length) return { t: 'areaFx', id: pick(o.dead), i: 0, s: seat };
  if (r < 0.55 && p.phase === 'battle') return { t: 'atkMode', s: seat };
  if (r < 0.60 && o.delta) return { t: 'delta', w: seat, s: seat };
  if (r < 0.95) return { t: 'adv', s: seat };
  return { t: 'end', s: seat };
}

function play(seed, c0, c1, n, noPaint) {
  const eng = createEngine({ seed });
  if (noPaint) nopaint.install(eng);
  const m = newMatch({ engine: eng, seed, cls0: c0, cls1: c1, firstSeat: seed % 2 });
  const rnd = mulberry32(seed * 104729 + 7), trace = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const a = nextInput(m, rnd); if (!a) break;
    m.apply(a); trace.push(m.sig());
    if (m.pending().kind === 'over') break;
  }
  return { trace, ms: Date.now() - t0, winner: m.winner(), turn: m.turnNo(), errors: eng.errors.slice(0, 4) };
}

const games = Number(process.argv[2] || 3), n = Number(process.argv[3] || 1500);
let allSame = true;
for (let g = 0; g < games; g++) {
  const seed = 101 + g, c0 = CLASSES[(seed * 3) % CLASSES.length], c1 = CLASSES[(seed * 11 + 5) % CLASSES.length];
  const full = play(seed, c0, c1, n, false), fast = play(seed, c0, c1, n, true);
  let firstDiff = -1; const len = Math.min(full.trace.length, fast.trace.length);
  for (let i = 0; i < len; i++) if (full.trace[i] !== fast.trace[i]) { firstDiff = i; break; }
  const same = firstDiff === -1 && full.trace.length === fast.trace.length;
  allSame = allSame && same;
  console.log(`seed ${seed} ${c0} vs ${c1}: ${full.trace.length} inputs, turn ${full.turn}, winner ${full.winner} | paint ${full.ms} ms vs no-paint ${fast.ms} ms (${(full.ms / Math.max(1, fast.ms)).toFixed(1)}x) | ${same ? 'IDENTICAL' : 'DIFFER at input ' + firstDiff}`);
  if (full.errors.length || fast.errors.length) console.log('   errors:', full.errors.concat(fast.errors).map((e) => e.slice(0, 160)).join(' || '));
}
console.log(allSame ? '\nPARITY OK: no-paint mode plays the identical game.' : '\nPARITY FAILED');
