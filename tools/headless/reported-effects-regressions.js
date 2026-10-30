'use strict';
const assert=require('node:assert/strict');
const {newMatch}=require('./match');
function fixture(mode='standard',seat='player',cls='temporal'){
  const m=newMatch({seed:31,mode,order:mode==='standard'?['player','ai']:['player','ai2','ai3','ai'],
    classes:{player:cls,ai:cls,ai2:cls,ai3:cls}}),e=m.eng;
  require('./nopaint').install(e);require('./brain').install(e);
  e.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;ruSettleReset();
    G.turn='${seat}';G.phase='main';G.mode='normal';G._turnNo=5;G.firstTurn=false;G.exchange=3;
    G._turnsCompletedBy={player:2,ai:2,ai2:2,ai3:2};
    for(const s of G.sideOrder||['player','ai']){G[s].hand=[];G[s].bank=[];G[s].leftFlank=null;G[s].rightFlank=null;
      G[s].deadzone=[];G[s].discard=[];G[s].cas=0;G[s].mp=30;
      Object.defineProperty(G[s],'rankZone',{value:mkNum({n:5,r:2,A:3,M:0,S:null,ca:true,st:'Basic'},'classless'),writable:true,configurable:true,enumerable:true});
      G[s].deck=Array.from({length:24},()=>mkNum(CLASSLESS[1],'classless'));}
    ruFieldWatch();`);e.dropTimeouts();return m;
}
function settle(m){
  for(let i=0;i<40;i++){
    const d=m.eng.run('__M.decider()');if(d.kind!=='modal')return;
    const ix=d.labels.findIndex(x=>/^(Continue|Pass|Skip|Decline|Cancel)/.test(x));assert.ok(ix>=0,JSON.stringify(d));
    m.apply({t:'modal',s:d.seat,i:ix});
  }
  throw Error('Unresolved prompts');
}
const seats=mode=>mode==='standard'?['player','ai']:['player','ai2','ai3','ai'];
const tests={
  stall(){for(const mode of ['standard','tag2v2','team2v2'])for(const s of seats(mode))for(const real of [false,true]){
    const m=fixture(mode,s),e=m.eng;
    e.run(`var p=G['${s}'];window.stall=mkAct('Stall');p.deadzone=${real?"[mkNum(CLASSLESS[2],'classless'),stall]":"[stall]"};p.cas=p.deadzone.length;
      p.deck.unshift(mkAct('Protect'));ruOwnPrompt('${s}');applyE2('${s}',stall);`);e.settle(10000);
    let d=e.run('__M.decider()');
    if(d.kind==='modal'){m.apply({t:'modal',s:d.seat,i:0});d=e.run('__M.decider()');}
    assert.equal(d.kind,'pick',mode+' '+s+' Stall must offer the optional Deadzone/Shell removal after drawing Safeguard');
    assert.equal(d.seat,s);assert.equal(e.run(`G['${s}'].hand.some(c=>c.name==='Protect')`),true);
    const cc=e.run(`G['${s}'].cas`);m.apply({t:'pick',s,ix:[0]});assert.equal(e.run(`G['${s}'].cas`),cc-1);
  }},
  shellReplay(){
    const m=fixture(),e=m.eng;
    e.run(`G.player.deadzone=[mkAct('Stall')];G.player.cas=1;G.player.deck.unshift(mkAct('Protect'));
      window.shellRoot=__S.snap();`);
    const ids=[];
    for(let i=0;i<2;i++){
      e.run(`__S.restore(shellRoot);ruOwnPrompt('player');applyE2('player',G.player.deadzone[0]);`);e.settle(10000);
      m.apply({t:'modal',s:'player',i:0});ids.push(e.run('PCK.pool[0].id'));
    }
    assert.equal(ids[0],ids[1],'rebuilding the same mandatory cost prompt retains the same Shell identity');
  },
  materials(){for(const mode of ['tag2v2','team2v2'])for(const s of seats(mode)){
    const m=fixture(mode,s),e=m.eng;
    e.run(`var p=G['${s}'],mate=ruPartnerOf('${s}');p.rankZone=mkNum(CLASSLESS[5],'classless');p.leftFlank=mkNum(CLASSLESS[5],'classless');
      G[mate].rankZone=mkNum(CLASSLESS[5],'classless');G[mate].leftFlank=null;G[mate].rightFlank=null;
      var def=RU_AMALGAMATIONS.find(x=>x.id==='amalg-unknown-5');
      p.evolutions=[Object.assign({},def,{id:'fixture-evo',baseId:def.id,type:'evolution',class:'amalgamation',evoType:'amalgamation',elements:[]})];`);
    assert.equal(e.run(`findEvolutionOptions('${s}').length`),0,'partner Rank Zone cannot be an Evolution material');
    const ids=e.run(`JSON.stringify([G['${s}'].rankZone.id,G['${s}'].leftFlank.id,G[mate].rankZone.id])`);
    assert.equal(e.run(`performAmalgamationByIdsAI1('${s}','amalg-unknown-5',${ids})`),false,'direct input must also reject partner Rank Zone');
    e.run(`window.keptRank=G[mate].rankZone;G[mate].leftFlank=mkNum(CLASSLESS[5],'classless');`);
    assert.equal(e.run(`findEvolutionOptions('${s}').length>0`),true,'legal partner Flank material remains available');
    const legal=e.run(`JSON.stringify([G['${s}'].rankZone.id,G['${s}'].leftFlank.id,G[mate].leftFlank.id])`);
    assert.equal(e.run(`performAmalgamationByIdsAI1('${s}','amalg-unknown-5',${legal})`),true);
    assert.equal(e.run('G[mate].rankZone===keptRank'),true,'partner Rank Zone stays in place during actual Evolution');
  }},
  airship(){for(const mode of ['tag2v2','team2v2'])for(const s of seats(mode))for(const path of ['movement','hand','casualty']){
    const m=fixture(mode,s,'zero'),e=m.eng;
    e.run(`window.airship=mkArea('zero');airship._ownerSeat='${s}';G['${s}'].hand=[airship];`);
    if(path==='movement')e.run(`G['${s}'].hand.splice(0,1);dzAdd(G['${s}'],airship);ruFieldWatch();`);
    if(path==='casualty')e.run(`G['${s}'].hand=[];G['${s}'].deck.unshift(airship);casDraw('${s}');ruFieldWatch();`);
    if(path==='hand')m.apply({t:'activateArea',s,id:e.run('airship.id')});
    for(let i=0;i<5;i++){
      const d=e.run('__M.decider()');if(d.kind!=='modal')break;
      m.apply({t:'modal',s:d.seat,i:0});
      if(e.run(`G['${s}'].deadzone.includes(airship)`))break;
    }
    e.settle(10000);
    assert.equal(e.run(`(G.sideOrder||[]).every(s=>G[s].rankZone.currentNP===0)`),true,mode+' '+s+' '+path+' Airship entry must zero every Battlefield');
    settle(m);e.run(`beginPhase('end');`);e.settle(10000);settle(m);
    assert.equal(e.run(`(G.sideOrder||[]).every(s=>G[s].rankZone.currentNP===5)`),true,'Airship temporary zeroing expires at End Phase');
  }},
  nullify(){for(const mode of ['standard','tag2v2','team2v2'])for(const s of seats(mode)){
    const m=fixture(mode,s,'kismet'),e=m.eng;
    e.run(`var p=G['${s}'];window.existing=mkNum(CLASSLESS[4],'classless');dzAdd(p,existing);
      p.deck.unshift(mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless'),mkAct('Nullify'),mkNum(CLASSLESS[3],'classless'));
      for(let i=0;i<4;i++)casDraw('${s}');`);e.settle(10000);
    for(let i=0;i<15;i++){
      const d=e.run('__M.decider()');if(d.kind!=='modal')break;
      const use=d.labels.findIndex(x=>/Activate E2 Effect/.test(x));
      m.apply({t:'modal',s:d.seat,i:use>=0?use:0});
    }
    assert.equal(e.run(`G['${s}'].deadzone.length`),5);
    if(mode!=='standard'){
      e.run(`window.mate=ruPartnerOf('${s}');window.mateCasualty=mkNum(CLASSLESS[6],'classless');G[mate].deck.unshift(mateCasualty);casDraw(mate);`);
      e.settle(10000);settle(m);
    }
    e.run(`beginPhase('end');`);e.settle(10000);settle(m);
    assert.deepEqual(JSON.parse(e.run(`JSON.stringify(G['${s}'].deadzone.map(c=>c.id))`)),[e.run('existing.id')],
      mode+' '+s+' Nullify must remove all this-turn casualty draws, including pre-activation draws, not unrelated cards');
    if(mode==='team2v2')assert.equal(e.run('G[mate].deadzone.includes(mateCasualty)'),true,'Team partner has a separate Deadzone');
  }},
  neo(){for(const mode of ['standard','tag2v2','team2v2'])for(const s of seats(mode))for(const cls of ['fission','shadow','astute','haste'])for(const how of ['hand','dead']){
    const m=fixture(mode,s,cls),e=m.eng;
    e.run(`var p=G['${s}'];window.a=mkNum(CLASSLESS[1],'classless');window.b=mkNum(CLASSLESS[2],'classless');window.c=mkNum(CLASSLESS[3],'classless');
      p.deadzone=[a,b,c];p.cas=3;window.neo=mkAct('Neo Battle Star');p.hand=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless')];
      ${how==='hand'?"p.hand.push(neo);":"dzAdd(p,neo);ruOwnPrompt('"+s+"');applyE2('"+s+"',neo);"}`);
    if(how==='hand'){
      m.apply({t:'playAction',s,id:e.run('neo.id')});
      for(let i=0;i<5;i++){const d=e.run('__M.decider()');if(d.kind!=='modal')break;m.apply({t:'modal',s:d.seat,i:0});}
    }
    e.settle(10000);const d=e.run('__M.decider()');assert.equal(d.kind,'pick',mode+' '+s+' Neo '+how+' must offer Deadzone payment: '+e.run('__logRing.join(" | ")'));
    assert.equal(d.seat,s);assert.equal(e.run(`G['${s}'].deadzone.includes(a)&&G['${s}'].deadzone.includes(b)&&G['${s}'].deadzone.includes(c)`),true);
    const ix=e.run(`PCK.pool.map((x,i)=>({x,i})).filter(v=>${how==='hand'?"v.x.id===c.id":"v.x.id===b.id||v.x.id===c.id"}).map(v=>v.i)`);
    m.apply({t:'pick',s,ix});
    if(how==='hand'){
      const hand=e.run('__M.decider()');assert.equal(hand.kind,'pick');m.apply({t:'pick',s,ix:[0,1]});
    }else settle(m);
    assert.equal(e.run(`G['${s}'].discard.some(x=>x.id===c.id)`),true,'the selected non-first card actually leaves the Deadzone');
    assert.equal(e.run(`G['${s}'].deadzone.some(x=>x.id===a.id)`),true,'unselected first card stays in the Deadzone');
  }},
  temporal8(){for(const mode of ['standard','tag2v2','team2v2'])for(const s of seats(mode)){
    const m=fixture(mode,s),e=m.eng;
    e.run(`var p=G['${s}'];window.t8=mkNum(ND.temporal.find(c=>c.n===8),'temporal');p.rankZone=t8;
      window.untouched=mkNum(CLASSLESS[1],'classless');window.reused=mkNum(CLASSLESS[2],'classless');
      window.payment=mkNum(CLASSLESS[3],'classless');window.element=mkNum(CLASSLESS[4],'classless');
      window.host={id:uid(),name:'Element return fixture',type:'evolution',evoType:'amalgamation',class:'amalgamation',numeral:4,rank:2,currentNP:4,currentRP:2,elements:[element]};
      element._evolutionOrigin={seat:'${s}',id:host.id};p.delta=[host];p.hand=[payment];p.discard=[untouched,reused];
      G._turnNo=4;ruFieldWatch();G._turnNo=5;ruCaptureTurnStart();
      p.discard.splice(p.discard.indexOf(reused),1);p.hand.push(reused);ruFieldWatch();
      ruFx.fromHand(p,reused,'discard');ruFx.fromHand(p,payment,'discard');
      spendElement('${s}',host,'discard',()=>{});`);
    let d=e.run('__M.decider()');assert.equal(d.kind,'modal');m.apply({t:'modal',s,i:0});
    e.run(`G.phase='battle';t8._t8={turn:G._turnNo,rp:1,redone:false};t8.attacksLeft=2;
      var target=oppList('${s}')[0];G[target].rankZone=mkNum(CLASSLESS[1],'classless');
      G[target].hand=[];G[target].bank=[];G[target].leftFlank=null;G[target].rightFlank=null;ruFieldWatch();`);
    m.apply({t:'atkMode',s});m.apply({t:'zone',s,o:s,z:'rank'});
    m.apply({t:'zone',s,o:e.run('target'),z:'rank'});
    for(let i=0;i<30;i++){
      d=e.run('__M.decider()');if(d.kind!=='modal')break;
      const ix=d.labels.findIndex(x=>/^(Continue|Pass|Skip|Decline|Keep)/.test(x));assert.ok(ix>=0,JSON.stringify(d));
      m.apply({t:'modal',s:d.seat,i:ix});
    }
    assert.equal(e.run('!!t8._t8.redone'),true,'Temporal 8 refund threshold actually resolves after battle');
    assert.equal(e.run(`G['${s}'].hand.some(c=>c.id===payment.id)&&G['${s}'].hand.some(c=>c.id===reused.id)`),true,
      'all skill payments return, including a card that began this turn in Drop and was reused');
    assert.equal(e.run('host.elements.some(c=>c.id===element.id)'),true,'spent Element returns to its Delta parent');
    assert.equal(e.run(`G['${s}'].hand.some(c=>c.id===element.id)`),false);
    assert.equal(e.run(`G['${s}'].discard.includes(untouched)`),true,'old unused Drop cards stay in Drop');
  }},
  areaLog(){for(const mode of ['tag2v2','team2v2']){
    const m=fixture(mode,'ai3'),e=m.eng;
    e.run(`window.area=mkArea('light');area._ownerSeat='ai3';__logRing.length=0;
      ruWithActor('ai3',()=>{dzAdd(G.ai3,area);ruFieldWatch();});`);e.settle(10000);
    const log=e.run('__logRing.join("\\n")');assert.ok(log.includes(e.run(`sideSubjectLabel('ai3')+' places Shining Justice in '+sidePossLower('ai3')+' Deadzone.'`)));
    assert.equal(e.run('__logRing.filter(x=>x.includes("places Shining Justice")).length'),1,'one entry event for one physical Area in a shared Tag Deadzone');
    e.run(`__logRing.length=0;ruWithActor('player',()=>{var i=G.ai3.deadzone.indexOf(area);G.ai3.deadzone.splice(i,1);G.ai3.cas--;G.ai3.deck.push(area);ruFieldWatch();});`);e.settle(10000);
    assert.ok(e.run('__logRing.join("\\n")').includes(e.run(`sideSubjectLabel('player')+' removes Shining Justice from '+sidePossLower('ai3')+' Deadzone.'`)),
      'Area removal names its actor and prior holder, including a move to a Deck');
    e.run(`ruWithActor('ai3',()=>{G.ai3.deck.splice(G.ai3.deck.indexOf(area),1);dzAdd(G.ai3,area);});
      __logRing.length=0;ruWithActor('ai3',()=>{ruFx.fromDeadzone(G.ai3,area);G.ai3.deck.push(area);
        G.ai3.deck.splice(G.ai3.deck.indexOf(area),1);dzAdd(G.ai3,area);ruFieldWatch();});`);e.settle(10000);
    assert.equal(e.run('__logRing.filter(x=>x.includes("removes Shining Justice")).length'),1,'same-input departure logged');
    assert.equal(e.run('__logRing.filter(x=>x.includes("places Shining Justice")).length'),1,'same-input reentry logged');
  }}
};
for(const [name,fn] of Object.entries(tests))if(!process.argv[2]||process.argv[2]===name){fn();console.log('PASS reported effect '+name);}
module.exports={fixture,settle};
