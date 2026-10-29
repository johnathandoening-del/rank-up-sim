'use strict';
const assert=require('node:assert/strict');
const {setup}=require('./gameplay-fix-fixtures');
const {newMatch}=require('./match');
for(const mode of ['tag2v2','team2v2']){
  const m=newMatch({seed:31,mode,order:['player','ai2','ai3','ai'],
    classes:{player:'light',ai3:'light',ai:'shadow',ai2:'shadow'}}),e=m.eng;
  require('./nopaint').install(e);require('./brain').install(e);
  e.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;
    G.phase='main';G.mode='normal';G.turn='player';window.testArea=G.player.deck.find(c=>c.type==='area');
    G.player.deck.splice(G.player.deck.indexOf(testArea),1);dzAdd(G.player,testArea);
    ADEFS[testArea.name].effects=[{label:'Ownership fixture',check:()=>true,fn:w=>{G._areaTestOwner=w;}}];`);
  e.dropTimeouts();
  assert.equal(e.run('testArea._ownerSeat'),'player');
  assert.equal(e.run(`ruCanUseArea('ai3',testArea)`),false);
  e.run(`G.ai3.deadzone.includes(testArea)||G.ai3.deadzone.push(testArea);runDeadzoneAreaEffect('ai3',testArea.id,0);`);
  assert.equal(e.run('G._areaTestOwner'),undefined,'partner cannot activate another owner Area, even in the shared Deadzone');
  assert.equal(e.run(`__M.candidates('ai3').some(a=>a.t==='areaFx'&&a.id===testArea.id)`),false);
  e.run(`runDeadzoneAreaEffect('player',testArea.id,0);`);
  assert.equal(e.run('G._areaTestOwner'),'player','the owner can still activate the Area');
  e.run(`__S.restore(__S.snap());`);
  assert.equal(e.run(`G.player.deadzone.find(c=>c.id===testArea.id)._ownerSeat`),'player','ownership survives simulation copies');
}
console.log('PASS Area owner-only activation and snapshot preservation in Tag and Team');
for(const seat of ['player','ai'])for(const path of ['hand','deadzone']){
  const m=setup(`G.turn='${seat}';G['${seat}'].rankZone=mkNum(ND.light[3],'light');
    G['${seat}'].rankZone.A=3;G['${seat}'].actUsed=0;
    G['${seat}'].deadzone=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless')];
    G['${seat}'].cas=2;window.testNRS=mkAct('Neo Rank Star');
    G['${seat}']['${path}'].push(testNRS);${path==='deadzone'?`G['${seat}'].cas++;`:''}`),e=m.eng;
  if(path==='hand')m.apply({t:'playAction',s:seat,id:e.run('testNRS.id')});
  else e.run(`ruOwnPrompt('${seat}');applyE2('${seat}',testNRS);`);
  for(let i=0;i<8;i++){
    const d=e.run('__M.decider()');
    if(d.kind==='pick')m.apply({t:'pick',s:d.seat,ix:Array.from({length:d.min},(_,i)=>i)});
    else if(d.kind==='modal')m.apply({t:'modal',s:d.seat,i:0});else break;
  }
  assert.equal(e.run(`G['${seat}'].deadzone.some(c=>c.id===testNRS.id)`),false,seat+' NRS '+path+' leaves Deadzone');
  assert.equal(e.run(`G['${seat}'].discard.filter(c=>c.id===testNRS.id).length`),1,seat+' NRS '+path+' drops itself exactly once');
}
console.log('PASS Neo Rank Star self-drop, hand and Dead Draw activations, both seats');
for(const seat of ['player','ai'])for(const cancel of [false,true]){
  const foe=seat==='player'?'ai':'player';
  const m=setup(`G.turn='${foe}';G.phase='battle';
    G['${seat}'].rankZone=mkNum({n:7,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
    G['${foe}'].rankZone=mkNum({n:1,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
    G['${seat}'].hand=[mkNum(CLASSLESS[1],'classless')];
    G['${seat}'].deck=[mkNum(CLASSLESS[1],'classless'),mkAct('Counterattack'),mkNum(CLASSLESS[2],'classless'),mkNum(CLASSLESS[3],'classless'),...G['${seat}'].deck];
    G['${foe}'].deck=[mkNum(CLASSLESS[1],'classless'),...G['${foe}'].deck];
    for(var j=0;j<4;j++)casDraw('${seat}');`),e=m.eng;
  const answer=()=>{const d=e.run('__M.decider()');assert.equal(d.seat,seat);m.apply({t:'modal',s:seat,i:0});};
  answer(); // first casualty
  assert.match(e.run('__M.decider().title'),/Counterattack/);
  answer(); // activate the second casualty's E2
  let d=e.run('__M.decider()');assert.equal(d.kind,'pick');
  m.apply({t:'pick',s:seat,ix:[0]});
  assert.equal(e.run('G.mode'),'oppzonepick');
  assert.equal(e.run(`ruModeOwner()`),seat);
  assert.equal(e.run('G._counterFrame.queue.length'),2,'the two remaining original draws are suspended');
  assert.equal(e.run(`document.getElementById(zId('${seat}','rank')).classList.contains('hs')`),true,'counterattacker glows green');
  const remaining=e.run(`G['${seat}'].deck.length`),mp=e.run(`G['${foe}'].mp`);
  if(cancel){
    m.apply({t:'cancel',s:seat});
    for(let i=0;i<8;i++){d=e.run('__M.decider()');if(d.kind!=='modal')break;m.apply({t:'modal',s:d.seat,i:0});}
    assert.equal(e.run('!!G._counterFrame'),false);
    assert.equal(e.run(`G['${seat}'].deck.length`),remaining-2,'declining the attack resumes the original queue');
    continue;
  }
  m.apply({t:'zone',s:seat,o:seat,z:'rank'});
  m.apply({t:'zone',s:seat,o:foe,z:'rank'});
  assert.equal(e.run(`G['${seat}'].deck.length`),remaining,'remaining draws wait for the counterattack');
  assert.ok(e.run(`G['${foe}'].mp`)<mp,'counterattack damage resolves first');
  for(let i=0;i<20&&e.run('!!G._counterFrame');i++){
    d=e.run('__M.decider()');
    assert.equal(d.kind,'modal','attack continuation must be a real response prompt');
    m.apply({t:'modal',s:d.seat,i:d.labels.findIndex(x=>/Pass|Skip|Continue/.test(x))>=0?d.labels.findIndex(x=>/Pass|Skip|Continue/.test(x)):0});
  }
  assert.equal(e.run('!!G._counterFrame'),false,'attack continuation finishes');
  for(let i=0;i<8;i++){d=e.run('__M.decider()');if(d.kind!=='modal')break;m.apply({t:'modal',s:d.seat,i:0});}
  assert.equal(e.run(`G['${seat}'].deck.length`),remaining-2,'original final two casualties resume exactly once');
}
console.log('PASS Counterattack pauses casualty 3/4, uses green board selection, resolves damage and resumes, both seats');
for(const target of ['ai','ai2']){
  const m=newMatch({seed:31,mode:'tag2v2',order:['player','ai2','ai3','ai'],
    classes:{player:'phantom',ai3:'light',ai:'shadow',ai2:'shadow'}}),e=m.eng;
  require('./nopaint').install(e);require('./brain').install(e);
  e.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;
    G.phase='main';G.mode='normal';G.turn='player';G.player.mp=30;G.ai.mp=30;
    G.player.hand=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless')];
    G.ai.deck=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless'),...G.ai.deck];
    G.ai2.deck=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless'),...G.ai2.deck];`);
  e.dropTimeouts();
  const a=e.run('G.ai.deck.length'),b=e.run('G.ai2.deck.length'),cc=e.run('G.ai.cas');
  e.run(`ruEachOpp('player',(s,p)=>{p.mp-=3;});`);
  assert.equal(e.run('G.ai.mp'),27,'Tag opposing MP changes once, not once per enemy seat');
  e.run(`ADEFS['Morbid Cemetery'].effects.find(x=>/grave burst/.test(x.label)).fn('player',G.player,G.ai);`);
  const d=e.run('__M.decider()');assert.equal(d.seat,'player');assert.match(d.title,/Casualty Recipient/);
  const ix=e.run(`livingOpponentsOf('player').indexOf('${target}')`);
  m.apply({t:'modal',s:'player',i:ix});
  for(let i=0;i<8;i++){const next=e.run('__M.decider()');if(next.kind!=='modal')break;m.apply({t:'modal',s:next.seat,i:0});}
  assert.equal(e.run('G.ai.deck.length'),a-(target==='ai'?2:0));
  assert.equal(e.run('G.ai2.deck.length'),b-(target==='ai2'?2:0));
  assert.equal(e.run('G.ai.cas'),cc+2,'shared CC changes once for the chosen recipient');
}
console.log('PASS Tag MP once per team and actual Morbid Cemetery CC recipient choice, either enemy Deck');
