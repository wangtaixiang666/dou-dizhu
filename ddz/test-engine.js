/* 规则引擎单元测试：node ddz/test-engine.js */
require('./engine.js');
const DDZ = globalThis.DDZ;
const T = DDZ.T;

let pass = 0, fail = 0;
function eq(a, b, label) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { pass++; }
  else { fail++; console.log('FAIL ' + label + ' 期望 ' + sb + ' 实际 ' + sa); }
}
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.log('FAIL ' + label); }
}

function C(ranks) {
  const c = new Int8Array(18);
  for (const r of ranks) c[r]++;
  return c;
}
function A(ranks) { return DDZ.analyze(C(ranks)); }
function sig(a) { return a ? [a.t, a.r, a.n] : null; }

/* ---------- 1. 牌型识别 ---------- */
eq(sig(A([3])), [T.SINGLE, 3, 1], '单张');
eq(sig(A([15])), [T.SINGLE, 15, 1], '单张 2');
eq(sig(A([17])), [T.SINGLE, 17, 1], '单张 大王');
eq(sig(A([3, 3])), [T.PAIR, 3, 2], '对子');
eq(sig(A([3, 3, 3])), [T.TRIO, 3, 3], '三张');
eq(sig(A([3, 3, 3, 4])), [T.TRIO1, 3, 4], '三带一');
eq(sig(A([4, 3, 3, 3])), [T.TRIO1, 3, 4], '三带一（带牌更大）');
eq(sig(A([3, 3, 3, 4, 4])), [T.TRIO2, 3, 5], '三带二');
eq(sig(A([3, 3, 3, 16])), [T.TRIO1, 3, 4], '三带一小王');
eq(sig(A([3, 3, 3, 3])), [T.BOMB, 3, 4], '炸弹');
eq(sig(A([16, 17])), [T.ROCKET, 17, 2], '王炸');

eq(sig(A([3, 4, 5, 6, 7])), [T.STRAIGHT, 3, 5], '顺子 5 张');
eq(sig(A([10, 11, 12, 13, 14])), [T.STRAIGHT, 10, 5], '顺子 10-A');
eq(sig(A([3, 4, 5, 6])), null, '4 张连牌不是顺子');
eq(sig(A([11, 12, 13, 14, 15])), null, '顺子不能含 2');
eq(sig(A([13, 14, 15, 16, 17])), null, '顺子不能含王');
eq(sig(A([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])), [T.STRAIGHT, 3, 12], '顺子 12 张');

eq(sig(A([3, 3, 4, 4, 5, 5])), [T.PAIRS, 3, 6], '连对 3 对');
eq(sig(A([3, 3, 4, 4])), null, '2 连对不成立');
eq(sig(A([13, 13, 14, 14, 15, 15])), null, '连对不能含 2');

eq(sig(A([3, 3, 3, 4, 4, 4])), [T.PLANE, 3, 6], '飞机 2 组');
eq(sig(A([3, 3, 3, 4, 4, 4, 5, 5, 5])), [T.PLANE, 3, 9], '飞机 3 组');
eq(sig(A([3, 3, 3, 4, 4, 4, 5, 6])), [T.PLANE1, 3, 8], '飞机带两单');
eq(sig(A([3, 3, 3, 4, 4, 4, 5, 5, 6, 6])), [T.PLANE2, 3, 10], '飞机带两对');
/* 规则认定：333444+55 视为「飞机带两单」（两份带牌恰好同点数，主流实现允许） */
eq(sig(A([3, 3, 3, 4, 4, 4, 5, 5])), [T.PLANE1, 3, 8], '飞机带两单（带牌同点数）');
eq(sig(A([3, 3, 3, 4, 4, 4, 5, 5, 5, 5])), null, '飞机带对但张数不足');

eq(sig(A([3, 3, 3, 3, 4, 5])), [T.FOUR2, 3, 6], '四带二');
eq(sig(A([3, 3, 3, 3, 4, 5, 6, 7])), null, '四带四单不成立');
eq(sig(A([3, 3, 3, 3, 4, 4, 5, 5])), [T.FOUR4, 3, 8], '四带两对');
eq(sig(A([3, 3, 3, 3, 4, 4, 4, 4])), null, '双炸弹不算飞机带两单（禁止拆炸，避免 3333+4444 误判）');

