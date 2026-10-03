'use strict';
/* A headless match on the REAL engine, played purely through the same inputs a human makes (the online input layer:
 * {t:'adv'}, {t:'hand',id}, {t:'zone',o,z}, {t:'modal',i}, {t:'pick',ix}, …). Both seats are "remote humans"
 * (a virtual online game watched by nobody), so no built-in bot code ever runs: whoever drives the inputs plays. */
const { createEngine } = require('./engine');

const SEATS = ['player', 'ai'];

// In-realm helpers (installed once per engine): what is pending, who decides, how to apply an input.
const { MATCH_CODE: HELPERS } = require('../../ai/match');

function newMatch(opts) {
  opts = opts || {};
  const eng = opts.engine || createEngine({ seed: opts.rngSeed || 1 });
  eng.run(HELPERS);
  const cfg = {
    seed: (opts.seed >>> 0) || 1, mySeat: null, spectator: true,
    seat0Class: opts.cls0 || 'light', seat1Class: opts.cls1 || 'inferno', firstSeat: opts.firstSeat === 1 ? 1 : 0,
    name0: 'P1', name1: 'P2', allowEvolutions: opts.evo !== false,
    deltaDecks: { player: opts.dd0 || [], ai: opts.dd1 || [] }, areaSupports: { player: null, ai: null },
    solo: opts.solo || undefined,    // { bots: { seat: tierKey } } — a solo match with the thinking bots (as the page builds it)
  };
  eng.run('__H.start(' + JSON.stringify(cfg) + ')');
  eng.settle();
  return {
    eng,
    pending() { return eng.run('__H.pending()'); },
    options(seat) { return eng.run('__H.options(' + JSON.stringify(seat) + ')'); },
    apply(a) { eng.run('__H.apply(' + JSON.stringify(a) + ')'); eng.settle(10000); },
    sig() { return eng.run('__H.sig()'); },
    winner() { return eng.run('G.__winner || null'); },
    turnNo() { return eng.run('G._turnNo || 0'); },
  };
}

module.exports = { newMatch, SEATS };
