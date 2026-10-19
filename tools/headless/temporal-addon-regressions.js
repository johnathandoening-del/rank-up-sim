'use strict';
// Controlled two-human-seat fixtures, not natural-play match evidence.
const assert=require('node:assert/strict');
const {pair,REPORT}=require('./kismet-online');

function clearPrompts(p){
  for(let i=0;i<60;i++){
    const d=p.pending();if(d.kind!=='modal')return;
    const label=d.labels.find(x=>['Continue','Decline','Pass','Skip Effect'].includes(x));
    assert.ok(label,'Unexpected decision '+JSON.stringify(d));p.button(label);
  }
  throw Error('Unsettled prompts');
}
function attack(p,w,zone,other,target,addon){
  p.apply({t:'atkMode',s:w});
  p.apply(zone==='delta'?{t:'delta',s:w,w:w}:{t:'zone',s:w,o:w,z:zone});
  if(addon)p.apply(addon==='delta'?{t:'delta',s:w,w:w}:{t:'zone',s:w,o:w,z:addon});
  p.apply(target==='delta'?{t:'delta',s:w,w:other}:{t:'zone',s:w,o:other,z:target});
}
function addonTests(){
  for(const w of ['player','ai'])for(const variant of ['rank-2','rank-3','delta-2','delta-3','delta-source','free-addon']){
    const other=w==='player'?'ai':'player',p=pair(w,{player:'light',ai:'light'});
    const grants=variant.endsWith('-3')?2:1,target=variant.startsWith('delta-')&&variant!=='delta-source'?'delta':'rank';
    const source=variant==='delta-source'?'delta':'left-flank',free=variant==='free-addon';
    p.run(`
      var me=G.${w},foe=G.${other};G.turn='${w}';G.phase='main';G.allowEvolutions=true;
      me.rankZone=mkNum({n:5,r:2,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');me.leftFlank=null;me.rightFlank=null;me.delta=[];
      foe.rankZone=mkNum({n:2,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');foe.hand=[];foe.leftFlank=null;foe.delta=[];
      if('${source}'==='delta')foe.rankZone=mkNum({n:1,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      var support=mkNum({n:3,r:0,A:0,M:0,S:null,ca:true,st:'Basic'},'classless');
      if('${source}'==='delta'){
        var d=RU_AMALGAMATIONS.find(c=>c.id==='amalg-benevolent-2');
        support=Object.assign({},d,{id:uid(),baseId:d.id,type:'evolution',evoType:'amalgamation',class:'amalgamation',currentNP:2,currentRP:2,attacksLeft:1,canAttack:true,elements:[]});me.delta=[support];
      }else me.leftFlank=support;
      if(${free})support.attackAdditionally=true;
      if('${target}'==='delta'){
        var d=RU_AMALGAMATIONS.find(c=>c.id==='amalg-benevolent-2');
        foe.delta=[Object.assign({},d,{id:uid(),baseId:d.id,type:'evolution',evoType:'amalgamation',class:'amalgamation',currentNP:2,currentRP:2,attacksLeft:1,canAttack:true,elements:[]})];
      }
      me.hand=Array.from({length:${grants}},()=>mkAct('Encore Star'));me.bank=[];me.discard=[];
      me.deck=Array.from({length:40},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
      foe.deck=Array.from({length:40},()=>mkNum(ND.light.find(c=>c.n===4),'light'));ruFieldWatch();
    `);
    for(let i=0;i<grants;i++){
      p.apply({t:'playAction',s:w,id:p.run(`G.${w}.hand.find(c=>c.name==='Encore Star').id`)});p.button('Confirm');clearPrompts(p);
    }
    assert.equal(p.run(`atkLeft(support)`),1+grants,'real Encore activations grant extra attacks');
    p.run("beginPhase('battle')");attack(p,w,'rank',other,target,source);clearPrompts(p);
    const left=grants+(free?1:0);
    assert.equal(p.run('atkLeft(support)'),left,'Addon spends one attack, not the entire allowance');
    assert.equal(p.run(`!!G.${w}.attacksUsed[support.id]`),false,'remaining attacks stay selectable');
    attack(p,w,source,other,'rank');clearPrompts(p);
    assert.equal(p.run('atkLeft(support)'),left-1,'support can actually attack again');
    assert.equal(p.run(`!!G.${w}.attacksUsed[support.id]`),left===1,'exhaustion only at zero');
    p.finish(w+' Addon '+variant);console.log('PASS '+w+' Addon '+variant);
  }
}

