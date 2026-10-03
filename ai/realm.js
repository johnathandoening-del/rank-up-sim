'use strict';
/* A game realm: what the REAL game's scripts need from a browser window, without a browser. Used by the headless
 * tools (a Node vm context) and by the bot worker in the page (the Web Worker's own global object):
 *   - a small fake DOM (fakedom.js),
 *   - a virtual clock: timers run only when the realm is settled, in time order (virtual time jumps forward),
 *   - seeded randomness and a virtual Date (so a realm replays a game exactly),
 *   - stubs for the rest of the window API the game touches.
 *
 *   var ctl = RUAI.installRealm(W, { seed, evalInRealm, Dom, console, realNow });
 *   ... load the game's scripts into W ...
 *   ctl.settle(maxMs)  // run every due timer
 */

// ── seeded PRNG (mulberry32) ──
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── virtual clock: a min-heap of timers ordered by (time, sequence) ──
function cmp(a, b) { return a.at - b.at || a.seq - b.seq; }
function Clock() { this.now = 1700000000000; this.seq = 0; this.heap = []; this.live = new Map(); }
Clock.prototype._push = function (t) { var h = this.heap; h.push(t); var i = h.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (cmp(h[p], h[i]) <= 0) break; var x = h[p]; h[p] = h[i]; h[i] = x; i = p; } };
Clock.prototype._pop = function () {
  var h = this.heap; if (!h.length) return null; var top = h[0], last = h.pop();
  if (h.length) { h[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, s = i; if (l < h.length && cmp(h[l], h[s]) < 0) s = l; if (r < h.length && cmp(h[r], h[s]) < 0) s = r; if (s === i) break; var x = h[s]; h[s] = h[i]; h[i] = x; i = s; } }
  return top;
};
Clock.prototype.set = function (fn, ms, args, interval) {
  var id = ++this.seq, t = { id: id, at: this.now + Math.max(0, Number(ms) || 0), seq: id, fn: fn, args: args || [], every: interval ? Math.max(1, Number(ms) || 0) : 0 };
  this.live.set(id, t); this._push(t); return id;
};
Clock.prototype.clear = function (id) { var t = this.live.get(id); if (t) { t.dead = true; this.live.delete(id); } };
// next live timer (dropping cancelled ones)
Clock.prototype.peek = function () { while (this.heap.length && this.heap[0].dead) this._pop(); return this.heap[0] || null; };
Clock.prototype.pendingTimeouts = function () { var n = 0; this.live.forEach(function (t) { if (!t.every) n++; }); return n; };

// Seeded Math.random and a virtual Date, installed INSIDE the realm (its own Math / Date).
var REALM_PATCH = '(function(rnd,clock){ Math.random = rnd; var RealDate = Date; function VDate(){ var a = Array.prototype.slice.call(arguments); if(!(this instanceof VDate)) return new RealDate(clock.now).toString(); return a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(clock.now); } VDate.now = function(){ return clock.now; }; VDate.parse = RealDate.parse; VDate.UTC = RealDate.UTC; VDate.prototype = RealDate.prototype; globalThis.Date = VDate; })';

// Split index.html into its body markup and its scripts, in load order (deferred ones last).
// Each script: { name, src (a file to load) or code (inline) }.
function splitPage(html) {
  var bodyStart = html.search(/<body[^>]*>/i), bodyEnd = html.lastIndexOf('</body>');
  var bodyOpen = html.slice(bodyStart).match(/<body[^>]*>/i)[0];
  var body = html.slice(bodyStart + bodyOpen.length, bodyEnd);
  var scripts = [], deferred = [], re = /<script([^>]*)>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(html))) {
    var attrs = m[1] || '', src = (attrs.match(/src="([^"]+)"/) || [])[1];
    var name = src || ('index.html:' + (html.slice(0, m.index).split('\n').length));
    (/\bdefer\b/.test(attrs) ? deferred : scripts).push(src ? { name: name, src: src } : { name: name, code: m[2] });
  }
  return { body: body.replace(/<script[\s\S]*?<\/script>/gi, ''), scripts: scripts.concat(deferred) };
}

function stack3(e) { return e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e); }

// Define a property on the realm's global even where the host makes it read-only (a Web Worker's location, navigator…).
function put(W, k, v) { try { Object.defineProperty(W, k, { value: v, writable: true, configurable: true, enumerable: true }); } catch (e) { try { W[k] = v; } catch (_) {} } }

