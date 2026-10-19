'use strict';
// Controlled card-resolution fixtures, not natural-play match evidence.
const assert = require('node:assert/strict');
const {pair, REPORT} = require('./kismet-online');

const BUFFS=['Plus','Multiply','Rank Star','Battle Star','Multi-Star','Neo Rank Star',
  'Neo Battle Star','Neo Draw Star','Shining Star','Shaded Star','MAX Star','Boost',
  'Halcyon Star','Track Star','Supplementary Star','Flank Star','Neo Flank Star',
  'Thrash Star','Neo Multi Star','Seventh Star'];

function finishCosts(p){
  for(let i=0;i<40;i++){
    const d=p.pending();
    if(d.kind==='modal'){
      if(d.labels.some(s=>s.startsWith('Kismet ')))return d;
      const n=d.labels.findIndex(s=>/Confirm|Continue|Skip Effect/.test(s));
      if(n<0)throw Error(JSON.stringify(d));
      p.apply({t:'modal',s:d.owner,i:n});
    }else if(d.kind==='pick'){
      const pool=p.engines[0].run('PCK.pool.map(c=>c.name)');
      const min=p.engines[0].run('PCK.min');
      const ix=pool.map((name,i)=>({name,i})).filter(x=>!/^Kismet [134]$/.test(x.name)).slice(0,min).map(x=>x.i);
      p.pick(ix.length===min?ix:pool.slice(0,min).map((_,i)=>i));
    }else return d;
  }
  throw Error('Resolution did not finish');
}

function buffFixture(seat,own,name){
  const p=pair(seat),other=seat==='player'?'ai':'player',actor=own?seat:other;
  p.run(`
    G.turn='${actor}';
    var me=G.${actor}; me.mp=100;
    me.rankZone=mkNum({n:5,r:2,A:8,M:0,S:null,ca:true,st:'Basic'},'light');
    me.rightFlank=mkNum({n:2,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'light');
    me.hand.unshift(mkAct('${name}'),...Array.from({length:5},()=>mkNum(ND.light[2],'light')));
    if('${name}'==='Seventh Star')me.hand.push(mkNum(ND.light[7],'light'));
    me.deadzone.push(...Array.from({length:5},()=>mkNum(ND.restorative[2],'restorative')),mkNum(ND.haste[2],'haste'));
    me.cas=me.deadzone.length;
    me.deck=Array.from({length:20},()=>mkNum(ND.light[2],'light')).concat(me.deck);
    ruFieldWatch();
  `);
  p.apply({t:'playAction',s:actor,id:p.run(`G.${actor}.hand.find(c=>c.name==='${name}').id`)});
  return {p,actor,other,seat};
}

function respond(p,seat,n){
  assert.equal(p.pending().owner,seat);
  for(const k of [1,3,4])assert.ok(p.pending().labels.some(s=>s.startsWith('Kismet '+k+' —')),'missing Kismet '+k);
  p.button('Kismet '+n+' —');
  if(n===1||n===4)p.pick([0]);
  p.decline();
  assert.equal(p.run('ruSettlePending()'),0,'activation fully settled');
  assert.equal(p.run(`G.${seat}._kisOnce['Kismet ${n}']`),4,'skill actually used');
}

function sweep(){
  for(const seat of ['player','ai'])for(const own of [false,true])for(const name of BUFFS)for(const n of [1,3,4]){
    const {p,actor,other}=buffFixture(seat,own,name);
    finishCosts(p);
    const change=p.run('G._actLog[0].changes.reduce((t,c)=>t+Math.abs(c.dNP)+Math.abs(c.dRP),0)'),before=p.run(`G.${other}.mp`);
    respond(p,seat,n);
    assert.equal(p.run(`G.${actor}.rankZone.currentNP`),5,name+' Rank NP negated');
    assert.equal(p.run(`G.${actor}.rightFlank.currentNP`),2,name+' Flank NP negated');
    assert.equal(p.run(`G.${actor}.rankZone.currentRP`),2,name+' Rank RP negated');
    if(n===3)assert.ok(p.run(`G.${seat}.bank.some(c=>c.name==='Kismet 3')`),'Kismet 3 paid');
    if(n===4)assert.equal(p.run(`G.${other}.mp`),before-change,'Kismet 4 damage equals the complete negated NP/RP change');
    if(['Plus','Neo Multi Star'].includes(name))p.finish(`${seat} ${own?'own':'opponent'} ${name} via Kismet ${n}`);
    console.log(`PASS ${seat} ${own?'own':'opponent'} ${name} via Kismet ${n}`);
  }
}

