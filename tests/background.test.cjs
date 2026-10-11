const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../tools/background-contrast.js');

test('single-file distribution contains the shared artwork helper verbatim', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../tools/background-contrast.js'), 'utf8').trim();
  assert.equal(html.match(/\/\* BEGIN SHARED BACKGROUND \*\/([\s\S]*?)\/\* END SHARED BACKGROUND \*\//)[1].trim(), source);
});

test('ordinary covers receive no extra darkness and white covers have a bounded soft edge', () => {
  for (const brightness of [0, 83, 97, 150, null, undefined, NaN])
    assert.deepEqual(api.strengths(brightness), [0, 0, 0]);
  const [centre, middle, edge] = api.strengths(255);
  assert.equal(centre, .65); assert(centre > middle && middle > edge && edge > 0);
  assert(api.strengths(151)[0] < api.strengths(210)[0]);
});

test('an existing dark base is preserved and never darkened twice at full strength', () => {
  assert.deepEqual(api.strengths(180, .57), [0, 0, 0]);
  const extra = api.strengths(210, .36)[0];
  assert(Math.abs(1 - (1 - .36) * (1 - extra) - .6) < 1e-9);
  assert.deepEqual(api.strengths(255, .72), [0, 0, 0]);
});

test('a slow previous cover cannot replace the selected cover or its contrast', async () => {
  const pending = new Map(), seen = [];
  const update = api.createUpdater((image, analysis, url) => seen.push(url),
    url => new Promise(resolve => pending.set(url, resolve)));
  const old = update('old'), latest = update('latest');
  pending.get('latest')({image:{}, analysis:{brightness:83}});
  assert.equal(await latest, true);
  pending.get('old')({image:{}, analysis:{brightness:255}});
  assert.equal(await old, false);
  assert.deepEqual(seen, ['latest']);
});

test('an empty selection cancels pending artwork and clears the additional mask', async () => {
  let complete; const seen = [];
  const update = api.createUpdater((image, analysis, url) => seen.push({image, analysis, url}),
    () => new Promise(resolve => {complete = resolve;}));
  const pending = update('previous');
  await update(''); complete({image:{}, analysis:{brightness:255}});
  assert.equal(await pending, false);
  assert.deepEqual(seen, [{image:null, analysis:null, url:''}]);
});

test('an unavailable cover leaves the displayed cover intact without an unhandled rejection', async () => {
  const update = api.createUpdater(() => assert.fail('Must not replace displayed artwork'),
    async () => {throw new Error('Offline');});
  assert.equal(await update('missing'), false);
});

test('CORS-rejected plugin art still displays without reading or transmitting its pixels', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../tools/background-contrast.js'), 'utf8');
  const attempts = [];
  class Image {
    set src(url) {
      attempts.push({url, cors:this.crossOrigin});
      queueMicrotask(() => this.crossOrigin ? this.onerror() : this.onload());
    }
  }
  const window = {Image, document:{createElement() {assert.fail('Unreadable image must not be sampled');}}};
  vm.runInNewContext(source, {window, queueMicrotask});
  const loaded = await window.MusicBackground.loadCover('https://art.example.test/cover.jpg');
  assert(loaded.image); assert.equal(loaded.analysis, null);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].cors, 'anonymous');
  assert.equal(attempts[1].cors, undefined);
});

test('tainted canvas cannot prevent a successfully loaded cover from displaying', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../tools/background-contrast.js'), 'utf8');
  class Image {set src(url) {queueMicrotask(() => this.onload());}}
  const window = {Image, document:{createElement() {return {getContext() {return {
    drawImage() {}, getImageData() {throw new Error('SecurityError');}
  };}};}}};
  vm.runInNewContext(source, {window, queueMicrotask});
  const loaded = await window.MusicBackground.loadCover('https://art.example.test/cover.jpg');
  assert(loaded.image); assert.equal(loaded.analysis, null);
});
