'use strict';
/* Save / restore a complete game position inside a headless engine (for lookahead: copy, play a line, rewind).
 * A snapshot is taken only at a QUIET point: no prompt open, no skill in flight, no Casualty Draw queued, no
 * continuation or one-shot timer pending — so the whole position is plain data (no half-run callbacks). */
const CODE = `
(function(){
  if (window.__S) return;
  function deepClone(v, memo){
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    var hit = memo.get(v); if (hit) return hit;
    if (Array.isArray(v)) { var a = new Array(v.length); memo.set(v, a); for (var i = 0; i < v.length; i++) a[i] = deepClone(v[i], memo); return a; }
    if (v instanceof Map) { var mm = new Map(); memo.set(v, mm); v.forEach(function(x, k){ mm.set(k, deepClone(x, memo)); }); return mm; }
    if (v instanceof Set) { var ss = new Set(); memo.set(v, ss); v.forEach(function(x){ ss.add(deepClone(x, memo)); }); return ss; }
    if (v.nodeType) return undefined;                      // never clone DOM
    var o = {}; memo.set(v, o);
    for (var k in v) { if (!Object.prototype.hasOwnProperty.call(v, k)) continue; var c = deepClone(v[k], memo); if (c !== undefined) o[k] = c; }
    return o;
  }
  function modal(){ return document.getElementById('modal'); }
  function picker(){ return document.getElementById('picker-modal'); }
  function openEl(e){ return !!(e && e.classList.contains('open')); }
  window.__S = {
    clone: function(v){ return deepClone(v, new Map()); },
    quiet: function(){
      return !!(G && !openEl(modal()) && !openEl(picker()) && !(typeof SF !== 'undefined' && SF)
        && !((window._RUcq && window._RUcq.length) || window._RUcbusy)
        && !(typeof _modalQueue !== 'undefined' && _modalQueue.length)
        && !(window.ruSettlePending && window.ruSettlePending()));
    },
    snap: function(){
      return { G: deepClone(G, new Map()), rng: window.ruRngState(), cq: (window._RUcq || []).slice() };
    },
    // Rewind to a snapshot: the abandoned line's open prompts / skill / queued continuations are dropped first.
    restore: function(s){
      try { if (typeof _modalQueue !== 'undefined') _modalQueue.length = 0; } catch(e){}
      try { _modalOpen = false; } catch(e){}
      var m = modal(); if (m) { m.classList.remove('open'); m._ruStash = null; m._ruOwner = null; m._ruMirror = false; m._ruViewOnly = false; }
      var pk = picker(); if (pk) { pk.classList.remove('open'); pk._ruOwner = null; pk._ruMirror = false; }
      try { PCK = null; } catch(e){}
      try { SF = null; } catch(e){}
      if (window.ruSettleReset) window.ruSettleReset();
      window._RUcq = s.cq.slice(); window._RUcbusy = false;
      G = deepClone(s.G, new Map());
      window.ruRngRestore(s.rng);
    }
  };
})();
`;
function install(eng) { eng.run(CODE); }
module.exports = { install };
