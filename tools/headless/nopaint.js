'use strict';
/* Headless "no paint" mode: the board/HUD/hand painters become no-ops and the log keeps a small in-memory ring
 * instead of building DOM. Every RULE pass still runs, in the same order (renderAll's engine passes are untouched —
 * only functions that draw are replaced). parity.js proves painting never changes the game: the same inputs give the
 * same fingerprint after every step with and without this mode. */
const PAINTERS = [
  // renderAllBase
  'updHUD', 'renderHudStrip', 'rz', 'updRearFlank', 'updEvolutionVisibility', 'updEliminatedVisuals', 'renderHand', 'renderOppHand', 'updPhase', 'syncAreaVisuals',
  // renderAll layers / wrapper
  'refreshV10Buttons', 'renderDeltaZoneRA2', 'updateDeltaElementBarsRA4', 'updateModeButtonsRA7', 'ruSyncTurnControls', 'ruFitRadial', 'fitBoard',
  // visual effects / overlays
  'ruAreaFX', 'showBracket', 'showVersusIntro', 'hideOldBracket', 'applyHandFan', 'markShadowVersusRA8',
];
const CODE = `
(function(){
  if (window.__noPaint) return; window.__noPaint = true;
  var noop = function(){};
  ${JSON.stringify(PAINTERS)}.forEach(function(n){ if (typeof window[n] === 'function') window[n] = noop; });
  var ring = window.__logRing = [];
  window.log = function(msg, type){ if (ring.length > 400) ring.splice(0, 200); ring.push(String(msg)); };
  window.ruLogHoldBegin = undefined;   // no per-input whole-state JSON for log hold-back (there is no screen)
})();
`;
function install(eng) { eng.run(CODE); }
module.exports = { install, PAINTERS };
