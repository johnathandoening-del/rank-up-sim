'use strict';
const assert=require('node:assert/strict');
const M=require('../../match-clock');
const {createEngine}=require('./engine');
const {MATCH_CODE}=require('../../ai/match');
for(const [type,options] of Object.entries(M.OPTIONS))for(const minutes of options){
  const c=M.create({enabled:true,type,minutes},['player','ai'],'player',1000);
  assert.equal(M.advance(c,61000),null);
  assert.equal(type==='player'?c.remaining.player:c.left,minutes*60000-60000);
  M.progress(c,{turn:'ai',turnNo:1},61000);
  assert.equal(type==='turn'?c.left:type==='player'?c.remaining.ai:c.left,type==='game'?minutes*60000-60000:minutes*60000);
  M.advance(c,91000);M.pause(c,true,91000);
  const before=JSON.stringify(c.remaining),left=c.left;
  M.advance(c,9991000);assert.equal(JSON.stringify(c.remaining),before);assert.equal(c.left,left);
  M.pause(c,false,9991000);M.advance(c,9992000);
  assert.equal(type==='player'?c.remaining.ai:c.left,(type==='player'?minutes*60000:type==='turn'?minutes*60000:minutes*60000-60000)-31000);
}
const cumulative=M.create({enabled:true,type:'player',minutes:5},['player','ai'],'player',0);
M.advance(cumulative,10000);M.progress(cumulative,{turn:'ai',turnNo:1},10000);M.advance(cumulative,30000);
M.progress(cumulative,{turn:'player',turnNo:2},30000);M.advance(cumulative,40000);
assert.equal(cumulative.remaining.player,280000);assert.equal(cumulative.remaining.ai,280000);
const grace=M.create({enabled:true,type:'turn',minutes:3},['player','ai'],'player',0);
assert.equal(M.advance(grace,180000).stage,'main');assert.equal(M.advance(grace,200000),null,'expiry emitted once');
M.progress(grace,{turn:'player',turnNo:0,stage:'grace'},200000);
assert.equal(grace.graceLeft,15000);M.progress(grace,{turn:'player',turnNo:0,stage:'grace'},201000);
assert.equal(M.advance(grace,215000).stage,'grace','repeated progress does not restart grace');
assert.equal(M.config({enabled:true,type:'bad',minutes:0}).minutes,3);
console.log('PASS all 10 time presets, turn resets, cumulative player budgets, continuous game clock, pause/resume and one-shot expiry');