// Fill the global-like object W with the window API the game expects. Returns the realm controller.
//   opts.Dom: { Document, Element, Node, FakeEvent } (fakedom.js)    opts.evalInRealm(code) → value (runs inside W)
//   opts.seed, opts.console, opts.realNow (a real clock for thinking budgets)
function installRealm(W, opts) {
  opts = opts || {};
  var D = opts.Dom, clock = new Clock(), rnd = mulberry32((opts.seed >>> 0) || 12345), errors = [];
  var doc = new D.Document();
  function store() { var m = new Map(); return { getItem: function (k) { return m.has(String(k)) ? m.get(String(k)) : null; }, setItem: function (k, v) { m.set(String(k), String(v)); }, removeItem: function (k) { m.delete(String(k)); }, clear: function () { m.clear(); }, key: function (i) { return Array.from(m.keys())[i] || null; }, get length() { return m.size; } }; }
  function Noop() {} Noop.prototype.observe = function () {}; Noop.prototype.unobserve = function () {}; Noop.prototype.disconnect = function () {}; Noop.prototype.takeRecords = function () { return []; };
  var listeners = {};
  var api = {
    console: opts.console || { log: function () {}, info: function () {}, debug: function () {}, warn: function () {}, error: function () { if (errors.length < 200) errors.push(Array.prototype.map.call(arguments, stack3).join(' ')); } },
    document: doc,
    setTimeout: function (fn, ms) { return typeof fn === 'function' ? clock.set(fn, ms, Array.prototype.slice.call(arguments, 2), false) : 0; },
    clearTimeout: function (id) { clock.clear(id); },
    setInterval: function (fn, ms) { return typeof fn === 'function' ? clock.set(fn, ms, Array.prototype.slice.call(arguments, 2), true) : 0; },
    clearInterval: function (id) { clock.clear(id); },
    requestAnimationFrame: function (fn) { return clock.set(function () { fn(clock.now); }, 16, [], false); },
    cancelAnimationFrame: function (id) { clock.clear(id); },
    requestIdleCallback: function (fn) { return clock.set(function () { fn({ timeRemaining: function () { return 50; }, didTimeout: false }); }, 1, [], false); },
    queueMicrotask: function (fn) { clock.set(fn, 0, [], false); },
    localStorage: store(), sessionStorage: store(),
    location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', reload: function () {}, assign: function () {}, replace: function () {} },
    navigator: { userAgent: 'rank-up-headless', language: 'en-US', languages: ['en-US'], platform: 'headless', onLine: false, clipboard: { writeText: function () { return Promise.resolve(); } }, maxTouchPoints: 0 },
    performance: { now: function () { return clock.now - 1700000000000; }, mark: function () {}, measure: function () {} },
    innerWidth: 1600, innerHeight: 1000, outerWidth: 1600, outerHeight: 1000, devicePixelRatio: 1, screen: { width: 1600, height: 1000 },
    scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0, scrollTo: function () {}, scrollBy: function () {},
    getComputedStyle: function (el) { return (el && el.style) || {}; },
    matchMedia: function () { return { matches: false, media: '', addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} }; },
    alert: function () {}, confirm: function () { return false; }, prompt: function () { return null; }, open: function () { return null; }, print: function () {}, focus: function () {}, blur: function () {},
    fetch: function () { return Promise.reject(new Error('headless: no network')); },
    WebSocket: function () { this.readyState = 3; this.send = function () {}; this.close = function () {}; this.addEventListener = function () {}; },
    XMLHttpRequest: function () { this.open = function () {}; this.send = function () {}; this.setRequestHeader = function () {}; },
    Audio: function () { this.volume = 1; this.play = function () { return Promise.resolve(); }; this.pause = function () {}; this.load = function () {}; },
    Image: function () { this.onload = null; },
    ResizeObserver: Noop, MutationObserver: Noop, IntersectionObserver: Noop,
    Event: D.FakeEvent, CustomEvent: D.FakeEvent, KeyboardEvent: D.FakeEvent, MouseEvent: D.FakeEvent, PointerEvent: D.FakeEvent, TouchEvent: D.FakeEvent, FocusEvent: D.FakeEvent,
    HTMLElement: D.Element, Element: D.Element, Node: D.Node, HTMLDivElement: D.Element, HTMLButtonElement: D.Element, HTMLInputElement: D.Element, HTMLSelectElement: D.Element, HTMLCanvasElement: D.Element, SVGElement: D.Element,
    CSS: { supports: function () { return false; }, escape: function (s) { return String(s); } },
    DOMParser: function () { this.parseFromString = function (s) { var d = new D.Document(); d.body.innerHTML = s; return d; }; },
    getSelection: function () { return { removeAllRanges: function () {}, addRange: function () {}, toString: function () { return ''; } }; },
    crypto: { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 4294967296) >>> 0; return a; }, randomUUID: function () { return 'x-' + Math.floor(rnd() * 1e9).toString(36); } },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: function (type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(function (f) { return f !== fn; }); },
    dispatchEvent: function (ev) { var l = listeners[ev.type]; if (l) l.slice().forEach(function (f) { f.call(W, ev); }); var h = W['on' + ev.type]; if (typeof h === 'function') h.call(W, ev); return true; },
    __headless: true,
  };
  Object.keys(api).forEach(function (k) { put(W, k, api[k]); });
  ['window', 'self', 'top', 'parent', 'frames', 'globalThis'].forEach(function (k) { put(W, k, W); });
  doc.defaultView = W;
  // the bot's thinking budget uses REAL time (the realm's Date is the virtual game clock)
  put(W, '__realNow', opts.realNow || function () { return Date.now(); });
  opts.evalInRealm(REALM_PATCH)(rnd, clock);

  function runTimer(t) { try { t.fn.apply(W, t.args); } catch (e) { if (errors.length < 200) errors.push('timer: ' + stack3(e)); } }
  var ctl = {
    clock: clock, errors: errors, document: doc,
    // Run every timer that is due, advancing virtual time as needed, until no one-shot timer is pending (intervals
    // alone don't keep it going) or `maxMs` of virtual time has passed. Returns the number of callbacks run.
    settle: function (maxMs) {
      var limit = clock.now + (maxMs == null ? 600000 : maxMs), ran = 0;
      for (;;) {
        var t = clock.peek();
        if (!t || t.at > limit) break;
        if (clock.pendingTimeouts() === 0 && t.every) break;
        clock._pop();
        if (t.dead) continue;
        clock.now = Math.max(clock.now, t.at);
        if (t.every) { t.at = clock.now + t.every; t.seq = ++clock.seq; clock._push(t); } else clock.live.delete(t.id);
        runTimer(t);
        if (++ran > 2000000) { errors.push('settle: runaway timers'); break; }
      }
      return ran;
    },
    // Move virtual time forward by `ms`, firing EVERY timer due in that window — repeating ones included.
    advance: function (ms) {
      var end = clock.now + ms, ran = 0;
      for (;;) {
        var t = clock.peek(); if (!t || t.at > end) break;
        clock._pop(); if (t.dead) continue;
        clock.now = Math.max(clock.now, t.at);
        if (t.every) { t.at = clock.now + t.every; t.seq = ++clock.seq; clock._push(t); } else clock.live.delete(t.id);
        runTimer(t);
        if (++ran > 2000000) { errors.push('advance: runaway timers'); break; }
      }
      clock.now = Math.max(clock.now, end); return ran;
    },
    // One-shot timers still waiting (a position with any is not quiet: some flow is mid-way).
    pendingTimeouts: function () { return clock.pendingTimeouts(); },
    // Rewinding to a saved position: whatever the abandoned line still had scheduled must never fire.
    dropTimeouts: function () { clock.live.forEach(function (t, id) { if (!t.every) { t.dead = true; clock.live.delete(id); } }); },
    // Stop every repeating timer (the page's display intervals; nothing headless needs them).
    dropIntervals: function () { clock.live.forEach(function (t, id) { if (t.every) { t.dead = true; clock.live.delete(id); } }); },
    // After the scripts loaded: the document is complete and the load events fire.
    finishLoad: function () {
      doc.readyState = 'complete';
      try { doc.dispatchEvent(new D.FakeEvent('DOMContentLoaded')); api.dispatchEvent(new D.FakeEvent('load')); } catch (e) { errors.push('load events: ' + e.message); }
    },
  };
  return ctl;
}

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { installRealm: installRealm, splitPage: splitPage, mulberry32: mulberry32, Clock: Clock };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; for (var k in m) root.RUAI[k] = m[k]; }
})(typeof self !== 'undefined' ? self : this);
