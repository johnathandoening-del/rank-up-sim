/* Shared clock arithmetic. Only the room server (or the local match) advances time. */
(function(root){
  'use strict';
  const OPTIONS={turn:[3,5,7],player:[5,7,10],game:[7,15,21,35]};
  function config(value){
    const v=value||{},type=Object.hasOwn(OPTIONS,v.type)?v.type:'turn';
    const minutes=OPTIONS[type].includes(Number(v.minutes))?Number(v.minutes):OPTIONS[type][0];
    return {enabled:v.enabled===true,type,minutes};
  }
  function create(value,seats,turn,now){
    const rules=config(value),ms=rules.minutes*60000,remaining={};
    seats.forEach(s=>remaining[s]=ms);
    return {rules,remaining,left:ms,turn,turnNo:0,at:now,status:rules.enabled?'running':'off',stage:'main'};
  }
  function advance(c,now){
    if(!c)return null;
    const elapsed=Math.max(0,now-c.at);c.at=now;
    if(c.status!=='running')return null;
    if(c.stage==='grace')c.graceLeft=Math.max(0,c.graceLeft-elapsed);
    else if(c.rules.type==='player')c.remaining[c.turn]=Math.max(0,c.remaining[c.turn]-elapsed);
    else c.left=Math.max(0,c.left-elapsed);
    const left=c.stage==='grace'?c.graceLeft:c.rules.type==='player'?c.remaining[c.turn]:c.left;
    if(left>0)return null;
    c.status='expired';
    return {type:c.rules.type,stage:c.stage,turn:c.turn,turnNo:c.turnNo};
  }
  function progress(c,p,now){
    if(!c||!c.rules.enabled)return;
    if(p.ended){c.status='stopped';c.at=now;return;}
    if(p.turnNo>c.turnNo){
      c.turn=p.turn;c.turnNo=p.turnNo;c.stage='main';
      if(c.rules.type==='turn')c.left=c.rules.minutes*60000;
      c.status='running';c.at=now;
    }else if(p.turnNo===c.turnNo&&p.turn===c.turn&&c.rules.type==='turn'){
      if(p.stage==='grace'&&c.stage==='main'&&c.status==='expired'){
        c.stage='grace';c.graceLeft=15000;c.status='running';c.at=now;
      }else if(p.stage==='resolving'&&c.stage==='grace'){
        c.stage='resolving';c.status='resolving';c.at=now;
      }
    }
  }
  function pause(c,on,now){
    if(!c)return;
    if(on&&(c.status==='running'||c.status==='resolving')){c.resumeStatus=c.status;c.status='paused';c.at=now;}
    else if(!on&&c.status==='paused'){c.status=c.resumeStatus||'running';delete c.resumeStatus;c.at=now;}
  }
  const api={OPTIONS,config,create,advance,progress,pause};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RUMatchClock=api;
})(typeof window!=='undefined'?window:this);