function hiddenChanges(){
  for(const seat of ['player','ai'])for(const own of [false,true])for(const n of [1,3,4]){
    const other=seat==='player'?'ai':'player',actor=own?seat:other,p=pair(seat);
    p.run(`
      G.turn='${actor}';
      ['player','ai'].forEach(s=>{G[s].mp=100;G[s].rankZone=mkNum({n:0,r:0,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');});
      G.${seat}.leftFlank.currentNP=0;G.${seat}.leftFlank.currentRP=0;
      G.${actor}.hand.unshift(mkAct('Neo Multi Star'),mkNum(ND.light[6],'light'));
      G.${actor}.deck=Array.from({length:12},()=>mkNum(ND.light[2],'light')).concat(G.${actor}.deck);
      ruFieldWatch();
    `);
    const target=p.run(`G.${actor}.hand.find(c=>c.name==='Light 6').id`);
    p.apply({t:'playAction',s:actor,id:p.run(`G.${actor}.hand.find(c=>c.name==='Neo Multi Star').id`)});
    finishCosts(p);
    assert.ok(p.run(`G._actLog[0].changes.every(c=>c.zone==='hand')`),'only hidden cards changed');
    const body=p.run(`document.getElementById('m-body').innerHTML`);
    assert.ok(!body.includes('Light 6'),'response description does not expose a private hand card');
    respond(p,seat,n);
    assert.equal(p.run(`ruFindCard('${target}').card.currentNP`),6,'hand NP restored, including if paid as Kismet 4 cost');
    assert.equal(p.run(`ruFindCard('${target}').card.currentRP`),2,'hand RP restored');
    assert.equal(p.run(`ruFindCard('${target}').card._nmsTurn`),undefined,'temporary modifier marker restored');
    p.finish(`${seat} ${own?'own':'opponent'} hand-only changes via Kismet ${n}`);
    console.log(`PASS ${seat} ${own?'own':'opponent'} hand-only changes via Kismet ${n}`);
  }
}

function movedSource(){
  for(const seat of ['player','ai']){
    const p=pair(seat);
    p.run(`var me=G.${seat};me.hand=[];me.leftFlank=null;me.discard=[];
      me.deadzone=[mkNum(ND.kismet[3],'kismet'),mkAct('Boost')];me.cas=2;
      ruFieldWatch();applyE2('${seat}',me.deadzone[1]);`);
    p.pick([0]);p.button('Kismet 3 —');p.decline();
    assert.equal(p.run(`G.${seat}.rankZone.currentNP`),5,'Boost effect negated');
    assert.ok(p.run(`G.${seat}.bank.some(c=>c.name==='Kismet 3')`),'Kismet 3 paid from its eligible location after rewind');
    assert.equal(p.run('ruSettlePending()'),0);
    p.finish(`${seat} Kismet 3 crosses Deadzone to Drop`);
    console.log(`PASS ${seat} Kismet 3 crosses Deadzone to Drop`);
  }
}

function attack(p,seat,own){
  if(own){
    const other=seat==='player'?'ai':'player';
    p.apply({t:'atkMode',s:seat});p.apply({t:'zone',s:seat,o:seat,z:'rank'});
    p.apply({t:'zone',s:seat,o:other,z:'rank'});
  }else p.button('Kismet 8 ->');
  p.decline();
}

