'use strict';
/* What each Δ card is worth, measured from self-play games with random Δ Decks (selfplay.js writes <out>.games.jsonl):
 * per class alignment (Benevolent / Malevolent / Neutral classes) and card — how often the card actually got
 * assembled, and the win rate of sides that held it / assembled it against sides with no Δ Deck at all.
 *   node tools/headless/deltafit.js <games.jsonl[,more]> [minGames=8] */
const fs = require('fs');
const [files, minArg] = process.argv.slice(2);
const MIN = Number(minArg || 8);
const games = files.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((g) => g.over && g.winner && g.winner !== 'draw');
// class alignment from the game's own data
const ALIGN = (() => { const eng = require('./engine').createEngine({ seed: 1 }); return eng.run('(function(){ var o = {}; Object.keys(CM).forEach(function(k){ o[k] = CM[k].align || "Neutral"; }); return o; })()'); })();
const sides = [];
games.filter((g) => g.evo).forEach((g) => [0, 1].forEach((i) => sides.push({ cls: g.cls[i], align: ALIGN[g.cls[i]] || '?', deck: g.dd[i] || [], built: (g.built && g.built[i]) || [], won: (g.winner === (i === 0 ? 'player' : 'ai')) ? 1 : 0, oppDeck: g.dd[1 - i] || [] })));
const base = sides.filter((s) => !s.deck.length && !s.oppDeck.length), baseRate = base.reduce((a, s) => a + s.won, 0) / Math.max(1, base.length);
console.log(`${games.length} decided games, ${sides.length} sides with evolutions on; sides with no Δ (vs no Δ): ${base.length}, win ${(100 * baseRate).toFixed(1)}%`);
const cells = {};
sides.forEach((s) => s.deck.forEach((id) => {
  const k = s.align + ' | ' + id, c = cells[k] = cells[k] || { held: 0, heldWon: 0, built: 0, builtWon: 0 };
  c.held++; c.heldWon += s.won;
  if (s.built.indexOf(id) !== -1) { c.built++; c.builtWon += s.won; }
}));
const rows = Object.entries(cells).filter(([, c]) => c.held >= MIN).map(([k, c]) => ({ k, held: c.held, buildRate: c.built / c.held, heldWin: c.heldWon / c.held, builtWin: c.built ? c.builtWon / c.built : null }));
rows.sort((a, b) => (b.builtWin == null ? -1 : b.builtWin) - (a.builtWin == null ? -1 : a.builtWin));
console.log('alignment | card                      held  built%  win% held  win% when built');
rows.forEach((r) => console.log(`${r.k.padEnd(36)} ${String(r.held).padStart(4)}  ${(100 * r.buildRate).toFixed(0).padStart(5)}%  ${(100 * r.heldWin).toFixed(1).padStart(8)}  ${r.builtWin == null ? '      -' : (100 * r.builtWin).toFixed(1).padStart(8)}`));
