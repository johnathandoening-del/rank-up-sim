'use strict';
// Controlled rules/online fixtures, not natural-play match evidence.
const assert=require('node:assert/strict');
const {createEngine}=require('./engine');
const {MATCH_CODE}=require('../../ai/match');
const {pair,REPORT}=require('./kismet-online');

function openingMorale(){
  const e=createEngine({seed:912});e.run(MATCH_CODE);
  const classes=e.run('Object.keys(ND)');
  for(const cls of classes){
    for(const firstSeat of [0,1]){
      e.run(`__H.start({seed:912,mySeat:0,seat0Class:'${cls}',seat1Class:'${cls}',firstSeat:${firstSeat},name0:'P1',name1:'P2',allowEvolutions:false,deltaDecks:{player:[],ai:[]}})`);
      e.settle(1000);
      const m=e.run(`ND['${cls}'].find(c=>c.n===0).M||0`);
      assert.deepEqual(Array.from(e.run('[G.player.mp,G.ai.mp]')),[15+m,15+m],cls+' opening Morale');
      e.run(`closeModal();PCK=null;document.getElementById('picker-modal').classList.remove('open');G.mode='normal';beginPhase('draw');`);
      e.settle(1000);
      assert.deepEqual(Array.from(e.run('[G.player.mp,G.ai.mp]')),[15+m,15+m],cls+' must not grant M twice');
    }
  }
  assert.deepEqual(e.errors,[]);
  console.log('PASS all '+classes.length+' classes: signed starting M for both seats and both first-seat orders, applied once');
  for(const cls of ['maximum','restorative','celestial','ochre','kismet']){
    const p=pair('player');
    p.run(`__H.start({seed:912,mySeat:ruLocalSeatId()==='player'?0:1,seat0Class:'${cls}',seat1Class:'${cls}',firstSeat:1,name0:'P1',name1:'P2',allowEvolutions:false,deltaDecks:{player:[],ai:[]}})`);
    const m=p.run(`ND['${cls}'].find(c=>c.n===0).M||0`);
    assert.deepEqual(Array.from(p.run('[G.player.mp,G.ai.mp]')),[15+m,15+m]);
    p.finish(cls+' opening Morale');
  }
}

function restorativeFive(){
  for(const seat of ['player','ai'])for(const attacking of [true,false]){
    const other=seat==='player'?'ai':'player',p=pair(seat,{[seat]:'restorative',[other]:'light'});
    p.run(`
      var me=G.${seat},foe=G.${other};
      me.class='restorative';me.rankZone=mkNum(ND.restorative.find(c=>c.n===5),'restorative');me.leftFlank=null;
      me.hand=[];me.discard=[];me.bank=[];
      foe.rankZone=mkNum({n:6,r:4,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');foe.hand=[];foe.leftFlank=null;
      me.deck=Array.from({length:25},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
      foe.deck=Array.from({length:25},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
      G.turn='${attacking?seat:other}';G.phase='battle';ruFieldWatch();
      ruDeclareAttack('${attacking?seat:other}','rank','${attacking?other:seat}','rank',0,function(){});
    `);
    assert.equal(p.pending().owner,seat);p.button('Use Restorative 5');p.decline();
    assert.equal(p.run(`G.${seat}.mp`),30+2+(attacking?4:2)-1,'S plus attacked card Rank, minus battle damage');
    assert.equal(p.run(`G.${seat}.discard.length`),1,'one-card mill actually paid');
    assert.equal(p.run(`G.${seat}.rankZone.usedSkill`),true);
    p.run(`G.${seat}.rankZone.usedSkill=false;G.${seat}.rankZone.attacksLeft=2;
      ruDeclareAttack('${attacking?seat:other}','rank','${attacking?other:seat}','rank',0,function(){});`);
    p.decline();
    assert.equal(p.run(`G.${seat}.discard.length`),1,'no second mill/skill even after a field refresh');
    assert.equal(p.run(`G.${seat}.mp`),30+2+(attacking?4:2)-2,'no repeated skill Morale');
    p.finish(seat+' Restorative 5 '+(attacking?'attacks':'defends'));
    console.log('PASS '+seat+' Restorative 5 '+(attacking?'attacks':'defends')+': prompt, payment, S and actual attacked Rank');
  }
}

