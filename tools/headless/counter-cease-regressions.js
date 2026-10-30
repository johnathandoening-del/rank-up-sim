'use strict';
// Constructed real-engine regressions, not natural-match evidence.
const assert=require('node:assert/strict');
const {newMatch}=require('./match');
const {createEngine}=require('./engine');
function position(mode,who){
  const m=newMatch({seed:31,mode,order:['player','ai2','ai3','ai'],
    classes:{player:'temporal',ai:'ochre',ai2:'restorative',ai3:'zero'}}),e=m.eng;
  require('./nopaint').install(e);require('./brain').install(e);
  e.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;
    ruSettleReset();G.turn='${who==='player'?'ai':'player'}';G.phase='battle';G.mode='normal';
    G._turnNo=5;G.exchange=3;G.firstTurn=false;G._turnsCompletedBy={player:2,ai:2,ai2:2,ai3:2};
    for(const s of G.sideOrder||['player','ai']){G[s].hand=[];G[s].bank=[];G[s].leftFlank=null;G[s].rightFlank=null;
      G[s].deadzone=[];G[s].discard=[];G[s].mp=30;G[s].cas=0;
      G[s].rankZone=mkNum(CLASSLESS[3],'classless');G[s].deck=Array.from({length:24},()=>mkNum(CLASSLESS[1],'classless'));}`);
  e.dropTimeouts();return m;
}
if(process.argv[2]!=='cease')for(const mode of ['standard','royale4','tag2v2','team2v2']){
  const seats=mode==='standard'?['player','ai']:['player','ai2','ai3','ai'];
  for(const seat of seats){
    const m=position(mode,seat),e=m.eng;
    e.run(`G['${seat}'].hand=[mkNum(CLASSLESS[1],'classless')];
      G['${seat}'].deck.unshift(mkAct('Counterattack'),mkNum(CLASSLESS[2],'classless'),mkNum(CLASSLESS[3],'classless'));
      for(let i=0;i<3;i++)casDraw('${seat}');`);e.settle(10000);
    let d=e.run('__M.decider()');assert.match(d.title,/Counterattack/);m.apply({t:'modal',s:seat,i:0});
    d=e.run('__M.decider()');assert.equal(d.kind,'pick');m.apply({t:'pick',s:seat,ix:[0]});
    assert.equal(e.run('G.mode'),'oppzonepick');assert.equal(e.run('G._counterFrame.stage'),'attacker');
    const before=e.run('ruStateSig()'),deck=e.run(`G['${seat}'].deck.length`);
    m.apply({t:'zone',s:seat,o:seat,z:'rank'});
    assert.equal(e.run('G._counterFrame.stage'),'target');
    assert.notEqual(e.run('ruStateSig()'),before,'counterattacker and target decisions cannot have the same fingerprint');
    assert.equal(e.run('__M.decider().seat'),seat);
    const target=e.run(`oppList('${seat}')[0]`),mp=e.run(`G['${target}'].mp`);
    m.apply({t:'zone',s:seat,o:target,z:'rank'});
    for(let i=0;i<40;i++){
      d=e.run('__M.decider()');if(d.kind!=='modal')break;
      const ix=d.labels.findIndex(x=>/^(Pass|Skip|Continue|Decline)/.test(x));assert.ok(ix>=0,JSON.stringify(d));
      m.apply({t:'modal',s:d.seat,i:ix});
    }
    assert.equal(e.run('!!G._counterFrame'),false,'counterattack releases its suspended frame');
    assert.equal(e.run('window._RUcasCurrent'),null,'no unresolved active casualty remains');
    assert.equal(e.run(`G['${seat}'].deck.length`),deck-2,'two suspended draws resume exactly once');
    assert.ok(e.run(`G['${target}'].mp`)<=mp);
  }
}
console.log('PASS counterattack decision fingerprints, all seats in standard/Royale/Tag/Team');
if(process.argv[2]!=='cease'){
  const m=position('standard','ai'),e=m.eng;
  e.run(`G.ai.rankZone.currentNP=7;G.player.rankZone.currentNP=3;
    for(const s of ['player','ai']){G[s].hand=[mkNum(CLASSLESS[1],'classless')];G[s].deck.unshift(mkAct('Counterattack'));}
    for(let i=0;i<4;i++)casDraw('ai');`);e.settle(10000);
  const original=e.run('G.ai.deck.length')+1;
  m.apply({t:'modal',s:'ai',i:0});m.apply({t:'pick',s:'ai',ix:[0]});
  m.apply({t:'zone',s:'ai',o:'ai',z:'rank'});m.apply({t:'zone',s:'ai',o:'player',z:'rank'});
  assert.match(e.run('__M.decider().title'),/Counterattack/);
  m.apply({t:'modal',s:'player',i:0});m.apply({t:'pick',s:'player',ix:[0]});
  assert.equal(e.run('G._counterFrame.previous.stage'),'resolving','the second counterattack interrupts the first');
  m.apply({t:'zone',s:'player',o:'player',z:'rank'});m.apply({t:'zone',s:'player',o:'ai',z:'rank'});
  for(let i=0;i<80;i++){
    const d=e.run('__M.decider()');if(d.kind!=='modal')break;
    const ix=d.labels.findIndex(x=>/^(Continue|Pass|Skip|Decline)/.test(x));assert.ok(ix>=0,JSON.stringify(d));
    m.apply({t:'modal',s:d.seat,i:ix});
  }
  assert.equal(e.run('!!G._counterFrame||window._RUcbusy||window._RUcq.length>0'),false,'both nested frames and queues finish: '+e.run('JSON.stringify({frame:G._counterFrame,busy:window._RUcbusy,current:window._RUcasCurrent,q:window._RUcq,d:__M.decider(),log:__logRing.slice(-10)})'));
  assert.equal(e.run('window._RUcasCurrent'),null);
  assert.equal(e.run('G.ai.deck.length'),original-4,'original four draws are each processed exactly once');
  console.log('PASS nested Counterattack interrupts and restores both casualty queues');
}
const classes=Object.keys(createEngine().run('CM'));
for(const cls of classes)for(const seat of ['player','ai']){
  const m=position('standard',seat),e=m.eng;
  e.run(`G['${seat}'].class=${JSON.stringify(cls)};
    window.cease=mkAct('Cease');window.first=mkNum(CLASSLESS[1],'classless');window.chosen=mkNum(CLASSLESS[2],'classless');
    G['${seat}'].deadzone=[first,chosen,cease];G['${seat}'].cas=3;
    ruOwnPrompt('${seat}');applyE2('${seat}',cease);`);e.settle(10000);
  const d=e.run('__M.decider()');assert.equal(d.kind,'pick',cls+' '+seat+' must choose Cease E2 payment');
  assert.equal(d.seat,seat);assert.equal(e.run(`G['${seat}'].deadzone.includes(first)&&G['${seat}'].deadzone.includes(chosen)`),true,
    'no additional payment card leaves before its owner chooses');
  const ix=e.run('PCK.pool.findIndex(c=>c.id===chosen.id)');assert.ok(ix>=0);
  m.apply({t:'pick',s:seat,ix:[ix]});
  assert.equal(e.run(`G['${seat}'].discard.filter(c=>c.id===cease.id).length`),1,cls+' '+seat+' Cease self-drops exactly once');
  assert.equal(e.run(`G['${seat}'].discard.some(c=>c.id===chosen.id)`),true,'chosen second card drops');
  assert.equal(e.run(`G['${seat}'].deadzone.some(c=>c.id===first.id)`),true,'unchosen card remains');
  assert.equal(e.run(`G['${seat}'].cas`),1);assert.equal(e.run(`!!G._casDrawPrevented['${seat}']`),true);
}
console.log('PASS Cease E2 owner-selected payment and self-drop, all classes and both seats');
