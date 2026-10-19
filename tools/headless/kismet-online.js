'use strict';
// Targeted regression fixtures, not natural-play match evidence.
const { createEngine } = require('./engine');
const { MATCH_CODE } = require('../../ai/match');
const assert = require('node:assert/strict');
const REPORT=[];

function fixture(localSeat, reactingSeat = 'ai') {
  const e = createEngine({ seed: 912 });
  e.testSetup=[];
  const setup=code=>{e.testSetup.push(code); return e.run(code);};
  setup(MATCH_CODE);
  setup(`__H.start({seed:912,mySeat:${localSeat === null ? 'null' : localSeat},spectator:${localSeat === null},seat0Class:'${reactingSeat === 'player' ? 'kismet' : 'light'}',seat1Class:'${reactingSeat === 'ai' ? 'kismet' : 'light'}',firstSeat:0,name0:'P1',name1:'P2',allowEvolutions:false,deltaDecks:{player:[],ai:[]}})`);
  e.settle(1000);
  setup(`
    closeModal(); document.getElementById('picker-modal').classList.remove('open'); PCK=null; _modalQueue.length=0; SF=null; ruSettleReset();
    window._RUcq.length=0; window._RUcbusy=false;
    G.turn='${reactingSeat === 'ai' ? 'player' : 'ai'}'; G.phase='main'; G.mode='normal'; G._turnNo=4; G.exchange=3;
    G._turnsCompletedBy={player:1,ai:1};
    ['player','ai'].forEach(function(w){
      var p=G[w]; p.hand=[]; p.bank=[]; p.discard=[]; p.deadzone=[]; p.cas=0; p.mp=30; p.actUsed=0;
      p.leftFlank=null; p.rightFlank=null; p.rankZone=mkNum({n:5,r:2,A:2,M:0,S:null,ca:true,st:'Basic'},p.class);
    });
    var p=G['${reactingSeat}'];
    p.hand.push(mkNum(ND.kismet.find(c=>c.n===1),'kismet'));
    p.discard.push(mkNum(ND.kismet.find(c=>c.n===3),'kismet'));
    p.leftFlank=mkNum(ND.kismet.find(c=>c.n===4),'kismet');
    G[G.turn].hand.push(mkAct('Plus'));
    ruFieldWatch();
  `);
  return e;
}

function pair(reactingSeat) {
  const engines = [fixture(0, reactingSeat), fixture(1, reactingSeat)];
  const p = {
    engines,
    operations:[],
    run(code) { p.operations.push({code}); const out = engines.map(e => e.run(code)); engines.forEach(e => e.settle(1000)); return out[0]; },
    pending() { return engines[0].run('__H.pending()'); },
    apply(a) {
      p.operations.push({action:a});
      engines.forEach(e => { e.run(`__H.apply(${JSON.stringify(a)})`); e.settle(1000); });
      assert.equal(engines[0].run('ruStateSig()'), engines[1].run('ruStateSig()'), 'P1/P2 state parity');
      engines.forEach(e => assert.deepEqual(e.errors, []));
    },
    button(text) {
      const d = p.pending(); assert.equal(d.kind, 'modal', JSON.stringify(d));
      const i = d.labels.findIndex(s => s.includes(text)); assert.ok(i >= 0, JSON.stringify(d));
      p.apply({t:'modal',s:d.owner,i});
    },
    pick(ix) { const d = p.pending(); assert.equal(d.kind,'pick'); p.apply({t:'pick',s:d.owner,ix,ids:[]}); },
    decline() { for(let i=0;i<20;i++){ const d=p.pending(); if(d.kind!=='modal')return; const n=d.labels.findIndex(s=>s==='Decline'||s==='Pass'); if(n<0)return; p.apply({t:'modal',s:d.owner,i:n}); } throw Error('Repeated prompts'); },
    finish(label) { REPORT.push({label,setup:engines.map(e=>e.testSetup),operations:p.operations,expected:engines.map(e=>({sig:e.run('ruStateSig()'),mp:e.run('[G.player.mp,G.ai.mp]'),pending:e.run('__H.pending()')}))}); }
  };
  return p;
}

