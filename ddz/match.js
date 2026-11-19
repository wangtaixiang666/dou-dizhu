/* 对局运行器 + 评测 */
(function () {
  'use strict';
  const G = globalThis;
  const DDZ = (G.DDZ = G.DDZ || {});

  /* 三方策略对打一局。policies[seat] = {chooseBid, chooseMove}
     返回 null 表示流局（三家都不叫）或对局异常 */
  function playGame(policies, opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random;
    const onMove = opts.onMove || null;
    const game = new DDZ.Game({ rand: rand });

    let guard = 0;
    while (game.phase === 'bid') {
      const seat = game.bidTurn;
      let sc = 0;
      try { sc = policies[seat].chooseBid(game, seat); } catch (e) { sc = 0; }
      if (!game.bid(seat, sc)) game.bid(seat, 0);
      if (++guard > 12) return null;
    }
    if (game.phase !== 'play') return null;   /* 流局 */

    guard = 0;
    while (game.phase === 'play') {
      const seat = game.turn;
      let mv = null;
      try { mv = policies[seat].chooseMove(game, seat); } catch (e) { mv = undefined; }

      if (mv === undefined) { mv = null; }

      if (mv) {
        if (!game.play(seat, mv)) {
          const ms = game.legalMoves(seat);
          if (ms.length) game.play(seat, ms[0]);
          else if (!game.pass(seat)) return null;
        }
      } else {
        if (!game.pass(seat)) {
          const ms = game.legalMoves(seat);
          if (ms.length) game.play(seat, ms[0]);
          else return null;
        }
      }
      if (onMove) onMove(game, seat, mv);
      if (++guard > 900) return null;
    }
    return game.phase === 'over' ? game : null;
  }

  DDZ.playGame = playGame;

  /* 让 policy 占据指定座位，其余座位用 opponent，统计 policy 所在阵营胜率 */
  function evalSeatRate(policy, opponent, games, seat, opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random;
    let wins = 0, played = 0, redeal = 0;
    for (let i = 0; i < games; i++) {
      const pols = [opponent, opponent, opponent];
      pols[seat] = policy;
      const g = playGame(pols, { rand: rand });
      if (!g) { redeal++; continue; }
      played++;
      const isLandlord = g.landlord === seat;
      const myTeamWon = (g.winner === g.landlord) === isLandlord;
      if (myTeamWon) wins++;
    }
    return { wins: wins, played: played, redeal: redeal, rate: played ? wins / played : 0 };
  }

  /* 三个座位轮流，综合胜率（贴近“1 个玩家 + 2 个电脑”的部署形态） */
  DDZ.evaluate = function (policy, opponent, games, opts) {
    const per = Math.ceil(games / 3);
    let w = 0, n = 0, rd = 0;
    const detail = [];
    for (let seat = 0; seat < 3; seat++) {
      const r = evalSeatRate(policy, opponent, per, seat, opts);
      w += r.wins; n += r.played; rd += r.redeal;
      detail.push({ seat: seat, rate: r.rate, played: r.played });
    }
    return { rate: n ? w / n : 0, wins: w, played: n, redeal: rd, detail: detail };
  };

  /* 自对弈（三方同一策略），用于基线平衡检查 */
  DDZ.selfPlayRate = function (policy, games, opts) {
    let lw = 0, n = 0;
    for (let i = 0; i < games; i++) {
      const g = playGame([policy, policy, policy], opts || {});
      if (!g) continue;
      n++;
      if (g.winner === g.landlord) lw++;
    }
    return { landlordRate: n ? lw / n : 0, played: n };
  };
})();
