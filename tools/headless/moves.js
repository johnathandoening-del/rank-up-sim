'use strict';
/* Move generation on the real engine. A MOVE is one input (the same vocabulary a human's clicks produce); the engine
 * itself decides legality: a candidate is legal when applying it changes the position or opens a prompt.
 * Candidates are tried on a saved copy and rewound, so generating moves never disturbs the game.
 *
 * In-realm API (window.__M):
 *   decider()              → { seat, kind:'modal'|'pick'|'turn'|'over'|'none', ... }  who must decide, and what
 *   candidates(seat)       → raw candidate inputs for the decider (not yet filtered)
 *   legal(seat)            → candidates the engine accepts (probed from a snapshot, position restored afterwards)
 */
const state = require('./state');

const { MOVES_CODE: CODE } = require('../../ai/moves');

function install(eng) {
  state.install(eng);
  eng.ctx.__dropTimeouts = () => eng.dropTimeouts();
  eng.run(CODE);
}
module.exports = { install };