/* ---------- 2. 大小比较 ---------- */
const S = r => DDZ.analyze(C([r]));
ok(DDZ.beats(S(4), S(3)), '单张 4 > 3');
ok(!DDZ.beats(S(3), S(4)), '单张 3 不压 4');
ok(!DDZ.beats(DDZ.analyze(C([3, 3])), S(3)), '对子不压单张');
ok(DDZ.beats(DDZ.analyze(C([3, 3, 3, 3])), DDZ.analyze(C([14, 13, 12, 11, 10]))), '炸弹压顺子');
ok(DDZ.beats(DDZ.analyze(C([16, 17])), DDZ.analyze(C([15, 15, 15, 15]))), '王炸压炸弹');
ok(!DDZ.beats(DDZ.analyze(C([15, 15, 15, 15])), DDZ.analyze(C([16, 17]))), '炸弹不压王炸');
ok(DDZ.beats(DDZ.analyze(C([4, 4, 4, 4])), DDZ.analyze(C([3, 3, 3, 3]))), '大炸弹压小炸弹');
ok(!DDZ.beats(DDZ.analyze(C([3, 4, 5, 6, 7])), DDZ.analyze(C([4, 5, 6, 7, 8, 9]))), '长度不同的顺子不可比');
ok(DDZ.beats(DDZ.analyze(C([4, 5, 6, 7, 8])), DDZ.analyze(C([3, 4, 5, 6, 7]))), '同长度顺子比首牌');
ok(DDZ.beats(S(3), null), '自由出牌任意合法牌型');

/* ---------- 3. 枚举合法性 ---------- */
function checkMoves(hand, last, label) {
  const ms = DDZ.genMoves(hand, last);
  let bad = 0, notExtractable = 0, cannotBeat = 0;
  for (const m of ms) {
    const a = DDZ.analyze(m);
    if (!a) { bad++; continue; }
    for (let r = 3; r <= 17; r++) if (m[r] > hand[r]) { notExtractable++; break; }
    if (last && !DDZ.beats(a, last)) cannotBeat++;
  }
  ok(bad === 0, label + ' 全部牌型合法（非法 ' + bad + '/' + ms.length + '）');
  ok(notExtractable === 0, label + ' 全部可取自手牌');
  ok(cannotBeat === 0, label + ' 全部能压过待压牌');
  return ms;
}

const h1 = C([3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 16, 17, 15, 15, 14, 14]);
const mv1 = checkMoves(h1, null, '自由出牌');
ok(mv1.some(m => { const a = DDZ.analyze(m); return a.t === T.STRAIGHT && a.n === 8; }), '枚举出 8 张顺子');
ok(mv1.some(m => { const a = DDZ.analyze(m); return a.t === T.ROCKET; }), '枚举出王炸');
ok(mv1.some(m => { const a = DDZ.analyze(m); return a.t === T.TRIO1 && a.r === 3; }), '枚举出三带一');

checkMoves(h1, DDZ.analyze(C([4])), '跟单张');
checkMoves(h1, DDZ.analyze(C([5, 5])), '跟对子');
checkMoves(h1, DDZ.analyze(C([3, 4, 5, 6, 7])), '跟顺子');
checkMoves(h1, DDZ.analyze(C([3, 3, 3, 4, 5])), '跟三带二');

/* 跟牌必须走「原始牌数组」路径 —— Game.legalMoves 就是这么调的。
   这是曾经踩过的坑：genMoves 内部按已解析对象实现，导致跟牌分支全部失效。 */
{
  const hand = C([3, 4, 5, 6, 7, 14, 15, 16, 17]);
  const ms = DDZ.genMoves(hand, C([3]));
  ok(ms.length > 0, '传原始 counts 时能枚举出跟牌（' + ms.length + ' 手）');
  ok(ms.some(m => { const a = DDZ.analyze(m); return a.t === T.SINGLE && a.r === 14; }), '跟单张 3 时给出单张 A');
  ok(DDZ.isLegal(hand, C([14]), C([3])), 'isLegal 支持原始 counts 待压牌');
  ok(!DDZ.isLegal(hand, C([14]), C([15])), 'isLegal 正确拒绝压不过的牌');
  ok(DDZ.genMoves(C([6, 6, 3, 4, 5]), C([5, 5])).some(m => { const a = DDZ.analyze(m); return a.t === T.PAIR && a.r === 6; }), '跟对子能枚举出更大的对子');
  /* 王炸压无可压：即便手里有炸弹也不能出 */
  ok(DDZ.genMoves(C([4, 4, 4, 4, 5, 5]), C([16, 17])).length === 0, '王炸之后无牌可压');
  ok(DDZ.genMoves(C([4, 4, 4, 4]), DDZ.analyze(C([3, 4, 5, 6, 7]))).length === 1, '炸弹能压顺子');
}

