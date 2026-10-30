'use strict';
// Isolated runtime payment steps and explicit skill/effect fixtures, not natural matches.
const assert=require('node:assert/strict');
const {fixture}=require('./reported-effects-regressions');
const seedEngine=require('./engine').createEngine({seed:1});
const definitions=JSON.parse(seedEngine.run(`JSON.stringify((function(){
  const out=[];
  for(const [table,defs]of [['SDEFS',SDEFS],['ACDEFS',ACDEFS]])for(const [name,def]of Object.entries(defs))
    (def.steps||[]).forEach((step,index)=>{if(ruDeadzoneShellStep(step))out.push({table,name,index,count:step.max||step.count||step.min||1});});
  return out;
})())`));
function pickAll(m){
  const e=m.eng,d=e.run('__M.decider()');
  assert.equal(d.kind,'pick',JSON.stringify(d));
  const ix=Array.from({length:e.run('PCK.max')},(_,i)=>i);
  m.apply({t:'pick',s:d.seat,ix});
}
function confirmUse(m){
  const d=m.eng.run('__M.decider()');
  if(d.kind==='modal'&&/^Use:/.test(d.title))m.apply({t:'modal',s:d.seat,i:d.labels.findIndex(s=>/^Confirm/.test(s))});
}
let count=0;
for(const mode of ['standard','tag2v2','team2v2']){
  const seats=mode==='standard'?['player','ai']:['player','ai2','ai3','ai'];
  for(const seat of seats)for(const cc of [0,-6])for(const row of definitions){
    const m=fixture(mode,seat),e=m.eng;
    e.ctx.row=row;
    e.run(`G['${seat}'].cas=${cc};
      var step=(row.table==='SDEFS'?SDEFS:ACDEFS)[row.name].steps[row.index];
      window.paymentContext={handPicks:[],bankPicks:[],deadPicks:[],discPicks:[],deckPicks:[],milledCards:[]};
      SF={who:'${seat}',fieldZone:'rank',card:G['${seat}'].rankZone,stepIdx:0,ctx:paymentContext,
        def:{steps:[step,{type:'effect',fn:function(){G._shellResolved=true;SF=null;}}]}};
      runStep();`);
    assert.equal(e.run('__M.decider().seat'),seat,row.name+' picker belongs to its payer');
    assert.equal(e.run('PCK.pool.every(c=>c.type==="shell")'),true,row.name+' offers Shells');
    pickAll(m);
    assert.equal(e.run('!!G._shellResolved'),true,row.name+' continues after Shell payment');
    assert.equal(e.run(`G['${seat}'].cas`),Math.max(-7,cc-row.count),row.name+' counter and floor');
    assert.equal(e.run(`(G.sideOrder||[]).every(s=>['hand','deck','discard','deadzone','bank'].every(z=>!(G[s][z]||[]).some(c=>c.type==='shell')))`),true,'Shells never become physical cards');
    count++;
  }
}
console.log('PASS generic runtime Shell steps: '+count+' cases; '+definitions.map(x=>x.name).join(', '));
for(const seat of ['player','ai']){
  {
    const m=fixture('standard',seat),e=m.eng;
    e.run(`G['${seat}'].cas=-3;window.recovered=null;takeFromDeadzone('${seat}',1,'Recover E1','hand',function(cards){recovered=cards;});`);
    assert.equal(e.run('recovered.length'),0,'generic recovery needs a physical card, not a Shell');
    assert.equal(e.run(`G['${seat}'].cas`),-3,'empty Recover E1 does not lower the counter');
    assert.notEqual(e.run('__M.decider().kind'),'pick');
  }
  {
    const m=fixture('standard',seat,'restorative'),e=m.eng;
    e.run(`window.halcyon=mkAct('Halcyon Star');G['${seat}'].hand=[halcyon];G['${seat}'].cas=-6;`);
    m.apply({t:'playAction',s:seat,id:e.run('halcyon.id')});
    confirmUse(m);
    assert.equal(e.run(`G['${seat}'].hand.includes(halcyon)`),true,'Halcyon Star cannot activate without three real Restorative Numerals');
    assert.equal(e.run(`G['${seat}'].actUsed`),0,'an unpayable typed cost consumes no Action slot');
  }
  {
    const m=fixture('standard',seat,'temporal'),e=m.eng;
    e.run(`G['${seat}'].cas=-6;window.temporalSeven=buildDeck('temporal').find(c=>c.name==='Temporal 7');`);
    assert.equal(e.run(`SDEFS['Temporal 7'].check('${seat}',temporalSeven)`),false,'Temporal 7 still needs its actual qualifying cards');
    assert.notEqual(e.run('__M.decider().kind'),'pick','no Shell can replace Temporal 7 requirements');
  }
  for(const name of ['Fission 7','Halcyon Star','Track Star']){
    const m=fixture('standard',seat),e=m.eng;
    const table=name==='Fission 7'?'SDEFS':'ACDEFS';
    e.run(`window.strictStep=${table}[${JSON.stringify(name)}].steps.find(s=>s.type==='pick_deadzone');
      window.strictResult=ruCostUnpayable('${seat}',G['${seat}'].rankZone,[strictStep]);`);
    assert.match(e.run('strictResult'),/eligible cards in the Deadzone/,'a Shell cannot impersonate a required class/type');
  }
  {
    const m=fixture('standard',seat),e=m.eng;
    e.run(`G['${seat}'].cas=-7;window.atFloor=false;
      dzPickWithShells('${seat}','Floor',[],2,function(){throw Error('No physical cost expected');},function(){atFloor=true;});`);
    assert.equal(e.run('atFloor'),true);assert.equal(e.run(`G['${seat}'].cas`),-7);
  }
  {
    const m=fixture('standard',seat,'7th'),e=m.eng;
    e.run(`var p=G['${seat}'];window.purify=buildDeck('7th').find(c=>/Purify/.test(c.name));p.rankZone=purify;
      p.hand=[mkNum(CLASSLESS[4],'classless')];p.bank=[mkNum(CLASSLESS[3],'classless')];
      SDEFS[purify.name].steps[0].fn('${seat}',p,G[oppOf('${seat}')],'rank',purify,{},G);`);
    pickAll(m);pickAll(m);
    assert.equal(e.run('PCK.pool[0].type'),'shell','Purify offers a Shell after valid NP payment');
    pickAll(m);assert.equal(e.run(`G['${seat}'].cas`),-1);
    assert.equal(e.run(`!!G._noAttack['${seat}']`),true,'Purify resolves rather than cancelling');
  }
  {
    const m=fixture('standard',seat,'celestial'),e=m.eng;
    e.run(`var p=G['${seat}'];window.orch=mkAct('Neo Orchestral Star');p.hand=[orch];p.discard=[mkAct('Repair')];`);
    assert.equal(e.run(`ACDEFS['Neo Orchestral Star'].check('${seat}',orch)`),true,'real Drop return cost can be paid with no Deadzone cards');
    e.run(`G['${seat}'].discard=[];`);
    assert.equal(e.run(`ACDEFS['Neo Orchestral Star'].check('${seat}',orch)`),false,'a Shell cannot pay the separate real Drop return requirement');
  }
}
console.log('PASS typed-cost exclusions, -7 floor, Purify resolution and Neo Orchestral prerequisites');

