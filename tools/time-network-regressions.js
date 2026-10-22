'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const WebSocket=require('ws');
const port=8877,base='ws://localhost:'+port;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn(process.execPath,['-e',`const RealDate=Date;let offset=0;global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[RealDate.now()+offset]));}static now(){return RealDate.now()+offset;}};process.on('message',m=>{offset+=m.advance||0;process.send({advanced:offset});});require('./server/room-server');`],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
const clients=[];let serverError='';child.stderr.on('data',d=>serverError+=d);
async function until(fn,label){for(let i=0;i<300;i++){const value=fn();if(value)return value;await pause(20);}throw Error('Timeout '+label+' '+serverError);}
async function advance(ms){await new Promise(resolve=>{child.once('message',resolve);child.send({advance:ms});});await pause(180);}
async function client(room,id,time,spectator=false){
  const ws=new WebSocket(base),messages=[];clients.push(ws);
  const loadout={cls:'light',timeControl:time};
  ws.on('message',data=>{const m=JSON.parse(data);messages.push(m);if(m.type==='loadout-request')ws.send(JSON.stringify({type:'loadout',...loadout}));});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const send=m=>ws.send(JSON.stringify(m));send({type:'join',room,clientId:id,name:id,spectator,...loadout});
  await until(()=>messages.find(m=>m.type==='joined'),'join');
  return {ws,messages,send,setup:()=>messages.find(m=>m.type==='start'||m.type==='resume'),progress:p=>send({type:'clock-progress',progress:p})};
}
async function pair(room,time,other){
  const a=await client(room,room+'A',time),b=await client(room,room+'B',other||time);
  await until(()=>a.setup()&&b.setup(),'start');return [a,b];
}
(async()=>{
  await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('listening'))resolve();});child.once('exit',()=>reject(Error('server exited '+serverError)));});
  const off={enabled:false,type:'turn',minutes:3},turn={enabled:true,type:'turn',minutes:3};
  const [u,v]=await pair('CLOCKOFF',off,{enabled:true,type:'player',minutes:10});
  assert.equal(u.setup().timeControl.enabled,false);assert.equal(v.setup().timeControl.enabled,false,'joiner cannot enable time');
  const [a,b]=await pair('CLOCKTURN',turn,{enabled:true,type:'game',minutes:35});
  assert.equal(b.setup().timeControl.type,'turn');assert.equal(b.setup().timeControl.minutes,3);
  const seat=a.setup().firstSeat?'ai':'player',p={turn:seat,turnNo:0,stage:'main',ended:false};
  a.progress(p);b.progress(p);await pause(80);
  a.send({type:'action',action:{t:'adv',sig:'example'}});
  await until(()=>a.messages.some(m=>m.type==='action'&&m.action.t==='adv')&&b.messages.some(m=>m.type==='action'&&m.action.t==='adv'),'server echo to both timed clients');
  const observer=await client('CLOCKTURN','OBSERVER',off,true);
  assert.equal(observer.setup().timeControl.type,'turn');
  observer.progress({turn:seat==='ai'?'player':'ai',turnNo:1,ended:true});await pause(30);
  await advance(180100);
  const timeout=await until(()=>a.messages.find(m=>m.type==='action'&&m.action.t==='clockExpire'),'turn expiry');
  assert.equal(timeout.action.event.stage,'main');assert.equal(timeout.from,'server');
  a.send({type:'action',action:{t:'adv'}});await until(()=>a.messages.some(m=>m.type==='action-rejected'),'expired input rejected before application');
  a.progress({...p,stage:'grace'});b.progress({...p,stage:'grace'});await pause(60);await advance(15100);
  assert(a.messages.some(m=>m.type==='action'&&m.action.t==='clockExpire'&&m.action.event.stage==='grace'));
  const n={turn:seat==='ai'?'player':'ai',turnNo:1,stage:'main',ended:false};a.progress(n);b.progress(n);await pause(60);
  await advance(20000);b.ws.close();await until(()=>a.messages.some(m=>m.type==='peer'&&m.event==='disconnect'),'disconnect');
  const paused=a.messages.filter(m=>m.type==='clock').at(-1).clock;
  assert.equal(paused.status,'paused');const left=paused.left;
  await advance(60000);
  const rejoined=await client('CLOCKTURN','CLOCKTURNB',{enabled:true,type:'game',minutes:35});
  assert.equal(rejoined.setup().timeControl.type,'turn');assert.equal(rejoined.setup().clock.left,left,'offline interval not charged');
  assert(rejoined.setup().log.some(e=>e.action.t==='clockExpire'),'timeout log replayed on reconnect');
  rejoined.progress(n);a.progress(n);await pause(60);await advance(1000);
  a.progress(n);await pause(60);
  assert(a.messages.filter(m=>m.type==='clock').at(-1).clock.left<left,'resume restarts clock without resetting budget');
  for(const [type,minutes] of [['player',5],['game',7]]){
    const [x,y]=await pair('CLOCK'+type.toUpperCase(),{enabled:true,type,minutes});
    const active=x.setup().firstSeat?'ai':'player',progress={turn:active,turnNo:0,stage:'main',ended:false};
    x.progress(progress);y.progress(progress);await pause(60);await advance(minutes*60000+100);
    const ended=await until(()=>x.messages.find(m=>m.type==='action'&&m.action.t==='clockExpire'),'network '+type+' expiry');
    assert.equal(ended.action.event.type,type);
    if(type==='game'){
      x.progress({...progress,ended:true});await pause(50);
      const seed=x.setup().seed;
      x.send({type:'rematch',vote:true});y.send({type:'rematch',vote:true});
      await until(()=>x.messages.some(m=>m.type==='start'&&m.seed!==seed),'No Result permits rematch');
      assert(!x.messages.some(m=>m.type==='stats'),'No Result does not award ratings');
    }
  }
  console.log('PASS real WebSocket host-only rules, timed input echo/order, spectator isolation, main/grace expiry, stale-input rejection, disconnect pause and reconnect replay');
  console.log('PASS Per Player/Per Game server expiry and unrated Per Game rematch');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const ws of clients)ws.terminate();child.kill();});