/* 对局中农民必须真正参与：曾经因为上面的 bug，农民场均只出 0.46 手牌 */
{
  let totFarmer = 0, totLandlord = 0, cnt = 0;
  for (let i = 1; i <= 120; i++) {
    let s = i * 7919;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const gm = new DDZ.Game({ rand: rand });
    while (gm.phase === 'bid') { if (!gm.bid(gm.bidTurn, 3)) break; }
    let steps = 0;
    while (gm.phase === 'play' && steps++ < 500) {
      const seat = gm.turn;
      const ms = gm.legalMoves(seat);
      if (ms.length) gm.play(seat, ms[(rand() * ms.length) | 0]); else gm.pass(seat);
    }
    if (gm.phase !== 'over') continue;
    cnt++;
    totLandlord += gm.moveCount[gm.landlord];
    for (let k = 0; k < 3; k++) if (k !== gm.landlord) totFarmer += gm.moveCount[k];
  }
  const perFarmer = totFarmer / cnt / 2;
  ok(cnt > 100, '随机对局收束数 ' + cnt);
  ok(perFarmer > 2.5, '农民人均出牌 ' + perFarmer.toFixed(2) + ' 手（>2.5 说明跟牌逻辑真的生效）');
  ok(totLandlord / cnt > 2, '地主场均出牌 ' + (totLandlord / cnt).toFixed(2) + ' 手');
}
const follow = DDZ.genMoves(h1, C([14, 14]));
ok(follow.every(m => { const a = DDZ.analyze(m); return (a.t === T.PAIR && a.r > 14) || a.t === T.BOMB || a.t === T.ROCKET; }), '跟对子只给更大的对子或炸弹');

/* ---------- 4. 手牌拆分 ---------- */
const g = DDZ.decompose(C([3, 4, 5, 6, 7, 8, 9, 9]));
ok(g.length === 2, '顺子+对子拆成 2 组，实际 ' + g.length);
ok(DDZ.handCount(C([3, 4, 5, 6, 7])) === 1, '五张顺子算 1 手');
ok(DDZ.handCount(C([3, 3, 3, 3])) === 1, '炸弹算 1 手');

/* ---------- 5. 对局流程 ---------- */
function randomGame(seed) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gm = new DDZ.Game({ rand: rand });
  let steps = 0;
  while (gm.phase === 'bid' && steps++ < 20) {
    const seat = gm.bidTurn;
    gm.bid(seat, (rand() * 4) | 0);
    if (gm.phase === 'redeal') return { redeal: true };
  }
  if (gm.phase !== 'play') return { redeal: true };
  steps = 0;
  while (gm.phase === 'play' && steps++ < 500) {
    const seat = gm.turn;
    const ms = gm.legalMoves(seat);
    if (ms.length === 0) {
      if (!gm.pass(seat)) return { error: 'pass 失败 seat=' + seat };
    } else {
      const m = ms[(rand() * ms.length) | 0];
      if (!gm.play(seat, m)) return { error: 'play 失败 seat=' + seat };
    }
  }
  return { over: gm.phase === 'over', steps: steps, winner: gm.winner, landlord: gm.landlord, score: gm.score };
}

let finished = 0, redeals = 0, errs = 0, maxSteps = 0;
for (let i = 1; i <= 300; i++) {
  const r = randomGame(i);
  if (r.error) { errs++; if (errs < 3) console.log('  局内错误: ' + r.error); }
  else if (r.redeal) redeals++;
  else if (r.over) { finished++; maxSteps = Math.max(maxSteps, r.steps); }
  else { errs++; if (errs < 3) console.log('  未结束，步数 ' + r.steps); }
}
ok(errs === 0, '300 局随机对局无错误（错误 ' + errs + '）');
ok(finished + redeals === 300, '全部对局正常收束');
ok(maxSteps < 400, '最长对局步数 ' + maxSteps + ' < 400');

/* 出完牌后手牌必须为 0 */
{
  let s = 7;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gm = new DDZ.Game({ rand: rand });
  while (gm.phase === 'bid') { if (!gm.bid(gm.bidTurn, 3)) break; }
  let steps = 0;
  while (gm.phase === 'play' && steps++ < 500) {
    const seat = gm.turn;
    const ms = gm.legalMoves(seat);
    if (ms.length) gm.play(seat, ms[0]); else gm.pass(seat);
  }
  ok(gm.handSize(gm.winner) === 0, '胜者手牌清零');
  ok(gm.score > 0, '得分 > 0（' + gm.score + '）');
  ok(gm.hands[gm.landlord].length === 18, '地主手牌计数数组长度正常');
}

/* 地主拿到底牌 */
{
  let s = 11;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gm = new DDZ.Game({ rand: rand });
  let totalBefore = 0;
  for (let i = 0; i < 3; i++) totalBefore += gm.handSize(i);
  ok(totalBefore === 51, '发牌共 51 张');
  while (gm.phase === 'bid') { if (gm.bid(gm.bidTurn, 3)) break; }
  ok(gm.handSize(gm.landlord) === 20, '地主 20 张');
  ok(gm.phase === 'play', '进入出牌阶段');
  ok(gm.turn === gm.landlord, '地主先出');
}

console.log('\n结果：passed ' + pass + ' / failed ' + fail + (fail === 0 ? '  ALL PASS' : '  FAILED'));
process.exit(fail === 0 ? 0 : 1);