function responseTests() {
  for (const seat of ['player','ai']) {
    for (const variant of ['1','3','4','3 Deadzone','4 Bank','1 own turn','3 own turn','4 own turn']) {
      const n=parseInt(variant),own=variant.includes('own turn');
      const p = pair(seat), other=seat==='player'?'ai':'player',actor=own?seat:other;
      if(variant.includes('Deadzone'))p.run(`G.${seat}.deadzone=G.${seat}.discard.splice(0); G.${seat}.cas=1; ruFieldWatch();`);
      if(variant.includes('Bank'))p.run(`G.${seat}.hand=[]; G.${seat}.bank=[mkNum(ND.kismet.find(c=>c.n===2),'kismet')]; ruFieldWatch();`);
      if(own)p.run(`G.turn='${seat}'; G.${seat}.hand.push(mkAct('Plus')); ruFieldWatch();`);
      p.apply({t:'playAction',s:actor,id:p.run(`G.${actor}.hand.find(c=>c.name==='Plus').id`)});
      p.button('Confirm'); p.button('Kismet '+n+' —');
      if(n===1)p.pick([0]);
      if(n===4)p.pick([0]);
      p.decline();
      assert.equal(p.run(`G.${actor}.rankZone.currentNP`),5,'NP change negated');
      assert.equal(p.run(`G.${seat}.mp`),30+(n===4?4:3)+(own&&n!==3?1:0),'skill and Action Morale');
      if(!own&&n===1)assert.equal(p.run(`G.${other}.mp`),31,'effect-only negation preserves Action Morale');
      if(!own&&n===3)assert.equal(p.run(`G.${other}.mp`),30,'activation negation also negates Action Morale');
      if(n===1)assert.equal(p.run(`G.${seat}.hand.some(c=>c.name==='Kismet 1')`),false);
      if(n===3)assert.equal(p.run(`G.${seat}.bank.some(c=>c.name==='Kismet 3')`),true);
      if(variant.includes('Deadzone'))assert.equal(p.run(`G.${seat}.cas`),0);
      if(variant.includes('Bank'))assert.equal(p.run(`G.${seat}.bank.length`),0,'Bank payment actually removed');
      if(n===4)assert.equal(p.run(`G.${other}.mp`),own?26:29,'actual negated-change damage');
      assert.equal(p.run('ruActionDropsThisTurn()'),1,'the played Action is dropped once even when negated');
      assert.equal(p.run('ruSettlePending()'),0,'activation settles completely');
      p.finish(`${seat} Kismet ${variant}`);
      console.log(`PASS ${seat} Kismet ${variant}: effect, costs, Morale, P1/P2 parity`);
    }
  }
}

