'use strict';
// Browser UI regression on a constructed position, not a natural-play match.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {createHash}=require('node:crypto');
const buildId=root=>{const hash=createHash('sha256');for(const name of ['index.html','ai/state.js','ai/moves.js','ai/brain.js','ai/tiers.js'])hash.update(fs.readFileSync(path.join(root,name)));return hash.digest('hex');};
async function main(){
  const root=path.resolve(__dirname,'..'),build=buildId(root);
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.locator('.cc[data-k="light"]').click();
    await page.evaluate(()=>{
      startGame();RUBots.stop();closeModal();document.getElementById('picker-modal').classList.remove('open');
      ruSettleReset();SF=null;G.mode='normal';G.turn='ai';G.phase='battle';G._turnNo=5;G.exchange=3;
      G._turnsCompletedBy={player:2,ai:2};G.firstTurn=false;
      G.player.mp=30;G.ai.mp=30;G.player.cas=G.ai.cas=0;G.player.deadzone=[];G.ai.deadzone=[];
      G.player.rankZone=mkNum({n:7,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      G.ai.rankZone=mkNum({n:1,r:1,A:1,M:0,S:null,ca:true,st:'Basic'},'classless');
      G.player.hand=[mkNum(CLASSLESS[1],'classless')];G.ai.hand=[];
      G.player.deck=[mkNum(CLASSLESS[1],'classless'),mkAct('Counterattack'),mkNum(CLASSLESS[2],'classless'),mkNum(CLASSLESS[3],'classless'),...G.player.deck];
      G.ai.deck=[mkNum(CLASSLESS[1],'classless'),...G.ai.deck];
      renderAll();for(let i=0;i<4;i++)casDraw('player');
    });
    await page.locator('#m-btns button').filter({hasText:'Continue'}).click();
    await page.locator('#m-btns button').filter({hasText:'Activate E2 Effect'}).click();
    await page.waitForFunction(()=>document.getElementById('picker-modal').classList.contains('open'));
    await page.evaluate(()=>{ruApplyAction({t:'pick',s:'player',ix:[0]});});
    await page.waitForFunction(()=>G.mode==='oppzonepick'&&G._counterFrame);
    const before=await page.evaluate(()=>({pending:G._counterFrame.queue.length,deck:G.player.deck.length,
      source:zId('player','rank'),target:zId('ai','rank'),green:document.getElementById(zId('player','rank')).classList.contains('hs')}));
    assert.equal(before.pending,2);assert.equal(before.green,true);
    assert.match(await page.locator('#hint').innerText(),/Select your counterattacker/);
    await page.locator('#btn-can').waitFor({state:'visible'});
    const out=path.join(root,'tools/headless/data');fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'counterattack-interrupt-browser.png'),fullPage:true});
    await page.locator('[id="'+before.source+'"]').click();
    await page.locator('[id="'+before.target+'"]').click();
    await page.waitForFunction(()=>G.ai.mp<30);
    assert.equal(await page.evaluate(()=>G.player.deck.length),before.deck);
    assert.deepEqual(errors,[]);assert.equal(buildId(root),build);
    console.log('PASS browser Counterattack green selection and suspended queue before damage',JSON.stringify({build,pending:before.pending,errors}));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
