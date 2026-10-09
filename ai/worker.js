'use strict';
/* The bots' thinking, off the page's main thread.
 *
 * This worker is a second game realm: the REAL game's scripts (fetched from the page's own files) run here on a
 * fake DOM with a virtual clock (realm.js), plus the bot (brain.js). It never runs a match of its own and never
 * needs to be kept in step with the page: every request carries the position to think about —
 *   anchor: the last QUIET position of the page's game (a plain-data copy of G + the RNG state), and
 *   path:   the inputs applied since (a decision can come mid-action, where no copy can be taken),
 * and the worker restores the anchor, replays the path through the real input layer (the same lockstep rules every
 * online screen follows) and plans the seat's next input on that.
 *
 * Messages from the page:
 *   { type:'init', base }                       load the game from the page's folder (base URL)
 *   { type:'think', id, seat, opts, anchor, path, sig }   (opts.explain: also list every candidate weighed)
 *   { type:'state', id, anchor, path }                    debugging: the position this worker rebuilds, as plain data
 * Replies:
 *   { type:'ready', ms }  { type:'error', msg }
 *   { type:'move', id, move, why, value, evals, ms, sig, moveSig, ranked, considered }   (sig: the worker's fingerprint
 *       before the move — it must equal the page's, or the two games differ; moveSig: after the pre-input checkpoint)
 *   { type:'state', id, sig, G, quiet, decider }
 * The bot reads only what its seat could know: the hidden cards in the copy it gets are re-dealt in every
 * world it imagines (brain.js determinize), never looked at. */

var realPost = self.postMessage.bind(self);
var realNow = (function () { var p = self.performance; return function () { return p.now(); }; })();
var realConsole = self.console;
var realFetch = self.fetch.bind(self);
var realImport = self.importScripts.bind(self);
var RealBlob = self.Blob, RealURL = self.URL;

realImport('fakedom.js', 'realm.js', 'state.js', 'moves.js', 'match.js', 'nopaint.js', 'brain.js');
var AI = self.RUAI;

var realm = null, loading = null;

function fail(msg) { realPost({ type: 'error', msg: String(msg) }); }

// Load the game into this worker: fetch index.html and its script files, install the realm, run the scripts in
// page order as classic scripts (so their top-level declarations are shared, exactly as in the page).
function load(base) {
  if (loading) return loading;
  var t0 = realNow();
  loading = realFetch(base + 'index.html', { cache: 'no-cache' }).then(function (r) { return r.text(); }).then(function (html) {
    var page = AI.splitPage(html);
    return Promise.all(page.scripts.map(function (s) {
      return s.src ? realFetch(base + s.src, { cache: 'no-cache' }).then(function (r) { return r.text(); }).then(function (code) { return { name: s.name, code: code }; })
                   : Promise.resolve({ name: s.name, code: s.code });
    })).then(function (scripts) { return { body: page.body, scripts: scripts }; });
  }).then(function (page) {
    var errors = [];
    var con = { log: function () {}, info: function () {}, debug: function () {}, warn: function () {},
      error: function () { var m = Array.prototype.map.call(arguments, function (x) { return x && x.stack ? String(x.stack).split('\n').slice(0, 3).join(' | ') : String(x); }).join(' '); if (errors.length < 50) errors.push(m); try { realConsole.error('[bot worker]', m); } catch (e) {} } };
    var ctl = AI.installRealm(self, { Dom: AI.Dom, seed: 1, console: con, realNow: realNow, evalInRealm: function (code) { return (0, eval)(code); } });
    ctl.document.body.innerHTML = page.body;
    page.scripts.forEach(function (s) {
      // a classic script, run in this global scope (shared top-level bindings, like <script> tags in a page)
      var url = RealURL.createObjectURL(new RealBlob([s.code + '\n//# sourceURL=' + s.name], { type: 'text/javascript' }));
      try { realImport(url); } catch (e) { errors.push('load ' + s.name + ': ' + (e && e.message)); }
      RealURL.revokeObjectURL(url);
    });
    ctl.finishLoad();
    // the headless helpers, the no-paint mode (nothing is ever drawn here) and the bot
    self.__structuredClone = self.structuredClone;
    self.__dropTimeouts = function () { ctl.dropTimeouts(); };
    self.__settle = function () { ctl.settle(3000); };
    (0, eval)(AI.MATCH_CODE); (0, eval)(AI.STATE_CODE); (0, eval)(AI.MOVES_CODE);
    (0, eval)(AI.NOPAINT_CODE); ctl.dropIntervals();
    (0, eval)(AI.BRAIN_CODE);
    realm = { ctl: ctl, errors: errors };
    realPost({ type: 'ready', ms: Math.round(realNow() - t0), errors: errors.slice(0, 5) });
    return realm;
  });
  loading.catch(function (e) { fail('could not load the game into the bot worker: ' + (e && e.message)); });
  return loading;
}

// Put the page's position into this realm: the anchor, then the inputs since (each settled like on every screen).
function position(anchor, path) {
  self.__S.restore({ G: anchor.G, rng: anchor.rng, cq: anchor.cq || [] });
  realm.ctl.dropTimeouts();
  self.__B.noteApplied(null);
  for (var i = 0; i < path.length; i++) {
    // as on every screen: what the table was waiting for, the pre-input checkpoint, then the input
    try { self.ruCanApplyNow({}); self.ruApplyAction(path[i]); } catch (e) { realConsole.error('[bot worker] replay', e); }
    realm.ctl.settle(10000);
    self.__B.noteApplied(path[i]);
  }
}

function think(m) {
  var t0 = realNow();
  position(m.anchor, m.path || []);
  // sig: where the page must be before the bot's input; the input itself is made after the pre-input checkpoint
  var sig = self.ruStateSig();
  self.ruCanApplyNow({});
  var moveSig = self.ruStateSig();
  var d = self.__M.decider();
  if (d.kind === 'over' || d.kind === 'none' || d.seat !== m.seat) {
    realPost({ type: 'move', id: m.id, move: null, why: 'not this seat\'s decision (' + d.kind + ' ' + (d.seat || '') + ')', sig: sig });
    return;
  }
  var r = null;
  try { r = self.__B.plan(m.seat, m.opts || {}); } catch (e) { realConsole.error('[bot worker] plan', e); }
  var move = r && r.move;
  if (!move) { var C = self.__M.candidates(m.seat); move = C && C[0]; }
  realPost({ type: 'move', id: m.id, move: move || null, why: r ? r.why : 'fallback', value: r && r.value, evals: r && r.evals, ms: Math.round(realNow() - t0), sig: sig, moveSig: moveSig,
    ranked: r && r.ranked, considered: r && r.considered });
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') { load(m.base || '../'); return; }
  if (m.type === 'think') {
    load(m.base || '../').then(function () { try { think(m); } catch (e) { fail('think: ' + (e && e.stack || e)); } });
    return;
  }
  // debugging: the position this worker rebuilds from an anchor + path, as plain data (to diff with the page's)
  if (m.type === 'state') {
    load(m.base || '../').then(function () { position(m.anchor, m.path || []); realPost({ type: 'state', id: m.id, sig: self.ruStateSig(), G: JSON.parse((0, eval)('JSON.stringify(G)')), quiet: self.__S.quiet(), decider: self.__M.decider() }); });
    return;
  }
};
