'use strict';
/* Save / restore a complete game position inside a headless engine (for lookahead: copy, play a line, rewind).
 * A snapshot is taken only at a QUIET point: no prompt open, no skill in flight, no Casualty Draw queued, no
 * continuation or one-shot timer pending — so the whole position is plain data (no half-run callbacks). */
var STATE_CODE = `
(function(){
  if (window.__S) return;
  // Set / Map / plain object told apart by their built-in tag, so values made in ANOTHER realm (a position handed over
  // from the page, or between two headless engines) are recognised as well.
  function tagOf(v){ return Object.prototype.toString.call(v).slice(8, -1); }
  function deepClone(v, memo){
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    var hit = memo.get(v); if (hit) return hit;
    if (Array.isArray(v)) { var a = new Array(v.length); memo.set(v, a); for (var i = 0; i < v.length; i++) a[i] = deepClone(v[i], memo); return a; }
    if (tagOf(v) === 'Map') { var mm = new Map(); memo.set(v, mm); v.forEach(function(x, k){ mm.set(k, deepClone(x, memo)); }); return mm; }
    if (tagOf(v) === 'Set') { var ss = new Set(); memo.set(v, ss); v.forEach(function(x){ ss.add(deepClone(x, memo)); }); return ss; }
    if (v.nodeType) return undefined;                      // never clone DOM
    var o = {}; memo.set(v, o);
    for (var k in v) { if (!Object.prototype.hasOwnProperty.call(v, k)) continue; var c = deepClone(v[k], memo); if (c !== undefined) o[k] = c; }
    return o;
  }
  // The position copy used for every rewind. A tree copy made in this realm, with every object copied once (shared
  // references — e.g. the last attacker IS the Rank Zone card — stay shared). ~2x faster than structuredClone. Anything
  // that is not plain data, a Set or a Map (a Date, a DOM node, a class instance) falls back to the structural copy.
  function NotPlain(){}
  var OP = Object.prototype;
  function treeClone(root){
    var memo = new Map();
    function fc(v){
      var hit = memo.get(v); if (hit !== undefined) return hit;
      if (Array.isArray(v)) { var a = new Array(v.length); memo.set(v, a); for (var i = 0; i < v.length; i++) { var x = v[i]; a[i] = (x === null || typeof x !== 'object') ? x : fc(x); } return a; }
      var pr = Object.getPrototypeOf(v);
      if (pr !== OP && pr !== null) {
        var tg = tagOf(v);
        if (tg === 'Set') { var ss = new Set(); memo.set(v, ss); v.forEach(function(x){ ss.add((x === null || typeof x !== 'object') ? x : fc(x)); }); return ss; }
        if (tg === 'Map') { var mm = new Map(); memo.set(v, mm); v.forEach(function(x, key){ mm.set(key, (x === null || typeof x !== 'object') ? x : fc(x)); }); return mm; }
        if (tg === 'Object' && !v.nodeType) return plain(v);     // a plain object made in another realm (a position handed over)
        throw new NotPlain();
      }
      return plain(v);
    }
    function plain(v){
      var o = {}; memo.set(v, o);
      for (var k in v) { var y = v[k]; if (typeof y === 'function') continue; o[k] = (y === null || typeof y !== 'object') ? y : fc(y); }
      return o;
    }
    return fc(root);
  }
  function fastClone(v){ try { return treeClone(v); } catch(e) { return deepClone(v, new Map()); } }
  function modal(){ return document.getElementById('modal'); }
  function picker(){ return document.getElementById('picker-modal'); }
  function openEl(e){ return !!(e && e.classList.contains('open')); }
  window.__S = {
    clone: function(v){ return deepClone(v, new Map()); },
    quiet: function(){
      return !!(G && !G._counterFrame && !openEl(modal()) && !openEl(picker()) && !(typeof SF !== 'undefined' && SF)
        && !((window._RUcq && window._RUcq.length) || window._RUcbusy)
        && !(typeof _modalQueue !== 'undefined' && _modalQueue.length)
        && !(window.ruSettlePending && window.ruSettlePending()));
    },
    // (a JSON copy lost shared references and values like Infinity — leaktest.js caught it)
    snap: function(){
      return { G: fastClone(G), rng: window.ruRngState(), cq: (window._RUcq || []).slice() };
    },
    // Rewind to a snapshot: the abandoned line's open prompts / skill / queued continuations are dropped first.
    restore: function(s){
      try { if (typeof _modalQueue !== 'undefined') _modalQueue.length = 0; } catch(e){}
      try { _modalOpen = false; } catch(e){}
      var m = modal(); if (m) { m.classList.remove('open'); m._ruStash = null; m._ruOwner = null; m._ruMirror = false; m._ruViewOnly = false; }
      var pk = picker(); if (pk) { pk.classList.remove('open'); pk._ruOwner = null; pk._ruMirror = false; }
      try { PCK = { cb: null, pool: [], sel: [], max: 1, min: 1, opt: false, npMode: false, npMin: 0 }; } catch(e){}   // the game's own idle picker state
      try { SF = null; } catch(e){}
      if (window.ruSettleReset) window.ruSettleReset();
      window._RUcq = s.cq.slice(); window._RUcbusy = false;window._RUcasCurrent=null;
      G = fastClone(s.G);
      if (window.ruLinkTeamPools) window.ruLinkTeamPools(G);   // Tag (2v2): a copy turns the shared pools into plain data
      window.ruRngRestore(s.rng);
    }
  };
})();
`;

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { STATE_CODE: STATE_CODE };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; for (var k in m) root.RUAI[k] = m[k]; }
})(typeof self !== 'undefined' ? self : this);
