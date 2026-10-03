'use strict';
/* Headless "no paint" mode: the board/HUD/hand painters become no-ops and the log keeps a small in-memory ring
 * instead of building DOM. Every RULE pass still runs, in the same order (renderAll's engine passes are untouched —
 * only functions that draw are replaced). parity.js proves painting never changes the game: the same inputs give the
 * same fingerprint after every step with and without this mode. */
var PAINTERS = [
  // renderAllBase
  'updHUD', 'renderHudStrip', 'rz', 'updRearFlank', 'updEvolutionVisibility', 'updEliminatedVisuals', 'renderHand', 'renderOppHand', 'updPhase', 'syncAreaVisuals',
  // renderAll layers / wrapper
  'refreshV10Buttons', 'renderDeltaZoneRA2', 'updateDeltaElementBarsRA4', 'updateModeButtonsRA7', 'ruSyncTurnControls', 'ruFitRadial', 'fitBoard',
  // visual effects / overlays
  'ruAreaFX', 'showBracket', 'showVersusIntro', 'hideOldBracket', 'applyHandFan', 'markShadowVersusRA8',
];
var NOPAINT_CODE = `
(function(){
  if (window.__noPaint) return; window.__noPaint = true;
  var noop = function(){};
  ${JSON.stringify(PAINTERS)}.forEach(function(n){ if (typeof window[n] === 'function') window[n] = noop; });
  var ring = window.__logRing = [];
  window.log = function(msg, type){ if (ring.length > 400) ring.splice(0, 200); ring.push(String(msg)); };
  window.ruLogHoldBegin = undefined;   // no per-input whole-state JSON for log hold-back (there is no screen)
})();
`;

// Loadable as a Node module (the headless tools) and as a classic script (the browser bot worker: importScripts).
(function (root) { var m = { PAINTERS: PAINTERS, NOPAINT_CODE: NOPAINT_CODE };
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RUAI = root.RUAI || {}; for (var k in m) root.RUAI[k] = m[k]; }
})(typeof self !== 'undefined' ? self : this);
