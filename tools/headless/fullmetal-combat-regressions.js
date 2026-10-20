'use strict';
// Controlled shared-input fixtures; these are not natural-play matches.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {prepare}=require('./fullmetal-regressions');
const {REPORT}=require('./kismet-online');
const {createEngine}=require('./engine');
const {MATCH_CODE}=require('../../ai/match');

function setup(w,n){
  const t=prepare(w,n),{p,other}=t;
  p.run(`
    G.phase='battle';G.mode='normal';G._turnsCompletedBy={player:1,ai:1};
    var me=G['${w}'],foe=G['${other}'];me.hand=[];me.discard=[];me.deadzone=[];me.cas=0;
    me.rankZone=mkNum({n:3,r:2,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');
    me.delta[0].currentNP=12;
    foe.rankZone=mkNum({n:1,r:0,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');
    foe.leftFlank=null;foe.rightFlank=null;foe.hand=[mkAct('Protect')];
    foe.deck=Array.from({length:30},()=>mkNum({n:1,r:0,A:1,M:0,S:null,ca:true,st:'Basic'},'classless'));
    G._atkAddonCards=null;ruFieldWatch();
  `);
  return t;
}
function settle(p){
  for(let i=0;i<40;i++){
    const d=p.pending();if(d.kind!=='modal')return;
    const s=d.labels.find(s=>s.startsWith('Pass')||['Continue','Decline','Skip Effect'].includes(s));
    assert.ok(s,JSON.stringify(d));p.button(s);
  }
  throw Error('Unsettled combat');
}
function select(t,addon,targetDelta=false){
  const {p,w,other}=t;
  p.apply({t:'atkMode',s:w});
  p.apply(addon?{t:'zone',s:w,o:w,z:'rank'}:{t:'delta',s:w,w});
  if(addon)p.apply({t:'delta',s:w,w});
  assert.equal(p.run(`!!G['${w}'].delta[0]._fullmetalProtectionForfeited`),false,'selection is not declaration');
  p.apply(targetDelta?{t:'delta',s:w,w:other}:{t:'zone',s:w,o:other,z:'rank'});
}
function unprotected(t){
  for(const cause of ['battle','action','numeral','area','rule'])assert.equal(t.p.run(`RUFullmetal.protected(G['${t.w}'].delta[0],'${t.w}','${cause}')`),false,cause+' protection gone at declaration');
}
for(const w of ['player','ai']){
  for(let n=1;n<=9;n++)for(const addon of [false,true]){
    const t=setup(w,n),{p,other}=t;
    select(t,addon);
    assert.equal(p.pending().owner,w);assert.ok(p.pending().labels.includes('Declare attack - forfeit protection'));
    assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','battle')`),true,'protected until confirmation');
    p.button('Cancel attack');
    assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','battle')`),true,'cancel preserves protection');
    assert.equal(p.run(`atkLeft(G['${w}'].delta[0])`),1,'cancel spends no Fullmetal attack');
    assert.equal(p.run(`atkLeft(G['${w}'].rankZone)`),1,'cancel spends no attacker attack');
    p.apply({t:'zone',s:w,o:other,z:'rank'});p.button('Declare attack - forfeit protection');
    unprotected(t);
    assert.equal(p.pending().owner,other,'defender responds only after forfeiture');
    assert.ok(p.pending().labels.includes('Use Protect'),'actual Safeguard response window');
    settle(p);unprotected(t);
    p.run(`for(let i=0;i<6;i++){G._turnNo++;G.turn='${w}';ruPhaseBegan('draw');RUFullmetal.endTurn();}
      RUFullmetal.enter('${w}',G['${w}'].delta[0],[]);`);
    unprotected(t);
    p.finish(`${w} Fullmetal ${n} ${addon?'Addon':'attack'} warning, cancel, declaration and permanent loss`);
    console.log('PASS',w,'Fullmetal',n,addon?'Addon':'attack','owned confirmation, cancellation, pre-defense forfeiture, persistent loss');
  }
  for(let n=1;n<=9;n++){
    const t=setup(w,n),{p,other}=t;
    p.apply({t:'atkMode',s:w});p.apply({t:'zone',s:w,o:w,z:'rank'});p.apply({t:'zone',s:w,o:other,z:'rank'});
    assert.ok(!p.pending().labels?.includes('Declare attack - forfeit protection'));
    settle(p);
    assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','battle')`),true,'other Numerals may attack freely');
    assert.equal(p.run(`!!G['${w}'].delta[0]._fullmetalProtectionForfeited`),false);
  }
  for(const addon of [false,true]){
    const t=setup(w,4),{p}=t;
    p.run(`G._turnNo++;G['${w}'].delta[0]._fullmetalProtectionExpired=true;`);
    select(t,addon);assert.equal(p.pending().owner,t.other,'expired protection needs no warning');settle(p);
    assert.equal(p.run(`!!G['${w}'].delta[0]._fullmetalProtectionForfeited`),false,'natural expiry is not an attack forfeiture');
  }
  {
    const t=setup(w,4),{p,other}=t;
    p.run(`G['${other}'].delta=[Object.assign({},RU_AMALGAMATIONS.find(c=>c.id==='amalg-benevolent-2'),{id:uid(),type:'evolution',evoType:'amalgamation',class:'amalgamation',currentNP:2,currentRP:2,elements:[]})];`);
    select(t,true,true);p.button('Declare attack - forfeit protection');unprotected(t);settle(p);
    p.finish(`${w} Fullmetal Addon targeting Delta Zone`);
  }
  {
    const t=setup(w,4),{p,other}=t;
    p.run(`var f=Object.assign({},FULLMETAL_LIBRARY[4],{id:uid(),currentNP:5,currentRP:1});f.elements=[mkNum({n:1,r:0,A:1,M:0,S:null,ca:true,st:'Basic'},'classless')];
      G['${other}'].delta=[f];G['${other}'].hand=[];G['${other}'].discard=[mkAct('Protect')];RUFullmetal.enter('${other}',f,[]);`);
    select(t,false);p.button('Declare attack - forfeit protection');unprotected(t);
    p.button('Skill 1:');p.pick([0]);p.pick([0]);settle(p);unprotected(t);
    assert.equal(p.run(`G['${other}'].mp`),32,'Fullmetal 5 negated the attack and gained S');
    assert.equal(p.run(`RUFullmetal.protected(G['${other}'].delta[0],'${other}','battle')`),true,'defender retains protection');
    p.finish(`${w} Fullmetal remains vulnerable when its attack is negated`);
  }
  {
    const t=setup(w,4),{p,other,id}=t;
    p.run(`var c=G['${w}'].delta[0];G['${w}'].delta=[];G['${w}'].rankZone=c;
      G._lastAtkInfo={aWho:'${other}'};ruWithActor('${w}',()=>doCounterAttack(0,{direct:true}));`);
    assert.equal(p.pending().owner,w);p.button('Declare attack - forfeit protection');settle(p);
    assert.equal(p.run(`RUFullmetal.protected(ruFindCard('${id}').card,'${w}','battle')`),false,'counterattack forfeits protection');
  }
  {
    const t=setup(w,4),{p}=t;
    p.run(`G['${w}'].delta[0]._directThisTurn=true;ruWithActor('${w}',()=>doDirectAttack());`);
    assert.equal(p.pending().owner,w);p.button('Declare attack - forfeit protection');unprotected(t);
    assert.equal(p.pending().owner,t.other,'direct attack forfeits before defense');settle(p);unprotected(t);
  }
  {
    const t=setup(w,4),{p}=t;
    p.run(`G['${w}'].delta[0].currentNP=0;`);
    select(t,true);p.button('Declare attack - forfeit protection');unprotected(t);settle(p);
  }
  {
    const t=setup(w,4),{p,other}=t;
    p.run(`G._atkAddonCards={aWho:'${w}',attId:G['${w}'].rankZone.id,cards:[G['${w}'].delta[0]]};
      ruDeclareAttack('${w}','rank','${other}','rank',0,function(){});`);
    assert.ok(!p.pending().labels?.includes('Declare attack - forfeit protection'),'old Addon record is not a new declaration');
    settle(p);assert.equal(p.run(`RUFullmetal.protected(G['${w}'].delta[0],'${w}','battle')`),true);
  }
}
const e=createEngine({seed:1});e.run(MATCH_CODE);
e.run(`__H.start({seed:1,mySeat:0,seat0Class:'light',seat1Class:'light',firstSeat:0,allowEvolutions:true,deltaDecks:{player:['fullmetal-4','amalg-benevolent-2','fullmetal-7'],ai:[]}})`);e.settle(1000);
e.run(`closeModal();_modalQueue=[];PCK=null;SF=null;ruSettleReset();viewZone('player','evolutions');`);
const html=e.run(`document.getElementById('m-body').innerHTML`);
assert.ok(html.includes('Fullmetal 4 Skilled')&&html.includes('Fullmetal 7 Skilled')&&html.includes('Amalgamation 2 Skilled'));
assert.ok(!html.includes('Amalgamation 4 Skilled')&&!html.includes('Amalgamation 7 Skilled'));
assert.ok(html.includes('data-family="fullmetal"')&&html.includes('--evolution-color:#E1E4E6'));
assert.ok(html.includes('data-family="amalgamation"')&&html.includes('--evolution-color:#6F0417'));
assert.ok(html.includes('Skill 2:'));
assert.ok(!html.includes('permanently forfeits'),'forfeiture explanation belongs in the warning, not printed card text');
e.run(`closeModal();G._netMode=false;G.turn='ai';var metal=Object.assign({},FULLMETAL_LIBRARY[3],{id:uid(),currentNP:4,currentRP:1});
  G.ai.delta=[metal];RUFullmetal.enter('ai',metal,[]);
  var paused=RUFullmetal.confirmCombat('ai',metal,[],function(){throw Error('Bot must continue synchronously');});`);
assert.equal(e.run('paused'),false);
assert.equal(e.run('metal._fullmetalProtectionForfeited'),true,'bot has no bypass of protection loss');
assert.deepEqual(e.errors,[]);
console.log('PASS all nine: other Numerals preserve protection; natural expiry permits attacks; mixed Evo list has own family names/colors');
fs.writeFileSync(path.join(__dirname,'data','fullmetal-combat.json'),JSON.stringify(REPORT,null,2));
