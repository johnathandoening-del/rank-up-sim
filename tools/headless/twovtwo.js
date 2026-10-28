'use strict';
/* 2v2 (Tag / Team) checks on the real engine.
 *  1. Rules checks: seats and teams, turn order A → D → B → C, opponents never include the partner, team wins,
 *     Team-mode elimination and return, deck-out (Team: that player; Tag: only when both Decks are empty), Tag's shared
 *     Morale / Casualties / Deadzone surviving a state copy.
 *  2. Random play: whole matches driven by random inputs for all four seats — no engine errors, nobody ever attacks
 *     their partner, and the same seed plays the same game twice.
 *   node tools/headless/twovtwo.js [randomGames=4] [seed=1] */
const assert = require('assert');
const { newMatch } = require('./match');
const CLASSES = require('./classes')();
const { STATE_CODE } = require('../../ai/state');   // __S: the snapshot / restore every bot lookahead uses

const ORDER = ['player', 'ai2', 'ai3', 'ai'];          // A, D, B, C
const SEATS = ['player', 'ai', 'ai2', 'ai3'];
function start(mode, seed, startIdx) {
  const order = ORDER.slice(startIdx).concat(ORDER.slice(0, startIdx));
  const classes = { player: CLASSES[seed % CLASSES.length], ai: CLASSES[(seed + 3) % CLASSES.length], ai2: CLASSES[(seed + 5) % CLASSES.length], ai3: CLASSES[(seed + 7) % CLASSES.length] };
  const m = newMatch({ seed, rngSeed: seed, mode, order, classes, names: { player: 'A', ai3: 'B', ai: 'C', ai2: 'D' } });
  m.eng.run(STATE_CODE);
  return m;
}
const J = (v) => JSON.stringify(v);
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(J(a), J(b), msg); checks++; }   // (engine values come from another realm)