function nineTests() {
  for(const seat of ['player','ai']) {
    const other=seat==='player'?'ai':'player',p=pair(seat);
    p.run(`
      var me=G.${seat}; me.hand=[mkAct('Repair'),mkNum(ND.kismet.find(c=>c.n===7),'kismet')];
      me.leftFlank=null; me.discard=[]; me.rankZone=mkNum(ND.kismet.find(c=>c.n===9),'kismet');
      ruFieldWatch();
    `);
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)}); p.button('Confirm');
    p.button('Kismet 9 — negate'); p.pick([0]); p.pick([0]); p.decline();
    assert.equal(p.run(`G.${other}.rankZone.currentNP`),5);
    assert.equal(p.run(`G.${other}.mp`),27,'activation M negated, then M times Rank damage');
    assert.equal(p.run(`G.${seat}.mp`),33);
    assert.equal(p.run(`G.${seat}.hand.length`),0);
    assert.equal(p.run(`G.${seat}.cas`),1);
    assert.ok(p.run(`!!ruActLocked('${other}',mkAct('Plus'),'hand')`));
    p.run('G._turnNo+=3');
    assert.equal(p.run(`!!ruActLocked('${other}',mkAct('Plus'),'hand')`),false);
    p.finish(`${seat} Kismet 9 lock`);
    console.log(`PASS ${seat} Kismet 9 Skill 2: negation, actual costs, three-turn lock, both Morale transfers`);
  }
  for(const seat of ['player','ai']){
    const other=seat==='player'?'ai':'player',p=pair(seat);
    p.run(`
      var me=G.${seat},foe=G.${other}; me.hand=[]; me.leftFlank=null; me.discard=[];
      me.rankZone=mkNum(ND.kismet.find(c=>c.n===6),'kismet');
      me.deck=me.deck.filter(c=>c.name!=='Kismet 9'); me.deck.push(mkNum(ND.kismet.find(c=>c.n===9),'kismet'));
      foe.hand=[mkAct('Plus'),mkAct('Rank Star')]; ruFieldWatch();
    `);
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)}); p.button('Confirm'); p.decline();
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)}); p.button('Confirm');
    p.button('Kismet 9 — add it'); p.decline();
    assert.equal(p.run(`G.${seat}.hand.filter(c=>c.name==='Kismet 9').length`),1);
    assert.equal(p.run(`G.${seat}.mp`),32);
    p.run(`
      closeModal(); ruSettleReset();
      G.turn='${seat}'; G._turnNo++; G.phase='draw';
      G.${seat}.deck.unshift(mkNum(ND.kismet.find(c=>c.n===2),'kismet'),mkNum(ND.kismet.find(c=>c.n===5),'kismet'));
      beginPhase('draw');
    `);
    p.decline();
    // Draw has no Actions, so normal advance opens Promotion.
    if(p.pending().kind==='turn'&&p.pending().phase==='draw')p.apply({t:'adv',s:seat});
    p.apply({t:'promote',s:seat,id:p.run(`G.${seat}.hand.find(c=>c.name==='Kismet 9').id`)});
    assert.equal(p.run(`G.${seat}.rankZone.name`),'Kismet 9');
    assert.equal(p.run(`G.${other}.deadzone.filter(c=>c.type==='action').length`),2);
    assert.equal(p.run(`G.${seat}.hand.length`),4,'two normal draws plus two deployment draws');
    p.finish(`${seat} Kismet 9 next-turn deployment`);
    console.log(`PASS ${seat} Kismet 9 Skill 1: prompt, retrieval, next-turn placement, both Actions ceded and draw two`);
  }
}

