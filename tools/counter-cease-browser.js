'use strict';
// Real Chromium host/worker integration on constructed positions, not natural matches.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
async function main(){
  const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{
    const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(f,(err,b)=>{if(err){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/octet-stream');res.end(b);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  const out=path.join(root,'tools/headless/data');fs.mkdirSync(out,{recursive:true});
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
    for(const mode of ['standard','royale4','tag2v2','team2v2']){
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&m.text().includes('bot'))console.error(mode,m.text());});
      await page.goto('http://127.0.0.1:'+server.address().port+'/');
      const actor=mode==='standard'?'ai':'ai2';
      await page.evaluate(({mode,actor})=>{
        RU_NET_CONFIG={seed:31,mySeat:0,spectator:false,seat0Class:'temporal',seat1Class:'ochre',
          firstSeat:0,name0:'Human',name1:'Bot',allowEvolutions:false,deltaDecks:{player:[],ai:[],ai2:[],ai3:[]},
          mode,order:mode==='standard'?['player','ai']:['player','ai2','ai3','ai'],
          classes:{player:'temporal',ai:'ochre',ai2:'restorative',ai3:'zero'},solo:{bots:{}}};
        try{startGame();}finally{RU_NET_CONFIG=null;}
        RUBots.stop();closeModal();document.getElementById('picker-modal').classList.remove('open');SF=null;ruSettleReset();
        G.turn='player';G.mode='normal';G.phase='battle';G._turnNo=5;G.exchange=3;G.firstTurn=false;
        G._turnsCompletedBy={player:2,ai:2,ai2:2,ai3:2};
        for(const s of G.sideOrder||['player','ai']){
          G[s].mp=30;G[s].cas=0;G[s].hand=[];G[s].deadzone=[];G[s].discard=[];
          G[s].leftFlank=null;G[s].rightFlank=null;G[s].bank=[];
          G[s].rankZone=mkNum({n:s==='player'?6:5,r:s==='player'?2:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
          G[s].deck=Array.from({length:24},()=>mkNum(CLASSLESS[1],'classless'));
        }
        G[actor].bank=[mkNum({n:7,r:2,A:1,M:0,S:null,ca:true,st:'Basic'},'classless')];
        G[actor].hand=[mkAct('Counterstrike')];
        G._botSeats={};renderAll();RUBots.attach();
        window.testInput=a=>{ruSettleNow();RUBots.noteInput(a);ruCanApplyNow({});ruApplyAction(a);};
        testInput({t:'atkMode',s:'player'});testInput({t:'zone',s:'player',o:'player',z:'rank'});
        testInput({t:'zone',s:'player',o:actor,z:'rank'});
      },{mode,actor});
      for(let i=0;i<30;i++){
        await page.waitForTimeout(100);
        const d=await page.evaluate(()=>__M.decider());
        if(d.kind==='pick'){await page.evaluate(s=>testInput({t:'pick',s,ix:[0]}),d.seat);continue;}
        if(d.kind==='modal'){
          const ix=d.labels.findIndex(x=>/Counterstrike|Activate E2 Effect/.test(x));
          const pass=d.labels.findIndex(x=>/^(Continue|Pass|Skip|Decline)/.test(x));
          assert.ok(ix>=0||pass>=0,JSON.stringify(d));
          await page.evaluate(a=>testInput(a),{t:'modal',s:d.seat,i:ix>=0?ix:pass});continue;
        }
        if(await page.evaluate(()=>!!G._counterFrame))break;
      }
      assert.equal(await page.evaluate(()=>G._counterFrame&&G._counterFrame.stage),'attacker');
      const started=Date.now();
      await page.screenshot({path:path.join(out,'counter-bot-'+mode+'-before.png'),fullPage:true});
      await page.evaluate(s=>{G._botSeats[s]='basic-1';},actor);
      try{
        for(let i=0;i<225;i++){
          const state=await page.evaluate(()=>({frame:!!G._counterFrame,busy:window._RUcbusy,queued:window._RUcq.length,d:__M.decider()}));
          if(!state.frame&&!state.busy&&!state.queued)break;
          if(state.d.kind==='modal'&&state.d.seat!==actor){
            const ix=state.d.labels.findIndex(x=>/^(Continue|Pass|Skip|Decline)/.test(x));
            if(ix>=0)await page.evaluate(a=>testInput(a),{t:'modal',s:state.d.seat,i:ix});
          }
          await page.waitForTimeout(200);
        }
        assert.equal(await page.evaluate(()=>!!G._counterFrame||window._RUcbusy||window._RUcq.length>0),false);
      }
      catch(e){console.error(mode,await page.evaluate(()=>({log:document.getElementById('log').textContent,history:RUBots.history(),last:RUBots.request(1)})));throw e;}
      const result=await page.evaluate(()=>{RUBots.stop();return {history:RUBots.history(),divergence:RUBots.lastDivergence(),mode:G.mode,
        queue:window._RUcq.length,busy:window._RUcbusy,log:document.getElementById('log').textContent};});
      assert.deepEqual(errors,[]);assert.equal(result.divergence,null);
      assert.ok(result.history.some(x=>/"t":"zone"/.test(x)),'worker selects a counterattack board card');
      assert.ok(!/bot is stuck|Bot error:|bot lost track/i.test(result.log));
      await page.screenshot({path:path.join(out,'counter-bot-'+mode+'-after.png'),fullPage:true});
      console.log('PASS real bot counterattack',mode,Date.now()-started+'ms',JSON.stringify(result.history));
      if(mode==='standard'){
        await page.evaluate(()=>{ruSettleReset();closeModal();G.mode='normal';G.turn='ai';G.player.class='maximum';
          G.player.deadzone=[mkNum(CLASSLESS[1],'classless'),mkNum(CLASSLESS[2],'classless'),mkAct('Cease')];G.player.cas=3;
          ruOwnPrompt('player');applyE2('player',G.player.deadzone[2]);});
        await page.locator('#picker-modal.open').waitFor();
        assert.match(await page.locator('#pk-title').innerText(),/Cease/);
        const pre=await page.evaluate(()=>({names:PCK.pool.map(c=>c.name),dead:G.player.deadzone.map(c=>c.name)}));
        assert.deepEqual(pre.dead,['Numeral 1','Numeral 2']);
        await page.screenshot({path:path.join(out,'cease-e2-owner-picker.png'),fullPage:true});
        await page.evaluate(()=>ruApplyAction({t:'pick',s:'player',ix:[1]}));
        assert.deepEqual(await page.evaluate(()=>G.player.deadzone.map(c=>c.name)),['Numeral 1']);
        console.log('PASS browser Cease E2 displays owner picker and drops selected second card');
        await page.evaluate(()=>{G.turn='player';G.phase='main';G.mode='normal';
          const card=makeAreaSupportCardRA('area-amalgamation-nation','maximum');card._ownerSeat='player';
          G.player.deadzone=[card];G.player.cas=1;runDeadzoneAreaEffect('player',card.id,0);});
        const icon=page.locator('.ru-areafx-icon').last();await icon.waitFor();
        assert.equal(await icon.textContent(),'\uE017','Amalgamation Nation uses the Amalgamation family glyph');
        await page.screenshot({path:path.join(out,'amalgamation-nation-effect-icon.png'),fullPage:true});
        console.log('PASS browser Amalgamation Nation effect icon is its own family, not the user class');
        await page.evaluate(()=>{closeModal();ruSettleReset();G.turn='ai';G.phase='battle';G.mode='normal';
          const card=mkAct('Stall');G.player.deadzone=[card];G.player.cas=1;G.player.deck.unshift(mkAct('Protect'));
          ruOwnPrompt('player');applyE2('player',card);});
        await page.locator('#modal.open').waitFor();
        await page.locator('#m-btns button').filter({hasText:'Drop a Deadzone card'}).click();
        await page.locator('#picker-modal.open').waitFor();
        assert.equal(await page.evaluate(()=>PCK.pool[0].type),'shell');
        await page.screenshot({path:path.join(out,'stall-e2-safeguard-shell-choice.png'),fullPage:true});
        await page.evaluate(()=>ruApplyAction({t:'pick',s:'player',ix:[0]}));
        assert.equal(await page.evaluate(()=>G.player.cas),-1);
        console.log('PASS browser Stall E2 follows Safeguard draw with owned optional removal');
      }
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
