'use strict';
/* Move generation on the real engine. A MOVE is one input (the same vocabulary a human's clicks produce); the engine
 * itself decides legality: a candidate is legal when applying it changes the position or opens a prompt.
 * Candidates are tried on a saved copy and rewound, so generating moves never disturbs the game.
 *
 * In-realm API (window.__M):
 *   decider()              → { seat, kind:'modal'|'pick'|'turn'|'over'|'none', ... }  who must decide, and what
 *   candidates(seat)       → raw candidate inputs for the decider (not yet filtered)
 *   legal(seat)            → candidates the engine accepts (probed from a snapshot, position restored afterwards)
 */
var MOVES_CODE = `
(function(){
  if (window.__M) return;
  var ZONES = ['rank','left-flank','right-flank','rear-flank','delta'];
  var ZKEY = { 'rank':'rankZone', 'left-flank':'leftFlank', 'right-flank':'rightFlank', 'rear-flank':'rearFlank' };
  function opp(w){ return w === 'player' ? 'ai' : 'player'; }
  // every other living seat (one in a 1v1; two or three in 1v1v1 / Royale)
  function opps(w){ return (G.sideOrder || ['player','ai']).filter(function(s){ return s !== w && G[s] && !(G.eliminated && G.eliminated[s]); }); }
  function modal(){ return document.getElementById('modal'); }
  function picker(){ return document.getElementById('picker-modal'); }
  function openShared(e){ return !!(e && e.classList.contains('open') && !e._ruViewOnly); }
  function zoneCard(p, z){ if (z === 'delta') return p.delta && p.delta[0]; return p[ZKEY[z]]; }
  function modalButtons(m){ return m._ruStash ? m._ruStash.btns : [].slice.call(document.getElementById('m-btns').children); }

  function decider(){
    if (!G || !G.turn) return { kind: 'none' };
    if (G.gameOver) return { kind: 'over', winner: G.__winner || null };
    var pk = picker();
    if (openShared(pk) && typeof PCK !== 'undefined' && PCK) return { kind: 'pick', seat: pk._ruOwner || G.turn, n: (PCK.pool||[]).length, max: PCK.max, min: PCK.min, opt: !!PCK.opt, np: !!PCK.npMode, npMin: PCK.npMin || 0, title: (document.getElementById('pk-title')||{}).textContent || '' };
    var m = modal();
    if (openShared(m)) {
      var b = modalButtons(m);
      return { kind: 'modal', seat: m._ruOwner || G.turn, n: b.length, enabled: b.map(function(x){ return !x.disabled; }), labels: b.map(function(x){ return x.textContent; }), title: m._ruStash ? m._ruStash.title : ((document.getElementById('m-title')||{}).textContent || '') };
    }
    return { kind: 'turn', seat: G.turn, phase: G.phase, mode: G.mode || 'normal' };
  }

  function npOf(c){ return c ? (c.currentNP != null ? c.currentNP : (c.numeral || 0)) : 0; }
  // Card subsets for a picker: every subset when small, otherwise a spread (cheapest, strongest, singles, samples).
  function pickSets(d){
    var n = d.n, out = [], seen = {};
    function add(ix){ ix = ix.slice().sort(function(a,b){return a-b;}); var k = ix.join(','); if (!seen[k]) { seen[k] = 1; out.push(ix); } }
    var pool = (PCK && PCK.pool) || [];
    if (d.np) {
      // NP-threshold pickers: minimal subsets reaching the threshold, cheapest-first and strongest-first greedy
      var byNP = pool.map(function(c,i){ return { i:i, v:npOf(c) }; });
      [function(a,b){return a.v-b.v;}, function(a,b){return b.v-a.v;}].forEach(function(cmp){
        var s = byNP.slice().sort(cmp), tot = 0, ix = [];
        for (var k = 0; k < s.length && tot < d.npMin; k++) { ix.push(s[k].i); tot += s[k].v; }
        if (tot >= d.npMin) add(ix);
      });
      for (var i = 0; i < n; i++) if (npOf(pool[i]) >= d.npMin) add([i]);
      return out;
    }
    var lo = Math.max(0, d.min == null ? d.max : d.min), hi = Math.min(n, d.max == null ? 1 : d.max);
    if (d.opt) add([]);
    for (var k2 = Math.max(lo, 1); k2 <= hi; k2++) {
      if (k2 === 1) { for (var a = 0; a < n; a++) add([a]); continue; }
      // combinations when small
      var total = 1; for (var t = 0; t < k2; t++) total = total * (n - t) / (t + 1);
      if (total <= 40) { (function rec(start, cur){ if (cur.length === k2) { add(cur); return; } for (var x = start; x < n; x++) rec(x + 1, cur.concat([x])); })(0, []); }
      else {
        var idx = pool.map(function(c,i){ return { i:i, v:npOf(c) }; });
        add(idx.slice().sort(function(a,b){return a.v-b.v;}).slice(0,k2).map(function(o){return o.i;}));
        add(idx.slice().sort(function(a,b){return b.v-a.v;}).slice(0,k2).map(function(o){return o.i;}));
        for (var r = 0; r < 12; r++) { var sh = idx.slice().sort(function(){ return Math.random() - .5; }); add(sh.slice(0,k2).map(function(o){return o.i;})); }
      }
    }
    if (lo === 0 && !d.opt) add([]);
    return out;
  }

  function candidates(seat){
    var d = decider(); var out = [];
    if (d.kind === 'modal') { for (var i = 0; i < d.n; i++) if (d.enabled[i]) out.push({ t:'modal', i:i, s:d.seat }); return out; }
    if (d.kind === 'pick') { pickSets(d).forEach(function(ix){ out.push({ t:'pick', ix:ix, ids:[], s:d.seat }); }); return out; }
    if (d.kind !== 'turn') return out;
    seat = seat || d.seat; var p = G[seat], o = G[opp(seat)];
    var ph = d.phase, mode = d.mode;
    if (mode === 'switchdraw') {
      (p.hand||[]).forEach(function(c){ out.push({ t:'sd', id:c.id, first:!!G._sdFirst, s:seat }); });
      out.push({ t:'sdDone', first:!!G._sdFirst, s:seat });
      return out;
    }
    if (mode && mode !== 'normal') {
      out.push({ t:'cancel', s:seat });
      ZONES.forEach(function(z){ if (zoneCard(p, z)) out.push({ t:'zone', o:seat, z:z, s:seat }); });
      opps(seat).forEach(function(os){ var oo = G[os]; ZONES.forEach(function(z){ if (zoneCard(oo, z)) out.push({ t:'zone', o:os, z:z, s:seat }); }); });
      if (mode === 'atk') out.push({ t:'direct', s:seat });
      return out;
    }
    out.push({ t:'adv', s:seat });
    if (ph !== 'draw') out.push({ t:'end', s:seat });
    (p.hand||[]).forEach(function(c){
      if (c.type === 'numeral') {
        out.push({ t:'promote', id:c.id, s:seat }); out.push({ t:'maxPromote', id:c.id, s:seat });
        out.push({ t:'flank', id:c.id, slot:'left', s:seat }); out.push({ t:'flank', id:c.id, slot:'right', s:seat }); out.push({ t:'rearFlank', id:c.id, s:seat });
        out.push({ t:'relieveHand', id:c.id, s:seat });
      }
      if (c.type === 'action') out.push({ t:'playAction', id:c.id, s:seat });
      if (c.type === 'area') out.push({ t:'activateArea', id:c.id, s:seat });
      if (c.skillCost || (typeof SDEFS !== 'undefined' && SDEFS[c.name])) out.push({ t:'startSkill', source:'hand', id:c.id, s:seat });
    });
    ['rank','left-flank','right-flank','rear-flank','delta'].forEach(function(z){ var c = zoneCard(p, z); if (c && typeof SDEFS !== 'undefined' && SDEFS[c.name]) out.push({ t:'startSkill', source:z, id:c.id, s:seat }); });
    (p.bank||[]).forEach(function(c){ if (typeof SDEFS !== 'undefined' && SDEFS[c.name]) out.push({ t:'startSkill', source:'bank', id:c.id, s:seat }); });
    (p.discard||[]).forEach(function(c){ if (typeof SDEFS !== 'undefined' && SDEFS[c.name]) out.push({ t:'startSkill', source:'discard', id:c.id, s:seat }); if (c.type === 'area') out.push({ t:'areaDrop', id:c.id, s:seat }); if (c.name === 'Restorative 3') out.push({ t:'rest3', id:c.id, s:seat }); });
    (p.deadzone||[]).forEach(function(c){
      if (typeof SDEFS !== 'undefined' && SDEFS[c.name]) out.push({ t:'startSkill', source:'deadzone', id:c.id, s:seat });
      if (c.type === 'area' && typeof ADEFS !== 'undefined' && ADEFS[c.name]) (ADEFS[c.name].effects||[]).forEach(function(e, i){ out.push({ t:'areaFx', id:c.id, i:i, s:seat }); });
    });
    if (p.delta && p.delta[0]) out.push({ t:'amalgSkill', id:p.delta[0].id, s:seat });
    if ((p.evolutions||[]).length) out.push({ t:'delta', w:seat, s:seat });
    // Amalgamation Rank Up: the Δ Zone click only opens the acting player's own menu (a local view); the Rank Up
    // itself is its own input, one per Evolution that the Battlefield can make right now
    if ((p.evolutions||[]).length && G.allowEvolutions !== false && window.findAmalgamationOptionsAI1) {
      try { window.findAmalgamationOptionsAI1(seat).forEach(function(o){ var ids = (o.combo||[]).map(function(x){ return x.card && x.card.id; }).filter(Boolean); if (ids.length) out.push({ t:'amalgRank', evoCardId:o.evo.id, evoId:o.evo.baseId || o.evo.id, elementIds:ids, s:seat }); }); } catch(e) {}
    }
    if (ph === 'battle') { out.push({ t:'atkMode', s:seat }); out.push({ t:'direct', s:seat }); }
    out.push({ t:'sdMode', s:seat }); out.push({ t:'rvMode', s:seat });
    if (ph === 'rally' || ph === 'main' || ph === 'standby') out.push({ t:'maxFlank', s:seat });
    // only what the table offers a player now (the same windows every input is held to)
    return window.ruInputInWindow ? out.filter(function(m){ return window.ruInputInWindow(seat, m); }) : out;
  }

  // Probe candidates on a snapshot; keep the ones the engine accepts.
  function legal(seat){
    var d = decider(); if (d.kind === 'over' || d.kind === 'none') return [];
    var cands = candidates(seat);
    if (d.kind === 'modal' || d.kind === 'pick') return cands;          // prompt answers are all legal by construction
    if (!__S.quiet()) return cands;
    var base = __S.snap(), sig0 = ruStateSig(), keep = [];
    for (var i = 0; i < cands.length; i++) {
      var a = cands[i];
      try { ruApplyAction(a); } catch(e) {}
      var changed = ruStateSig() !== sig0 || !__S.quiet();
      if (changed) keep.push(a);
      if (window.__dropTimeouts) window.__dropTimeouts();
      __S.restore(base);
    }
    return keep;
  }
  window.__M = { decider: decider, candidates: candidates, legal: legal };
})();
`;

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { MOVES_CODE: MOVES_CODE };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; for (var k in m) root.RUAI[k] = m[k]; }
})(typeof self !== 'undefined' ? self : this);
