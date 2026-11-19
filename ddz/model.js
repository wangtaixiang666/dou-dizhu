/* 特征工程 + 价值网络（单隐层 MLP）+ 1 步搜索策略 */
(function () {
  'use strict';
  const G = globalThis;
  const DDZ = (G.DDZ = G.DDZ || {});
  const T = DDZ.T;
  const analyze = DDZ.analyze;
  const total = DDZ.total;
  const handCount = DDZ.handCount;

  /* ---------- 状态视图（以 me 为视角，不含对手手牌内容） ---------- */
  function stateFor(game, me) {
    const sizes = [total(game.hands[0]), total(game.hands[1]), total(game.hands[2])];
    const freeLead = game.lastMove === null || game.lastSeat === me;
    return {
      me: me,
      hand: game.hands[me],
      sizes: sizes,
      landlord: game.landlord,
      turn: game.turn,
      lastMove: freeLead ? null : game.lastMove,
      played: game.played,
      mult: game.multiplier,
      isLeading: freeLead
    };
  }

  /* 我出了 move 之后的状态（仍以我为视角评估） */
  function afterMove(st, move, nextSeat) {
    const hand = st.hand.slice();
    for (let r = 3; r <= 17; r++) hand[r] -= move[r];
    const sizes = st.sizes.slice();
    sizes[st.me] -= total(move);
    return {
      me: st.me, hand: hand, sizes: sizes, landlord: st.landlord,
      turn: nextSeat, lastMove: move, played: st.played, mult: st.mult,
      isLeading: false
    };
  }

  /* 我选择过牌之后的状态 */
  function afterPass(st, nextSeat) {
    return {
      me: st.me, hand: st.hand, sizes: st.sizes, landlord: st.landlord,
      turn: nextSeat, lastMove: st.lastMove, played: st.played, mult: st.mult,
      isLeading: false
    };
  }

  /* ---------- 特征 ---------- */
  const hcCache = new Map();
  function handCountCached(hand) {
    const key = hand.slice(3).join('');
    let v = hcCache.get(key);
    if (v === undefined) {
      v = handCount(hand);
      if (hcCache.size > 60000) hcCache.clear();
      hcCache.set(key, v);
    }
    return v;
  }

  function buildFeatures(st) {
    const f = [];
    const me = st.me, hand = st.hand, sizes = st.sizes, L = st.landlord;
    const mine = sizes[me];
    const nxt = (me + 1) % 3, prv = (me + 2) % 3;
    const amLandlord = me === L;

    f.push(mine / 20);
    f.push(sizes[nxt] / 20);
    f.push(sizes[prv] / 20);
    f.push(amLandlord ? 1 : 0);
    f.push(st.turn === me ? 1 : 0);
    f.push((st.turn === me && st.isLeading) ? 1 : 0);

    const lm = st.lastMove;
    const la = lm ? analyze(lm) : null;
    f.push(lm ? total(lm) / 20 : 0);
    f.push(la ? la.r / 17 : 0);
    for (let t = 1; t <= 14; t++) f.push(la && la.t === t ? 1 : 0);

    for (let r = 3; r <= 17; r++) f.push(hand[r] / 4);
    for (let r = 3; r <= 17; r++) f.push(st.played[r] / 4);

    let bombs = 0, jok = 0, maxr = 3, singles = 0, pairs = 0;
    for (let r = 3; r <= 15; r++) if (hand[r] === 4) bombs++;
    if (hand[16]) jok++;
    if (hand[17]) jok++;
    for (let r = 17; r >= 3; r--) if (hand[r]) { maxr = r; break; }
    for (let r = 3; r <= 17; r++) { if (hand[r] === 1) singles++; else if (hand[r] === 2) pairs++; }

    f.push(bombs / 2);
    f.push(jok / 2);
    f.push(maxr / 17);
    f.push(Math.min(12, handCountCached(hand)) / 12);
    f.push(mine <= 2 ? 1 : 0);
    f.push(mine <= 4 ? 1 : 0);
    f.push(singles / 8);
    f.push(pairs / 6);
    f.push((hand[16] && hand[17]) ? 1 : 0);

    /* 离我最近的危险对手 */
    let minOpp = 99;
    for (let i = 0; i < 3; i++) {
      if (i === me) continue;
      if (amLandlord === (i === L)) continue; /* 同阵营跳过 */
      if (sizes[i] < minOpp) minOpp = sizes[i];
    }
    f.push(minOpp <= 2 ? 1 : 0);
    f.push(minOpp <= 5 ? 1 : 0);

    /* 队友（农民视角）手牌数 */
    let mate = -1;
    if (!amLandlord) for (let i = 0; i < 3; i++) if (i !== me && i !== L) mate = i;
    f.push(mate >= 0 ? sizes[mate] / 20 : 0);

    f.push(Math.log2(Math.max(1, st.mult)) / 3);
    return Float32Array.from(f);
  }

  const DIM = buildFeatures({
    me: 0, hand: new Int8Array(18), sizes: [17, 17, 17], landlord: 0,
    turn: 0, lastMove: null, played: new Int8Array(18), mult: 1, isLeading: true
  }).length;

  DDZ.FEATURE_DIM = DIM;
  DDZ.buildFeatures = buildFeatures;
  DDZ.stateFor = stateFor;
  DDZ.afterMove = afterMove;
  DDZ.afterPass = afterPass;

  /* ---------- MLP ---------- */
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  class MLP {
    constructor(dim, hidden) {
      this.dim = dim;
      this.hidden = hidden;
      this.W1 = new Float32Array(hidden * dim);
      this.b1 = new Float32Array(hidden);
      this.W2 = new Float32Array(hidden);
      this.b2 = new Float32Array(1);
      const s1 = Math.sqrt(2 / dim), s2 = Math.sqrt(2 / hidden);
      for (let i = 0; i < this.W1.length; i++) this.W1[i] = randn() * s1;
      for (let i = 0; i < this.W2.length; i++) this.W2[i] = randn() * s2;
      this._h = new Float32Array(hidden);
    }

    forward(x) {
      const h = this.hidden, dim = this.dim, hbuf = this._h;
      const W1 = this.W1, b1 = this.b1, W2 = this.W2;
      for (let j = 0; j < h; j++) {
        let s = b1[j];
        const off = j * dim;
        for (let i = 0; i < dim; i++) s += W1[off + i] * x[i];
        hbuf[j] = s > 0 ? s : 0;
      }
      let o = this.b2[0];
      for (let j = 0; j < h; j++) o += W2[j] * hbuf[j];
      return 1 / (1 + Math.exp(-o));
    }

    toJSON() {
      return {
        dim: this.dim, hidden: this.hidden,
        W1: Array.from(this.W1), b1: Array.from(this.b1),
        W2: Array.from(this.W2), b2: Array.from(this.b2)
      };
    }

    static fromJSON(o) {
      const m = new MLP(o.dim, o.hidden);
      m.W1.set(o.W1); m.b1.set(o.b1); m.W2.set(o.W2); m.b2.set(o.b2);
      return m;
    }
  }
  DDZ.MLP = MLP;

  /* ---------- Adam 训练器 ---------- */
  class Trainer {
    constructor(net, lr) {
      this.net = net;
      this.lr = lr === undefined ? 0.003 : lr;
      const shapes = [
        ['W1', net.W1.length], ['b1', net.b1.length],
        ['W2', net.W2.length], ['b2', net.b2.length]
      ];
      this.m = {}; this.v = {};
      for (const [k, n] of shapes) { this.m[k] = new Float32Array(n); this.v[k] = new Float32Array(n); }
      this.t = 0;
      this.gW1 = new Float32Array(net.W1.length);
      this.gb1 = new Float32Array(net.b1.length);
      this.gW2 = new Float32Array(net.W2.length);
      this.gb2 = new Float32Array(1);
    }

    /* 单条样本累加梯度 */
    _accum(x, y, hbuf, dh) {
      const net = this.net, dim = net.dim, H = net.hidden;
      const W1 = net.W1, b1 = net.b1, W2 = net.W2;
      for (let j = 0; j < H; j++) {
        let s = b1[j];
        const off = j * dim;
        for (let i = 0; i < dim; i++) s += W1[off + i] * x[i];
        hbuf[j] = s > 0 ? s : 0;
      }
      let o = net.b2[0];
      for (let j = 0; j < H; j++) o += W2[j] * hbuf[j];
      const p = 1 / (1 + Math.exp(-o));
      const d = p - y;                       /* BCE + sigmoid 的梯度 */
      for (let j = 0; j < H; j++) {
        this.gW2[j] += d * hbuf[j];
        dh[j] = d * W2[j] * (hbuf[j] > 0 ? 1 : 0);
      }
      this.gb2[0] += d;
      for (let j = 0; j < H; j++) {
        const dj = dh[j];
        if (dj === 0) continue;
        const off = j * dim;
        for (let i = 0; i < dim; i++) this.gW1[off + i] += dj * x[i];
        this.gb1[j] += dj;
      }
      return p;
    }

    _adam(arr, grad, mk, vk, n) {
      const lr = this.lr, b1 = 0.9, b2 = 0.999, eps = 1e-8;
      const t = this.t;
      const c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
      for (let i = 0; i < n; i++) {
        const g = grad[i];
        mk[i] = b1 * mk[i] + (1 - b1) * g;
        vk[i] = b2 * vk[i] + (1 - b2) * g * g;
        arr[i] -= lr * (mk[i] / c1) / (Math.sqrt(vk[i] / c2) + eps);
      }
    }

    /* X: Float32Array(n*dim)，y: Uint8Array(n) */
    trainEpoch(X, y, n, batchSize) {
      const dim = this.net.dim, H = this.net.hidden;
      const order = new Int32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = n - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      const hbuf = new Float32Array(H), dh = new Float32Array(H);
      let loss = 0;
      for (let start = 0; start < n; start += batchSize) {
        const end = Math.min(n, start + batchSize);
        this.gW1.fill(0); this.gb1.fill(0); this.gW2.fill(0); this.gb2.fill(0);
        for (let k = start; k < end; k++) {
          const idx = order[k];
          const x = X.subarray(idx * dim, idx * dim + dim);
          const p = this._accum(x, y[idx], hbuf, dh);
          const pc = Math.min(1 - 1e-7, Math.max(1e-7, p));
          loss -= y[idx] ? Math.log(pc) : Math.log(1 - pc);
        }
        this.t++;
        const cnt = end - start;
        for (let i = 0; i < this.gW1.length; i++) this.gW1[i] /= cnt;
        for (let i = 0; i < this.gb1.length; i++) this.gb1[i] /= cnt;
        for (let i = 0; i < this.gW2.length; i++) this.gW2[i] /= cnt;
        this.gb2[0] /= cnt;
        this._adam(this.net.W1, this.gW1, this.m.W1, this.v.W1, this.net.W1.length);
        this._adam(this.net.b1, this.gb1, this.m.b1, this.v.b1, this.net.b1.length);
        this._adam(this.net.W2, this.gW2, this.m.W2, this.v.W2, this.net.W2.length);
        this._adam(this.net.b2, this.gb2, this.m.b2, this.v.b2, 1);
      }
      return loss / n;
    }
  }
  DDZ.Trainer = Trainer;

  /* ---------- 模型策略（1 步搜索） ---------- */
  const EPS = 1e-4;

  function makeModelPolicy(net, opts) {
    opts = opts || {};
    const eps = opts.epsilon || 0;      /* 探索率（训练时用） */
    const usePass = opts.usePass !== false;
    /* 经验值：1 步贪心天然偏保守，需要额外的过牌门槛来抵消“让出主动权”的低估 */
    const passMargin = opts.passMargin === undefined ? 0.06 : opts.passMargin;
    const priorW = opts.prior === undefined ? 0.02 : opts.prior;

    return {
      name: opts.name || 'model',
      net: net,

      chooseBid: function (game, seat) {
        /* 叫分用简单强度估计，模型只负责打牌 */
        const st = DDZ.handStrength(game.hands[seat]);
        const need = game.bestBid + 1;
        let want = st < 0.36 ? 0 : st < 0.5 ? 1 : st < 0.64 ? 2 : 3;
        if (want < need) return 0;
        return want;
      },

      chooseMove: function (game, seat) {
        const hand = game.hands[seat];
        const mv = DDZ.genMoves(hand, game.lastSeat === seat ? null : game.lastMove);
        if (mv.length === 0) return null;

        const mine = total(hand);
        /* 能一次走完直接走 */
        for (let i = 0; i < mv.length; i++) if (total(mv[i]) === mine) return mv[i];

        const st = stateFor(game, seat);
        const next = (seat + 1) % 3;

        if (eps > 0 && Math.random() < eps) {
          const pool = mv.slice();
          if (game.canPass() && usePass) pool.push(null);
          return pool[(Math.random() * pool.length) | 0];
        }

        const before = handCountCached(hand);
        let bestS = -1e9, best = mv[0];
        for (let i = 0; i < mv.length; i++) {
          const m = mv[i];
          const s2 = afterMove(st, m, next);
          let s = net.forward(buildFeatures(s2));
          if (priorW !== 0) {
            /* 结构先验：拆散顺子/连对会抬高手数，网络价值接近时优先不拆 */
            s += priorW * (before - 1 - handCountCached(s2.hand));
          }
          s -= EPS * i * 0.001;
          if (s > bestS) { bestS = s; best = m; }
        }
        /* 过牌也是一个动作 */
        if (usePass && game.canPass()) {
          const vp = net.forward(buildFeatures(afterPass(st, next)));
          if (vp > bestS + passMargin) return null;
        }
        return best;
      }
    };
  }
  DDZ.makeModelPolicy = makeModelPolicy;

  /* ------------------------------------------------------------------
     集合作战：启发式与模型各自给出提案，由价值网络裁决二选一。
     实测优于任一单独一方（因为启发式的结构纪律 + 网络的价值判断互补）。
     ------------------------------------------------------------------ */
  DDZ.makeEnsemblePolicy = function (net, opts) {
    opts = opts || {};
    const mp = makeModelPolicy(net, opts);
    const H = DDZ.HeuristicBot;
    return {
      name: 'ensemble',
      chooseBid: function (g, s) { return H.chooseBid(g, s); },
      chooseMove: function (g, s) {
        const a = mp.chooseMove(g, s);
        const b = H.chooseMove(g, s);
        if (a === b) return a;
        const st = stateFor(g, s), nx = (s + 1) % 3;
        const val = function (m) {
          return m ? net.forward(buildFeatures(afterMove(st, m, nx)))
                   : net.forward(buildFeatures(afterPass(st, nx)));
        };
        return val(a) >= val(b) ? a : b;
      }
    };
  };

  /* 随机策略（评测下限基准） */
  DDZ.makeRandomPolicy = function () {
    return {
      name: 'random',
      chooseBid: function () { return 0; },
      chooseMove: function (game, seat) {
        const mv = DDZ.genMoves(game.hands[seat], game.lastSeat === seat ? null : game.lastMove);
        if (!mv.length) return null;
        if (game.canPass() && Math.random() < 0.35) return null;
        return mv[(Math.random() * mv.length) | 0];
      }
    };
  };
})();
