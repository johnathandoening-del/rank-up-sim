'use strict';
/* Record (or compare against) reference fingerprint traces: proves an engine change didn't alter any game.
 *   node tools/headless/reftrace.js record <file>   |   node tools/headless/reftrace.js check <file> */
const fs = require('fs');
const { createEngine } = require('./engine');
const { newMatch } = require('./match');
const nopaint = require('./nopaint');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CLASSES = require('./classes')();   // every class the game knows (the engine's registry)
const ZONES = ['rank', 'left-flank', 'right-flank', 'rear-flank'];
function nextInput(m, rnd) {
  const p = m.pending(), pick = (a) => a[Math.floor(rnd() * a.length)];
  if (p.kind === 'modal') return { t: 'modal', i: Math.floor(rnd() * Math.max(1, p.n)), s: p.owner };
  if (p.kind === 'pick') { const order = Array.from({ length: p.n }, (_, i) => i).sort(() => rnd() - 0.5); const want = p.np ? Math.max(1, Math.ceil(p.n / 2)) : Math.min(p.n, Math.max(p.min || 0, Math.floor(rnd() * ((p.max || 1) + 1)))); return { t: 'pick', ix: order.slice(0, want), ids: [], s: p.owner }; }
  if (p.kind !== 'turn') return null;
  const seat = p.owner, o = m.options(seat), opp = seat === 'player' ? 'ai' : 'player', r = rnd();
  if (p.mode === 'switchdraw') return r < 0.6 && o.hand.length ? { t: 'sd', id: pick(o.hand), first: false, s: seat } : { t: 'sdDone', first: true, s: seat };
  if (p.mode && p.mode !== 'normal') { if (r < 0.15) return { t: 'cancel', s: seat }; if (p.mode === 'atk' && o.field.length) return { t: 'zone', o: seat, z: pick(o.field), s: seat }; if (o.oppField.length && r < 0.85) return { t: 'zone', o: opp, z: pick(o.oppField), s: seat }; return { t: 'zone', o: seat, z: pick(ZONES), s: seat }; }
  if (p.phase === 'draw') return { t: 'adv', s: seat };
  if (r < 0.28 && o.hand.length) return { t: 'hand', id: pick(o.hand), s: seat };
  if (r < 0.36 && o.bank.length && ['main', 'standby', 'battle'].includes(p.phase)) return { t: 'startSkill', source: 'bank', id: pick(o.bank), s: seat };
  if (r < 0.42 && o.dead.length) return { t: 'areaFx', id: pick(o.dead), i: 0, s: seat };
  if (r < 0.55 && p.phase === 'battle') return { t: 'atkMode', s: seat };
  if (r < 0.60 && o.delta) return { t: 'delta', w: seat, s: seat };
  if (r < 0.95) return { t: 'adv', s: seat };
  return { t: 'end', s: seat };
}
function trace(seed, n) {
  const eng = createEngine({ seed }); nopaint.install(eng);
  const m = newMatch({ engine: eng, seed, cls0: CLASSES[seed % CLASSES.length], cls1: CLASSES[(seed * 7 + 2) % CLASSES.length], firstSeat: seed % 2 });
  const rnd = mulberry32(seed * 31337 + 1), out = [];
  for (let i = 0; i < n; i++) { const a = nextInput(m, rnd); if (!a) break; m.apply(a); out.push(m.sig()); if (m.pending().kind === 'over') break; }
  return out;
}
const [mode, file] = process.argv.slice(2);
const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], N = 2500;
if (mode === 'record') {
  const all = {}; SEEDS.forEach((s) => { all[s] = trace(s, N); });
  fs.writeFileSync(file, JSON.stringify(all)); console.log('recorded', SEEDS.length, 'games,', Object.values(all).reduce((a, t) => a + t.length, 0), 'fingerprints');
} else {
  const ref = JSON.parse(fs.readFileSync(file, 'utf8')); let ok = true;
  SEEDS.forEach((s) => { const t = trace(s, N), r = ref[s]; let d = -1; for (let i = 0; i < Math.max(t.length, r.length); i++) if (t[i] !== r[i]) { d = i; break; } if (d !== -1) ok = false; console.log('seed', s, t.length, 'fingerprints:', d === -1 ? 'IDENTICAL' : 'DIFFER at ' + d); });
  console.log(ok ? 'MATCHES REFERENCE' : 'CHANGED');
}
