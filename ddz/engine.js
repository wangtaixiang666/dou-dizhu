/* 斗地主规则引擎 —— Node 与浏览器共用（挂到 globalThis.DDZ） */
(function () {
  'use strict';
  const G = globalThis;
  const DDZ = (G.DDZ = G.DDZ || {});

  /* ========== 牌型 ========== */
  const T = {
    SINGLE: 1, PAIR: 2, TRIO: 3, TRIO1: 4, TRIO2: 5, STRAIGHT: 6, PAIRS: 7,
    PLANE: 8, PLANE1: 9, PLANE2: 10, FOUR2: 11, FOUR4: 12, BOMB: 13, ROCKET: 14
  };
  const TYPE_NAME = {
    1: '单张', 2: '对子', 3: '三张', 4: '三带一', 5: '三带二', 6: '顺子', 7: '连对',
    8: '飞机', 9: '飞机带单', 10: '飞机带对', 11: '四带二', 12: '四带两对', 13: '炸弹', 14: '王炸'
  };
  DDZ.T = T;
  DDZ.TYPE_NAME = TYPE_NAME;

  /* ========== 牌的编码 ==========
     id 0..51 -> 点数 3..15（15 = 2）；id 52 = 小王；id 53 = 大王
     counts 用长度 18 的 Int8Array，下标即点数 */
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
  const SUITS = ['♠', '♥', '♣', '♦'];

  function cardRank(id) { return id < 52 ? 3 + (id >> 2) : (id === 52 ? 16 : 17); }
  function rankLabel(r) { return RANK_LABEL[r] || String(r); }
  function cardLabel(id) {
    const r = cardRank(id);
    if (r >= 16) return rankLabel(r);
    return SUITS[id & 3] + rankLabel(r);
  }
  function newCounts() { return new Int8Array(18); }
  function total(c) { let n = 0; for (let r = 3; r <= 17; r++) n += c[r]; return n; }

  DDZ.cardRank = cardRank;
  DDZ.rankLabel = rankLabel;
  DDZ.cardLabel = cardLabel;
  DDZ.newCounts = newCounts;
  DDZ.total = total;

  function contiguous(rs) {
    for (let i = 1; i < rs.length; i++) if (rs[i] !== rs[i - 1] + 1) return false;
    return true;
  }

  /* ========== 牌型识别 ========== */
  /* 返回 null 或 {t, r: 主点数, n: 总张数} */
  function analyze(c) {
    let n = 0;
    const rs = [];
    for (let r = 3; r <= 17; r++) { const k = c[r]; if (k) { n += k; rs.push(r); } }
    if (n === 0) return null;

    if (n === 2 && c[16] === 1 && c[17] === 1) return { t: T.ROCKET, r: 17, n: 2 };

    if (rs.length === 1) {
      const k = c[rs[0]];
      if (k === 1) return { t: T.SINGLE, r: rs[0], n: 1 };
      if (k === 2) return { t: T.PAIR, r: rs[0], n: 2 };
      if (k === 3) return { t: T.TRIO, r: rs[0], n: 3 };
      if (k === 4) return { t: T.BOMB, r: rs[0], n: 4 };
      return null;
    }

    /* 三带一 / 三带二 */
    if (n === 4 && rs.length === 2) {
      const a = c[rs[0]], b = c[rs[1]];
      if (a === 3 && b === 1) return { t: T.TRIO1, r: rs[0], n: 4 };
      if (a === 1 && b === 3) return { t: T.TRIO1, r: rs[1], n: 4 };
      return null;
    }
    if (n === 5 && rs.length === 2) {
      const a = c[rs[0]], b = c[rs[1]];
      if (a === 3 && b === 2) return { t: T.TRIO2, r: rs[0], n: 5 };
      if (a === 2 && b === 3) return { t: T.TRIO2, r: rs[1], n: 5 };
      return null;
    }

    /* 顺子：连续单张，>=5 张，最大 A（14），不含 2 与大小王 */
    if (n >= 5 && rs.length === n && contiguous(rs) && rs[rs.length - 1] <= 14) {
      return { t: T.STRAIGHT, r: rs[0], n: n };
    }
    /* 连对：连续对子，>=3 对 */
    if (n >= 6 && (n & 1) === 0 && rs.length === n / 2 && contiguous(rs) && rs[rs.length - 1] <= 14) {
      let ok = true;
      for (let i = 0; i < rs.length; i++) if (c[rs[i]] !== 2) { ok = false; break; }
      if (ok) return { t: T.PAIRS, r: rs[0], n: n };
    }
    /* 纯飞机：连续三张，>=2 组 */
    if (n >= 6 && n % 3 === 0 && rs.length === n / 3 && contiguous(rs) && rs[rs.length - 1] <= 14) {
      let ok = true;
      for (let i = 0; i < rs.length; i++) if (c[rs[i]] !== 3) { ok = false; break; }
      if (ok) return { t: T.PLANE, r: rs[0], n: n };
    }

    /* 四带二（4+2 单）/ 四带两对（4+2 对） */
    if (n === 6 || n === 8) {
      let four = -1;
      for (let i = 0; i < rs.length; i++) if (c[rs[i]] === 4) { four = rs[i]; break; }
      if (four > 0) {
        const rest = [];
        for (let i = 0; i < rs.length; i++) {
          if (rs[i] === four) continue;
          for (let k = 0; k < c[rs[i]]; k++) rest.push(rs[i]);
        }
        if (n === 6 && rest.length === 2) return { t: T.FOUR2, r: four, n: 6 };
        if (n === 8 && rest.length === 4) {
          const m = {};
          for (let i = 0; i < 4; i++) m[rest[i]] = (m[rest[i]] || 0) + 1;
          const v = Object.keys(m);
          if (v.length === 2 && m[v[0]] === 2 && m[v[1]] === 2) return { t: T.FOUR4, r: four, n: 8 };
        }
      }
    }

    /* 飞机带单 / 带对 */
    for (let k = 2; k <= 6; k++) {
      const withPair = n === 5 * k;
      if (n !== 4 * k && !withPair) continue;
      for (let s = 3; s + k - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < k; i++) if (c[s + i] < 3) { ok = false; break; }
        if (!ok) continue;
        const rem = c.slice();
        for (let i = 0; i < k; i++) rem[s + i] -= 3;
        let remTotal = 0;
        const remRanks = [];
        for (let r = 3; r <= 17; r++) if (rem[r] > 0) { remTotal += rem[r]; remRanks.push(r); }
        if (withPair) {
          if (remTotal !== 2 * k || remRanks.length !== k) continue;
          let allPairs = true;
          for (let i = 0; i < remRanks.length; i++) if (rem[remRanks[i]] !== 2) { allPairs = false; break; }
          if (allPairs) return { t: T.PLANE2, r: s, n: n };
        } else {
          if (remTotal !== k) continue;
          let okk = true;
          /* 翅膀不能落在主牌点数的余牌上，否则 3333+4444 会被误判成飞机带单 */
          for (let i = 0; i < k; i++) if (rem[s + i] > 0) { okk = false; break; }
          for (let i = 0; okk && i < remRanks.length; i++) if (rem[remRanks[i]] >= 3) { okk = false; break; }
          if (okk) return { t: T.PLANE1, r: s, n: n };
        }
      }
    }
    return null;
  }
  DDZ.analyze = analyze;

  /* a 能否压过 b（b 为 null 表示自由出牌） */
  function beats(a, b) {
    if (!b) return !!a;
    if (!a) return false;
    /* 王炸最大，任何牌都压不过（含另一手王炸）——必须先判 b */
    if (b.t === T.ROCKET) return false;
    if (a.t === T.ROCKET) return true;
    if (a.t === T.BOMB && b.t !== T.BOMB) return true;
    if (b.t === T.BOMB && a.t !== T.BOMB) return false;
    if (a.t !== b.t) return false;
    if (a.n !== b.n) return false;
    return a.r > b.r;
  }
  DDZ.beats = beats;

  /* ========== 带牌候选 ========== */
  /* 三带一的带牌：优先散牌、再拆对、点数小的优先 */
  function kickSingles(c, ex, limit) {
    const cand = [];
    for (let r = 3; r <= 17; r++) {
      if (r === ex || c[r] === 0) continue;
      cand.push({ r: r, w: c[r] === 1 ? 0 : c[r] === 2 ? 1 : c[r] === 3 ? 2 : 3 });
    }
    cand.sort(function (a, b) { return a.w - b.w || a.r - b.r; });
    const out = [];
    for (let i = 0; i < cand.length && out.length < limit; i++) out.push(cand[i].r);
    return out;
  }

  function kickPairs(c, ex, limit) {
    const cand = [];
    for (let r = 3; r <= 17; r++) {
      if (r === ex || c[r] < 2) continue;
      cand.push({ r: r, w: c[r] === 2 ? 0 : c[r] === 3 ? 1 : 2 });
    }
    cand.sort(function (a, b) { return a.w - b.w || a.r - b.r; });
    const out = [];
    for (let i = 0; i < cand.length && out.length < limit; i++) out.push(cand[i].r);
    return out;
  }

  /* 飞机/四带二 需要一次取 k 张散牌：返回若干组候选 */
  function kickSinglesMulti(rem, k, limit) {
    const cards = [];
    for (let r = 3; r <= 17; r++) {
      for (let i = 0; i < rem[r]; i++) cards.push({ r: r, w: rem[r] === 1 ? 0 : rem[r] === 2 ? 1 : 2 });
    }
    /* 拆三张当单牌会产生歧义牌型，尽量排除 */
    const safe = cards.filter(function (x) { return x.w <= 1; });
    const pool = safe.length >= k ? safe : cards;
    pool.sort(function (a, b) { return a.w - b.w || a.r - b.r; });
    const out = [];
    for (let t = 0; t < limit; t++) {
      const set = [];
      for (let i = t; i < k + t && i < pool.length; i++) set.push(pool[i].r);
      if (set.length === k) out.push(set);
    }
    return out;
  }

  function kickPairsMulti(rem, k, limit) {
    const cand = [];
    for (let r = 3; r <= 17; r++) if (rem[r] >= 2) cand.push({ r: r, w: rem[r] === 2 ? 0 : 1 });
    cand.sort(function (a, b) { return a.w - b.w || a.r - b.r; });
    const out = [];
    for (let t = 0; t < limit; t++) {
      const set = [];
      for (let i = t; i < k + t && i < cand.length; i++) set.push(cand[i].r);
      if (set.length === k) out.push(set);
    }
    return out;
  }

  /* ========== 合法出牌枚举 ========== */
  function genFree(c, out) {
    const rk = [];
    for (let r = 3; r <= 17; r++) if (c[r] > 0) rk.push(r);

    for (let i = 0; i < rk.length; i++) {
      const r = rk[i];
      let m = new Int8Array(18); m[r] = 1; out.push(m);
      if (c[r] >= 2) { m = new Int8Array(18); m[r] = 2; out.push(m); }
      if (c[r] >= 3) {
        m = new Int8Array(18); m[r] = 3; out.push(m);
        const ks = kickSingles(c, r, 12);
        for (let j = 0; j < ks.length; j++) { const m2 = new Int8Array(18); m2[r] = 3; m2[ks[j]] = 1; out.push(m2); }
        const kp = kickPairs(c, r, 8);
        for (let j = 0; j < kp.length; j++) { const m2 = new Int8Array(18); m2[r] = 3; m2[kp[j]] = 2; out.push(m2); }
      }
      if (c[r] === 4) { m = new Int8Array(18); m[r] = 4; out.push(m); }
    }
    if (c[16] && c[17]) { const m = new Int8Array(18); m[16] = 1; m[17] = 1; out.push(m); }

    /* 顺子 */
    for (let len = 5; len <= 12; len++) {
      for (let s = 3; s + len - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < len; i++) if (c[s + i] < 1) { ok = false; break; }
        if (!ok) continue;
        const m = new Int8Array(18);
        for (let i = 0; i < len; i++) m[s + i] = 1;
        out.push(m);
      }
    }
    /* 连对 */
    for (let len = 3; len <= 10; len++) {
      for (let s = 3; s + len - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < len; i++) if (c[s + i] < 2) { ok = false; break; }
        if (!ok) continue;
        const m = new Int8Array(18);
        for (let i = 0; i < len; i++) m[s + i] = 2;
        out.push(m);
      }
    }
    /* 飞机（纯 / 带单 / 带对） */
    for (let k = 2; k <= 6; k++) {
      for (let s = 3; s + k - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < k; i++) if (c[s + i] < 3) { ok = false; break; }
        if (!ok) continue;
        const base = new Int8Array(18);
        for (let i = 0; i < k; i++) base[s + i] = 3;
        out.push(base);
        const rem = c.slice();
        for (let i = 0; i < k; i++) rem[s + i] -= 3;
        for (let i = 0; i < k; i++) rem[s + i] = 0;   /* 主牌点数的余牌不能再当翅膀 */
        const ss = kickSinglesMulti(rem, k, 2);
        for (let j = 0; j < ss.length; j++) {
          const m = base.slice(); for (let q = 0; q < k; q++) m[ss[j][q]]++;
          out.push(m);
        }
        const pp = kickPairsMulti(rem, k, 1);
        for (let j = 0; j < pp.length; j++) {
          const m = base.slice(); for (let q = 0; q < k; q++) m[pp[j][q]] += 2;
          out.push(m);
        }
      }
    }
    /* 四带二 */
    for (let i = 0; i < rk.length; i++) {
      const r = rk[i];
      if (c[r] !== 4) continue;
      const rem = c.slice(); rem[r] = 0;
      const s1 = kickSinglesMulti(rem, 2, 1);
      for (let j = 0; j < s1.length; j++) {
        const m = new Int8Array(18); m[r] = 4;
        for (let q = 0; q < 2; q++) m[s1[j][q]]++;
        out.push(m);
      }
      const p1 = kickPairsMulti(rem, 2, 1);
      for (let j = 0; j < p1.length; j++) {
        const m = new Int8Array(18); m[r] = 4;
        for (let q = 0; q < 2; q++) m[p1[j][q]] += 2;
        out.push(m);
      }
    }
  }

  function genBeat(c, last, out) {
    const t = last.t, R = last.r, N = last.n;

    if (t !== T.ROCKET && t !== T.BOMB) {
      if (t === T.SINGLE) {
        for (let r = R + 1; r <= 17; r++) if (c[r] >= 1) { const m = new Int8Array(18); m[r] = 1; out.push(m); }
      } else if (t === T.PAIR) {
        for (let r = R + 1; r <= 17; r++) if (c[r] >= 2) { const m = new Int8Array(18); m[r] = 2; out.push(m); }
      } else if (t === T.TRIO) {
        for (let r = R + 1; r <= 17; r++) if (c[r] >= 3) { const m = new Int8Array(18); m[r] = 3; out.push(m); }
      } else if (t === T.TRIO1 || t === T.TRIO2) {
        const need = t === T.TRIO1 ? 1 : 2;
        for (let r = R + 1; r <= 17; r++) {
          if (c[r] < 3) continue;
          const ks = need === 1 ? kickSingles(c, r, 12) : kickPairs(c, r, 8);
          for (let j = 0; j < ks.length; j++) {
            const m = new Int8Array(18); m[r] = 3; m[ks[j]] = need;
            out.push(m);
          }
        }
      } else if (t === T.STRAIGHT) {
        for (let s = R + 1; s + N - 1 <= 14; s++) {
          let ok = true;
          for (let i = 0; i < N; i++) if (c[s + i] < 1) { ok = false; break; }
          if (!ok) continue;
          const m = new Int8Array(18);
          for (let i = 0; i < N; i++) m[s + i] = 1;
          out.push(m);
        }
      } else if (t === T.PAIRS) {
        const len = N / 2;
        for (let s = R + 1; s + len - 1 <= 14; s++) {
          let ok = true;
          for (let i = 0; i < len; i++) if (c[s + i] < 2) { ok = false; break; }
          if (!ok) continue;
          const m = new Int8Array(18);
          for (let i = 0; i < len; i++) m[s + i] = 2;
          out.push(m);
        }
      } else if (t === T.PLANE || t === T.PLANE1 || t === T.PLANE2) {
        const k = t === T.PLANE ? N / 3 : t === T.PLANE1 ? N / 4 : N / 5;
        for (let s = R + 1; s + k - 1 <= 14; s++) {
          let ok = true;
          for (let i = 0; i < k; i++) if (c[s + i] < 3) { ok = false; break; }
          if (!ok) continue;
          const base = new Int8Array(18);
          for (let i = 0; i < k; i++) base[s + i] = 3;
          if (t === T.PLANE) { out.push(base); continue; }
          const rem = c.slice();
          for (let i = 0; i < k; i++) rem[s + i] -= 3;
          for (let i = 0; i < k; i++) rem[s + i] = 0;   /* 主牌点数的余牌不能再当翅膀 */
          if (t === T.PLANE1) {
            const ss = kickSinglesMulti(rem, k, 1);
            for (let j = 0; j < ss.length; j++) {
              const m = base.slice();
              for (let q = 0; q < k; q++) m[ss[j][q]]++;
              out.push(m);
            }
          } else {
            const pp = kickPairsMulti(rem, k, 1);
            for (let j = 0; j < pp.length; j++) {
              const m = base.slice();
              for (let q = 0; q < k; q++) m[pp[j][q]] += 2;
              out.push(m);
            }
          }
        }
      } else if (t === T.FOUR2 || t === T.FOUR4) {
        for (let r = R + 1; r <= 17; r++) {
          if (c[r] !== 4) continue;
          const rem = c.slice(); rem[r] = 0;
          if (t === T.FOUR2) {
            const s1 = kickSinglesMulti(rem, 2, 1);
            for (let j = 0; j < s1.length; j++) {
              const m = new Int8Array(18); m[r] = 4;
              for (let q = 0; q < 2; q++) m[s1[j][q]]++;
              out.push(m);
            }
          } else {
            const p1 = kickPairsMulti(rem, 2, 1);
            for (let j = 0; j < p1.length; j++) {
              const m = new Int8Array(18); m[r] = 4;
              for (let q = 0; q < 2; q++) m[p1[j][q]] += 2;
              out.push(m);
            }
          }
        }
      }
    }

    /* 王炸压无可压 */
    if (t === T.ROCKET) return;

    /* 炸弹（含压炸弹） */
    for (let r = 3; r <= 17; r++) {
      if (c[r] !== 4) continue;
      if (t === T.BOMB && r <= R) continue;
      const m = new Int8Array(18); m[r] = 4; out.push(m);
    }
    /* 王炸 */
    if (c[16] && c[17]) {
      const m = new Int8Array(18); m[16] = 1; m[17] = 1; out.push(m);
    }
  }

  /* 待压牌可以是 null / 原始 counts / 已解析对象，统一成已解析对象 */
  function normLast(last) {
    if (!last) return null;
    if (last.t !== undefined) return last;
    return analyze(last);
  }

  function genMoves(c, last) {
    last = normLast(last);
    const out = [];
    if (!last) genFree(c, out);
    else genBeat(c, last, out);
    return out;
  }
  DDZ.genMoves = genMoves;

  /* 校验一手牌是否在手牌里且能压 last */
  function isLegal(c, m, last) {
    for (let r = 3; r <= 17; r++) if (m[r] > c[r]) return false;
    const a = analyze(m);
    if (!a) return false;
    return beats(a, normLast(last));
  }
  DDZ.isLegal = isLegal;

  /* ========== 手牌拆分（最少手数近似） ========== */
  /* 返回拆分出的组（每组是一个 counts），用于启发式出牌与特征 */
  function decompose(c) {
    const rem = c.slice();
    const groups = [];
    const mk = function (pairs) {
      const m = new Int8Array(18);
      for (let i = 0; i < pairs.length; i++) m[pairs[i][0]] += pairs[i][1];
      for (let r = 3; r <= 17; r++) rem[r] -= m[r];
      groups.push(m);
    };

    if (rem[16] && rem[17]) mk([[16, 1], [17, 1]]);
    for (let r = 3; r <= 15; r++) if (rem[r] === 4) mk([[r, 4]]);

    /* 飞机（连续三张） */
    for (let k = 6; k >= 2; k--) {
      for (let s = 3; s + k - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < k; i++) if (rem[s + i] < 3) { ok = false; break; }
        if (!ok) continue;
        const pr = [];
        for (let i = 0; i < k; i++) pr.push([s + i, 3]);
        mk(pr);
      }
    }
    /* 顺子：从长到短 */
    for (let len = 12; len >= 5; len--) {
      let found = true;
      while (found) {
        found = false;
        for (let s = 3; s + len - 1 <= 14; s++) {
          let ok = true;
          for (let i = 0; i < len; i++) if (rem[s + i] < 1) { ok = false; break; }
          if (!ok) continue;
          const pr = [];
          for (let i = 0; i < len; i++) pr.push([s + i, 1]);
          mk(pr); found = true; break;
        }
      }
    }
    /* 连对 */
    for (let len = 10; len >= 3; len--) {
      let found = true;
      while (found) {
        found = false;
        for (let s = 3; s + len - 1 <= 14; s++) {
          let ok = true;
          for (let i = 0; i < len; i++) if (rem[s + i] < 2) { ok = false; break; }
          if (!ok) continue;
          const pr = [];
          for (let i = 0; i < len; i++) pr.push([s + i, 2]);
          mk(pr); found = true; break;
        }
      }
    }
    /* 三张 / 对子 / 单张 */
    for (let r = 3; r <= 17; r++) if (rem[r] >= 3) mk([[r, 3]]);
    for (let r = 3; r <= 17; r++) if (rem[r] >= 2) mk([[r, 2]]);
    for (let r = 3; r <= 17; r++) if (rem[r] >= 1) mk([[r, 1]]);
    return groups;
  }
  DDZ.decompose = decompose;

  function handCount(c) {
    let n = 0;
    const g = decompose(c);
    n = g.length;
    /* 三张/飞机若有带牌可并入手数，这里做一次折算 */
    let trios = 0, singles = 0, pairs = 0;
    for (let i = 0; i < g.length; i++) {
      const a = analyze(g[i]);
      if (!a) continue;
      if (a.t === T.TRIO || a.t === T.PLANE) trios++;
      else if (a.t === T.SINGLE) singles++;
      else if (a.t === T.PAIR) pairs++;
    }
    return Math.max(1, n);
  }
  DDZ.handCount = handCount;

  /* 叫分用的手牌强度（0..1 粗估） */
  function handStrength(c) {
    let s = 0;
    if (c[17]) s += 0.16;
    if (c[16]) s += 0.10;
    if (c[16] && c[17]) s += 0.10;
    for (let r = 3; r <= 15; r++) if (c[r] === 4) s += 0.20;
    s += Math.max(0, (c[15] - 0) * 0.10);   /* 2 */
    s += Math.max(0, (c[14] - 0) * 0.05);   /* A */
    s += 0.30 * (1 - Math.min(1, (handCount(c) - 6) / 10));
    return Math.max(0, Math.min(1, s));
  }
  DDZ.handStrength = handStrength;

  /* ========== 对局 ========== */
  function shuffleDeal(rand) {
    const deck = new Int8Array(54);
    for (let i = 0; i < 54; i++) deck[i] = i;
    for (let i = 53; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    const hands = [newCounts(), newCounts(), newCounts()];
    const ids = [[], [], []];
    for (let i = 0; i < 51; i++) {
      const id = deck[i], seat = i % 3;
      hands[seat][cardRank(id)]++;
      ids[seat].push(id);
    }
    return { hands: hands, ids: ids, bottom: [deck[51], deck[52], deck[53]] };
  }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.rand = opts.rand || Math.random;
      const d = shuffleDeal(this.rand);
      this.hands = d.hands;
      this.ids = d.ids;
      this.bottom = d.bottom;
      this.landlord = -1;
      this.bids = [0, 0, 0];
      this.bidTurn = (opts.firstBid | 0) % 3;
      this.bidCount = 0;
      this.bestBid = 0;
      this.bestSeat = -1;
      this.turn = 0;
      this.lastMove = null;
      this.lastSeat = -1;
      this.passes = 0;
      this.played = newCounts();
      this.multiplier = 1;
      this.base = 1;
      this.phase = 'bid';
      this.winner = -1;
      this.moveCount = [0, 0, 0];
      this.bombCount = 0;
      this.history = [];
      this.redealCount = 0;
    }

    clone() { return Object.assign(Object.create(Game.prototype), this, {
      hands: this.hands.map(function (h) { return h.slice(); }),
      ids: this.ids.map(function (a) { return a.slice(); }),
      bids: this.bids.slice(),
      moveCount: this.moveCount.slice(),
      played: this.played.slice(),
      history: this.history.slice()
    }); }

    handSize(seat) { return total(this.hands[seat]); }

    /* ---- 叫分 ---- */
    bid(seat, score) {
      if (this.phase !== 'bid' || seat !== this.bidTurn) return false;
      if (score > 0 && score <= this.bestBid) return false;
      this.bids[seat] = score;
      if (score > this.bestBid) { this.bestBid = score; this.bestSeat = seat; }
      this.bidCount++;
      if (score === 3) { this._setLandlord(seat); return true; }
      if (this.bidCount >= 3) {
        if (this.bestSeat < 0) { this.phase = 'redeal'; }
        else this._setLandlord(this.bestSeat);
        return true;
      }
      this.bidTurn = (this.bidTurn + 1) % 3;
      return true;
    }

    _setLandlord(seat) {
      this.landlord = seat;
      const b = this.bottom;
      for (let i = 0; i < 3; i++) {
        this.hands[seat][cardRank(b[i])]++;
        this.ids[seat].push(b[i]);
      }
      this.base = Math.max(1, this.bestBid);
      this.multiplier = 1;
      this.turn = seat;
      this.lastMove = null;
      this.lastSeat = -1;
      this.passes = 0;
      this.phase = 'play';
    }

    /* ---- 出牌 ---- */
    legalMoves(seat) {
      if (this.phase !== 'play' || seat !== this.turn) return [];
      return genMoves(this.hands[seat], this.lastSeat === seat ? null : this.lastMove);
    }

    canPass() {
      return this.lastMove !== null && this.lastSeat !== this.turn;
    }

    play(seat, move) {
      if (this.phase !== 'play' || seat !== this.turn) return false;
      const last = this.lastSeat === seat ? null : this.lastMove;
      if (!isLegal(this.hands[seat], move, last)) return false;
      const a = analyze(move);

      for (let r = 3; r <= 17; r++) {
        if (move[r]) {
          this.hands[seat][r] -= move[r];
          this.played[r] += move[r];
        }
      }
      /* 同步 id 列表（仅 UI 需要，训练时可忽略） */
      this._removeIds(seat, move);

      this.lastMove = move;
      this.lastSeat = seat;
      this.passes = 0;
      this.moveCount[seat]++;
      if (a.t === T.BOMB || a.t === T.ROCKET) { this.multiplier *= 2; this.bombCount++; }
      this.history.push({ seat: seat, move: move, t: a.t });

      if (total(this.hands[seat]) === 0) {
        this.phase = 'over';
        this.winner = seat;
        this._settle();
        return true;
      }
      this.turn = (seat + 1) % 3;
      return true;
    }

    _removeIds(seat, move) {
      const arr = this.ids[seat];
      if (!arr || !arr.length) return;
      const need = new Int8Array(18);
      for (let r = 3; r <= 17; r++) need[r] = move[r];
      const keep = [];
      for (let i = 0; i < arr.length; i++) {
        const r = cardRank(arr[i]);
        if (need[r] > 0) { need[r]--; } else keep.push(arr[i]);
      }
      this.ids[seat] = keep;
    }

    pass(seat) {
      if (this.phase !== 'play' || seat !== this.turn) return false;
      if (this.lastMove === null || this.lastSeat === seat) return false;
      this.passes++;
      this.history.push({ seat: seat, move: null, t: 0 });
      this.turn = (seat + 1) % 3;
      if (this.passes >= 2) {
        this.lastMove = null;
        this.lastSeat = -1;
        this.passes = 0;
      }
      return true;
    }

    _settle() {
      const L = this.landlord;
      const landlordWin = this.winner === L;
      /* 春天 */
      let spring = false;
      if (landlordWin) {
        const f1 = (L + 1) % 3, f2 = (L + 2) % 3;
        if (this.moveCount[f1] === 0 && this.moveCount[f2] === 0) spring = true;
      } else {
        if (this.moveCount[L] === 1) spring = true;
      }
      /* 认输结束的对局不计春天/反春天倍数，避免主动退出反而罚更重 */
      if (this.resigned) spring = false;
      if (spring) this.multiplier *= 2;
      this.spring = spring;
      this.landlordWin = landlordWin;
      this.landlordSeat = L;
      this.score = this.base * this.multiplier;
    }

    isFarmerWin(seat) { return this.phase === 'over' && this.winner !== this.landlord; }
  }

  DDZ.Game = Game;

  /* ========== 工具：把 counts 转成 id 列表（UI 用） ========== */
  DDZ.countsToIds = function (idsAvailable, move) {
    const need = new Int8Array(18);
    for (let r = 3; r <= 17; r++) need[r] = move[r];
    const out = [];
    for (let i = 0; i < idsAvailable.length; i++) {
      const r = cardRank(idsAvailable[i]);
      if (need[r] > 0) { need[r]--; out.push(idsAvailable[i]); }
    }
    return out;
  };

  /* 一手牌排序显示：点数降序，同点数按花色 */
  DDZ.sortIds = function (ids) {
    return ids.slice().sort(function (a, b) {
      const ra = cardRank(a), rb = cardRank(b);
      if (ra !== rb) return rb - ra;
      return (a & 3) - (b & 3);
    });
  };
})();
