'use strict';
/* Online rooms of every mode, and bots in the seats nobody takes — end to end on the real room server:
 *  1. a room is made for its creator's menu mode: Standard (and modes with no online table) 2 seats, 1v1v1 3, Royale 4,
 *     2v2 Tag / Team 4;
 *  2. bots: with two people in, the countdown starts (and starts again when someone else joins); when it runs out, bots —
 *     the creator's picks — take the empty seats and the match starts; only the bots' driver may send their inputs, and
 *     the room relays them to every client, the driver too;
 *  3. lockstep: the people's clients, built from that 'start' exactly as net.js builds them, apply the same input stream
 *     (the bots' inputs sent by the driver) and stay identical through a random match — Tag, Royale and 1v1v1.
 *   node tools/headless/online-bots.js [steps=900]      (needs the server's `ws` package: NODE_PATH) */
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');
const { createEngine } = require('./engine');
const { MATCH_CODE } = require('../../ai/match');

const STEPS = Number(process.argv[2] || 900);
const FILL_MS = 700;                                        // the server's bot countdown, shortened for the test
const PORT = 8980 + Math.floor(Math.random() * 15);
const ENGINE_SEATS = ['player', 'ai', 'ai2', 'ai3'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
function ok(c, m) { assert.ok(c, m); checks++; }
function eq(a, b, m) { assert.deepStrictEqual(a, b, m); checks++; }

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [path.join(__dirname, '../../server/room-server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), BOT_FILL_MS: String(FILL_MS) }), stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => { if (/listening/.test(String(d))) resolve(srv); });
    srv.stderr.on('data', (d) => process.stderr.write(d));
    srv.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}
// A client: joins, and keeps every message it gets.
function client(room, name, cls, extra) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT), c = { name, ws, msgs: [], joined: null, start: null, error: null };
    ws.on('open', () => ws.send(JSON.stringify(Object.assign({ type: 'join', room, name, cls, deltaDeck: [], evo: true, clientId: 'cid-' + room + '-' + name }, extra || {}))));
    ws.on('message', (d) => { const m = JSON.parse(String(d)); c.msgs.push(m);
      if (m.type === 'joined') { c.joined = m; resolve(c); }
      if (m.type === 'start') c.start = m;
      if (m.type === 'loadout-request') ws.send(JSON.stringify(Object.assign({ type: 'loadout', cls, deltaDeck: [], evo: true }, extra || {})));
      if (m.type === 'error') { c.error = m.msg; resolve(c); } });
  });
}
const got = (c, type) => c.msgs.filter((m) => m.type === type);
async function until(cond, ms) { for (let i = 0; i < (ms || 4000) / 50 && !cond(); i++) await wait(50); return cond(); }
const plan = (classes) => classes.map((cls, i) => (i === 0 || !cls) ? null : { cls, tier: 'basic-1', deltaDeck: [], areaSupport: null });

// what net.js builds from a 'start'
function netConfig(cfg, mySeat) {
  const n = cfg.size || 2, seats = ENGINE_SEATS.slice(0, n), f = (cfg.firstSeat || 0) % n;
  const byEngine = (arr, dflt) => { const o = {}; seats.forEach((w, i) => { o[w] = (arr && arr[i] != null) ? arr[i] : dflt; }); return o; };
  let order;
  if (cfg.mode === 'tag2v2' || cfg.mode === 'team2v2') { const cyc = ['player', 'ai2', 'ai3', 'ai'], k = cyc.indexOf(ENGINE_SEATS[f]); order = cyc.slice(k).concat(cyc.slice(0, k)); }
  else order = seats.slice(f).concat(seats.slice(0, f));
  const out = { seed: cfg.seed, mySeat, spectator: false, seat0Class: cfg.seat0Class, seat1Class: cfg.seat1Class, firstSeat: cfg.firstSeat,
    name0: cfg.name0, name1: cfg.name1, allowEvolutions: cfg.allowEvolutions !== false, timeControl: cfg.timeControl,
    mode: cfg.mode, order, classes: byEngine(cfg.classes, 'light'), names: byEngine(cfg.names, null),
    deltaDecks: byEngine(cfg.deltaDecks, []), areaSupports: byEngine(cfg.areaSupports, null), actionSupports: byEngine(cfg.actionSupports, null) };
  if ((cfg.bots || []).some(Boolean)) { out.netBots = {}; seats.forEach((w, i) => { if (cfg.bots[i]) out.netBots[w] = cfg.bots[i]; }); }
  return out;
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
    return { t: 'zone', o: pick(e.run('G.sideOrder')), z: pick(ZONES), s: seat };
  }
  const ph = pend.phase;
  if (ph === 'draw') return { t: 'adv', s: seat };
  if (r < 0.30 && o.hand.length) return { t: 'hand', id: pick(o.hand), s: seat };
  if (r < 0.55 && ph === 'battle') return { t: 'atkMode', s: seat };
  if (r < 0.93) return { t: 'adv', s: seat };
  return { t: 'end', s: seat };
}

