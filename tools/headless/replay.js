'use strict';
/* Play one arena game again, exactly (the same deal, seats and bots), and print it: every input with who made it and
 * why, and what it did (the game log). For looking into a loss: which decision lost it, and what the bot weighed.
 *   node tools/headless/replay.js <seed> <cls0> <cls1> <firstSeat> <aSeat> '<policyA>' '<policyB>' [turns]
 * A game from a results file is { seed, cls:[cls0, cls1], first, aSeat } (ladder.js / ARENA_OUT). 'turns' (e.g. 7-9):
 * at every bot decision in those turns, also list every candidate the bot weighed, with its value (the bot thinks
 * the decision again for that — the game itself is unchanged). */
const { play } = require('./game');
const [seedA, cls0, cls1, firstA, aSeat, polAJ, polBJ, turnsA] = process.argv.slice(2);
if (!polBJ) { console.log('usage: replay.js <seed> <cls0> <cls1> <firstSeat> <aSeat> <policyA> <policyB> [turns]'); process.exit(1); }
const [t1, t2] = (turnsA || '').split('-').map(Number);
const inTurns = (t) => turnsA ? t >= t1 && t <= (t2 || t1) : false;
const short = (a) => a.t + (a.id ? ':' + a.id : '') + (a.z ? ':' + (a.o || '') + '/' + a.z : '') + (a.i != null ? ':' + a.i : '') + (a.slot ? ':' + a.slot : '') + (a.ix ? ':[' + a.ix + ']' : '');
const res = play({ seed: Number(seedA), cls0, cls1, firstSeat: Number(firstA), aSeat, polA: JSON.parse(polAJ), polB: JSON.parse(polBJ), maxMs: 60 * 60000 }, {
  explain: (step, x) => inTurns(x.turn),
  onInput: (x) => {
    const p = x.plan, why = p ? ` (${p.why}${p.value != null ? ' ' + p.value.toFixed(1) : ''}${p.considered ? ', ' + p.considered + ' weighed' : ''}${p.evals ? ', ' + Math.round(p.evals) + ' evals ' + p.ms + ' ms' : ''})` : '';
    if (x.prompt) console.log(`  ? ${x.prompt.kind} "${x.prompt.title || ''}"${x.prompt.labels ? ' [' + x.prompt.labels.join(' / ') + ']' : ''}`);
    console.log(`t${x.turn} ${x.phase} ${x.seat}=${x.who}: ${short(x.move)}${why}`);
    if (p && p.ranked) p.ranked.forEach((c) => console.log(`      ${String(c.m).padStart(8)} ±${c.se} n${c.n}  ${c.line}`));
    x.log.forEach((l) => console.log('    | ' + l));
  },
});
console.log(`\nresult: ${res.winner} (A = ${aSeat}) after ${res.turns} turns; ${JSON.stringify(res.reason)}; MP/cas/deck ${JSON.stringify(res.mp)}${res.stop ? '; stopped: ' + res.stop : ''}`);