function rules(mode) {
  const m = start(mode, 11, 1), e = m.eng, R = (x) => e.run(x);
  const tag = mode === 'tag2v2';
  eq(R('G.twoVtwo'), tag ? 'tag' : 'team', mode + ': mode');
  eq(R('G.sideOrder'), ['ai2', 'ai3', 'ai', 'player'], mode + ': turn order D, B, C, A from the given start');
  eq(R('livingOpponentsOf("player")'), ['ai2', 'ai'], mode + ': A fights D and C');
  eq(R('livingOpponentsOf("ai3")'), ['ai2', 'ai'], mode + ': B fights D and C');
  eq(R('livingOpponentsOf("ai")').sort(), ['ai3', 'player'], mode + ': C fights A and B');
  eq(R('ruPartnerOf("player")'), 'ai3', mode + ': A partners B');
  eq(R('ruPartnerOf("ai2")'), 'ai', mode + ': D partners C');
  ok(R('oppList("ai3").indexOf("player")') === -1, mode + ': the partner is never an opponent');
  ok(!R('ruIsLegalAttackTarget("player","ai3","rank")'), mode + ': A cannot attack B');
  ok(R('ruIsLegalAttackTarget("player","ai","rank")') === !!R('window.zCard(G.ai,"rank")'), mode + ': A may attack C');
  // the first round: only the last seat may attack
  ok(!R('canSideAttackYet("ai2")'), mode + ': the first player cannot attack on their first turn');
  R('G._turnsCompletedBy={ai2:true,ai3:true,ai:true}');
  ok(R('canSideAttackYet("player")'), mode + ': the last player of round 1 attacks first');

  // Addons from the partner: Tag lends Flanks / Rear Flank / Δ, Team only the Δ Zone; never the partner's Rank Zone
  R('G.ai3.leftFlank=Object.assign({},G.ai3.rankZone,{id:"t-flank",numeral:1,currentNP:1,rank:0,currentRP:0}); G.player.rankZone.currentRP=0; G.player.rankZone.rank=0;' +
    'G.selAttacker={zone:"rank",card:G.player.rankZone}; G._addons=[];');
  eq(!!R('ruIsLegalAddon("player","left-flank","ai3")'), tag, mode + ': the partner Flank lends an Addon only in Tag');
  ok(!R('ruIsLegalAddon("player","rank","ai3")'), mode + ': never the partner Rank Zone');
  ok(!R('ruIsLegalAddon("player","left-flank","ai")'), mode + ': never an opponent card');
  R('G.selAttacker=null; G.ai3.leftFlank=null;');
  // the partner's Numeral skills: Tag lets you use them (your costs, your benefit); Team does not
  R('var __i1=buildDeck("inferno").find(function(c){return c.name==="Inferno 1";}); G.ai3.leftFlank=Object.assign({},__i1,{id:"t-inf1",currentNP:1,currentRP:1,usedSkill:false});' +
    'G.turn="player"; G.phase="main"; G.mode="normal";');
  eq(!!R('ruCanUsePartnerSkill("player","ai3","left-flank")'), tag, mode + ': a partner Numeral skill is usable only in Tag');
  if (tag) {
    m.apply({ t: 'startSkill', source: 'left-flank', id: 't-inf1', s: 'player' });
    for (let i = 0; i < 6; i++) { const pd = m.pending(); if (pd.kind === 'modal') m.apply({ t: 'modal', i: 0, s: pd.owner }); else if (pd.kind === 'pick') m.apply({ t: 'pick', ix: [0], ids: [], s: pd.owner }); else break; }
    ok(R('G.ai3.leftFlank===null'), 'tag: the partner card used by A left the partner Flank (its own cost)');
    ok(R('G.ai3.deadzone.some(function(c){return c.id==="t-inf1";})'), 'tag: and went to the team Deadzone');
  }
  R('G.ai3.leftFlank=null; G.turn=G.sideOrder[0]; G.phase="draw";');
  // the user picks which opponent a single-opponent effect hits (read from the card text, never a name list)
  const asks = (nm) => R('(function(){var c=null;Object.keys(CM).some(function(k){c=(buildDeck(k)||[]).find(function(x){return x.name===' + J(nm) + ';});return !!c;});return ruChoosesOpponent(c);})()');
  ok(asks('Astute 3') && asks('Negative 5') && asks('Strike') && asks('Studious Star'), mode + ': target / plain opponent effects ask');
  ok(!asks('Inferno 8') && !asks('Haste 2') && !asks('Shadow 3') && !asks('Negative 3') && !asks('Inferno 3') && !asks('Protect'), mode + ': attack, card-pick, all-opponent and defence effects do not ask');
  R('var __n5=buildDeck("negative").find(function(c){return c.name==="Negative 5";}); G.player.bank.unshift(Object.assign({},__n5,{id:"t-neg5",usedSkill:false}));' +
    'G.ai.rankZone.currentNP=5; G.ai2.rankZone.currentNP=5; G.turn="player"; G.phase="main"; G.mode="normal";');
  m.apply({ t: 'startSkill', source: 'bank', id: 't-neg5', s: 'player' });
  let sawChoice = false;
  for (let i = 0; i < 6; i++) {
    const pd = m.pending();
    if (pd.kind !== 'modal' && pd.kind !== 'pick') break;
    if (pd.kind === 'modal' && /Target Opponent/.test(pd.title || '')) { sawChoice = true; m.apply({ t: 'modal', i: R('livingOpponentsOf("player").indexOf("ai2")'), s: pd.owner }); continue; }   // (the buttons list the opponents in turn order)
    if (pd.kind === 'modal') m.apply({ t: 'modal', i: 0, s: pd.owner }); else m.apply({ t: 'pick', ix: [0], ids: [], s: pd.owner });
  }
  ok(sawChoice, mode + ': Negative 5 asks which opponent');
  eq([R('G.ai2.rankZone.currentNP'), R('G.ai.rankZone.currentNP')], [2, 5], mode + ': only the chosen opponent (D) is hit');
  R('G.turn=G.sideOrder[0]; G.phase="draw"; SF=null;');
  // Tag: a "your field" effect (Plus: your Rank Zone and Flank Zone cards +2 NP) reaches the partner's field too
  R('var __plus=buildDeck("light").find(function(c){return c.name==="Plus";})||buildDeck("inferno").find(function(c){return c.name==="Plus";});' +
    'G.player.hand.push(Object.assign({},__plus,{id:"t-plus"})); G.player.rankZone.A=1; G.player.actUsed=0;' +
    'G.player.rankZone.currentNP=4; G.ai3.rankZone.currentNP=3; G.ai3.rightFlank=Object.assign({},G.ai3.rankZone,{id:"t-bflank",currentNP:2});' +
    'G.turn="player"; G.phase="main"; G.mode="normal";');
  m.apply({ t: 'playAction', id: 't-plus', s: 'player' });
  for (let i = 0; i < 4; i++) { const pd = m.pending(); if (pd.kind === 'modal') m.apply({ t: 'modal', i: 0, s: pd.owner }); else if (pd.kind === 'pick') m.apply({ t: 'pick', ix: [0], ids: [], s: pd.owner }); else break; }
  eq(R('G.player.rankZone.currentNP'), 6, mode + ': Plus buffs your own Rank Zone');
  eq([R('G.ai3.rankZone.currentNP'), R('G.ai3.rightFlank.currentNP')], tag ? [5, 4] : [3, 2], mode + ': ' + (tag ? 'Tag: the partner field gets the same +2' : 'Team: the partner field is untouched'));
  R('G.ai3.rightFlank=null; G.turn=G.sideOrder[0]; G.phase="draw"; SF=null;');
  // the partner's Battlefield as YOUR material (both modes): Chief Flank and Max Rank Up
  const mk = (id, n, r, extra) => 'Object.assign({},G.player.rankZone,{id:"' + id + '",name:"Numeral ' + n + '",class:"classless",type:"numeral",numeral:' + n + ',rank:' + r + ',currentNP:' + n + ',currentRP:' + r + ',skillType:"Basic",_empty:false' + (extra || '') + '})';
  R('G.player.rankZone=' + mk('t-rz', 9, 3) + '; G.player.leftFlank=null; G.player.hand.push(' + mk('t-chief', 8, 3) + ');' +
    'G.ai3.leftFlank=' + mk('t-mat2', 6, 2) + '; G.turn="player"; G.phase="rally"; G.mode="normal";');
  m.apply({ t: 'relieveHand', id: 't-chief', s: 'player' });
  m.apply({ t: 'zone', o: 'ai3', z: 'left-flank', s: 'player' });
  eq([R('G.player.leftFlank&&G.player.leftFlank.id'), R('G.ai3.leftFlank'), R('G.ai3.discard.some(function(c){return c.id==="t-mat2";})')], ['t-chief', null, true],
    mode + ': Chief Flank with the partner Rank 2 Flank card (it goes to the partner Drop)');
  R('G.player.leftFlank=null; G.player.bank.unshift(' + mk('t-r1', 2, 1) + '); G.ai3.rightFlank=' + mk('t-r3', 8, 3) + ';' +
    'G.player.hand.push(' + mk('t-max', 10, 4) + '); G.phase="promotion"; G.mode="normal";');
  m.apply({ t: 'maxPromote', id: 't-max', s: 'player' });
  for (let i = 0; i < 4; i++) {
    const pd = m.pending(); if (pd.kind !== 'pick') break;
    const ids = R('PCK.pool.map(function(c){return c.id;})'), want = ids.indexOf('t-r1') !== -1 ? 't-r1' : 't-r3';
    m.apply({ t: 'pick', ix: [ids.indexOf(want)], ids: [], s: pd.owner });
  }
  eq([R('G.player.rankZone.id'), R('G.ai3.rightFlank'), R('G.ai3.discard.some(function(c){return c.id==="t-r3";})')], ['t-max', null, true],
    mode + ': Max Rank Up with the partner Rank 3 Flank card');
  R('G.turn=G.sideOrder[0]; G.phase="draw"; G.mode="normal"; SF=null;');
  // Tag: a team acts as ONE player — "your opponents lose 3 MP" costs the other team 3 once; Team: each opponent 3
  R('var __i3=buildDeck("inferno").find(function(c){return c.name==="Inferno 3";}); G.player.hand.push(Object.assign({},__i3,{id:"t-inf3"}));' +
    'G.turn="player"; G.phase="main"; G.mode="normal"; G.ai.mp=15; G.ai2.mp=15;');
  m.apply({ t: 'startSkill', source: 'hand', id: 't-inf3', s: 'player' });
  for (let i = 0; i < 4; i++) { const pd = m.pending(); if (pd.kind === 'modal') m.apply({ t: 'modal', i: 0, s: pd.owner }); else if (pd.kind === 'pick') m.apply({ t: 'pick', ix: [0], ids: [], s: pd.owner }); else break; }
  eq([R('G.ai.mp'), R('G.ai2.mp')], tag ? [12, 12] : [12, 12], mode + ': Inferno 3 — ' + (tag ? 'the other team (one player) loses 3 once' : 'each opponent loses 3'));
  eq(R('ruAllOtherPlayers("player")').sort(), tag ? ['ai', 'ai2'] : ['ai', 'ai2', 'ai3'], mode + ': "all other players" ' + (tag ? 'is the other team' : 'includes the partner'));
  R('G.turn=G.sideOrder[0]; G.phase="draw"; G.mode="normal"; SF=null;');
  if (tag) {
    // the Action Card limit is the team's highest A, and its uses are the team's
    R('G.player.rankZone.A=1; G.ai3.rankZone.A=3; G.player.actUsed=0;');
    eq(R('ruEffectiveA(G.player)'), 3, 'tag: the limit is the highest A on the team battlefield');
    R('G.ai3.actUsed=2'); eq(R('G.player.actUsed'), 2, 'tag: Action Card uses are pooled');
    R('G.player.actUsed=0');
    // shared pools, and they survive the copy every bot lookahead makes
    const mp0 = R('G.ai3.mp'), cas0 = R('G.player.cas');
    R('G.player.mp-=4'); eq(R('G.ai3.mp'), mp0 - 4, 'tag: a partner Morale is the team Morale');
    R('G.ai3.cas+=2'); eq(R('G.player.cas'), cas0 + 2, 'tag: Casualties are the team Casualties');
    ok(R('G.player.deadzone===G.ai3.deadzone'), 'tag: one Deadzone per team');
    ok(R('G.ai.deadzone!==G.player.deadzone'), 'tag: each team its own Deadzone');
    R('var __s=__S.snap(); __S.restore(__s);');
    R('G.player.mp+=1'); eq(R('G.ai3.mp'), mp0 - 3, 'tag: still shared after a snapshot restore');
    ok(R('G.player.deadzone===G.ai3.deadzone'), 'tag: Deadzone still shared after a snapshot restore');
    R('G.player.mp=0; checkWin();');
    ok(R('!!G._queuedPhaseWin') && R('ruSameTeam(G._queuedPhaseWin.winner,"ai")'), 'tag: the team at 0 Morale loses the match');
  } else {
    R('G.ai.mp=0; checkWin();');
    ok(R('!!(G._queuedEliminations&&G._queuedEliminations.ai)'), 'team: C at 0 Morale is queued for elimination');
    ok(!R('G._queuedPhaseWin'), 'team: one player down does not end the match');
    R('resolveQueuedEliminations()');
    ok(R('!!G.eliminated.ai'), 'team: C is eliminated at the end of the phase');
    eq(R('livingOpponentsOf("player")'), ['ai2'], 'team: an eliminated opponent is not attackable');
    eq(R('ruAllOtherPlayers("ai3")').sort(), ['ai', 'ai2', 'player'], 'team: "all other players" reaches the partner and an eliminated player');
    eq(R('oppList("ai3")'), ['ai2'], 'team: "all opponents" only the living other team');
    R('ruAllOtherPlayers("ai3").forEach(function(s){G[s].mp+=1;}); checkWin();');   // as Restorative 1 / 7 would
    ok(!R('G.eliminated.ai'), 'team: an all-players Morale gain brings C back (0 -> 1)');
    R('G.ai.mp=-2; G.ai2.cas=15; checkWin();');
    ok(R('!!G._queuedPhaseWin') && R('ruSameTeam(G._queuedPhaseWin.winner,"player")'), 'team: both of C+D down → A+B win');
  }
}

