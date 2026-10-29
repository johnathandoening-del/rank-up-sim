'use strict';
// Constructed engine positions for gameplay regressions; not natural-play evidence.
const {newMatch}=require('./match');
function setup(code){
  const m=newMatch({seed:31,cls0:'light',cls1:'shadow'}),e=m.eng;
  require('./nopaint').install(e);require('./brain').install(e);
  e.run(`closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;
    G.phase='main';G.mode='normal';G.turn='player';G._turnNo=5;G.firstTurn=false;
    G.exchange=3;G._turnsCompletedBy={player:2,ai:2};
    G.player.hand=[];G.ai.hand=[];G.player.leftFlank=null;G.player.rightFlank=null;
    G.ai.leftFlank=null;G.ai.rightFlank=null;G.player.bank=[];G.ai.bank=[];
    G.player.mp=30;G.ai.mp=30;G.player.cas=0;G.ai.cas=0;
    G.player._firstDrawDone=true;G.ai._firstDrawDone=true;`);
  e.dropTimeouts();e.run(code||'');e.run('ruFieldWatch();__B.noteApplied(null)');return m;
}
module.exports={setup};
