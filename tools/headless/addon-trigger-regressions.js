'use strict';
// Controlled shared-input fixtures, not natural-play matches.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pair,REPORT}=require('./kismet-online');
function setup(w,cls,n){
  const other=w==='player'?'ai':'player',p=pair(w,{player:'light',ai:'light'});
  p.run(`
    G.turn='${w}';G.phase='battle';G.mode='normal';
    var me=G['${w}'],foe=G['${other}'];
    for(var s of ['player','ai']){G[s].hand=[];G[s].bank=[];G[s].discard=[];G[s].deadzone=[];G[s].leftFlank=null;G[s].rightFlank=null;G[s].delta=[];
      G[s].deck=Array.from({length:40},()=>mkNum(ND.light.find(c=>c.n===4),'light'));}
    me.rankZone=mkNum({n:5,r:2,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');
    var support=mkNum(ND['${cls}'].find(c=>c.n===${n}),'${cls}');support.canAttack=true;support.attacksLeft=1;me.leftFlank=support;
    foe.rankZone=mkNum({n:2,r:1,A:0,M:0,S:null,ca:true,st:'Basic'},'classless');
    G._atkAddonCards=null;ruFieldWatch();
  `);
  return {p,w,other};
}
function attack({p,w,other},include=true){
  p.apply({t:'atkMode',s:w});p.apply({t:'zone',s:w,o:w,z:'rank'});
  if(include)p.apply({t:'zone',s:w,o:w,z:'left-flank'});
  p.apply({t:'zone',s:w,o:other,z:'rank'});
}
function settle(p){
  for(let i=0;i<50;i++){
    const d=p.pending();if(d.kind!=='modal')return;
    const label=d.labels.find(x=>['Continue','Decline','Pass','Skip Effect','Cancel'].includes(x));
    assert.ok(label,JSON.stringify(d));p.button(label);
  }
  throw Error('Repeated prompt');
}
for(const w of ['player','ai']){
  for(const decline of [false,true]){
    const t=setup(w,'celestial',5),{p}=t;
    p.run(`me.deck=Array.from({length:40},()=>mkNum(ND.celestial.find(c=>c.n===3),'celestial'));`);
    attack(t);assert.equal(p.pending().owner,w);assert.ok(p.pending().title.includes('Celestial 5'));
    p.button(decline?'Decline':'Mill 3');settle(p);
    assert.equal(p.run('me.deck.length'),decline?40:37);
    assert.equal(p.run('me.mp'),decline?30:28);
    assert.equal(p.run('!!G._battleResult'),true);
    assert.equal(p.run('atkLeft(support)'),0);
    p.finish(`${w} Celestial 5 Addon ${decline?'decline':'activate'}`);
  }
  for(const [cls,n] of [['blizzard',5],['shadow',0],['phantom',4],['phantom',6],['maximum',10]]){
    const t=setup(w,cls,n),{p}=t;
    p.run(`me.deck=Array.from({length:40},()=>mkNum(ND['${cls}'].find(c=>c.n===1),'${cls}'));
      me.hand=Array.from({length:5},()=>mkNum({n:5,r:0,A:0,M:0,S:null,ca:true,st:'Basic'},'classless'));
      me.deadzone=[mkNum(ND.phantom.find(c=>c.n===1),'phantom')];me.cas=1;`);
    attack(t);assert.equal(p.pending().owner,w);assert.ok(p.pending().title.includes(supportName(cls,n)),JSON.stringify(p.pending()));
    p.button('Activate Skill');
    if(cls==='shadow')p.pick([0]);
    if(cls==='phantom'&&n===6)p.pick([0]);
    if(cls==='maximum')p.pick([0,1,2,3,4]);
    settle(p);
    assert.equal(p.run('support.usedSkill'),true);
    if(cls==='blizzard')assert.equal(p.run('foe.rankZone.currentNP'),0,'Addon Blizzard debuff applies to actual target');
    if(cls==='shadow')assert.equal(p.run('G._shadow0'),w);
    if(cls==='phantom'&&n===4)assert.equal(p.run('support._directThisTurn'),true);
    if(cls==='phantom'&&n===6)assert.equal(p.run("me.hand.some(c=>c.name==='Phantom 1')"),true);
    if(cls==='maximum')assert.equal(p.run('me.hand.length'),0);
    p.finish(`${w} ${supportName(cls,n)} Addon cost and effect`);
  }
  {
    const t=setup(w,'kismet',0),{p}=t;p.run('me.hand=[mkAct(\'Plus\')];support.currentNP=0;');
    attack(t);assert.equal(p.pending().owner,w);p.button('Decline');settle(p);
    assert.equal(p.run('!!G._battleResult'),true,'zero-NP participant offered once, decline continues');
    p.finish(`${w} zero-NP Kismet 0 Addon decline`);
  }
  {
    const t=setup(w,'celestial',5),{p}=t;attack(t,false);settle(p);
    assert.equal(p.run('support._cel5Turn'),undefined,'unselected card does not trigger');
    p.finish(`${w} uninvolved card has no attack trigger`);
  }
  {
    const t=setup(w,'kismet',8),{p}=t;
    p.run('support._k8={turn:G._turnNo,settledDrops:0};');attack(t);settle(p);
    assert.equal(p.run('support._kAtk.n'),1);assert.equal(p.run('me.hand.length'),1);assert.equal(p.run('foe.hand.length'),1);
    p.finish(`${w} Kismet 8 Addon after-attack skill once`);
  }
  {
    const t=setup(w,'kismet',0),{p}=t;p.run("me.hand=[mkAct('Plus')];");
    attack(t);p.button('Use Kismet 0');p.pick([0]);settle(p);
    assert.equal(p.run('foe.mp'),30,'Addon shield prevents battle Morale damage');
    assert.equal(p.run('foe.cas'),0,'Addon shield prevents battle Casualty damage');
    p.finish(`${w} Kismet 0 Addon damage shield`);
  }
  {
    const t=setup(w,'restorative',5),{p}=t;attack(t);
    assert.equal(p.pending().owner,w);p.button('Use Restorative 5');settle(p);
    assert.equal(p.run('me.deck.length'),39);assert.equal(p.run('me.mp'),33,'S plus actual target Rank');
    p.finish(`${w} Restorative 5 Addon attack involvement`);
  }
  {
    const t=setup(w,'celestial',5),{p}=t;
    p.run(`me.rightFlank=mkNum(ND.celestial.find(c=>c.n===5),'celestial');me.rightFlank.canAttack=true;me.rightFlank.attacksLeft=1;`);
    p.apply({t:'atkMode',s:w});p.apply({t:'zone',s:w,o:w,z:'rank'});
    for(const z of ['left-flank','right-flank'])p.apply({t:'zone',s:w,o:w,z});
    p.apply({t:'zone',s:w,o:t.other,z:'rank'});
    p.button('Decline');assert.ok(p.pending().title.includes('Celestial 5'));p.button('Decline');settle(p);
    assert.equal(p.run('!!G._battleResult'),true,'both participants answered once');
    p.finish(`${w} two Celestial 5 Addons each offered once`);
  }
  {
    const t=setup(w,'temporal',9),{p}=t;
    p.run('support._t9={turn:G._turnNo,bonus:3};support.currentNP=12;');attack(t);settle(p);
    assert.equal(p.run('G._battleResult.addonNP'),9,'Addon NP recalculated after declaration cost removes bonus');
    assert.equal(p.run('support.currentNP'),12,'bonus restored after combined attack');
    assert.equal(p.run('me.deadzone.length'),1,'Temporal 9 cedes last Deck card');
    p.finish(`${w} Temporal 9 Addon NP and delayed damage`);
  }
  for(const cls of ['haste','shadow','maximum','phantom']){
    const t=setup(w,cls,8),{p}=t;
    p.run(`var bank=mkNum({n:5,r:1,A:0,M:0,S:null,ca:true,st:'Basic'},'classless');
      support._haste8GainAfterAttack='${cls}'==='haste';
      if('${cls}'==='shadow'){support._s8Active=true;support._s8Bank=bank;}
      if('${cls}'==='maximum'){support._mx8Bank=bank;support._mx8Hits=1;}
      if('${cls}'==='phantom'){support._ru159Phantom8Bank=bank;support._ru159Phantom8Hits=1;support._ru159Phantom8Rank=1;}`);
    attack(t);settle(p);
    if(cls==='haste')assert.equal(p.run('support.currentNP'),10);
    if(cls==='shadow'){assert.equal(p.run('support._s8Hits'),1);assert.equal(p.run('me.mp'),35);}
    if(cls==='maximum'){assert.equal(p.run('support._mx8Hits'),2);assert.equal(p.run('me.mp'),35);}
    if(cls==='phantom'){assert.equal(p.run('support._ru159Phantom8Hits'),2);assert.equal(p.run('support.currentNP'),9);assert.equal(p.run('support.currentRP'),4);}
    assert.equal(p.run('me.rankZone.currentNP'),5,'reward belongs to Addon, not lead attacker');
    p.finish(`${w} ${supportName(cls,8)} Addon attack reward`);
  }
  {
    const t=setup(w,'zero',9),{p}=t;
    p.run("me.hand=[mkNum({n:3,r:2,A:0,M:0,S:null,ca:true,st:'Basic'},'classless')];support.A=0;");
    attack(t);assert.equal(p.pending().owner,w);p.button('Use Skill 2');p.pick([0]);settle(p);
    assert.equal(p.run('foe.rankZone.currentNP'),0);assert.equal(p.run('me.deadzone.length'),1);
    p.finish(`${w} Zero 9 Addon uses own A and pays Rank 2`);
  }
}
function supportName(cls,n){return cls.charAt(0).toUpperCase()+cls.slice(1)+' '+n;}
require('./temporal-addon-regressions').historicalTests(true);
fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'data','addon-triggers.json'),JSON.stringify(REPORT,null,2));
console.log('PASS',REPORT.length,'Addon trigger fixtures: both human seats, owned costs and effects, decline, zero NP, follow-up and uninvolved cards');