function deckOut(mode) {
  const m = start(mode, 23, 0), R = (x) => m.eng.run(x);
  const tag = mode === 'tag2v2';
  R('G.player.discard.push(...G.player.deck.splice(0))');
  R('draw("player",1)');
  if (tag) {
    ok(!R('G.eliminated.player') && !R('G.gameOver'), 'tag: an empty Deck alone is a skipped draw, not a loss');
    R('G.ai3.discard.push(...G.ai3.deck.splice(0)); draw("ai3",1);');
    ok(R('!!G.gameOver') && R('ruSameTeam(G.__winner,"ai")'), 'tag: both Decks empty → the team loses');
  } else {
    ok(R('!!G.eliminated.player') && !R('G.gameOver'), 'team: an empty Deck eliminates that player only');
    eq(R('G._elimReason.player'), 'deck-out', 'team: a deck-out is recorded as such');
    R('G.player.deck.push(G.player.discard.pop()); checkWin();');
    ok(R('!!G.eliminated.player'), 'team: one card restored to the Deck is not enough to return');
    R('G.player.deck.push(G.player.discard.pop()); checkWin();');
    ok(!R('G.eliminated.player'), 'team: two cards restored to the Deck bring the player back');
  }
}

// ── random play ──
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ZONES = ['rank', 'left-flank', 'right-flank', 'rear-flank'];
function randomInput(m, rnd) {
  const pend = m.pending(), pick = (a) => a[Math.floor(rnd() * a.length)];
  if (pend.kind === 'modal') return { t: 'modal', i: Math.floor(rnd() * Math.max(1, pend.n)), s: pend.owner };
  if (pend.kind === 'pick') {
    const n = pend.n, want = Math.min(n, Math.max(pend.min || 0, Math.floor(rnd() * ((pend.max || 1) + 1))));
    const ix = [], order = Array.from({ length: n }, (_, i) => i).sort(() => rnd() - 0.5);
    for (let i = 0; i < order.length && ix.length < (pend.np ? n : want); i++) ix.push(order[i]);
    return { t: 'pick', ix: pend.np ? ix.slice(0, Math.max(1, Math.ceil(n / 2))) : ix, ids: [], s: pend.owner };
  }
  if (pend.kind !== 'turn') return null;
  const seat = pend.owner, o = m.options(seat), r = rnd();
  if (pend.mode === 'switchdraw') return r < 0.6 && o.hand.length ? { t: 'sd', id: pick(o.hand), first: false, s: seat } : { t: 'sdDone', first: true, s: seat };
  if (pend.mode && pend.mode !== 'normal') {
    if (r < 0.15) return { t: 'cancel', s: seat };
    if (pend.mode === 'atk' && o.field.length) return { t: 'zone', o: seat, z: pick(o.field), s: seat };
    // any seat's zone — including the partner's, which the engine must refuse as an attack target
    return { t: 'zone', o: pick(SEATS), z: pick(ZONES), s: seat };
  }
  const ph = pend.phase;
  if (ph === 'draw') return { t: 'adv', s: seat };
  if (r < 0.30 && o.hand.length) return { t: 'hand', id: pick(o.hand), s: seat };
  if (r < 0.40 && o.bank.length && ['main', 'standby', 'battle'].includes(ph)) return { t: 'startSkill', source: 'bank', id: pick(o.bank), s: seat };
  if (r < 0.47 && o.dead.length) return { t: 'areaFx', id: pick(o.dead), i: 0, s: seat };
  if (r < 0.60 && ph === 'battle') return { t: 'atkMode', s: seat };
  if (r < 0.66 && o.delta) return { t: 'delta', w: seat, s: seat };
  if (r < 0.93) return { t: 'adv', s: seat };
  return { t: 'end', s: seat };
}
const WATCH = `(function(){ if(window.__atkLog) return; window.__atkLog=[]; var o=window.ruDeclareAttack;
  window.ruDeclareAttack=ruDeclareAttack=function(aw,az,dw){ window.__atkLog.push([aw,dw]); return o.apply(this,arguments); }; })()`;