function startFlow(e,seat,steps,card){
  e.ctx.flowSteps=steps;e.ctx.flowCard=card;
  e.run(`window.flowContext={handPicks:[],bankPicks:[],deadPicks:[],discPicks:[],deckPicks:[],milledCards:[]};
    SF={who:'${seat}',fieldZone:'rank',card:flowCard||G['${seat}'].rankZone,stepIdx:0,ctx:flowContext,def:{steps:flowSteps}};runStep();`);
}
{
  const m=fixture(),e=m.eng;
  e.run(`window.high=mkNum({n:7,r:3,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');G.player.deadzone=[high];G.player.cas=1;
    window.mixedSteps=[{type:'pick_deadzone',count:2,min:2,to:'discard',label:'Mixed payment'},{type:'effect',fn:function(){G.mixedDone=true;SF=null;}}];`);
  startFlow(e,'player',e.run('mixedSteps'));
  assert.equal(e.run('PCK.pool.some(c=>c.type==="shell")'),true);
  pickAll(m);
  assert.equal(e.run('!!G.mixedDone'),false,'payment waits for the Rank 3 destination decision');
  const d=e.run('__M.decider()');assert.equal(d.kind,'modal');
  m.apply({t:'modal',s:'player',i:d.labels.findIndex(s=>/Return to Hand/.test(s))});
  assert.equal(e.run('G.mixedDone&&G.player.hand.includes(high)'),true);
  assert.equal(e.run('G.player.cas'),-1);
}
{
  const m=fixture(),e=m.eng;
  e.run(`window.low=mkArea('negative');G.player.deadzone=[low];G.player.cas=1;takeFromDeadzone('player',1,'Protected Area test','discard');`);
  assert.equal(e.run('low.name'),'The Lowlands');
  assert.equal(e.run('PCK.pool.length===1&&PCK.pool[0].type==="shell"'),true);
  pickAll(m);assert.equal(e.run('G.player.deadzone.includes(low)'),true);
}
for(const take of [false,true]){
  const m=fixture(),e=m.eng;
  e.run(`window.optionalSteps=[{type:'pick_deadzone',count:2,max:2,min:1,optional:true,to:'discard',label:'Optional Shells'},
    {type:'effect',fn:function(){G.optionalDone=true;SF=null;}}];`);
  startFlow(e,'player',e.run('optionalSteps'));
  assert.equal(e.run('PCK.opt'),true);
  m.apply({t:'pick',s:'player',ix:take?[0,1]:[]});
  assert.equal(e.run('G.optionalDone'),true);assert.equal(e.run('G.player.cas'),take?-2:0);
}
for(const mode of ['standard','tag2v2','team2v2']){
  const seats=mode==='standard'?['player','ai']:['player','ai2','ai3','ai'];
  for(const seat of seats)for(const cls of ['light','restorative']){
    const m=fixture(mode,seat,cls),e=m.eng;
    e.run(`var p=G['${seat}'];window.seven=buildDeck('${cls}').find(c=>c.name==='${cls==='light'?'Light 7':'Restorative 7'}');
      p.rankZone=seven;p.hand=[mkNum(CLASSLESS[4],'classless')];p.bank=[mkNum(CLASSLESS[3],'classless')];`);
    startFlow(e,seat,e.run('SDEFS[seven.name].steps'),e.run('seven'));
    let steps=0;
    while(e.run('__M.decider().kind')==='pick'&&steps++<12)pickAll(m);
    assert.ok(steps<12,'full skill finishes its payment sequence');
    assert.equal(e.run('SF===null'),true,cls+' 7 finishes');
    assert.equal(e.run(`G['${seat}'].cas`),-2);
    assert.equal(e.run(`G[oppOf('${seat}')].cas`),-1,'the other player/team also drops a Shell');
  }
}
for(const seat of ['player','ai']){
  const m=fixture('standard',seat,'blizzard'),e=m.eng;
  e.run(`window.dropTarget=oppOf('${seat}');G._ru157Blizzard6Drop=dropTarget;beginPhase('end');`);e.settle(10000);
  assert.equal(e.run('__M.decider().seat'),e.run('dropTarget'));
  assert.equal(e.run('PCK.pool[0].type'),'shell','Blizzard 6 end-turn drop offers a Shell');
  pickAll(m);assert.equal(e.run('G[dropTarget].cas'),-1);
}
console.log('PASS mixed Rank 3/Shell ordering, protected Area, optional Shells, full Light/Restorative 7 flows and Blizzard 6 End Phase');

