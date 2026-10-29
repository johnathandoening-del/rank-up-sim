'use strict';
const assert=require('node:assert/strict');
const {setup}=require('./gameplay-fix-fixtures');
const {newMatch}=require('./match');
const tiers=require('../../ai/tiers');
const e=setup().eng;
e.run(`window.RUBots={available:()=>true};window.RU_AI_LEVEL_KEY_B='basic';window.RU_AI_LEVEL_NUM_B=1;`);
for(const mode of ['tag2v2','team2v2'])for(const key of tiers.ORDER){
  const i=key.lastIndexOf('-'),family=key.slice(0,i),level=Number(key.slice(i+1));
  e.run(`window.modeState.mode='${mode}';window.RU_AI_LEVEL_KEY='${family}';window.RU_AI_LEVEL_NUM=${level};`);
  const bots=JSON.parse(e.run(`JSON.stringify(ruSoloBotConfig('${mode}').solo.bots)`));
  assert.deepEqual(bots,{ai:key,ai2:key,ai3:key},mode+' all bots use '+key);
  assert.equal(e.run(`ru14KeyFor('ai2','${mode}')`),key,'D level resolver agrees with its assigned tier');
}
e.run(`window.modeState.mode='1v1v1';window.RU_AI_LEVEL_KEY='talented';window.RU_AI_LEVEL_NUM=2;`);
assert.equal(e.run(`ruSoloBotConfig('1v1v1').solo.bots.ai2`),'basic-1','FFA retains its independently selected second opponent');
e.run(`G.twoVtwo='tag';`);
assert.equal(e.run(`ruSoloBotConfig('1v1v1').deltaDecks.ai2.length`),0,'leaving a Tag match does not leak its shared tier into the next FFA loadout');
e.run('delete G.twoVtwo;');
console.log('PASS all 14 tiers assigned to every Tag/Team bot; independent FFA level retained');
assert.match(e.run(`RU_AMALGAMATIONS.find(c=>c.id==='amalg-malevolent-1').skillText`),/Draw 1 card.*M value/);
for(const mode of ['standard','1v1v1','tag2v2','team2v2'])for(const M of [-3,0,1,4]){
  const four=mode==='tag2v2'||mode==='team2v2';
  const order=four?['player','ai2','ai3','ai']:mode==='1v1v1'?['player','ai','ai2']:['player','ai'];
  for(const seat of order){
    const m=newMatch({seed:31,mode,order,classes:Object.fromEntries(order.map(s=>[s,'shadow']))}),eng=m.eng;
    require('./nopaint').install(eng);require('./brain').install(eng);
    eng.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;
      G.turn='${seat}';G.phase='main';G.mode='normal';G._turnNo=5;G.exchange=3;G.firstTurn=false;
      var def=RU_AMALGAMATIONS.find(x=>x.id==='amalg-malevolent-1');
      G['${seat}'].delta=[Object.assign({},def,{id:'test-evo',baseId:def.id,type:'evolution',class:'amalgamation',evoType:'amalgamation',
        currentNP:1,currentRP:2,usedSkill:false,elements:[mkNum(CLASSLESS[1],'classless')]})];
      (G.sideOrder||[]).forEach(s=>{G[s].hand=[];G[s].deck=Array.from({length:12},()=>mkNum(CLASSLESS[1],'classless'));G[s].mp=30;});
      window.drawnCard=Object.assign(mkAct('Plus'),{M:${M}});G['${seat}'].deck.unshift(drawnCard);`);
    eng.dropTimeouts();
    const foes=JSON.parse(eng.run(`JSON.stringify(livingOpponentsOf('${seat}'))`));
    m.apply({t:'amalgSkill',s:seat,id:'test-evo'});
    for(let n=0;n<5;n++){
      const d=eng.run('__M.decider()');
      if(d.kind==='pick')m.apply({t:'pick',s:d.seat,ix:[0]});
      else if(d.kind==='modal')m.apply({t:'modal',s:d.seat,i:0});else break;
    }
    assert.equal(eng.run(`G['${seat}'].hand.filter(c=>c.id===drawnCard.id).length`),1,mode+' '+seat+' draws exactly one card');
    assert.equal(eng.run(`G['${seat}'].deck.length`),12,'draw comes from the activator Deck');
    assert.equal(eng.run(`G['${seat}'].delta[0].elements.length`),0,'normal Element cost is paid once');
    for(const s of order.filter(s=>s!==seat))assert.equal(eng.run(`G['${s}'].deck.length`),
      12-(foes.includes(s)?Math.max(0,M):0),mode+' '+seat+' drawn M '+M+' affects '+s);
  }
}
console.log('PASS Malevolent Amal 1 draws for every activator, mills every enemy by drawn M, never mills allies, clamps negative M');