function amalgamationSix(){
  for(const seat of ['player','ai'])for(const self of [false,true]){
    const other=seat==='player'?'ai':'player',p=pair(seat,{player:'light',ai:'light'});
    p.run(`
      var me=G.${seat},foe=G.${other};me.hand=[];me.bank=[];me.discard=[mkAct('Repair')];me.leftFlank=null;
      var def=RU_AMALGAMATIONS.find(c=>c.id==='amalg-benevolent-6');
      me.delta=[Object.assign({},def,{id:uid(),baseId:def.id,type:'evolution',evoType:'amalgamation',class:'amalgamation',name:'Amalgamation 6 Skilled',currentNP:6,currentRP:3,attacksLeft:1,canAttack:true,usedSkill:false,elements:[mkNum(ND.light.find(c=>c.n===6),'light'),mkNum(ND.light.find(c=>c.n===6),'light')]})];
      if(!${self})me.leftFlank=mkNum({n:3,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      foe.rankZone=mkNum({n:8,r:3,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');foe.hand=[];foe.leftFlank=null;
      me.deck=Array.from({length:25},()=>mkNum(ND.light.find(c=>c.n===4),'light'));me._firstDrawDone=true;
      G.turn='${other}';G.phase='battle';ruFieldWatch();
      ruDeclareAttack('${other}','rank','${seat}','${self?'delta':'left-flank'}',0,function(){});
    `);
    for(let i=0;i<8&&p.pending().labels&&p.pending().labels.includes('Continue');i++)p.button('Continue');
    assert.equal(p.pending().owner,seat);p.button('Use Amalgamation 6');p.pick([0]);
    for(let i=0;i<8&&p.pending().labels&&p.pending().labels.includes('Continue');i++)p.button('Continue');
    assert.ok(p.run(`!!G.${seat}.${self?'delta[0]':'leftFlank'}`),'destroyed Numeral restored');
    assert.equal(p.run(`G.${seat}.delta[0].elements.length`),1);
    assert.equal(p.run(`G.${seat}.mp`),30-(self?2:5)+4,'S4 is actually granted');
    assert.equal(p.run(`G.${seat}.hand.length`),0,'no early recovery');
    for(const name of ['Plus','Protect','Strike'])assert.ok(p.run(`!!ruActLocked('${seat}',mkAct('${name}'),'hand')`),'all Action types locked');
    p.apply({t:'end',s:other});
    assert.equal(p.pending().kind,'pick');assert.equal(p.pending().owner,seat);
    assert.equal(p.run('G._turnNo'),4,'handoff waits for recovery');
    p.pick([0]);
    assert.equal(p.run(`G.${seat}.hand.filter(c=>c.name==='Repair').length`),1);
    assert.equal(p.run('G._turnNo'),5);
    assert.equal(p.run(`!!ruActLocked('${seat}',mkAct('Plus'),'hand')`),false,'lock expires next turn');
    p.finish(seat+' Benevolent Amalgamation 6 '+(self?'self-save':'Flank save'));
    console.log('PASS '+seat+' Benevolent 6 '+(self?'self-save':'Flank save')+': Element choice, S, save, all Action locks, owned End recovery and handoff');
  }
}

