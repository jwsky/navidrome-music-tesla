(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MusicStreamQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const modes = ['raw', '320', '128'];
  const normalize = value => modes.includes(String(value)) ? String(value) : 'raw';
  const next = value => modes[(modes.indexOf(normalize(value)) + 1) % modes.length];
  const params = value => normalize(value) === 'raw' ? 'format=raw' : 'format=mp3&maxBitRate=' + normalize(value);
  const fallback = value => normalize(value) === 'raw' ? '320' : normalize(value) === '320' ? '128' : null;
  function load(key, storage) {
    try { return normalize((storage || localStorage).getItem(key)); } catch (_) { return 'raw'; }
  }
  function save(key, value, storage) {
    try { (storage || localStorage).setItem(key, normalize(value)); } catch (_) {}
    return normalize(value);
  }
  function status(mode, item, adjustable = true, selected = mode) {
    mode = normalize(mode); selected = normalize(selected);
    if (!adjustable) return {label: '源音质', title: '当前来源不支持切换音质', disabled: true};
    const format = String(item && (item.suffix || item.format || item.contentType) || '').toLowerCase();
    const sourceRate = Number(item && (item.bitRate || item.quality)) || 0;
    let label = mode === 'raw' ? 'RAW' : mode + 'K';
    if (mode !== 'raw' && /mp3|mpeg/.test(format) && sourceRate > 0 && sourceRate < Number(mode)) label = sourceRate + 'K';
    let title = mode === 'raw' ? 'RAW · 原始音频，不主动转码' : 'MP3 · 最高 ' + mode + ' kbps';
    if (mode === 'raw' && format) title += ' · ' + format.replace('audio/', '').toUpperCase();
    if (label !== (mode === 'raw' ? 'RAW' : mode + 'K')) title += ' · 源文件为 ' + sourceRate + ' kbps';
    if (selected !== mode) title += ' · 兼容模式';
    return {label, title: title + '；点击切换到 ' + (next(selected) === 'raw' ? 'RAW' : next(selected) + 'K'), disabled: false};
  }
  function playedSeconds(ranges) {
    let seconds = 0;
    for (let i = 0; ranges && i < ranges.length; i++) seconds += Math.max(0, ranges.end(i) - ranges.start(i));
    return seconds;
  }
  return {modes, normalize, next, params, fallback, load, save, status, playedSeconds};
});
