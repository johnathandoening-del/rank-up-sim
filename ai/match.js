'use strict';
/* A headless match on the REAL engine, played purely through the same inputs a human makes (the online input layer:
 * {t:'adv'}, {t:'hand',id}, {t:'zone',o,z}, {t:'modal',i}, {t:'pick',ix}, …). Both seats are "remote humans"
 * (a virtual online game watched by nobody), so no built-in bot code ever runs: whoever drives the inputs plays. */
var MATCH_CODE = `
(function(){
  if (window.__H) return;
  function modal(){ return document.getElementById('modal'); }
  function picker(){ return document.getElementById('picker-modal'); }
  function sharedOpen(e){ return !!(e && e.classList.contains('open') && !e._ruViewOnly); }
  window.__H = {
    start: function(cfg){
      window.RU_NET_CONFIG = cfg; try { startGame(); } finally { window.RU_NET_CONFIG = null; }
    },
    // The decision the game is waiting for right now.
    pending: function(){
      if (!G || !G.turn) return { kind: 'none' };
      if (G.gameOver) return { kind: 'over' };
      var pk = picker();
      if (sharedOpen(pk) && typeof PCK !== 'undefined' && PCK) {
        return { kind: 'pick', owner: pk._ruOwner || G.turn, n: (PCK.pool || []).length, max: PCK.max, min: PCK.min, opt: !!PCK.opt, np: !!PCK.npMode, npMin: PCK.npMin || 0 };
      }
      var m = modal();
      if (sharedOpen(m)) {
        var btns = m._ruStash ? m._ruStash.btns : [].slice.call(document.getElementById('m-btns').children);
        return { kind: 'modal', owner: m._ruOwner || G.turn, n: btns.length, title: (m._ruStash ? m._ruStash.title : (document.getElementById('m-title') || {}).textContent) || '', labels: btns.map(function(b){ return b.textContent; }) };
      }
      return { kind: 'turn', owner: G.turn, phase: G.phase, mode: G.mode };
    },
    // (the order every screen applies an input in: what the table was waiting for, the pre-input checkpoint, the input)
    apply: function(a){ if (window.ruCanApplyNow) window.ruCanApplyNow({}); return window.ruApplyAction(a); },
    sig: function(){ return window.ruStateSig(); },
    // Ids of things a seat could act on (candidate inputs; the engine refuses whatever is illegal).
    options: function(seat){
      var p = G[seat], o = G[seat === 'player' ? 'ai' : 'player'];
      var z = ['rank','left-flank','right-flank','rear-flank'];
      return {
        hand: (p.hand || []).map(function(c){ return c.id; }),
        bank: (p.bank || []).map(function(c){ return c.id; }),
        dead: (p.deadzone || []).filter(function(c){ return c && c.type === 'area'; }).map(function(c){ return c.id; }),
        drop: (p.discard || []).map(function(c){ return c.id; }),
        field: z.filter(function(k){ var key = k === 'rank' ? 'rankZone' : k === 'left-flank' ? 'leftFlank' : k === 'right-flank' ? 'rightFlank' : 'rearFlank'; return !!p[key]; }),
        oppField: z.filter(function(k){ var key = k === 'rank' ? 'rankZone' : k === 'left-flank' ? 'leftFlank' : k === 'right-flank' ? 'rightFlank' : 'rearFlank'; return !!o[key]; }),
        delta: !!(p.delta && p.delta.length), evo: (p.evolutions || []).length
      };
    },
    result: function(){ return { over: !!G.gameOver, winner: G._lastWinResult || G.winner || null, turnNo: G._turnNo || 0 }; }
  };
  // Record who won (endGameImmediate is the single place a match ends).
  var orig = window.endGameImmediate;
  window.endGameImmediate = function(winner, reason){ if (G && !G.gameOver) { G.__winner = winner || 'draw'; try { G.__reason = [].concat(typeof reason === 'string' ? reason : (reason && (reason.reason || reason.reasons)) || JSON.stringify(reason)).join(','); } catch (e) {} } return orig.apply(this, arguments); };
})();
`;

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { MATCH_CODE: MATCH_CODE };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; for (var k in m) root.RUAI[k] = m[k]; }
})(typeof self !== 'undefined' ? self : this);
