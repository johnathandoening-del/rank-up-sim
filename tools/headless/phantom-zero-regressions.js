'use strict';
// Constructed positions on the real engine, not natural-match evidence.
const assert=require('node:assert/strict');
const {newMatch}=require('./match');
function position(mode,dw,bot=false){
  const m=newMatch({seed:73,mode,order:['player','ai2','ai3','ai'],
    classes:{player:'phantom',ai:'phantom',ai2:'phantom',ai3:'phantom'}}),e=m.eng;
  require('./nopaint').install(e);require('./brain').install(e);
  e.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;ruSettleReset();
    G.phase='battle';G.mode='normal';G._turnNo=5;G.firstTurn=false;G.exchange=3;
    G._turnsCompletedBy={player:2,ai:2,ai2:2,ai3:2};
    for(const s of G.sideOrder){const p=G[s];p.hand=[];p.bank=[];p.leftFlank=null;p.rightFlank=null;
      p.deadzone=[];p.discard=[];p.cas=0;p.mp=50;p.actUsed=0;
      Object.defineProperty(p,'rankZone',{value:mkNum(CLASSLESS[3],'classless'),writable:true,configurable:true,enumerable:true});
      p.deck=Array.from({length:24},()=>mkNum(CLASSLESS[1],'classless'));}
    window.dw=${JSON.stringify(dw)};window.aw=oppList(dw)[0];G.turn=aw;
    G[dw].rankZone=mkNum(ND.phantom[0],'phantom');
    G[aw].hand=Array.from({length:6},()=>mkNum(CLASSLESS[1],'classless'));
    G[dw].isBot=${bot};ruFieldWatch();`);
  e.dropTimeouts();return m;
}
function pass(m){
  const d=m.eng.run('__M.decider()');
  assert.equal(d.kind,'modal',JSON.stringify(d));
  const i=d.labels.findIndex(x=>/^(Continue|Pass|Skip|Decline)/.test(x));
  assert.ok(i>=0,JSON.stringify(d));m.apply({t:'modal',s:d.seat,i});
}
let count=0;
for(const mode of ['standard','royale4','tag2v2','team2v2']){
  for(const dw of mode==='standard'?['player','ai']:['player','ai2','ai3','ai']){
    const m=position(mode,dw),e=m.eng;
    e.run(`ruDeclareAttack(aw,'rank',dw,'rank',0,function(){G._testAttackDone=true;});`);e.settle(10000);
    let d=e.run('__M.decider()');
    while(d.kind==='modal'&&!d.labels.some(x=>x.startsWith('Phantom 0'))){pass(m);d=e.run('__M.decider()');}
    const i=d.labels.findIndex(x=>x.startsWith('Phantom 0'));assert.ok(i>=0,JSON.stringify(d));
    m.apply({t:'modal',s:dw,i});
    assert.equal(e.run('G[aw].hand.length'),6,'activation must not move attacker hand cards');
    assert.equal(e.run('G[dw].discard.some(c=>c.name===\'Numeral 1\')'),true,'activation pays top Deck cost');
    for(let n=0;n<40;n++){
      d=e.run('__M.decider()');if(d.kind==='pick')break;
      assert.equal(e.run('G[aw].hand.length'),6,'hand unchanged throughout attack/Casualty prompts');pass(m);
    }
    d=e.run('__M.decider()');assert.equal(d.kind,'pick',JSON.stringify(d));
    assert.equal(d.seat,dw);assert.equal(e.run('!!window._RUcbusy||window._RUcq.length>0'),false);
    const n=e.run('Math.min(G[dw].cas,G[aw].hand.length)');
    assert.ok(n>0,'attack added Casualties after starting at zero');
    assert.equal(e.run('PCK.max'),n,'uses post-attack count');
    m.apply({t:'pick',s:dw,ix:Array.from({length:n},(_,i)=>i)});
    assert.equal(e.run('G[aw].hand.length'),6-n);assert.equal(e.run('G[aw].deadzone.length'),n);
    assert.equal(e.run('ruSettlePending()'),0,'deferred skill resolves once and releases');
    assert.equal(e.errors.length,0,e.errors.join('\n'));count++;
  }
}
console.log('PASS Phantom 0 full declared attack, post-Casualty count and owner choice: '+count+' seat/mode cases');
for(const mode of ['standard','tag2v2','team2v2']){
  const m=position(mode,'ai',true),e=m.eng;
  e.run(`resolveAtk(aw,'rank',dw,'rank',0);`);e.settle(10000);
  for(let n=0;n<40&&e.run('!!window._RUcbusy||window._RUcq.length>0');n++)pass(m);
  e.settle(10000);
  assert.equal(e.run('G[aw].hand.length'),6-e.run('Math.min(G[dw].cas,6)'));
  assert.equal(e.run('G[dw].rankZone.usedSkill'),true);
  assert.equal(e.run('ruSettlePending()'),0);assert.equal(e.errors.length,0,e.errors.join('\n'));
}
console.log('PASS bot Phantom 0 uses the same deferred resolution in standard/Tag/Team');
for(const cc of [-3,0,2]){
  const m=position('standard','ai'),e=m.eng;
  e.run(`G[dw].cas=${cc};G[dw].leftFlank=G[dw].rankZone;G[dw].rankZone=mkNum(CLASSLESS[3],'classless');
    ruDeclareAttack(aw,'rank',dw,'left-flank',0,function(){});`);e.settle(10000);
  let d=e.run('__M.decider()');
  const i=d.labels.findIndex(x=>x.startsWith('Phantom 0'));assert.ok(i>=0,JSON.stringify(d));
  m.apply({t:'modal',s:'ai',i});
  for(let k=0;k<40;k++){
    d=e.run('__M.decider()');if(d.kind!=='modal')break;pass(m);
  }
  assert.equal(e.run('G[dw].leftFlank'),null,'defeated Phantom 0 leaves its Flank');
  const n=e.run('Math.min(Math.max(0,G[dw].cas),6)');
  if(n){assert.equal(d.kind,'pick');assert.equal(e.run('PCK.max'),n);m.apply({t:'pick',s:'ai',ix:Array.from({length:n},(_,i)=>i)});}
  else assert.notEqual(d.kind,'pick','nonpositive final CC produces no forced pick');
  assert.equal(e.run('G[aw].hand.length'),6-n);
  assert.equal(e.run('ruSettlePending()'),0);assert.equal(e.errors.length,0,e.errors.join('\n'));
}
console.log('PASS defeated Flank Phantom 0 still resolves, including negative/zero starting CC');
{
  const m=position('standard','ai'),e=m.eng;
  e.run(`G[dw].hand=[mkNum(CLASSLESS[1],'classless')];G[dw].deck.splice(1,0,mkAct('Counterattack'));
    ruDeclareAttack(aw,'rank',dw,'rank',0,function(){});`);e.settle(10000);
  let d=e.run('__M.decider()'),i=d.labels.findIndex(x=>x.startsWith('Phantom 0'));
  assert.ok(i>=0);m.apply({t:'modal',s:'ai',i});
  d=e.run('__M.decider()');assert.match(d.title,/Counterattack/);
  i=d.labels.findIndex(x=>/Activate E2/.test(x));assert.ok(i>=0);m.apply({t:'modal',s:'ai',i});
  m.apply({t:'pick',s:'ai',ix:[0]});
  assert.equal(e.run('G._counterFrame.stage'),'attacker');
  assert.equal(e.run('G[aw].hand.length'),6,'Phantom waits while counterattack interrupts Casualties');
  m.apply({t:'zone',s:'ai',o:'ai',z:'rank'});m.apply({t:'zone',s:'ai',o:'player',z:'rank'});
  for(let k=0;k<60;k++){
    d=e.run('__M.decider()');if(d.kind!=='modal')break;pass(m);
  }
  assert.equal(e.run('!!G._counterFrame||window._RUcbusy||window._RUcq.length>0'),false);
  const n=e.run('Math.min(Math.max(0,G[dw].cas),6)');
  assert.equal(d.kind,'pick');assert.equal(e.run('PCK.max'),n);
  m.apply({t:'pick',s:'ai',ix:Array.from({length:n},(_,i)=>i)});
  assert.equal(e.run('G[aw].hand.length'),6-n);assert.equal(e.run('ruSettlePending()'),0);
  assert.equal(e.errors.length,0,e.errors.join('\n'));
}
console.log('PASS Phantom 0 waits for an interrupting Counterattack and the restored Casualty queue');