for(const seat of ['player','ai']){
  {
    const m=fixture('standard',seat,'7th'),e=m.eng;
    e.run(`var p=G['${seat}'];window.asc=buildDeck('7th').find(c=>/Ascendant/.test(c.name));
      window.copyPurify=buildDeck('7th').find(c=>/Purify/.test(c.name));p.rankZone=asc;p.bank=[copyPurify];
      asc._copySkillFreeCost=true;ruOwnPrompt('${seat}');
      SDEFS[asc.name].skill1.steps[0].fn('${seat}',p,G[oppOf('${seat}')],'rank',asc,{},G);`);
    const d=e.run('__M.decider()');assert.equal(d.kind,'modal');
    m.apply({t:'modal',s:seat,i:d.labels.findIndex(s=>/Copy .*Purify/.test(s))});
    assert.equal(e.run('PCK.pool[0].type'),'shell','copied Purify still resolves its generic removal');
    pickAll(m);assert.equal(e.run(`G['${seat}'].cas`),-1);
    assert.equal(e.run(`G['${seat}'].bank.includes(copyPurify)`),true,'free copy does not pay the waived source cost');
  }
  {
    const m=fixture('standard',seat,'celestial'),e=m.eng;
    e.run(`window.orch=mkAct('Neo Orchestral Star');G['${seat}'].hand=[orch];G['${seat}'].discard=[mkAct('Repair')];`);
    m.apply({t:'playAction',s:seat,id:e.run('orch.id')});
    confirmUse(m);
    assert.equal(e.run('__M.decider().kind'),'pick','Neo Orchestral activates with no real Deadzone cards');
    assert.equal(e.run('PCK.pool[0].type'),'shell');
    pickAll(m);
    assert.equal(e.run('PCK.pool.some(c=>c.name==="Repair")'),true,'the separate Drop return still chooses a real card');
    assert.equal(e.run('PCK.pool.some(c=>c.type==="shell")'),false);
  }
}
console.log('PASS Ascendant copied Purify and actual Neo Orchestral activation, both seats');

