'use strict';
// Controlled two-human-seat fixtures, not natural-play matches.
const assert=require('node:assert/strict');
const {pair,REPORT}=require('./kismet-online');
const INVENTORY=`(function(){
  var rows=[],seen=new Set(),hosts=[];
  ['player','ai'].forEach(function(w){var p=G[w];
    ['rankZone','leftFlank','rightFlank','rearFlank'].forEach(function(k){var c=p[k];if(c&&!c._empty){rows.push([c.id,w,k,0]);seen.add(c.id);hosts.push([c,w]);}});
    ['delta','evolutions','hand','deck','discard','deadzone','bank'].forEach(function(k){(p[k]||[]).forEach(function(c,i){rows.push([c.id,w,k,i]);seen.add(c.id);hosts.push([c,w]);});});
  });
  for(var i=0;i<hosts.length;i++){var h=hosts[i];(h[0].elements||[]).forEach(function(c,j){rows.push([c.id,h[1],'element:'+h[0].id,j]);if(!seen.has(c.id)){seen.add(c.id);hosts.push([c,h[1]]);}});}
  return rows.sort(function(a,b){return a[0].localeCompare(b[0]);});
})()`;
const EVO=`function evo(n){var d=RU_AMALGAMATIONS.find(c=>c.id==='amalg-unknown-'+n);return Object.assign({},d,{id:uid(),baseId:d.id,type:'evolution',evoType:'amalgamation',class:'amalgamation',name:'Amalgamation '+n+' Skilled',currentNP:n,currentRP:d.rank,attacksLeft:1,canAttack:true,usedSkill:false,elements:[]});}`;
const NUM=`function num(n,r){return mkNum({n:n,r:r==null?1:r,A:2,M:0,S:null,ca:true,st:'Basic'},'classless');}`;
function clear(p){for(let i=0;i<40;i++){const d=p.pending();if(d.kind!=='modal')return;const b=d.labels.find(x=>['Continue','Decline','Pass','Skip Effect'].includes(x));if(!b)return;p.button(b);}throw Error('Repeated modal');}
function finish(p,label){
  const rows=p.run(INVENTORY);assert.equal(new Set(rows.map(r=>r[0])).size,rows.length,'each card has exactly one physical location');
  p.finish(label);const c=REPORT[REPORT.length-1];c.verify={code:INVENTORY,expected:p.run(INVENTORY)};
  assert.deepEqual(p.engines[0].errors,[]);assert.deepEqual(p.engines[1].errors,[]);console.log('PASS '+label);
}
function removeRift(p,w){
  p.run(`G.turn='${w}';G.phase='standby';beginPhase('main');G.${w}.actUsed=0;`);
  p.apply({t:'playAction',s:w,id:p.run('repair.id')});p.button('Confirm');
  const ix=p.run("PCK.pool.findIndex(c=>c.id===rift.id)");assert.ok(ix>=0);p.pick([ix]);
  assert.ok(p.pending().labels.includes('Turn back time'),'Rift removal offers its real effect');
  assert.equal(p.pending().owner,w);p.button('Turn back time');clear(p);
}
function riftTests(){
  for(const w of ['player','ai'])for(const variant of ['spent','formed','destroyed','replaced']){
    const other=w==='player'?'ai':'player',p=pair(w,{[w]:'temporal',[other]:'light'});
    p.run(`
      ${EVO}${NUM}
      var me=G.${w},foe=G.${other};G.allowEvolutions=true;G._hist=[];G._riftAt={};
      ['player','ai'].forEach(function(s){var q=G[s];q.hand=[];q.bank=[];q.discard=[];q.deadzone=[];q.cas=0;q.delta=[];q.evolutions=[];q.leftFlank=null;q.rightFlank=null;q.rearFlank=null;q._firstDrawDone=true;q.rankZone=num(5,2);q.deck=Array.from({length:40},()=>num(4));});
      var rift=mkArea('temporal'),repair=mkAct('Repair');me.hand=[rift,repair];
      var old=evo(5),stock=evo(5),enemy=evo(3);old.elements=[num(5),num(5),num(5)];enemy.elements=[num(3),num(3),num(3)];
      var oldIds=old.elements.map(c=>c.id),enemyIds=enemy.elements.map(c=>c.id);
      me.delta='${variant}'==='formed'?[]:[old];me.evolutions=[stock];foe.delta=[enemy];
      me.leftFlank=num(5,1);me.rightFlank=num(5,1);me.bank=[num(3,0)];
      G.turn='${w}';G._turnNo=4;G.phase='promotion';ruFieldWatch();beginPhase('draw');
      var initialRank=me.rankZone.id,initialLeft=me.leftFlank.id,initialRight=me.rightFlank.id;
    `);
    assert.equal(p.run(`ruTurnStart(4).at[stock.id]`),w+'|evolutions|0');
    if(variant!=='formed')assert.equal(p.run('ruTurnStart(4).at[oldIds[0]]'),w+'|element|'+p.run('old.id')+'|0');
    p.run("beginPhase('main')");p.apply({t:'activateArea',s:w,id:p.run('rift.id')});p.button('Send to Deadzone');clear(p);
    assert.equal(p.run(`!!G._riftAt[rift.id].at[stock.id]`),true);
    if(variant==='spent'){
      p.run(`spendElement('${w}',old,'discard',function(){});`);p.button('Numeral 5');
      p.run(`G.turn='${other}';spendElement('${other}',enemy,'discard',function(){});`);assert.equal(p.pending().owner,other);p.button('Numeral 3');
      assert.equal(p.run('old.elements.length'),2);assert.equal(p.run('enemy.elements.length'),2);
    }else if(variant==='destroyed'){
      p.run(`foe.rankZone=num(8,3);G.turn='${other}';G.phase='battle';G.mode='normal';renderAll();`);
      p.apply({t:'atkMode',s:other});p.apply({t:'zone',s:other,o:other,z:'rank'});p.apply({t:'delta',s:other,w:w});clear(p);
      assert.equal(p.run(`G.${w}.delta.length`),0);
      assert.equal(p.run(`G.${w}.deadzone.some(c=>c.id===old.id)`),true);
    }else{
      if(variant==='replaced'){p.apply({t:'sdMode',s:w});p.apply({t:'delta',s:w,w:w});}
      const ids=Array.from(p.run('[me.rankZone.id,me.leftFlank.id,me.rightFlank.id]'));
      p.apply({t:'amalgRank',s:w,evoId:p.run('stock.baseId'),evoCardId:p.run('stock.id'),elementIds:ids});
      assert.equal(p.run(`G.${w}.delta[0].id`),p.run('stock.id'));
    }
    removeRift(p,w);
    assert.equal(p.run(`G.${w}.delta.length`),variant==='formed'?0:1);
    assert.equal(p.run(`G.${w}.evolutions[0].id`),p.run('stock.id'));
    assert.equal(p.run('stock.elements.length'),0,'new Evolution loses the historical materials it did not have');
    if(variant!=='formed'){
      assert.equal(p.run(`G.${w}.delta[0].id`),p.run('old.id'));
      assert.deepEqual(Array.from(p.run('old.elements.map(c=>c.id)')),Array.from(p.run('oldIds')),'original Element identities/order restored');
    }
    assert.deepEqual(Array.from(p.run('enemy.elements.map(c=>c.id)')),Array.from(p.run('enemyIds')),'opponent Elements restored too');
    assert.deepEqual(Array.from(p.run('[me.rankZone.id,me.leftFlank.id,me.rightFlank.id]')),Array.from(p.run('[initialRank,initialLeft,initialRight]')));
    assert.equal(p.run('me.discard.includes(rift)'),true,'Rift itself stays removed');
    assert.equal(p.run('me.hand.length'),3,'pre-Draw hand restored, excluding Rift itself, then draw two');
    assert.equal(p.run('new Set('+INVENTORY+'.map(r=>r[0])).size==='+INVENTORY+'.length'),true,'no duplicated physical card');
    finish(p,w+' Rift '+variant);
  }
}
function entryTests(){
  for(const w of ['player','ai']){
    const other=w==='player'?'ai':'player',p=pair(w,{[w]:'temporal',[other]:'light'});
    p.run(`
      ${EVO}${NUM}
      var me=G.${w},foe=G.${other};G.allowEvolutions=true;G._hist=[];
      ['player','ai'].forEach(function(s){var q=G[s];q.hand=[];q.discard=[];q.deadzone=[];q.bank=[];q.cas=0;q.delta=[];q.evolutions=[];q.leftFlank=null;q.rightFlank=null;q.rearFlank=null;q.deck=Array.from({length:45},()=>num(4));q._firstDrawDone=true;});
      var nine=mkNum(ND.temporal.find(c=>c.n===9),'temporal');me.rankZone=nine;foe.rankZone=num(6,2);
      var established=num(3),stillHere=num(4),offboard=num(2),action=mkAct('Plus');me.leftFlank=established;me.rightFlank=stillHere;
      var fromHand=num(5),inElements=num(2),fromDeck=me.deck[8],fromDrop=num(1),opponent=num(4);
      me.hand=[fromHand,inElements,offboard,action];me.discard=[fromDrop];foe.hand=[opponent];
      var host=evo(2);host.elements=[num(2),num(2),num(2)];me.delta=[host];var originalElements=host.elements.map(c=>c.id);
      var duringDraw=me.deck[0];
      ruHook('drawn',function(w,c){if(w==='${w}'&&c===duringDraw&&G._turnNo===4){me.hand.splice(me.hand.indexOf(c),1);foe.rightFlank=c;ruFieldWatch();}});
      G.turn='${w}';G._turnNo=4;G.phase='promotion';ruFieldWatch();beginPhase('draw');
      var baseline=ruTurnStart(4);G.phase='rally';
      ruFx.fieldTo('${other}',duringDraw,'discard');
      foe.leftFlank=me.leftFlank;me.leftFlank=null;ruFieldWatch();
      me.hand.splice(me.hand.indexOf(fromHand),1);me.leftFlank=fromHand;ruFieldWatch();ruFx.fieldTo('${w}',fromHand,'discard');
      me.hand.splice(me.hand.indexOf(inElements),1);me.leftFlank=inElements;ruFieldWatch();me.leftFlank=null;host.elements.push(inElements);ruFieldWatch();
      me.deck.splice(me.deck.indexOf(fromDeck),1);me.leftFlank=fromDeck;ruFieldWatch();
      foe.hand.splice(foe.hand.indexOf(opponent),1);foe.rightFlank=opponent;ruFieldWatch();ruFx.fieldTo('${other}',opponent,'deadzone');
      me.discard.splice(me.discard.indexOf(fromDrop),1);foe.rightFlank=fromDrop;ruFieldWatch();
      me.hand.splice(me.hand.indexOf(offboard),1);ruDrop(me,offboard);me.hand.splice(me.hand.indexOf(action),1);ruDrop(me,action);
      G.turn='${other}';G._turnNo=5;G.phase='promotion';beginPhase('draw');
      G.turn='${w}';G._turnNo=6;G.phase='promotion';beginPhase('draw');beginPhase('main');
    `);
    assert.equal(p.run('ruEnteredSince(baseline).has(established.id)'),false,'zone changes are not Battlefield entries');
    assert.equal(p.run('ruEnteredSince(baseline).has(offboard.id)'),false,'a dropped hand card never entered');
    for(const name of ['fromHand','inElements','fromDeck','fromDrop','opponent','duringDraw'])assert.equal(p.run(`ruEnteredSince(baseline).has(${name}.id)`),true);
    p.apply({t:'startSkill',s:w,id:p.run('nine.id'),source:'rank'});p.button('Activate Skill');clear(p);
    assert.equal(p.run('nine.currentNP'),15,'only six actually returned entrants grant NP, including the Draw Phase entrant');
    assert.equal(p.run('me.mp'),36,'printed S applied');assert.equal(p.run('me.discard.filter(c=>c.name===\'Numeral 4\').length'),15,'full mill cost paid');
    assert.equal(p.run('foe.leftFlank===established&&me.rightFlank===stillHere'),true,'established Numerals stay in their current zones');
    assert.equal(p.run('me.discard.includes(offboard)&&me.discard.includes(action)'),true,'non-entrants and Actions are untouched');
    assert.equal(p.run('me.hand.includes(fromHand)&&me.hand.includes(inElements)'),true,'entrants that left the field are returned');
    assert.equal(p.run('foe.hand.includes(opponent)&&foe.cas===0'),true,'opponent entrant returns from Deadzone');
    assert.equal(p.run('me.deck.includes(fromDeck)&&me.deck.includes(duringDraw)&&me.discard.includes(fromDrop)&&!foe.rightFlank&&!me.leftFlank'),true);
    assert.deepEqual(Array.from(p.run('host.elements.map(c=>c.id)')),Array.from(p.run('originalElements')));
    finish(p,w+' Temporal 9 entry history');
  }
}
if(require.main===module){
  if(!process.argv.includes('--entries-only'))riftTests();
  if(!process.argv.includes('--rift-only'))entryTests();
  const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'data','online-regression.json'),JSON.stringify(REPORT,null,2));
}
