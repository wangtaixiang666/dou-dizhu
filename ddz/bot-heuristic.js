/* 启发式机器人 —— 训练对手 / 评测基线 / 简单难度 AI */
(function () {
  'use strict';
  const G = globalThis;
  const DDZ = (G.DDZ = G.DDZ || {});
  const T = DDZ.T;
  const analyze = DDZ.analyze;
  const handCount = DDZ.handCount;
  const total = DDZ.total;

  function partner(seat, landlord) {
    /* 农民队友 */
    if (seat === landlord) return -1;
    for (let i = 0; i < 3; i++) if (i !== seat && i !== landlord) return i;
    return -1;
  }

  function isTeammate(seat, other, landlord) {
    return seat !== landlord && other !== landlord && seat !== other;
  }

  /* 出完这一手之后的“手数代价” */
  function handCost(hand, move) {
    const after = hand.slice();
    for (let r = 3; r <= 17; r++) after[r] -= move[r];
    return { count: handCount(after), remain: total(after), after: after };
  }

  function scoreMove(hand, move, before, urgent) {
    const a = analyze(move);
    const c = handCost(hand, move);
    let s = c.count * 12;
    /* 理想情况：本手消耗掉一手，手数应减 1 */
    s += Math.max(0, c.count - (before - 1)) * 16;
    s += a.r * 0.35;                       /* 同等结构下出小牌 */
    s -= total(move) * 0.9;                /* 倾向一次多走牌 */
    if (a.t === T.BOMB) s += urgent ? 18 : 55;
    if (a.t === T.ROCKET) s += urgent ? 24 : 80;
    if (c.remain === 0) s -= 2000;
    return s;
  }

  function chooseBid(game, seat) {
    const st = DDZ.handStrength(game.hands[seat]);
    const need = game.bestBid + 1;
    let want = st < 0.34 ? 0 : st < 0.48 ? 1 : st < 0.62 ? 2 : 3;
    if (want < need) return 0;
    return want;
  }

  function chooseMove(game, seat) {
    const hand = game.hands[seat];
    const last = game.lastSeat === seat ? null : game.lastMove;
    const moves = DDZ.genMoves(hand, last);
    if (moves.length === 0) return null;

    const landlord = game.landlord;
    const before = handCount(hand);
    const mySize = total(hand);

    /* 敌对阵营最少剩几张 / 队友剩几张 */
    let minOpp = 99, mateLeft = 99;
    for (let i = 0; i < 3; i++) {
      if (i === seat) continue;
      const n = total(game.hands[i]);
      if (isTeammate(seat, i, landlord)) { if (n < mateLeft) mateLeft = n; }
      else if (n < minOpp) minOpp = n;
    }
    const urgent = minOpp <= 2 || mySize <= 5;

    /* 能一次走完就走 */
    for (const m of moves) {
      if (total(m) === mySize) return m;
    }

    const lastIsMate = last ? isTeammate(seat, game.lastSeat, landlord) : false;
    const pickLowest = function (list) {
      let best = null, bestS = 1e9;
      for (const m of list) {
        const s = scoreMove(hand, m, before, true);
        if (s < bestS) { bestS = s; best = m; }
      }
      return best;
    };
    const bombsOf = function (list) {
      return list.filter(function (m) {
        const a = analyze(m);
        return a.t === T.BOMB || a.t === T.ROCKET;
      });
    };
    const normalOf = function (list) {
      return list.filter(function (m) {
        const a = analyze(m);
        return a.t !== T.BOMB && a.t !== T.ROCKET;
      });
    };

    /* ================= 防守：对手只剩 1 张 ================= */
    if (minOpp <= 1 && !lastIsMate) {
      if (!last) {
        /* 我领出：先甩一手他绝对接不住的多张牌（对子 / 三条 / 顺子…） */
        const multi = normalOf(moves).filter(function (m) { return analyze(m).t !== T.SINGLE; });
        if (multi.length) return pickLowest(multi);
        /* 只剩单张：把最大的那张打出去，顶死他 */
        let b = null, br = -1;
        for (const m of moves) { const a = analyze(m); if (a.r > br) { br = a.r; b = m; } }
        return b;
      }
      /* 我跟牌：用最大的能压牌顶死；顶不住就上炸弹 */
      let b = null, br = -1;
      const normal = normalOf(moves);
      for (const m of normal) { const a = analyze(m); if (a.r > br) { br = a.r; b = m; } }
      if (b && br >= 14) return b;                 /* A 及以上已经封死 */
      const boom = bombsOf(moves);
      if (boom.length) return boom[0];             /* 大牌顶不住就直接炸 */
      return b;                                    /* 没牌可炸，只能硬顶 */
    }

    /* ================= 配合：队友就要走完 ================= */
    if (mateLeft <= 2) {
      /* 队友出的牌一律不压，把出牌权留给他 */
      if (lastIsMate) return null;
      /* 我领出：出最小的单张，把机会交回去 */
      if (!last) {
        let b = null, br = 99;
        for (const m of moves) {
          const a = analyze(m);
          if (a.t === T.SINGLE && a.r < br) { br = a.r; b = m; }
        }
        if (b) return b;
      }
    }

    /* 领出：直接在所有候选里挑代价最小的 */
    if (!last) {
      let best = null, bestS = 1e9;
      for (const m of moves) {
        const s = scoreMove(hand, m, before, urgent);
        if (s < bestS) { bestS = s; best = m; }
      }
      return best;
    }

    /* 跟牌 */
    const teammateLed = lastIsMate;
    /* 队友出的牌，一般不去压，除非自己能走完（上面已处理） */
    if (teammateLed && !urgent) {
      /* 队友只剩很少牌时不压；队友牌多且我这边能安全接管时考虑压 */
      if (total(game.hands[game.lastSeat]) <= mySize) return null;
    }

    let best = null, bestS = 1e9, bestPenalty = 0;
    for (const m of moves) {
      const a = analyze(m);
      const c = handCost(hand, m);
      const penalty = c.count - (before - 1);
      const s = scoreMove(hand, m, before, urgent);
      if (s < bestS) { bestS = s; best = m; bestPenalty = penalty; }
      /* 压队友时更保守：只有明显更好才接管 */
      if (teammateLed && penalty > 0 && s > bestS + 20) continue;
    }

    if (!best) return null;
    /* 需要拆结构且局面不紧张 -> 宁可不出 */
    if (bestPenalty >= 2 && !urgent) return null;
    const ba = analyze(best);
    if ((ba.t === T.BOMB || ba.t === T.ROCKET) && !urgent) {
      /* 炸弹留着，除非对面快走完 */
      return null;
    }
    return best;
  }

  DDZ.HeuristicBot = {
    name: 'heuristic',
    chooseBid: chooseBid,
    chooseMove: chooseMove
  };
})();
