'use strict';
// Controlled shared-input fixtures, not natural-play matches.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createEngine}=require('./engine');
const {pair,REPORT}=require('./kismet-online');
const e=createEngine({seed:1});
for(let attacker=0;attacker<=8;attacker++)for(let addon=0;addon<=8;addon++){
  const expected=(attacker<=2&&addon<=2)||Math.abs(attacker-addon)>=2;
  assert.equal(e.run(`canAddonTo({id:'a',rank:${attacker}},{id:'b',rank:${addon}})`),expected,`${attacker} <- ${addon}`);
  assert.equal(e.run(`canAddonTo({id:'a',rank:0,currentRP:${attacker}},{id:'b',rank:0,currentRP:${addon}})`),expected,'current RP overrides printed Rank');
}
assert.equal(e.run("canAddonTo({id:'same',rank:0},{id:'same',rank:4})"),false);
assert.equal(e.run("canAddonTo(null,{id:'b',rank:0})"),false);
assert.equal(e.run("canAddonTo({id:'a',rank:0},null)"),false);
for(const w of ['player','ai'])for(const delta of [false,true])
  for(const [leadRank,addonRank,allowed] of [[2,3,false],[3,2,false],[3,3,false],[3,4,false],[4,3,false],[1,3,true],[3,1,true],[3,5,true],[5,3,true],[2,4,true],[4,2,true],[2,2,true]]){
  const other=w==='player'?'ai':'player',p=pair(w,{player:'light',ai:'light'});
  p.run(`
    G.turn='${w}';G.phase='battle';G.mode='normal';G.allowEvolutions=true;
    var me=G['${w}'];me.hand=[];me.leftFlank=null;me.rightFlank=null;me.delta=[];
    G['${other}'].hand=[];G['${other}'].leftFlank=null;G['${other}'].rightFlank=null;
    me.rankZone=mkNum({n:5,r:2,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');
    var support=mkNum({n:3,r:3,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
    if(${delta}){var def=RU_AMALGAMATIONS.find(c=>c.id==='amalg-unknown-7');
      support=Object.assign({},def,{id:uid(),type:'evolution',evoType:'amalgamation',class:'amalgamation',currentNP:7,currentRP:3,canAttack:true,attacksLeft:1,elements:[]});me.delta=[support];}
    else me.leftFlank=support;
    ruFieldWatch();
  `);
    p.run(`closeModal();me.rankZone.currentRP=${leadRank};support.currentRP=${addonRank};me.attacksUsed={};me.rankZone.attacksLeft=1;support.attacksLeft=1;G._addons=[];G.mode='normal';`);
    p.apply({t:'atkMode',s:w});p.apply({t:'zone',s:w,o:w,z:'rank'});
    assert.equal(p.run(`ruIsLegalAddon('${w}','${delta?'delta':'left-flank'}')`),allowed,'shared input legality');
    assert.equal(p.run(`document.getElementById(zId('${w}','${delta?'delta':'left-flank'}')).classList.contains('ha')`),allowed,'highlight matches rule');
    p.apply(delta?{t:'delta',s:w,w}:{t:'zone',s:w,o:w,z:'left-flank'});
    assert.equal(p.run('(G._addons||[]).some(a=>a.card.id===support.id)'),allowed,`${w} ${delta?'Delta':'Flank'} ${leadRank} <- ${addonRank}: actual Addon selection; ${JSON.stringify(p.pending())}`);
    assert.equal(p.run('atkLeft(support)'),1,'selection/rejection spends no attack');
    p.finish(`${w} ${delta?'Delta':'Flank'} Rank ${leadRank} with Rank ${addonRank}: ${allowed?'allowed':'blocked'}`);
}
fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'data','addon-ranks.json'),JSON.stringify(REPORT,null,2));
console.log('PASS 81 Rank pairs, current RP overrides, invalid/self cards, and 48 paired online UI cases');
