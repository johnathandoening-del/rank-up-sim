'use strict';
// Constructed browser positions, not natural-play or bot-strength evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
async function main(){
  const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
    for(const cls of ['restorative','shadow']){
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/');
      await page.evaluate(cls=>{
        RU_NET_CONFIG={seed:31,mySeat:0,spectator:false,seat0Class:cls,seat1Class:'light',firstSeat:0,
          name0:'P1',name1:'P2',allowEvolutions:false,deltaDecks:{player:[],ai:[]},solo:{bots:{}}};
        try{startGame();}finally{RU_NET_CONFIG=null;}
        RUBots.stop();closeModal();ruSettleReset();SF=null;
        G.turn='ai';G.phase='battle';G.mode='normal';G._turnNo=5;G.exchange=3;G.firstTurn=false;
        G.player.hand=[];G.player.discard=[];window.testRecover=mkAct('Recover');
        G.player.deadzone=[testRecover];G.player.cas=1;
        ruOwnPrompt('player');applyE2('player',testRecover);
      },cls);
      await page.locator('#picker-modal.open').waitFor();
      assert.deepEqual(await page.evaluate(()=>PCK.pool.map(c=>c.type)),['shell']);
      await page.locator('#pk-cards > div').first().click();
      await page.locator('#pk-confirm').click();
      assert.match(await page.locator('#pk-title').innerText(),/Recover E2/);
      assert.deepEqual(await page.evaluate(()=>PCK.pool.map(c=>c.name)),['Recover']);
      assert.equal(await page.locator('#pk-confirm').isDisabled(),true);
      const out=path.join(root,'tools/headless/data');fs.mkdirSync(out,{recursive:true});
      await page.screenshot({path:path.join(out,'recover-e2-'+cls+'-self-picker.png'),fullPage:true});
      await page.locator('#pk-cards > div').first().click();
      await page.locator('#pk-confirm').click();
      assert.equal(await page.evaluate(()=>G.player.hand.includes(testRecover)),true);
      assert.equal(await page.locator('#picker-modal').evaluate(e=>e.classList.contains('open')),false);
      assert.deepEqual(errors,[]);
      console.log('PASS Recover E2 real picker click and confirmation',cls);
      await page.close();
    }
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
