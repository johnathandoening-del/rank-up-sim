'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('./reported-effects-regressions');
const classes=require('./classes')();
let count=0;
for(const mode of ['standard','tag2v2','team2v2']){
  const seats=mode==='standard'?['player','ai']:['player','ai2','ai3','ai'];
  for(const seat of seats)for(const cls of classes){
    const m=fixture(mode,seat,cls),e=m.eng;
    e.run(`window.recover=mkAct('Recover');G['${seat}'].deadzone=[recover];G['${seat}'].cas=1;
      ruOwnPrompt('${seat}');applyE2('${seat}',recover);`);
    e.settle(10000);
    const d=e.run('__M.decider()');
    assert.equal(d.kind,'pick',mode+' '+seat+' '+cls+' must offer the sole Recover');
    assert.equal(d.seat,seat,'the activating player owns the choice');
    assert.equal(e.run('PCK.pool.length'),1);
    assert.equal(e.run('PCK.pool[0]===recover'),true);
    assert.equal(e.run(`G['${seat}'].discard.includes(recover)`),true,'Recover drops before selection');
    m.apply({t:'pick',s:seat,ix:[0]});
    assert.equal(e.run(`G['${seat}'].hand.includes(recover)`),true,'Recover can recover itself');
    assert.equal(e.run(`G['${seat}'].discard.includes(recover)||G['${seat}'].deadzone.includes(recover)`),false);
    count++;
  }
}
console.log('PASS Recover E2 empty-zone self-recovery: '+count+' class/seat/mode cases');
for(const mode of ['standard','tag2v2','team2v2']){
  const seats=mode==='standard'?['player','ai']:['player','ai2','ai3','ai'];
  for(const seat of seats)for(const cls of ['restorative','shadow'])for(const self of [false,true]){
    const m=fixture(mode,seat,cls),e=m.eng;
    e.run(`window.recover=mkAct('Recover');window.cost=mkNum(CLASSLESS[1],'classless');
      window.other=mkAct('Repair');G['${seat}'].discard=[mkAct('Protect'),other];
      G['${seat}'].deadzone=[recover,cost];G['${seat}'].cas=2;
      ruOwnPrompt('${seat}');applyE2('${seat}',recover);`);
    e.settle(10000);
    assert.equal(e.run('__M.decider().kind'),'pick');
    assert.equal(e.run('PCK.pool.includes(cost)'),true,'Deadzone payment remains an owner choice');
    m.apply({t:'pick',s:seat,ix:[e.run('PCK.pool.indexOf(cost)')]});
    assert.equal(e.run('__M.decider().kind'),'pick');
    assert.equal(e.run('PCK.pool.includes(recover)'),true,'Recover stays eligible when other Drop cards exist');
    const index=e.run('PCK.pool.indexOf('+(self?'recover':'other')+')');
    m.apply({t:'pick',s:seat,ix:[index]});
    assert.equal(e.run(`G['${seat}'].hand.includes(${self?'recover':'other'})`),true);
  }
}
for(const cls of ['restorative','shadow']){
  const m=fixture('standard','player',cls),e=m.eng;
  e.run(`window.recover=mkAct('Recover');G.player.deck.unshift(recover,mkNum(CLASSLESS[1],'classless'));
    casDraw('player');casDraw('player');`);e.settle(10000);
  const d=e.run('__M.decider()'),i=d.labels.findIndex(x=>/Activate E2 Effect/.test(x));
  assert.ok(i>=0,'Casualty Draw offers Recover E2');
  m.apply({t:'modal',s:'player',i});
  assert.equal(e.run('__M.decider().kind'),'pick');
  assert.equal(e.run('PCK.pool[0]===recover'),true);
  m.apply({t:'pick',s:'player',ix:[0]});
  assert.equal(e.run('G.player.hand.includes(recover)'),true);
  const next=e.run('__M.decider()');
  assert.match(next.title,/Casualty Draw: Numeral 1/,'remaining draw reaches its normal Continue prompt');
  m.apply({t:'modal',s:'player',i:0});
  assert.equal(e.run('G.player.cas'),0,'remaining draw resolves after the empty Deadzone cost');
  assert.equal(e.run('G.player.discard.some(c=>c.name==="Numeral 1")'),true,'Casualty at CC zero resolves to Drop');
  assert.equal(e.run('!!window._RUcbusy||(window._RUcq||[]).length>0'),false,'casualty queue finishes');
}
console.log('PASS Recover E2 paid costs, chosen non-first Drop cards, and casualty continuation');
