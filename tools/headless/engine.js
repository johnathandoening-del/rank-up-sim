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
const { Document, Element, Node, FakeEvent } = require('./fakedom');

const ROOT = path.join(__dirname, '..', '..');

// ── load + split index.html once per process ──
let PAGE = null;
function page() {
  if (PAGE) return PAGE;
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bodyStart = html.search(/<body[^>]*>/i), bodyEnd = html.lastIndexOf('</body>');
  const bodyOpen = html.slice(bodyStart).match(/<body[^>]*>/i)[0];
  let body = html.slice(bodyStart + bodyOpen.length, bodyEnd);
  const scripts = [], deferred = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '', src = (attrs.match(/src="([^"]+)"/) || [])[1];
    const code = src ? fs.readFileSync(path.join(ROOT, src), 'utf8') : m[2];
    const name = src || ('index.html:' + (html.slice(0, m.index).split('\n').length));
    (/\bdefer\b/.test(attrs) ? deferred : scripts).push({ name, code });
  }
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  PAGE = { body, scripts: scripts.concat(deferred).map((s) => ({ name: s.name, script: new vm.Script(s.code, { filename: s.name }) })) };
  return PAGE;
}

// ── seeded PRNG (mulberry32) ──
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── virtual clock: a min-heap of timers ordered by (time, sequence) ──
class Clock {
  constructor() { this.now = 1700000000000; this.seq = 0; this.heap = []; this.live = new Map(); }
  _push(t) { const h = this.heap; h.push(t); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (cmp(h[p], h[i]) <= 0) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
  _pop() {
    const h = this.heap; if (!h.length) return null; const top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < h.length && cmp(h[l], h[s]) < 0) s = l; if (r < h.length && cmp(h[r], h[s]) < 0) s = r; if (s === i) break; [h[s], h[i]] = [h[i], h[s]]; i = s; } }
    return top;
  }
  set(fn, ms, args, interval) {
    const id = ++this.seq, t = { id, at: this.now + Math.max(0, Number(ms) || 0), seq: id, fn, args: args || [], every: interval ? Math.max(1, Number(ms) || 0) : 0 };
    this.live.set(id, t); this._push(t); return id;
  }
  clear(id) { const t = this.live.get(id); if (t) { t.dead = true; this.live.delete(id); } }
  // next live timer (dropping cancelled ones)
  peek() { while (this.heap.length && this.heap[0].dead) this._pop(); return this.heap[0] || null; }
  pendingTimeouts() { let n = 0; this.live.forEach((t) => { if (!t.every) n++; }); return n; }
}
function cmp(a, b) { return a.at - b.at || a.seq - b.seq; }