function temporalFour(seat,star,source,newCasualty){
  const other=seat==='player'?'ai':'player',p=pair(seat,{[seat]:'temporal',[other]:'light'});
  p.run(`
    closeModal();ruSettleReset();G._tl=null;
    var me=G.${seat},foe=G.${other};
    me.class='temporal';me.hand=[];me.leftFlank=mkNum({n:2,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');me.discard=[];me.bank=[];
    me.rankZone=mkNum(ND.temporal.find(c=>c.n===4),'temporal');
    foe.class='light';foe.hand=[];foe.leftFlank=null;foe.discard=[];foe.bank=[];
    foe.rankZone=mkNum({n:5,r:2,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
    me.deck=Array.from({length:30},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
    me['${source}'].push(mkAct('${star}'));
    foe.deck=Array.from({length:30},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
    if(${!!newCasualty})foe.deck[0]=mkAct('Protect');
    me._firstDrawDone=true;foe._firstDrawDone=true;
    var originalTop=me.deck[0].id;
    G.turn='${seat}';G._turnNo=4;G.phase='standby';beginPhase('battle');
  `);
  const act=a=>p.apply(a);
  const attack=()=>{act({t:'atkMode',s:seat});act({t:'zone',s:seat,o:seat,z:'rank'});act({t:'zone',s:seat,o:other,z:'rank'});};
  attack();
  assert.ok(!p.pending().labels||!p.pending().labels.includes('Use Temporal 4'),'no cost offered without a previous Battle');
  while(p.pending().kind==='modal'&&p.pending().labels.includes('Continue'))p.button('Continue');
  assert.equal(p.run(`G.${seat}.deadzone[0].id===originalTop`),true,'original past drew the original top as a Casualty');
  p.run("log('Superseded timeline sentinel','info')");
  act({t:'end',s:seat});
  if(p.pending().kind==='turn'&&p.pending().mode==='switchdraw')act({t:'sdDone',s:other,first:false});
  act({t:'end',s:other});
  if(p.pending().kind==='turn'&&p.pending().mode==='switchdraw')act({t:'sdDone',s:seat,first:false});
  while(p.pending().kind==='turn'&&p.pending().phase!=='battle')act({t:'adv',s:seat});
  attack();p.button('Use Temporal 4');
  assert.equal(p.pending().kind,'pick');p.pick([0]);
  // A Star with genuine new choices pauses the rewritten past for that choice's owner.
  let newDecision=false;
  for(let i=0;i<30&&p.pending().kind!=='turn';i++){
    const d=p.pending();
    if(d.kind==='pick')p.pick([0]);
    else if(d.kind==='modal'&&d.labels.includes('Skip Effect')){
      assert.equal(d.owner,other,'a newly created Casualty effect belongs to the affected opponent');
      newDecision=true;p.button('Skip Effect');
    }
    else if(d.kind==='modal')p.button(d.labels.find(x=>x==='Continue')||d.labels[0]);
    else throw Error('Unexpected replay decision '+JSON.stringify(d));
  }
  assert.equal(p.run('!!G._tlReplay'),false,'changed mandatory prompts must not strand the replay');
  assert.equal(p.run('G._turnNo'),6,'replay reaches the present turn');
  const np={ 'Rank Star':5,'Battle Star':7,'Draw Star':4,'Multi-Star':8,'Flank Star':5,'Thrash Star':9,'Encore Star':4,'Orchestral Star':4 }[star];
  assert.equal(p.run('G._battles.find(b=>b.turn===4).aNP'),np,'Star changes the actual historical battle');
  const m=p.run(`AC['${star}'].M`),pastLoss=star==='Encore Star'?5:(np===5?5:(np<5?1:0));
  assert.equal(p.run(`G.${seat}.mp`),30+m+4-pastLoss-1,'real Star M, free costs, changed past damage, S4 and current damage');
  assert.equal(p.run(`G.${seat}.discard.filter(c=>c.name==='${star}').length`),1,'the Star has one physical location in the new timeline');
  if(np>=5)assert.equal(p.run(`G.${seat}.hand.some(c=>c.id===originalTop)`),true,'the former Casualty is now a later drawn hand card');
  if(star==='Draw Star')assert.equal(p.run(`G.${seat}.hand.length`),5,'three past draws ripple into the later hand');
  if(star==='Battle Star'||star==='Multi-Star'||star==='Thrash Star')assert.ok(p.run(`G.${other}.cas`)>0,'new past Casualties really enter the other player\'s Deadzone');
  if(newCasualty){
    assert.equal(newDecision,false,'additional historical Casualties must not offer E2');
    assert.equal(p.run(`document.getElementById('log').textContent.includes('Secondary Effect is negated')`),true,'negated E2 is explained in the log');
    assert.equal(p.run(`G.${other}.deadzone.some(c=>c.name==='Protect')`),true,'formerly drawn Action is now a real past Casualty');
    assert.equal(p.run(`G.${other}.hand.some(c=>c.name==='Protect')`),false,'obsolete future hand card is gone');
  }
  assert.equal(p.run(`document.getElementById('log').textContent.includes('The timeline has been rewritten')`),true);
  assert.equal(p.run(`document.getElementById('log').textContent.includes('Superseded timeline sentinel')`),false,'obsolete timeline log rows are replaced');
  p.finish(seat+' Temporal 4 '+star+' from '+source+(newCasualty?' with negated extra E2':''));
  console.log('PASS '+seat+' Temporal 4 '+star+' from '+source+': actual past effect, future draws/Casualties, costs, Morale and completed replay');
}

if(require.main===module){
  const newOnly=process.argv.includes('--new-casualties-only');
  const restorativeOnly=process.argv.includes('--restorative-only');
  if(restorativeOnly)restorativeFive();
  if(!newOnly&&!restorativeOnly){
    if(!process.argv.includes('--temporal-only')){openingMorale();restorativeFive();amalgamationSix();}
    const stars=['Rank Star','Battle Star','Draw Star','Multi-Star','Flank Star','Thrash Star','Encore Star','Orchestral Star'];
    for(const seat of ['player','ai'])for(const star of stars)for(const source of ['deck','discard'])temporalFour(seat,star,source);
  }
  if(!restorativeOnly)for(const seat of ['player','ai'])temporalFour(seat,'Battle Star','discard',true);
  const fs=require('node:fs'),path=require('node:path');
  fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'data','online-regression.json'),JSON.stringify(REPORT,null,2));
}
