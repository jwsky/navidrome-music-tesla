(function (root) {
'use strict';

// Small, local-only artwork samples. No cover pixels or measurements leave the browser.
function measure(image, doc = root.document) {
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(image, 0, 0, 32, 32);
  const pixels = ctx.getImageData(0, 0, 32, 32).data, mean = [0, 0, 0];
  for (let p = 0; p < pixels.length; p += 4)
    for (let c = 0; c < 3; c++) mean[c] += pixels[p + c] / 1024;

  const inset = doc.createElement('canvas');
  inset.width = inset.height = 48;
  const ix = inset.getContext('2d');
  if (!ix) throw new Error('Canvas unavailable');
  ix.drawImage(image, 0, 0, 48, 48);
  if ('filter' in ctx) {
    ctx.filter = 'blur(4px)';
    ctx.drawImage(inset, -8, -8);
  } else {
    // Older WebKit: resize through a tiny canvas to soften the sample.
    const small = doc.createElement('canvas');
    small.width = small.height = 8;
    small.getContext('2d').drawImage(inset, 0, 0, 8, 8);
    ctx.drawImage(small, 0, 0, 32, 32);
  }
  const region = ctx.getImageData(10, 6, 18, 20).data, values = [];
  for (let p = 0; p < region.length; p += 4)
    values.push(.2126 * region[p] + .7152 * region[p + 1] + .0722 * region[p + 2]);
  values.sort((a, b) => a - b);
  return {mean, brightness:values[Math.floor((values.length - 1) * .8)]};
}

function strengths(brightness, baseline = 0) {
  const target = Number.isFinite(brightness) ? Math.min(.65, Math.max(0, (brightness - 150) / 100)) : 0;
  baseline = Number.isFinite(baseline) ? Math.min(.95, Math.max(0, baseline)) : 0;
  // Compensate the existing dark base rather than stacking a second full-strength mask.
  return [1, .84, .6].map(weight => Math.max(0, (target * weight - baseline) / (1 - baseline)));
}

function applyShade(layer, analysis, baseline = 0) {
  const values = strengths(analysis && analysis.brightness, baseline);
  ['--cover-shade', '--cover-shade-mid', '--cover-shade-edge'].forEach((name, i) =>
    layer.style.setProperty(name, values[i].toFixed(4)));
}

function loadImage(url, cors) {
  return new Promise((resolve, reject) => {
    const image = new root.Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Artwork unavailable'));
    image.src = url;
  });
}

async function loadCover(url) {
  let image;
  try { image = await loadImage(url, true); }
  catch (_) {
    // Some plugin covers can be displayed but do not permit canvas access.
    return {image:await loadImage(url, false), analysis:null};
  }
  let analysis = null;
  try { analysis = measure(image); } catch (_) {}
  return {image, analysis};
}

function createUpdater(apply, load = loadCover) {
  let sequence = 0;
  return async (url, extra) => {
    const current = ++sequence;
    if (!url) { apply(null, null, '', extra); return true; }
    let result;
    try { result = await load(url); } catch (_) { return false; }
    if (current !== sequence) return false;
    apply(result.image, result.analysis, url, extra);
    return true;
  };
}

const api = {measure, strengths, applyShade, loadCover, createUpdater};
root.MusicBackground = api;
if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
