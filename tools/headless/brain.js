'use strict';
/* The thinking bot (in-realm). It plays the REAL rules forward on copies of the position.
 *
 *  Moves & lines   A move is one input. Inputs that leave the position mid-way (attack mode, the mover's own prompt)
 *                  are finished on the spot (its own follow-ups chosen best-first, the other player's adversarially),
 *                  so every move is judged by where it lands. A LINE is a whole turn: moves until control passes.
 *  Turn search     One search per turn: a beam per FIRST move (every first move keeps its own best few
 *                  continuations), so no promising start is pruned by another start's lines.
 *  Lookahead N     The best line of each top first move is played on: the opponent's turn by the opponent's planner,
 *                  then its own, … N turns in all; the horizon is scored by evaluate().
 *  Hidden info     Never read. Every search runs in "worlds" where the opponent's hand, both deck orders and all future
 *                  random rolls are re-dealt at random from what the mover could actually know.
 *  Plans           The chosen line is kept and followed while what the bot can SEE matches what the line expected;
 *                  a draw, a random result or the opponent's answer that differs makes it think again.
 *  Mid-action      Prompts mid-action can't be copied (live callbacks), so the live game keeps its last quiet position
 *                  and the inputs since; an answer is judged by rewinding there, re-dealing, replaying, and trying it. */
const moves = require('./moves');

