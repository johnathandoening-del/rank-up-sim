'use strict';
/* A small, permissive DOM for running the Rank Up! engine headless (Node vm / Web Worker).
 *
 * Goal: the game's scripts load and play without a browser. Anything the engine READS for its logic (prompt elements
 * and their classes / owner fields / buttons, form values) behaves like a real DOM; anything that only PAINTS is
 * accepted and kept cheap: innerHTML is stored as a string and parsed into nodes only when something asks for them.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);

function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, function (m, e) {
    var k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'"; if (k === 'nbsp') return ' ';
    if (k[0] === '#') { var n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
}
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// ── class list ──
class ClassList {
  constructor(el) { this._el = el; }
  _get() { var c = this._el.getAttribute('class'); return c ? c.split(/\s+/).filter(Boolean) : []; }
  _set(a) { this._el.setAttribute('class', a.join(' ')); }
  get length() { return this._get().length; }
  item(i) { return this._get()[i] || null; }
  contains(c) { return this._get().indexOf(c) !== -1; }
  add() { var a = this._get(); for (var i = 0; i < arguments.length; i++) if (a.indexOf(arguments[i]) === -1) a.push(arguments[i]); this._set(a); }
  remove() { var rm = Array.prototype.slice.call(arguments); this._set(this._get().filter(function (c) { return rm.indexOf(c) === -1; })); }
  toggle(c, force) {
    var has = this.contains(c), want = force === undefined ? !has : !!force;
    if (want && !has) this.add(c); else if (!want && has) this.remove(c);
    return want;
  }
  replace(a, b) { if (!this.contains(a)) return false; this.remove(a); this.add(b); return true; }
  forEach(fn) { this._get().forEach(fn); }
  toString() { return this._get().join(' '); }
}

// ── style ──
function makeStyle() {
  var store = {};
  var api = {
    setProperty: function (k, v) { store[k] = String(v); },
    removeProperty: function (k) { var v = store[k]; delete store[k]; return v || ''; },
    getPropertyValue: function (k) { return store[k] || ''; },
  };
  return new Proxy(api, {
    get: function (t, k) { if (k in t) return t[k]; if (k === 'cssText') return Object.keys(store).map(function (x) { return x + ':' + store[x]; }).join(';'); return store[k] !== undefined ? store[k] : ''; },
    set: function (t, k, v) { if (k === 'cssText') { store = {}; String(v).split(';').forEach(function (p) { var i = p.indexOf(':'); if (i > 0) store[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return true; } store[k] = v == null ? '' : String(v); return true; },
  });
}

// ── nodes ──
let NODE_SEQ = 0;
class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this._kids = []; this._seq = ++NODE_SEQ; }
  get childNodes() { this._ensure(); return this._kids; }
  get firstChild() { this._ensure(); return this._kids[0] || null; }
  get lastChild() { this._ensure(); return this._kids[this._kids.length - 1] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() { var p = this.parentNode; if (!p) return null; var k = p._kids, i = k.indexOf(this); return k[i + 1] || null; }
  get previousSibling() { var p = this.parentNode; if (!p) return null; var k = p._kids, i = k.indexOf(this); return i > 0 ? k[i - 1] : null; }
  _ensure() {}
  appendChild(n) {
    if (!n) return n;
    if (n.nodeType === 11) { n._ensure(); var ks = n._kids.slice(); ks.forEach((c) => this.appendChild(c)); return n; }
    this._ensure(); if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this; this._kids.push(n); this._dirtyHTML(); this.ownerDocument && this.ownerDocument._adopt(n); return n;
  }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.nodeType === 11) { n._ensure(); n._kids.slice().forEach((c) => this.insertBefore(c, ref)); return n; }
    this._ensure(); if (n.parentNode) n.parentNode.removeChild(n);
    var i = this._kids.indexOf(ref); if (i < 0) i = this._kids.length;
    n.parentNode = this; this._kids.splice(i, 0, n); this._dirtyHTML(); this.ownerDocument && this.ownerDocument._adopt(n); return n;
  }
  removeChild(n) { this._ensure(); var i = this._kids.indexOf(n); if (i >= 0) { this._kids.splice(i, 1); n.parentNode = null; this._dirtyHTML(); } return n; }
  replaceChild(n, old) { this.insertBefore(n, old); return this.removeChild(old); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (var x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  _dirtyHTML() {}
  get textContent() { this._ensure(); return this._kids.map(function (k) { return k.textContent; }).join(''); }
  set textContent(v) { this._kids.forEach(function (k) { k.parentNode = null; }); this._kids = []; this._html = null; if (v != null && v !== '') this.appendChild(this.ownerDocument.createTextNode(String(v))); }
  addEventListener(type, fn) { if (!fn) return; (this._ls || (this._ls = {}))[type] = (this._ls[type] || []).concat([fn]); }
  removeEventListener(type, fn) { if (this._ls && this._ls[type]) this._ls[type] = this._ls[type].filter(function (f) { return f !== fn; }); }
  dispatchEvent(ev) {
    if (!ev.target) { try { ev.target = this; } catch (e) {} }
    var path = []; for (var x = this; x; x = x.parentNode || (x.nodeType === 9 ? x.defaultView : null)) { path.push(x); if (x.nodeType === 9) break; }
    for (var i = 0; i < path.length; i++) {
      var n = path[i]; if (ev._stop) break; try { ev.currentTarget = n; } catch (e) {}
      var h = n['on' + ev.type]; if (typeof h === 'function') h.call(n, ev);
      var l = n._ls && n._ls[ev.type]; if (l) l.slice().forEach(function (f) { (typeof f === 'function' ? f : f.handleEvent).call(n, ev); });
      if (!ev.bubbles) break;
    }
    return !ev.defaultPrevented;
  }
}
class Text extends Node {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.nodeName = '#text'; this.data = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
  cloneNode() { return new Text(this.ownerDocument, this.data); }
  get outerHTML() { return escText(this.data); }
}
class Comment extends Node {
  constructor(doc, data) { super(doc); this.nodeType = 8; this.nodeName = '#comment'; this.data = data; }
  get textContent() { return ''; }
  cloneNode() { return new Comment(this.ownerDocument, this.data); }
  get outerHTML() { return '<!--' + this.data + '-->'; }
}

class Element extends Node {
  constructor(doc, tag) {
    super(doc); this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.nodeName = this.tagName; this.localName = String(tag).toLowerCase();
    this._attrs = {}; this._html = null; this.style = makeStyle(); this._cl = null; this.dataset = {}; this._value = '';
    this.checked = false; this.disabled = false; this.selected = false; this.scrollTop = 0; this.scrollLeft = 0; this.hidden = false;
  }
  // innerHTML is kept as a string until something needs the nodes (paint-only code never does).
  _ensure() { if (this._html != null) { var h = this._html; this._html = null; this._kids = []; parseInto(this, h); } }
  _dirtyHTML() {}
  get children() { this._ensure(); return this._kids.filter(function (k) { return k.nodeType === 1; }); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { var c = this.children; return c[c.length - 1] || null; }
  get nextElementSibling() { var p = this.parentNode; if (!p) return null; var c = p.children, i = c.indexOf(this); return c[i + 1] || null; }
  get previousElementSibling() { var p = this.parentNode; if (!p) return null; var c = p.children, i = c.indexOf(this); return i > 0 ? c[i - 1] : null; }
  get id() { return this._attrs.id || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this._attrs['class'] || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() { return this._cl || (this._cl = new ClassList(this)); }
  getAttribute(k) { k = String(k).toLowerCase(); return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  setAttribute(k, v) {
    k = String(k).toLowerCase(); var old = this._attrs[k]; this._attrs[k] = String(v);
    if (k === 'id' && this.ownerDocument) this.ownerDocument._reindex(this, old);
    if (k.slice(0, 5) === 'data-') this.dataset[k.slice(5).replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = String(v);
    if (k === 'value') this._value = String(v);
    if (k === 'disabled') this.disabled = true;
    if (k === 'checked') this.checked = true;
    if (k === 'style') this.style.cssText = String(v);
  }
  removeAttribute(k) { k = String(k).toLowerCase(); var old = this._attrs[k]; delete this._attrs[k]; if (k === 'id' && this.ownerDocument) this.ownerDocument._reindex(this, old); if (k === 'disabled') this.disabled = false; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, String(k).toLowerCase()); }
  toggleAttribute(k, f) { var has = this.hasAttribute(k), want = f === undefined ? !has : !!f; if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
  get attributes() { var a = this._attrs; return Object.keys(a).map(function (k) { return { name: k, value: a[k] }; }); }
  get innerHTML() { if (this._html != null) return this._html; return this._kids.map(function (k) { return k.outerHTML; }).join(''); }
  set innerHTML(v) {
    this._kids.forEach(function (k) { k.parentNode = null; }); this._kids = [];
    var s = v == null ? '' : String(v);
    this._html = s === '' ? null : s;
    if (this.ownerDocument) this.ownerDocument._htmlMayHaveIds(this, s);
  }
  get outerHTML() {
    var a = this._attrs, attrs = Object.keys(a).map(function (k) { return a[k] === '' ? ' ' + k : ' ' + k + '="' + escAttr(a[k]) + '"'; }).join('');
    if (VOID.has(this.localName)) return '<' + this.localName + attrs + '>';
    return '<' + this.localName + attrs + '>' + this.innerHTML + '</' + this.localName + '>';
  }
  insertAdjacentHTML(pos, html) {
    var tmp = this.ownerDocument.createElement('div'); tmp.innerHTML = html; tmp._ensure();
    var nodes = tmp._kids.slice();
    var p = String(pos).toLowerCase();
    nodes.forEach((n) => {
      if (p === 'beforeend') this.appendChild(n);
      else if (p === 'afterbegin') this.insertBefore(n, this.firstChild);
      else if (p === 'beforebegin' && this.parentNode) this.parentNode.insertBefore(n, this);
      else if (p === 'afterend' && this.parentNode) this.parentNode.insertBefore(n, this.nextSibling);
    });
  }
  insertAdjacentElement(pos, el) { var p = String(pos).toLowerCase(); if (p === 'beforeend') this.appendChild(el); else if (p === 'afterbegin') this.insertBefore(el, this.firstChild); else if (this.parentNode) this.parentNode.insertBefore(el, p === 'beforebegin' ? this : this.nextSibling); return el; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get outerText() { return this.textContent; }
  get value() {
    if (this.localName === 'select') { var o = this.options, i = this.selectedIndex; return i >= 0 && o[i] ? o[i].value : ''; }
    if (this.localName === 'option') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
    return this._value;
  }
  set value(v) {
    if (this.localName === 'select') { var o = this.options; for (var i = 0; i < o.length; i++) o[i].selected = (o[i].value === String(v)); return; }
    this._value = v == null ? '' : String(v);
  }
  get options() { return this.querySelectorAll('option'); }
  get selectedIndex() { var o = this.options; for (var i = 0; i < o.length; i++) if (o[i].selected) return i; return o.length ? 0 : -1; }
  set selectedIndex(i) { var o = this.options; for (var j = 0; j < o.length; j++) o[j].selected = (j === i); }
  cloneNode(deep) {
    var c = this.ownerDocument.createElement(this.localName);
    Object.keys(this._attrs).forEach((k) => c.setAttribute(k, this._attrs[k]));
    if (deep) { if (this._html != null) c.innerHTML = this._html; else this._kids.forEach(function (k) { c.appendChild(k.cloneNode(true)); }); }
    return c;
  }
  append() { for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; this.appendChild(typeof a === 'string' ? this.ownerDocument.createTextNode(a) : a); } }
  prepend() { var first = this.firstChild; for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; this.insertBefore(typeof a === 'string' ? this.ownerDocument.createTextNode(a) : a, first); } }
  replaceChildren() { this.innerHTML = ''; this.append.apply(this, arguments); }
  replaceWith(n) { if (this.parentNode) this.parentNode.replaceChild(n, this); }
  before(n) { if (this.parentNode) this.parentNode.insertBefore(n, this); }
  after(n) { if (this.parentNode) this.parentNode.insertBefore(n, this.nextSibling); }
  matches(sel) { return matchSel(this, parseSel(sel)); }
  closest(sel) { var s = parseSel(sel); for (var x = this; x && x.nodeType === 1; x = x.parentNode) if (matchSel(x, s)) return x; return null; }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel, false); }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  getElementsByClassName(c) { return this.querySelectorAll('.' + String(c).trim().split(/\s+/).join('.')); }
  click() { var ev = new FakeEvent('click', { bubbles: true }); ev.target = this; this.dispatchEvent(ev); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() {}
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30 }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  get offsetParent() { return this.parentNode ? this.ownerDocument.body : null; }
  get offsetWidth() { return 100; } get offsetHeight() { return 30; } get clientWidth() { return 100; } get clientHeight() { return 30; }
  get scrollWidth() { return 100; } get scrollHeight() { return 30; } get offsetTop() { return 0; } get offsetLeft() { return 0; }
  animate() { var a = { onfinish: null, cancel: function () {}, finish: function () {}, play: function () {}, pause: function () {}, finished: Promise.resolve() }; return a; }
  getAnimations() { return []; }
  getContext() { return new Proxy({}, { get: function (t, k) { if (k === 'canvas') return null; if (k === 'measureText') return function () { return { width: 0 }; }; if (k === 'getImageData' || k === 'createImageData') return function () { return { data: [] }; }; return t[k] !== undefined ? t[k] : function () {}; }, set: function (t, k, v) { t[k] = v; return true; } }); }
  setPointerCapture() {} releasePointerCapture() {}
  attachShadow() { return this; }
}

class Fragment extends Node {
  constructor(doc) { super(doc); this.nodeType = 11; this.nodeName = '#document-fragment'; }
  get children() { return this._kids.filter(function (k) { return k.nodeType === 1; }); }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel, false); }
  cloneNode(deep) { var f = new Fragment(this.ownerDocument); if (deep) this._kids.forEach(function (k) { f.appendChild(k.cloneNode(true)); }); return f; }
  get outerHTML() { return this._kids.map(function (k) { return k.outerHTML; }).join(''); }
}

// ── HTML parsing (tolerant; enough for the game's markup and the snippets it builds) ──
function parseInto(parent, html) {
  var doc = parent.ownerDocument, stack = [parent], i = 0, n = html.length;
  function top() { return stack[stack.length - 1]; }
  while (i < n) {
    var lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    if (lt > i) addText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { var ce = html.indexOf('-->', lt + 4); var data = html.slice(lt + 4, ce === -1 ? n : ce); top().appendChild(new Comment(doc, data)); i = ce === -1 ? n : ce + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { var ge = html.indexOf('>', lt); i = ge === -1 ? n : ge + 1; continue; }
    if (html[lt + 1] === '/') {
      var gt = html.indexOf('>', lt); var name = html.slice(lt + 2, gt === -1 ? n : gt).trim().toLowerCase();
      for (var s = stack.length - 1; s > 0; s--) { if (stack[s].localName === name) { stack.length = s; break; } }
      i = gt === -1 ? n : gt + 1; continue;
    }
    // start tag
    var m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { addText('<'); i = lt + 1; continue; }
    var tag = m[1].toLowerCase(), j = lt + m[0].length, attrs = [], selfClose = false;
    while (j < n) {
      while (j < n && /\s/.test(html[j])) j++;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/' && html[j + 1] === '>') { selfClose = true; j += 2; break; }
      var am = /^([^\s=>\/]+)/.exec(html.slice(j, j + 256)); if (!am) { j++; continue; }
      var an = am[1]; j += an.length; var av = '';
      while (j < n && /\s/.test(html[j])) j++;
      if (html[j] === '=') {
        j++; while (j < n && /\s/.test(html[j])) j++;
        var q = html[j];
        if (q === '"' || q === "'") { var qe = html.indexOf(q, j + 1); av = html.slice(j + 1, qe === -1 ? n : qe); j = qe === -1 ? n : qe + 1; }
        else { var ue = j; while (ue < n && !/[\s>]/.test(html[ue])) ue++; av = html.slice(j, ue); j = ue; }
      }
      attrs.push([an, decodeEntities(av)]);
    }
    var el = doc.createElement(tag);
    attrs.forEach(function (a) { el.setAttribute(a[0], a[1]); });
    top().appendChild(el);
    if (RAW.has(tag)) {
      var close = html.toLowerCase().indexOf('</' + tag, j); var body = html.slice(j, close === -1 ? n : close);
      if (body) el.appendChild(new Text(doc, tag === 'textarea' || tag === 'title' ? decodeEntities(body) : body));
      if (tag === 'textarea') el._value = decodeEntities(body);
      var ge2 = close === -1 ? n : html.indexOf('>', close); i = ge2 === -1 ? n : ge2 + 1; continue;
    }
    if (!selfClose && !VOID.has(tag)) stack.push(el);
    i = j;
  }
  function addText(t) { if (t) top().appendChild(new Text(doc, decodeEntities(t))); }
}

// ── selectors: compound selectors (tag #id .class [attr] [attr=v] [attr^=v] [attr*=v] :not() :checked :disabled
//    :first-child :last-child), descendant / child combinators, comma groups ──
const SEL_CACHE = new Map();
function parseSel(sel) {
  sel = String(sel).trim(); var c = SEL_CACHE.get(sel); if (c) return c;
  var groups = splitTop(sel, ',').map(function (g) { return parseComplex(g.trim()); });
  SEL_CACHE.set(sel, groups); return groups;
}
function splitTop(s, ch) {
  var out = [], depth = 0, q = null, cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    if (c === ch && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function parseComplex(s) {
  // tokens: compounds separated by ' ' (descendant) or '>' (child); '+'/'~' treated as descendant (rare here)
  var parts = [], comb = [], cur = '', depth = 0, q = null;
  s = s.replace(/\s*([>+~])\s*/g, ' $1 ');
  var toks = []; var buf = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (q) { buf += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; buf += c; continue; }
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    if (/\s/.test(c) && depth === 0) { if (buf) toks.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf) toks.push(buf);
  var nextComb = ' ';
  toks.forEach(function (t) {
    if (t === '>' || t === '+' || t === '~') { nextComb = t === '>' ? '>' : ' '; return; }
    parts.push(parseCompound(t)); comb.push(nextComb); nextComb = ' ';
  });
  return { parts: parts, comb: comb };
}
function parseCompound(t) {
  var c = { tag: null, id: null, classes: [], attrs: [], nots: [], pseudo: [] }, i = 0;
  var m = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)/.exec(t); if (m) { if (m[1] !== '*') c.tag = m[1].toUpperCase(); i = m[0].length; }
  while (i < t.length) {
    var ch = t[i];
    if (ch === '#') { var mi = /^#([^.#\[:\s]+)/.exec(t.slice(i)); c.id = mi[1]; i += mi[0].length; }
    else if (ch === '.') { var mc = /^\.([^.#\[:\s]+)/.exec(t.slice(i)); c.classes.push(mc[1]); i += mc[0].length; }
    else if (ch === '[') {
      var e = t.indexOf(']', i); var body = t.slice(i + 1, e); i = e + 1;
      var ma = /^\s*([^\s~|^$*!=]+)\s*(?:([~|^$*!]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?\s*$/.exec(body);
      if (ma) c.attrs.push({ name: ma[1].toLowerCase(), op: ma[2] || null, val: ma[3] != null ? ma[3] : (ma[4] != null ? ma[4] : ma[5]) });
    } else if (ch === ':') {
      var mp = /^::?([a-zA-Z-]+)(\(([^)]*)\))?/.exec(t.slice(i)); i += mp[0].length;
      if (mp[1] === 'not') c.nots.push(parseSel(mp[3])); else c.pseudo.push(mp[1]);
    } else i++;
  }
  return c;
}
function matchCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (var i = 0; i < c.classes.length; i++) if (!el.classList.contains(c.classes[i])) return false;
  for (var a = 0; a < c.attrs.length; a++) {
    var at = c.attrs[a], v = el.getAttribute(at.name);
    if (at.name === 'value' && el.localName === 'input') v = el.value;
    if (v == null) return false;
    if (at.op === '=' && v !== at.val) return false;
    if (at.op === '^=' && v.indexOf(at.val) !== 0) return false;
    if (at.op === '$=' && v.slice(-at.val.length) !== at.val) return false;
    if (at.op === '*=' && v.indexOf(at.val) === -1) return false;
    if (at.op === '~=' && v.split(/\s+/).indexOf(at.val) === -1) return false;
  }
  for (var p = 0; p < c.pseudo.length; p++) {
    var ps = c.pseudo[p];
    if (ps === 'checked' && !(el.checked || el.selected)) return false;
    if (ps === 'disabled' && !el.disabled) return false;
    if (ps === 'enabled' && el.disabled) return false;
    if (ps === 'first-child' && el.previousElementSibling) return false;
    if (ps === 'last-child' && el.nextElementSibling) return false;
  }
  for (var nn = 0; nn < c.nots.length; nn++) if (matchSel(el, c.nots[nn])) return false;
  return true;
}
function matchComplex(el, cx) {
  var parts = cx.parts, comb = cx.comb, k = parts.length - 1;
  if (!matchCompound(el, parts[k])) return false;
  function back(node, idx) {
    if (idx < 0) return true;
    var cb = comb[idx + 1];
    if (cb === '>') { var p = node.parentNode; return !!(p && p.nodeType === 1 && matchCompound(p, parts[idx]) && back(p, idx - 1)); }
    for (var a = node.parentNode; a && a.nodeType === 1; a = a.parentNode) if (matchCompound(a, parts[idx]) && back(a, idx - 1)) return true;
    return false;
  }
  return back(el, k - 1);
}
function matchSel(el, groups) { for (var i = 0; i < groups.length; i++) if (matchComplex(el, groups[i])) return true; return false; }
function queryAll(root, sel, firstOnly) {
  var groups = parseSel(sel), out = [];
  // fast path: a lone #id
  if (groups.length === 1 && groups[0].parts.length === 1) {
    var only = groups[0].parts[0];
    if (only.id && !only.tag && !only.classes.length && !only.attrs.length && !only.pseudo.length && !only.nots.length) {
      var doc = root.nodeType === 9 ? root : root.ownerDocument, e = doc && doc.getElementById(only.id);
      return e && (root.nodeType === 9 || root.contains(e)) && e !== root ? [e] : [];
    }
  }
  (function walk(n) {
    n._ensure(); var ks = n._kids;
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i]; if (k.nodeType !== 1) continue;
      if (matchSel(k, groups)) { out.push(k); if (firstOnly) return true; }
      if (walk(k) && firstOnly) return true;
    }
    return false;
  })(root.nodeType === 9 ? root.documentElement : root);
  if (root.nodeType === 9 && matchSel(root.documentElement, groups)) out.unshift(root.documentElement);
  return out;
}

// ── events ──
class FakeEvent {
  constructor(type, init) { init = init || {}; this.type = type; this.bubbles = !!init.bubbles; this.cancelable = !!init.cancelable; this.detail = init.detail; this.defaultPrevented = false; this._stop = false; this.key = init.key; this.target = null; this.currentTarget = null; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; }
}

// ── document ──
class Document extends Node {
  constructor() {
    super(null); this.ownerDocument = this; this.nodeType = 9; this.nodeName = '#document';
    this._byId = new Map(); this._pendingIds = new Set();
    this.documentElement = this.createElement('html'); this.appendChild(this.documentElement);
    this.head = this.createElement('head'); this.body = this.createElement('body');
    this.documentElement.appendChild(this.head); this.documentElement.appendChild(this.body);
    this.readyState = 'loading'; this.activeElement = this.body; this.cookie = ''; this.title = '';
    this.defaultView = null; this.visibilityState = 'visible'; this.hidden = false; this.fonts = { ready: Promise.resolve(), load: function () { return Promise.resolve([]); }, check: function () { return true; } };
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, String(t)); }
  createComment(t) { return new Comment(this, String(t)); }
  createDocumentFragment() { return new Fragment(this); }
  createEvent() { var e = new FakeEvent(''); e.initEvent = function (t, b, c) { this.type = t; this.bubbles = b; this.cancelable = c; }; e.initCustomEvent = function (t, b, c, d) { this.type = t; this.bubbles = b; this.detail = d; }; return e; }
  createRange() { var d = this; return { selectNodeContents: function () {}, createContextualFragment: function (h) { var f = d.createDocumentFragment(); var t = d.createElement('div'); t.innerHTML = h; t._ensure(); t._kids.slice().forEach(function (k) { f.appendChild(k); }); return f; } }; }
  getElementById(id) {
    id = String(id);
    var e = this._byId.get(id);
    if (e && this.contains(e) && e.id === id) return e;
    if (e) this._byId.delete(id);
    // an id that may sit inside not-yet-parsed innerHTML: parse what could hold it, then look again
    if (this._pendingIds.size) {
      var pend = Array.from(this._pendingIds); this._pendingIds.clear();
      pend.forEach(function (el) { el._ensure(); });
      e = this._byId.get(id);
      if (e && this.contains(e)) return e;
    }
    return null;
  }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel, false); }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  getElementsByClassName(c) { return this.querySelectorAll('.' + String(c).trim().split(/\s+/).join('.')); }
  get textContent() { return null; }
  _adopt(n) {
    if (n.nodeType !== 1) return;
    if (n.id) this._byId.set(n.id, n);
    if (n._html != null) this._pendingIds.add(n);
    n._kids.forEach((k) => this._adopt(k));
  }
  _reindex(el, oldId) { if (oldId && this._byId.get(oldId) === el) this._byId.delete(oldId); if (el.id) this._byId.set(el.id, el); }
  _htmlMayHaveIds(el, s) { if (s.indexOf('id=') !== -1) this._pendingIds.add(el); }
  hasFocus() { return true; }
  execCommand() { return false; }
  elementFromPoint() { return null; }
}

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { Document: Document, Element: Element, Node: Node, Text: Text, FakeEvent: FakeEvent, makeStyle: makeStyle };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; root.RUAI.Dom = m; }
})(typeof self !== 'undefined' ? self : this);
