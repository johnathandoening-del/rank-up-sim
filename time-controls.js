(function(){
  'use strict';
  const M=window.RUMatchClock;
  let clock=null,game=null,offset=0,lastProgress='',onlineReady=false;
  const el=id=>document.getElementById(id);
  const sameGame=()=>!!(G&&game&&G._seed===game._seed);
  const remote=()=>!!(G&&G._netMode&&!G._soloNet);
  const now=()=>Date.now()+offset;
  function menu(){return M.config({enabled:!!(el('enable-time')&&el('enable-time').checked),type:el('time-type')&&el('time-type').value,minutes:el('time-minutes')&&el('time-minutes').value});}
  function choices(){
    const type=el('time-type'),minutes=el('time-minutes'),on=el('enable-time');
    if(!type||!minutes||!on)return;
    const old=Number(minutes.value);
    minutes.innerHTML=M.OPTIONS[type.value].map(n=>'<option value="'+n+'"'+(n===old?' selected':'')+'>'+n+' min</option>').join('');
    el('time-options').hidden=!on.checked;
  }
  function start(cfg){
    game=G;lastProgress='';offset=0;onlineReady=false;
    G.timeControl=M.config(cfg);G._timeAttackGrace=null;
    clock=M.create(G.timeControl,G.sideOrder,G.turn,Date.now());
    if(remote())clock.status=G.timeControl.enabled?'waiting':'off';
    paint();
  }
  function receive(value,serverNow){
    if(!remote()||!value)return;
    clock=JSON.parse(JSON.stringify(value));offset=Number(serverNow)-Date.now();onlineReady=true;paint();
  }
  function state(){
    if(!sameGame()||!G.turn)return null;
    const grace=G._timeAttackGrace;
    return {turn:G.turn,turnNo:G._turnNo||0,ended:!!G.gameOver,stage:grace?(grace.declared?'resolving':'grace'):'main'};
  }
  function changed(){
    const p=state();if(!p||!clock||!G.timeControl.enabled)return;
    const key=JSON.stringify(p);
    if(remote()){
      if(onlineReady&&key!==lastProgress&&window.RUNet&&!G._spectator&&!window.ruInboxBusy()){
        lastProgress=key;RUNet.clockProgress(p);
      }
    }else{
      const event=M.advance(clock,now());
      if(event){ruApplyAction({t:'clockExpire',s:G.turn,event});return;}
      M.progress(clock,p,now());
    }
    paint();
  }
  function clearChoices(){
    if(window.ruSettleReset)ruSettleReset();
    if(typeof _modalQueue!=='undefined')_modalQueue=[];
    if(typeof _modalOpen!=='undefined')_modalOpen=false;
    ['modal','picker-modal','ru-confirm'].forEach(id=>{const e=el(id);if(e){e.classList.remove('open');e._ruStash=null;}});
    if(typeof PCK!=='undefined')PCK={cb:null,pool:[],sel:[],max:1,min:1,opt:false};
    if(typeof SF!=='undefined')SF=null;
    window._RUcq=[];window._RUcbusy=false;
    G._acts=[];G._offTurnWindow=null;G._offTurnAttack=null;
    cancelAll();
  }
  function pass(){
    const g=G,w=G.turn,n=G._turnNo||0;
    clearChoices();G._timeAttackGrace=null;G._timeEnding=true;
    log(sideNameLabel(w)+' ran out of turn time. The turn ends.','imp');
    // Run ordinary end-of-turn cleanup, but do not wait indefinitely for end-phase choices.
    if(G.phase!=='end')beginPhase('end');
    if(G===g&&!g.gameOver&&g.turn===w&&(g._turnNo||0)===n){
      clearChoices();g.phase='end';endTurnCore();
    }
    delete g._timeEnding;changed();
  }
  function lose(w,reason){
    clearChoices();G._timeAttackGrace=null;
    const others=(G.sideOrder||[]).filter(s=>s!==w&&!(G.eliminated&&G.eliminated[s]));
    if(others.length===1)endGameImmediate(others[0],reason);
    else{
      G.eliminated[w]=true;log(sideNameLabel(w)+' loses: '+reason,'imp');
      if(G.turn===w)pass();else renderAll();
    }
    changed();
  }
  function expire(event){
    if(!G||G.gameOver||!G.timeControl||!G.timeControl.enabled)return;
    if(event.type==='game'){
      clearChoices();G._timeLimitReached=true;
      endGameImmediate(null,'Game time expired. Winner scoring is pending the timed-game rules.');
    }else if(event.type==='player')lose(event.turn,'Player time expired.');
    else if(event.turn!==G.turn||event.turnNo!==(G._turnNo||0))return;
    else if(event.stage==='grace'){
      if(!G._timeAttackGrace||!G._timeAttackGrace.declared)lose(G.turn,'No attack declared within the final 15 seconds.');
    }else{
      const owes=window.ru171UsedAdvE1ThisTurn&&ru171UsedAdvE1ThisTurn(G[G.turn])&&!ruDeclaredAttackThisTurn(G.turn);
      if(!owes){pass();return;}
      clearChoices();
      if(!hasLegalAttack(G.turn)){lose(G.turn,'Turn time expired with an unmet Advantageous attack requirement and no legal attack.');return;}
      G._timeAttackGrace={seat:G.turn,turnNo:G._turnNo||0,declared:false};
      log(sideNameLabel(G.turn)+' must declare an attack within 15 seconds or forfeit.','imp');
      if(G.phase!=='battle')beginPhase('battle');
      renderAll();
    }
    changed();
  }
  function declared(w){
    const p=G&&G._timeAttackGrace;
    if(!p||p.seat!==w||p.turnNo!==(G._turnNo||0)||p.declared)return;
    p.declared=true;changed();
    ruWhenSettled(()=>G.gameOver||(!ruUiBusy()&&!SF&&!(G._attackDeclarations||[]).some(a=>a.turn===p.turnNo&&!a.status)),()=>{
      if(!G.gameOver&&G._timeAttackGrace===p)pass();
    },{defer:true});
  }
  function refusal(a){
    if(!G||!G.timeControl||!G.timeControl.enabled||G._replaying||G._inInput)return '';
    if(remote()&&(!onlineReady||!RUNet.state().connected||clock.status==='paused'))return 'The clock is paused while a player reconnects.';
    if(remote()&&RUNet.state().clockAwaiting)return 'Waiting for the server to confirm your move.';
    if(a.t==='concede')return '';
    if(clock&&['expired','waiting','stopped'].includes(clock.status))return 'Time has expired; waiting for the clock decision.';
    if(G._timeAttackGrace&&!G._timeAttackGrace.declared&&['atkMode','zone','delta','direct','cancel','modal','pick','pickCancel'].indexOf(a.t)<0)return 'Declare your required attack now or forfeit.';
    return '';
  }
  function format(ms){const s=Math.max(0,Math.ceil(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
  function paint(){
    const active=sameGame()&&G.turn&&G.timeControl&&G.timeControl.enabled;
    const c=clock&&JSON.parse(JSON.stringify(clock));if(c)M.advance(c,now());
    const type=c&&c.rules.type;
    function pill(){
      const p=document.createElement('span');p.className='hpill hpill-time';p.setAttribute('role','timer');
      p.innerHTML='<span class="clock-icon" aria-hidden="true"></span><span>TIME</span><b></b><span class="clock-note"></span>';
      return p;
    }
    function update(p,left,seat){
      const grace=c.stage==='grace'&&seat===G.turn,resolving=c.stage==='resolving'&&seat===G.turn;
      p.querySelector('b').textContent=format(grace?c.graceLeft:left);
      const note=grace?'Attack/forfeit':resolving?'Resolving':c.status==='paused'||c.status==='waiting'?'Paused':'';
      p.querySelector('.clock-note').textContent=note;
      p.setAttribute('aria-label','Time '+format(grace?c.graceLeft:left)+(note?' · '+note:''));
      p.classList.toggle('clock-warning',grace||left<=30000);
    }
    for(const id of ['hud-strip','hud-center']){
      const host=el(id);if(!host)continue;
      const radial=id==='hud-center',shown=active&&(radial?!!G.ai2:!G.ai2);
      host.classList.toggle('time-game',!!(shown&&type==='game'));
      const rows=Array.from(host.querySelectorAll(radial?'.hc-seat':'.hud-row'));
      rows.forEach((row,i)=>{
        const seat=radial?row.dataset.seat:row.dataset.side==='player'?ruViewSeat():ruTopSeat();
        const stats=row.querySelector(radial?'.hc-stats':'.hud-c-stats');if(!stats)return;
        let p=stats.querySelector('.hpill-time');if(!p){p=pill();stats.appendChild(p);}
        p.setAttribute('data-time-seat',seat);p.hidden=!(shown&&(type==='player'||type==='turn'&&seat===G.turn));
        p.style.opacity=type==='player'&&seat!==G.turn?'0.35':'';
        if(!p.hidden)update(p,type==='player'?c.remaining[seat]:c.left,seat);
        Array.from(row.children).forEach(cell=>{cell.style.gridRow=shown&&type==='game'?String(i+1):'';});
      });
      let shared=host.querySelector('.hud-game-time');
      if(!shared){shared=pill();shared.classList.add('hud-game-time');host.appendChild(shared);}
      shared.hidden=!(shown&&type==='game');
      if(!shared.hidden){shared.style.gridRow='1 / span '+rows.length;update(shared,c.left,null);}
    }
  }
  function tick(){
    if(!sameGame()||!clock||G.gameOver){paint();return;}
    if(!remote()){
      const event=M.advance(clock,now());
      if(event){
        const a={t:'clockExpire',s:G.turn,event};
        if(G._soloNet&&window.RUBots)RUBots.noteInput(a);
        ruApplyAction(a);
      }
    }
    changed();
  }
  window.RUTime={menu,choices,start,receive,changed,expire,declared,refusal,tick,paint,snapshot:()=>clock};
  el('enable-time').addEventListener('change',choices);el('time-type').addEventListener('change',choices);choices();
  if(!window.__headless)setInterval(tick,200);
})();
