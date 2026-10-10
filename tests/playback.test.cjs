const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const controls = html.slice(html.indexOf('const P = {'), html.indexOf('/* ---------- 背景：封面高斯'));
const playback = html.slice(html.indexOf('function streamUrl('), html.indexOf('function setPlayIcon('));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function load(onPlay = () => Promise.resolve()) {
  const messages = [], calls = [], elements = new Map();
  const audio = {
    src:'', paused:true, error:null, currentTime:0, duration:60,
    load() { this.error = null; },
    pause() { this.paused = true; },
    removeAttribute() { this.src = ''; },
    play() { calls.push(this.src); this.paused = false; return onPlay(this, calls.length); },
  };
  const context = vm.createContext({audio, Promise, URLSearchParams,
    cfg:{url:'https://library.example.test', user:'example'},
    list:[{id:'1', src:'lib', title:'First', duration:60}, {id:'2', src:'lib', title:'Second', duration:60}],
    idx:-1, playSeq:0, generation:0, playingItem:null, listenSession:null, playback:null, playAttempt:0,
    window:{}, enc:encodeURIComponent, fmtTime:String,
    cur() { return context.playingItem; },
    $(id) { if (!elements.has(id)) elements.set(id, {style:{}}); return elements.get(id); },
    sub(method, params, config) { return config.url + '/' + method + '?' + params; },
    toast(message) { messages.push(message); },
    setPlayIcon() {}, recordPlay() {}, markPlaying() {}, setBackground() {}, loadLyrics() {}, coverOf() {},
    configured() { return true; }, openSettings() {},
  });
  vm.runInContext(controls + playback + '\nwindow.controls = P;', context);
  return {context, audio, messages, calls, elements, controls:context.window.controls};
}

test('selecting a native track calls play before returning to the caller', () => {
  const {context, audio, calls, elements} = load();
  context.play(0);
  assert.equal(calls.length, 1);
  assert(new URL(audio.src).searchParams.get('format') === 'raw');
  assert.equal(elements.get('npName').textContent, 'First');
});

test('the play control selects a track when no track is selected', () => {
  const {controls, context, calls} = load();
  controls.play();
  assert.equal(context.playingItem.id, '1');
  assert.equal(calls.length, 1);
});

test('denied autoplay keeps the original format and a manual click can recover', async () => {
  const {context, controls, audio, calls, messages} = load((audio, count) => {
    if (count === 1) { audio.paused = true; return Promise.reject({name:'NotAllowedError'}); }
    return Promise.resolve();
  });
  context.play(0); await flush();
  assert.equal(calls.length, 1);
  assert.match(messages.at(-1), /点下方播放按钮/);
  assert.equal(audio.paused, true);
  controls.play(); await flush();
  assert.equal(audio.paused, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test('a rejected manual play also reports why playback did not start', async () => {
  const {context, controls, audio, messages, calls} = load(audio => {
    audio.paused = true; return Promise.reject({name:'NotAllowedError'});
  });
  context.play(0); await flush(); messages.length = 0;
  controls.play(); await flush();
  assert.match(messages.at(-1), /浏览器需要确认播放/);
  assert.equal(audio.paused, true);
  assert.equal(calls.length, 2);
});

test('an unsupported native format falls back once to MP3 320k in the same listen', async () => {
  const {context, audio, calls, messages} = load((audio, count) => count === 1
    ? Promise.reject({name:'NotSupportedError'}) : Promise.resolve());
  context.play(0);
  const session = context.listenSession;
  session.reported = true;
  await flush();
  assert.deepEqual(calls.map(src => new URL(src).searchParams.get('format')), ['raw', 'mp3']);
  assert.equal(new URL(audio.src).searchParams.get('maxBitRate'), '320');
  assert.equal(context.listenSession, session);
  assert.equal(context.listenSession.reported, true);
  assert.deepEqual(messages, []);
});

test('unsupported raw and MP3 streams stop after two attempts and report the failure', async () => {
  const {context, audio, calls, messages} = load(() => Promise.reject({name:'NotSupportedError'}));
  context.play(0); await flush();
  assert.equal(calls.length, 2);
  assert.equal(audio.paused, true);
  assert.match(messages.at(-1), /音频无法播放/);
});

test('a network failure does not trigger a format fallback', () => {
  const {context, audio, calls, messages} = load();
  context.play(0); audio.error = {code:2};
  context.playbackFailed(context.playback, audio.error);
  assert.equal(calls.length, 1);
  assert.match(messages.at(-1), /音频无法播放/);
});

test('an aborted play is silent and does not change the stream format', async () => {
  const {context, calls, messages} = load(() => Promise.reject({name:'AbortError'}));
  context.play(0); await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(messages, []);
});

test('a late rejection from the previous song cannot change the new song', async () => {
  const first = deferred();
  const {context, audio, calls, messages} = load((audio, count) => count === 1 ? first.promise : Promise.resolve());
  context.play(0); context.play(1);
  first.reject({name:'NotSupportedError'}); await flush();
  assert.equal(new URL(audio.src).searchParams.get('id'), '2');
  assert.equal(context.playingItem.id, '2');
  assert.equal(calls.length, 2);
  assert.deepEqual(messages, []);
});

test('a delayed plugin URL cannot replace a subsequently selected native song', async () => {
  const pending = deferred(), {context, audio, calls} = load();
  context.list[0] = {src:'yt', videoId:'example-video', title:'Plugin track'};
  context.ytStream = () => pending.promise;
  context.play(0);
  assert.equal(audio.src, '');
  assert.equal(calls.length, 0);
  context.play(1);
  pending.resolve('https://audio.example.test/plugin.mp3'); await flush();
  assert.equal(new URL(audio.src).searchParams.get('id'), '2');
  assert.equal(calls.length, 1);
});

test('pausing while a plugin is resolving prevents it from starting when it arrives', async () => {
  const pending = deferred(), {context, controls, audio, calls} = load();
  context.list[0] = {src:'yt', videoId:'example-video', title:'Plugin track'};
  context.ytStream = () => pending.promise;
  context.play(0); controls.pause();
  pending.resolve('https://audio.example.test/plugin.mp3'); await flush();
  assert.equal(audio.paused, true);
  assert.equal(calls.length, 0);
  controls.play(); await flush();
  assert.equal(calls.length, 1);
});

test('changing connection settings invalidates a pending play failure', async () => {
  const pending = deferred(), {context, messages, calls} = load(() => pending.promise);
  context.play(0); ++context.generation;
  pending.reject({name:'NotSupportedError'}); await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(messages, []);
});
