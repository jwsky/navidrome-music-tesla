const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const search = html.slice(html.indexOf('async function doSearch('), html.indexOf('/* ---------- 进度 / 歌词推进'));
const controls = html.slice(html.indexOf('const P = {'), html.indexOf('/* ---------- 背景：封面高斯'));
const youtube = html.slice(html.indexOf('const ytKeys ='), html.indexOf('/* 自建后端（可选）'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const song = id => ({src:'lib', id, title:id});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => {resolve=yes; reject=no;});
  return {promise,resolve,reject};
}
function load() {
  const calls=[], messages=[], requests=[];
  const c=vm.createContext({Promise, Object, window:{}, cfg:{user:'one',yt:'fixture'}, seq:0, playSeq:0, playAttempt:0,
    list:[],idx:-1,playingItem:null,playback:null,view:'library',audio:{paused:false,pause(){this.paused=true;}},
    configured:()=>true,openSettings(){},render(){},markPlaying(){},setPlayIcon(){},toast:message=>messages.push(message),
    keyOf:item=>item?item.src+'|'+item.id:'',cur:()=>c.playingItem,isMobile:()=>false,
    setList(items) {c.list=items; c.idx=items.findIndex(s=>s.id===c.playingItem?.id);},
    play(i) {++c.playSeq; ++c.playAttempt; c.idx=i; c.playingItem=c.list[i]; calls.push(c.playingItem.id);},
    searchLocal:async()=>[],aiCorrect:async()=>null,searchYouTube:async()=>[],searchExt:async()=>[],
    ytKeys:()=>['fixture'],extBase:()=> 'https://plugin.example.test',resumePlayback(){},currentPlayback:()=>true,
  });
  vm.runInContext(controls+search+'\nwindow.controls=P;',c);
  return {c,calls,messages,requests,controls:c.window.controls};
}
test('a failed library search still permits independent optional source results',async()=>{
  const {c,calls}=load();c.searchLocal=async()=>{throw new Error('offline');};
  c.searchExt=async()=>[song('external')];
  await c.doSearch('example');
  assert.equal(c.list[0]?.id,'external');assert.deepEqual(calls,['external']);
});
test('a late plugin cannot override a manual choice made during a voice search',async()=>{
  const {c,calls}=load(), pending=deferred();
  c.searchYouTube=async()=>[song('first'),song('chosen')];c.searchExt=()=>pending.promise;
  const task=c.doSearch('example',true);await flush();c.play(1);
  pending.resolve([song('late')]);await task;
  assert.deepEqual(calls,['chosen']);assert.equal(c.playingItem.id,'chosen');
});
test('pausing while search results are pending prevents their automatic playback',async()=>{
  const {c,calls,controls}=load(), pending=deferred();c.searchLocal=()=>pending.promise;
  const task=c.doSearch('example');controls.pause();pending.resolve([song('late')]);await task;
  assert.deepEqual(calls,[]);assert.equal(c.list[0].id,'late');
});
test('leaving a pending search prevents subsequent correction and plugin requests',async()=>{
  const {c}=load(), pending=deferred(), requests=[];c.searchLocal=()=>pending.promise;
  c.aiCorrect=async()=>{requests.push('correct');return null;};
  c.searchYouTube=async()=>{requests.push('youtube');return [];};
  c.searchExt=async()=>{requests.push('external');return [];};
  const task=c.doSearch('old account query');++c.seq;Object.assign(c.cfg,{user:'two',yt:'new-fixture'});
  pending.resolve([song('old')]);await task;assert.deepEqual(requests,[]);
});
test('errors from an obsolete plugin request do not appear in the new view',async()=>{
  const {c,messages}=load(), pending=deferred();c.searchYouTube=()=>pending.promise;
  const task=c.doSearch('example');await flush();++c.seq;pending.reject(new Error('old error'));await task;
  assert.deepEqual(messages,[]);
});
test('a pending YouTube conversion retries with its original connection settings',async()=>{
  const pending=deferred(), keys=[];
  const original={yt:'old-fixture'}, c=vm.createContext({cfg:{...original},Math,Promise,
    enc:encodeURIComponent,toast(){},setTimeout:fn=>queueMicrotask(fn),
    fetch:async(url,options)=>{keys.push(options.headers['x-rapidapi-key']);return {ok:true,json:()=>keys.length===1?pending.promise:Promise.resolve({status:'ok',link:'https://audio.example.test/result.mp3'})};},
  });
  vm.runInContext(youtube,c);
  const task=c.ytStream('example-video',2,original);Object.assign(c.cfg,{yt:'new-fixture'});
  pending.resolve({status:'processing'});await task;
  assert.deepEqual(keys,['old-fixture','old-fixture']);
});
