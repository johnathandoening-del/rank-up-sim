'use strict';
// Controlled two-client fixtures: actual shared inputs and owned choices, not natural-play evidence.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pair,REPORT}=require('./kismet-online');

function prepare(w,n,offTurn=false){
  const p=pair(w,{player:'ochre',ai:'ochre'}),other=w==='player'?'ai':'player';
  p.run(`
    G.allowEvolutions=true;G._netDeltaDecks={player:[],ai:[]};G._netDeltaDecks['${w}']=['fullmetal-${n}'];installDeltaDecks();
    ['player','ai'].forEach(s=>{G[s].hand=[];G[s].leftFlank=null;G[s].discard=[];G[s].deadzone=[];G[s].cas=0;G[s].mp=30;});
    G.turn='${w}';G.phase='main';var p=G['${w}'],e=p.evolutions[0];
    p.rankZone=mkNum({n:${n},r:1,A:1,M:0,S:0,st:'Basic'},'classless');
    p.leftFlank=mkNum({n:4,r:2,A:1,M:0,S:0,W:e.materialW,st:'Basic'},'ochre');
    p.rightFlank=mkNum({n:2,r:1,A:1,M:0,S:0,st:'Basic'},'classless');
    p.bank=[mkNum({n:1,r:0,A:0,M:0,S:0,st:'Basic'},'classless')];
    ruFieldWatch();
  `);
  assert.equal(p.run(`findFullmetalOptions('${w}').length`),1,'one legal material set');
  assert.equal(p.run(`ruEvolutionReadyTypes('${w}').includes('fullmetal')`),true);
  const action=p.run(`(()=>{const o=findFullmetalOptions('${w}')[0];return {t:'amalgRank',s:'${w}',evoId:o.evo.baseId,evoCardId:o.evo.id,elementIds:o.combo.map(x=>x.card.id)};})()`);
  p.apply(JSON.parse(JSON.stringify(action)));
  assert.equal(p.run(`G['${w}'].delta[0].baseId`),'fullmetal-'+n);
  assert.equal(p.run(`G['${other}'].delta.length`),0);
  assert.equal(p.run(`G['${w}'].delta[0].elements.length`),3);
  p.run(`
    G.turn='${offTurn?other:w}';
    var p=G['${w}'];p.deck=Array.from({length:30},()=>mkNum({n:1,r:1,A:1,M:0,S:0,st:'Basic'},'classless'));
    p.hand=[mkAct('Cease'),mkAct('Protect'),mkNum({n:6,r:p.delta[0].rank,A:1,M:0,S:0,st:'Basic'},'classless')];
    p.discard=[mkAct('Protect')];p.deadzone=[mkNum({n:2,r:1,A:1,M:0,S:0,st:'Basic'},'classless')];p.cas=1;
    ruFieldWatch();
  `);
  return {p,w,other,id:p.run(`G['${w}'].delta[0].id`)};
}
function settle(p){
  for(let j=0;j<50;j++){
    const d=p.pending();if(d.kind==='none')return;
    if(d.kind!=='modal')return;
    const label=d.labels.find(s=>['Pass','Decline','Continue','Skip Effect'].includes(s));
    if(!label)return;p.button(label);
  }throw Error('Unfinished prompt loop');
}
function activate(t,k){
  t.p.apply({t:'amalgSkill',s:t.w,id:t.id});
  t.p.button('Skill '+k+':');
  t.p.pick([0]);
}
function run(){
  for(const w of ['player','ai'])for(const off of [false,true])for(let n=1;n<=9;n++){
    const t=prepare(w,n,off),{p,other}=t;
    if(n===1)p.run(`G['${w}'].deck[1]=mkAct('Protect');`);
    if(n===5||n===9)p.run(`G._fullmetalPendingAttack={aw:'${other}',dw:'${w}',az:'rank',dz:'rank'};`);
    if(n===7)p.run(`RUFullmetal.state('${w}').attackers=['${other}'];RUFullmetal.state('${w}').negatedAdditional=4;`);
    const before=p.run(`G['${w}'].mp`);
    activate(t,1);
    if([5,8,9].includes(n))p.pick([0]);
    if(n===1)p.button('Take 1 less Casualty');
    if(n===6)p.button('No Additional Morale');
    if(n===7){p.pick([0]);p.button('Additional Casualties negated');}
    settle(p);
    assert.equal(p.run(`G['${w}'].mp`),before+(n===9?0:[1,1,1,2,2,3,3,4][n-1]),'S gain '+n);
    assert.equal(p.run(`G['${w}'].delta[0].elements.length`),2,'element paid '+n);
    assert.equal(p.run(`RUFullmetal.legal('${w}',G['${w}'].delta[0],1)`),![5,6,7,9].includes(n),'S1 frequency '+n);
    if(n===1){p.run(`casDraw('${w}',{source:'battle',additional:false});`);assert.equal(p.run(`G['${w}']._fullmetalTurn.lessCas`),0);}
    if(n===2)assert.equal(p.run(`G['${w}']._fullmetalTurn.noAddonFrom`),other);
    if(n===3){const count=p.run(`G['${w}'].deck.length`);p.run(`casDraw('${w}',{source:'action',additional:true});`);assert.equal(p.run(`G['${w}'].deck.length`),count);assert.equal(p.run(`G['${w}']._fullmetalTurn.negatedAdditional`),1);}
    if(n===4){p.run(`RUFullmetal.effect('${other}',{type:'numeral'},()=>ruLoseMP(G['${w}'],5));`);assert.equal(p.run(`G['${w}'].mp`),before+2);}
    if(n===5)assert.equal(p.run(`G._defState.negate`),true);
    if(n===6)assert.equal(p.run(`RUFullmetal.morale('${w}',9,'battle',{aWho:'${other}',dWho:'${w}',attPrintedNP:3,defPrintedNP:1})`),2);
    if(n===7)assert.equal(p.run(`G['${other}'].mp`),26);
    if(n===8){assert.equal(p.run(`RUFullmetal.morale('${w}',100,'battle',{})`),0);assert.equal(p.run(`G['${w}'].delta[0]._fullmetalSafeguards[0].name`),'Cease');}
    if(n===9){p.run(`casDraw('${w}',{source:'battle',additional:true});G['${w}'].mp-=6;ruFieldWatch();RUFullmetal.endTurn();`);assert.equal(p.run(`G['${w}'].mp`),before);}
    p.run(`G._fullmetalPendingAttack=null;`);
    const mp=p.run(`G['${w}'].mp`);
    activate(t,2);settle(p);
    assert.equal(p.run(`G['${w}'].mp`),mp,'Skill 2 grants no printed S');
    assert.equal(p.run(`RUFullmetal.legal('${w}',G['${w}'].delta[0],2)`),false);
    assert.equal(p.run(`RUFullmetal.morale('${w}',4,'effect')`),n===8?0:0);
    if(n!==8)assert.equal(p.run(`RUFullmetal.morale('${w}',5,'effect')`),3,'finite 6 NP shield');
    p.finish(`${w} Fullmetal ${n} ${off?'opponent turn':'own turn'}`);
    console.log('PASS',w,'Fullmetal',n,off?'off-turn':'own-turn','summon, S1, S2, costs and parity');
  }
  extraTests();
  fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'data','fullmetal-online.json'),JSON.stringify(REPORT,null,2));
}
function extraTests(){
  for(const w of ['player','ai']){
    for(let n=1;n<=9;n++){
      const {p,other}=prepare(w,n);
      for(const cause of ['battle','action','numeral','area','rule'])assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','${cause}')`),true,'played-turn immunity');
      const W=p.run(`ruW(G['${w}'].delta[0])`);
      for(let i=1;i<=W;i++){
        p.run(`G._turnNo++;G.turn='${other}';G.phase='draw';ruPhaseBegan('draw');`);settle(p);
        assert.equal(p.run(`G['${w}'].delta[0]._fullmetalOwnerTurns`),i-1,'opponent turns do not count');
        p.run(`G._turnNo++;G.turn='${w}';G.phase='draw';ruPhaseBegan('draw');`);settle(p);
        assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','battle')`),true);
        assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','action')`),n>=3);
        assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','numeral')`),n>=6);
        assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','area')`),n>=8);
        p.run(`RUFullmetal.endTurn();`);settle(p);
      }
      assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','battle')`),false,'expires after W owner End Phases');
      console.log('PASS',w,'Fullmetal',n,'opening immunity, protection tiers, W owner-turn expiry');
    }
    {
      const t=prepare(w,8),{p}=t;
      activate(t,1);p.pick([0]);settle(p);
      p.run(`G._turnNo++;G.turn='${w}';G.phase='main';G['${w}'].delta[0]._fullmetalProtectionExpired=true;`);
      p.apply({t:'sdMode',s:w});p.apply({t:'delta',s:w,w});
      const d=p.pending();
      if(d.kind==='pick')p.pick([0]);settle(p);
      assert.equal(p.run(`!!G._casDrawPrevented['${w}']`),true,'stored Cease E2 actually fires');
      assert.equal(p.run(`G['${w}'].deadzone.some(c=>c.name==='Cease')`),false,'stored Safeguard paid from Deadzone');
      p.finish(`${w} Fullmetal 8 stored Safeguard E2`);
      console.log('PASS',w,'Fullmetal 8 removal activates actual stored Safeguard E2');
    }
    {
      const {p,other}=prepare(w,2);
      p.run(`G._turnNo++;G._fullmetalSource='action';`);
      assert.equal(p.run(`ruFx.fieldTo('${w}',G['${w}'].delta[0],'discard')`),true,'Fullmetal 2 is not Action-proof after entry turn');
      p.run(`G._fullmetalSource=null;`);
      console.log('PASS',w,'source-specific removal is not blanket invulnerability');
    }
    {
      const {p,other}=prepare(w,4);
      p.run(`G._turnNo++;G._fullmetalSource='action';`);
      assert.equal(p.run(`ruFx.fieldTo('${w}',G['${w}'].delta[0],'discard')`),false);
      p.run(`G._fullmetalSource='numeral';`);
      assert.equal(p.run(`ruFx.fieldTo('${w}',G['${w}'].delta[0],'discard')`),true);
      p.run(`G._fullmetalSource=null;`);
    }
    {
      const t=prepare(w,5),{p,other}=t;
      p.run(`G.turn='${other}';G.phase='battle';G['${other}'].rankZone=mkNum({n:9,r:3,A:1,M:0,S:0,st:'Basic'},'classless');ruDeclareAttack('${other}','rank','${w}','rank',0,()=>{G._fmAttackFinished=true;});`);
      p.button('Skill 1:');p.pick([0]);p.pick([0]);settle(p);
      assert.equal(p.run(`G['${w}'].mp`),35,'attack was negated before damage');
      assert.equal(p.run(`!!G._fmAttackFinished`),true,'declared attack resumes after Fullmetal choices');
      p.finish(`${w} Fullmetal 5 real declared attack`);
      console.log('PASS',w,'Fullmetal 5 actual attack prompt and negation');
    }
    {
      const {p,other}=prepare(w,7);
      p.run(`G['${w}'].delta=[];G._netDeltaDecks['${w}']=['fullmetal-7'];installDeltaDecks();var p=G['${w}'];p.rankZone=mkNum({n:7,r:3,A:1,M:0,S:0,st:'Basic'},'classless');p.leftFlank=mkNum(ND.ochre.find(x=>x.n===9),'ochre');p.rightFlank=mkNum({n:1,r:0,A:0,M:0,S:0,st:'Basic'},'classless');p.mp=30;G['${other}'].mp=30;ruFieldWatch();`);
      assert.equal(p.run(`findFullmetalOptions('${w}').length`),1,'Ochre 9 is a legal W3 material');
      const a=JSON.parse(JSON.stringify(p.run(`(()=>{var o=findFullmetalOptions('${w}')[0];return {t:'amalgRank',s:'${w}',evoId:o.evo.baseId,evoCardId:o.evo.id,elementIds:o.combo.map(x=>x.card.id)};})()`)));
      p.apply(a);
      p.button('Use Ochre 9');settle(p);
      assert.equal(p.run(`ruW(G['${w}'].delta[0])`),4);
      assert.equal(p.run(`G['${w}'].mp`),42);
      assert.equal(p.run(`G['${other}'].mp`),34);
      p.finish(`${w} Fullmetal with Ochre 9 material`);
    }
    {
      const {p}=prepare(w,3);
      p.run(`G['${w}'].delta=[];installDeltaDecks();var p=G['${w}'];p.rankZone=mkNum({n:3,r:1,A:1,M:0,S:0,st:'Basic'},'classless');p.leftFlank=mkNum(ND.ochre.find(x=>x.n===6),'ochre');p.rightFlank=mkNum({n:1,r:0,A:0,M:0,S:0,st:'Basic'},'classless');`);
      assert.equal(p.run(`findFullmetalOptions('${w}').length`),0,'Ochre 6 cannot make Rank 0 Fullmetal');
      p.run(`G['${w}'].leftFlank=mkNum({n:4,r:2,A:1,M:0,S:0,W:3,st:'Basic'},'ochre');`);
      assert.equal(p.run(`findFullmetalOptions('${w}').length`),0,'W total must be exact, not greater');
      p.run(`G['${w}'].leftFlank.W=2;G['${w}'].hand.push(G['${w}'].rightFlank);G['${w}'].rightFlank=null;`);
      assert.equal(p.run(`findFullmetalOptions('${w}').length`),0,'hand is not a default material source');
      console.log('PASS',w,'exact material W, Ochre 6 restriction, Battlefield-only sources and Ochre 9 bonus');
    }
    {
      const t=prepare(w,3),{p}=t;
      p.run(`G['${w}'].hand=[];G['${w}'].rankZone.currentRP=1;G['${w}'].leftFlank=mkNum({n:7,r:0,A:0,M:0,S:0,st:'Basic'},'classless');ruFieldWatch();`);
      activate(t,2);settle(p);
      assert.equal(p.run(`G['${w}'].leftFlank`),null,'Skill 2 accepts a Battlefield Numeral');
      assert.equal(p.run(`RUFullmetal.state('${w}').shield`),7);
    }
    {
      const t=prepare(w,8),{p}=t;activate(t,1);p.pick([0]);settle(p);
      const before=p.run(`G['${w}'].mp`);
      p.run(`ruLoseMP(G['${w}'],4,'action');ruLoseMP(G['${w}'],5,'area');G['${w}'].mp-=3;`);
      assert.equal(p.run(`G['${w}'].mp`),before-3,'damage prevented but paid MP cost is not refunded');
    }
    {
      const t=prepare(w,6),{p}=t;activate(t,1);p.button('No Additional Casualty');settle(p);
      const before=p.run(`G['${w}'].deck.length`);
      p.run(`casDraw('${w}',{source:'battle',additional:true});`);
      assert.equal(p.run(`G['${w}'].deck.length`),before);
    }
    {
      const t=prepare(w,7),{p,other}=t;
      p.run(`G['${w}'].deadzone=[];G['${w}'].cas=0;RUFullmetal.state('${w}').attackers=['${other}'];G['${other}'].hand=[mkAct('Cease')];`);
      activate(t,1);p.pick([0]);p.button('Safeguards in all hands');settle(p);
      assert.equal(p.run(`G['${other}'].mp`),27,'all players\' Safeguards counted');
      assert.equal(p.run(`G['${w}'].hand.some(c=>c.id==='${t.id}')`),false);
      assert.equal(p.run(`G['${w}'].cas`),0,'newly ceded Element is recoverable from an initially empty Deadzone');
    }
  }
}
if(require.main===module)run();
module.exports={prepare,activate,settle,run};
