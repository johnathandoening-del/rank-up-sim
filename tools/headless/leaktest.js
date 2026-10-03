'use strict';
/* Snapshot/restore leak test: from random quiet positions, play K inputs, rewind, replay the same K inputs — the
 * fingerprint after every input AND the complete game object at the end must be identical. Any rule state living
 * outside the snapshot (module variables, DOM, timers) shows up here as a difference.
 *   node tools/headless/leaktest.js [games=6] [checksPerGame=8] [K=60] */
const { createEngine } = require('./engine');
const { newMatch } = require('./match');
const nopaint = require('./nopaint');
const state = require('./state');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];
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
const games = Number(process.argv[2] || 6), checks = Number(process.argv[3] || 8), K = Number(process.argv[4] || 60);
let pass = 0, fail = 0, snaps = 0, restoreMs = 0, snapMs = 0;
for (let g = 0; g < games; g++) {
  const seed = 500 + g, eng = createEngine({ seed }); nopaint.install(eng); state.install(eng);
  const m = newMatch({ engine: eng, seed, cls0: CLASSES[(seed * 5) % 15], cls1: CLASSES[(seed * 3 + 1) % 15], firstSeat: seed % 2 });
  const rnd = mulberry32(seed + 77);
  let done = 0, steps = 0;
  while (done < checks && steps < 6000) {
    // advance a random number of inputs, then look for a quiet point
    const adv = 10 + Math.floor(rnd() * 40);
    for (let i = 0; i < adv; i++) { const a = nextInput(m, rnd); if (!a) break; m.apply(a); steps++; }
    if (m.pending().kind === 'over') break;
    if (!eng.run('__S.quiet()') || eng.pendingTimeouts() > 0) continue;
    let t = Date.now(); eng.run('globalThis.__snapA = __S.snap()'); snapMs += Date.now() - t; snaps++;
    const seq = [], sigA = [];
    for (let i = 0; i < K; i++) { const a = nextInput(m, rnd); if (!a) break; seq.push(a); m.apply(a); sigA.push(m.sig()); if (m.pending().kind === 'over') break; }
    const jsonA = eng.run('JSON.stringify(G)');
    t = Date.now(); eng.dropTimeouts(); eng.run('__S.restore(__snapA)'); restoreMs += Date.now() - t;
    const sigB = [];
    for (const a of seq) { m.apply(a); sigB.push(m.sig()); }
    const jsonB = eng.run('JSON.stringify(G)');
    let d = -1; for (let i = 0; i < Math.max(sigA.length, sigB.length); i++) if (sigA[i] !== sigB[i]) { d = i; break; }
    if (d === -1 && jsonA === jsonB) pass++;
    else {
      fail++;
      let at = -1; for (let i = 0; i < Math.min(jsonA.length, jsonB.length); i++) if (jsonA[i] !== jsonB[i]) { at = i; break; }
      console.log(`LEAK seed ${seed} check ${done}: fingerprints ${d === -1 ? 'same' : 'differ at input ' + d + ' (' + JSON.stringify(seq[d]) + ')'}; G json ${jsonA === jsonB ? 'same' : 'differs near: …' + jsonA.slice(Math.max(0, at - 120), at + 80) + '…  vs  …' + jsonB.slice(Math.max(0, at - 120), at + 80) + '…'}`);
    }
    done++;
  }
  if (eng.errors.length) console.log('engine errors seed', seed, eng.errors.slice(0, 3).map((e) => e.slice(0, 160)));
}
console.log(`\n${pass} restore checks identical, ${fail} differed (${snaps} snapshots; avg snapshot ${(snapMs / Math.max(1, snaps)).toFixed(2)} ms, restore ${(restoreMs / Math.max(1, snaps)).toFixed(2)} ms)`);
