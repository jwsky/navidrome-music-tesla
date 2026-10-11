const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'background-contrast.js'), 'utf8').trimEnd();
const file = path.join(root, 'index.html');
const start = '/* BEGIN SHARED BACKGROUND */', end = '/* END SHARED BACKGROUND */';
let html = fs.readFileSync(file, 'utf8');
if (!html.includes(start)) html = html.replace('<script id="libraryTools">', '<script id="libraryTools">\n' + start + '\n' + end);
html = html.replace(/\/\* BEGIN SHARED BACKGROUND \*\/[\s\S]*?\/\* END SHARED BACKGROUND \*\//,
  start + '\n' + source + '\n' + end);
fs.writeFileSync(file, html);
if (process.argv[2]) fs.writeFileSync(path.join(process.argv[2], 'background-contrast.js'), source + '\n');
