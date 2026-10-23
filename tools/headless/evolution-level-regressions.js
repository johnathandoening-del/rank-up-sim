'use strict';
const assert = require('node:assert/strict');
const { createEngine } = require('./engine');

const engine = createEngine({ seed: 77 });
assert.deepEqual(engine.errors, []);
const expected = {
  'inept-1': 0, 'maladroit-1': 0, 'basic-1': 0, 'skilled-1': 0,
  'skilled-2': 1, 'talented-1': 1, 'talented-2': 2,
  'dCandidate-1': 2, 'dCandidate-2': 2, 'dCandidate-3': 3,
  'distinguished-1': 3, 'distinguished-2': 3,
  'distinguished-3': 3, 'distinguished-4': 3,
};
const seats = { ai: '', player: '_A', ai2: '_B' };
let checked = 0;
for (const [key, size] of Object.entries(expected)) {
  const [tier, level] = key.split('-');
  assert.equal(engine.run(`RU_AI_DEPTH14[${JSON.stringify(key)}].delta`), size);
  for (const [seat, suffix] of Object.entries(seats)) {
    engine.run(`RU_AI_LEVEL_KEY${suffix}=${JSON.stringify(tier)}; RU_AI_LEVEL_NUM${suffix}=${Number(level)};`);
    assert.equal(engine.run(`ruDeltaSizeForLevelFor(${JSON.stringify(seat)})`), size, `${key}/${seat}`);
    if (seat === 'ai') assert.equal(engine.run('ruDeltaSizeForLevel()'), size, key);
    const decks = JSON.parse(engine.run(`JSON.stringify(Object.keys(CM).map(cls => ({cls, ids:ruBotDeltaDeckFor(cls,${JSON.stringify(seat)})})))`));
    for (const deck of decks) {
      assert.equal(deck.ids.length, size, `${key}/${seat}/${deck.cls}`);
      for (const id of deck.ids) assert.ok(engine.run(`RU_AMALGAMATIONS.concat(FULLMETAL_LIBRARY).some(c=>c.id===${JSON.stringify(id)})`), id);
      checked++;
    }
  }
}
assert.deepEqual(engine.errors, []);
console.log(`PASS: all 14 levels, three bot seats, and 19 classes (${checked} Delta Deck selections).`);