function playOne(mode, seed) {
  const rnd = mulberry32(seed * 7919 + 13), m = start(mode, seed, seed % 4);
  m.eng.run(WATCH);
  let steps = 0, stale = 0, last = '';
  const trace = [];
  while (steps < 3000) {
    const pend = m.pending();
    if (pend.kind === 'over' || pend.kind === 'none') break;
    const a = randomInput(m, rnd); if (!a) break;
    m.apply(a); steps++;
    const s = m.sig(); trace.push(s);
    if (s === last) { if (++stale > 300) break; } else { stale = 0; last = s; }
  }
  const atk = m.eng.run('window.__atkLog'), bad = atk.filter(([a, d]) => m.eng.run('ruSameTeam(' + J(a) + ',' + J(d) + ')'));
  return { steps, winner: m.winner(), turns: m.turnNo(), attacks: atk.length, partnerAttacks: bad.length, errors: m.eng.errors.slice(0, 4), trace };
}

// The partner's Battlefield Numeral as an Amalgamation Element (both modes): A takes 2 Elements from its own field
// and 1 from partner B's Flank; B's card leaves B's Battlefield.
function evoElements(mode) {
  const m = newMatch({ seed: 31, rngSeed: 31, mode, order: ORDER.slice(), classes: { player: 'light', ai: 'zero', ai2: 'shadow', ai3: 'inferno' }, dd0: ['amalg-unknown-3'] });
  m.eng.run(STATE_CODE);
  const R = (x) => m.eng.run(x);
  const n3 = (id) => 'Object.assign({},G.player.rankZone,{id:"' + id + '",name:"Numeral 3",class:"classless",type:"numeral",numeral:3,rank:1,currentNP:3,currentRP:1,skillType:"Basic",_empty:false})';
  R('G.player.rankZone=' + n3('e-rz') + '; G.player.leftFlank=' + n3('e-lf') + '; G.ai3.rightFlank=' + n3('e-b') + '; G.player.delta=[];' +
    'G.turn="player"; G.phase="main"; G.mode="normal";');
  const evo = R('JSON.stringify((G.player.evolutions||[]).map(function(e){return {id:e.id,base:e.baseId};}))');
  const ev = JSON.parse(evo)[0];
  ok(!!ev, mode + ': A has the Amalgamation in its Δ Deck');
  m.apply({ t: 'amalgRank', evoId: ev.base || ev.id, evoCardId: ev.id, elementIds: ['e-rz', 'e-lf', 'e-b'], s: 'player' });
  eq([R('!!(G.player.delta[0])'), R('G.ai3.rightFlank'), R('(G.player.delta[0]&&G.player.delta[0].elements||[]).map(function(c){return c.id;}).sort().join(",")')], [true, null, 'e-b,e-lf,e-rz'],
    mode + ': an Element taken from the partner Battlefield');
}

