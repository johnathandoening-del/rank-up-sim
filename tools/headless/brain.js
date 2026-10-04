'use strict';
/* The thinking bot (in-realm), installed into a headless engine: the code is ai/brain.js (the same code the page's
 * bot worker runs) — how it thinks is described there. */
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
