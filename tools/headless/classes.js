'use strict';
/* Every class the game knows, in the game's own order — read from the engine's class registry (CM, data.js plus
 * the classes index.html adds), so a new class is included in every headless tool and test without editing them. */
let LIST = null;
module.exports = function classes() {
  if (!LIST) LIST = require('./engine').createEngine({ seed: 1 }).run('Object.keys(CM)');
  return LIST;
};
