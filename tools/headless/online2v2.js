'use strict';
/* 2v2 online, end to end:
 *  1. the room server: the creator's mode makes a four-seat room; joiners are seated by role — the first opponent C,
 *     the next D, the partner B — and every seat receives a four-seat 'start';
 *  2. lockstep: four clients built from that 'start' exactly as net.js builds them (one per seat) apply the same input
 *     stream and stay identical (state signature compared after every input) through a random match.
 *   node tools/headless/online2v2.js [mode=team2v2] [steps=1500]      (needs the server's `ws` package: NODE_PATH) */
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');
const { createEngine } = require('./engine');
const { MATCH_CODE } = require('../../ai/match');

const MODE = process.argv[2] || 'team2v2', STEPS = Number(process.argv[3] || 1500);
const PORT = 8900 + Math.floor(Math.random() * 80);
const ENGINE_SEATS = ['player', 'ai', 'ai2', 'ai3'];

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [path.join(__dirname, '../../server/room-server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => { if (/listening/.test(String(d))) resolve(srv); });
    srv.stderr.on('data', (d) => process.stderr.write(d));
    srv.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}
function client(name, cls, extra) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT), c = { name, ws, joined: null, start: null };
    ws.on('open', () => ws.send(JSON.stringify(Object.assign({ type: 'join', room: 'T2V2', name, cls, deltaDeck: [], evo: true, clientId: 'cid-' + name }, extra || {}))));
    ws.on('message', (buf) => {
      const m = JSON.parse(String(buf));
      if (m.type === 'joined') { c.joined = m; resolve(c); }
      if (m.type === 'loadout-request') ws.send(JSON.stringify({ type: 'loadout', cls, deltaDeck: [], evo: true }));
      if (m.type === 'start') c.start = m;
      if (m.type === 'error') { c.error = m.msg; resolve(c); }
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// what net.js builds from a 'start' for a 2v2 room
function netConfig(cfg, mySeat) {
  const byEngine = (arr, dflt) => { const o = {}; ENGINE_SEATS.forEach((w, i) => { o[w] = (arr && arr[i] != null) ? arr[i] : dflt; }); return o; };
  const cyc = ['player', 'ai2', 'ai3', 'ai'], k = cyc.indexOf(ENGINE_SEATS[(cfg.firstSeat || 0) % 4]);
  return { seed: cfg.seed, mySeat, spectator: false, seat0Class: cfg.seat0Class, seat1Class: cfg.seat1Class, firstSeat: cfg.firstSeat,
    name0: cfg.name0, name1: cfg.name1, allowEvolutions: cfg.allowEvolutions !== false, timeControl: cfg.timeControl,
    mode: cfg.mode, order: cyc.slice(k).concat(cyc.slice(0, k)), classes: byEngine(cfg.classes, 'light'), names: byEngine(cfg.names, null),
    deltaDecks: byEngine(cfg.deltaDecks, []), areaSupports: byEngine(cfg.areaSupports, null), actionSupports: byEngine(cfg.actionSupports, null) };
}

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ZONES = ['rank', 'left-flank', 'right-flank', 'rear-flank'];
function randomInput(e, rnd) {
  const pend = e.run('__H.pending()'), pick = (a) => a[Math.floor(rnd() * a.length)];
  if (pend.kind === 'modal') return { t: 'modal', i: Math.floor(rnd() * Math.max(1, pend.n)), s: pend.owner };
  if (pend.kind === 'pick') {
    const n = pend.n, want = Math.min(n, Math.max(pend.min || 0, Math.floor(rnd() * ((pend.max || 1) + 1))));
    const ix = [], order = Array.from({ length: n }, (_, i) => i).sort(() => rnd() - 0.5);
    for (let i = 0; i < order.length && ix.length < (pend.np ? n : want); i++) ix.push(order[i]);
    return { t: 'pick', ix: pend.np ? ix.slice(0, Math.max(1, Math.ceil(n / 2))) : ix, ids: [], s: pend.owner };
  }
  if (pend.kind !== 'turn') return null;
  const seat = pend.owner, o = e.run('__H.options(' + JSON.stringify(seat) + ')'), r = rnd();
  if (pend.mode === 'switchdraw') return r < 0.6 && o.hand.length ? { t: 'sd', id: pick(o.hand), first: false, s: seat } : { t: 'sdDone', first: true, s: seat };
  if (pend.mode && pend.mode !== 'normal') {
    if (r < 0.15) return { t: 'cancel', s: seat };
    if (pend.mode === 'atk' && o.field.length) return { t: 'zone', o: seat, z: pick(o.field), s: seat };
    return { t: 'zone', o: pick(ENGINE_SEATS), z: pick(ZONES), s: seat };
  }
  const ph = pend.phase;
  if (ph === 'draw') return { t: 'adv', s: seat };
  if (r < 0.30 && o.hand.length) return { t: 'hand', id: pick(o.hand), s: seat };
  if (r < 0.40 && o.bank.length && ['main', 'standby', 'battle'].includes(ph)) return { t: 'startSkill', source: 'bank', id: pick(o.bank), s: seat };
  if (r < 0.55 && ph === 'battle') return { t: 'atkMode', s: seat };
  if (r < 0.93) return { t: 'adv', s: seat };
  return { t: 'end', s: seat };
}

(async () => {
  const srv = await startServer();
  try {
    // 1. seating by role, in a scrambled join order (the partner joins before the opponents)
    const a = await client('Ann', 'light', { mode: MODE });
    const b = await client('Bea', 'inferno', { role: 'partner' });
    const c = await client('Cal', 'zero', { role: 'opponent' });
    const d = await client('Dee', 'shadow', { role: 'opponent' });
    const extra = await client('Eve', 'light', { role: 'opponent' });
    assert.deepStrictEqual([a.joined.seatIdx, b.joined.seatIdx, c.joined.seatIdx, d.joined.seatIdx], [0, 3, 1, 2], 'seats: A=0, C=1, D=2, B=3 by role');
    assert.ok(/No opponent seat/.test(extra.error || ''), 'a third opponent is refused');
    for (let i = 0; i < 40 && ![a, b, c, d].every((x) => x.start); i++) await wait(100);
    const starts = [a, b, c, d].map((x) => x.start);
    assert.ok(starts.every(Boolean), 'every seat receives a start');
    starts.forEach((s, i) => { assert.strictEqual(s.size, 4); assert.strictEqual(s.mode, MODE); assert.strictEqual(s.mySeat, [0, 3, 1, 2][i]); });
    assert.deepStrictEqual(starts[0].classes, ['light', 'zero', 'shadow', 'inferno'], 'classes by seat index (A, C, D, B)');
    console.log(`server: seats by role OK; start ${MODE} seed ${starts[0].seed} firstSeat ${starts[0].firstSeat}`);

    // 2. four clients from that start, in lockstep
    const engines = [0, 1, 2, 3].map((mySeat) => {
      const e = createEngine({ seed: 7 }); e.run(MATCH_CODE);
      e.run('__H.start(' + JSON.stringify(netConfig(starts[0], mySeat)) + ')'); e.settle(10000);
      return e;
    });
    const local = engines.map((e) => e.run('G._localSeat'));
    assert.deepStrictEqual(local, ['player', 'ai', 'ai2', 'ai3'], 'each client plays its own seat');
    assert.strictEqual(engines[0].run('G.twoVtwo'), MODE === 'tag2v2' ? 'tag' : 'team');
    const rnd = mulberry32(starts[0].seed);
    let steps = 0, splits = 0;
    for (; steps < STEPS; steps++) {
      const p0 = engines[0].run('__H.pending()');
      if (p0.kind === 'over' || p0.kind === 'none') break;
      const inp = randomInput(engines[0], rnd); if (!inp) break;
      engines.forEach((e) => { e.run('__H.apply(' + JSON.stringify(inp) + ')'); e.settle(10000); });
      const sigs = engines.map((e) => e.run('__H.sig()'));
      if (sigs.some((x) => x !== sigs[0])) { splits++; console.log(`  step ${steps}: clients differ (${JSON.stringify(inp)})`); if (splits > 2) break; }
    }
    const errs = engines.reduce((n, e) => n + e.errors.length, 0);
    console.log(`lockstep: ${steps} inputs, turn ${engines[0].run('G._turnNo||0')}, winner=${engines[0].run('G.__winner||null')}, ${splits} split(s), ${errs} engine error(s)`);
    if (errs) console.log('  ' + engines[0].errors.concat(engines[1].errors).slice(0, 3).map((x) => String(x).slice(0, 200)).join('\n  '));
    console.log(splits || errs ? 'PROBLEMS' : 'OK');
    process.exitCode = splits || errs ? 1 : 0;
  } finally { srv.kill(); [].forEach(() => {}); setTimeout(() => process.exit(process.exitCode || 0), 200); }
})().catch((e) => { console.error(e); process.exit(1); });
