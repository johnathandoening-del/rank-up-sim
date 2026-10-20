'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../data.js'),'utf8'),context);
const cards=JSON.parse(vm.runInContext('JSON.stringify(FULLMETAL_LIBRARY)',context));
const expected=[
  [0,0,1,1,1],[0,0,2,1,1],[0,0,2,1,2],
  [1,1,2,2,2],[1,1,3,2,2],[1,1,3,3,3],
  [2,2,4,3,3],[2,2,4,4,4],[2,2,4,99,4],
];
assert.equal(cards.length,9);
assert.equal(new Set(cards.map(c=>c.id)).size,9);
for(const [i,c] of cards.entries()){
  assert.equal(c.numeral,i+1);
  assert.equal(c.alignment,'Unknown');
  assert.equal(c.evoType,'fullmetal');
  assert.equal(c.class,'fullmetal');
  assert.deepEqual([c.rank,c.A,c.M,c.S,c.W],expected[i]);
  assert.equal(c.materialW,c.W);
  assert.equal(c.protectionTurnBasis,'owner');
  assert.ok(c.protection.includes("of its owner's turns"));
  assert.equal(c.skill2M,0);
  assert.deepEqual(c.materialSources,['battlefield']);
  assert.equal(c.missingMaterialW,0);
  assert.equal(c.skill1OncePerTurn,[5,6,7,9].includes(c.numeral));
  assert.equal(c.skillCost.startsWith('Once per turn,'),c.skill1OncePerTurn);
  assert.equal(c.skill1AnyPlayerTurn,true);
  assert.equal(c.skill2AnyPlayerTurn,true);
  assert.equal(c.skill2OncePerTurn,true);
  assert.deepEqual(c.skill2Sources,['hand','battlefield']);
  assert.equal(c.skill2MatchStat,'RP');
  assert.ok(c.skillCost2.includes('whose RP is equal'));
  assert.ok(c.skillCost2.includes('hand or Battlefield'));
  assert.ok(c.skillCost2.startsWith('Once per turn,'));
  assert.ok(c.skillText2.includes('that Numeral\'s NP'));
  assert.ok(c.protection.startsWith('This cannot be removed on the turn it\'s played.'));
  assert.deepEqual(c.protectedFrom,
    ['battle',...(i>=2?['action']:[]),...(i>=5?['numeral']:[]),...(i>=7?['area']:[])]);
}
assert.equal(cards[8].SText,'+?');
assert.ok(cards[7].skillText.includes('all Safeguard-type Action Cards'));
assert.ok(cards[8].skillCost.includes('when you or a Numeral'));
assert.equal(cards[4].skillText,'Negate one attack or counterattack by a player this turn.');
assert.equal(vm.runInContext('Object.keys(CM).length',context),19);
console.log('PASS Fullmetal 1-9: printed stats, Unknown alignment, materials, protection tiers, and shared Skill 2 data.');
console.log('Data tests only: these do not verify playable skills or online synchronization.');