for(const mode of ['standard','tag2v2','team2v2']){
  for(const seat of mode==='standard'?['player','ai']:['player','ai2','ai3','ai']){
    const m=fixture(mode,seat),e=m.eng;
    e.run(`window.cease=mkAct('Cease');G['${seat}'].deadzone=[cease];G['${seat}'].cas=1;ruOwnPrompt('${seat}');applyE2('${seat}',cease);`);
    assert.equal(e.run('PCK.pool.length===1&&PCK.pool[0].type==="shell"'),true,'Cease pays with a Shell when it is the only Deadzone card');
    pickAll(m);assert.equal(e.run(`G['${seat}'].cas`),-1);
    assert.equal(e.run(`!!G._casDrawPrevented['${seat}']`),true);
  }
}
for(const seat of ['player','ai']){
  const m=fixture('standard',seat,'deckstructive'),e=m.eng;
  e.run(`window.returnCard=mkAct('Return');G['${seat}'].deadzone=[returnCard];G['${seat}'].cas=1;
    G['${seat}'].hand=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless')];
    ruOwnPrompt('${seat}');applyE2('${seat}',returnCard);`);
  for(let i=0;i<6&&e.run('__M.decider().kind')==='pick';i++){
    assert.equal(e.run('PCK.pool.some(c=>c.type==="shell")'),false,'Return shuffles physical cards only');
    pickAll(m);
  }
  assert.equal(e.run(`G['${seat}'].cas`),0,'Return does not create a negative Deadzone by shuffling Shells');
}
console.log('PASS Cease only-card Shell payments and real-card-only Return E2');

for(const seat of ['player','ai'])for(const cls of require('./classes')()){
  const m=fixture('standard',seat,cls),e=m.eng;
  e.run(`window.repair=mkAct('Repair');G['${seat}'].hand=[repair];G['${seat}'].cas=-3;`);
  m.apply({t:'playAction',s:seat,id:e.run('repair.id')});confirmUse(m);
  assert.equal(e.run('PCK.pool.length===1&&PCK.pool[0].type==="shell"'),true,cls+' Repair E1 offers a Shell');
  pickAll(m);assert.equal(e.run(`G['${seat}'].cas`),-4);
}
console.log('PASS Repair E1 Shell payment for every class and both standard seats');

for(const seat of ['player','ai']){
  const m=fixture('standard',seat,'astute'),e=m.eng;
  e.run(`var p=G['${seat}'];window.astute=buildDeck('astute').find(c=>c.name==='Astute 7');p.rankZone=astute;
    p.hand=[mkNum(CLASSLESS[4],'classless')];p.bank=[mkNum(CLASSLESS[3],'classless')];
    G[oppOf('${seat}')].hand=[mkAct('Repair'),mkAct('Protect')];`);
  startFlow(e,seat,e.run('SDEFS[astute.name].steps'),e.run('astute'));
  pickAll(m);pickAll(m);pickAll(m);
  assert.equal(e.run('PCK.max'),0,'a Rank-zero Shell grants zero opponent hand drops');
  assert.equal(e.run('PCK.pool.length'),2,'the required hand reveal is still shown');
  m.apply({t:'pick',s:seat,ix:[]});
  assert.equal(e.run(`G[oppOf('${seat}')].hand.length`),2);
}
console.log('PASS Shell Rank zero does not grant Astute 7 an extra discard');