// Answering for the attacked partner: B pays for Cease (M3); the effect — the negation and the Morale boost — goes to
// whoever B chooses (Team mode: the Morale lands on that seat only).
function partnerAnswer(choice) {
  const m = newMatch({ seed: 41, rngSeed: 41, mode: 'team2v2', order: ORDER.slice(), classes: { player: 'light', ai: 'zero', ai2: 'shadow', ai3: 'inferno' } });
  m.eng.run(STATE_CODE);
  const R = (x) => m.eng.run(x);
  R('var __cease=buildDeck("light").concat(buildDeck("zero")).find(function(c){return c.name==="Cease";});' +
    'closeModal(); _modalQueue.length=0; SF=null; G.turn="ai"; G.phase="battle"; G.mode="normal"; G._turnsCompletedBy={player:1,ai:1,ai2:1,ai3:1};' +
    '["player","ai","ai2","ai3"].forEach(function(w){var p=G[w]; p.hand=[]; p.mp=15; p.actUsed=0; p.attacksUsed={}; p.rankZone=Object.assign({},p.rankZone,{numeral:4,currentNP:4,rank:1,currentRP:1,A:1,attacksLeft:1,canAttack:true,_empty:false,type:"numeral"});});' +
    'G.ai.rankZone.currentNP=9; G.ai3.hand.push(Object.assign({},__cease,{id:"t-cease"}));');
  m.apply({ t: 'atkMode', s: 'ai' });
  m.apply({ t: 'zone', o: 'ai', z: 'rank', s: 'ai' });
  m.apply({ t: 'zone', o: 'player', z: 'rank', s: 'ai' });
  let sawWho = false;
  for (let i = 0; i < 12; i++) {
    const pd = m.pending();
    if (pd.kind === 'modal') {
      const L = pd.labels || [];
      let ix = L.findIndex((l) => /Pass/.test(l)); if (ix < 0) ix = 0;
      if (/Who Gets the Effect/.test(pd.title)) { sawWho = true; ix = choice === 'partner' ? L.findIndex((l) => /partner/i.test(l)) : L.findIndex((l) => /Myself/.test(l)); }
      else if (pd.owner === 'ai3' && L.some((l) => /Use Cease/.test(l))) ix = L.findIndex((l) => /Use Cease/.test(l));
      m.apply({ t: 'modal', i: ix, s: pd.owner }); continue;
    }
    if (pd.kind === 'pick') { m.apply({ t: 'pick', ix: [0], ids: [], s: pd.owner }); continue; }
    break;
  }
  ok(sawWho, 'team: answering for the partner asks who gets the effect');
  const st = JSON.parse(R('JSON.stringify({a:G.player.mp,b:G.ai3.mp,bh:G.ai3.hand.length,bu:G.ai3.actUsed||0,au:G.player.actUsed||0})'));
  eq([st.a, st.b], choice === 'partner' ? [18, 15] : [15, 18], 'team: Cease for the partner — its Morale boost goes to ' + (choice === 'partner' ? 'the partner' : 'the payer') + ' (no damage: the attack is negated)');
  eq([st.bh, st.bu, st.au], [0, 1, 0], 'team: the payer pays the card and the Action slot');
}

