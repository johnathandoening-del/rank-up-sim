'use strict';
/* Bots in the page: a solo game is played under the same lockstep rules as an online game, and every bot seat is
 * driven exactly like a remote player — by inputs — which the thinking bot (worker.js, off the main thread)
 * chooses. Nothing in the engine makes a decision for a bot seat any more.
 *
 * The page keeps the last QUIET position of the game (a plain-data copy, taken before an input when nothing is
 * mid-way) and the inputs applied since; when a bot seat has to decide, both go to the worker, which rebuilds that
 * exact position in its own copy of the game and plans. The bot's input then comes back here and is applied through
 * the same input layer as anyone else's. The worker sees the same copy the page has, but the bot never reads the
 * hidden cards in it (they are re-dealt in every world it imagines).
 *
 *   RUBots.available()            can bots run here? (a Web Worker, served over http(s))
 *   RUBots.attach()               the game just built has bot seats (G._botSeats): start driving them
 *   RUBots.noteInput(a)           every input, before it is applied (the input layer calls this)
 */
(function () {
  if (window.RUBots || window.__headless) return;      // (also loaded inside the headless realms: nothing to do there)
  var lastDiv = null;
  var worker = null, ready = false, seq = 0, pending = null, timer = null, gameId = 0, failures = 0, lastSig = null, lastSeat = null, repeats = 0;
  var track = { anchor: null, path: [], game: 0 };
  var PACE = { plan: 750, search: 1200 };     // never faster than this between a bot's inputs (ms) — readable play

  function available() { return typeof Worker !== 'undefined' && /^https?:$/.test(location.protocol); }
  function base() { return location.href.replace(/[?#].*$/, '').replace(/[^\/]*$/, ''); }
  function say(msg, cls) { try { if (window.log) window.log(msg, cls || 'info'); } catch (e) {} }
  function soloGame() { return typeof G !== 'undefined' && G && G._soloNet && G._botSeats; }

  // The page uses the very same helpers the worker uses (ai/state.js, ai/moves.js), installed here read-only: the
  // quiet test, the position copy (plain data: functions skipped, shared references kept) and who decides now.
  function helpers() {
    if (!window.__S && window.RUAI && RUAI.STATE_CODE) (0, eval)(RUAI.STATE_CODE);
    if (!window.__M && window.RUAI && RUAI.MOVES_CODE) (0, eval)(RUAI.MOVES_CODE);
    return !!(window.__S && window.__M);
  }
  function quiet() { return window.__S.quiet(); }
  function decider() { return window.__M.decider(); }
  function snap() { return window.__S.snap(); }
  function copy(a) { try { return JSON.parse(JSON.stringify(a)); } catch (e) { return a; } }

  // Every input, before it is applied: the anchor is the position before the first input since the last quiet
  // point, the path is every input since.
  function noteInput(a) {
    if (!soloGame() || !a) return;
    if (track.game !== gameId || quiet()) { track.anchor = snap(); track.path = [copy(a)]; track.game = gameId; }
    else track.path.push(copy(a));
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('ai/worker.js');
    worker.onmessage = onMessage;
    worker.onerror = function (e) { console.error('[bots] worker error', e && e.message); say('The bot could not think (worker error). Reload the page to try again.', 'dmg'); };
    worker.postMessage({ type: 'init', base: base() });
    return worker;
  }

  function tierOf(seat) { return G && G._botSeats && G._botSeats[seat]; }
  function tick() {
    if (!soloGame()) { stop(); return; }
    if (G.gameOver || pending) return;
    if (window.ruInboxBusy && window.ruInboxBusy()) return;
    // (no waiting for the table to settle here: a continuation can be pending exactly BECAUSE a bot's prompt is open —
    // the next Casualty Draw waits for this one's answer. The input itself is applied through ruCanApplyNow, which
    // settles first, like an online player's input.)
    var d = decider();
    if (d.kind === 'over' || d.kind === 'none') return;
    var tier = tierOf(d.seat);
    if (!tier) return;                                                     // a person decides
    // A quiet position is sent as it is (nothing to replay — the bot thinks about exactly this page's game); only a
    // decision mid-action (where no copy can be taken) is sent as the last quiet position + the inputs since.
    if (quiet()) { track.anchor = snap(); track.path = []; track.game = gameId; }
    else if (track.game !== gameId || !track.anchor) return;
    var id = ++seq, sig = window.ruStateSig();
    var opts = window.RUAI && RUAI.tiers ? RUAI.tiers.planOpts(tier, G._turnNo || 0, (G._seed >>> 0) ^ (d.seat === 'player' ? 0x51 : 0xA7), 1, d) : { fixed: true, evals: 1000 };
    opts.seed = ((G._seed >>> 0) ^ Math.imul(id, 2654435761)) >>> 0;
    pending = { id: id, seat: d.seat, sig: sig, t0: performance.now(), game: gameId };
    hist.push({ id: id, game: gameId, seat: d.seat, tier: tier, turnNo: G._turnNo || 0, phase: G.phase, opts: opts, anchor: track.anchor, path: track.path.slice(), sig: sig });
    if (hist.length > HIST) hist.shift();
    shown();
    ensureWorker().postMessage({ type: 'think', id: id, seat: d.seat, opts: opts, anchor: track.anchor, path: track.path, sig: sig, base: base() });
  }

  function onMessage(ev) {
    var m = ev.data || {};
    if (m.type === 'ready') { ready = true; if (m.errors && m.errors.length) console.warn('[bots] worker load notes', m.errors); return; }
    if (m.type === 'error') { console.error('[bots]', m.msg); say('Bot error: ' + m.msg, 'dmg'); pending = null; return; }
    if (m.type === 'state') { var w = stateWaiters[m.id]; delete stateWaiters[m.id]; if (w) w(m); return; }
    if (m.type === 'move' && explainWaiters[m.id]) { var xw = explainWaiters[m.id]; delete explainWaiters[m.id]; xw(m); return; }
    if (m.type === 'move') hist.forEach(function (h) { if (h.id === m.id) { h.move = m.move; h.why = m.why; h.value = m.value; h.ms = m.ms; } });
    if (m.type !== 'move' || !pending || m.id !== pending.id) return;
    var p = pending;
    // a readable pace: a decision that took less than a moment still waits a moment
    var spent = performance.now() - p.t0, min = m.why === 'plan' ? PACE.plan : PACE.search;
    setTimeout(function () { play(p, m, 0); }, Math.max(0, min - spent));
  }

  // Play the bot's input once this page's game is exactly where the bot planned it: the worker settles every input
  // at once, while here an effect can still be on its way (a timer) — the same catch-up wait an online screen makes
  // for the other player's input. A game that never gets there differs from the bot's copy: think again.
  // the turn hint says when a bot is thinking
  function shown() { try { if (window.ruSyncTurnControls) window.ruSyncTurnControls(); } catch (e) {} }
  function play(p, m, tries) {
    if (!soloGame() || p.game !== gameId || G.gameOver) { pending = null; return; }
    var now = window.ruStateSig();
    if (now !== m.sig) {
      // The page has moved on from where the bot was asked (a timer-driven step while it thought): the answer is for a
      // position that is gone — think again now. (Still where it was asked: it may just be catching up — wait.)
      if (now !== p.sig && tries >= 3) { pending = null; shown(); return; }
      if (tries < 80) { setTimeout(function () { play(p, m, tries + 1); }, 100); return; }
      pending = null; failures++;
      console.warn('[bots] this game never reached the position the bot planned on', { page: window.ruStateSig(), bot: m.sig });
      // kept for inspection: the exact position + inputs the worker rebuilt from (RUBots.lastDivergence())
      lastDiv = { at: Date.now(), anchor: track.anchor, path: track.path.slice(), pageSig: window.ruStateSig(), botSig: m.sig };
      if (window.RU_BOTS_DEBUG) debugDiff().then(function (r) { console.warn('[bots] where the two copies differ', JSON.stringify(r)); });
      if (failures > 3) { say('The bot lost track of this game.', 'dmg'); stop(); }
      return;
    }
    pending = null; shown();
    if (!m.move) { failures++; console.warn('[bots] no move:', m.why); if (failures > 3) say('The bot found no move here (' + m.why + ').', 'dmg'); return; }
    var a = copy(m.move); a.s = p.seat; a.sig = m.moveSig || m.sig;
    // the order every screen applies an input in: settle, (the host's copy), the pre-input checkpoint, the input
    if (window.ruSettleNow) window.ruSettleNow();
    noteInput(a);
    if (window.ruCanApplyNow && !window.ruCanApplyNow(a)) { track.path.pop(); console.warn('[bots] the position changed at the checkpoint', a); return; }
    window.ruApplyAction(a);
    // the same seat asked again in the very same position means its input did nothing: don't loop forever
    if (lastSig === m.sig && lastSeat === p.seat) { if (++repeats > 4) { say('The bot is stuck (its input had no effect).', 'dmg'); stop(); } }
    else { repeats = 0; failures = 0; }
    lastSig = m.sig; lastSeat = p.seat;
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } pending = null; }
  function attach() {
    stop();
    if (!soloGame()) return;
    if (!helpers()) { say('The bots could not start (their helper scripts did not load).', 'dmg'); return; }
    gameId++; failures = 0; repeats = 0; lastSig = null; track = { anchor: null, path: [], game: 0 };
    ensureWorker();
    timer = setInterval(tick, 120);
  }

  // Debugging: the bots' recent decisions (what each was asked, and what it answered) — and any of them thought
  // again, afresh, with every first move it considered listed with its value (RUBots.explain(k): k counts from the
  // end, 1 = the last one).
  var HIST = 40, hist = [], explainWaiters = {};
  function history() { return hist.map(function (h, i) { return (hist.length - i) + ': ' + h.seat + ' ' + h.tier + ' t' + h.turnNo + ' ' + h.phase + ' -> ' + (h.move ? JSON.stringify(h.move) : '?') + ' (' + (h.why || '') + ')'; }); }
  function explain(k, extra) {
    var h = hist[hist.length - (k || 1)];
    if (!h) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var id = ++seq; explainWaiters[id] = resolve;
      var o = {}, q; for (q in h.opts) o[q] = h.opts[q]; o.explain = true; for (q in (extra || {})) o[q] = extra[q];
      ensureWorker().postMessage({ type: 'think', id: id, seat: h.seat, opts: o, anchor: h.anchor, path: h.path, sig: h.sig, base: base() });
    });
  }
  // Debugging: rebuild the current position in the worker and list every field where its copy differs from this
  // page's game (resolves with the differences).
  var stateWaiters = {};
  function diff(a, b, path, out) {
    if (out.length > 40) return;
    if (a === b) return;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) { out.push(path + ': page ' + JSON.stringify(a) + ' | bot ' + JSON.stringify(b)); return; }
    var keys = {}; Object.keys(a).forEach(function (k) { keys[k] = 1; }); Object.keys(b).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) { diff(a[k], b[k], path + '.' + k, out); });
  }
  function debugDiff() {
    return new Promise(function (resolve) {
      var id = ++seq; stateWaiters[id] = function (m) {
        var mine = JSON.parse(JSON.stringify(G)), out = [];
        diff(mine, m.G, 'G', out);
        resolve({ pageSig: window.ruStateSig(), botSig: m.sig, botQuiet: m.quiet, botDecider: m.decider, pathLen: track.path.length, path: track.path.map(function (a) { return a.t + (a.id ? ':' + a.id : '') + (a.i != null ? ':' + a.i : '') + ' ' + a.s; }), diffs: out });
      };
      ensureWorker().postMessage({ type: 'state', id: id, anchor: track.anchor, path: track.path, base: base() });
    });
  }

  window.RUBots = { available: available, attach: attach, stop: stop, noteInput: noteInput, ready: function () { return ready; }, debugDiff: debugDiff,
    thinking: function () { return pending ? pending.seat : null; }, lastDivergence: function () { return lastDiv; },
    history: history, explain: explain, request: function (k) { return hist[hist.length - (k || 1)] || null; } };
})();
