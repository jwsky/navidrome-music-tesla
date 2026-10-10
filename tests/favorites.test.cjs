const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const helpers = html.match(/<script id="libraryTools">([\s\S]*?)<\/script>/)[1];
const favorites = html.slice(html.indexOf('function bedtimeName('), html.indexOf('/* ---------- 列表渲染'));
const mutation = html.slice(html.indexOf('async function setBedtimeFavorite('), html.indexOf('function cancelPress('));
function load() {
  const values = new Map(), calls = [], elements = new Map();
  const window = {localStorage:{getItem:k => values.get(k) || null, setItem:(k,v) => values.set(k,v)}};
  const context = vm.createContext({window, console, Set, Map, Promise, Date, Math, JSON, Number, String, Object, Array,
    cfg:{url:'https://example.test', user:'one', favoriteName:'最爱'}, library:[], list:[], generation:0,
    bedtime:null, menuItem:null, menuBusy:false, press:null, audio:{paused:false}, discoveryPriorities:new Map(),
    view:'library', enc:encodeURIComponent, md5:s => s, restBase:() => context.cfg.url, configured:() => true,
    $(id) { if (!elements.has(id)) elements.set(id, {children:[], setAttribute(){}}); return elements.get(id); },
    setInterval(){}, document:{addEventListener(){}}, syncSongMenu(){}, closeSongMenu(){context.menuItem=null;}, toast(){},
    subGet:async (name, extra, config) => {
      calls.push({name, extra, user:config.user, method:'GET'});
      if (name === 'getStarred2') return {starred2:{song:[{id:'1',title:'Example'}], album:[{id:'album'}]}};
      if (name === 'getSong') return {song:{id:'2',title:'Added',starred:'2026-10-10T00:00:00Z'}};
      throw new Error('Unexpected endpoint '+name);
    },
    subPost:async (name, params, config) => {calls.push({name, params, user:config.user, method:'POST'}); return {};},
  });
  vm.runInContext(helpers + '\nconst MusicLibrary = window.MusicLibrary;\n' + favorites + mutation, context);
  context.setupBedtime();
  return {context,calls,values};
}
test('favorites read the signed-in user native starred songs, without any named playlist', async () => {
  const {context:c,calls} = load();
  await c.refreshBedtime();
  assert.deepEqual(calls.map(v => v.name), ['getStarred2']);
  assert.equal(c.bedtime.songs.length, 1);
  assert.equal(c.bedtime.songs[0].id, '1');
});
test('renaming the entry keeps the same favorites cache; another account gets a distinct one', async () => {
  const {context:c} = load(); await c.refreshBedtime();
  c.cfg.favoriteName='哄睡最爱'; c.setupBedtime();
  assert.equal(c.bedtime.songs.length,1);
  c.cfg.user='two'; c.setupBedtime();
  assert.equal(c.bedtime.songs.length,0);
});
test('favorite writes native star and verifies getSong without touching audio or ordinary playlists', async () => {
  const {context:c,calls} = load(); await c.refreshBedtime(); calls.length=0;
  const playing=c.audio; c.menuItem={id:'2',src:'lib',title:'Added'};
  await c.setBedtimeFavorite(true);
  assert.deepEqual(calls.slice(0,2).map(v => v.name),['star','getSong']);
  assert.equal(c.bedtime.has('2'),true);
  assert.equal(c.audio,playing); assert.equal(c.audio.paused,false);
  assert(calls.every(v => !/Playlist/.test(v.name)));
});
test('a rejected native mutation preserves the confirmed cache', async () => {
  const {context:c} = load(); await c.refreshBedtime();
  c.menuItem={id:'2',src:'lib',title:'Added'}; c.subPost=async () => {throw new Error('denied');};
  await c.setBedtimeFavorite(true);
  assert.equal(c.bedtime.has('2'),false);
});
test('a pending refresh cannot undo a confirmed unstar', async () => {
  const {context:c} = load(); await c.refreshBedtime();
  let resolve; c.subGet=() => new Promise(yes => {resolve=yes;});
  const pending=c.refreshBedtime(); await Promise.resolve();
  const cache=c.bedtime; ++cache.revision; cache.replace([], 'starred');
  c.subGet=async () => ({starred2:{song:[]}});
  resolve({starred2:{song:[{id:'1',title:'Stale'}]}}); await pending;
  await new Promise(yes => setImmediate(yes));
  assert.equal(cache.has('1'),false);
});
test('an old-account request cannot modify the new account cache', async () => {
  const {context:c} = load(); let resolve;
  c.subGet=() => new Promise(yes => {resolve=yes;});
  const pending=c.refreshBedtime(); await Promise.resolve();
  c.cfg.user='two'; ++c.generation; c.setupBedtime();
  resolve({starred2:{song:[{id:'private-one'}]}}); await pending;
  assert.equal(c.bedtime.songs.length,0);
});