['team2v2', 'tag2v2'].forEach((mode) => { rules(mode); deckOut(mode); evoElements(mode); });
partnerAnswer('partner'); partnerAnswer('self');
console.log(`rules: ${checks} checks passed`);
const games = Number(process.argv[2] || 4), base = Number(process.argv[3] || 1);
let problems = 0;
['team2v2', 'tag2v2'].forEach((mode) => {
  for (let g = 0; g < games; g++) {
    const seed = base + g, t = Date.now(), r = playOne(mode, seed);
    if (r.errors.length || r.partnerAttacks) problems++;
    console.log(`${mode} seed ${seed}: ${r.steps} inputs, turn ${r.turns}, ${r.attacks} attacks (${r.partnerAttacks} on a partner), winner=${r.winner}, ${Date.now() - t} ms` +
      (r.errors.length ? '\n   errors: ' + r.errors.map((e) => String(e).slice(0, 220)).join('\n           ') : ''));
    if (g === 0) {
      const again = playOne(mode, seed), same = again.trace.length === r.trace.length && again.trace.every((s, i) => s === r.trace[i]);
      if (!same) problems++;
      console.log(`   determinism: ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
    }
  }
});
console.log(problems ? `\n${problems} problem(s)` : '\nOK');
process.exitCode = problems ? 1 : 0;