function historicalTests(){
  for(const w of ['player','ai'])for(const encore of [false,true]){
    const other=w==='player'?'ai':'player',star=encore?'Encore Star':'Battle Star';
    const p=pair(w,{[w]:'temporal',[other]:'light'});
    p.run(`
      closeModal();ruSettleReset();G._tl=null;var me=G.${w},foe=G.${other};
      me.hand=[];me.bank=[];me.discard=[mkAct('${star}')];
      me.rankZone=mkNum({n:5,r:2,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');
      me.leftFlank=mkNum({n:3,r:0,A:0,M:0,S:null,ca:true,st:'Basic'},'classless');
      me.rightFlank=mkNum(ND.temporal.find(c=>c.n===4),'temporal');
      foe.rankZone=mkNum({n:2,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');foe.leftFlank=null;foe.rightFlank=null;foe.hand=[];foe.bank=[];foe.discard=[];
      me.deck=Array.from({length:50},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
      foe.deck=Array.from({length:50},()=>mkNum(ND.light.find(c=>c.n===4),'light'));
      if(${encore})for(var i=2;i<10;i++)foe.deck[i]=mkAct('Battle Star');else foe.deck[3]=mkAct('Battle Star');
      var changedCard=foe.deck[${encore?2:3}].id;
      me._firstDrawDone=true;foe._firstDrawDone=true;G.turn='${w}';G._turnNo=4;G.phase='standby';beginPhase('battle');
    `);
    if(!encore){attack(p,w,'left-flank',other,'rank');clearPrompts(p);}
    attack(p,w,'rank',other,'rank');clearPrompts(p);
    p.apply({t:'end',s:w});clearPrompts(p);
    if(p.pending().mode==='switchdraw')p.apply({t:'sdDone',s:other,first:false});
    assert.equal(p.run(`G.${other}.hand.some(c=>c.id===changedCard)`),true,'original future drew the card');
    p.apply({t:'end',s:other});clearPrompts(p);
    if(p.pending().mode==='switchdraw')p.apply({t:'sdDone',s:w,first:false});
    while(p.pending().kind==='turn'&&p.pending().phase!=='battle')p.apply({t:'adv',s:w});
    attack(p,w,'right-flank',other,'rank');p.button('Use Temporal 4');p.pick([0]);
    p.engines.forEach(e=>e.settle(10000));clearPrompts(p);
    assert.equal(p.run('!!G._tlReplay'),false,'amendment returns to the present without new attack choices');
    assert.equal(p.run('G._turnNo'),6);assert.equal(p.run(`G.${w}.mp`),37,'no M/E2 from extra Battle Star Casualties');
    assert.equal(p.run(`G.${other}.mp`),encore?16:21,'all changed historical and current damage actually applied');
    assert.equal(p.run(`G.${other}.cas`),encore?12:6,'actual additional Casualty draws, not counters only');
    assert.equal(p.run(`G.${other}.deadzone.some(c=>c.id===changedCard)`),true);
    assert.equal(p.run(`G.${other}.hand.some(c=>c.id===changedCard)`),false,'obsolete future hand card is absent');
    if(encore){
      const counts=Array.from(p.run(`['rank','left-flank','right-flank'].map(z=>G._battles.filter(b=>b.turn===4&&b.aWho==='${w}'&&b.aZone===z).length)`));
      assert.deepEqual(counts,[2,2,2],'all three eligible past Numerals attack twice');
      assert.equal(p.run(`G._battles.filter(b=>b.turn===4).every(b=>b.defId===G.${other}.rankZone.id)`),true,'no new target was chosen');
    }else{
      assert.equal(p.run(`G._battles.filter(b=>b.turn===4&&b.aZone==='left-flank').length`),1);
      assert.equal(p.run(`G._battles.find(b=>b.turn===4&&b.aZone==='left-flank').aNP`),3,'earlier attack in the same phase is unchanged');
      assert.equal(p.run(`G._battles.find(b=>b.turn===4&&b.aZone==='rank').aNP`),8);
      assert.equal(p.run(`G._battles.find(b=>b.turn===4&&b.aZone==='rank').aRP`),3);
    }
    p.run(`G.${other}.deck.unshift(mkAct('Protect'));casDraw('${other}');`);
    assert.equal(p.pending().owner,other);assert.ok(p.pending().labels.includes('Activate E2 Effect'),'ordinary present-day Casualty E2 still works');
    p.button('Skip Effect');clearPrompts(p);
    p.finish(w+' Temporal 4 '+star+' historical amendment');console.log('PASS '+w+' Temporal 4 '+star+' historical amendment');
  }
}
if(require.main===module){
  if(!process.argv.includes('--history-only'))addonTests();
  if(!process.argv.includes('--addons-only'))historicalTests();
  const fs=require('node:fs'),path=require('node:path');
  fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'data','online-regression.json'),JSON.stringify(REPORT,null,2));
}