// A started room's match, played by its people's clients: every input goes to the room from the seat that makes it — a
// bot's from the driver's socket, as the bot's seat — and each client applies the room's stream in order.
async function playLockstep(label, people, start) {
  const seatOf = (c) => c.joined.seatIdx;
  const engines = people.map((c) => { const e = createEngine({ seed: 7 }); e.run(MATCH_CODE); e.run('__H.start(' + JSON.stringify(netConfig(start, seatOf(c))) + ')'); e.settle(10000); return e; });
  const host = people.find((c) => seatOf(c) === start.botHost);
  ok(!!host, label + ': a person drives the bots');
  eq(engines.map((e) => e.run('Object.keys(G._botSeats||{}).sort()')).map(String), people.map(() => String(Object.keys(netConfig(start, 0).netBots || {}).sort())), label + ': every client seats the same bots');
  const rnd = mulberry32(start.seed);
  let steps = 0, splits = 0, botInputs = 0;
  people.forEach((c) => { c.relayed = []; c.ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'action') c.relayed.push(m); }); });
  for (; steps < STEPS; steps++) {
    const p0 = engines[0].run('__H.pending()');
    if (p0.kind === 'over' || p0.kind === 'none') break;
    const inp = randomInput(engines[0], rnd); if (!inp) break;
    const si = ENGINE_SEATS.indexOf(inp.s), bot = !!(start.bots || [])[si];
    const sender = bot ? host : people.find((c) => seatOf(c) === si);
    if (bot) {   // only the driver's socket sends it; the room relays it to every person (the driver included)
      const before = people.map((c) => c.relayed.length);
      sender.ws.send(JSON.stringify({ type: 'action', action: inp, as: si }));
      await until(() => people.every((c, i) => c.relayed.length > before[i]), 3000);
      const rel = people.map((c) => c.relayed[c.relayed.length - 1]);
      if (!rel.every((m) => m && m.from === 'player' + (si + 1))) { console.log(`  step ${steps}: the bot input was not relayed to everyone as its seat`); splits++; break; }
      botInputs++;
    } else if (sender) sender.ws.send(JSON.stringify({ type: 'action', action: inp }));
    engines.forEach((e) => { e.run('__H.apply(' + JSON.stringify(inp) + ')'); e.settle(10000); });
    const sigs = engines.map((e) => e.run('__H.sig()'));
    if (sigs.some((x) => x !== sigs[0])) { splits++; console.log(`  step ${steps}: clients differ (${JSON.stringify(inp)})`); if (splits > 2) break; }
  }
  const errs = engines.reduce((n, e) => n + e.errors.length, 0);
  console.log(`${label}: ${steps} inputs (${botInputs} by bots through the room), turn ${engines[0].run('G._turnNo||0')}, winner=${engines[0].run('G.__winner||null')}, ${splits} split(s), ${errs} engine error(s)`);
  if (errs) console.log('  ' + engines[0].errors.slice(0, 3).map((x) => String(x).slice(0, 200)).join('\n  '));
  ok(botInputs > 0, label + ': the bots played');
  return splits + errs;
}

