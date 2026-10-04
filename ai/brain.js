'use strict';
/* The thinking bot (in-realm). It plays the REAL rules forward on copies of the position.
 *
 *  Moves & lines   A move is one input. Inputs that leave the position mid-way (attack mode, the mover's own prompt)
 *                  are finished on the spot (its own follow-ups chosen best-first, the other player's adversarially),
 *                  so every move is judged by where it lands. A LINE is a whole turn: moves until control passes.
 *                  An ACTION is what the bot commits to at once: one input and the mover's own inputs completing it
 *                  (attack mode → attacker → target) — up to the first prompt answer or the other player's input.
 *  Turn search     The whole turn searched phase by phase (a beam per first action, so no promising start is pruned
 *                  by another start's lines): which actions are worth comparing, and the best play after each.
 *  Hidden info     Never read. Every search runs in "worlds" where the opponent's hand, both deck orders and all future
 *                  random rolls are re-dealt at random from what the mover could actually know.
 *  Deciding        The turn search in one world FINDS the candidate actions (the best few + the best pass); then EVERY
 *                  world SCORES every candidate (the action, the best rest of the turn in that world, N-1 more turns),
 *                  each with an even share of the effort. Actions are compared world by world (paired), worlds added
 *                  until the best is clearly ahead; one not clearly better than passing loses to passing.
 *  Lookahead N     After an action and the rest of its turn, the turns that follow are played by each side's quick
 *                  planner (develop and attack), N turns in all; the horizon is scored by evaluate().
 *  Every decision  The bot commits to one action, then thinks again at its next decision — the rest of a line was
 *                  the best play in ONE world, chosen knowing that world's hidden cards, so it is never followed.
 *  Mid-action      Prompts mid-action can't be copied (live callbacks), so the live game keeps its last quiet position
 *                  and the inputs since; an answer is judged by rewinding there, re-dealing, replaying, and trying it. */
