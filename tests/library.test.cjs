const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const helpers = html.match(/<script id="libraryTools">([\s\S]*?)<\/script>/)[1];
const song = (id, extra = {}) => ({id:String(id), title:'Example ' + id, artist:'Example artist', ...extra});
const ids = songs => Array.from(songs, s => s.id);
function storage() {
  const values = new Map();
  return {getItem:key => values.get(key) || null, setItem:(key, value) => values.set(key, value)};
}
function load(persistence = storage()) {
  const window = {};
  Object.defineProperty(window, 'localStorage', {get() {
    if (persistence instanceof Error) throw persistence;
    return persistence;
  }});
  vm.runInNewContext(helpers, {window, Set, Map, Promise, Date, Math, JSON, Number, String, Object, Array});
  return window.MusicLibrary;
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}

test('the distributed HTML has no external code or styles and both scripts parse', () => {
  assert(!/<script[^>]+src=|<link[^>]+(?:stylesheet|preload)/i.test(html));
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

test('normalization accepts short native IDs and stores metadata without server paths or secrets', () => {
  const api = load();
  const result = api.normalize([song(1, {playCount:undefined, path:'private-file', token:'placeholder', pass:'placeholder'}), song(1), null]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
  assert.equal(result[0].playCount, 0);
  assert.equal(result[0].played, null);
  assert.equal(result[0].path, undefined);
  assert.equal(result[0].token, undefined);
  assert.equal(result[0].pass, undefined);
});

test('each ten rows have the next seven popularity leaders and three distinct discoveries', () => {
  const api = load(), songs = Array.from({length:100}, (_, i) => song(i, {playCount:100 - i}));
  const ranked = api.recommend(songs, new Map());
  const popular = new Set(ids(songs.slice(0, 70)));
  for (let offset = 0; offset < songs.length; offset += 10) {
    const block = ranked.slice(offset, offset + 10);
    assert.deepEqual(ids(block.filter(s => popular.has(s.id))), ids(songs.slice(offset / 10 * 7, offset / 10 * 7 + 7)));
    assert.equal(block.filter(s => !popular.has(s.id)).length, 3);
  }
  assert.equal(new Set(ids(ranked)).size, songs.length);
});

test('partial blocks, empty lists and absent counters neither omit nor repeat a track', () => {
  const api = load();
  for (let length = 0; length <= 41; length++) {
    const songs = Array.from({length}, (_, i) => song(i));
    assert.deepEqual(ids(api.recommend(songs)).sort(), ids(songs).sort());
  }
});

test('discovery stays stable during a session and the input is not reordered or changed', () => {
  const api = load(), priorities = new Map();
  const songs = Object.freeze(Array.from({length:23}, (_, i) => Object.freeze(song(i, {playCount:i}))));
  const before = JSON.stringify(songs);
  assert.deepEqual(ids(api.recommend(songs, priorities)), ids(api.recommend(songs, priorities)));
  assert.equal(JSON.stringify(songs), before);
});

test('play counts outrank recency; tied counts prefer last played, then date added', () => {
  const api = load();
  const songs = [song('old', {playCount:20}), song('recent', {playCount:2, created:'2026-10-06'}),
    song('played', {playCount:2, played:'2026-10-01'})];
  assert.deepEqual(ids(api.recommend(songs)), ['old', 'played', 'recent']);
});

test('suggestions include Chinese, English and piano metadata but exclude loud variants', () => {
  const api = load();
  const songs = [song('a', {title:'平凡的一天'}), song('b', {title:'Edelweiss'}),
    song('c', {title:"Mia & Sebastian's Theme"}), song('d', {album:'Soft Piano'}),
    song('e', {title:'Edelweiss (Dance Mix)'}), song('f', {title:'平凡的一天', album:'演唱会'}),
    song('g', {genre:'Metal'}), song('h')];
  assert.deepEqual(ids(api.candidates(songs)), ['a', 'b', 'c', 'd']);
});

test('cache persists additions and an empty playlist without retaining credentials', () => {
  const persistence = storage(), api = load(persistence);
  const cache = new api.PlaylistCache('account-a', () => {});
  cache.replace([song(1, {token:'placeholder'}), song(2)], 'playlist-1');
  const reloaded = new api.PlaylistCache('account-a', () => {});
  assert.equal(reloaded.id, 'playlist-1');
  assert.equal(reloaded.has('2'), true);
  assert.equal(reloaded.songs[0].tags[0], 'bedtime');
  assert(!persistence.getItem('account-a').includes('token'));
  cache.replace([], 'playlist-1');
  assert.equal(new api.PlaylistCache('account-a', () => {}).songs.length, 0);
});

test('separate account or playlist keys never use each other’s songs', () => {
  const api = load(), a = new api.PlaylistCache('account-a', () => {});
  a.replace([song(1)], 'playlist-1');
  const b = new api.PlaylistCache('account-b', () => {});
  assert.equal(b.songs.length, 0);
  assert.equal(b.id, '');
});

test('disabled, corrupt or full storage does not prevent in-memory favorites', () => {
  for (const persistence of [new Error('disabled'), {getItem:() => '{', setItem:() => {throw new Error('full');}}]) {
    const api = load(persistence), cache = new api.PlaylistCache('account-a', () => {});
    cache.replace([song(1)], 'playlist-1');
    assert.equal(cache.has('1'), true);
    cache.replace([], 'playlist-1');
    assert.equal(cache.has('1'), false);
  }
});

test('failed reads retain the last snapshot; simultaneous reads share one request', async () => {
  const api = load(), cache = new api.PlaylistCache('account-a', () => {}), pending = deferred();
  cache.replace([song(1)], 'playlist-1');
  await assert.rejects(cache.refresh(() => Promise.reject(new Error('offline'))), /offline/);
  assert.equal(cache.has('1'), true);
  const first = cache.refresh(() => pending.promise);
  assert.equal(first, cache.refresh(() => {throw new Error('duplicate request');}));
  pending.resolve({id:'playlist-1', songs:[song(2)]});
  assert.equal(await first, true);
  assert.equal(cache.has('2'), true);
});

test('a delayed snapshot cannot undo a confirmed edit; it triggers a fresh read', async () => {
  const api = load(), cache = new api.PlaylistCache('account-a', () => {});
  const old = deferred(), current = deferred();
  let reads = 0;
  const first = cache.refresh(() => ++reads === 1 ? old.promise : current.promise);
  await Promise.resolve();
  ++cache.revision; cache.replace([song(2)], 'playlist-1');
  old.resolve({id:'playlist-1', songs:[song(1)]});
  assert.equal(await first, false);
  assert.equal(cache.has('1'), false);
  assert.equal(cache.has('2'), true);
  await Promise.resolve();
  assert.equal(reads, 2);
  const next = cache.loading;
  current.resolve({id:'playlist-1', songs:[song(2)]});
  await next;
});

test('updated native play statistics persist without adding playlist members', () => {
  const persistence = storage(), api = load(persistence), cache = new api.PlaylistCache('account-a', () => {});
  cache.replace([song(1)], 'playlist-1');
  cache.updateStats([song(1, {playCount:8, played:'2026-10-07T00:00:00Z'}), song(2, {playCount:99})]);
  const reloaded = new api.PlaylistCache('account-a', () => {});
  assert.equal(reloaded.songs.length, 1);
  assert.equal(reloaded.songs[0].playCount, 8);
  assert.equal(reloaded.songs[0].played, '2026-10-07T00:00:00Z');
});

test('played sections exclude seek gaps and empty ranges', () => {
  const api = load(), ranges = [[0, 10], [40, 45]];
  assert.equal(api.playedSeconds({length:ranges.length, start:i => ranges[i][0], end:i => ranges[i][1]}), 15);
  assert.equal(api.playedSeconds({length:0}), 0);
});
