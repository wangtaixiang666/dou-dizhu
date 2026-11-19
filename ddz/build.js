/* 把引擎、机器人、模型、权重内联成单文件 HTML */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const out = path.join(dir, '..', '斗地主.html');

const bestPath = path.join(dir, 'weights-best.json');
const lastPath = path.join(dir, 'weights.json');
const wSrc = fs.existsSync(bestPath) ? bestPath : lastPath;
const weights = fs.existsSync(wSrc) ? fs.readFileSync(wSrc, 'utf8') : '{"dim":65,"hidden":32,"W1":[],"b1":[],"W2":[],"b2":[]}';
console.log('使用权重：' + path.basename(wSrc));

const parts = {
  ENGINE: fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'),
  BOTS: fs.readFileSync(path.join(dir, 'bot-heuristic.js'), 'utf8'),
  MODEL: fs.readFileSync(path.join(dir, 'model.js'), 'utf8'),
  MATCH: fs.readFileSync(path.join(dir, 'match.js'), 'utf8'),
  WEIGHTS: 'const WEIGHTS = ' + weights + ';'
};

let html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');
for (const k of Object.keys(parts)) {
  const marker = '/*__' + k + '__*/';
  if (html.indexOf(marker) < 0) throw new Error('缺少占位符 ' + marker);
  html = html.replace(marker, () => parts[k]);
}
fs.writeFileSync(out, html);
console.log('已生成 ' + out + '（' + (html.length / 1024).toFixed(0) + ' KB）');
