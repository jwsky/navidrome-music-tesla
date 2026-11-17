const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Q=require('../tools/stream-quality.js');
test('new, invalid or unavailable preferences default to raw',()=>{
  for(const saved of [null,'','invalid','256'])assert.equal(Q.load('fixture',{getItem:()=>saved}),'raw');
  assert.equal(Q.load('fixture',{getItem(){throw new Error('private mode');}}),'raw');
});
test('quality preference cycles and persists without any connection credentials',()=>{
  const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
  let mode='raw';for(const expected of ['320','128','raw']){
    mode=Q.save('fixture',Q.next(mode),storage);assert.equal(mode,expected);assert.equal(Q.load('fixture',storage),expected);
  }
  assert.deepEqual([...store.keys()],['fixture']);
});
test('raw does not set a bitrate limit and compressed modes request explicit MP3 caps',()=>{
  assert.equal(Q.params('raw'),'format=raw');
  assert.equal(Q.params('320'),'format=mp3&maxBitRate=320');
  assert.equal(Q.params('128'),'format=mp3&maxBitRate=128');
  assert.deepEqual(['raw','320','128'].map(Q.fallback),['320','128',null]);
});
test('source bitrate ceilings and unsupported providers are not labelled as higher quality',()=>{
  assert.equal(Q.status('320',{suffix:'mp3',bitRate:128}).label,'128K');
  assert.equal(Q.status('raw',{suffix:'flac'}).label,'RAW');
  assert.match(Q.status('raw',{suffix:'flac'}).title,/FLAC/);
  assert.deepEqual(Q.status('320',null,false),{label:'源音质',title:'当前来源不支持切换音质',disabled:true});
});
test('the delivered HTML includes the exact shared quality implementation',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const embedded=html.split('/* BEGIN SHARED STREAM QUALITY */')[1].split('/* END SHARED STREAM QUALITY */')[0].trim();
  assert.equal(embedded,fs.readFileSync(path.join(__dirname,'../tools/stream-quality.js'),'utf8').trim());
  assert.equal((html.match(/id="qualityBtn"/g)||[]).length,1);
});
