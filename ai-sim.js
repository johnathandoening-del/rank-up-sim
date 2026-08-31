/* =============================================================================
   ai-sim.js  —  Phase 1 of the "make the AI actually think" rebuild (Report 4).

   A HEADLESS, side-effect-free forward model of Rank Up: clone the game state,
   apply moves in memory (no DOM, no modals, no setTimeout, no logging), and
   enumerate legal moves. This is the keystone the search/eval layers stand on.

   Scope of Phase 1 (deliberately the core game loop, verified against the live
   engine): the CLEAN combat path (the exact rules in resolveAtkBase when no
   defensive state / no Numeral-skill flags fire), plus promotion and rally, plus
   legal-move generation for those. Numeral-skill / Action-card EFFECTS are the
   next phases; the parity harness below proves the core is faithful first.

   Everything lives under window.ruSim so it touches nothing in the live game.
   ========================================================================== */
(function(){
  'use strict';
  if (typeof window !== 'undefined' && window.ruSim) return;

  // ---- card / value helpers (match the live npOf / effRank for CLEAN cards) ----
  function npOf(c){ return c ? (c.currentNP != null ? c.currentNP : (c.numeral || 0)) : 0; }
  function rpOf(c){ return c ? (c.currentRP != null ? c.currentRP : (c.rank || 0)) : 0; }
  function isNumeral(c){ return !!(c && c.type === 'numeral'); }
  function isR3plus(c){ return !!(c && c.type === 'numeral' && (c.rank || 0) >= 3); }

  // ---- state clone: a plain, serialisable snapshot of the rule-relevant state ----
  // Cards are plain data objects; we deep-copy them and the zone arrays. We copy
  // only game facts (no DOM, no closures). Unknown scalar/array/object fields on a
  // side are carried through generically so nothing rule-relevant is dropped.
  function cloneVal(v){
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) { var a = new Array(v.length); for (var i=0;i<v.length;i++) a[i]=cloneVal(v[i]); return a; }
    if (typeof v === 'function') return undefined;               // never clone functions
    var o = {}; for (var k in v){ if(!Object.prototype.hasOwnProperty.call(v,k)) continue; var cv=cloneVal(v[k]); if(cv!==undefined) o[k]=cv; }
    return o;
  }
  var SEAT_KEYS = ['player','ai','ai2'];
  var ZONE_ARRAYS = ['bank','hand','deck','discard','deadzone','delta','evolutions'];
  var ZONE_SLOTS  = ['rankZone','leftFlank','rightFlank','rearFlank'];
  function cloneSide(s){
    if (!s) return null;
    var o = {};
    // scalars / flags first (generic carry-through)
    for (var k in s){
      if(!Object.prototype.hasOwnProperty.call(s,k)) continue;
      if (ZONE_ARRAYS.indexOf(k)!==-1 || ZONE_SLOTS.indexOf(k)!==-1) continue; // handled below
      o[k] = cloneVal(s[k]);
    }
    ZONE_ARRAYS.forEach(function(z){ o[z] = (s[z]||[]).map(cloneVal); });
    ZONE_SLOTS.forEach(function(z){ o[z] = s[z] ? cloneVal(s[z]) : null; });
    if (o.cas == null) o.cas = 0;
    if (o.mp == null) o.mp = 0;
    return o;
  }
  function cloneState(G){
    if (!G) return null;
    var st = {};
    // G-level rule fields (generic carry-through, minus the seat objects)
    for (var k in G){
      if(!Object.prototype.hasOwnProperty.call(G,k)) continue;
      if (SEAT_KEYS.indexOf(k)!==-1) continue;
      st[k] = cloneVal(G[k]);
    }
    SEAT_KEYS.forEach(function(seat){ if (G[seat]) st[seat] = cloneSide(G[seat]); });
    if (!st.sideOrder) st.sideOrder = SEAT_KEYS.filter(function(s){ return st[s]; });
    if (!st.eliminated) st.eliminated = {};
    return st;
  }

  // ---- zone access on a sim side ----
  function zCard(side, zone){
    if (!side) return null;
    switch(zone){
      case 'rank': case 'rankZone': return side.rankZone;
      case 'left-flank': case 'leftFlank': return side.leftFlank;
      case 'right-flank': case 'rightFlank': return side.rightFlank;
      case 'rear-flank': case 'rearFlank': return side.rearFlank;
      case 'delta': return side.delta && side.delta[0];
      default: return null;
    }
  }
  function zSet(side, zone, val){
    switch(zone){
      case 'rank': case 'rankZone': side.rankZone = val; break;
      case 'left-flank': case 'leftFlank': side.leftFlank = val; break;
      case 'right-flank': case 'rightFlank': side.rightFlank = val; break;
      case 'rear-flank': case 'rearFlank': side.rearFlank = val; break;
      case 'delta': side.delta = val ? [val] : []; break;
    }
  }
  function livingOpponents(st, seat){
    var order = st.sideOrder || SEAT_KEYS;
    return order.filter(function(s){ return s !== seat && st[s] && !(st.eliminated && st.eliminated[s]); });
  }
  function canAttackSeat(st, seat){
    if (!st || !st[seat] || (st.eliminated && st.eliminated[seat])) return false;
    if (st._noAttack && st._noAttack[seat]) return false;
    if (st._areaNoAttack && st._areaNoAttack[seat] > 0) return false;
    if (st._noAttackTurns > 0) return false;
    if (st._ru157NoAttackThisTurn) return false;
    return true;
  }

  // ---- deadzone routing, mirroring the live dzAdd (Option A) + casualty draws ----
  // A card sent to a NEGATIVE Deadzone cannot sit there: it cancels a shell (cas++)
  // and goes to the Discard (Rank³⁺ is a hand/Discard CHOICE in the live game; the
  // sim resolves it deterministically to Discard — the parity harness avoids the
  // Rank³-into-negative case, and the eval treats a kept Rank³ as a hand asset).
  function simDzAdd(side, c){
    if ((side.cas||0) < 0){ side.cas = (side.cas||0) + 1; side.discard.push(c); return; }
    side.deadzone.push(c); side.cas = (side.cas||0) + 1;
  }
  function simCasDraw(side, n){
    for (var i=0;i<n;i++){
      if (!side.deck.length){ side._deckedOut = true; break; }  // live triggers deck-out loss here
      simDzAdd(side, side.deck.shift());
    }
  }
  function simDefeatDelta(side){
    var e = side.delta && side.delta[0]; if (!e) return;
    side.delta = [];
    simDzAdd(side, e);
    (e.elements || []).forEach(function(x){ side.discard.push(x); });
  }
  // Canonical defeat resolution — identical rule set to the live applyDefeatCasualty.
  function applyDefeatCasualty(loserSide, loserZone, loserCard, extraDraws){
    if (loserZone === 'delta'){ simDefeatDelta(loserSide); }
    else if (loserZone === 'rank' || loserZone === 'rankZone'){ /* rank card survives */ }
    else { zSet(loserSide, loserZone, null); simDzAdd(loserSide, loserCard); }
    simCasDraw(loserSide, Math.max(0, extraDraws|0));
  }

  // ---- CLEAN combat resolution (matches resolveAtkBase with empty _defState /
  //      no Numeral-skill flags). Mutates `st` in place. ----
  function resolveAttack(st, aSeat, aZone, dSeat, dZone, addonNP){
    addonNP = addonNP || 0;
    var AP = st[aSeat], DP = st[dSeat];
    var att = zCard(AP, aZone);
    if (!att) return st;
    // DIRECT ATTACK — resolves as if attacking a virtual Basic Rank⁰ Classless Numeral 0, NOT the
    // opponent's Rank Zone card (mirrors live directResolve, index.html ~11517; live routes here when
    // _directThisTurn && dZone==='rank'). Proxy NP 0 => the attacker's full NP is Morale Damage; the
    // proxy sits in the rank slot so rankDiff = attacker RP => 1 + RP Casualty Draws. The Rank Zone
    // card is untouched, the attacker is unharmed, and the one-turn grant is consumed by this hit.
    if (att._directThisTurn && dZone === 'rank'){
      DP.mp -= Math.max(0, npOf(att) + addonNP);
      simCasDraw(DP, 1 + Math.max(0, rpOf(att)));
      att._directThisTurn = false;
      if (att._sendToDZAfterAttack){ zSet(AP, aZone, null); simDzAdd(AP, att); att._sendToDZAfterAttack = false; }
      return st;
    }
    var def = zCard(DP, dZone);
    if (!def) return st;
    var aNP = npOf(att) + addonNP, dNP = npOf(def);
    var aRP = rpOf(att), dRP = rpOf(def);

    function destroyDef(){
      var rd = Math.max(0, aRP - dRP);
      if (dZone === 'rank' || dZone === 'rankZone'){ applyDefeatCasualty(DP, 'rank', def, 1 + rd); return; }
      if (dZone === 'delta'){ applyDefeatCasualty(DP, 'delta', def, rd > 0 ? rd : 0); return; }
      applyDefeatCasualty(DP, dZone, def, rd > 0 ? rd : 0);   // flank / rear
    }
    function destroyAtt(){
      var rd = Math.max(0, dRP - aRP);
      if (aZone === 'rank' || aZone === 'rankZone'){ applyDefeatCasualty(AP, 'rank', att, 1 + rd); return; }
      if (aZone === 'delta'){ applyDefeatCasualty(AP, 'delta', att, rd); return; }
      applyDefeatCasualty(AP, aZone, att, rd);                // flank / rear
    }

    // Zero 8 (data.js 233) "deals 0 Morale Damage this turn" — the DEFENDER takes no MP loss from this
    // card's attacks, but is still destroyed on a win (+casualties). Mirrors live checkSkillFlags_moraleCalc
    // (index.html ~6855: moraleR=0 when att._zeroNoMorale). Zero 8 still TAKES morale when it loses/ties
    // (that damage is dealt BY the opponent, not by Zero 8).
    var noMoraleDealt = !!(att._zeroNoMorale || att._ru152Zero8NoMorale);
    if (aNP > dNP){ if (!noMoraleDealt) DP.mp -= (aNP - dNP); destroyDef(); }
    else if (dNP > aNP){ AP.mp -= (dNP - aNP); destroyAtt(); }
    else { AP.mp -= aNP; if (!noMoraleDealt) DP.mp -= aNP; if (aZone !== 'rank' && aZone !== 'rankZone') destroyAtt(); if (dZone !== 'rank' && dZone !== 'rankZone') destroyDef(); }
    return st;
  }

  function attacksLeftOf(c){ return (c && c.attacksLeft == null) ? 1 : (c ? c.attacksLeft : 0); }  // matches live atkLeft135

  // ---- MULTI-ATTACK ESCALATION -----------------------------------------------------------------
  // Some cards attack several times and GROW between hits, so a card outmatched on hit 1 can win by
  // hit N. That growth math lives in the live engine's layered resolveAtk decorators, not in any data
  // table — so we PORT it exactly, reading the very flags the live skill set at activation (they ride
  // on the cloned card). One card at a time, each cited to its live source; unported escalators simply
  // multi-attack without growth (a conservative under-estimate, never an over-estimate).
  function escalationApplyHit(st, aSeat, dSeat, att, aNPbefore, dNPbefore, dRPbefore, dMPbefore){
    var AP = st[aSeat], DP = st[dSeat];
    var success = aNPbefore > dNPbefore;
    // Shadow 8 — index.html resolveAtkL11 (~3874): EVERY attack (win OR loss) +(_s8Bank NP) MP; every
    // 3rd attack the attacker gains the attacked Numeral's NP. This is the classic "outmatched early,
    // grows, wins late" card. Requires the live _s8Active flag; count = Bank numeral (attacksLeft).
    if (att._s8Bank && att._s8Active){
      att._s8Hits = (att._s8Hits || 0) + 1;
      AP.mp += npOf(att._s8Bank);
      if (att._s8Hits % 3 === 0) att.currentNP = npOf(att) + dNPbefore;
    }
    // Phantom 8 — index.html resolveAtkL20 (~4056): on a SUCCESSFUL hit, every 2nd hit the attacker
    // gains +1 NP and +(_ru159Phantom8Rank) RP until end of turn. Count = Bank numeral (attacksLeft).
    if (att._ru159Phantom8Bank && success){
      att._ru159Phantom8Hits = (att._ru159Phantom8Hits || 0) + 1;
      if (att._ru159Phantom8Hits % 2 === 0){
        att.currentNP = npOf(att) + 1;
        att.currentRP = rpOf(att) + (att._ru159Phantom8Rank || 0);
      }
    }
    // Inferno 8 — index.html resolveAtkL19 (~4028): on a SUCCESSFUL hit the opponent loses MP equal to
    // the attacked Numeral's Rank; on the 2nd successful hit the attacker gains its Bank NP as MP.
    if (att._ru158Inferno8Bank && success){
      att._ru158Inferno8Hits = (att._ru158Inferno8Hits || 0) + 1;
      var iLoss = Math.max(0, dRPbefore); if (iLoss) DP.mp -= iLoss;
      if (att._ru158Inferno8Hits === 2) AP.mp += npOf(att._ru158Inferno8Bank);
    }
    // Maximum 8 — index.html resolveAtkL24 (~4159): counts a hit that DEALT MP damage to the defender
    // (win OR tie — measured by the defender's MP dropping, not a strict NP win); every 2nd such hit the
    // attacker gains its Bank NP as MP. Count = Bank numeral (attacksLeft).
    if (att._mx8Bank && dMPbefore != null && DP.mp < dMPbefore){
      att._mx8Hits = (att._mx8Hits || 0) + 1;
      if (att._mx8Hits % 2 === 0) AP.mp += (att._ru162Mx8BankNP || npOf(att._mx8Bank));
    }
    // Deckstructive 8 — index.html resolveAtkL15 (~3941): _d8MillMode converts this hit's Morale Damage
    // into opponent mill — the MP loss is REFUNDED and the opponent drops 2 cards per MP from Deck to
    // Drop; on every 3rd such hit the attacker gains MP equal to the cards milled since the last payout.
    if (att._d8MillMode && dMPbefore != null){
      var d8lost = Math.max(0, dMPbefore - DP.mp);
      if (d8lost > 0){
        DP.mp += d8lost;                                          // refund the Morale Damage
        var milled = 0, want = d8lost * 2;
        while (milled < want && DP.deck.length){ DP.discard.push(DP.deck.shift()); milled++; }
        att._d8Hits = (att._d8Hits || 0) + 1;
        att._d8MilledBucket = (att._d8MilledBucket || 0) + milled;
        if (att._d8Hits % 3 === 0){ AP.mp += (att._d8MilledBucket || 0); att._d8MilledBucket = 0; }
      }
    }
    // Haste 8 (skill 2) — index.html resolveAtkL8 (~3805): +2 NP after EVERY attack (win OR loss); count =
    // Bank numeral (attacksLeft). Another fast "outmatched early, grows, wins late" card (like Shadow 8).
    if (att._haste8GainAfterAttack){ att.currentNP = npOf(att) + 2; }
    // Light 9 (skill 2) and Restorative 8 need NO entry: their NP buff is ONE-TIME at activation (already
    // on the cloned card) and their count is just attacksLeft — the generic sequence covers them. (Light 9's
    // "Stand Down a Flank per hit" is unimplemented live: _light9s2 is set but never read.) Phantom 8 (data.js
    // 257) is already ported above (its canonical activation, SDEFS ~18633, sets _ru159Phantom8Bank).
    // Remaining PER-HIT escalators to port: the Δ/Amalgamation attack grants (evolution cards).
  }

  // Resolve the card in aZone through ALL its available attacks, re-picking the best target each hit
  // and applying its escalation growth. Covers every extra-attack granter (they set attacksLeft) plus
  // the ported escalators. Mutates st. bestTargetFor is hoisted (declared below in the same scope).
  function resolveAttackSequence(st, seat, aZone, addonNP, firstTarget){
    var AP = st[seat];
    var n = attacksLeftOf(zCard(AP, aZone));
    for (var k = 0; k < n; k++){
      var att = zCard(AP, aZone);
      if (!att) break;                                            // attacker was destroyed (lost as a flank)
      // hit 1 uses the caller's chosen target (so the recorded plan target matches what we evaluate,
      // and attacksLeft==1 stays identical to a single resolveAttack); continuation hits re-target.
      var tgt = (k === 0 && firstTarget) ? firstTarget : bestTargetFor(st, seat, { zone: aZone, card: att }, evalState(st, seat));
      if (!tgt) break;
      var def = zCard(st[tgt.oppSeat], tgt.dz);
      var aNPbefore = npOf(att) + (addonNP || 0), dNPbefore = def ? npOf(def) : 0, dRPbefore = def ? rpOf(def) : 0;
      var dMPbefore = st[tgt.oppSeat] ? st[tgt.oppSeat].mp : null;   // for MP-drop-gated escalators (Maximum 8)
      resolveAttack(st, seat, aZone, tgt.oppSeat, tgt.dz, addonNP || 0);
      var still = zCard(AP, aZone);                               // same card object iff it survived
      if (still === att) escalationApplyHit(st, seat, tgt.oppSeat, att, aNPbefore, dNPbefore, dRPbefore, dMPbefore);
      else break;                                                 // gone -> no more attacks
    }
    return st;
  }

  // ---- legal move generation (core: attack / promote / flank) ----
  function attackers(st, seat){
    if (!canAttackSeat(st, seat)) return [];
    var p = st[seat]; if (!p) return [];
    var out = [];
    [['rank',p.rankZone],['left-flank',p.leftFlank],['right-flank',p.rightFlank],['rear-flank',p.rearFlank],['delta',p.delta&&p.delta[0]]]
      .forEach(function(pair){
        var z = pair[0], c = pair[1];
        var al = (c && c.attacksLeft == null) ? 1 : (c ? c.attacksLeft : 0);   // match live atkLeft135: null => 1
        if (c && c.canAttack !== false && !c.frozen && al > 0 && !(p.attacksUsed && p.attacksUsed[c.id])) out.push({ zone:z, card:c });
      });
    return out;
  }
  function targetZones(st, oppSeat){
    var o = st[oppSeat]; if (!o) return [];
    var out = [];
    if (o.rankZone) out.push('rank');
    if (o.leftFlank && !o.leftFlank.isDigit) out.push('left-flank');
    if (o.rightFlank && !o.rightFlank.isDigit) out.push('right-flank');
    if (o.rearFlank && !o.rearFlank.isDigit) out.push('rear-flank');
    if (o.delta && o.delta[0]) out.push('delta');
    return out;
  }
  // Zones `attacker` may target on oppSeat. A direct attacker (_directThisTurn) strikes the rank slot
  // directly — resolveAttack resolves it against the Rank⁰ proxy, so it never engages the real cards.
  function targetsFor(st, oppSeat, attacker){
    if (attacker && attacker.card && attacker.card._directThisTurn) return ['rank'];
    return targetZones(st, oppSeat);
  }
  function legalAttacks(st, seat){
    var moves = [];
    var atts = attackers(st, seat);
    livingOpponents(st, seat).forEach(function(oppSeat){
      atts.forEach(function(a){
        targetsFor(st, oppSeat, a).forEach(function(dz){ moves.push({ type:'attack', seat:seat, aZone:a.zone, dSeat:oppSeat, dZone:dz, cardId:a.card.id }); });
      });
    });
    return moves;
  }
  function legalPromotions(st, seat){
    var p = st[seat]; if (!p || !p.rankZone) return [];
    var cur = p.rankZone, cNP = (cur.numeral!=null?cur.numeral:npOf(cur)), cRP = (cur.rank!=null?cur.rank:rpOf(cur));
    return (p.hand||[]).filter(function(c){
      return c.type === 'numeral' && (
        (((c.numeral - cNP) >= 1 && (c.numeral - cNP) <= 3 && ((c.rank||0) - cRP) >= 0 && ((c.rank||0) - cRP) <= 1)) ||
        (c.numeral === cNP && ((c.rank||0) === cRP || (c.rank||0) - cRP === 1))
      );
    }).map(function(c){ return { type:'promote', seat:seat, cardId:c.id }; });
  }
  function legalFlanks(st, seat){
    var p = st[seat]; if (!p || !p.rankZone) return [];
    var rNP = npOf(p.rankZone), rRP = rpOf(p.rankZone), moves = [];
    var openSlots = []; if (!p.leftFlank) openSlots.push('leftFlank'); if (!p.rightFlank) openSlots.push('rightFlank');
    (p.hand||[]).filter(function(c){
      return c.type === 'numeral' && c.numeral <= rNP && (c.rank||0) < 3 && (c.rank||0) <= rRP && c.canAttack !== false;
    }).forEach(function(c){ openSlots.forEach(function(slot){ moves.push({ type:'flank', seat:seat, cardId:c.id, slot:slot }); }); });
    // Chief Flank (Rank³ over an eligible Rank² flank) only when the Rank Zone is itself Rank³.
    if (rRP >= 3){
      (p.hand||[]).filter(function(c){ return c.type==='numeral' && (c.rank||0)===3 && c.numeral<=rNP && c.canAttack!==false; })
        .forEach(function(big){
          ['leftFlank','rightFlank'].forEach(function(slot){
            var cur = p[slot];
            if (cur && (cur.rank||0) >= 2 && (cur.numeral||0) >= (big.numeral - 3)) moves.push({ type:'chiefFlank', seat:seat, cardId:big.id, slot:slot });
          });
        });
    }
    return moves;
  }
  function legalMoves(st, seat, phase){
    switch(phase){
      case 'promotion': return legalPromotions(st, seat).concat([{ type:'endPhase', seat:seat }]);
      case 'rally':     return legalFlanks(st, seat).concat([{ type:'endPhase', seat:seat }]);
      case 'battle':    return legalAttacks(st, seat).concat([{ type:'endPhase', seat:seat }]);
      default:          return [{ type:'endPhase', seat:seat }];
    }
  }

  // ---- apply the structural (non-effect) moves ----
  function findInHand(p, cardId){ for (var i=0;i<p.hand.length;i++) if (p.hand[i].id === cardId) return i; return -1; }
  function applyPromote(st, seat, cardId){
    var p = st[seat]; var i = findInHand(p, cardId); if (i === -1) return st;
    var pick = p.hand.splice(i,1)[0];
    if (p.rankZone) p.bank.unshift(p.rankZone);
    p.mp += (pick.M||0);
    p.rankZone = Object.assign({}, pick, { currentNP: pick.numeral, currentRP: (pick.rank||0), attacksLeft:1, usedSkill:false, frozen:false });
    return st;
  }
  function applyFlank(st, seat, cardId, slot){
    var p = st[seat]; var i = findInHand(p, cardId); if (i === -1) return st;
    var c = p.hand.splice(i,1)[0];
    p.mp += (c.M||0);
    p[slot] = Object.assign({}, c, { currentNP:c.numeral, currentRP:(c.rank||0), attacksLeft:1, usedSkill:false, frozen:false });
    return st;
  }
  function applyChiefFlank(st, seat, cardId, slot){
    var p = st[seat]; var i = findInHand(p, cardId); if (i === -1) return st;
    var big = p.hand.splice(i,1)[0];
    if (p[slot]) p.discard.push(p[slot]);
    p.mp += (big.M||0);
    p[slot] = Object.assign({}, big, { currentNP:big.numeral, currentRP:(big.rank||0), attacksLeft:1, usedSkill:false, frozen:false });
    return st;
  }
  // Single entry point the search will call.
  function applyMove(st, move){
    if (!move) return st;
    switch(move.type){
      case 'attack': {
        resolveAttack(st, move.seat, move.aZone, move.dSeat, move.dZone, move.addonNP||0);
        // mark the attacker's swing spent (mirror the live decrement)
        var ap = st[move.seat], a = zCard(ap, move.aZone);
        if (a){ a.attacksLeft = Math.max(0, (a.attacksLeft||0) - 1); if (a.attacksLeft <= 0){ ap.attacksUsed = ap.attacksUsed||{}; ap.attacksUsed[a.id] = true; } }
        return st;
      }
      case 'promote':    return applyPromote(st, move.seat, move.cardId);
      case 'flank':      return applyFlank(st, move.seat, move.cardId, move.slot);
      case 'chiefFlank': return applyChiefFlank(st, move.seat, move.cardId, move.slot);
      case 'endPhase':   return st;   // phase advance handled by the driver
      default:           return st;
    }
  }

  /* ==========================================================================
     PHASE 2 — real position EVALUATION + a real SEARCH over actual combat.
     evalState scores a whole position from a seat's perspective (clocks, MP/
     casualty race, deck-out, board power+tempo, card advantage incl. Deadzone
     recursion). bestAttackPlan is a depth-N alpha-beta negamax over the REAL
     combat rules (via resolveAttack on cloned states) with the opponent replying
     — this replaces the toy abstract _ruCombatPlan. Depth N = plies of full
     lookahead (my battle -> opponent's battle -> ...), per the S.3 schedule.
     ========================================================================== */
  var WIN = 1e6, LOSS = -1e6;
  // ---- THE DEADZONE IS A RESOURCE, NOT A LOSS PILE — DERIVED FROM THE CARD DATA -----------------
  // Losing a battle is not always the worst outcome: a defeated card lands in YOUR Deadzone, and this
  // game is full of payoffs that fire FROM the Deadzone. Which classes/cards care, and how, is NOT
  // hand-assigned here — it is READ from the game's own data (AREA_TEXT area doctrines, SDEFS grave
  // skills, and every class's Numeral skills in ND). We extract the FACTS per class:
  //   selfBuffNP  — the Area buffs its own Numerals' NP while they sit in the Deadzone (e.g. Dark Domain)
  //   casImmune   — Deadzone cards don't count toward the Casualty Count (Morbid Cemetery / Phantom)
  //   entryPayload— the Area hits opponents from / on entry to the Deadzone (Wildfire, Lowlands, Dreadnaught)
  //   recur       — the class can pull cards back OUT of the Deadzone (Area text, grave skills, or a Numeral skill)
  //   flankEnable — a card gains a battlefield ability from the Deadzone (Seven Heaven's free 7-flank)
  // Turning a fact into eval points is the only tuning; those scalars live in DZ_COEFF (calibration sets them).
  function computeDzKnowledge(areaText, sdefs, numeralDefs, classMeta){
    var facts = {}, grave = {}, areaCardClass = {};
    if (sdefs) for (var nm in sdefs){ if (sdefs[nm] && sdefs[nm].source === 'grave') grave[nm] = 1; }
    var classes = areaText ? Object.keys(areaText) : [];
    classes.forEach(function(cls){
      var text = String(areaText[cls] || '');
      var name = (classMeta && classMeta[cls] && classMeta[cls].name) ? classMeta[cls].name : cls;
      var areaName = (classMeta && classMeta[cls] && classMeta[cls].areaName) ? classMeta[cls].areaName : '';
      if (areaName) areaCardClass[areaName.toLowerCase()] = cls;
      var f = { selfBuffNP:0, casImmune:false, entryPayload:false, recur:false, flankEnable:false };
      text.split('.').forEach(function(s){
        var low = s.toLowerCase();
        if (low.indexOf('deadzone') === -1) return;                     // only Deadzone clauses
        var m = /all ([^.]*?)numerals?\s+gain\s+(\d+)\s*np/i.exec(s);    // own-class NP buff while in the Deadzone
        if (m && new RegExp(name, 'i').test(m[1])) f.selfBuffNP = Math.max(f.selfBuffNP, parseInt(m[2],10)||0);
        if (/(all (other )?players|all numerals)/i.test(low) && /(lose|receive)/i.test(low) && /(mp|morale|np)/i.test(low)) f.entryPayload = true;
        if (/(add|return)[^.]*from (your |the )?deadzone|return it to the battlefield/i.test(low)) f.recur = true;
        if (/flank/i.test(low) && /(need not|treated as)/i.test(low)) f.flankEnable = true;
      });
      if (/does not count toward your casualty count/i.test(text)) f.casImmune = true;   // (not scoped to a 'deadzone' sentence)
      if (numeralDefs && numeralDefs[cls]) numeralDefs[cls].forEach(function(nd){        // recursion via this class's Numeral skills
        var sk = String((nd && nd.sk) || '') + ' ' + String((nd && nd.sc) || '');
        if (/from (your |the )?deadzone/i.test(sk) && /(to (your |the )?hand|to the battlefield|return)/i.test(sk)) f.recur = true;
      });
      facts[cls] = f;
    });
    return { facts: facts, grave: grave, areaCardClass: areaCardClass };
  }
  var _dzKnow = null;
  function dzKnowledge(){
    if (_dzKnow) return _dzKnow;
    var AT=null, SD=null, NDd=null, CMd=null;
    try{ if (typeof AREA_TEXT !== 'undefined') AT = AREA_TEXT; }catch(e){}
    try{ if (typeof SDEFS !== 'undefined')     SD = SDEFS; }catch(e){}
    try{ if (typeof ND !== 'undefined')        NDd = ND; }catch(e){}
    try{ if (typeof CM !== 'undefined')        CMd = CM; }catch(e){}
    _dzKnow = computeDzKnowledge(AT, SD, NDd, CMd);
    return _dzKnow;
  }
  function dzFactsFor(side){
    var cls = String(side.class || side.cls || '').toLowerCase();
    return dzKnowledge().facts[cls] || { selfBuffNP:0, casImmune:false, entryPayload:false, recur:false, flankEnable:false };
  }
  // Eval coefficients — the ONLY tunables here (calibration sets them). Kept small so a banked card is
  // worth LESS than the -3/casualty race penalty => losing stays net-negative for every class.
  var DZ_COEFF = { np:0.5, recur:0.8, grave:1.5, payload:3.0, casImmuneRelief:0.5 };
  function usableDeadzone(side){
    var K = dzKnowledge(), f = dzFactsFor(side);
    var cls = String(side.class || side.cls || '').toLowerCase();
    var dz = side.deadzone || [], val = 0;
    for (var i=0;i<dz.length;i++){
      var c = dz[i]; if(!c) continue;
      if (c.type === 'numeral'){
        val += f.selfBuffNP * DZ_COEFF.np;                 // buffed where its class rewards Deadzone presence
        if (f.recur) val += DZ_COEFF.recur;                // retrievable back into play
        if (K.grave[c.name]) val += DZ_COEFF.grave;        // literally usable from the Deadzone (e.g. Restorative 3)
      }
      if (f.entryPayload && K.areaCardClass[String(c.name||'').toLowerCase()] === cls) val += DZ_COEFF.payload;
    }
    return val;
  }
  // Casualty-immune classes (Phantom) don't feel banked Deadzone cards on the casualty RACE (the raw
  // loss clock at cas>=15 is left intact by isDead).
  function effCas(side){
    var f = dzFactsFor(side), cas = side.cas || 0;
    if (f.casImmune){
      var n = 0, dz = side.deadzone || [];
      for (var i=0;i<dz.length;i++){ if (dz[i] && dz[i].type === 'numeral') n++; }
      cas = Math.max(0, cas - n * DZ_COEFF.casImmuneRelief);
    }
    return cas;
  }
  function boardPower(side){
    var s=0;
    [side.rankZone, side.leftFlank, side.rightFlank, side.rearFlank, side.delta&&side.delta[0]].forEach(function(c){
      if(!c) return;
      s += npOf(c)*2 + rpOf(c)*1.5;
      if(c.canAttack!==false && !c.frozen && (c.attacksLeft||0)>0) s += 4*(c.attacksLeft||0);   // tempo/initiative
      if(c.skillType && c.skillType!=='Basic') s += 3;                                          // a live skill on board
    });
    return s;
  }
  // usableDeadzone already carries its own (data-derived) magnitudes; add at 1x so an ordinary banked
  // card stays worth LESS than the -3/casualty race penalty (losing stays net-negative for every
  // class); the named payoffs it reads (grave-recur, loaded Areas) can exceed that on purpose.
  function handValue(side){ return (side.hand||[]).length*3 + (side.bank||[]).length*2 + usableDeadzone(side)*1; }
  function isDead(side){ return (side.mp||0) <= 0 || (side.cas||0) >= 15 || !!side._deckedOut; }
  function evalState(st, seat){
    var me = st[seat]; if(!me) return 0;
    var opps = livingOpponents(st, seat);
    if(isDead(me)) return LOSS;
    if(opps.length === 0 || opps.every(function(o){ return isDead(st[o]); })) return WIN;
    var score = 0, oppBoard = 0, oppHand = 0, oppDeckMin = 999;
    opps.forEach(function(o){
      var op = st[o];
      score += ((me.mp||0) - (op.mp||0)) * 1.0;              // MP (Morale) race
      score += (effCas(op) - effCas(me)) * 3.0;              // casualty race (Casualty-immune Deadzone cards discounted)
      if((op.mp||0) <= 6)  score += (7 - (op.mp||0)) * 4;    // opponent near MP death -> press
      if((op.cas||0) >= 10) score += ((op.cas||0) - 9) * 4;  // opponent near casualty death
      oppBoard += boardPower(op);
      oppHand  += handValue(op);
      oppDeckMin = Math.min(oppDeckMin, (op.deck||[]).length);
    });
    if((me.mp||0) <= 6)  score -= (7 - (me.mp||0)) * 5;      // self-preservation weighted higher
    if((me.cas||0) >= 10) score -= ((me.cas||0) - 9) * 5;
    if((me.deck||[]).length <= 3) score -= (4 - (me.deck||[]).length) * 6;   // my deck-out clock
    if(oppDeckMin <= 3)          score += (4 - oppDeckMin) * 4;              // opponent deck-out (mill)
    score += (boardPower(me) - oppBoard) * 1.0;
    score += (handValue(me) - oppHand / Math.max(1, opps.length)) * 1.0;
    return score;
  }

  // ---- combat search ----
  function attackerList(st, seat){ return attackers(st, seat).slice(0, 5); }   // cap to bound 2^n
  // best single target for one attacker, by immediate eval gain (move ordering + target choice)
  function bestTargetFor(st, seat, attacker, base){
    var best = null, bestGain = -1e18;
    livingOpponents(st, seat).forEach(function(oppSeat){
      targetsFor(st, oppSeat, attacker).forEach(function(dz){
        var clone = cloneVal(st);
        resolveAttack(clone, seat, attacker.zone, oppSeat, dz, 0);
        var g = evalState(clone, seat) - base;
        if(g > bestGain){ bestGain = g; best = { oppSeat: oppSeat, dz: dz, gain: g }; }
      });
    });
    return best;
  }
  // Candidate resulting states: subsets of {attacker -> its best target}, ordered by immediate eval,
  // capped in width. The empty subset (hold everything) is always included.
  function candidateStates(st, seat, width){
    var base = evalState(st, seat);
    var options = attackerList(st, seat).map(function(a){ return { attacker:a, target: bestTargetFor(st, seat, a, base) }; })
                                        .filter(function(o){ return o.target; });
    var n = Math.min(options.length, 5);
    var out = [];
    for(var mask=0; mask < (1<<n); mask++){
      var clone = cloneVal(st), plan = [];
      for(var i=0;i<n;i++){
        if(mask & (1<<i)){
          var o = options[i];
          resolveAttackSequence(clone, seat, o.attacker.zone, 0, o.target);   // full multi-attack sequence (hit 1 = chosen target)
          plan.push({ aZone:o.attacker.zone, dSeat:o.target.oppSeat, dZone:o.target.dz });
        }
      }
      out.push({ plan: plan, state: clone, imm: evalState(clone, seat) });
    }
    out.sort(function(a,b){ return b.imm - a.imm; });                 // move ordering for alpha-beta
    return out.slice(0, Math.max(1, width || 8));
  }
  function negamaxBattle(st, seat, depth, alpha, beta){
    var opps = livingOpponents(st, seat);
    if(depth <= 0 || opps.length === 0 || isDead(st[seat])) return evalState(st, seat);
    var states = candidateStates(st, seat, 8);
    var opp = opps[0];                                                // approximate reply: primary opponent's battle
    var best = -1e18;
    for(var i=0;i<states.length;i++){
      var v = -negamaxBattle(states[i].state, opp, depth - 1, -beta, -alpha);
      if(v > best) best = v;
      if(best > alpha) alpha = best;
      if(alpha >= beta) break;                                        // prune
    }
    return best;
  }
  // Returns { plan: [attack,...], score } — the best set of attacks for `seat` this battle phase.
  function bestAttackPlan(st, seat, depth){
    depth = Math.max(1, depth || 1);
    var opps = livingOpponents(st, seat);
    if(!opps.length) return { plan: [], score: evalState(st, seat) };
    var states = candidateStates(st, seat, 12);
    var opp = opps[0];
    var best = { score: -1e18, plan: [] }, alpha = -1e18, beta = 1e18;
    for(var i=0;i<states.length;i++){
      var v = (depth > 1) ? -negamaxBattle(states[i].state, opp, depth - 1, -beta, -alpha) : states[i].imm;
      if(v > best.score) best = { score: v, plan: states[i].plan };
      if(v > alpha) alpha = v;
    }
    return best;
  }
  // 1-ply eval-based choice for promotion / rally (a real position read, not the ad-hoc formula).
  function bestStructuralMove(st, seat, moves){
    var base = evalState(st, seat), best = null, bestV = base;
    moves.forEach(function(mv){
      var clone = cloneVal(st);
      applyMove(clone, mv);
      var v = evalState(clone, seat);
      if(best === null || v > bestV){ bestV = v; best = mv; }
    });
    return best;   // may be null if no move beats doing nothing
  }

  window.ruSim = {
    cloneState: cloneState,
    resolveAttack: resolveAttack,
    applyMove: applyMove,
    legalMoves: legalMoves,
    legalAttacks: legalAttacks,
    legalPromotions: legalPromotions,
    legalFlanks: legalFlanks,
    applyPromote: applyPromote,
    applyFlank: applyFlank,
    npOf: npOf, rpOf: rpOf, zCard: zCard, zSet: zSet, livingOpponents: livingOpponents,
    evalState: evalState, boardPower: boardPower, bestAttackPlan: bestAttackPlan, bestStructuralMove: bestStructuralMove,
    computeDzKnowledge: computeDzKnowledge, dzKnowledge: dzKnowledge, usableDeadzone: usableDeadzone,
    resolveAttackSequence: resolveAttackSequence, attacksLeftOf: attacksLeftOf
  };

  /* ==========================================================================
     PARITY HARNESS — proves the sim's combat matches the LIVE engine.
     Builds random CLEAN combats (plain Classless numerals, no skills, no
     defensive state, cas >= 0), runs ruSim.resolveAttack AND the live
     window.resolveAtk on identical setups, and asserts the resulting state
     (MP, cas, Deadzone contents, Discard contents, deck length, board) matches.
     Runs against seats 'ai' and 'ai2' so live casualty draws auto-resolve
     synchronously (no human confirmation modal). Read-only w.r.t. real play:
     it snapshots and restores the live G around each trial.
     ========================================================================== */
  function mkNumeral(name, np, rp){
    return { id: name + '_' + Math.random().toString(36).slice(2,8), name: name, class:'classless', type:'numeral',
             numeral: np, rank: rp, currentNP: np, currentRP: rp, attacksLeft:1, usedSkill:false, frozen:false, ca:true, A:1, M:0, skillType:'Basic' };
  }
  function sig(side){
    return {
      mp: side.mp, cas: side.cas,
      deck: side.deck.length,
      dead: side.deadzone.map(function(c){return c.name;}).sort(),
      disc: side.discard.map(function(c){return c.name;}).sort(),
      rank: side.rankZone ? side.rankZone.name : null,
      lf: side.leftFlank ? side.leftFlank.name : null,
      rf: side.rightFlank ? side.rightFlank.name : null
    };
  }
  function eq(a,b){ return JSON.stringify(a) === JSON.stringify(b); }
  function randInt(n){ return Math.floor(Math.random()*n); }

  // Build one random clean scenario as a pair of plain side objects (attacker 'ai', defender 'ai2').
  function makeScenario(){
    function deck(n){ var d=[]; for(var i=0;i<n;i++) d.push(mkNumeral('DK'+i, 1, 0)); return d; }
    // attacker board: a rank + maybe flanks
    var A = { mp:20, cas:0, class:'classless', rankZone: mkNumeral('A-RZ', 4+randInt(6), 1+randInt(2)),
              leftFlank: Math.random()<0.5 ? mkNumeral('A-LF', 3+randInt(4), 1+randInt(2)) : null,
              rightFlank:null, rearFlank:null, delta:[], bank:[], hand:[], deck:deck(12), discard:[], deadzone:[], attacksUsed:{}, actUsed:0 };
    var D = { mp:20, cas:0, class:'classless', rankZone: mkNumeral('D-RZ', 3+randInt(6), 1+randInt(3)),
              leftFlank: Math.random()<0.6 ? mkNumeral('D-LF', 2+randInt(5), 1+randInt(2)) : null,
              rightFlank: Math.random()<0.4 ? mkNumeral('D-RF', 2+randInt(5), 1+randInt(2)) : null,
              rearFlank:null, delta:[], bank:[], hand:[], deck:deck(12), discard:[], deadzone:[], attacksUsed:{}, actUsed:0 };
    return { A: A, D: D };
  }
  // Pick a random legal attacker zone / defender zone for the scenario.
  function pickAttack(A, D){
    var aZones = [['rank',A.rankZone],['left-flank',A.leftFlank]].filter(function(p){return p[1];});
    var dZones = [['rank',D.rankZone],['left-flank',D.leftFlank],['right-flank',D.rightFlank]].filter(function(p){return p[1];});
    if (!aZones.length || !dZones.length) return null;
    return { aZone: aZones[randInt(aZones.length)][0], dZone: dZones[randInt(dZones.length)][0] };
  }

  window.ruSimParity = function(iterations){
    if (typeof G === 'undefined' || !G) return 'no live G (start or load a match first)';
    iterations = iterations || 400;
    var pass = 0, fail = 0, samples = [];
    var savedTurn = G.turn, savedPhase = G.phase, savedDefState = G._defState;
    var savedAi = G.ai, savedAi2 = G.ai2, savedExchange = G.exchange;
    var savedOrder = G.sideOrder, savedElim = G.eliminated, savedGameOver = G.gameOver;
    // Two-bot arena so live casualty draws auto-resolve (no human confirmation modal) and
    // oppOf/checkWin resolve cleanly. G.player is left as-is (untouched by these attacks).
    G.sideOrder = ['ai','ai2']; G.eliminated = {}; G.gameOver = false;
    try {
      for (var it=0; it<iterations; it++){
        var sc = makeScenario();
        var atk = pickAttack(sc.A, sc.D);
        if (!atk) { it--; continue; }

        // ---- SIM ----
        var simState = { sideOrder:['ai','ai2'], eliminated:{}, ai: cloneState({x:sc.A}).x || null };
        // clone the two sides cleanly
        simState.ai  = window.ruSim.cloneState({ ai: sc.A }).ai;
        simState.ai2 = window.ruSim.cloneState({ ai2: sc.D }).ai2;
        window.ruSim.resolveAttack(simState, 'ai', atk.aZone, 'ai2', atk.dZone, 0);
        var simA = sig(simState.ai), simD = sig(simState.ai2);

        // ---- LIVE ---- (drive the real resolveAtk on the same setup, drain casualty queue)
        G.turn = 'ai'; G.phase = 'battle'; G._defState = {}; G.exchange = savedExchange || 1;
        G.ai  = window.ruSim.cloneState({ ai: sc.A }).ai;
        G.ai2 = window.ruSim.cloneState({ ai2: sc.D }).ai2;
        window._RUcq = []; window._RUcbusy = false;
        // The casualty-draw queue's step() defers (async) whenever a modal/picker is "open" -- e.g. the
        // opening Switchdraw prompt. Force them closed so AI-recipient draws resolve synchronously.
        var _m=document.getElementById('modal'); if(_m)_m.classList.remove('open');
        var _pk=document.getElementById('picker-modal'); if(_pk)_pk.classList.remove('open');
        window.resolveAtk('ai', atk.aZone, 'ai2', atk.dZone, 0);
        var _m2=document.getElementById('modal'); if(_m2)_m2.classList.remove('open');
        var _pk2=document.getElementById('picker-modal'); if(_pk2)_pk2.classList.remove('open');
        // AI-recipient casualty draws resolve synchronously (no modal); if any remained queued we'd
        // see it as a cas/deck mismatch below and know the async path needs pumping.
        var liveA = sig(G.ai), liveD = sig(G.ai2), liveQueued = (window._RUcq ? window._RUcq.length : 0);

        var okA = eq(simA, liveA), okD = eq(simD, liveD);
        if (okA && okD) pass++;
        else { fail++; if (samples.length < 6) samples.push({ atk: atk, liveQueued: liveQueued, sim:{A:simA,D:simD}, live:{A:liveA,D:liveD} }); }
      }
    } finally {
      G.turn = savedTurn; G.phase = savedPhase; G._defState = savedDefState;
      G.ai = savedAi; G.ai2 = savedAi2; G.exchange = savedExchange;
      G.sideOrder = savedOrder; G.eliminated = savedElim; G.gameOver = savedGameOver;
      window._RUcq = []; window._RUcbusy = false;
    }
    return { iterations: iterations, pass: pass, fail: fail, mismatches: samples };
  };
})();