function eight(){
  for(const seat of ['player','ai'])for(const own of [false,true]){
    const other=seat==='player'?'ai':'player',p=pair(seat);
    p.run(`
      G.turn='${own?seat:other}';
      var me=G.${seat},foe=G.${other};
      me.mp=foe.mp=100;me.rankZone=mkNum(ND.kismet[8],'kismet');me.leftFlank=null;me.discard=[];
      me.hand=[mkAct('Repair'),mkAct('Plus'),mkAct('Reverse')];
      foe.hand=[];foe.rankZone=mkNum({n:8,r:3,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      me.deck=[mkAct('Repair'),mkAct('Plus'),mkNum(ND.kismet[2],'kismet')].concat(me.deck);
      foe.deck=[mkAct('Plus'),mkAct('Repair'),mkNum(ND.light[2],'light')].concat(foe.deck);
      ruFieldWatch();beginPhase('main');
    `);
    if(own)p.apply({t:'startSkill',s:seat,source:'rank',id:p.run(`G.${seat}.rankZone.id`)});
    else p.button('Use Kismet 8');
    p.button('Activate Skill');p.decline();
    assert.equal(p.run(`G.${seat}.mp`),103,'S1 is an immediate one-time gain of three');
    p.run("beginPhase('battle')");
    attack(p,seat,own);
    assert.equal(p.run('ruActionDropsThisTurn()'),5);
    assert.equal(p.run(`G.${seat}.mp`),100,'103 - 8 battle + 5 new drops');
    assert.equal(p.run(`G.${other}.mp`),87,'100 - 8 battle - 5 new drops');
    attack(p,seat,own);
    assert.equal(p.run('ruActionDropsThisTurn()'),7);
    assert.equal(p.run(`G.${seat}.mp`),94,'100 - 8 battle + (7 - 5); no repeated S1');
    assert.equal(p.run(`G.${other}.mp`),77,'87 - 8 battle - (7 - 5)');
    attack(p,seat,own);
    assert.equal(p.run(`G.${seat}.mp`),86,'no drawn Actions: only battle damage');
    assert.equal(p.run(`G.${other}.mp`),69,'no drawn Actions: no repeated secondary loss');
    assert.equal(p.run(`G.${seat}.rankZone._k8.settledDrops`),7);
    p.finish(`${seat} ${own?'own':'opponent'} turn Kismet 8 transfers five then two`);
    console.log(`PASS ${seat} ${own?'own':'opponent'} turn Kismet 8 transfers five then two`);
  }
}

function repeatedActivations(){
  for(const seat of ['player','ai'])for(const n of [1,3,4]){
    const other=seat==='player'?'ai':'player',p=pair(seat);
    p.run(`G.${other}.rankZone.A=8;G.${other}.hand=[mkAct('Plus'),mkAct('Plus'),mkAct('Plus')];ruFieldWatch();`);
    // Declining one activation must not suppress a later activation in the same phase.
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)});p.button('Confirm');p.decline();
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)});p.button('Confirm');respond(p,seat,n);
    assert.equal(p.run(`G.${other}.rankZone.currentNP`),7,'only the second Plus was negated');
    // The stamp expires on the next global turn, including when that is the other player's turn.
    p.run(`G._turnNo++;G.${seat}.hand.push(mkNum(ND.kismet[1],'kismet'));
      G.${seat}.discard.push(mkNum(ND.kismet[3],'kismet'));ruFieldWatch();`);
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)});p.button('Confirm');
    assert.ok(p.pending().labels.some(s=>s.startsWith('Kismet '+n+' —')),'next turn response restored');
    p.decline();
    p.finish(`${seat} Kismet ${n} decline and next-turn reset`);
    console.log(`PASS ${seat} Kismet ${n} decline and next-turn reset`);
  }
}

function noChange(){
  for(const seat of ['player','ai']){
    const p=pair(seat),other=seat==='player'?'ai':'player';
    p.run(`G.${other}.hand=[mkAct('Draw')];ruFieldWatch();`);
    p.apply({t:'playAction',s:other,id:p.run(`G.${other}.hand[0].id`)});p.button('Confirm');
    assert.equal(p.pending().kind,'turn','unmet NP/RP condition must not prompt');
    p.finish(`${seat} no NP or RP change`);
    console.log(`PASS ${seat} no NP or RP change`);
  }
}

function secondaryActions(){
  for(const seat of ['player','ai'])for(const own of [false,true])for(const name of ['Boost','Track Star'])for(const n of [1,3,4]){
    const p=pair(seat),other=seat==='player'?'ai':'player',actor=own?seat:other;
    p.run(`G.turn='${actor}';var me=G.${actor};me.deadzone=[mkNum(ND.light[2],'light'),mkAct('${name}')];me.cas=2;
      ruFieldWatch();applyE2('${actor}',me.deadzone[1]);`);
    if(name==='Boost')p.pick([0]);
    respond(p,seat,n);
    assert.equal(p.run(`G.${actor}.rankZone.currentNP`),5,'Advantageous E2 change negated');
    if(name==='Boost')p.finish(`${seat} ${own?'own':'opponent'} Advantageous E2 via Kismet ${n}`);
    console.log(`PASS ${seat} ${own?'own':'opponent'} ${name} E2 via Kismet ${n}`);
  }
}

if(require.main===module){
  if(process.argv.includes('--secondary'))secondaryActions();
  else{
    if(!process.argv.includes('--targeted'))sweep();
    hiddenChanges();movedSource();eight();repeatedActivations();noChange();secondaryActions();
  }
  const fs=require('node:fs'),path=require('node:path');
  fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'data','online-regression.json'),JSON.stringify(REPORT,null,2));
  console.log('Browser fixtures: '+REPORT.length);
}
module.exports={buffFixture,finishCosts};
