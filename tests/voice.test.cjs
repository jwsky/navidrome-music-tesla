const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const voice = html.slice(html.indexOf('/* ---------- 可选语音：'), html.indexOf('/* ---------- 设置 ---------- */'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(yes => {resolve=yes;}); return {promise,resolve};}
function load() {
  const requests=[],searches=[],messages=[],timers=new Map(), elements=new Map();
  let timer=0;
  const c=vm.createContext({URL,Blob,AbortController,Promise,Set,Date,
    cfg:{voiceOn:true,voiceUrl:'https://voice.example.test',voiceToken:'device-example-token',url:'https://library.example.test',user:'one'},
    generation:0,seq:0,playSeq:0,bedtime:{songs:[{id:'1'}]},list:[{id:'1'}],
    document:{hidden:false,addEventListener(){}},window:{isSecureContext:true,addEventListener(){}},navigator:{},
    setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    $(id){if(!elements.has(id))elements.set(id,{disabled:false,title:'',setAttribute(){},scrollIntoView(){},addEventListener(){},classList:{add(){},remove(){},contains(){return false;}}});return elements.get(id);},
    configured:()=>true,openSettings(){c.opened=true;},toast(s){messages.push(s);},P:{pause(){c.pauses=(c.pauses||0)+1;}},
    doSearch:async q=>{searches.push(q);},showBedtime(){c.favoritesShown=true;},refreshBedtime:async()=>{},play(){c.favoritesPlayed=true;},
    fetch:async (url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({command:null})};},
  });
  vm.runInContext(voice+'\nwindow.reset=resetVoice;window.poll=pollVoice;window.start=startVoice;window.request=voiceRequest;',c);
  return {c,requests,searches,messages,timers,elements};
}
function pending(query='Edelweiss') {return {id:'command-example',type:'search',query,expiresAt:Date.now()/1000+120};}

test('voice is inert when disabled and its microphone opens optional settings',async()=>{
  const {c,requests,timers}=load();c.cfg.voiceOn=false;c.window.reset();
  await c.window.poll();await c.window.start();
  assert.equal(requests.length,0);assert.equal(timers.size,0);assert.equal(c.opened,true);
});
test('voice bearer token travels only in a header and music credentials are excluded',async()=>{
  const {c,requests}=load();c.cfg.pass='music-password-example';await c.window.request('/health');
  assert.equal(requests[0].url,'https://voice.example.test/health');
  assert.equal(requests[0].options.headers.Authorization,'Bearer device-example-token');
  assert.equal(requests[0].options.credentials,'omit');
  assert(!JSON.stringify(requests).includes(c.cfg.pass));
  c.cfg.voiceUrl='https://user:password@voice.example.test';
  await assert.rejects(c.window.request('/health'),/HTTP/);
});
test('two polls play a claimed command only once',async()=>{
  const {c,searches}=load();let accepted=false;
  c.fetch=async url=>({ok:true,json:async()=>url.endsWith('/ack')?{accepted:!accepted&&(accepted=true)}:{command:pending()}});
  await c.window.poll();await c.window.poll();assert.deepEqual(searches,['Edelweiss']);
});
test('expired and unknown remote commands are never accepted or executed',async()=>{
  const {c,searches}=load();const requests=[];
  for(const command of [{...pending(),expiresAt:0},{...pending(),type:'delete'}]){
    c.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>({command})};};await c.window.poll();
  }
  assert.equal(searches.length,0);assert(requests.every(url=>!url.endsWith('/ack')));
});
test('an old-account poll cannot claim or execute its response after settings change',async()=>{
  const {c,searches}=load(), wait=deferred(),urls=[];
  c.fetch=async url=>{urls.push(url);return {ok:true,json:()=>wait.promise};};
  const job=c.window.poll();await flush();c.cfg.user='two';++c.generation;c.window.reset();
  wait.resolve({command:pending()});await job;
  assert.equal(urls.length,1);assert.equal(searches.length,0);
});
test('favorites intent uses the native collection rather than a configured display name',async()=>{
  const {c}=load();c.cfg.favoriteName='A label only';
  c.fetch=async url=>({ok:true,json:async()=>url.endsWith('/ack')?{accepted:true}:{command:{...pending(),type:'favorites'}}});
  await c.window.poll();assert(c.favoritesShown);assert(c.favoritesPlayed);
});

function microphone(c,mime='audio/mp4') {
  const stopped=[];c.navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){stopped.push(true);}}]})};
  class Recorder {
    static isTypeSupported(type){return type===mime;}
    constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';c.recorder=this;}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'],{type:this.mimeType})});this.onstop();}
  }
  c.MediaRecorder=c.window.MediaRecorder=Recorder;return stopped;
}
test('Safari MP4 recording stops the microphone and forwards the original format',async()=>{
  const {c,requests,searches}=load(),stopped=microphone(c);
  c.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({command:{type:'search',query:'Auld Lang Syne'}})};};
  await c.window.start();await c.window.start();await flush();await flush();
  assert(stopped.length);assert.equal(c.recorder.state,'inactive');
  assert.equal(requests[0].options.headers['Content-Type'],'audio/mp4');assert.equal(await requests[0].options.body.text(),'audio');
  assert.deepEqual(searches,['Auld Lang Syne']);
});
test('a microphone permission response arriving after cancellation releases tracks without uploading',async()=>{
  const {c,requests}=load(),wait=deferred(),stopped=[];microphone(c);
  c.navigator.mediaDevices.getUserMedia=()=>wait.promise;
  const job=c.window.start();await flush();c.window.reset(false);
  wait.resolve({getTracks:()=>[{stop(){stopped.push(true);}}]});await job;
  assert.equal(stopped.length,1);assert.equal(requests.length,0);
});
test('a late transcription cannot replace a song the user selected in the meantime',async()=>{
  const {c,searches}=load(),wait=deferred();microphone(c);
  c.fetch=async()=>({ok:true,json:()=>wait.promise});
  await c.window.start();await c.window.start();await flush();++c.playSeq;
  wait.resolve({command:{type:'search',query:'Old request'}});await flush();await flush();
  assert.equal(searches.length,0);
});

test('voice search starts its first result even if that song was already selected and paused',async()=>{
  const {c}=load(), started=[];
  const search=html.slice(html.indexOf('async function doSearch('),html.indexOf('/* ---------- 进度 / 歌词推进 ---------- */'));
  Object.assign(c,{idx:-1,view:'library',
    searchLocal:async()=>[{id:'1',src:'lib',title:'Already selected'}],aiCorrect:async()=>null,
    keyOf:s=>s&&s.id,cur:()=>({id:'1'}),render(){},markPlaying(){},isMobile:()=>false,
    ytKeys:()=>[],extBase:()=>'',setList(items){c.list=items;c.idx=-1;},
    play(i){started.push(c.list[i].id);c.idx=i;},
  });
  vm.runInContext(search,c);
  await c.doSearch('Already selected');assert.equal(started.length,0);
  await c.doSearch('Already selected',true);assert.deepEqual(started,['1']);
});