function engine(type='turn'){
  const e=createEngine({seed:412});e.run(MATCH_CODE);
  e.run(`__H.start({seed:412,mySeat:0,firstSeat:0,seat0Class:'light',seat1Class:'light',timeControl:{enabled:true,type:'${type}',minutes:3}});`);
  e.settle(800);assert.deepEqual(e.errors,[]);return e;
}
for(const phase of ['draw','promotion','rally','main','standby','battle','end']){
  const e=engine();e.run(`G.phase='${phase}';G.mode='oppzonepick';SF={who:'player',card:G.player.rankZone};openModal('Pending choice','Choose',[]);ruApplyAction({t:'clockExpire',s:'player',event:{type:'turn',stage:'main',turn:'player',turnNo:0}});`);
  assert.equal(e.run('G.turn'),'ai',phase+' timeout hands turn off');assert.equal(e.run('G._turnNo'),1);
  assert.equal(e.run('!!SF'),false);assert.equal(e.run('G.gameOver'),false);e.settle(1000);
  assert.equal(e.run('G.turn'),'ai','old end callbacks cannot skip another turn');assert.deepEqual(e.errors,[]);
}
const p=engine('player');p.run("ruApplyAction({t:'clockExpire',event:{type:'player',stage:'main',turn:'player',turnNo:0}})");
assert.equal(p.run('G.gameOver'),true);assert.equal(p.run('G.__winner'),'ai');
const g=engine('game');g.run("ruApplyAction({t:'clockExpire',event:{type:'game',stage:'main',turn:'player',turnNo:0}})");
assert.equal(g.run('G.gameOver'),true);assert.equal(g.run('G._timeLimitReached'),true);
const a=engine();a.run("G.phase='main';G.exchange=2;G._turnsCompletedBy={player:true,ai:true};Object.assign(G.player.rankZone,{canAttack:true,numeral:5,currentNP:5,rank:1,currentRP:1,attacksLeft:1});G.player._advCardsThisTurn=['Plus'];ruApplyAction({t:'clockExpire',event:{type:'turn',stage:'main',turn:'player',turnNo:0}})");
assert.equal(a.run('G.phase'),'battle');assert.equal(a.run('G._timeAttackGrace.declared'),false);
a.run("ruApplyAction({t:'clockExpire',event:{type:'turn',stage:'grace',turn:'player',turnNo:0}})");
assert.equal(a.run('G.gameOver'),true);assert.equal(a.run('G.__winner'),'ai');
const declared=engine();declared.run("G.phase='main';G.player._advCardsThisTurn=['Plus'];G._attackDeclarations=[{turn:0,aWho:'player',status:'negated'}];ruApplyAction({t:'clockExpire',event:{type:'turn',stage:'main',turn:'player',turnNo:0}})");
assert.equal(declared.run('G.turn'),'ai','Cease/Nullify declaration satisfies timed obligation');
const impossible=engine();impossible.run("G.player._advCardsThisTurn=['Plus'];ruApplyAction({t:'clockExpire',event:{type:'turn',stage:'main',turn:'player',turnNo:0}})");
assert.equal(impossible.run('G.gameOver'),true,'no legal mandatory attack forfeits');
const finalAttack=engine();finalAttack.run("G.phase='battle';G.exchange=2;G._turnsCompletedBy={player:true,ai:true};Object.assign(G.player.rankZone,{canAttack:true,numeral:5,currentNP:5,rank:1,currentRP:1,attacksLeft:1});G.player._advCardsThisTurn=['Plus'];ruApplyAction({t:'clockExpire',event:{type:'turn',stage:'main',turn:'player',turnNo:0}});var finalDeclaration=ruRecordAttackDeclaration('player','rank','ai','rank');");
assert.equal(finalAttack.run('G._timeAttackGrace.declared'),true,'declaration immediately satisfies grace');
assert.equal(finalAttack.run('G.turn'),'player','let the declared encounter resolve before passing');
finalAttack.run("ruFinishAttackDeclaration(finalDeclaration,'negated');ruSettleNow();");
assert.equal(finalAttack.run('G.turn'),'ai','a stopped final attack still passes instead of forfeiting');
assert.equal(finalAttack.run('G.gameOver'),false);assert.deepEqual(finalAttack.errors,[]);
for(const type of ['turn','player','game']){
  const hud=engine(type);
  assert.equal(hud.run("document.querySelectorAll('#hud-strip [data-time-seat]').length"),2);
  if(type==='turn'){
    assert.equal(hud.run("Array.from(document.querySelectorAll('#hud-strip [data-time-seat]')).filter(p=>!p.hidden).length"),1);
    assert.equal(hud.run("document.querySelector('#hud-strip [data-time-seat=player]').hidden"),false);
    hud.run("ruApplyAction({t:'clockExpire',event:{type:'turn',stage:'main',turn:'player',turnNo:0}})");
    assert.equal(hud.run("document.querySelector('#hud-strip [data-time-seat=ai]').hidden"),false);
    assert.equal(hud.run("document.querySelector('#hud-strip [data-time-seat=player]').hidden"),true);
  }else if(type==='player'){
    assert.equal(hud.run("document.querySelector('#hud-strip [data-time-seat=ai]').style.opacity"),'0.35');
    assert.equal(hud.run("document.querySelector('#hud-strip [data-time-seat=player]').style.opacity"),'');
  }else{
    assert.equal(hud.run("document.querySelector('#hud-strip .hud-game-time').hidden"),false);
    assert.equal(hud.run("document.querySelector('#hud-strip .hud-game-time').style.gridRow"),'1 / span 2');
  }
  assert.deepEqual(hud.errors,[]);
}
console.log('PASS expiry in all seven phases, pending skill/prompt cancellation, player loss, game No Result, final attack grace and negated declarations');
console.log('PASS stat-bar placement, turn timer migration, player clocks with 35% inactive opacity, and shared game clock spanning both rows');
for(const count of [3,4])for(const type of ['turn','player','game']){
  const e=createEngine({seed:413});e.run(MATCH_CODE);
  const order=['player','ai','ai2','ai3'].slice(0,count);
  e.run(`__H.start({seed:413,mySeat:0,mode:'${count===3?'1v1v1':'royale4'}',order:${JSON.stringify(order)},classes:{player:'light',ai:'light',ai2:'light',ai3:'light'},seat0Class:'light',seat1Class:'light',timeControl:{enabled:true,type:'${type}',minutes:7}});`);
  e.settle(800);
  assert.equal(e.run("document.querySelectorAll('#hud-center [data-time-seat]').length"),count);
  if(type==='game')assert.equal(e.run("document.querySelector('#hud-center .hud-game-time').style.gridRow"),'1 / span '+count);
  if(type==='player'){
    e.run("ruApplyAction({t:'clockExpire',event:{type:'player',turn:'player',turnNo:0,stage:'main'}})");
    assert.equal(e.run('G.eliminated.player'),true);assert.equal(e.run('G.gameOver'),false);
  }
  assert.deepEqual(e.errors,[]);
}
const restored=engine('player');restored.run("G=JSON.parse(JSON.stringify(G));RUTime.paint();");
assert.equal(restored.run("document.querySelector('#hud-strip [data-time-seat=player]').hidden"),false,'clock survives a timeline state-object restore');
console.log('PASS three/four-seat HUDs, shared row spans, timeout elimination and timeline state restore');