function skillTests() {
  for(const seat of ['player','ai']) {
    const other=seat==='player'?'ai':'player';
    {
      const p=pair(seat);
      p.run(`
        var me=G.${seat},foe=G.${other}; me.hand=[mkNum(ND.kismet.find(c=>c.n===5),'kismet')];
        me.rankZone=mkNum(ND.kismet.find(c=>c.n===7),'kismet'); me.leftFlank=null;
        me.bank=[mkNum(ND.kismet.find(c=>c.n===4),'kismet')]; me.discard=[];
        me.deadzone=[mkAct('Repair'),mkNum(ND.kismet.find(c=>c.n===4),'kismet')]; me.cas=2;
        foe.hand=[mkAct('Plus'),mkAct('Repair'),mkNum(ND.light.find(c=>c.n===1),'light')];
        ruFieldWatch(); beginPhase('main');
      `);
      assert.equal(p.pending().owner,seat); p.button('Use Kismet 7'); p.button('Activate Skill');
      p.pick([0]); p.pick([0]); p.pick([0]); p.pick([0]);
      assert.equal(p.pending().owner,other,'opponent chooses their own discard');
      p.pick([0,1]); p.decline();
      assert.equal(p.run(`G.${other}.mp`),24,'Kismet 7 counts both costs, both DZ drops and opponent drops');
      assert.equal(p.run(`G.${seat}.mp`),34); assert.equal(p.run(`G.${seat}.cas`),0);
      assert.equal(p.run(`ruAttackBanned(G.${seat}.rankZone)`),true);
      assert.equal(p.run(`G.${other}.hand.length`),1);
      p.finish(`${seat} Kismet 7`);
      console.log(`PASS ${seat} Kismet 7: off-turn prompt, owned picks, full damage and attack ban`);
    }
    for(const endEarly of [true,false]){
      const p=pair(seat);
      p.run(`
        var me=G.${seat},foe=G.${other}; me.class='haste';
        me.rankZone=mkNum({n:6,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless'); me.leftFlank=null;
        me.hand=[]; me.bank=[mkNum(ND.haste.find(c=>c.n===2),'haste')]; me.discard=[];
        me.rightFlank=mkNum({n:3,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
        foe.hand=[]; foe.leftFlank=null; var len=me.deck.length; G.__testDeck=len;
        ruFieldWatch(); beginPhase('main');
      `);
      p.button('Haste 2 from Bank'); p.button('Activate Skill');
      // Passing the remaining skill window must not forfeit the granted attack.
      p.decline();
      assert.equal(p.run(`G.${seat}.deadzone.some(c=>c.name==='Haste 2')`),true);
      assert.equal(p.run(`G.${seat}.deck.length`),p.run('G.__testDeck')-2);
      if(endEarly)p.apply({t:'end',s:other});else p.run("beginPhase('battle')");
      assert.equal(p.run('eligibleHasteAttackers164().length'),1,'only the card granted an attack may attack');
      assert.equal(p.pending().owner,seat); p.button('Numeral 6 ->'); p.decline();
      for(let i=0;i<12&&p.pending().kind==='modal';i++){
        const d=p.pending(); if(d.labels.includes('Continue'))p.button('Continue'); else if(d.labels.includes('Skip Effect'))p.button('Skip Effect'); else break;
      }
      assert.ok(p.run(`G.${other}.mp`)<30,'granted off-turn attack actually deals damage');
      p.finish(`${seat} Haste 2 ${endEarly?'before skipped Battle':'Battle Phase'}`);
      console.log(`PASS ${seat} Haste 2: cost, classless Rank attack, ${endEarly?'skipped Battle':'normal Battle'}, no ungranted attacks`);
    }
    {
      const p=pair(seat);
      p.run(`
        var me=G.${seat},foe=G.${other}; me.rankZone=mkNum(ND.kismet.find(c=>c.n===8),'kismet');
        me.leftFlank=null; me.hand=[mkAct('Repair'),mkAct('Plus')]; me.bank=[]; me.discard=[];
        foe.rankZone=mkNum({n:8,r:3,A:1,M:0,S:null,ca:true,st:'Basic'},'classless'); foe.hand=[];
        ruFieldWatch(); ruDrop(foe,mkAct('Reverse')); ruFieldWatch();
        me.deck=[mkAct('Repair'),mkAct('Plus')].concat(me.deck);
        foe.deck=[mkAct('Plus'),mkNum(ND.light.find(c=>c.n===1),'light')].concat(foe.deck);
        beginPhase('main');
      `);
      p.button('Use Kismet 8'); p.button('Activate Skill'); p.decline();
      assert.equal(p.run(`G.${seat}.rankZone.A`),1);
      assert.equal(p.run('ruActionDropsThisTurn()'),3,'includes a prior drop by the other player and both costs');
      p.run("beginPhase('battle')"); p.button('Kismet 8 ->'); p.decline();
      assert.equal(p.run(`G.${other}.mp`),17,'eight tie damage plus all five Action drops, not two draws');
      assert.equal(p.run(`G.${seat}.mp`),29,'S1 two Morale, eight tie damage, S2 five Morale');
      p.button('Kismet 8 ->'); p.decline();
      assert.equal(p.run(`G.${other}.mp`),3,'second tie and six cumulative drops');
      assert.equal(p.run(`G.${seat}.mp`),27);
      p.finish(`${seat} Kismet 8`);
      console.log(`PASS ${seat} Kismet 8: A1, off-turn attacks, reveal/drop, cumulative all-player damage and Morale`);
    }
  }
}

