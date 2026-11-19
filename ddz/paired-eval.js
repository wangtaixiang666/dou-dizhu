/* 配对评测：让两档 AI 打完全相同的牌局（同发牌、同地主），
   用 McNemar 检验比较差异是否真实存在。
   用法：node ddz/paired-eval.js [局数] */
const path = require('path');
require('./engine.js');
require('./bot-heuristic.js');
require('./model.js');
require('./match.js');

const D = globalThis.DDZ;
const N = Number(process.argv[2] || 6000);

const wPath = path.join(__dirname, 'weights.json');
const wbPath = path.join(__dirname, 'weights-best.json');
let weights = null;
for (const p of [wbPath, wPath]) {
  if (require('fs').existsSync(p)) {
    const w = JSON.parse(require('fs').readFileSync(p, 'utf8'));
    if (w.W1 && w.W1.length) { weights = w; break; }
  }
}
if (!weights) { console.error('找不到可用权重'); process.exit(1); }
const net = D.MLP.fromJSON(weights);

/* 可复现的 pseudo-random，保证两档拿到一模一样的牌 */
function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const H = D.HeuristicBot;
const A = D.makeEnsemblePolicy(net, {});     /* 困难档 */
const B = D.HeuristicBot;                    /* 普通档 */

function runOne(policy, seat, seed) {
  const pols = [H, H, H];
  pols[seat] = policy;
  const g = D.playGame(pols, { rand: lcg(seed) });
  if (!g) return null;
  const isLandlord = g.landlord === seat;
  return (g.winner === g.landlord) === isLandlord ? 1 : 0;
}

let n = 0, a = 0, bb = 0, both = 0, neither = 0, skip = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const seat = i % 3;
  const seed = 1000003 + i * 7919;
  const rA = runOne(A, seat, seed);
  const rB = runOne(B, seat, seed);
  if (rA === null || rB === null) { skip++; continue; }
  n++;
  if (rA && rB) both++;
  else if (!rA && !rB) neither++;
  else if (rA) a++;   /* 困难赢、普通输 */
  else bb++;          /* 普通赢、困难输 */
}
const sec = (Date.now() - t0) / 1000;

const discord = a + bb;
const diff = (a - bb) / n;
const se = Math.sqrt(Math.max(1e-9, discord)) / n;   /* McNemar 正态近似 */
const z = se > 0 ? diff / se : 0;

console.log('=== 配对评测（同发牌、同地主）===');
console.log('有效对局 ' + n + '（跳过 ' + skip + '）  耗时 ' + sec.toFixed(1) + 's');
console.log('两档都赢 ' + both + ' | 两档都输 ' + neither + ' | 分歧 ' + discord + ' 局');
console.log('  困难赢/普通输 ' + a + '   普通赢/困难输 ' + bb);
console.log('');
console.log('困难档 − 普通档 净胜率差 ' + (diff * 100).toFixed(2) + ' 个百分点');
console.log('  McNemar z = ' + z.toFixed(2) + '（|z| > 1.96 即 5% 水平显著）');
console.log('  困难档胜率 ' + (((a + both) / n) * 100).toFixed(2) + '%  普通档胜率 ' + (((bb + both) / n) * 100).toFixed(2) + '%');

require('fs').writeFileSync(
  path.join(__dirname, 'paired-result.json'),
  JSON.stringify({ n, skip, a, b: bb, both, neither, diff, z, sec }, null, 2)
);
