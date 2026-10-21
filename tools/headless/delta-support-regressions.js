'use strict';
const assert=require('node:assert/strict');
const {createEngine}=require('./engine');
const {MATCH_CODE}=require('../../ai/match');
const e=createEngine({seed:42});
const classes=Array.from(e.run('Object.keys(CM)'));
for(const cls of classes)for(let transmute=0;transmute<=3;transmute++)for(let metallicize=0;metallicize<=3;metallicize++){
  e.run(`ruSeedGame(42);var deck=buildDeck('${cls}'),before=deck.slice();ruApplyDeltaActionSupport(deck,{Transmute:${transmute},Metallicize:${metallicize}});`);
  assert.equal(e.run('deck.length'),e.run('before.length'),'deck size unchanged');
  assert.equal(e.run("deck.filter(c=>c._deltaSupport&&c.name==='Transmute').length"),transmute);
  assert.equal(e.run("deck.filter(c=>c._deltaSupport&&c.name==='Metallicize').length"),metallicize);
  assert.equal(e.run('deck.filter((c,i)=>c!==before[i]).length'),transmute+metallicize,'one distinct replacement per added copy');
  assert.equal(e.run("deck.every((c,i)=>c===before[i]||(before[i].type==='action'&&!before[i].isStar))"),true,'only non-Star Actions replaced');
  assert.equal(e.run('new Set(deck.map(c=>c.id)).size'),e.run('deck.length'),'fresh unique card IDs');
  e.run(`var expected=JSON.stringify(deck);ruSeedGame(42);var repeat=buildDeck('${cls}');ruApplyDeltaActionSupport(repeat,{Transmute:${transmute},Metallicize:${metallicize}});`);
  assert.equal(e.run('JSON.stringify(repeat)'),e.run('expected'),'seeded determinism');
}
assert.deepEqual(JSON.parse(e.run('JSON.stringify(ruDeltaActionSupportCounts({Transmute:99,Metallicize:-1,Cease:3}))')),{Transmute:3,Metallicize:0});
assert.deepEqual(JSON.parse(e.run('JSON.stringify(ruDeltaActionSupportCounts({Transmute:1.8,Metallicize:"bad"}))')),{Transmute:1,Metallicize:0});
assert.deepEqual(JSON.parse(e.run('JSON.stringify(ruDeltaActionSupportCounts(null))')),{Transmute:0,Metallicize:0});
for(const enabled of [true,false]){
  const engines=[0,1,null].map(local=>{
    const x=createEngine({seed:912});x.run(MATCH_CODE);
    x.run(`RU_PLAYER_ACTION_SUPPORT={Transmute:${local===0?3:0},Metallicize:${local===1?3:0}};
      __H.start({seed:912,mySeat:${local},spectator:${local===null},seat0Class:'light',seat1Class:'temporal',firstSeat:0,allowEvolutions:${enabled},deltaDecks:{player:[],ai:[]},areaSupports:{player:null,ai:null},actionSupports:{player:{Transmute:3,Metallicize:2},ai:{Transmute:1,Metallicize:3}}});`);
    x.settle(1000);return x;
  });
  for(const x of engines){
    assert.deepEqual(x.errors,[]);
    assert.equal(x.run('ruStateSig()'),engines[0].run('ruStateSig()'),'P1/P2/spectator parity independent of their menu choices');
    for(const w of ['player','ai'])for(const name of ['Transmute','Metallicize']){
      const wanted=enabled?({player:{Transmute:3,Metallicize:2},ai:{Transmute:1,Metallicize:3}}[w][name]):0;
      const query=`['deck','hand','discard','deadzone','bank'].flatMap(z=>G['${w}'][z]||[]).filter(c=>c._deltaSupport&&c.name==='${name}').length`;
      assert.equal(x.run(query),wanted,'correct seat support count');
      x.run('installDeltaDecks();');assert.equal(x.run(query),wanted,'reinstallation does not add more Actions');
    }
  }
}
console.log('PASS',classes.length*16,'class/loadout combinations: unchanged size, protected Stars/Numerals/Areas, six distinct replacements, unique IDs and shared randomness');
console.log('PASS count validation, zero/default, P1/P2/spectator ownership, repeated installation and evolutions-disabled matches');
const coexist=createEngine({seed:123});coexist.run(MATCH_CODE);
coexist.run(`__H.start({seed:123,mySeat:0,seat0Class:'light',seat1Class:'temporal',firstSeat:0,allowEvolutions:true,
  deltaDecks:{player:['fullmetal-1','amalg-benevolent-2','fullmetal-3'],ai:[]},areaSupports:{player:'area-amalgamation-nation',ai:null},actionSupports:{player:{Transmute:3,Metallicize:3}}});`);
coexist.settle(1000);
assert.deepEqual(coexist.errors,[]);
assert.equal(coexist.run('G.player.evolutions.length'),3,'support does not occupy Evolution slots');
assert.equal(coexist.run("['deck','hand','discard','deadzone'].flatMap(z=>G.player[z]).filter(c=>c._deltaSupport).length"),6);
assert.equal(coexist.run("['deck','hand','discard','deadzone'].flatMap(z=>G.player[z]).filter(c=>c._areaSupport).length"),1,'Area substitution works alongside Actions');
const legacy=createEngine({seed:123});legacy.run('ruSeedGame(123);RU_PLAYER_ACTION_SUPPORT={Transmute:3,Metallicize:3};var human=mkSide(\'pl\',\'light\',\'player\'),bot=mkSide(\'ai\',\'light\',\'ai\');');
assert.equal(legacy.run('human.deck.filter(c=>c._deltaSupport).length'),6);assert.equal(legacy.run('bot.deck.filter(c=>c._deltaSupport).length'),0,'legacy solo does not copy human choices to bot');
console.log('PASS six Actions coexist with three Evolutions and Area Support; legacy solo applies only human selection');