var BRAIN_CODE = `
(function(){
  if (window.__B) return;
  // Thinking time is REAL time. (Inside the engine Date.now() is the game's virtual clock — it jumps by seconds
  // whenever timers run — so it must never measure a thinking budget.)
  var NOW = window.__realNow || function(){ return Date.now(); };
  // Seats: two in a 1v1, three or four in 1v1v1 / Royale (turn order = G.sideOrder). An eliminated seat is out.
  function seats(){ return (G && G.sideOrder ? G.sideOrder : ['player', 'ai']).filter(function(s){ return G && G[s]; }); }
  function out(s){ return !!(G && G.eliminated && G.eliminated[s]); }
  function opps(w){ return seats().filter(function(s){ return s !== w && !out(s); }); }
  function opp(w){ var o = opps(w); return o.length ? o[0] : (w === 'player' ? 'ai' : 'player'); }
  function npOf(c){ return c ? (c.currentNP != null ? c.currentNP : (c.numeral || 0)) : 0; }
  function rpOf(c){ return c ? (c.currentRP != null ? c.currentRP : (c.rank || 0)) : 0; }
  // the Battlefield: Rank Zone, Flanks and the Δ Zone card (an Amalgamation attacks and is attacked like the others)
  function field(p){ return [p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank, p.delta && p.delta[0]].filter(Boolean); }
  function lowlands(){ return seats().some(function(s){ return G[s] && (G[s].deadzone||[]).some(function(c){ return c && c.name === 'The Lowlands'; }); }); }
  function clamp(x,a,b){ return x < a ? a : x > b ? b : x; }

  // ── features & evaluation (antisymmetric: evaluate(opp) == -evaluate(me)) ──
  // Features of w against ONE opponent o (default: the first living one — the only one in a 1v1).
  function features(w, o){
    o = o || opp(w);
    var me = G[w], op = G[o], f = {};
    function side(p, pre){
      var fl = field(p);
      f[pre+'mp'] = p.mp || 0; f[pre+'cas'] = p.cas || 0;
      f[pre+'deck'] = (p.deck||[]).length; f[pre+'hand'] = (p.hand||[]).length; f[pre+'bank'] = (p.bank||[]).length;
      f[pre+'rankNP'] = npOf(p.rankZone); f[pre+'rankRP'] = rpOf(p.rankZone);
      f[pre+'flankNP'] = [p.leftFlank, p.rightFlank, p.rearFlank].reduce(function(s,c){ return s + npOf(c); }, 0);
      f[pre+'fieldN'] = fl.length; f[pre+'maxNP'] = fl.reduce(function(m,c){ return Math.max(m, npOf(c)); }, 0);
      f[pre+'actions'] = (p.hand||[]).filter(function(c){ return c && c.type === 'action'; }).length;
      f[pre+'nums'] = (p.hand||[]).filter(function(c){ return c && c.type === 'numeral'; }).length;
      f[pre+'areas'] = (p.hand||[]).filter(function(c){ return c && c.type === 'area'; }).length;
      f[pre+'delta'] = (p.delta && p.delta.length) ? 1 : 0;
      f[pre+'deltaNP'] = (p.delta && p.delta[0]) ? npOf(p.delta[0]) : 0;
      // an Amalgamation Rank Up the Battlefield could make now (Δ Deck + three matching Numerals)
      // progress toward one: the most Battlefield Numerals matching the value of an Evolution in the Δ Deck (up to 2)
      f[pre+'amalgNear'] = 0;
      if (G.allowEvolutions !== false && (p.evolutions||[]).length && !(p.delta && p.delta.length)) {
        var vals = {}; [p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank].forEach(function(c){ if (c && c.type === 'numeral') vals[c.numeral] = (vals[c.numeral] || 0) + 1; });
        // (weighted by what the Evolution is worth: a high Amalgamation is worth building toward, a low one barely)
        p.evolutions.forEach(function(e){ f[pre+'amalgNear'] = Math.max(f[pre+'amalgNear'], Math.min(2, vals[e.numeral] || 0) * (1 + (e.numeral || 0) / 3)); });
      }
      f[pre+'amalg'] = 0; try { if (G.allowEvolutions !== false && (p.evolutions||[]).length && !(p.delta && p.delta.length) && window.findAmalgamationOptionsAI1) f[pre+'amalg'] = window.findAmalgamationOptionsAI1(p === me ? w : o).length ? 1 : 0; } catch(e) {}
      f[pre+'areaDead'] = (p.deadzone||[]).filter(function(c){ return c && c.type === 'area'; }).length;
      // numerals in hand that are a legal promotion over the current Rank Zone card (NP +1..+3 at Rank +0/+1, or
      // the same NP at Rank +1) — 0 means rank-locked
      var rz = p.rankZone, cNP = rz ? (rz.numeral != null ? rz.numeral : (rz.currentNP || 0)) : 0, cRP = rz ? (rz.rank != null ? rz.rank : (rz.currentRP || 0)) : 0;
      f[pre+'promo'] = (p.hand||[]).filter(function(c){ if (!c || c.type !== 'numeral') return false; var nd = (c.numeral||0) - cNP, rd = (c.rank||0) - cRP; return (nd >= 1 && nd <= 3 && rd >= 0 && rd <= 1) || (nd === 0 && rd === 1) || (c.rank||0) >= 4; }).length;
      f[pre+'handNP'] = (p.hand||[]).reduce(function(m, c){ return c && c.type === 'numeral' ? Math.max(m, c.numeral || 0) : m; }, 0);
    }
    side(me, 'm_'); side(op, 'o_');
    // Threats on the board as it stands: the best Morale damage each side's attackers can deal into the other's
    // field (higher NP wins; the loser loses the difference), and how many enemy cards each side's strongest ready
    // attacker would beat.
    function threat(a, d){
      var att = field(a).filter(function(c){ return c.canAttack !== false && !c.frozen; }), tg = field(d).concat(d.delta && d.delta[0] ? [d.delta[0]] : []);
      var best = 0, beats = 0, top = att.reduce(function(m, c){ return Math.max(m, npOf(c)); }, 0);
      att.forEach(function(c){ tg.forEach(function(t){ var x = npOf(c) - npOf(t); if (x > best) best = x; }); });
      tg.forEach(function(t){ if (top > npOf(t)) beats++; });
      return { dmg: best, beats: beats };
    }
    var tm = threat(me, op), to = threat(op, me);
    f.m_threat = tm.dmg; f.o_threat = to.dmg; f.m_beats = tm.beats; f.o_beats = to.beats;
    // A fuller threat: every ready attacker, strongest first, attacks the target it beats by the most; a beaten target
    // is gone (sent to the Deadzone) — the total Morale damage, and how many attackers are ready.
    function threat2(a, d){
      var att = field(a).filter(function(c){ return c.canAttack !== false && !c.frozen; }).map(npOf).sort(function(x, y){ return y - x; });
      var tg = field(d).map(npOf), dmg = 0;
      att.forEach(function(np){
        var bi = -1, bx = 0;
        for (var i = 0; i < tg.length; i++) { var x = np - tg[i]; if (x > bx) { bx = x; bi = i; } }
        if (bi >= 0) { dmg += bx; tg.splice(bi, 1); }
      });
      return { dmg: dmg, n: att.length };
    }
    var t2m = threat2(me, op), t2o = threat2(op, me);
    f.m_threat2 = t2m.dmg; f.o_threat2 = t2o.dmg; f.m_attackers = t2m.n; f.o_attackers = t2o.n;
    f.lowlands = lowlands() ? 1 : 0;
    f.tempo = G.turn === w ? 1 : (G.turn === o ? -1 : 0);        // whose turn it is (antisymmetric)
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
      area: f.m_areaDead - f.o_areaDead, maxNP: f.m_maxNP - f.o_maxNP, tempo: f.tempo,
      mpRaw: f.m_mp - f.o_mp, casRaw: f.m_cas - f.o_cas, deckRaw: f.m_deck - f.o_deck,
      threat: f.m_threat - f.o_threat, beats: f.m_beats - f.o_beats,
      threatT: f.tempo * (f.tempo > 0 ? f.m_threat : f.o_threat),    // the side to move gets to use its threat first
      // v2 terms (rules knowledge: where Morale / Casualties / Deck become dangerous, rank-lock, lethal threats)
      mpLow: Math.min(Math.max(f.m_mp, 0), 12) - Math.min(Math.max(f.o_mp, 0), 12),
      mpHigh: Math.max(0, f.m_mp - 60) - Math.max(0, f.o_mp - 60),
      casHigh: Math.max(0, f.m_cas - 8) - Math.max(0, f.o_cas - 8),
      casNeg: Math.max(0, -f.m_cas) - Math.max(0, -f.o_cas),
      deckLow: Math.max(0, 10 - f.m_deck) - Math.max(0, 10 - f.o_deck),
      promo: Math.min(f.m_promo, 2) - Math.min(f.o_promo, 2),
      locked: (f.m_promo ? 0 : 1) - (f.o_promo ? 0 : 1),
      nums: f.m_nums - f.o_nums, areas: f.m_areas - f.o_areas, amalg: (f.m_amalg || 0) - (f.o_amalg || 0), amalgNear: (f.m_amalgNear || 0) - (f.o_amalgNear || 0), deltaNP: (f.m_deltaNP || 0) - (f.o_deltaNP || 0),
      lethal: (f.tempo > 0 ? (f.m_threat >= f.o_mp ? 1 : 0) : -(f.o_threat >= f.m_mp ? 1 : 0)),
      threat2: (f.m_threat2 || 0) - (f.o_threat2 || 0), attackers: (f.m_attackers || 0) - (f.o_attackers || 0),
      threat2T: f.tempo * (f.tempo > 0 ? (f.m_threat2 || 0) : (f.o_threat2 || 0)),
      lethal2: (f.tempo > 0 ? ((f.m_threat2 || 0) >= f.o_mp ? 1 : 0) : -((f.o_threat2 || 0) >= f.m_mp ? 1 : 0)),
      danger: (f.o_threat >= f.m_mp ? 1 : 0) - (f.m_threat >= f.o_mp ? 1 : 0)
    };
  }
  // Starting weights (units: ~2 per Morale point at 15 MP). The Deck is a resource (deck-out loses), worth much more
  // below 10 cards; a threat that can finish the other side next turn counts for whoever holds it.
  var W0 = { mv: 1, cv: 1, deck: 1, rank: 1.2, rankRP: 0, flank: 0.6, fieldN: 2.0, hand: 0.8, bank: 0.5, actions: 0.7, area: 0, maxNP: 0,
    deckRaw: 0.25, deckLow: -2.5, lethal: 20, danger: -10, delta: 4, deltaNP: 1.5, amalg: 3, amalgNear: 1 };
  // Value of the position for w: in a 1v1, w against its opponent; with more seats, the mean of w against each other
  // seat (an eliminated opponent is a pair already won), so every opponent's strength counts. w eliminated = lost.
  var PAIR_WON = 400;
  // Judgment noise (a weaker tier's skill): every position the bot judges is misjudged by a random amount (sd NOISE,
  // evaluation units), drawn from the bot's own stream — in its search and in its prompt answers alike. Wins and
  // losses are never misjudged.
  var NOISE = 0, NR = null;
  function gauss(){ var u = 0, v = 0; while (!u) u = NR(); v = NR(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function evaluate(w){
    var v = evaluate0(w);
    return (NOISE && v > -1e5 && v < 1e5) ? v + NOISE * gauss() : v;
  }
  function evaluate0(w){
    if (G.gameOver) { var win = G.__winner; return win === w ? 1e6 : (win && win !== 'draw' ? -1e6 : 0); }
    if (out(w)) return -1e6;
    var wt = (W && W.w) || W0, all = seats().filter(function(s){ return s !== w; }), sum = 0;
    all.forEach(function(o){
      if (out(o)) { sum += PAIR_WON; return; }
      var t = terms(features(w, o)), v = 0;
      for (var k in t) v += (wt[k] || 0) * t[k];
      sum += v;
    });
    return all.length ? sum / all.length : 0;
  }


  // ── hidden information ──
  function shuffleArr(a, r){ for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function mb(s){ return function(){ s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Re-deal what seat w cannot know, AT THE CURRENT POINT (everything already seen stays exactly as it is): the
  // opponent's unknown hand cards and both decks are re-dealt from the same cards, and future random rolls are
  // re-seeded. known: ids of opponent hand cards w has seen go there (they stay). Arrays are refilled in place —
  // a prompt that is open mid-action may hold a reference to them.
  function refill(arr, items){ arr.length = 0; for (var i = 0; i < items.length; i++) arr.push(items[i]); }
  // known: { seat: { id: 1 } } — each opponent's hand cards w has seen.
  function determinize(w, r, known){
    var me = G[w];
    seats().forEach(function(o){
      if (o === w) return;
      var op = G[o], kn = (known && known[o]) || {};
      var hand = op.hand || [], slots = [], pool = [];
      hand.forEach(function(c, i){ if (!(c && kn[c.id])) { slots.push(i); pool.push(c); } });
      pool = pool.concat(op.deck || []); shuffleArr(pool, r);
      var nh = hand.slice(); slots.forEach(function(i, k){ nh[i] = pool[k]; });
      refill(hand, nh); if (op.deck) refill(op.deck, pool.slice(slots.length));
    });
    if (me.deck) refill(me.deck, shuffleArr(me.deck.slice(), r));
    var st = window.ruRngState(); st.g = Math.floor(r() * 4294967296) | 0; st.ai = Math.floor(r() * 4294967296) | 0; window.ruRngRestore(st);
  }
  // Which cards in each seat's hand the OTHER seat has seen (they went to the hand from a public zone).
  var seenInHand = {}, lastPublic = {};
  function publicIds(){
    var o = {};
    seats().forEach(function(s){ var p = G[s]; if (!p) return;
      [].concat(field(p), p.discard || [], p.deadzone || [], p.bank || [], p.delta || []).forEach(function(c){ if (c) o[c.id] = 1; }); });
    return o;
  }
  function trackSeen(){
    if (!G || !G.player) return;
    seats().forEach(function(s){
      var k = seenInHand[s] = seenInHand[s] || {}, now = {};
      (G[s].hand || []).forEach(function(c){ if (!c) return; now[c.id] = 1; if (lastPublic[c.id]) k[c.id] = 1; });
      Object.keys(k).forEach(function(id){ if (!now[id]) delete k[id]; });
    });
    lastPublic = publicIds();
  }
  // What seat w can SEE (public zones, its own hand, counts of hidden things, the pending decision).
  function visSig(w){
    var me = G[w];
    function ids(a){ return (a||[]).map(function(c){ return c && (c.id + ':' + npOf(c) + ':' + rpOf(c)); }).join(','); }
    function pub(p){ return [p.mp, p.cas, ids([p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank]), ids(p.discard), ids(p.deadzone), (p.bank||[]).length, (p.deck||[]).length, (p.hand||[]).length, (p.delta||[]).length].join('|'); }
    var d = __M.decider();
    return [G.turn, G.phase, G.mode, G._turnNo || 0, pub(me), ids(me.hand)].concat(opps(w).map(function(o){ return o + ':' + pub(G[o]); })).concat([d.kind, d.seat || '', d.n || 0]).join('#');
  }

  // ── engine stepping ──
  function settle(){ if (window.__settle) window.__settle(); }
  // Thinking budget. Time mode: 'end' is a real-time instant. Fixed mode (opts.fixed): 'end' counts positions
  // evaluated, so the same position always gets the same thought on any machine (reproducible games, device-
  // independent strength). 'max' is a hard cap on positions in both modes; 'hard' a real-time safety stop.
  function bnow(b){ return b.fixed ? b.evals : NOW(); }
  function bover(b){ return b.evals >= b.max || bnow(b) > b.end || (b.hard && NOW() > b.hard); }
  // The effort spent is counted where the work happens: every input applied (1) and every position restored (½) —
  // replays to rebuild a mid-action position included — so a budget of N means the same work in every position.
  var CUR = null;      // the budget being spent (set by a plan)
  function rewind(s){ if (CUR) CUR.evals += 0.5; __S.restore(s); if (window.__dropTimeouts) window.__dropTimeouts(); }
  // an input, applied in the order every screen applies one: settle, the pre-input checkpoint, the input
  function apply(a){ if (CUR) CUR.evals++; try { ruCanApplyNow({}); ruApplyAction(a); } catch(e) {} settle(); }
  function dec(){ return __M.decider(); }
  function isOver(d){ return d.kind === 'over' || d.kind === 'none'; }
  function key(a){ return JSON.stringify(a); }

  // Finish a mid-flow position until quiet: the mover's own answers best-first (one step), the other player's worst-
  // for-the-mover. 'rebuild' recreates the mid-flow position. Returns the answers chosen (to extend the line), or null.
  // A prompt situation seen before in this flow means an answer led round in a circle (choose a skill → cancel → the
  // same window again): answers that lead back to a seen situation are skipped, so the flow always moves on.
  function promptKey(){ var d = dec(); return d.kind + '|' + (d.seat || '') + '|' + (d.title || '') + '|' + (d.labels || []).join('/') + '|' + ruStateSig(); }
  // What a prompt looks like to the seat answering it (kind, title, buttons / picker size). A planned answer carries
  // the prompt it was chosen for (pk) and is only ever given to that same prompt.
  function promptSig(d){ d = d || dec(); return d.kind === 'modal' ? 'm|' + (d.title || '') + '|' + (d.labels || []).join('/') : d.kind === 'pick' ? 'p|' + (d.title || '') + '|' + (d.n || 0) + '|' + (d.min || 0) + '-' + (d.max || 0) : ''; }
  function tagPrompt(a, d){ if (a && (a.t === 'modal' || a.t === 'pick')) a.pk = promptSig(d); return a; }
  var PASSY = /^(Pass|Skip|Decline|No|Close|Cancel|Keep|Continue|Done)/i;
  function finishFlow(w, rebuild, budget, cheap){
    var seq = [], seen = new Set(), atPrompt = true;      // atPrompt: the live position is rebuild + seq (no trial applied)
    cheap = cheap || budget.cheap;
    function back(){ rebuild(); for (var q = 0; q < seq.length; q++) apply(seq[q]); atPrompt = true; }
    for (var guard = 0; guard < 40; guard++) {
      if (G.gameOver || __S.quiet()) return seq;
      var d = dec(); if (isOver(d)) return seq;
      seen.add(promptKey());
      var L = __M.candidates(d.seat); if (!L.length) return null;
      var choice = null;
      if (L.length === 1) choice = L[0];
      // cheap mode (completing a line, not choosing one): the other player passes on optional prompts
      if (!choice && cheap && d.seat !== w && d.kind === 'modal') {
        var pi = (d.labels || []).findIndex(function(l){ return PASSY.test(String(l).trim()); });
        if (pi >= 0) choice = { t: 'modal', i: pi, s: d.seat };
      }
      if (choice) { seq.push(tagPrompt(choice, d)); apply(choice); continue; }
      var best = null, bestV = 0, bestIdx = -1;
      if (bnow(budget) > budget.end) L = L.slice(0, Math.min(L.length, 2));
      for (var i = 0; i < L.length; i++) {
        if (!atPrompt) back();                 // the first answer is tried on the live position; later ones rebuild it
        apply(L[i]); atPrompt = false;
        if (!G.gameOver && !__S.quiet() && seen.has(promptKey())) continue;     // back where we were: a circle
        var v = evaluate(w);
        if (best === null || (d.seat === w ? v > bestV : v < bestV)) { best = L[i]; bestV = v; bestIdx = i; }
      }
      if (!best) { best = L[L.length - 1]; bestIdx = L.length - 1; }   // every answer circles: take the last (Pass / Cancel sit last)
      // the live position is already "seq + best" when the best was the last answer tried; otherwise rebuild it
      if (!(bestIdx === L.length - 1 && !atPrompt)) { back(); apply(best); }
      seq.push(tagPrompt(best, d)); atPrompt = true;   // live = rebuild + seq again
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
    if (!applied) { rewind(base); apply(input); }
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
    // one complete action per move (attack: attacker → target); a further attack is the next move of the phase search
    if (!inMode || depth >= 2) { cb(inputs, { base: base, tail: inputs }); return; }
    // a board mode for the mover: each way to complete it is a move of its own
    var modeSnap = __S.snap(), sig = ruStateSig();
    var C = __M.candidates(mover).filter(function(c){ return c.t !== 'cancel'; });
    var dirty = false;
    for (var i = 0; i < C.length && budget.evals < budget.max; i++) {
      if (dirty) { rewind(modeSnap); dirty = false; }
      apply(C[i]);
      if (__S.quiet() && !G.gameOver && ruStateSig() === sig) continue;     // refused
      dirty = true;
      (function(c){ expand(mover, modeSnap, c, budget, function(more, rec){ cb(inputs.concat(more), rec); }, depth + 1, true); })(C[i]);
    }
  }
  function materialize(rec){ rewind(rec.base); for (var i = 0; i < rec.tail.length; i++) apply(rec.tail[i]); return __S.snap(); }

  // Search the mover's turn from a quiet root, PHASE BY PHASE. A turn is a sequence of phases (draw → promotion →
  // rally → main → standby → battle → end); advancing a phase changes nothing the evaluation can see, so a search
  // that pruned whole lines by value as it went would starve the later phases (battle above all) — lines that
  // "do something" now always look better than lines that move on. Instead each phase is searched on its own: the
  // moves within the phase (a few deep), and every position reached may leave the phase; the best positions that
  // left it start the next phase. Passes widen while time remains (the first pass is quick and always finishes
  // turns). Returns the best complete line per first move, sorted by v (desc):
  // [{ first, steps:[{ inputs:[...], vis: visible sig after the step, opp: the other player answered in it }], v, end }]
  function isLeave(c){ return c.t === 'adv' || c.t === 'end' || c.t === 'sdDone'; }
  // The ACTION a line starts with — what the bot commits to when it plays the line: the first input and the mover's
  // own inputs that complete it before anything else happens (attack mode → the attacker → the target). It ends at
  // the first prompt answer, the first input of another seat, or leaving a board mode: from there on, what happens
  // depends on what is revealed (a Casualty Draw, the other player's answer), so it is decided again then. Lines
  // are compared by this action, across every world imagined — never by one world's continuation.
  function actionOf(inputs, mover){
    var out = [inputs[0]];
    for (var i = 1; i < inputs.length; i++) {
      var x = inputs[i];
      if ((x.s && x.s !== mover) || x.t === 'modal' || x.t === 'pick' || x.t === 'cancel' || isLeave(x)) break;
      out.push(x);
    }
    return out;
  }
  // Keep B positions: the best of the leading first-move groups first (so different starts survive), then by value.
  function beam(list, B){
    list = list.filter(function(x, i){ return list.indexOf(x) === i; });
    list.sort(function(a, b){ return b.v - a.v; });
    var out = [], used = new Set(), groups = new Set(), half = Math.max(1, Math.ceil(B / 2));
    for (var i = 0; i < list.length && groups.size < half; i++) if (!groups.has(list[i].firstKey)) { groups.add(list[i].firstKey); used.add(i); out.push(list[i]); }
    for (var j = 0; j < list.length && out.length < B; j++) if (!used.has(j)) out.push(list[j]);
    return out;
  }
  // The quick opponent model for simulated future turns: develop and attack. Switchdraw is skipped, the Main and
  // Standby phases are passed through, and the moves that make a turn dangerous — promoting, flanking, attacking —
  // are searched. (A full search of a future turn on the small share of effort it gets never reached the Battle
  // Phase: every simulated opponent just ended its turn, and lines looked safe that a real opponent would punish.)
  var QUICK = { draw: { sdDone: 1 }, promotion: { promote: 1, maxPromote: 1, relieveHand: 1, adv: 1, end: 1 }, rally: { flank: 1, maxFlank: 1, relieveHand: 1, adv: 1, end: 1 },
    main: { adv: 1, end: 1 }, standby: { adv: 1, end: 1 }, battle: { atkMode: 1, direct: 1, end: 1, cancel: 1, zone: 1 }, end: { adv: 1, end: 1 } };
  function quickOK(c){ var ph = QUICK[G.phase]; if (!ph) return true; if (G.mode && G.mode !== 'normal' && G.mode !== 'switchdraw') return true; return !!ph[c.t]; }
  function searchPass(mover, root, B, depthCap, budget, out, quick){
    var seen = new Set(); rewind(root); seen.add(ruStateSig());
    function record(n){
      var o = out.get(n.firstKey);
      if (!o || n.v > o.v) out.set(n.firstKey, { first: n.first, fk: n.firstKey, action: n.action, steps: n.steps, v: n.v, rec: n.rec, end: null, done: true });
    }
    var frontier = [{ snap: root, rec: null, steps: [], firstKey: null, first: null, action: null, v: evaluate(mover) }];
    var unexpanded = [];        // positions still in the mover's turn that time did not let us search further
    for (var pg = 0; pg < 14 && frontier.length; pg++) {
      var leaving = [], layer = frontier, next = [];
      for (var depth = 0; depth <= depthCap && layer.length; depth++) {
        next = [];
        for (var f = 0; f < layer.length; f++) {
          if (bover(budget)) { unexpanded = unexpanded.concat(layer.slice(f)); break; }
          var node = layer[f];
          if (!node.snap) node.snap = materialize(node.rec);
          rewind(node.snap);
          var ph0 = G.phase, sig0 = ruStateSig(), dirty = false;
          var C = __M.candidates(mover);
          for (var i = 0; i < C.length; i++) {
            if (bover(budget)) break;
            if (quick && !quickOK(C[i])) continue;
            // (leaving a board mode — e.g. attack mode once no attacker is left — is a move like any other: the
            // position it returns to is new, and one already reached is skipped)
            if (depth === depthCap && !isLeave(C[i])) continue;       // deep enough in this phase: only move on
            if (dirty) { rewind(node.snap); dirty = false; }
            apply(C[i]);
            if (__S.quiet() && !G.gameOver && ruStateSig() === sig0) continue;   // refused: nothing changed
            dirty = true;
            (function(node, ph0){
              expand(mover, node.snap, C[i], budget, function(inputs, rec){
                var d = dec();
                // still in a board mode once its moves are done (e.g. attack mode after the attack): leave the mode,
                // so the position can go on (end the turn, move to the next phase) like any other
                if (!G.gameOver && __S.quiet() && d.kind === 'turn' && d.seat === mover && d.mode && d.mode !== 'normal' && d.mode !== 'switchdraw') {
                  var cz = { t: 'cancel', s: mover }, sgm = ruStateSig(); apply(cz);
                  if (ruStateSig() !== sgm || !__S.quiet()) { inputs = inputs.concat([cz]); rec = { base: rec.base, tail: rec.tail.concat([cz]) }; }
                  if (!__S.quiet() && !G.gameOver) return;         // leaving the mode opened a prompt: not a clean line
                  d = dec();
                }
                var sg = ruStateSig();
                if (!G.gameOver && seen.has(sg)) return;         // reached before (a cycle, or a duplicate line)
                seen.add(sg);
                var step = { inputs: inputs, vis: visSig(mover), opp: inputs.some(function(x){ return x.s && x.s !== mover; }) };
                var act = node.action || actionOf(inputs, mover);
                var child = { snap: null, rec: rec, steps: node.steps.concat([step]), firstKey: node.firstKey || key(act.map(bare)), first: node.first || inputs[0], action: act, v: evaluate(mover) };
                if (G.gameOver || isOver(d) || G.turn !== mover) record(child);
                else if (G.phase !== ph0) leaving.push(child);
                else next.push(child);
              }, 0, true);
            })(node, ph0);
          }
        }
        if (budget.trace) budget.trace.push('B' + B + ' pg' + pg + ' d' + depth + ' ph ' + (layer[0] && layer[0].snap ? '' : '') + ' layer ' + layer.length + ' -> next ' + next.length + ' leaving ' + leaving.length + ' done ' + out.size + ' bestNext ' + (next.length ? Math.max.apply(null, next.map(function(x){ return x.v; })).toFixed(1) : '-') + ' bestLeave ' + (leaving.length ? Math.max.apply(null, leaving.map(function(x){ return x.v; })).toFixed(1) : '-') + ' evals ' + budget.evals + ' t ' + (NOW() - budget.t0));
        layer = beam(next, B);
      }
      if (bover(budget)) { unexpanded = unexpanded.concat(layer, leaving); frontier = []; break; }
      frontier = beam(leaving, B);
      if (budget.trace && frontier.length) { rewind(frontier[0].snap || materialize(frontier[0].rec)); budget.trace.push('  -> next phase ' + G.phase + ' (' + G.turn + ')'); }
    }
    // Positions still in the mover's turn (time ran out before they were searched further) are finished quickly —
    // the most promising first (always the best two), so a strong position found late (an attack) is never lost.
    var rest = beam(unexpanded.concat(frontier), Math.max(2 * B, 4));
    rest.forEach(function(n, idx){
      if (budget.evals >= budget.max || (budget.hard && NOW() > budget.hard) || (idx >= 2 && bnow(budget) > budget.end + (budget.fixed ? 30 : 50))) return;
      var fin = finishTurn(mover, n.snap || materialize(n.rec), budget);
      if (fin) { var o = out.get(n.firstKey); if (!o || fin.v > o.v) out.set(n.firstKey, { first: n.first, fk: n.firstKey, action: n.action, steps: n.steps.concat(fin.steps), v: fin.v, rec: null, end: fin.end, done: true }); }
    });
  }
  function turnSearch(mover, root, cfg, budget){
    var out = new Map(), tMain = bnow(budget), tReal = NOW();
    var passes = cfg.greedy ? [[1, 2]] : [[2, 2], [4, 3], [Math.max(6, (cfg.width || 2) * 3), 4], [Math.max(10, (cfg.width || 2) * 5), 5]];
    for (var k = 0; k < passes.length; k++) {
      if (k > 0 && bover(budget)) break;
      var saved = budget.end;
      // the first pass may run over the budget (bounded) so it always reaches the end of the turn
      if (k === 0) budget.end = Math.max(budget.end, tMain + 2.5 * Math.max(budget.fixed ? 30 : 50, budget.end - tMain));
      searchPass(mover, root, passes[k][0], passes[k][1], budget, out, !!cfg.quick);
      budget.end = saved;
    }
    if (budget.tm) { budget.tm.main += NOW() - tReal; budget.tm.calls++; }
    var lines = [];
    out.forEach(function(l){ if (!l.end) l.end = l.rec ? materialize(l.rec) : null; lines.push(l); });
    lines.sort(function(a, b){ return b.v - a.v; });
    return lines;
  }

  // Play the rest of the mover's turn quickly: advance (adv / end) each phase; when that is refused (e.g. an
  // Advantageous Action Card obliges an attack first) play the best real move instead. Returns { steps, v, end }.
  function finishTurn(mover, snap, budget){
    rewind(snap); var steps = [], cur = snap;
    for (var g = 0; g < 16; g++) {
      if (G.gameOver || G.turn !== mover) break;
      var d = dec(); if (isOver(d)) break;
      if (!__S.quiet()) return null;
      cur = __S.snap();
      var sig = ruStateSig();
      var a = { t: (d.mode && d.mode !== 'normal') ? 'cancel' : (d.phase === 'battle' || d.phase === 'end' ? 'end' : 'adv'), s: mover };
      apply(a);
      if (!G.gameOver && __S.quiet() && ruStateSig() === sig) { rewind(cur); a = { t: 'end', s: mover }; apply(a); }
      if (!G.gameOver && __S.quiet() && ruStateSig() === sig) {
        // advancing is refused: the best real move (attacks included) instead
        rewind(cur);
        var bestM = null, bestV = -Infinity, C = __M.candidates(mover);
        for (var i = 0; i < C.length; i++) {
          if (C[i].t === 'adv' || C[i].t === 'end' || C[i].t === 'cancel') continue;
          expand(mover, cur, C[i], budget, function(inputs, rec){ var v = evaluate(mover); if (v > bestV && ruStateSig() !== sig) { bestV = v; bestM = { inputs: inputs, rec: rec }; } }, 0, false);
        }
        if (!bestM) return null;
        rewind(materialize(bestM.rec));
        steps.push({ inputs: bestM.inputs, vis: visSig(mover), opp: bestM.inputs.some(function(x){ return x.s && x.s !== mover; }) });
        continue;
      }
      if (!__S.quiet() && !G.gameOver) {
        var cs = cur, aa = a;
        var ans = finishFlow(mover, function(){ rewind(cs); apply(aa); }, budget, true);
        if (!ans) return null;
        steps.push({ inputs: [a].concat(ans), vis: visSig(mover), opp: true });
      } else steps.push({ inputs: [a], vis: visSig(mover), opp: false });
    }
    return { steps: steps, v: evaluate(mover), end: __S.quiet() ? __S.snap() : null };
  }

  // Play 'turns' more turns from a quiet snapshot, each side by its own planner (a fast greedy line of play), until
  // the time 'until'; each turn gets an even share of what is left. Returns the horizon value for 'judge', or null
  // when not even one turn could be played (the caller then ranks the line below the looked-ahead ones).
  function lookahead(judge, snap, turns, cfg, budget, until){
    rewind(snap);
    var saved = budget.end, played = 0, savedCheap = budget.cheap; budget.cheap = true;
    for (var t = 0; t < turns && !G.gameOver; t++) {
      if (!__S.quiet()) break;
      var now = bnow(budget); if (now >= until && played > 0) break;
      budget.end = now + Math.max(5, (until - now) / (turns - t));
      var mover = dec().seat || G.turn;
      var lines = turnSearch(mover, __S.snap(), cfg.future, budget);
      // the best line that ends at a clean point (a line can end mid-flow — then there is no position to go on from)
      var next = null; for (var q = 0; q < lines.length && !next; q++) if (lines[q].end) next = lines[q];
      if (!next) break;
      rewind(next.end); played++;
    }
    budget.end = saved; budget.cheap = savedCheap;
    return played > 0 || G.gameOver ? evaluate(judge) : null;
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
      if (!fits(nx, dec())) { cache = null; return null; }         // what opened (or didn't) differs from the plan's world
      cache.ii++; return bare(nx);
    }
    // the step is complete: continue only if nobody else had a say and the bot sees what the plan expected
    if (st.opp || st.vis == null || st.vis !== visSig(w)) { cache = null; return null; }
    cache.si++; cache.ii = 0;
    var ns = cache.steps[cache.si];
    if (!ns || !ns.inputs.length || (ns.inputs[0].s && ns.inputs[0].s !== w)) { cache = null; return null; }
    if (!cardThere(w, ns.inputs[0]) || !fits(ns.inputs[0], dec())) { cache = null; return null; }
    cache.ii = 1; return bare(ns.inputs[0]);
  }
  // Does a planned input fit the decision actually in front of the bot? A prompt answer only fits the same prompt.
  function fits(a, d){
    if (!a || !d) return false;
    if (a.t === 'modal' || a.t === 'pick') return d.kind === (a.t === 'modal' ? 'modal' : 'pick') && !!a.pk && a.pk === promptSig(d);
    if (d.kind !== 'turn') return false;
    if (a.t === 'sd' || a.t === 'sdDone') return d.mode === 'switchdraw';
    return true;
  }
  function bare(a){ if (!a || a.pk == null) return a; var c = {}; for (var k in a) if (k !== 'pk') c[k] = a[k]; return c; }
  // Does the card an input names actually exist on the mover's side right now?
  function cardThere(w, a){
    if (!a || !a.id || a.t === 'areaFx') return true;
    var p = G[w]; if (!p) return false;
    var all = [].concat(p.hand||[], p.bank||[], p.discard||[], p.deadzone||[], p.delta||[], [p.rankZone, p.leftFlank, p.rightFlank, p.rearFlank]);
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].id === a.id) return true;
    return false;
  }
  // When there is nothing to choose between: an input the engine accepts here, passing (Done / advance / end) first.
  function fallback(w){
    var L = __M.legal(w); if (!L.length) return __M.candidates(w)[0] || null;
    var pass = L.find(function(a){ return a.t === 'sdDone' || a.t === 'adv' || a.t === 'end'; });
    return pass || L[0];
  }
  function noteApplied(a){ trackSeen(); if (__S.quiet()) { live.quiet = __S.snap(); live.path = []; } else if (a) live.path.push(a); }

  function plan(w, opts){
    opts = opts || {};
    var N = Math.max(1, opts.N || 1), t0 = NOW();
    var cfg = { own: { width: opts.width || 3, maxDepth: opts.maxDepth || 18 }, future: { width: opts.futureWidth || 1, maxDepth: opts.maxDepth || 18, greedy: true, quick: opts.quickFuture !== false } };
    var fixed = !!opts.fixed;
    var budget = fixed
      ? { fixed: true, evals: 0, end: opts.evals || 3000, max: 3 * (opts.evals || 3000) + 2000, hard: t0 + (opts.safetyMs || 60000), tm: { main: 0, fin: 0, calls: 0, groups: 0, worlds: 0, flow: 0 } }
      : { evals: 0, max: opts.maxEvals || 20000, end: t0 + (opts.ms || 20000), tm: { main: 0, fin: 0, calls: 0, groups: 0, worlds: 0, flow: 0 } };
    var d = dec(); if (isOver(d) || d.seat !== w) return null;
    CUR = budget;
    NOISE = +opts.noise || 0; NR = NOISE ? mb((((opts.seed >>> 0) || 1) ^ 0x9e3779b9) >>> 0) : null;
    // explain (debugging): think this decision afresh — not by the plan being followed — and keep that plan
    var kept = cache; if (opts.explain) cache = null;
    try { return planWith(w, opts, N, cfg, budget, t0); } finally { CUR = null; NOISE = 0; NR = null; if (opts.explain) cache = kept; }
  }
  function planWith(w, opts, N, cfg, budget, t0){

    // 1) follow the current plan while what it expected is what the bot sees
    var follow = followPlan(w); if (follow) return { move: follow, why: 'plan', evals: 0 };

    // 2) a forced decision takes no thought: the only legal input; or, while switchdraws are mandatory (the first
    //    turn's Action Cards — "Done" is refused), the next switch (every one of them must go, so order is no choice)
    var d = dec();
    if (__S.quiet() || d.kind === 'modal' || d.kind === 'pick') {
      var LG =__S.quiet() ? __M.legal(w) : __M.candidates(w);
      if (LG.length === 1) return { move: LG[0], why: 'only', evals: 0 };
      if (d.kind === 'turn' && d.mode === 'switchdraw' && LG.length && !LG.some(function(a){ return a.t === 'sdDone'; })) {
        var sw = LG.filter(function(a){ return a.t === 'sd'; });
        if (sw.length) return { move: sw[0], why: 'forced', evals: 0 };
      }
    }

    var quietNow = __S.quiet();
    if (!quietNow && !live.quiet) return { move: fallback(w), why: 'no anchor' };
    var anchor = quietNow ? __S.snap() : live.quiet, path = quietNow ? [] : live.path.slice();
    var known = seenInHand;
    // How the bot thinks about a decision:
    //  1. FIND the actions worth comparing: the whole turn searched in one imagined world — every action the bot could
    //     take now, each completed by the best play after it — and the best few kept, with the best way to pass. (At a
    //     prompt, the actions are simply its answers.)
    //  2. SCORE every one of them in every world imagined (what w cannot see re-dealt each time): the action, then the
    //     best play after it in that world, then N-1 more turns. Every world scores every action, each with an even
    //     share of the thinking — so the actions are compared on the same deals (paired), never one action's lucky
    //     world against another's ordinary ones, and no world spends the thinking the others need.
    // Worlds are added until the best action is clearly ahead of the next best. An action that is not clearly better
    // than simply passing (Done / advance / end) loses to passing — acting on luck-noise is how a search talks itself
    // into bad plays.
    var minW = opts.worlds || 3, maxW = opts.maxWorlds || Math.max(minW, minW * 4);
    var tStart = bnow(budget), total = budget.end - tStart;
    var ownFrac = N > 1 ? (opts.ownFrac || 0.45) : 1;
    var disc = quietNow ? 1 : 0, share = total / (minW + disc);   // (finding the actions takes one share of its own)
    var S = null, agg = new Map(), nW = 0;     // agg: action key → { act, line, vals: [its value in each world], sum, sq, n }
    for (var k = 0; k < maxW; k++) {
      if (k >= minW && bnow(budget) > tStart + total) break;
      if (budget.evals >= budget.max || (budget.hard && NOW() > budget.hard)) break;
      // the real position (anchor + the inputs since), then everything w cannot see re-dealt
      var mkWorld = (function(sd){ return function(){ rewind(anchor); for (var p = 0; p < path.length; p++) apply(path[p]); determinize(w, mb(sd), known); }; })(((opts.seed >>> 0) || 1) * 7919 + k * 104729);
      mkWorld();
      var dd = dec(); if (isOver(dd) || dd.seat !== w) continue;
      // this world's share of the thinking (on the plan's timeline; never less than most of a share)
      var wEnd = Math.max(k < minW ? tStart + share * (k + 1 + disc) : 0, bnow(budget) + share * 0.6);
      var vals = null;
      if (!S) {
        if (__S.quiet()) {
          budget.end = tStart + share;
          S = candidatesFrom(turnSearch(w, __S.snap(), cfg.own, budget), opts.cands || opts.topK || 6);
          // this world scores them with the search's own lines (the best play after each, found by the larger search)
          budget.end = wEnd; vals = [];
          for (var i = 0; i < S.length; i++) {
            var L = S[i].line, v = L.v, cNow = bnow(budget);
            if (N > 1 && L.end && !(v >= 1e6 || v <= -1e6)) { var la = lookahead(w, L.end, N - 1, cfg, budget, cNow + Math.max(10, (wEnd - cNow) / (S.length - i))); if (la != null) v = la; }
            vals.push(v);
          }
        } else {
          S = __M.candidates(w).map(function(c){ return { kk: key(c), act: [c], line: { first: c, steps: [{ inputs: [c], vis: null, opp: true }] } }; });
        }
        if (!S.length) break;
      }
      if (!vals) {
        budget.end = wEnd; vals = [];
        for (var i2 = 0; i2 < S.length; i2++) {
          var c2 = bnow(budget);
          if (i2 > 0) mkWorld();
          vals.push(scoreAction(w, S[i2].act, mkWorld, N, cfg, budget, c2 + Math.max(10, (wEnd - c2) / (S.length - i2)), ownFrac));
        }
      }
      nW++;
      for (var j = 0; j < S.length; j++) {
        var a = agg.get(S[j].kk) || { act: S[j].act, line: S[j].line, vals: [], sum: 0, sq: 0, n: 0 };
        a.vals.push(vals[j]); a.sum += vals[j]; a.sq += vals[j] * vals[j]; a.n++; agg.set(S[j].kk, a);
      }
      if (nW >= minW && agg.size > 1) {
        var rk = ranked(agg), pd = paired(rk[0].a, rk[1].a);
        if (pd.m > 2 * pd.se) break;          // clearly ahead
      }
    }
    // restore the real position
    rewind(anchor); for (var p2 = 0; p2 < path.length; p2++) apply(path[p2]);
    if (!agg.size) return { move: fallback(w), why: 'no lines' };
    var rkd = ranked(agg), top1 = rkd[0], pass = null;
    rkd.forEach(function(e){ var t = e.a.line.first && e.a.line.first.t; if (!pass && (t === 'sdDone' || t === 'adv' || t === 'end')) pass = e; });
    if (pass && pass !== top1) { var bp = paired(top1.a, pass.a); if (bp.m <= bp.se) top1 = pass; }   // not clearly better than holding
    var best = { m: top1.m, line: top1.a.line };
    // Skill: a lower tier does not always play its best line. 'temp' (in evaluation units) makes worse lines
    // proportionally less likely — near-equal lines get confused, clearly worse ones rarely. Drawn from the bot's own
    // stream (opts.seed), never the game's.
    if (opts.temp > 0 && agg.size > 1) {
      var opts2 = []; agg.forEach(function(a, kk){ opts2.push({ m: a.sum / a.n, line: a.line }); });
      var top = Math.max.apply(null, opts2.map(function(o){ return o.m; }));
      var ws = opts2.map(function(o){ return Math.exp(Math.max(-50, (o.m - top) / opts.temp)); }), tot = ws.reduce(function(x, y){ return x + y; }, 0);
      var rr = mb(((opts.seed >>> 0) || 1) * 2654435761 >>> 0)() * tot;
      for (var q = 0; q < opts2.length; q++) { rr -= ws[q]; if (rr <= 0) { if (opts2[q].m < best.m) best = { m: opts2[q].m, line: opts2[q].line }; break; } }
    }
    var line = best.line;
    // The bot commits to the action it compared across the worlds — and only that: every later decision of the turn
    // is thought about again when it comes (the rest of this line was the best play in ONE imagined world, chosen
    // knowing that world's hidden cards: following it would be playing on a guess as if it were known).
    var act = line.action || [line.first];
    cache = { seat: w, turnNo: G._turnNo || 0, steps: [{ inputs: act, vis: null, opp: true }], si: 0, ii: 1 };
    return { move: bare(line.first), value: best.m, considered: agg.size, evals: budget.evals, ms: NOW() - t0, why: 'search', tm: budget.tm, quietNow: quietNow,
      ranked: opts.explain ? explainRanked(agg) : undefined };
  }
  // The actions to compare, from a searched turn: the best few (by the value of the best play after each), and the
  // best way to pass.
  function candidatesFrom(lines, n){
    var out = [], pass = null;
    lines.forEach(function(L){ var t = L.first && L.first.t; if (!pass && (t === 'sdDone' || t === 'adv' || t === 'end')) pass = L; });
    for (var i = 0; i < lines.length && out.length < n; i++) out.push(lines[i]);
    if (pass && out.indexOf(pass) < 0) out.push(pass);
    return out.map(function(L){ return { kk: L.fk || key(L.first), act: L.action || [L.first], line: L }; });
  }
  // One action, in the world currently set up ('rebuild' sets it up again): the action's own inputs, whatever they open
  // answered (w its best, the others their worst for w), the rest of w's turn played best, then N-1 more turns —
  // its value for w.
  function scoreAction(w, act, rebuild, N, cfg, budget, until, ownFrac){
    var t0 = bnow(budget), done = [act[0]];
    apply(act[0]);
    for (var i = 1; i < act.length; i++) {
      if (G.gameOver || !__S.quiet() || dec().seat !== w) break;   // something opened that the action's own inputs don't answer
      apply(act[i]); done.push(act[i]);
    }
    if (!G.gameOver && !__S.quiet() && !finishFlow(w, function(){ rebuild(); for (var q = 0; q < done.length; q++) apply(done[q]); }, budget)) return evaluate(w);
    var v = evaluate(w), end = !G.gameOver && __S.quiet() ? __S.snap() : null;
    if (end && G.turn === w && dec().seat === w) {
      var saved = budget.end; budget.end = t0 + (until - t0) * ownFrac;
      var rest = turnSearch(w, end, cfg.own, budget);
      budget.end = saved;
      if (rest.length) { v = rest[0].v; end = rest[0].end; }
    }
    if (N > 1 && end && !(v >= 1e6 || v <= -1e6)) { var la = lookahead(w, end, N - 1, cfg, budget, until); if (la != null) v = la; }
    return v;
  }
  function ranked(agg){ var r = []; agg.forEach(function(a, kk){ r.push({ kk: kk, m: a.sum / a.n, a: a }); }); r.sort(function(x, y){ return y.m - x.m; }); return r; }
  // How much better action a scored than action b, world by world: the mean difference and its standard error.
  function paired(a, b){
    var n = Math.min(a.vals.length, b.vals.length), s = 0, s2 = 0;
    for (var i = 0; i < n; i++) { var d = a.vals[i] - b.vals[i]; s += d; s2 += d * d; }
    if (!n) return { m: 0, se: 0 };
    var m = s / n;
    return { m: m, se: n > 1 ? Math.sqrt(Math.max(0, s2 / n - m * m) / (n - 1)) : 0 };
  }
  // explain (debugging): every first move considered, best first — its mean value over the worlds, the standard error,
  // how many worlds, and the line it stood for (the inputs of the turn as planned)
  function explainRanked(agg){
    var r2 = function(x){ return Math.round(x * 100) / 100; }, out = [];
    agg.forEach(function(a){
      var m = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sq / a.n - m * m));
      out.push({ first: bare(a.line.first), m: r2(m), se: r2(sd / Math.sqrt(a.n)), n: a.n,
        line: a.line.steps.map(function(st){ return st.inputs.map(function(i){ return i.t + (i.id ? ':' + i.id : '') + (i.z ? ':' + (i.o || '') + '/' + i.z : '') + (i.i != null ? ':' + i.i : ''); }).join('+'); }).join(' , ') });
    });
    out.sort(function(x, y){ return y.m - x.m; });
    return out.slice(0, 20);
  }

  window.__B = { features: features, terms: terms, evaluate: evaluate, plan: plan, determinize: determinize, noteApplied: noteApplied,
    visSig: visSig, setWeights: function(x){ W = x; }, resetPlan: function(){ cache = null; }, live: live,
    // debugging: one turn search from the live position (no worlds), summarised
    _ts: function(w, cfgx, ms){ var t0 = NOW(); var b = { evals: 0, max: 1e9, end: NOW() + (ms || 8000), trace: [], t0: t0 }; var root = __S.snap(); CUR = b;
      var out = turnSearch(w, root, cfgx || { width: 2, maxDepth: 18 }, b); rewind(root); CUR = null;
      return { lines: out.map(function(l){ return { first: l.first, v: Math.round(l.v * 100) / 100, moves: l.steps.map(function(st){ return st.inputs.map(function(i){ return i.t + (i.z ? ':' + i.o + '/' + i.z : '') + (i.slot ? ':' + i.slot : ''); }).join('+'); }).join(' , '), end: !!l.end }; }), evals: b.evals, ms: NOW() - t0, trace: b.trace }; },
    _finishTurnDebug: function(w){ var b = { evals: 0, max: 1e9, end: NOW() + 8000 }; var root = __S.snap(); var r = finishTurn(w, root, b); var res = r ? { v: r.v, steps: r.steps.map(function(s){ return s.inputs.map(function(i){ return i.t; }).join('+'); }), end: !!r.end } : null; var after = { turn: G.turn, phase: G.phase, quiet: __S.quiet(), dec: __M.decider() }; rewind(root); return { res: res, after: after }; } };
})();
`;

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { BRAIN_CODE: BRAIN_CODE };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; for (var k in m) root.RUAI[k] = m[k]; }
})(typeof self !== 'undefined' ? self : this);
