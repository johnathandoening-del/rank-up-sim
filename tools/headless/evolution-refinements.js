'use strict';
// Controlled shared-input regression fixtures, not natural-play matches.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pair,REPORT}=require('./kismet-online');
const {prepare,settle}=require('./fullmetal-regressions');

for(const w of ['player','ai']){
  const other=w==='player'?'ai':'player';
  for(const pool of ['benevolent','malevolent','unknown'])for(const self of [false,true]){
    const p=pair(w,{player:'light',ai:'light'});
    p.run(`
      var me=G['${w}'],foe=G['${other}'];me.hand=[];me.bank=[];me.discard=[mkAct('Repair')];
      me.leftFlank=${self?'null':"mkNum({n:3,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless')"};
      var def=RU_AMALGAMATIONS.find(c=>c.id==='amalg-${pool}-6');
      me.delta=[Object.assign({},def,{id:uid(),baseId:def.id,type:'evolution',evoType:'amalgamation',class:'amalgamation',currentNP:6,currentRP:3,usedSkill:false,elements:[mkNum(ND.light.find(c=>c.n===6),'light'),mkNum(ND.light.find(c=>c.n===6),'light')]})];
      foe.hand=[];foe.leftFlank=null;foe.rightFlank=null;
      foe.rankZone=mkNum({n:8,r:3,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      me.deck=Array.from({length:25},()=>mkNum(ND.light.find(c=>c.n===4),'light'));me._firstDrawDone=true;
      foe.deck=Array.from({length:25},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
      G.turn='${other}';G.phase='battle';ruFieldWatch();
      ruDeclareAttack('${other}','rank','${w}','${self?'delta':'left-flank'}',0,function(){});
    `);
    for(let i=0;i<8&&p.pending().labels?.includes('Continue');i++)p.button('Continue');
    assert.equal(p.pending().owner,w,JSON.stringify(p.pending()));
    p.button('Use '+p.run(`G['${w}'].delta[0]?.name||RU_AMALGAMATIONS.find(c=>c.id==='amalg-${pool}-6').displayName`));
    p.pick([0]);settle(p);
    assert.ok(p.run(`!!G['${w}'].${self?'delta[0]':'leftFlank'}`));
    assert.equal(p.run(`G['${w}'].delta[0].elements.length`),1);
    assert.ok(p.run(`!!ruActLocked('${w}',mkAct('Plus'),'hand')`));
    const deck=p.run(`G['${other}'].deck.length`),drop=p.run(`G['${other}'].discard.length`);
    p.apply({t:'end',s:other});
    if(pool==='benevolent'){assert.equal(p.pending().owner,w);p.pick([0]);settle(p);}
    else settle(p);
    assert.equal(p.run(`G['${w}'].hand.filter(c=>c.name==='Repair').length`),pool==='benevolent'?1:0);
    assert.equal(p.run(`G['${other}'].deck.length`),deck-(pool==='malevolent'?1:0));
    assert.equal(p.run(`G['${other}'].discard.length`),drop+(pool==='malevolent'?1:0));
    p.finish(`${w} ${pool} Amalgamation 6 ${self?'self':'Flank'} rescue`);
    console.log('PASS',w,pool,'Amalgamation 6',self?'self':'Flank','distinct End effect and Action lock');
  }
  for(let n=1;n<=9;n++){
    const {p}=prepare(w,n,true);
    for(const ph of ['draw','promotion','rally','main','standby','battle','end']){
      p.run(`G.phase='${ph}';ruPhaseBegan('${ph}');`);
      assert.ok(!['modal','pick'].includes(p.pending().kind),'no unsolicited phase prompt: Fullmetal '+n+' '+ph);
    }
  }
  {
    const {p}=prepare(w,4,true),before=p.run(`G['${w}'].mp`);
    p.run(`ruLoseMP(G['${w}'],5,'numeral');`);
    assert.equal(p.pending().owner,w);assert.equal(p.run(`G['${w}'].mp`),before,'damage held before skill decision');
    p.button('Skill 1:');p.pick([0]);settle(p);
    assert.equal(p.run(`G['${w}'].mp`),before+2,'Numeral damage prevented; S applied');
    p.finish(`${w} Fullmetal 4 responds to actual Numeral damage`);
  }
  {
    const {p}=prepare(w,4,true),before=p.run(`G['${w}'].mp`);
    p.run(`ruLoseMP(G['${w}'],5,'action');`);
    assert.ok(!p.pending().labels.some(x=>x.startsWith('Skill 1:')),'Fullmetal 4 not offered for Action damage');
    p.button('Pass');settle(p);assert.equal(p.run(`G['${w}'].mp`),before-5);
    p.finish(`${w} Fullmetal 4 excludes irrelevant Skill 1`);
  }
  {
    const {p}=prepare(w,3,true),deck=p.run(`G['${w}'].deck.length`);
    p.run(`casDraw('${w}',{source:'action',additional:true});`);
    assert.equal(p.pending().owner,w);p.button('Skill 1:');p.pick([0]);settle(p);
    assert.equal(p.run(`G['${w}'].deck.length`),deck,'additional Casualty stopped before drawing');
    assert.equal(p.run(`RUFullmetal.state('${w}').negatedAdditional`),1);
    p.finish(`${w} Fullmetal 3 responds to incoming effect Casualty`);
  }
  {
    const {p}=prepare(w,8,true),before=p.run(`G['${w}'].mp`);
    p.run(`ruFx.damage('${w}',5,'Area damage',false);`);
    assert.equal(p.pending().owner,w);p.button('Skill 1:');p.pick([0]);p.pick([0]);settle(p);
    assert.equal(p.run(`G['${w}'].mp`),before+4,'damage prevented after actual costs');
    p.finish(`${w} Fullmetal 8 responds to effect damage`);
  }
  {
    const {p}=prepare(w,5,true);
    p.run(`G['${w}'].hand=[mkNum(ND.temporal.find(c=>c.n===3),'temporal')];
      G['${w}'].deck[8]=mkAct('Cease');
      ruDeclareAttack('${other}','rank','${w}','delta',0,function(){});`);
    assert.ok(p.pending().labels.includes('Use Temporal 3'),'first eligible targeted responder');
    p.button('Decline');
    assert.ok(p.pending().labels.some(x=>x.startsWith('Skill 1:')),'Fullmetal still gets its targeted response');
    p.button('Skill 1:');p.pick([0]);p.pick([0]);settle(p);
    assert.ok(p.run(`!!G['${w}'].delta[0]`));
    p.finish(`${w} Temporal 3 response continues into Fullmetal 5`);
  }
  {
    const {p}=prepare(w,5,true);
    p.run(`G._lastAtkInfo={aWho:'${w}'};
      G['${w}'].rankZone=mkNum({n:2,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      G._actor='${other}';ruWithActor('${other}',()=>doCounterAttack(0,{direct:true}));G._actor=null;`);
    p.button('Skill 1:');p.pick([0]);p.pick([0]);settle(p);
    assert.equal(p.run(`G['${w}'].rankZone.numeral`),2);
    assert.equal(p.run(`G['${w}'].mp`),33+2,'counterattack negated, only entry M and S gained');
    p.finish(`${w} Fullmetal 5 negates actual retaliation counterattack`);
  }
  console.log('PASS',w,'all nine phase transitions quiet; damage/Casualty prompts own seat and source-specific');
}
fs.writeFileSync(path.join(__dirname,'data','evolution-refinements.json'),JSON.stringify(REPORT,null,2));
