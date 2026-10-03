'use strict';
/* Headless Rank Up! engine: loads the REAL game (index.html's scripts + data.js / net.js / ai-sim.js) into a Node vm
 * context with a small fake DOM, a virtual clock (timers fire instantly, in order) and seeded randomness.
 *
 *   const { createEngine } = require('./engine');
 *   const eng = createEngine({ seed: 1 });
 *   eng.run('startHeadlessMatch(...)');      // any code, in the game's global scope
 *   eng.settle();                            // run every due timer (virtual time jumps forward)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Dom = require('../../ai/fakedom');
const { installRealm, splitPage } = require('../../ai/realm');

const ROOT = path.join(__dirname, '..', '..');

// ── load + split index.html once per process (scripts compiled once, run in every engine) ──
let PAGE = null;
function page() {
  if (PAGE) return PAGE;
  const sp = splitPage(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  PAGE = { body: sp.body, scripts: sp.scripts.map((s) => ({ name: s.name, script: new vm.Script(s.src ? fs.readFileSync(path.join(ROOT, s.src), 'utf8') : s.code, { filename: s.name }) })) };
  return PAGE;
}

function createEngine(opts) {
  opts = opts || {};
  const P = page();
  // A vm context only has the JavaScript builtins; these come from the host (a browser worker has them natively).
  const W = { URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, Intl, AbortController, Blob: class {},
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'), atob: (s) => Buffer.from(String(s), 'base64').toString('binary') };
  const ctx = vm.createContext(W);
  const realm = installRealm(W, { Dom, seed: opts.seed, console: opts.console, evalInRealm: (code) => vm.runInContext(code, ctx), realNow: () => Date.now() });
  const errors = realm.errors;
  realm.document.body.innerHTML = P.body;
  for (const s of P.scripts) {
    try { s.script.runInContext(ctx); }
    catch (e) { errors.push('load ' + s.name + ': ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : e)); }
  }
  realm.finishLoad();
  return {
    ctx, clock: realm.clock, logs: [], errors,
    run(code) { return vm.runInContext(code, ctx); },
    settle: realm.settle, advance: realm.advance, pendingTimeouts: realm.pendingTimeouts, dropTimeouts: realm.dropTimeouts, dropIntervals: realm.dropIntervals,
  };
}

module.exports = { createEngine, page };