function midPhaseTests(){
  for(const seat of ['player','ai']){
    const other=seat==='player'?'ai':'player',p=pair(seat);
    p.run(`
      var me=G.${seat}; me.rankZone=mkNum(ND.kismet.find(c=>c.n===7),'kismet'); me.leftFlank=null;
      me.hand=[mkNum(ND.kismet.find(c=>c.n===5),'kismet')]; me.bank=[];
      me.deadzone=[mkAct('Repair'),mkAct('Plus')]; me.cas=2; ruFieldWatch(); beginPhase('main');
    `);
    assert.equal(p.pending().kind,'turn','no Kismet 7 offer without a Bank payment');
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)}); p.button('Confirm'); p.button('Kismet 3 —');
    assert.equal(p.pending().owner,seat);
    assert.ok(p.pending().labels.includes('Use Kismet 7'),'Kismet 3 makes Kismet 7 available in the same Main Phase');
    p.button('Pass');
    assert.equal(p.pending().kind,'turn','passing does not reopen an unchanged window');
    p.finish(`${seat} Kismet mid-phase eligibility`);
    console.log(`PASS ${seat} Kismet 3 to 7: newly legal skill prompted in the same phase`);
  }
}

function zeroTests(){
  for(const seat of ['player','ai']){
    const other=seat==='player'?'ai':'player',p=pair(seat);
    p.run(`
      var me=G.${seat}; me.hand=[mkNum(ND.kismet.find(c=>c.n===2),'kismet')]; me.leftFlank=null;
      me.rankZone=mkNum(ND.kismet.find(c=>c.n===0),'kismet'); me.discard=[];
      G.${other}.hand=[]; G.phase='battle'; ruFieldWatch();
      ruDeclareAttack('${other}','rank','${seat}','rank',0,function(){});
    `);
    assert.equal(p.pending().owner,seat); p.button('Use Kismet 0'); p.pick([0]); p.decline();
    assert.equal(p.run(`G.${seat}.mp`),32,'S2 gained, no battle Morale damage');
    assert.equal(p.run(`G.${seat}.cas`),0,'no battle Casualties');
    assert.equal(p.run(`G.${seat}.hand.length`),0,'discard was paid');
    p.finish(`${seat} Kismet 0 defense`);
    console.log(`PASS ${seat} Kismet 0: actual attack prompt, paid cost, S and both damage protections`);
  }
}

function dropHistoryTests(){
  const p=pair('player');
  p.run(`
    G._actionDrops=null;
    var a=mkAct('Repair'),b=mkAct('Plus');
    ruDrop(G.player,a); G.player.discard.splice(G.player.discard.indexOf(a),1); G.player.hand.push(a);
    ruDrop(G.ai,b);
  `);
  assert.equal(p.run('ruActionDropsThisTurn()'),2,'retrieval before a render must not erase a drop');
  p.run(`var a=G.player.hand.pop(); ruDrop(G.player,a);`);
  assert.equal(p.run('ruActionDropsThisTurn()'),3,'the same Action dropped again is another drop');
  p.run(`ruDrop(G.player,mkNum(ND.light[0],'light')); renderAll(); renderAll();`);
  assert.equal(p.run('ruActionDropsThisTurn()'),3,'Numerals and redraws do not increase Action drops');
  p.run('G._turnNo++');
  assert.equal(p.run('ruActionDropsThisTurn()'),0,'new turn starts with zero Action drops');
  p.run(`ruDrop(G.ai,mkAct('Repair'),mkAct('Plus'));`);
  assert.equal(p.run('ruActionDropsThisTurn()'),2,'batch drops count every Action');
  p.finish('all-player Drop history');
  console.log('PASS all-player Drop history: immediate retrieval, repeat drops, non-Actions, turn reset and batches');
}

if (require.main === module) {
  responseTests();
  skillTests();
  nineTests();
  midPhaseTests();
  zeroTests();
  dropHistoryTests();
  const fs=require('node:fs'),path=require('node:path');
  fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'data','online-regression.json'),JSON.stringify(REPORT,null,2));
}
module.exports = { fixture, pair };
