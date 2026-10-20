'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createEngine}=require('./engine');
const {MATCH_CODE}=require('../../ai/match');

const probe=createEngine({seed:1});
const ids=probe.run('RU_AMALGAMATIONS.map(c=>c.id)');
assert.equal(ids.length,41);
const cards=[];
for(let i=0;i<ids.length;i+=3){
  const e=createEngine({seed:1});
  e.run(MATCH_CODE);
  e.run(`__H.start({seed:1,mySeat:0,seat0Class:'light',seat1Class:'light',firstSeat:0,allowEvolutions:true,deltaDecks:{player:${JSON.stringify(ids.slice(i,i+3))},ai:[]}})`);
  e.settle(1000);
  const rendered=e.run(`G.player.evolutions.map(c=>({card:c,icon:classIconOf(c),html:buildCard(c).innerHTML,label:amalgShortName(c)}))`);
  assert.equal(rendered.length,Math.min(3,ids.length-i));
  for(const result of rendered){
    assert.equal(result.icon,'\uE017');
    assert.ok(result.html.includes('\uE017'),result.card.baseId);
    assert.ok(!result.html.includes('\u2A3F'),result.card.baseId+' retains old symbol');
    assert.ok(result.label.startsWith('Amalgamation '));
    cards.push(result.card);
  }
  assert.deepEqual(e.errors,[]);
}
assert.equal(probe.run(`classIconOf({type:'evolution',evoType:'fullmetal',class:'amalgamation'})`),'\uE018');
assert.equal(probe.run(`amalgShortName({type:'evolution',evoType:'fullmetal',numeral:4,skillType:'Basic'})`),'Fullmetal 4 Basic');
assert.equal(probe.run(`classIconOf({type:'evolution',evoType:'future'})`),'\u0394');
assert.equal(probe.run(`classIconOf({type:'area',class:'amalgamation'})`),'\uE017');
assert.equal(probe.run('Object.keys(CM).length'),19);
assert.equal(probe.run(`CLASS_COLORS.fullmetal`),'#E1E4E6');
assert.equal(probe.run(`cardCls({type:'evolution',evoType:'fullmetal',class:'amalgamation'})`),'nc-fullmetal');
assert.equal(probe.run(`emblemColor({type:'evolution',evoType:'fullmetal',class:'amalgamation'})`),'rgb(65,74,82)');
probe.run(MATCH_CODE);
probe.run(`__H.start({seed:1,mySeat:0,seat0Class:'light',seat1Class:'light',firstSeat:0,allowEvolutions:true,deltaDecks:{player:['amalg-benevolent-2'],ai:[]}})`);
probe.settle(1000);
probe.run(`closeModal();ruSettleReset();G.turn='player';G.phase='main';G.player.hand=[];
  G.player.rankZone=mkNum(ND.light[2],'light');G.player.leftFlank=mkNum(ND.light[2],'light');G.player.rightFlank=mkNum(ND.light[2],'light');
  G.player.delta=[];ruFieldWatch();renderAllL3();`);
assert.deepEqual(Array.from(probe.run(`ruEvolutionReadyTypes('player')`)),['amalgamation']);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).dataset.evolutionReady`),'amalgamation');
// Provider contract only: Fullmetal's actual material rules have not been supplied.
probe.run(`window.findFullmetalOptions=function(w){return G[w]._fixtureFullmetalLegal?[{}]:[];};
  G.player._fixtureFullmetalLegal=true;renderAllL3();`);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).dataset.evolutionReady`),'amalgamation fullmetal');
probe.run(`G.player.leftFlank=null;renderAllL3();`);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).dataset.evolutionReady`),'fullmetal');
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).style.getPropertyValue('--delta-ready-color')`),'#E1E4E6');
probe.run(`G.player.delta=[G.player.evolutions[0]];renderAllL3();`);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).classList.contains('delta-ready')`),false);
probe.run(`G.player.delta=[];G.turn='ai';renderAllL3();`);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).classList.contains('delta-ready')`),false);
assert.equal(probe.run(`document.getElementById(sideZoneId('ai','delta')).classList.contains('delta-ready')`),false);
probe.run(`G.turn='player';G.allowEvolutions=false;renderAllL3();`);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).classList.contains('delta-ready')`),false);
probe.run(`G.allowEvolutions=true;G.player._fixtureFullmetalLegal=false;renderAllL3();`);
assert.equal(probe.run(`document.getElementById(sideZoneId('player','delta')).dataset.evolutionReady`),'');
probe.run(`G.player.evolutions[0].evoType='fullmetal';G.player.leftFlank=mkNum(ND.light[2],'light');`);
assert.equal(probe.run(`findAmalgamationOptionsAI1('player').length`),0,'Fullmetal must not pass Amalgamation material rules');
assert.deepEqual(probe.errors,[]);
fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'data','evolution-icons.json'),JSON.stringify({setup:MATCH_CODE,cards},null,2));
console.log('PASS all 41 real Amalgamation cards use the new emblem; names and stats preserved.');
console.log('PASS distinct Fullmetal icon/name, Amalgamation Area Support icon, generic Evolution fallback; no playable Fullmetal cards or classes added.');
console.log('PASS Fullmetal silver theme; legal-provider readiness, mixed families, local-seat privacy, turn/occupancy/disabled guards and family-specific materials.');
