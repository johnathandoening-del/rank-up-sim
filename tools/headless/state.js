'use strict';
/* Save / restore a complete game position inside a headless engine (for lookahead: copy, play a line, rewind).
 * A snapshot is taken only at a QUIET point: no prompt open, no skill in flight, no Casualty Draw queued, no
 * continuation or one-shot timer pending — so the whole position is plain data (no half-run callbacks). */
const { STATE_CODE: CODE } = require('../../ai/state');
function install(eng) { eng.ctx.__structuredClone = structuredClone; eng.run(CODE); }
module.exports = { install };
