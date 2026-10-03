'use strict';
/* Headless "no paint" mode: the board/HUD/hand painters become no-ops and the log keeps a small in-memory ring
 * instead of building DOM. Every RULE pass still runs, in the same order (renderAll's engine passes are untouched —
 * only functions that draw are replaced). parity.js proves painting never changes the game: the same inputs give the
 * same fingerprint after every step with and without this mode. */
const { PAINTERS, NOPAINT_CODE: CODE } = require('../../ai/nopaint');

// The page's own repeating timers started at load are all display (card animations, the odometer, button refresh,
// a network health ping) or a solo-bot freeze guard that is inert in input-driven games — none run headless.
function install(eng) { eng.run(CODE); eng.clock.live.forEach((t, id) => { if (t.every) { t.dead = true; eng.clock.live.delete(id); } }); }
module.exports = { install, PAINTERS };
