'use strict';
/* The thinking bot (in-realm). It plays the REAL rules forward on copies of the position.
 *
 *  Moves & lines   A move is one input. Inputs that leave the position mid-way (attack mode, the mover's own prompt)
 *                  are finished on the spot (its own follow-ups chosen best-first, the other player's adversarially),
 *                  so every move is judged by where it lands. A LINE is a whole turn: moves until control passes.
 *  Turn search     One search per turn: a beam per FIRST move (every first move keeps its own best few
 *                  continuations), so no promising start is pruned by another start's lines.
 *  Lookahead N     The best line of each top first move is played on: the opponent's turn by the opponent's planner,
 *                  then its own, … N turns in all; the horizon is scored by evaluate().
 *  Hidden info     Never read. Every search runs in "worlds" where the opponent's hand, both deck orders and all future
 *                  random rolls are re-dealt at random from what the mover could actually know.
 *  Plans           The chosen line is kept and followed while what the bot can SEE matches what the line expected;
 *                  a draw, a random result or the opponent's answer that differs makes it think again.
 *  Mid-action      Prompts mid-action can't be copied (live callbacks), so the live game keeps its last quiet position
 *                  and the inputs since; an answer is judged by rewinding there, re-dealing, replaying, and trying it. */
const moves = require('./moves');

const { BRAIN_CODE: CODE } = require('../../ai/brain');

function install(eng) {
  moves.install(eng);
  // Timers due within a few seconds of game time run now; a flow that is polling while a prompt waits (e.g. a
  // Casualty Draw step, every 40 ms) just continues on the next call instead of spinning through minutes.
  eng.ctx.__settle = () => eng.settle(3000);
  eng.ctx.__realNow = () => Date.now();          // Node's real clock (the realm's Date is the virtual game clock)
  eng.run(CODE);
}
module.exports = { install, CODE };
