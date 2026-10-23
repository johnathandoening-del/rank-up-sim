'use strict';
// Controlled shared-input fixtures, not natural-play match evidence.
const assert=require('node:assert/strict');
const {pair}=require('./kismet-online');
let passed=0;
function setup(w){
  const p=pair(w,{player:'light',ai:'light'}),other=w==='player'?'ai':'player';
  p.run(`
    G.turn='${other}';G.phase='battle';G._attackDeclarations=[];G._pendingAttackDeclaration=null;
    var me=G['${w}'],foe=G['${other}'];
    for(var s of ['player','ai']){
      var q=G[s];q.hand=[];q.bank=[];q.discard=[];q.deadzone=[];q.cas=0;q.mp=100;q.actUsed=0;q.attacksUsed={};
      q.leftFlank=q.rightFlank=q.rearFlank=null;q.delta=[];q._firstDrawDone=true;
      q.rankZone=mkNum({n:5,r:1,A:3,M:0,S:null,ca:true,st:'Basic'},'classless');
      q.deck=Array.from({length:40},()=>mkNum({n:1,r:0,A:1,M:0,S:null,ca:true,st:'Basic'},'classless'));
    }
    ruFieldWatch();
  `);
  return p;
}
function pass(p){
  for(let i=0;i<40;i++){
    const d=p.pending();if(d.kind!=='modal')return;
    const label=d.labels.find(x=>x.startsWith('Pass')||x.startsWith('Decline')||['Continue','Cancel'].includes(x));
    assert.ok(label,JSON.stringify(d));p.button(label);
  }
  throw Error('response loop');
}
function ok(p,label){
  for(const e of p.engines)assert.deepEqual(e.errors,[]);
  assert.equal(p.engines[0].run('ruStateSig()'),p.engines[1].run('ruStateSig()'),label+' seat parity');
  passed++;
}
for(const w of ['player','ai']){
  const other=w==='player'?'ai':'player';
  const operations=[
    ['draw',`draw('${w}',3)`,'hand'],
    ['mill',`mill('${w}',3)`,'discard'],
    ['cede',`acDropTop('${w}',3,'deadzone')`,'deadzone'],
    ['bottom mill',`acDropBottom('${w}',3)`,'discard'],
    ['Deckstructive helper',`deckDropTopRAtk15('${w}',3,false)`,'discard'],
    ['Action helper',`dropTopRAE19('${w}',3,'discard')`,'discard'],
    ['Numeral helper',`millN('${w}',3,'discard')`,'discard'],
    ['Area helper',`dropTopRD1('${w}',3)`,'discard']
  ];
  for(const [label,operation,dest]of operations)for(const available of [0,2,3]){
    const p=setup(w);
    p.run(`me.deck=me.deck.slice(0,${available});${operation};`);
    assert.equal(p.run(`me.${dest}.length`),available,label+' transfers available cards');
    assert.equal(p.run('G.gameOver'),available<3,label+' shortage, not exact depletion');
    if(available<3)assert.equal(p.run('G.__winner'),other,label+' loser is owner of empty Deck');
    ok(p,`${w} ${label} ${available}/3`);
  }
  {
    const p=setup(w);p.run(`me.deck=me.deck.slice(0,2);draw('${w}',2);`);
    assert.equal(p.run('G.gameOver'),false);
    p.run(`G.turn='${w}';G._skipStartDraw={${w}:true};beginPhase('draw');`);
    assert.equal(p.run('G.gameOver'),true,'start of next turn loses even when normal draw skipped');
    ok(p,w+' exact depletion next-turn loss');
  }
  {
    const p=setup(w);p.run(`me.deck=[];me.discard=[mkAct('Repair')];foe.deadzone=[mkArea('negative')];draw('${w}',1);`);
    assert.equal(p.run('G.gameOver'),false,'Lowlands replacement applies before failure');
    assert.equal(p.run('me.hand[0].name'),'Repair');ok(p,w+' Lowlands');
  }
  {
    const p=setup(w);p.run(`me.rankZone.currentNP=0;me.rankZone.currentRP=0;buffNP(me.rankZone,-3);buffRP(me.rankZone,-2);`);
    assert.equal(p.run('npOf(me.rankZone)'),-3);assert.equal(p.run('effRank(me.rankZone)'),-2);
    p.run('buffNP(me.rankZone,3);buffRP(me.rankZone,2);buffNP(me.rankZone,-1);buffRP(me.rankZone,-1);');
    assert.equal(p.run('npOf(me.rankZone)'),-1);assert.equal(p.run('effRank(me.rankZone)'),-1);
    ok(p,w+' zero and signed stats');
  }
  {
    const p=setup(w);p.run(`foe.rankZone.currentNP=1;foe.rankZone.currentRP=0;SDEFS['Negative 7'].steps.at(-1).fn('${w}',me,foe);`);
    assert.equal(p.run('npOf(foe.rankZone)'),-2);assert.equal(p.run('effRank(foe.rankZone)'),-1);
    ok(p,w+' Negative 7 actual effect');
  }
  for(const used of [0,1]){
    const p=setup(w);p.run(`
      foe.rankZone.A=1;foe.actUsed=${used};foe.hand=[mkAct('Cease')];
      me.rankZone.attacksLeft=0;me.attacksUsed[me.rankZone.id]=true;
      ruWithActor('${w}',()=>doCounterAttack(0));
    `);
    if(!used){assert.equal(p.pending().owner,other);p.button('Use Cease');}
    pass(p);
    assert.equal(p.run('G._attackDeclarations.length'),1,'exactly one immediate counterattack');
    assert.equal(p.run('me.rankZone.attacksLeft'),0,'no free normal attacks');
    assert.equal(p.run('foe.actUsed'),1,'defending on own turn shares existing A budget');
    assert.equal(p.run('foe.hand.length'),used,'no second Action permitted at A:1');
    ok(p,w+' counterattack Safeguard budget '+used);
  }
  {
    const p=setup(w);p.run(`foe.hand=[mkAct('Subtract'),mkAct('Plus')];me.rankZone.currentNP=8;ruWithActor('${w}',()=>doCounterAttack(0));`);
    while(p.pending().labels&&p.pending().labels.includes('Continue'))p.button('Continue');
    assert.equal(p.pending().owner,other);p.button('Use Subtract');p.pick([0]);pass(p);
    assert.equal(p.run('foe.actUsed'),1);assert.equal(p.run("foe.discard.some(c=>c.name==='Subtract')"),true);
    ok(p,w+' own-turn Retaliatory response');
  }
  for(const normalLeft of [0,1]){
    const p=setup(w);p.run(`me.rankZone.attacksLeft=${normalLeft};me.attacksUsed[me.rankZone.id]=true;
      markOpponentTurnAttackRAtk25('${w}',me.rankZone,{count:1});
    `);
    assert.equal(p.run('me.rankZone.attacksLeft'),normalLeft,'grant does not touch own-turn balance');
    assert.equal(p.run('eligibleHasteAttackers164().length'),1,'grant usable after normal attacks spent');
    p.run('openHasteAttackWindow("battle")');p.button('->');pass(p);
    assert.equal(p.run('ruOppTurnAtkLeft(me.rankZone)'),0,'grant spent exactly once');
    assert.equal(p.run('eligibleHasteAttackers164().length'),0);
    assert.equal(p.run('me.rankZone.attacksLeft'),normalLeft);
    ok(p,w+' off-turn grant '+normalLeft);
  }
  {
    const p=setup(w);p.run(`me.rankZone.attacksLeft=0;me.rankZone.canAttack=false;me.attacksUsed[me.rankZone.id]=true;
      grantRankAttackRAE21('${w}','Fixture grant');`);
    p.button('Attack ');pass(p);
    assert.equal(p.run('G._attackDeclarations.length'),1);assert.equal(p.run('me.rankZone.attacksLeft'),0);
    assert.equal(p.run('G._counterAtkQ.length'),0);ok(p,w+' queued grant after exhaustion');
  }
  {
    const p=setup(w);p.run(`G.turn='${w}';G.phase='main';me.hand=[mkNum(ND.deckstructive.find(c=>c.n===3),'deckstructive')];foe.deck=foe.deck.slice(0,2);ruFieldWatch();`);
    p.apply({t:'startSkill',s:w,source:'hand',id:p.run('me.hand[0].id')});p.button('Activate Skill');
    assert.equal(p.run('G.gameOver'),true);assert.equal(p.run('foe.discard.length'),2);
    assert.equal(p.run('G.__winner'),w);assert.equal(p.run('!!SF'),false);
    ok(p,w+' Deckstructive 3 actual skill input');
  }
  for(const active of [false,true]){
    const p=setup(w);p.run(`G.turn='${w}';G.phase='promotion';me.rankZone=mkNum(ND.haste[0],'haste');me.hand=[mkNum(ND.haste[2],'haste')];
      me.deadzone=${active?"[mkArea('haste')]":'[]'};ruFieldWatch();ruWithActor('${w}',()=>tryPromote(me.hand[0]));`);
    assert.equal(p.run("document.getElementById('log').textContent.includes('Fast Track: Haste Rank Up is eligible')"),active);
    ok(p,w+' Fast Track presence '+active);
  }
  {
    const p=setup(w);p.run(`me.rankZone.A=foe.rankZone.A=1;me.actUsed=foe.actUsed=1;beginPhase('main');beginPhase('battle');`);pass(p);
    assert.equal(p.run('me.actUsed'),1);assert.equal(p.run('foe.actUsed'),1,'phase changes preserve both budgets');
    p.run(`G._turnNo++;G.turn='${w}';beginPhase('draw');`);pass(p);
    assert.equal(p.run('me.actUsed'),0);assert.equal(p.run('foe.actUsed'),0,'new turn resets both budgets');
    ok(p,w+' per-turn Action budgets');
  }
  {
    const p=setup(w);p.run(`me.deck=me.deck.slice(0,2);casDraw('${w}');casDraw('${w}');casDraw('${w}');`);pass(p);
    assert.equal(p.run('G.gameOver'),true);assert.equal(p.run('me.deadzone.length'),2);
    ok(p,w+' required Casualty draw shortage');
  }
  {
    const p=setup(w);p.run(`me.deck=[];G._casDrawsNegated=true;casDraw('${w}');`);pass(p);
    assert.equal(p.run('G.gameOver'),false);ok(p,w+' prevented Casualty does not draw');
  }
  {
    const p=setup(w);p.run(`me.rankZone=mkNum(ND.kismet[8],'kismet');me.hand=[mkAct('Plus')];`);
    assert.equal(p.run(`SDEFS['Kismet 8'].check('${w}',me.rankZone)`),false);
    p.run(`G.turn='${w}'`);assert.equal(p.run(`SDEFS['Kismet 8'].check('${w}',me.rankZone)`),true);
    ok(p,w+' Kismet 8 owner only');
  }
}
for(const count of [3,4]){
  const {createEngine}=require('./engine'),{MATCH_CODE}=require('../../ai/match');
  const e=createEngine({seed:411});e.run(MATCH_CODE);
  const order=['player','ai','ai2','ai3'].slice(0,count);
  e.run(`__H.start({seed:411,mySeat:0,mode:'${count===3?'1v1v1':'royale4'}',order:${JSON.stringify(order)},classes:{player:'light',ai:'light',ai2:'light',ai3:'light'},seat0Class:'light',seat1Class:'light'});`);
  e.settle(800);
  e.run("closeModal();_modalQueue.length=0;SF=null;PCK=null;ruSettleReset();G.turn='player';G.player.deck=[];draw('player',1);");e.settle(100);
  assert.equal(e.run('G.eliminated.player'),true);assert.equal(e.run('G.gameOver'),false);
  assert.notEqual(e.run('G.turn'),'player','eliminated turn cannot stall a multiplayer game');
  assert.deepEqual(e.errors,[]);passed++;
}
console.log('PASS',passed,'Deck exhaustion, signed stats, counterattack and timing fixtures across P1/P2 and multiplayer elimination');
