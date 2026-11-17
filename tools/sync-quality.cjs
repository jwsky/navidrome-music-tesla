const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), file = path.join(root, 'index.html');
const source = fs.readFileSync(path.join(__dirname, 'stream-quality.js'), 'utf8').trimEnd();
const start = '/* BEGIN SHARED STREAM QUALITY */', end = '/* END SHARED STREAM QUALITY */';
let html = fs.readFileSync(file, 'utf8');
if (!html.includes(start)) html = html.replace('<script id="libraryTools">', '<script id="libraryTools">\n' + start + '\n' + end);
html = html.replace(/\/\* BEGIN SHARED STREAM QUALITY \*\/[\s\S]*?\/\* END SHARED STREAM QUALITY \*\//, start + '\n' + source + '\n' + end);
fs.writeFileSync(file, html);
if (process.argv[2]) fs.writeFileSync(path.join(process.argv[2], 'stream-quality.js'), source + '\n');
