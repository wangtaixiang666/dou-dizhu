/* 自对弈训练价值网络：node ddz/train.js [轮数] [每轮局数] */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (isMainThread) {
  main();
} else {
  runWorker();
}

/* ================= 主线程 ================= */
function main() {
  const fs = require('fs');
  const path = require('path');
  const ROUNDS = Number(process.argv[2] || 10);
  const GAMES = Number(process.argv[3] || 24000);
  const WORKERS = Number(process.argv[4] || 12);
  const RESUME = process.argv[5] === 'resume';
  const HIDDEN = 32;
  const DIM = 65;
  const MAX_SAMPLES = 240000;
  const OUT = path.join(__dirname, 'weights.json');

  const D = (require('./engine.js'), globalThis.DDZ);
  require('./bot-heuristic.js');
  require('./model.js');
  require('./match.js');

  let net = null;
  let lr = 0.004;
  const log = [];
  const t0 = Date.now();
  let bestRate = -1, bestJSON = null;

  async function collect(weightsJSON, cfg) {
    const per = Math.ceil(cfg.games / WORKERS);
    const jobs = [];
    for (let w = 0; w < WORKERS; w++) {
      jobs.push(new Promise((resolve, reject) => {
        const wk = new Worker(__filename, {
          workerData: { weights: weightsJSON, games: per, epsilon: cfg.epsilon, sampleCap: Math.ceil(cfg.sampleCap / WORKERS) }
        });
        let done = false;
        wk.on('message', (msg) => {
          done = true;
          resolve(msg);
        });
        wk.on('error', reject);
        wk.on('exit', () => { if (!done) reject(new Error('worker 提前退出')); });
      }));
    }
    const parts = await Promise.all(jobs);
    let total = 0, played = 0;
    for (const p of parts) { total += p.n; played += p.played; }
    const X = new Float32Array(total * DIM);
    const Y = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      X.set(p.X.subarray(0, p.n * DIM), off * DIM);
      Y.set(p.Y.subarray(0, p.n), off);
      off += p.n;
    }
    return { X, Y, n: total, played };
  }

  function evalNet(n, games) {
    const p = D.makeModelPolicy(net);
    return D.evaluate(p, D.HeuristicBot, games);
  }

  /* 价值网络本身的判别力：holdout 上的准确率与 AUC */
  function diagnose(X, Y, n) {
    const valN = Math.floor(n * 0.15);
    let correct = 0;
    const pairs = [];
    for (let i = 0; i < valN; i++) {
      const idx = n - 1 - i;
      const x = X.subarray(idx * DIM, idx * DIM + DIM);
      const p = net.forward(x);
      const pred = p > 0.5 ? 1 : 0;
      if (pred === Y[idx]) correct++;
      pairs.push([p, Y[idx]]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    /* AUC：正例排在负例之后的概率，用秩和法 */
    let rankSum = 0, posCount = 0;
    for (let i = 0; i < pairs.length; i++) {
      const r = i + 1;
      if (pairs[i][1] === 1) { rankSum += r; posCount++; }
    }
    const negCount = pairs.length - posCount;
    const auc = (posCount && negCount) ? (rankSum - posCount * (posCount + 1) / 2) / (posCount * negCount) : 0.5;
    return { acc: correct / valN, auc: auc };
  }

  function heurBaseline(games) {
    return D.evaluate(D.HeuristicBot, D.HeuristicBot, games);
  }

  (async () => {
    console.log('=== 阶段 0：基线 ===');
    console.log('特征维度', D.FEATURE_DIM, '| 参数', D.FEATURE_DIM * HIDDEN + HIDDEN * 2 + 1);
    const base = heurBaseline(900);
    console.log('启发式 vs 启发式 综合胜率', (base.rate * 100).toFixed(2) + '%（应≈50%）');
    const randP = D.makeRandomPolicy();
    const rndRate = D.evaluate(randP, D.HeuristicBot, 300).rate;
    console.log('随机策略 vs 启发式', (rndRate * 100).toFixed(1) + '%（下限基准）');

    /* 断点续训：载入已有最优权重作为起点 */
    if (RESUME) {
      const bp = path.join(__dirname, 'weights-best.json');
      if (require('fs').existsSync(bp)) {
        net = D.MLP.fromJSON(JSON.parse(require('fs').readFileSync(bp, 'utf8')));
        const ev0 = evalNet(net, 1500);
        bestRate = ev0.rate;
        bestJSON = net.toJSON();
        console.log('续训：载入最优权重，当前胜率 ' + (ev0.rate * 100).toFixed(2) + '%');
      }
    }

    for (let r = 0; r < ROUNDS; r++) {
      const tr = Date.now();
      const cfg = {
        games: GAMES,
        epsilon: r === 0 ? 0 : Math.max(0.04, 0.16 - r * 0.012),
        sampleCap: MAX_SAMPLES
      };
      const data = await collect(net ? net.toJSON() : null, cfg);
      const tCollect = Date.now() - tr;

      if (!net) net = new D.MLP(D.FEATURE_DIM, HIDDEN);
      const trainer = new D.Trainer(net, lr);
      const tt = Date.now();
      let loss = 0;
      const epochs = 4;
      for (let e = 0; e < epochs; e++) loss = trainer.trainEpoch(data.X, data.Y, data.n, 512);
      const tTrain = Date.now() - tt;

      const ev = evalNet(net, 1500);
      const dg = diagnose(data.X, data.Y, data.n);
      const posRate = data.Y.reduce((a, b) => a + b, 0) / data.n;
      let mark = '';
      if (ev.rate > bestRate) {
        bestRate = ev.rate;
        bestJSON = net.toJSON();
        require('fs').writeFileSync(path.join(__dirname, 'weights-best.json'), JSON.stringify(bestJSON));
        mark = ' ★';
      }
      console.log(
        '轮 ' + (r + 1) + '/' + ROUNDS +
        ' | 样本 ' + data.n + '（对局 ' + data.played + '）' +
        ' | 正例率 ' + (posRate * 100).toFixed(1) + '%' +
        ' | loss ' + loss.toFixed(4) +
        ' | 验证 acc ' + (dg.acc * 100).toFixed(1) + '% AUC ' + dg.auc.toFixed(3) +
        ' | 胜率 ' + (ev.rate * 100).toFixed(2) + '%' + mark +
        ' | 采集 ' + (tCollect / 1000).toFixed(1) + 's 训练 ' + (tTrain / 1000).toFixed(1) + 's'
      );
      log.push({ round: r + 1, samples: data.n, games: data.played, loss: loss, acc: dg.acc, auc: dg.auc, rate: ev.rate, sec: (Date.now() - tr) / 1000 });
      lr *= 0.85;

      require('fs').writeFileSync(OUT, JSON.stringify(net.toJSON()));
    }

    /* 用实测胜率最高的检查点作为交付权重 */
    if (bestJSON) {
      require('fs').writeFileSync(OUT, JSON.stringify(bestJSON));
      net = D.MLP.fromJSON(bestJSON);
      console.log('\n采用最优检查点（胜率 ' + (bestRate * 100).toFixed(2) + '%）');
    }

    console.log('\n=== 最终评测 ===');
    const final = evalNet(net, 3000);
    console.log('模型 vs 启发式：', (final.rate * 100).toFixed(2) + '%  （' + final.played + ' 局，流局 ' + final.redeal + '）');
    for (const d of final.detail) console.log('  座位 ' + d.seat + '：' + (d.rate * 100).toFixed(2) + '%');
    const rndFinal = D.evaluate(D.makeRandomPolicy(), D.HeuristicBot, 600).rate;
    console.log('随机 vs 启发式：', (rndFinal * 100).toFixed(2) + '%');
    console.log('总耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒');
    require('fs').writeFileSync(path.join(__dirname, 'train-log.json'), JSON.stringify({ log: log, baseline: base.rate, final: final.rate, random: rndFinal }, null, 2));
    console.log('权重已写入 ' + OUT);
  })().catch((e) => { console.error(e); process.exit(1); });
}

/* ================= worker ================= */
function runWorker() {
  require('./engine.js');
  require('./bot-heuristic.js');
  require('./model.js');
  require('./match.js');
  const D = globalThis.DDZ;
  const DIM = D.FEATURE_DIM;
  const { weights, games, epsilon, sampleCap } = workerData;

  const net = weights ? D.MLP.fromJSON(weights) : null;
  const modelPolicy = net ? D.makeModelPolicy(net, { epsilon: epsilon }) : null;
  const H = D.HeuristicBot;

  let cap = 8192;
  let X = new Float32Array(cap * DIM);
  let Y = new Uint8Array(cap);
  let n = 0;
  let played = 0;

  function push(f, y) {
    if (n >= sampleCap) return;
    if (n >= cap) {
      cap *= 2;
      const nx = new Float32Array(cap * DIM); nx.set(X.subarray(0, n * DIM)); X = nx;
      const ny = new Uint8Array(cap); ny.set(Y.subarray(0, n)); Y = ny;
    }
    X.set(f, n * DIM);
    Y[n] = y;
    n++;
  }

  for (let gi = 0; gi < games; gi++) {
    /* 一半对局三方都用模型（自对弈），一半是 1 模型 + 2 启发式（贴近部署） */
    const selfPlay = !net || (gi % 2 === 0);
    const modelSeat = gi % 3;
    const bases = [];
    for (let s = 0; s < 3; s++) {
      if (!net) bases.push(H);
      else if (selfPlay) bases.push(modelPolicy);
      else bases.push(s === modelSeat ? modelPolicy : H);
    }

    const rec = { fs: [], seats: [] };
    const pols = [];
    for (let s = 0; s < 3; s++) {
      const b = bases[s];
      pols.push({
        chooseBid: function (g, seat) { return b.chooseBid(g, seat); },
        chooseMove: function (g, seat) {
          const st = D.stateFor(g, seat);
          const mv = b.chooseMove(g, seat);
          rec.fs.push(D.buildFeatures(st));
          rec.seats.push(seat);
          const next = (seat + 1) % 3;
          const st2 = mv ? D.afterMove(st, mv, next) : D.afterPass(st, next);
          rec.fs.push(D.buildFeatures(st2));
          rec.seats.push(seat);
          return mv;
        }
      });
    }

    const g = D.playGame(pols);
    if (!g) continue;
    played++;
    const L = g.landlord;
    const landlordWon = g.winner === L;
    for (let i = 0; i < rec.fs.length; i++) {
      const seat = rec.seats[i];
      const y = ((seat === L) === landlordWon) ? 1 : 0;
      push(rec.fs[i], y);
    }
  }

  const outX = X.subarray(0, n * DIM).slice();
  const outY = Y.subarray(0, n).slice();
  parentPort.postMessage(
    { X: outX, Y: outY, n: n, played: played },
    [outX.buffer, outY.buffer]
  );
}
