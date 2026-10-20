'use strict';
(function(){
  const F=window.ruFx;
  const turn=()=>G._turnNo||0;
  const isMetal=c=>!!c&&c.type==='evolution'&&c.evoType==='fullmetal';
  const metal=w=>(G[w]&&G[w].delta||[]).find(isMetal);
  const safeguard=c=>c&&c.type==='action'&&c.sub==='Safeguard';
  const state=w=>{
    const p=G[w];
    if(!p._fullmetalTurn||p._fullmetalTurn.turn!==turn())p._fullmetalTurn={turn:turn(),negatedAdditional:0,shield:0,lessCas:0,attackers:[]};
    return p._fullmetalTurn;
  };
  const all=()=>G.sideOrder||['player','ai'];
  const field=w=>F.ZONES.map(z=>({zone:z,card:window.zCard(G[w],z)})).filter(x=>x.card&&!x.card._empty);
  function source(){
    if(G._fullmetalSource)return G._fullmetalSource;
    if(typeof SF!=='undefined'&&SF&&SF.card)return SF.card.type==='area'?'area':SF.card.type==='action'?'action':'numeral';
    const a=window.ruActCause&&ruActCause();
    if(a)return 'action';
    if(G._fullmetalPendingSource)return G._fullmetalPendingSource.kind;
    return 'rule';
  }
  function materials(w){
    const p=G&&G[w];
    if(!p||G.allowEvolutions===false||(p.delta||[]).length)return [];
    const slots=field(w).filter(x=>x.card.type==='numeral'),out=[];
    for(const [ei,evo] of (p.evolutions||[]).entries()){
      if(!isMetal(evo))continue;
      // Exceptions may explicitly provide extra sources; ordinary Fullmetal materials are face-up Battlefield Numerals.
      const extra=typeof window.ruFullmetalExtraMaterials==='function'?window.ruFullmetalExtraMaterials(w,evo):[];
      const pool=slots.concat(extra||[]).filter(x=>x&&x.card&&x.card.type==='numeral');
      const seen=new Set();
      for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++)for(let k=j+1;k<pool.length;k++){
        const combo=[pool[i],pool[j],pool[k]],ids=combo.map(x=>x.card.id);
        if(new Set(ids).size!==3)continue;
        if(evo.rank<2&&combo.some(x=>x.card.class==='ochre'&&x.card.numeral===6))continue;
        const fits=combo.some((x,n)=>x.card.numeral===evo.numeral&&combo.reduce((s,y,m)=>s+(m===n?0:ruW(y.card)),0)===evo.materialW);
        const key=ids.slice().sort().join('|');
        if(fits&&!seen.has(key)){seen.add(key);out.push({evo,ei,combo});}
      }
    }
    return out;
  }
  function enter(w,c,elements){
    c._fullmetalEntered=turn();c._fullmetalOwner=w;
    c._fullmetalOwnerTurns=0;c._fullmetalLastOwnerTurn=turn();
    const ochres=elements.filter(x=>x.class==='ochre'&&x.numeral===9);
    if(ochres.length){
      let i=0;
      const next=()=>{
        if(i===ochres.length)return;
        const element=ochres[i++];
        F.offerSkill(w,element,'Ochre 9 - Fullmetal Element','Give this Fullmetal +1 W, then every player gains MP equal to the W-stat total across all Battlefields. S: +4 MP.','Use Ochre 9',{
          effect:done=>{
            if(metal(w)===c){
              c._wField=(c._wField||0)+1;
              const total=all().reduce((sum,s)=>sum+ruWTotal(s),0);
              all().forEach(s=>{G[s].mp+=total;});
              F.say('Ochre 9: Fullmetal gains 1 W; every player gains '+total+' MP.','heal');
            }
            done();
          },done:next,
        },next);
      };
      window.ruWhenSettled(window.ruTableClear,next,{defer:true});
    }
  }
  ruHook('entered',(c,w)=>{
    if(isMetal(c)&&c._fullmetalEntered!==turn()){
      c._fullmetalEntered=turn();c._fullmetalOwner=w;c._fullmetalOwnerTurns=0;
      c._fullmetalLastOwnerTurn=turn();c._fullmetalProtectionExpired=false;
    }
  });
  function protectedCard(c,w,cause){
    if(!isMetal(c)||c._fullmetalEntered==null)return false;
    if(c._fullmetalEntered===turn())return true;
    if(!c.protectedFrom.includes(cause))return false;
    // The first later owner turn is number one; expiry occurs after the Wth owner End Phase.
    return (c._fullmetalOwnerTurns||0)<=ruW(c)&&!c._fullmetalProtectionExpired;
  }
  function morale(w,n,cause,b){
    if(!G[w]||!(n>0))return n;
    const s=state(w);let out=n;
    if(s.noMorale||(s.noSkillMorale&&cause==='numeral'))out=0;
    if(cause==='battle'&&b){
      if(s.noAdditionalMorale){
        const printed=w===b.dWho?Math.max(0,(b.attPrintedNP||0)-(b.defPrintedNP||0)):Math.max(0,(b.defPrintedNP||0)-(b.attPrintedNP||0));
        out=Math.min(out,printed);
      }
      const snap=G._fullmetalAttackSnap;
      if(s.noAddonFrom&&w===b.dWho&&s.noAddonFrom===b.aWho){
        const addon=snap&&snap.aWho===b.aWho?snap.addons.filter(x=>x.zone!=='rank').reduce((t,x)=>t+x.np,0):(b.addonNP||0);
        out=Math.min(out,Math.max(0,n-addon));
      }
    }
    if(s.shield>0&&out>0){const used=Math.min(s.shield,out);s.shield-=used;out-=used;}
    if(out<n)F.say('Fullmetal: prevented '+(n-out)+' Morale Damage.','heal');
    return out;
  }
  function casualty(w,meta){
    const target=w;
    if(!G[target])return true;
    const s=state(target),cause=meta&&meta.source||source(),additional=meta&&meta.additional!=null?meta.additional:cause==='action'||cause==='numeral';
    let stop=additional&&(s.noAdditionalCas||(s.noAttackAdditionalCas&&cause==='battle')||(s.noEffectAdditionalCas&&(cause==='action'||cause==='numeral')));
    if(!stop&&s.lessCas>0){s.lessCas--;stop=true;}
    if(stop){if(additional)s.negatedAdditional++;F.say('Fullmetal: Casualty Draw negated before drawing.','heal');return false;}
    return true;
  }
  function effect(w,c,fn){
    const prev=G._fullmetalSource;G._fullmetalSource=c.type==='area'?'area':c.type==='action'?'action':'numeral';
    try{fn();}finally{G._fullmetalSource=prev;}
  }
  function beginSource(kind){
    const token=G._fullmetalSourceSeq=(G._fullmetalSourceSeq||0)+1;
    G._fullmetalPendingSource={kind,token};
    window.ruWhenSettled(()=>window.ruTableClear()&&G.mode!=='oppzonepick',()=>{
      if(G._fullmetalPendingSource&&G._fullmetalPendingSource.token===token)G._fullmetalPendingSource=null;
    },{defer:true});
  }
  function areaEffect(w,c,fn){beginSource('area');return effect(w,c,fn);}
  function negated(w,entry){if(entry&&entry.additional)state(w).negatedAdditional++;}
  function matchingCost(w,c){
    return (G[w].hand||[]).concat(field(w).filter(x=>F.isNum(x.card)&&!protectedCard(x.card,w,'numeral')&&!ruUnremovable(x.card,w,x.zone,true)).map(x=>x.card))
      .filter(x=>F.isNum(x)&&F.rp(x)===F.rp(c));
  }
  function legal(w,c,which){
    if(!isMetal(c)||metal(w)!==c||G.gameOver||ruSkillLocked(w,c))return false;
    if(which===2)return c._fullmetalSkill2Turn!==turn()&&matchingCost(w,c).length>0;
    if(c.skill1OncePerTurn&&c._fullmetalSkill1Turn===turn())return false;
    if(!(c.elements||[]).length)return false;
    const p=G[w],n=c.numeral;
    if(p.deck.length<({1:1,2:1,4:2,6:3,8:1}[n]||0))return false;
    if(n===5&&(!(G._fullmetalPendingAttack)||(G._defState&&G._defState.negate)||!p.discard.some(safeguard)))return false;
    if(n===7&&((!p.deadzone.some(x=>x.name!=='The Lowlands')&&p.cas<0)||!state(w).attackers.length))return false;
    if((n===8||n===9)&&!p.hand.some(safeguard))return false;
    if(n===9&&(!G._fullmetalPendingAttack||G._fullmetalPendingAttack.dw!==w))return false;
    return true;
  }
  function chooseCost(w,c,which,cb){
    if(which===2){F.pick(w,c.name+' Skill 2: drop a matching-RP Numeral',matchingCost(w,c),1,1,pk=>cb(pk&&pk[0]?{numeral:pk[0]}:null));return;}
    F.pick(w,c.name+': choose an Element',c.elements,1,1,pk=>{
      if(!pk||!pk[0]){cb(null);return;}
      const choice={element:pk[0]},p=G[w];
      if(c.numeral===5)F.pick(w,c.name+': return a Safeguard from Drop to Deck',p.discard.filter(safeguard),1,1,a=>cb(a&&a[0]?Object.assign(choice,{safeguard:a[0]}):null));
      else if(c.numeral===8||c.numeral===9)F.pick(w,c.name+': choose a Safeguard from hand',p.hand.filter(safeguard),1,1,a=>cb(a&&a[0]?Object.assign(choice,{safeguard:a[0]}):null));
      else cb(choice);
    });
  }
  function payCost(w,c,which,x){
    if(!legal(w,c,which))return false;
    const p=G[w];
    if(which===2){
      if(!matchingCost(w,c).includes(x.numeral))return false;
      const np=F.np(x.numeral);
      if(p.hand.includes(x.numeral))F.fromHand(p,x.numeral,'discard');
      else if(!F.fieldTo(w,x.numeral,'discard'))return false;
      x.np=np;return true;
    }
    const n=c.numeral,i=c.elements.indexOf(x.element);
    if(i<0)return false;
    if(n===5&&!p.discard.includes(x.safeguard))return false;
    if((n===8||n===9)&&!p.hand.includes(x.safeguard))return false;
    c.elements.splice(i,1);
    if([5,7,9].includes(n))dzAdd(p,x.element);
    else if(n===6)bankInsert(p,x.element);
    else ruDrop(p,x.element);
    F.millN(w,({1:1,2:1,4:2,6:3,8:1}[n]||0));
    if(n===5){p.discard.splice(p.discard.indexOf(x.safeguard),1);F.intoDeck(p,x.safeguard);}
    if(n===8){
      F.fromHand(p,x.safeguard,'deadzone');
      (c._fullmetalSafeguards||(c._fullmetalSafeguards=[])).push(x.safeguard);
    }
    if(n===9)F.fromHand(p,x.safeguard,'discard');
    return true;
  }
  function applySkill(w,c,which,x,done){
    const p=G[w],s=state(w),n=c.numeral;
    if(which===2){s.shield+=Math.max(0,x.np);done();return;}
    if(n===1){
      const drawn=p.deck[0];draw(w,1);
      if(safeguard(drawn))F.ask(w,c.name,'Negate one Casualty Draw this turn?','Take 1 less Casualty',()=>{s.lessCas++;done();},done);else done();
    }else if(n===2){
      F.choosePlayer(w,c.name,all().filter(t=>t!==w),sideSubjectLabel,t=>{s.noAddonFrom=t;done();});
    }else if(n===3){s.noEffectAdditionalCas=true;done();}
    else if(n===4){s.noSkillMorale=true;done();}
    else if(n===5){G._defState=G._defState||{};G._defState.negate=true;G._defState.negateLabel=c.name;done();}
    else if(n===6){
      draw(w,1);F.choose(w,c.name,'Choose damage protection.',[
        {label:'No Additional Morale Damage from attacks',fn:()=>{s.noAdditionalMorale=true;done();}},
        {label:'No Additional Casualty Damage from attacks',fn:()=>{s.noAttackAdditionalCas=true;done();}},
      ]);
    }else if(n===7){
      F.pick(w,c.name+': add a Deadzone card to hand',p.deadzone.filter(x=>x.name!=='The Lowlands'),1,1,pk=>{
        const card=pk&&pk[0];if(!card){done();return;}F.fromDeadzone(p,card);p.hand.push(card);
        F.choosePlayer(w,c.name,s.attackers.filter(t=>G[t]),sideSubjectLabel,t=>{
          if(!t){done();return;}
          F.choose(w,c.name,'Choose the MP-loss basis.',[
            {label:'Additional Casualties negated: '+s.negatedAdditional,fn:()=>{F.damage(t,s.negatedAdditional,c.name,true);done();}},
            {label:'Safeguards in all hands',fn:()=>{F.damage(t,all().reduce((v,t)=>v+G[t].hand.filter(safeguard).length,0),c.name,true);done();}},
          ]);
        });
      });
    }else if(n===8){s.noMorale=true;done();}
    else if(n===9){s.noAdditionalCas=true;s.repay=true;done();}
  }
  function use(w,c,which,done){
    if(!legal(w,c,which)){if(done)done();return false;}
    return F.useSkill(w,c,{
      choose:cb=>chooseCost(w,c,which,cb),
      cost:(paid,x)=>{
        if(!payCost(w,c,which,x)){paid(false);return;}
        if(window.ruUiBusy())window.ruWhenSettled(window.ruTableClear,()=>paid(true,x),{defer:true});
        else paid(true,x);
      },
      s:which===2||c.numeral===9?0:undefined,
      mark:()=>{c[which===2?'_fullmetalSkill2Turn':'_fullmetalSkill1Turn']=turn();},
      effect:(next,x)=>applySkill(w,c,which,x,next),done:done||function(){},
    });
  }
  function openSkills(w,c,done){
    if(metal(w)!==c){if(done)done();return;}
    const opts=[];
    if(legal(w,c,1))opts.push({label:'Skill 1: '+c.name,fn:()=>use(w,c,1,()=>openSkills(w,c,done))});
    if(legal(w,c,2))opts.push({label:'Skill 2: '+c.name,fn:()=>use(w,c,2,()=>openSkills(w,c,done))});
    if(!opts.length){if(done)done();else F.say(c.name+': no payable skill is available.','info');return;}
    opts.push({label:'Pass',fn:()=>{if(done)done();}});
    F.choose(w,c.name+' skills',c.skillCost+' '+c.skillText+'<br><br>Skill 2 (M: +0): '+c.skillCost2+' '+c.skillText2,opts);
  }
  function attackSnap(s){
    G._fullmetalAttackSnap={aWho:s.aWho,dWho:s.dWho,addons:s.addons.map(c=>({id:c.id,zone:F.zoneOf(G[s.aWho],c),np:F.np(c)}))};
    const st=state(s.dWho);if(!st.attackers.includes(s.aWho))st.attackers.push(s.aWho);
  }
  ruHook('targeted',(aw,az,dw,dz,resume)=>{
    const seats=all().filter(w=>metal(w));
    if(!seats.length)return false;
    G._fullmetalPendingAttack={aw,az,dw,dz};
    const s=state(dw);if(!s.attackers.includes(aw))s.attackers.push(aw);
    let i=0;
    const next=()=>{if(i===seats.length){G._fullmetalPendingAttack=null;resume();return;}const w=seats[i++];openSkills(w,metal(w),next);};
    next();return true;
  });
  ruHook('phaseBegan',ph=>{
    for(const w of all()){
      const c=metal(w);if(!c)continue;
      if(ph==='draw'&&G.turn===w&&c._fullmetalLastOwnerTurn!==turn()){
        c._fullmetalLastOwnerTurn=turn();c._fullmetalOwnerTurns=(c._fullmetalOwnerTurns||0)+1;
      }
    }
    // Off-turn seats receive owned choices, not a local-only menu or an AI fallback.
    const waiting=all().filter(w=>w!==G.turn&&metal(w));
    if(!waiting.length||ph==='end')return;
    const key=turn()+':'+ph+':'+(G._phaseSeq||0);
    if(G._fullmetalWindow===key)return;G._fullmetalWindow=key;
    window.ruWhenSettled(window.ruTableClear,()=>{
      if(G.gameOver||G.phase!==ph)return;
      let i=0;const next=()=>{if(i<waiting.length){const w=waiting[i++];openSkills(w,metal(w),next);}};next();
    },{defer:true});
  });
  function endTurn(){
    all().forEach(w=>{
      const s=state(w);
      if(s.repay&&!s.repaid){s.repaid=true;const n=ruMoraleLostThisTurn(w);G[w].mp+=n;F.say('Fullmetal 9: '+sideSubjectLabel(w)+' recovers '+n+' MP at End Phase.','heal');}
    });
    const c=metal(G.turn);
    if(c&&c._fullmetalEntered!==turn()&&(c._fullmetalOwnerTurns||0)>=ruW(c))c._fullmetalProtectionExpired=true;
  }
  function leave(w,c){
    if(!isMetal(c))return;
    (c.elements||[]).splice(0).forEach(element=>ruDrop(G[w],element));
    if(!(c._fullmetalSafeguards||[]).length)return;
    const cards=c._fullmetalSafeguards.splice(0);
    let i=0;
    const next=()=>{
      if(i===cards.length)return;
      const card=cards[i++];
      window.ruWhenSettled(window.ruTableClear,()=>{
        const mark=ruActMark();applyE2(w,card);
        window.ruWhenSettled(window.ruTableClear,()=>ruActFlush(mark,next),{defer:true});
      },{defer:true});
    };next();
  }
  ruHook('removed',(rec,c)=>leave(rec.owner,c));
  function openBuilder(){
    const deck=window.RU_PLAYER_DELTA_DECK||[],buttons=[];
    const body=FULLMETAL_LIBRARY.map(c=>{
      const count=deck.filter(id=>id===c.id).length;
      return '<section class="delta-list-card"><strong>'+c.name+' (Unknown)</strong><div>A:'+c.A+' | M:+'+c.M+' | S:'+(c.SText||'+'+c.S)+' | W:'+c.W+' | Rank:'+c.rank+'</div><p>'+c.requirements+'</p><p>'+c.protection+'</p><p>Cost: '+c.skillCost+'</p><p>Skill 1: '+c.skillText+'</p><p>Skill 2 (M: +0): '+c.skillCost2+' '+c.skillText2+'</p><button class="mb" onclick="addDeltaPick(\''+c.id+'\',\'fullmetal\')" '+(deck.length>=3?'disabled':'')+'>Add '+c.name+'</button>'+(count?'<button class="mb" onclick="removeDeltaPick(\''+c.id+'\',\'fullmetal\')">Remove '+c.name+' ('+count+')</button>':'')+'</section>';
    }).join('');
    buttons.push({label:'Back',fn:()=>window.deltaBuilderHome()},{label:'Close',fn:()=>closeModal()});
    if(typeof _modalQueue!=='undefined')_modalQueue=[];
    _modalOpen=true;_showModalNow('Delta Deck - Fullmetal ('+deck.length+'/3)','<div class="delta-scroll fullmetal-pool">'+body+'</div>',buttons);
    document.getElementById('modal').classList.add('open');
  }
  window.findFullmetalOptions=materials;
  window.RUFullmetal={materials,enter,protected:protectedCard,source,morale,casualty,negated,effect,areaEffect,beginSource,legal,use,openSkills,openBuilder,attackSnap,state,leave,endTurn};
})();