const CODE = `
(function(){
  if (window.__B) return;
  function opp(w){ return w === 'player' ? 'ai' : 'player'; }
  function npOf(c){ return c ? (c.currentNP != null ? c.currentNP : (c.numeral || 0)) : 0; }
  function rpOf(c){ return c ? (c.currentRP != null ? c.currentRP : (c.rank || 0)) : 0; }
  function field(p){ return [p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank].filter(Boolean); }
  function lowlands(){ return ['player','ai'].some(function(s){ return G[s] && (G[s].deadzone||[]).some(function(c){ return c && c.name === 'The Lowlands'; }); }); }
  function clamp(x,a,b){ return x < a ? a : x > b ? b : x; }

  // ── features & evaluation (antisymmetric: evaluate(opp) == -evaluate(me)) ──
  function features(w){
    var me = G[w], op = G[opp(w)], f = {};
    function side(p, pre){
      var fl = field(p);
      f[pre+'mp'] = p.mp || 0; f[pre+'cas'] = p.cas || 0;
      f[pre+'deck'] = (p.deck||[]).length; f[pre+'hand'] = (p.hand||[]).length; f[pre+'bank'] = (p.bank||[]).length;
      f[pre+'rankNP'] = npOf(p.rankZone); f[pre+'rankRP'] = rpOf(p.rankZone);
      f[pre+'flankNP'] = [p.leftFlank, p.rightFlank, p.rearFlank].reduce(function(s,c){ return s + npOf(c); }, 0);
      f[pre+'fieldN'] = fl.length; f[pre+'maxNP'] = fl.reduce(function(m,c){ return Math.max(m, npOf(c)); }, 0);
      f[pre+'actions'] = (p.hand||[]).filter(function(c){ return c && c.type === 'action'; }).length;
      f[pre+'delta'] = (p.delta && p.delta.length) ? 1 : 0;
      f[pre+'areaDead'] = (p.deadzone||[]).filter(function(c){ return c && c.type === 'area'; }).length;
    }
    side(me, 'm_'); side(op, 'o_');
    f.lowlands = lowlands() ? 1 : 0;
    f.tempo = G.turn === w ? 1 : -1;        // whose turn it is (antisymmetric)
    return f;
  }
  var W = null;
  function moraleV(mp){ mp = clamp(mp, -50, 105); return mp <= 0 ? -60 : 30 * Math.log(1 + mp) + (mp >= 80 ? (mp - 80) * 2 : 0); }
  function casV(c){ c = clamp(c, -7, 15); return c >= 15 ? -60 : -(c * c) / 3 + (c < 0 ? -c * 6 : 0); }
  function terms(f){
    var lo = f.lowlands ? 0.6 : 1;
    return {
      mv: (moraleV(f.m_mp) - moraleV(f.o_mp)) * lo, cv: (casV(f.m_cas) - casV(f.o_cas)) * lo,
      deck: (f.m_deck <= 3 ? -(4 - f.m_deck) * 8 : 0) - (f.o_deck <= 3 ? -(4 - f.o_deck) * 8 : 0),
      rank: f.m_rankNP - f.o_rankNP, rankRP: f.m_rankRP - f.o_rankRP, flank: f.m_flankNP - f.o_flankNP, fieldN: f.m_fieldN - f.o_fieldN,
      hand: f.m_hand - f.o_hand, bank: f.m_bank - f.o_bank, actions: f.m_actions - f.o_actions, delta: f.m_delta - f.o_delta,
      area: f.m_areaDead - f.o_areaDead, maxNP: f.m_maxNP - f.o_maxNP, tempo: f.tempo
    };
  }
  var W0 = { mv: 1, cv: 1, deck: 1, rank: 1.2, rankRP: 0, flank: 0.6, fieldN: 2.0, hand: 0.8, bank: 0.5, actions: 0.7, delta: 0, area: 0, maxNP: 0 };
  function evaluate(w){
    if (G.gameOver) { var win = G.__winner; return win === w ? 1e6 : (win && win !== 'draw' ? -1e6 : 0); }
    var t = terms(features(w)), wt = (W && W.w) || W0, s = 0;
    for (var k in t) s += (wt[k] || 0) * t[k];
    return s;
  }

  // ── hidden information ──
  function shuffleArr(a, r){ for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function mb(s){ return function(){ s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function determinize(w, r){
    var me = G[w], op = G[opp(w)];
    var hidden = (op.hand || []).concat(op.deck || []); shuffleArr(hidden, r);
    var hn = (op.hand || []).length; op.hand = hidden.slice(0, hn); op.deck = hidden.slice(hn);
    shuffleArr(me.deck || [], r);
    var st = window.ruRngState(); st.g = Math.floor(r() * 4294967296) | 0; st.ai = Math.floor(r() * 4294967296) | 0; window.ruRngRestore(st);
  }
  // What seat w can SEE (public zones, its own hand, counts of hidden things, the pending decision).
  function visSig(w){
    var me = G[w], op = G[opp(w)];
    function ids(a){ return (a||[]).map(function(c){ return c && (c.id + ':' + npOf(c) + ':' + rpOf(c)); }).join(','); }
    function pub(p){ return [p.mp, p.cas, ids([p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank]), ids(p.discard), ids(p.deadzone), (p.bank||[]).length, (p.deck||[]).length, (p.hand||[]).length, (p.delta||[]).length].join('|'); }
    var d = __M.decider();
    return [G.turn, G.phase, G.mode, G._turnNo || 0, pub(me), ids(me.hand), pub(op), d.kind, d.seat || '', d.n || 0].join('#');
  }

  // ── engine stepping ──
  function settle(){ if (window.__settle) window.__settle(); }
  function rewind(s){ __S.restore(s); if (window.__dropTimeouts) window.__dropTimeouts(); }
  function apply(a){ try { ruApplyAction(a); } catch(e) {} settle(); }
  function dec(){ return __M.decider(); }
  function isOver(d){ return d.kind === 'over' || d.kind === 'none'; }
  function key(a){ return JSON.stringify(a); }

  // Finish a mid-flow position until quiet: the mover's own answers best-first (one step), the other player's worst-
  // for-the-mover. 'rebuild' recreates the mid-flow position. Returns the answers chosen (to extend the line), or null.
  function finishFlow(w, rebuild, budget){
    var seq = [];
    for (var guard = 0; guard < 24; guard++) {
      if (G.gameOver || __S.quiet()) return seq;
      var d = dec(); if (isOver(d)) return seq;
      var L = __M.candidates(d.seat); if (!L.length) return null;
      var best = null, bestV = 0;
      for (var i = 0; i < L.length; i++) {
        rebuild(); for (var q = 0; q < seq.length; q++) apply(seq[q]);
        apply(L[i]); budget.evals++;
        var v = evaluate(w);
        if (best === null || (d.seat === w ? v > bestV : v < bestV)) { best = L[i]; bestV = v; }
      }
      seq.push(best);
      rebuild(); for (var k = 0; k < seq.length; k++) apply(seq[k]);
    }
    return __S.quiet() ? seq : null;
  }

  // Expand one input into its COMPLETE outcomes: board modes (attack: attacker → target, stand down, relieve, …) are
  // branched exhaustively (every attacker × target is its own move); a prompt mid-way is finished by finishFlow.
  // cb(inputs, recipe) is called once per complete outcome, with the position live; 'recipe' rebuilds it later
  // ({ base: snapshot, tail: inputs to re-apply }) — positions are only copied when a line is actually kept.
  // applied: the input is already applied on top of 'base' (the caller tried it).
  function expand(mover, base, input, budget, cb, depth, applied){
    depth = depth || 0;
    if (!applied) { rewind(base); apply(input); budget.evals++; }
    var inputs = [input];
    if (!__S.quiet() && !G.gameOver) {
      var ans = finishFlow(mover, function(){ rewind(base); apply(input); }, budget);
      if (!ans) return;
      inputs = inputs.concat(ans);
    }
    if (G.gameOver || !__S.quiet()) { if (G.gameOver || __S.quiet()) cb(inputs, { base: base, tail: inputs }); return; }
    var d = dec();
    // (switchdraw is not a board mode to bundle: every switch reveals a new card, so each one is its own decision)
    var inMode = d.kind === 'turn' && d.seat === mover && d.mode && d.mode !== 'normal' && d.mode !== 'switchdraw';
    if (!inMode || depth >= 4) { cb(inputs, { base: base, tail: inputs }); return; }
    // a board mode for the mover: each way to complete it is a move of its own
    var modeSnap = __S.snap(), sig = ruStateSig();
    var C = __M.candidates(mover).filter(function(c){ return c.t !== 'cancel'; });
    var dirty = false;
    for (var i = 0; i < C.length && budget.evals < budget.max; i++) {
      if (dirty) { rewind(modeSnap); dirty = false; }
      apply(C[i]); budget.evals++;
      if (__S.quiet() && !G.gameOver && ruStateSig() === sig) continue;     // refused
      dirty = true;
      (function(c){ expand(mover, modeSnap, c, budget, function(more, rec){ cb(inputs.concat(more), rec); }, depth + 1, true); })(C[i]);
    }
  }
  function materialize(rec){ rewind(rec.base); for (var i = 0; i < rec.tail.length; i++) apply(rec.tail[i]); return __S.snap(); }

  // Search the mover's turn from a quiet root. Returns the best line per first move, sorted by v (desc):
  // [{ first, steps:[{ inputs:[...], vis: visible sig after the step, opp: the other player answered in it }], v, end }]
  // A position reached twice (by any line) is searched once — no cycles, no duplicate work.
  function turnSearch(mover, root, cfg, budget){
    var groups = new Map(), seen = new Set();
    rewind(root); seen.add(ruStateSig());
    var frontier = [{ snap: root, steps: [], firstKey: null }];
    function record(node, rec, v, done){
      var g = groups.get(node.firstKey) || { best: null, beam: [] };
      groups.set(node.firstKey, g);
      var line = { first: node.steps[0].inputs[0], steps: node.steps, v: v, rec: rec, done: done };
      if (done && (!g.best || !g.best.done || v > g.best.v)) g.best = line;
      else if (!g.best) g.best = line;
      if (!done) g.beam.push({ rec: rec, steps: node.steps, firstKey: node.firstKey, v: v });
    }
    for (var depth = 0; depth < cfg.maxDepth && frontier.length; depth++) {
      groups.forEach(function(g){ g.beam = []; });
      for (var f = 0; f < frontier.length; f++) {
        var node = frontier[f];
        if (!node.snap) node.snap = materialize(node.rec);
        rewind(node.snap);
        var sig0 = ruStateSig(), dirty = false;
        var C = __M.candidates(mover);
        for (var i = 0; i < C.length; i++) {
          if (budget.evals >= budget.max || Date.now() > budget.deadline) break;
          if (C[i].t === 'cancel') continue;
          if (dirty) { rewind(node.snap); dirty = false; }
          apply(C[i]); budget.evals++;
          if (__S.quiet() && !G.gameOver && ruStateSig() === sig0) continue;   // refused: nothing changed
          dirty = true;
          expand(mover, node.snap, C[i], budget, function(inputs, rec){
            var sg = ruStateSig();
            if (!G.gameOver && seen.has(sg)) return;        // reached before (a cycle, or a duplicate line)
            seen.add(sg);
            var v = evaluate(mover), d = dec();
            var step = { inputs: inputs, vis: visSig(mover), opp: inputs.some(function(x){ return x.s && x.s !== mover; }) };
            var child = { steps: node.steps.concat([step]), firstKey: node.firstKey || key(inputs[0]) };
            record(child, rec, v, isOver(d) || G.turn !== mover);
          }, 0, true);
        }
      }
      // next frontier: each first move keeps its own best few continuations (copied only now)
      frontier = [];
      groups.forEach(function(g){ g.beam.sort(function(a, b){ return b.v - a.v; }); g.beam.slice(0, cfg.width).forEach(function(n){ frontier.push({ snap: null, rec: n.rec, steps: n.steps, firstKey: n.firstKey }); }); });
    }
    // Lines are compared at the same point — when the turn has passed. Unfinished ones are played to the end of the
    // turn first (otherwise "never end the turn" would look better than any line that lets the opponent draw).
    var out = [];
    groups.forEach(function(g){
      var best = null;
      if (g.best && g.best.done) best = { first: g.best.first, steps: g.best.steps, v: g.best.v, end: materialize(g.best.rec), done: true };
      var cands = g.beam.slice(0, cfg.width);
      if (!best && g.best && !cands.length) cands = [{ rec: g.best.rec, steps: g.best.steps }];
      cands.forEach(function(n){
        var fin = finishTurn(mover, materialize(n.rec), budget);
        if (fin && (!best || fin.v > best.v)) best = { first: n.steps[0].inputs[0], steps: n.steps.concat(fin.steps), v: fin.v, end: fin.end, done: true };
      });
      if (best) out.push(best);
    });
    out.sort(function(a, b){ return b.v - a.v; });
    return out;
  }

  // Play the rest of the mover's turn by simply advancing (adv / end) until the turn passes. Returns the steps + end.
  function finishTurn(mover, snap, budget){
    rewind(snap); var steps = [];
    for (var g = 0; g < 12; g++) {
      if (G.gameOver || G.turn !== mover) break;
      var d = dec(); if (isOver(d)) break;
      if (!__S.quiet()) return null;
      var a = { t: d.phase === 'battle' || d.phase === 'end' ? 'end' : 'adv', s: mover };
      if (d.mode && d.mode !== 'normal') a = { t: 'cancel', s: mover };
      var sig = ruStateSig(); apply(a); budget.evals++;
      if (!__S.quiet() && !G.gameOver) { var ans = finishFlow(mover, function(){ rewind(snap); for (var q = 0; q < steps.length; q++) for (var r = 0; r < steps[q].inputs.length; r++) apply(steps[q].inputs[r]); apply(a); }, budget); if (!ans) return null; steps.push({ inputs: [a].concat(ans), vis: visSig(mover), opp: true }); }
      else { if (ruStateSig() === sig && !G.gameOver) { a = { t: 'end', s: mover }; apply(a); budget.evals++; } steps.push({ inputs: [a], vis: visSig(mover), opp: false }); }
    }
    return { steps: steps, v: evaluate(mover), end: __S.quiet() ? __S.snap() : null };
  }

  // Play 'turns' more turns from a quiet snapshot, each side by its own planner (smaller budget); score for 'judge'.
  function lookahead(judge, snap, turns, cfg, budget){
    rewind(snap);
    for (var t = 0; t < turns && !G.gameOver; t++) {
      if (!__S.quiet()) break;
      var mover = dec().seat || G.turn;
      var lines = turnSearch(mover, __S.snap(), cfg.future, budget);
      if (!lines.length) break;
      rewind(lines[0].end);
    }
    return evaluate(judge);
  }

  // ── live bookkeeping and the decision ──
  var live = { quiet: null, path: [] }, cache = null;
  // The next input of the kept plan, if the position is still the one the plan expected; otherwise drop the plan.
  function followPlan(w){
    if (!cache || cache.seat !== w || cache.turnNo !== (G._turnNo || 0)) { cache = null; return null; }
    var st = cache.steps[cache.si];
    if (!st) { cache = null; return null; }
    if (cache.ii < st.inputs.length) {
      var nx = st.inputs[cache.ii];
      if (nx.s && nx.s !== w) { cache = null; return null; }       // the plan expected the other player to answer here
      if (!cardThere(w, nx)) { cache = null; return null; }        // planned in a world where a different card was there
      cache.ii++; return nx;
    }
    // the step is complete: continue only if nobody else had a say and the bot sees what the plan expected
    if (st.opp || st.vis == null || st.vis !== visSig(w)) { cache = null; return null; }
    cache.si++; cache.ii = 0;
    var ns = cache.steps[cache.si];
    if (!ns || !ns.inputs.length || (ns.inputs[0].s && ns.inputs[0].s !== w)) { cache = null; return null; }
    if (!cardThere(w, ns.inputs[0])) { cache = null; return null; }
    cache.ii = 1; return ns.inputs[0];
  }
  // Does the card an input names actually exist on the mover's side right now?
  function cardThere(w, a){
    if (!a || !a.id || a.t === 'areaFx') return true;
    var p = G[w]; if (!p) return false;
    var all = [].concat(p.hand||[], p.bank||[], p.discard||[], p.deadzone||[], p.delta||[], [p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank]);
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].id === a.id) return true;
    return false;
  }
  function noteApplied(a){ if (__S.quiet()) { live.quiet = __S.snap(); live.path = []; } else if (a) live.path.push(a); }

  function plan(w, opts){
    opts = opts || {};
    var N = Math.max(1, opts.N || 1), t0 = Date.now();
    var cfg = { own: { width: opts.width || 3, maxDepth: opts.maxDepth || 18 }, future: { width: opts.futureWidth || 1, maxDepth: opts.maxDepth || 18 } };
    var budget = { evals: 0, max: opts.maxEvals || 20000, deadline: t0 + (opts.ms || 20000) };
    var d = dec(); if (isOver(d) || d.seat !== w) return null;

    // 1) follow the current plan while what it expected is what the bot sees
    var follow = followPlan(w); if (follow) return { move: follow, why: 'plan', evals: 0 };

    var quietNow = __S.quiet();
    if (!quietNow && !live.quiet) return { move: __M.candidates(w)[0], why: 'no anchor' };
    var anchor = quietNow ? __S.snap() : live.quiet, path = quietNow ? [] : live.path.slice();
    // Worlds are added until the best first move is clearly ahead of the rest (paired: every world scores every first
    // move, so differences come from the moves, not the deals). A move that is not clearly better than simply passing
    // (Done / advance / end) loses to passing — acting on luck-noise is how a search talks itself into bad plays.
    var minW = opts.worlds || 3, maxW = opts.maxWorlds || Math.max(minW, minW * 4);
    var agg = new Map();             // first-move key → { sum, sq, n, line, vals:[per world] }
    for (var k = 0; k < maxW; k++) {
      if (k >= minW && Date.now() > budget.deadline) break;
      var seed = ((opts.seed >>> 0) || 1) * 7919 + k * 104729;
      var mkWorld = function(){ rewind(anchor); determinize(w, mb(seed)); for (var p = 0; p < path.length; p++) apply(path[p]); };
      mkWorld();
      var dd = dec(); if (isOver(dd) || dd.seat !== w) continue;
      var lines;
      if (__S.quiet()) lines = turnSearch(w, __S.snap(), cfg.own, budget);
      else {
        // a prompt mid-action: each answer, finished, then the rest of the turn on
        lines = [];
        var C = __M.candidates(w);
        for (var i = 0; i < C.length; i++) {
          mkWorld(); apply(C[i]); budget.evals++;
          var ci = C[i];
          var ans = __S.quiet() || G.gameOver ? [] : finishFlow(w, function(){ mkWorld(); apply(ci); }, budget);
          if (!ans) continue;
          var v = evaluate(w), end = __S.quiet() ? __S.snap() : null;
          if (end && !G.gameOver && dec().seat === w && G.turn === w) { var rest = turnSearch(w, end, cfg.own, budget); if (rest.length) { v = rest[0].v; end = rest[0].end; } }
          lines.push({ first: C[i], steps: [{ inputs: [C[i]].concat(ans), vis: null, opp: true }], v: v, end: end });
        }
      }
      lines.sort(function(a, b){ return b.v - a.v; });
      var topK = opts.topK || 6;
      for (var j = 0; j < lines.length; j++) {
        var L = lines[j], val = L.v;
        if (N > 1 && j < topK && L.end && Date.now() < budget.deadline) val = lookahead(w, L.end, N - 1, cfg, budget);
        else if (N > 1 && j >= topK) val = L.v - 1e3;
        var kk = key(L.first), a = agg.get(kk) || { sum: 0, sq: 0, n: 0, line: L };
        a.sum += val; a.sq += val * val; a.n++; agg.set(kk, a);
      }
      if (k + 1 >= minW && agg.size > 1) {
        var ranked = []; agg.forEach(function(a, kk){ ranked.push({ kk: kk, m: a.sum / a.n, a: a }); });
        ranked.sort(function(x, y){ return y.m - x.m; });
        var b1 = ranked[0].a, b2 = ranked[1].a;
        var var1 = Math.max(0, b1.sq / b1.n - Math.pow(b1.sum / b1.n, 2)), var2 = Math.max(0, b2.sq / b2.n - Math.pow(b2.sum / b2.n, 2));
        var se = Math.sqrt(var1 / b1.n + var2 / b2.n);
        if (ranked[0].m - ranked[1].m > 2 * se) break;          // clearly ahead
      }
    }
    // restore the real position
    rewind(anchor); for (var p2 = 0; p2 < path.length; p2++) apply(path[p2]);
    var best = null, pass = null;
    agg.forEach(function(a, kk){
      var m = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sq / a.n - m * m)), se = sd / Math.sqrt(a.n);
      var e = { m: m, se: se, kk: kk, line: a.line };
      if (!best || m > best.m) best = e;
      var t = a.line.first && a.line.first.t;
      if ((t === 'sdDone' || t === 'adv' || t === 'end') && (!pass || m > pass.m)) pass = e;
    });
    if (!best) return { move: __M.candidates(w)[0], why: 'no lines' };
    if (pass && pass !== best && best.m - pass.m <= Math.max(best.se, pass.se)) best = pass;   // not clearly better than holding
    var line = best.line;
    cache = { seat: w, turnNo: G._turnNo || 0, steps: line.steps, si: 0, ii: 1 };
    return { move: line.first, value: best.m, considered: agg.size, evals: budget.evals, ms: Date.now() - t0, why: 'search' };
  }

  window.__B = { features: features, terms: terms, evaluate: evaluate, plan: plan, determinize: determinize, noteApplied: noteApplied,
    visSig: visSig, setWeights: function(x){ W = x; }, resetPlan: function(){ cache = null; }, live: live };
})();
`;

function install(eng) {
  moves.install(eng);
  // Timers due within a few seconds of game time run now; a flow that is polling while a prompt waits (e.g. a
  // Casualty Draw step, every 40 ms) just continues on the next call instead of spinning through minutes.
  eng.ctx.__settle = () => eng.settle(3000);
  eng.run(CODE);
}
module.exports = { install };
