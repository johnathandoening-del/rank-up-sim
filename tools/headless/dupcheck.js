'use strict';
/* Card integrity check: random-play many games on the real engine; after every input, check that no card (the same
 * object, or the same id) sits in two places at once, that no Rank Zone is ever empty, and that the empty-Rank
 * stand-in is never anywhere else. Prints the input and the log lines that duplicated a card.
 *   node tools/headless/dupcheck.js [games=40] */
const P = './';
const { createEngine } = require(P+'engine'); const { newMatch } = require(P+'match'); const nopaint=require(P+'nopaint'); const moves=require(P+'moves');
const CLASSES = ['light', 'inferno', 'blizzard', 'shadow', 'maximum', 'deckstructive', 'negative', 'restorative', 'haste', 'astute', '7th', 'zero', 'phantom', 'fission', 'extension'];
function mb(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const CHECK = `(function(){
  var where = new Map(), ids = new Map(), out = [];
  ['player','ai'].forEach(function(s){ var p = G[s]; if (!p) return;
    var zones = { deck: p.deck, hand: p.hand, discard: p.discard, deadzone: p.deadzone, bank: p.bank, delta: p.delta, rank: [p.rankZone], left: [p.leftFlank], right: [p.rightFlank], rear: [p.rearFlank] };
    Object.keys(zones).forEach(function(z){ (zones[z] || []).forEach(function(c, i){ if (!c || typeof c !== 'object') return;
      var tag = s + '.' + z + '[' + i + '] ' + c.name;
      if (where.has(c)) out.push('SAME OBJECT ' + tag + ' == ' + where.get(c)); else where.set(c, tag);
      if (c.id && ids.has(c.id) && ids.get(c.id) !== c) out.push('SAME ID ' + c.id + ' ' + tag); else if (c.id) ids.set(c.id, c);
    }); });
  });
  // a seat's Rank Zone is never empty (an empty rank holds the Numeral 0 placeholder)
  ['player','ai'].forEach(function(s){ var p = G[s]; if (p && !p.rankZone) out.push('EMPTY RANK ZONE ' + s); });
  // the empty-Rank stand-in is not a card: it is never anywhere but the Rank Zone
  ['player','ai'].forEach(function(s){ var p = G[s]; if (!p) return;
    ['deck','hand','discard','deadzone','bank'].forEach(function(z){ (p[z] || []).forEach(function(c){ if (c && c._empty) out.push('STAND-IN IN ' + s + '.' + z); }); });
    ['leftFlank','rightFlank','rearFlank'].forEach(function(z){ if (p[z] && p[z]._empty) out.push('STAND-IN IN ' + s + '.' + z); }); });
  return out;
})()`;
const games = Number(process.argv[2] || 40); let found = 0;
for (let g = 0; g < games && found < 6; g++) {
  const seed = 9000 + g, rnd = mb(seed);
  const c0 = CLASSES[g % 15], c1 = CLASSES[(g * 7 + 4) % 15];
  const eng = createEngine({ seed }); nopaint.install(eng);
  const m = newMatch({ engine: eng, seed, cls0: c0, cls1: c1, firstSeat: g % 2, evo: g % 2 === 0 });
  moves.install(eng);
  eng.run('window.__lg=[]; (function(){ var o=window.log; window.log=function(m,t){ window.__lg.push(String(m).replace(/<[^>]+>/g,"")); if(window.__lg.length>60) window.__lg.shift(); return o.apply(this,arguments); }; })()');
  let steps = 0, prev = [];
  while (steps < 3000) {
    const d = eng.run('__M.decider()'); if (d.kind === 'over' || d.kind === 'none') break;
    const L = eng.run('__M.legal(' + JSON.stringify(d.seat) + ')'); if (!L.length) break;
    let mv = L[Math.floor(rnd() * L.length)]; const adv = L.find((x) => x.t === 'adv' || x.t === 'sdDone'); if (adv && rnd() < 0.3) mv = adv;
    eng.run('window.__lg.length=0');
    eng.run('__H.apply(' + JSON.stringify(mv) + ')'); eng.settle(10000); steps++;
    const dup = eng.run(CHECK);
    if (dup.length) { found++; console.log(`\n### game ${g} seed ${seed} ${c0} vs ${c1} step ${steps} input ${JSON.stringify(mv)}\n  ${dup.slice(0,4).join('\n  ')}\n  log:\n    ${eng.run('window.__lg.slice(-25)').join('\n    ')}`); break; }
  }
}
console.log(found ? '\nFOUND ' + found + ' duplicated card(s)' : '\nOK: no card was ever in two places');
process.exitCode = found ? 1 : 0;
