/* 正式评测：把各档 AI 与基线放到同一批对局上比较，给出胜率与 95% 置信区间
   用法：node ddz/eval.js [每档局数] */
const fs = require('fs');
const path = require('path');
require('./engine.js');
require('./bot-heuristic.js');
require('./model.js');
require('./match.js');

const D = globalThis.DDZ;
const N = Number(process.argv[2] || 3600);

const wPath = path.join(__dirname, 'weights.json');
const wbPath = path.join(__dirname, 'weights-best.json');
let weights = null;
for (const p of [wbPath, wPath]) {
  if (fs.existsSync(p)) {
    const w = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (w.W1 && w.W1.length) { weights = w; break; }
  }
}
if (!weights) { console.error('找不到可用权重'); process.exit(1); }
const net = D.MLP.fromJSON(weights);

/* 简单档：启发式 + 38% 随机出牌（与 UI 内保持一致） */
function easyPolicy() {
  const base = D.HeuristicBot;
  return {
    name: 'easy',
    chooseBid: (g, s) => (Math.random() < 0.5 ? 0 : base.chooseBid(g, s)),
    chooseMove: (g, s) => {
      if (Math.random() < 0.38) {
        const ms = D.genMoves(g.hands[s], g.lastSeat === s ? null : g.lastMove);
        if (!ms.length) return null;
        if (g.canPass() && Math.random() < 0.5) return null;
        return ms[(Math.random() * ms.length) | 0];
      }
      return base.chooseMove(g, s);
    }
  };
}

function ci(rate, n) {
  const se = Math.sqrt(Math.max(1e-9, rate * (1 - rate) / n));
  return 1.96 * se * 100;
}

function report(label, policy, opp) {
  const r = D.evaluate(policy, opp, N);
  const e = ci(r.rate, r.played);
  console.log(
    label.padEnd(26) + (r.rate * 100).toFixed(2) + '%  ±' + e.toFixed(2) +
    '   (' + r.played + ' 局' + (r.redeal ? '，流局 ' + r.redeal : '') + ')'
  );
  return { label: label, rate: r.rate, ci: e, played: r.played, detail: r.detail };
}

console.log('=== 斗地主 AI 评测 ===');
console.log('每档 ' + N + ' 局，三个座位轮换，对手均为启发式机器人（普通档）\n');
console.log('权重：隐藏层 ' + weights.hidden + '，参数 ' + weights.W1.length + ' 个\n');

const out = [];
out.push(report('随机策略（下限）', D.makeRandomPolicy(), D.HeuristicBot));
out.push(report('简单档（启发式+随机）', easyPolicy(), D.HeuristicBot));
out.push(report('普通档（启发式）', D.HeuristicBot, D.HeuristicBot));
out.push(report('纯价值网络（1 步贪心）', D.makeModelPolicy(net, {}), D.HeuristicBot));
out.push(report('困难档（集合作战）', D.makeEnsemblePolicy(net, {}), D.HeuristicBot));

console.log('\n按座位拆分（困难档）：');
for (const d of out[4].detail) {
  console.log('  座位 ' + d.seat + '（' + (d.seat === 0 ? '测试方可能为地主或农民' : '') + '）：' + (d.rate * 100).toFixed(2) + '%');
}

/* 价值网络判别力：用一批对局数据算 AUC */
console.log('\n=== 价值网络判别力 ===');
const samples = [];
const H = D.HeuristicBot;
let games = 0;
while (samples.length < 20000 && games < 3000) {
  const rec = [];
  const pols = [0, 1, 2].map(() => ({
    chooseBid: (g, s) => H.chooseBid(g, s),
    chooseMove: (g, s) => {
      const st = D.stateFor(g, s);
      const mv = H.chooseMove(g, s);
      rec.push({ f: D.buildFeatures(st), seat: s });
      return mv;
    }
  }));
  const g = D.playGame(pols);
  games++;
  if (!g) continue;
  const L = g.landlord, lw = g.winner === L;
  for (const r of rec) samples.push({ p: net.forward(r.f), y: ((r.seat === L) === lw) ? 1 : 0 });
}
let pos = 0, rankSum = 0;
samples.sort((a, b) => a.p - b.p);
for (let i = 0; i < samples.length; i++) {
  if (samples[i].y === 1) { rankSum += i + 1; pos++; }
}
const neg = samples.length - pos;
const auc = (rankSum - pos * (pos + 1) / 2) / (pos * neg);
let correct = 0;
for (const s of samples) if ((s.p > 0.5 ? 1 : 0) === s.y) correct++;
console.log('样本 ' + samples.length + '（' + games + ' 局）  AUC ' + auc.toFixed(3) + '  准确率 ' + (correct / samples.length * 100).toFixed(1) + '%');

fs.writeFileSync(path.join(__dirname, 'eval-result.json'), JSON.stringify({ n: N, results: out, auc: auc, aucSamples: samples.length }, null, 2));
console.log('\n结果已写入 ddz/eval-result.json');