function createEngine(opts) {
  opts = opts || {};
  const P = page();
  const clock = new Clock();
  const rnd = mulberry32((opts.seed >>> 0) || 12345);
  const logs = [];
  const errors = [];

  const doc = new Document();
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => m.set(String(k), String(v)), removeItem: (k) => m.delete(String(k)), clear: () => m.clear(), key: (i) => Array.from(m.keys())[i] || null, get length() { return m.size; } }; };
  const noopObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  const W = {
    console: opts.console || { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => { if (errors.length < 200) errors.push(a.map((x) => (x && x.stack) ? String(x.stack).split('\n').slice(0, 3).join(' | ') : String(x)).join(' ')); } },
    document: doc,
    setTimeout: (fn, ms, ...args) => (typeof fn === 'function' ? clock.set(fn, ms, args, false) : 0),
    clearTimeout: (id) => clock.clear(id),
    setInterval: (fn, ms, ...args) => (typeof fn === 'function' ? clock.set(fn, ms, args, true) : 0),
    clearInterval: (id) => clock.clear(id),
    requestAnimationFrame: (fn) => clock.set(() => fn(clock.now), 16, [], false),
    cancelAnimationFrame: (id) => clock.clear(id),
    requestIdleCallback: (fn) => clock.set(() => fn({ timeRemaining: () => 50, didTimeout: false }), 1, [], false),
    queueMicrotask: (fn) => clock.set(fn, 0, [], false),
    localStorage: store(), sessionStorage: store(),
    location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} },
    navigator: { userAgent: 'rank-up-headless', language: 'en-US', languages: ['en-US'], platform: 'node', onLine: false, clipboard: { writeText: () => Promise.resolve() }, maxTouchPoints: 0 },
    performance: { now: () => clock.now - 1700000000000, mark() {}, measure() {} },
    innerWidth: 1600, innerHeight: 1000, outerWidth: 1600, outerHeight: 1000, devicePixelRatio: 1, screen: { width: 1600, height: 1000 },
    scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0, scrollTo() {}, scrollBy() {},
    getComputedStyle: (el) => (el && el.style) || {},
    matchMedia: () => ({ matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    alert() {}, confirm: () => false, prompt: () => null, open: () => null, print() {}, focus() {}, blur() {},
    fetch: () => Promise.reject(new Error('headless: no network')),
    WebSocket: class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} },
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} },
    Audio: class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} load() {} },
    Image: class { constructor() { this.onload = null; } },
    ResizeObserver: noopObserver, MutationObserver: noopObserver, IntersectionObserver: noopObserver,
    Event: FakeEvent, CustomEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent, PointerEvent: FakeEvent, TouchEvent: FakeEvent, FocusEvent: FakeEvent,
    HTMLElement: Element, Element, Node, HTMLDivElement: Element, HTMLButtonElement: Element, HTMLInputElement: Element, HTMLSelectElement: Element, HTMLCanvasElement: Element, SVGElement: Element,
    CSS: { supports: () => false, escape: (s) => String(s) },
    DOMParser: class { parseFromString(s) { const d = new Document(); d.body.innerHTML = s; return d; } },
    getSelection: () => ({ removeAllRanges() {}, addRange() {}, toString: () => '' }),
    URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, Intl, AbortController, Blob: class {},
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 4294967296) >>> 0; return a; }, randomUUID: () => 'x-' + Math.floor(rnd() * 1e9).toString(36) },
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'), atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    addEventListener(type, fn) { (W._ls || (W._ls = {}))[type] = (W._ls[type] || []).concat([fn]); },
    removeEventListener(type, fn) { if (W._ls && W._ls[type]) W._ls[type] = W._ls[type].filter((f) => f !== fn); },
    dispatchEvent(ev) { const l = W._ls && W._ls[ev.type]; if (l) l.slice().forEach((f) => f.call(W, ev)); const h = W['on' + ev.type]; if (typeof h === 'function') h.call(W, ev); return true; },
    __headless: true,
  };
  W.window = W; W.self = W; W.top = W; W.parent = W; W.frames = W; W.globalThis = W;
  doc.defaultView = W;
  const ctx = vm.createContext(W);
  // Seeded Math.random and a virtual Date inside the game's realm.
  vm.runInContext('(function(rnd,clock){ Math.random = rnd; const RealDate = Date; function VDate(...a){ if(!(this instanceof VDate)) return new RealDate(clock.now).toString(); return a.length ? new RealDate(...a) : new RealDate(clock.now); } VDate.now = () => clock.now; VDate.parse = RealDate.parse; VDate.UTC = RealDate.UTC; VDate.prototype = RealDate.prototype; globalThis.Date = VDate; })', ctx)(rnd, clock);

  doc.body.innerHTML = P.body;
  for (const s of P.scripts) {
    try { s.script.runInContext(ctx); }
    catch (e) { errors.push('load ' + s.name + ': ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : e)); }
  }
  doc.readyState = 'complete';
  try { doc.dispatchEvent(new FakeEvent('DOMContentLoaded')); W.dispatchEvent(new FakeEvent('load')); } catch (e) { errors.push('load events: ' + e.message); }

  const eng = {
    ctx, clock, logs, errors,
    run(code) { return vm.runInContext(code, ctx); },
    // Run every timer that is due, advancing virtual time as needed, until no one-shot timer is pending (intervals
    // alone don't keep it going) or `maxMs` of virtual time has passed. Returns the number of callbacks run.
    settle(maxMs) {
      const limit = clock.now + (maxMs == null ? 600000 : maxMs);
      let ran = 0;
      for (;;) {
        const t = clock.peek();
        if (!t || t.at > limit) break;
        if (clock.pendingTimeouts() === 0 && t.every) break;
        clock._pop();
        if (t.dead) continue;
        clock.now = Math.max(clock.now, t.at);
        if (t.every) { t.at = clock.now + t.every; t.seq = ++clock.seq; clock._push(t); } else clock.live.delete(t.id);
        try { t.fn.apply(W, t.args); } catch (e) { if (errors.length < 200) errors.push('timer: ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : e)); }
        if (++ran > 2000000) { errors.push('settle: runaway timers'); break; }
      }
      return ran;
    },
    advance(ms) { const end = clock.now + ms; const n = eng.settle(ms); clock.now = Math.max(clock.now, end); return n; },
    // One-shot timers still waiting (a position with any is not quiet: some flow is mid-way).
    pendingTimeouts() { return clock.pendingTimeouts(); },
    // Rewinding to a saved position: whatever the abandoned line still had scheduled must never fire.
    dropTimeouts() { clock.live.forEach((t, id) => { if (!t.every) { t.dead = true; clock.live.delete(id); } }); },
  };
  return eng;
}

module.exports = { createEngine, page };