(async () => {
  const srv = await startServer();
  let problems = 0;
  try {
    // 1. a room is made for its creator's menu mode
    for (const [mode, size] of [[null, 2], ['tournament', 2], ['1v1v1', 3], ['royale4', 4], ['tag2v2', 4], ['team2v2', 4]]) {
      const c = await client('SIZE' + (mode || 'STD').toUpperCase(), 'Ann', 'light', { mode });
      eq([c.joined.mode || null, c.joined.size], [size === 2 ? null : mode, size], 'a ' + (mode || 'Standard') + ' room has ' + size + ' seats');
      c.ws.close();
    }

    // 2. Tag: two people → countdown → bots in D and B (the creator's picks)
    const tagPlan = plan([null, 'zero', 'shadow', 'inferno']);
    const a = await client('TAGBOTS', 'Ann', 'light', { mode: 'tag2v2', botFill: true, bots: tagPlan });
    await wait(FILL_MS + 300);
    ok(!a.start && !got(a, 'bots-soon').length, 'tag: one person alone never starts a countdown');
    const c = await client('TAGBOTS', 'Cal', 'blizzard', { role: 'opponent' });
    eq(c.joined.seatIdx, 1, 'tag: the first opponent sits in C');
    await until(() => got(a, 'bots-soon').length && got(c, 'bots-soon').length, 2000);
    eq([got(a, 'bots-soon')[0].ms, got(a, 'bots-soon')[0].bots], [FILL_MS, 2], 'tag: two people in — the countdown for two bots starts on every client');
    await until(() => a.start && c.start, FILL_MS + 4000);
    ok(a.start && c.start, 'tag: the countdown ran out — the match started');
    eq(a.start.bots, [null, null, 'basic-1', 'basic-1'], 'tag: bots sit in D and B (the seats nobody took)');
    eq(a.start.classes, ['light', 'blizzard', 'shadow', 'inferno'], 'tag: the bots play the creator’s picks for D and B');
    eq([a.start.botHost, c.start.botHost], [0, 0], 'tag: the creator’s client drives the bots');
    // only the driver may send a bot's input
    const before = got(a, 'action').length;
    c.ws.send(JSON.stringify({ type: 'action', action: { t: 'adv' }, as: 2 }));
    await wait(300);
    eq(got(a, 'action').length, before, 'tag: a client that does not drive the bots cannot send a bot input');
    problems += await playLockstep('tag2v2 (2 people + 2 bots)', [a, c], a.start);
    a.ws.close(); c.ws.close();

    // a third person during the countdown starts it again; the match then has one bot
    const r1 = await client('ROYALE3', 'Ann', 'light', { mode: 'royale4', botFill: true, bots: plan([null, 'zero', 'shadow', 'kismet']) });
    const r2 = await client('ROYALE3', 'Bea', 'inferno');
    await until(() => got(r1, 'bots-soon').length, 2000);
    await wait(FILL_MS / 2);
    const r3 = await client('ROYALE3', 'Cy', 'temporal');
    await until(() => got(r1, 'bots-soon').length >= 2, 2000);
    eq(got(r1, 'bots-soon')[1].bots, 1, 'royale: a third person joined — the countdown starts again, for one bot');
    await until(() => r1.start && r2.start && r3.start, FILL_MS + 4000);
    eq(r1.start.bots, [null, null, null, 'basic-1'], 'royale: one bot, in the one seat nobody took');
    eq([r1.start.mode, r1.start.size], ['royale4', 4], 'royale: a four-seat Royale match');
    problems += await playLockstep('royale4 (3 people + 1 bot)', [r1, r2, r3], r1.start);
    [r1, r2, r3].forEach((x) => x.ws.close());

    // 1v1v1: two people and one bot
    const t1 = await client('THREEWAY', 'Ann', 'light', { mode: '1v1v1', botFill: true, bots: plan([null, 'zero', 'celestial']) });
    const t2 = await client('THREEWAY', 'Bea', 'ochre');
    await until(() => t1.start && t2.start, FILL_MS + 4000);
    eq([t1.start.size, t1.start.bots], [3, [null, null, 'basic-1']], '1v1v1: three seats, a bot in the third');
    problems += await playLockstep('1v1v1 (2 people + 1 bot)', [t1, t2], t1.start);
    [t1, t2].forEach((x) => x.ws.close());

    // no bots wanted: the room waits for people
    const n1 = await client('NOBOTS', 'Ann', 'light', { mode: 'team2v2', botFill: false });
    const n2 = await client('NOBOTS', 'Cal', 'zero', { role: 'opponent' });
    await wait(FILL_MS + 500);
    ok(!n1.start && !got(n1, 'bots-soon').length, 'team: without bots the room waits for four people');
    [n1, n2].forEach((x) => x.ws.close());

    console.log(`online rooms: ${checks} checks passed`);
  } catch (e) { console.error(e); problems++; }
  finally { srv.kill(); console.log(problems ? 'PROBLEMS' : 'OK'); setTimeout(() => process.exit(problems ? 1 : 0), 200); }
})();
