'use strict';
// Controlled shared-input fixtures, not natural-play matches.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pair,REPORT}=require('./kismet-online');
function setup(w,safeguard,cls,n){
  const other=w==='player'?'ai':'player',p=pair(w,{player:'light',ai:'light'});
  p.run(`
    G.turn='${w}';G.phase='main';G.mode='normal';G._attackDeclarations=[];G._pendingAttackDeclaration=null;
    var me=G['${w}'],foe=G['${other}'];
    for(var s of ['player','ai']){G[s].hand=[];G[s].bank=[];G[s].discard=[];G[s].deadzone=[];G[s].leftFlank=null;G[s].rightFlank=null;G[s].delta=[];G[s].cas=0;
      G[s].deck=Array.from({length:40},()=>mkNum({n:1,r:0,A:1,M:0,S:null,ca:true,st:'Basic'},'classless'));G[s]._firstDrawDone=true;}
    me.rankZone=mkNum({n:5,r:2,A:3,M:0,S:null,ca:true,st:'Basic'},'classless');me.rankZone.attacksLeft=3;
    ${cls?`me.rankZone=mkNum(ND['${cls}'].find(c=>c.n===${n}),'${cls}');me.rankZone.A=3;me.rankZone.attacksLeft=3;`:''}
    foe.rankZone=mkNum({n:2,r:1,A:3,M:0,S:null,ca:true,st:'Basic'},'classless');
    me.hand=[mkAct('Plus')];foe.hand=${safeguard?`[mkAct('${safeguard}')]`:'[]'};
    if('${safeguard}'==='Naught Star')foe.hand.push(mkNum(ND.zero.find(c=>c.n===1),'zero'));
    ruFieldWatch();
  `);
  p.apply({t:'playAction',s:w,id:p.run("me.hand[0].id")});p.button('Confirm');settle(p);
  p.run("beginPhase('battle')");
  return {p,w,other};
}
function settle(p){
  for(let i=0;i<60;i++){
    const d=p.pending();if(d.kind!=='modal')return;
    const label=d.labels.find(x=>x.startsWith('Pass')||['Decline','Continue','Skip Effect','Cancel'].includes(x));
    assert.ok(label,JSON.stringify(d));p.button(label);
  }
  throw Error('Unsettled attack');
}
function attack(t,target='rank'){
  const {p,w,other}=t;
  p.apply({t:'atkMode',s:w});p.apply({t:'zone',s:w,o:w,z:'rank'});
  p.apply({t:'zone',s:w,o:other,z:target});
}
for(const w of ['player','ai']){
  for(const safeguard of ['Cease','Freezing Star','Naught Star','Nullify'])for(const exit of ['end','adv']){
    const t=setup(w,safeguard),{p,other}=t;
    p.apply({t:exit,s:w});assert.equal(p.run('G.turn'),w);assert.equal(p.run('G.phase'),'battle','Advantageous obligation blocks before declaration');
    attack(t);assert.equal(p.run(`ruDeclaredAttackThisTurn('${w}')`),true,'recorded before defender response');
    assert.equal(p.run(`ruDeclaredAttackThisTurn('${other}')`),false,'defender did not declare');
    assert.equal(p.pending().owner,other);p.button('Use '+safeguard);settle(p);
    const resolved=safeguard==='Nullify';
    assert.equal(p.run('G._attackDeclarations.length'),1,'one declaration across repeated defense windows');
    assert.equal(p.run('G._lastAttackDeclaration.status'),resolved?'resolved':'negated');
    assert.equal(p.run('G._lastAttackDeclaration.resolved'),resolved);
    assert.equal(p.run('lastAttack().declared'),true);assert.equal(p.run('lastAttack().resolved'),resolved);
    assert.equal(p.run('lastAttack()[G._lastAttackDeclaration.dWho+\'WasAttacked\']'),true);
    assert.equal(p.run('foe.cas'),0);assert.equal(p.run('foe.deck.length'),40,'no Casualty cards pulled');
    if(resolved){assert.equal(p.run('foe.mp'),30);assert.equal(p.run('!!G._battleResult'),true);}
    else assert.equal(p.run('!!me._attackedThisTurn'),false,'negation is not resolution');
    assert.ok(p.run('atkLeft(me.rankZone)')>0,'legal attacks remain: obligation cannot escape via exhaustion');
    const logBefore=p.run("document.getElementById('log').textContent");
    p.apply({t:exit,s:w});settle(p);
    if(exit==='adv'){
      assert.equal(p.run("document.getElementById('log').textContent"),logBefore,'Next Phase is not blocked by a false declaration obligation');
      p.apply({t:'end',s:w});settle(p);
    }
    assert.ok(p.run(`G.turn!=='${w}'||G.phase!=='battle'`),`${w} ${safeguard} ${exit}: ${JSON.stringify(p.pending())}`);
    p.finish(`${w} ${safeguard}: declaration satisfies ${exit}, resolution distinct`);
  }
  {
    const t=setup(w,'Cease','ochre',8),{p}=t;attack(t);p.button('Use Cease');settle(p);
    assert.equal(p.run('me.rankZone._ochre8Atk'),p.run('G._turnNo'));
    const id=p.run('me.rankZone.id');p.apply({t:'end',s:w});settle(p);
    assert.equal(p.run('me.rankZone.id'),id,'Ochre 8 does not Stand Down after negated declaration');
    p.finish(`${w} Ochre 8 counts Cease-stopped declaration`);
  }
  {
    const t=setup(w,'Cease','kismet',8),{p}=t;attack(t);p.button('Use Cease');settle(p);
    assert.equal(p.run('me.rankZone._kAtk.n'),1,'Kismet attack allowance counts stopped declaration');
    p.finish(`${w} Kismet 8 declaration count`);
  }
  {
    const t=setup(w,'Cease'),{p}=t;attack(t);p.button('Use Cease');settle(p);
    assert.equal(p.run('me._celRankAttacked'),p.run("me.rankZone.id+'@'+G._turnNo"));
    assert.equal(p.run(`G._celAttacked['${w}@'+G._turnNo].includes('${t.other}')`),true,'attacked-player history records attempt');
    p.run("G._turnNo++;G.turn='"+w+"';");assert.equal(p.run(`ruDeclaredAttackThisTurn('${w}')`),false,'last turn declaration cannot satisfy this turn');
    p.finish(`${w} Celestial declaration history and next-turn reset`);
  }
  {
    const t=setup(w,'Nullify'),{p}=t;attack(t);p.button('Use Nullify');settle(p);
    p.run("ruLoseMP(foe,4,'numeral');");assert.equal(p.run('foe.mp'),30,'Nullify shields later damage this turn');
    attack(t);settle(p);assert.equal(p.run('foe.mp'),30);assert.equal(p.run('foe.cas'),0);
    assert.equal(p.run('G._attackDeclarations.length'),2);assert.ok(p.run('G._attackDeclarations.every(e=>e.resolved)'));
    p.run("G._turnNo++;ruLoseMP(foe,4,'numeral');");assert.equal(p.run('foe.mp'),26,'Morale shield expires next turn');
    p.finish(`${w} Nullify permits repeated resolution and expires`);
  }
  {
    const t=setup(w,'Nullify'),{p}=t;
    p.run("foe.leftFlank=foe.rankZone;foe.rankZone=mkNum({n:1,r:0,A:3,M:0,S:null,ca:true,st:'Basic'},'classless');ruFieldWatch();");
    attack(t,'left-flank');p.button('Use Nullify');settle(p);
    assert.ok(p.run('!!foe.leftFlank'),'damage negation prevents mandatory Flank casualty without canceling attack');
    assert.equal(p.run('G._lastAttackDeclaration.status'),'resolved');assert.equal(p.run('foe.cas'),0);
    p.finish(`${w} Nullify negates Flank casualty, not attack`);
  }
  for(const outcome of ['loss','tie']){
    const t=setup(w,null),{p}=t;p.run(`foe.rankZone.currentNP=me.rankZone.currentNP${outcome==='loss'?'+3':''};`);attack(t);settle(p);
    assert.equal(p.run('G._lastAttackDeclaration.winner'),outcome==='loss'?'defender':'tie');
    p.apply({t:'end',s:w});settle(p);assert.notEqual(p.run('G.turn'),w,'no obligation to win');
    p.finish(`${w} ${outcome} satisfies declaration obligation`);
  }
  {
    const t=setup(w,'Cease','phantom',4),{p}=t;
    p.apply({t:'atkMode',s:w});p.apply({t:'zone',s:w,o:w,z:'rank'});
    assert.equal(p.run(`ruDeclaredAttackThisTurn('${w}')`),false,'selecting a card is not declaration');
    assert.equal(p.run('me.deck.length'),40,'selection does not pay declaration skill costs');
    p.apply({t:'zone',s:w,o:t.other,z:'rank'});p.button('Activate Skill');
    assert.equal(p.run('me.deck.length'),39);p.button('Use Cease');settle(p);
    assert.equal(p.run('G._attackDeclarations.length'),1);assert.equal(p.run('me.rankZone.usedSkill'),true,'declaration skill survives later attack negation');
    p.finish(`${w} Phantom 4 only activates on declaration, before Cease`);
  }
  {
    const t=setup(w,'Nullify'),{p}=t;
    p.run('me.rankZone._haste8GainAfterAttack=true;');const np=p.run('me.rankZone.currentNP');
    attack(t);p.button('Use Nullify');settle(p);
    assert.equal(p.run('me.rankZone.currentNP'),np+2,'after-attack effect fires despite zero damage');
    assert.equal(p.run('G._lastAttackDeclaration.moraleDamage[\''+t.other+'\']'),0);
    p.finish(`${w} zero-damage resolution still fires after-attack effects`);
  }
}
fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});fs.writeFileSync(path.join(__dirname,'data','attack-declarations.json'),JSON.stringify(REPORT,null,2));
console.log('PASS',REPORT.length,'declaration vs resolution fixtures across P1/P2');
