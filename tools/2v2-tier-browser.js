'use strict';
// Starts actual solo 2v2 games via the menu; verifies assignments, not playing strength.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {createHash}=require('node:crypto');
const buildId=root=>{const hash=createHash('sha256');for(const name of ['index.html','ai/state.js','ai/moves.js','ai/brain.js','ai/tiers.js'])hash.update(fs.readFileSync(path.join(root,name)));return hash.digest('hex');};
async function main(){
  const root=path.resolve(__dirname,'..'),build=buildId(root),errors=[];
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
    for(const mode of ['tag2v2','team2v2'])for(const [family,level] of [['talented',2],['distinguished',4],['basic',1],['skilled',2],['talented',1]]){
      const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/');
      await page.locator('.cc[data-k="light"]').click();
      await page.locator('#ru135-mode-select').selectOption(mode);
      await page.locator('#ai-level-select').selectOption(family);
      await page.locator('#ai-sublevel-select').selectOption(String(level));
      await page.locator('#start-btn').click();
      const assigned=await page.evaluate(()=>{RUBots.stop();return {bots:G._botSeats,mode:G.twoVtwo,
        evos:Object.fromEntries(['ai','ai2','ai3'].map(s=>[s,G[s].evolutions.length]))};});
      const key=family+'-'+level;
      assert.deepEqual(assigned.bots,{ai:key,ai2:key,ai3:key});
      assert.equal(assigned.mode,mode==='tag2v2'?'tag':'team');
      assert.equal(assigned.evos.ai2,assigned.evos.ai,'D uses the selected-tier Delta Deck allowance');
      console.log('PASS browser menu',mode,key,JSON.stringify(assigned));
      await page.close();
    }
    assert.deepEqual(errors,[]);assert.equal(buildId(root),build);
    console.log('PASS 2v2 browser tier assignments',build);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
