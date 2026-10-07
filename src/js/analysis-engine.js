'use strict';

/* Pure, explainable market signal rules. These are live-stat indicators,
 * not bookmaker probabilities or calibrated betting recommendations. */
(function attachAnalysisEngine(root, factory) {
  const engine = factory();
  root.AnalysisEngine = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
}(globalThis, () => {
  const FIRST_HALF_END_MINUTE = 49; // regulation half plus a fixed 4-minute stoppage allowance
  const REGULATION_END_MINUTE = 94; // regulation match plus a fixed 4-minute stoppage allowance
  const OVER_DIRECTION_THRESHOLD = 0.62;
  const UNDER_DIRECTION_THRESHOLD = 0.70;
  const BTTS_YES_DIRECTION_THRESHOLD = 0.60;
  const BTTS_NO_DIRECTION_THRESHOLD = 0.70;
  const ANALYSIS_TYPES = [
    'total-goals', 'total-corners', 'team-goal-home', 'team-goal-away',
    'team-shots-home', 'team-shots-away', 'next-goal-home', 'next-goal-away',
    'rest-result-home', 'rest-result-away', 'rest-result-draw',
    'btts-yes', 'btts-no', 'half-btts-yes', 'half-btts-no',
    ...['0_5', '1_5', '2_5', '3_5', '4_5'].flatMap((line) => [`match-over-${line}`, `match-under-${line}`]),
    ...['0_5', '1_5', '2_5'].flatMap((line) => [`half-over-${line}`, `half-under-${line}`]),
  ];

  function validPair(pair) {
    return Array.isArray(pair) && pair.length >= 2 && pair.every(Number.isFinite)
      ? [pair[0], pair[1]] : null;
  }

  function total(pair) {
    return pair ? pair[0] + pair[1] : null;
  }

  function fiveMinuteScale(data) {
    if (!Number.isFinite(data.elapsedMs)) return 1;
    const windowMinutes = Math.min(5, Math.max(3, data.elapsedMs / 60_000));
    return 5 / windowMinutes;
  }

  function teamPressure(data, side) {
    const shots = data.changes.shots?.[side];
    const sot = data.changes.sot?.[side];
    const xg = data.changes.xg?.[side];
    const corners = data.changes.corners?.[side];
    if (![shots, sot, xg, corners].some(Number.isFinite)) return null;
    const scale = fiveMinuteScale(data);
    return ((Number.isFinite(shots) ? shots * 0.4 : 0)
      + (Number.isFinite(sot) ? sot * 1.7 : 0)
      + (Number.isFinite(xg) ? xg * 5 : 0)
      + (Number.isFinite(corners) ? corners * 0.25 : 0)) * scale;
  }

  function dominantSide(data, { minimum = 2.5, margin = 1.35 } = {}) {
    const home = teamPressure(data, 0);
    const away = teamPressure(data, 1);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    const side = home >= away ? 0 : 1;
    const lead = Math.abs(home - away);
    if (Math.max(home, away) < minimum || lead < margin) return null;
    return { side, home, away, lead };
  }

  function remainingXg(data, endMinute) {
    const current = validPair(data.cumulativeXg);
    if (!current || data.minute < 10 || data.minute >= endMinute || data.elapsedMs < 180_000) return null;
    const recent = validPair(data.changes.xg);
    const played = Math.max(10, data.minute);
    const windowMinutes = Math.max(3, data.elapsedMs / 60_000);
    const left = Math.max(0, endMinute - data.minute);
    return current.map((xg, side) => {
      const matchRate = Math.max(0, xg / played);
      if (!recent) return matchRate * left;
      const recentRate = Math.max(0, recent[side] / windowMinutes);
      // Cap a short xG burst before blending it with the match-long pace.
      const cappedRecent = Math.min(recentRate, Math.max(0.04, matchRate * 2.5));
      return (matchRate * 0.75 + cappedRecent * 0.25) * left;
    });
  }

  function poissonOutcomes(lambda) {
    if (!validPair(lambda)) return null;
    const distribution = lambda.map(poissonDistribution);
    const result = { home: 0, draw: 0, away: 0 };
    for (let homeGoals = 0; homeGoals < distribution[0].length; homeGoals++) {
      for (let awayGoals = 0; awayGoals < distribution[1].length; awayGoals++) {
        const probability = distribution[0][homeGoals] * distribution[1][awayGoals];
        if (homeGoals > awayGoals) result.home += probability;
        else if (homeGoals < awayGoals) result.away += probability;
        else result.draw += probability;
      }
    }
    return result;
  }

  function poissonDistribution(value) {
    const rate = Math.min(12, Math.max(0, value));
    const values = [Math.exp(-rate)];
    for (let goals = 1; goals <= 24; goals++) values.push(values[goals - 1] * rate / goals);
    const mass = values.reduce((sum, probability) => sum + probability, 0);
    return values.map((probability) => probability / mass);
  }

  function poissonCdf(maxGoals, lambda) {
    if (maxGoals < 0) return 0;
    const distribution = poissonDistribution(lambda);
    let cumulative = 0;
    for (let goals = 0; goals <= Math.min(maxGoals, distribution.length - 1); goals++) {
      cumulative += distribution[goals];
    }
    return cumulative;
  }

  function overProbability(lambda, currentGoals, line) {
    const required = Math.floor(line) + 1 - currentGoals;
    return required <= 0 ? 1 : 1 - poissonCdf(required - 1, lambda);
  }

  function underProbability(lambda, currentGoals, line) {
    return poissonCdf(Math.floor(line) - currentGoals, lambda);
  }

  function pushRemainderResult(candidates, data, lambda) {
    if (data.minute < 18 || data.minute > 80) return;
    const outcomes = poissonOutcomes(lambda);
    if (!outcomes) return;
    const sorted = Object.entries(outcomes).sort((a, b) => b[1] - a[1]);
    const [winner, top] = sorted[0];
    const runnerUp = sorted[1][1];
    const lambdaSum = lambda[0] + lambda[1];
    if (winner === 'draw') {
      if (top < 0.60 || lambdaSum < 0.15) return;
    } else if (top < 0.52 || top - runnerUp < 0.10 || lambdaSum < 0.3) {
      return;
    }

    const winnerName = winner === 'draw' ? 'Beraberlik' : data.names[winner === 'home' ? 0 : 1];
    candidates.push({
      key: `rest-result-${winner}`, icon: '⏱',
      title: `Kalan oyunda model yönü: ${winnerName}`,
      market: 'Maçın geri kalanını kim kazanır?',
      level: top >= 0.68 && data.elapsedMs >= 240_000 ? 'high' : 'medium',
      levelLabel: top >= 0.68 ? 'Model yönü güçlü' : 'Model yönü',
      side: winner === 'draw' ? null : winner === 'home' ? 0 : 1,
      reason: `Son xG temposuyla kalan golleri bağımsız Poisson dağılımında karşılaştırır; mevcut skor hesaba katılmaz. Model yönü olasılık veya bahis oranı değildir.`,
    });
  }

  function lineKey(value) {
    return String(value).replace('.', '_');
  }

  function pushLineSignal(candidates, data, { half, line, forecast, currentGoals }) {
    if (!Number.isFinite(forecast) || !Number.isFinite(currentGoals) || currentGoals > line) return;
    const label = half ? 'İY' : 'Maç';
    const keyPrefix = half ? 'half' : 'match';
    const shots = total(data.changes.shots);
    const sot = total(data.changes.sot);
    const xg = total(data.changes.xg);
    const windowGoalSupport = (Number.isFinite(sot) && sot >= 1)
      || (Number.isFinite(xg) && xg >= 0.15);
    const lambda = Math.max(0, forecast - currentGoals);
    const overChance = overProbability(lambda, currentGoals, line);
    const underChance = underProbability(lambda, currentGoals, line);
    const underStart = half ? 30 : 55;
    const quietWindow = (!Number.isFinite(sot) || sot === 0)
      && (!Number.isFinite(shots) || shots <= 3)
      && (!Number.isFinite(xg) || xg <= 0.08);

    if (data.minute >= 12 && overChance >= OVER_DIRECTION_THRESHOLD && windowGoalSupport) {
      const level = overChance >= 0.78 && data.elapsedMs >= 240_000 ? 'high' : 'medium';
      candidates.push({
        key: `${keyPrefix}-over-${lineKey(line)}`, icon: '↗',
        title: `${label} ${line} üst yönü`,
        market: `${label} toplam gol · üst ${line}`,
        level, levelLabel: level === 'high' ? 'xG yönü güçlü' : 'xG yönü', side: null,
        reason: `xG-temelli Poisson dağılımında seçilen çizginin üstü eşik aşımında; beklenen toplam ${forecast.toFixed(1)} gol, son pencerede ${Number.isFinite(sot) ? sot : '—'} isabetli şut ve ${Number.isFinite(xg) ? xg.toFixed(2) : '—'} xG artışı var.`,
      });
    } else if (data.minute >= underStart && underChance >= UNDER_DIRECTION_THRESHOLD && quietWindow) {
      candidates.push({
        key: `${keyPrefix}-under-${lineKey(line)}`, icon: '↘',
        title: `${label} ${line} alt yönü`,
        market: `${label} toplam gol · alt ${line}`,
        level: underChance >= 0.85 && data.elapsedMs >= 240_000 ? 'high' : 'medium',
        levelLabel: underChance >= 0.85 ? 'xG yönü güçlü' : 'xG yönü', side: null,
        reason: `xG-temelli Poisson dağılımında seçilen çizginin altı eşik aşımında; beklenen toplam ${forecast.toFixed(1)} gol ve son pencerede belirgin şut/xG artışı yok.`,
      });
    }
  }

  function pushBttsSignal(candidates, data, { half, score, lambda, minuteFloor }) {
    if (!lambda || !validPair(score)) return;
    const unscored = [0, 1].filter((side) => score[side] === 0);
    if (!unscored.length) return; // KG Evet zaten gerçekleşti.
    const label = half ? 'İY KG' : 'KG';
    const prefix = half ? 'half-btts' : 'btts';
    const recentXg = validPair(data.changes.xg);
    const currentXg = validPair(data.cumulativeXg);
    const recentSot = validPair(data.changes.sot);
    const yesChance = unscored.reduce((chance, side) => chance * (1 - Math.exp(-Math.min(12, lambda[side]))), 1);
    const allHaveScoringPressure = unscored.every((side) =>
      lambda[side] >= (half ? 0.18 : 0.32)
      && ((recentXg && recentXg[side] >= 0.08)
        || (currentXg && currentXg[side] >= 0.18)
        || (recentSot && recentSot[side] >= 1)));
    if (yesChance >= BTTS_YES_DIRECTION_THRESHOLD && allHaveScoringPressure) {
      candidates.push({
        key: `${prefix}-yes`, icon: '⚽', title: `${label} Evet yönü`,
        market: half ? 'İlk yarı karşılıklı gol' : 'Karşılıklı gol',
        level: 'medium', levelLabel: 'xG yönü', side: null,
        reason: `Henüz golü olmayan taraf(lar) için kalan xG tempo uzatımı ${unscored.map((side) => `${data.names[side]} ${lambda[side].toFixed(2)}`).join(' · ')}; şut/xG desteği mevcut.`,
      });
      return;
    }

    const noChanceSide = unscored.find((side) => lambda[side] <= (half ? 0.06 : 0.10));
    if (data.minute >= minuteFloor && yesChance <= 1 - BTTS_NO_DIRECTION_THRESHOLD && noChanceSide != null) {
      candidates.push({
        key: `${prefix}-no`, icon: '⏸', title: `${label} Hayır yönü`,
        market: half ? 'İlk yarı karşılıklı gol' : 'Karşılıklı gol',
        level: 'medium', levelLabel: 'xG yönü', side: noChanceSide,
        reason: `${data.names[noChanceSide]} henüz gol bulmadı; Poisson xG temposunda KG Evet yönü eşik altında ve kalan süre uzatımı ${lambda[noChanceSide].toFixed(2)}.`,
      });
    }
  }

  function makeMarketCandidates(data, lines) {
    const candidates = [];
    const regularFirstHalf = data.phase === '1Y';
    const regularMatch = regularFirstHalf || data.phase === '2Y';

    if (data.minute >= 8 && data.minute <= 86) {
      const next = dominantSide(data, { minimum: 2.5, margin: 1.35 });
      if (next) {
        const name = data.names[next.side];
        const shots = data.changes.shots?.[next.side];
        const sot = data.changes.sot?.[next.side];
        const xg = data.changes.xg?.[next.side];
        candidates.push({
          key: `next-goal-${next.side === 0 ? 'home' : 'away'}`, icon: '⚽',
          title: `Sıradaki gol yönü: ${name}`,
          market: 'Sıradaki golü hangi takım atar?', level: next.lead >= 4 && data.elapsedMs >= 240_000 ? 'high' : 'medium',
          side: next.side,
          reason: `${name} son pencerede ${Number.isFinite(shots) ? shots : 0} şut, ${Number.isFinite(sot) ? sot : 0} isabetli şut${Number.isFinite(xg) ? ` ve ${xg.toFixed(2)} xG` : ''} ile daha yüksek hücum baskısı kurdu.`,
        });
      }

    }

    if (!regularMatch || data.minute < 12) return candidates;
    const matchLambda = remainingXg(data, REGULATION_END_MINUTE);
    if (!matchLambda) return candidates;
    if (data.minute >= 18 && data.minute <= 80) pushRemainderResult(candidates, data, matchLambda);
    const score = validPair(data.score);
    if (!score) return candidates;
    const currentTotal = score[0] + score[1];
    const matchForecast = currentTotal + matchLambda[0] + matchLambda[1];
    pushLineSignal(candidates, data, {
      half: false, line: lines.matchTotal, forecast: matchForecast, currentGoals: currentTotal,
    });
    pushBttsSignal(candidates, data, {
      half: false, score, lambda: matchLambda, minuteFloor: 68,
    });

    if (regularFirstHalf) {
      const halfLambda = remainingXg(data, FIRST_HALF_END_MINUTE);
      if (halfLambda) {
        pushLineSignal(candidates, data, {
          half: true, line: lines.firstHalfTotal, forecast: currentTotal + halfLambda[0] + halfLambda[1],
          currentGoals: currentTotal,
        });
        pushBttsSignal(candidates, data, {
          half: true, score, lambda: halfLambda, minuteFloor: 37,
        });
      }
    }
    return candidates;
  }

  function makeAnalysisCandidates(data, lines = { matchTotal: 2.5, firstHalfTotal: 1.5 }) {
    if (data.status !== 'ready') return [];
    const { changes, minute, names, totalShots, totalSot, totalCorners, totalXg } = data;
    const candidates = [];
    const xgAvailable = !!changes.xg;
    const enoughGoalActivity = changes.shots && changes.sot && minute >= 8 && minute <= 86 && (
      (xgAvailable && totalShots >= 3 && totalSot >= 1 && totalXg >= 0.25)
      || (totalShots >= 5 && totalSot >= 2)
    );

    if (enoughGoalActivity) {
      const high = data.elapsedMs >= 4 * 60_000 && (
        (totalShots >= 7 && totalSot >= 3) || (xgAvailable && totalShots >= 4 && totalXg >= 0.6)
      );
      candidates.push({
        key: 'total-goals', icon: '⚽', title: 'Toplam gol aktivitesi',
        market: 'Toplam gol piyasası · izleme sinyali', level: high ? 'high' : 'medium',
        side: null,
        reason: `Bu pencerede ${totalShots} şut ve ${totalSot} isabetli şut${xgAvailable ? `; xG artışı ${totalXg.toFixed(2)}` : ''}.`,
      });
    }

    if (changes.corners && totalCorners >= 2 && changes.shots && changes.sot) {
      const shotSupport = totalShots >= 2 && totalSot >= 1;
      if (totalCorners >= 3 || shotSupport) {
        const high = data.elapsedMs >= 4 * 60_000 && totalCorners >= 4 && shotSupport;
        candidates.push({
          key: 'total-corners', icon: '🚩', title: 'Toplam korner aktivitesi',
          market: 'Toplam korner · tempo sinyali', level: high ? 'high' : 'medium',
          side: null,
          reason: `Bu pencerede ${totalCorners} korner; ${totalShots} şut ve ${totalSot} isabetli şut kaydedildi.`,
        });
      }
    }

    for (const side of [0, 1]) {
      const shots = changes.shots?.[side];
      const sot = changes.sot?.[side];
      const xg = changes.xg?.[side];
      const teamGoalActivity = Number.isFinite(shots) && Number.isFinite(sot) && (
        (shots >= 3 && sot >= 1) || (Number.isFinite(xg) && shots >= 2 && xg >= 0.2)
      );
      if (teamGoalActivity && minute >= 8 && minute <= 86) {
        const high = data.elapsedMs >= 4 * 60_000 && (
          (shots >= 5 && sot >= 2) || (Number.isFinite(xg) && xg >= 0.45)
        );
        candidates.push({
          key: side === 0 ? 'team-goal-home' : 'team-goal-away', icon: '🥅',
          title: `${names[side]} hücum aktivitesi`,
          market: 'Takım golü · izleme sinyali', level: high ? 'high' : 'medium', side,
          reason: `${names[side]} bu pencerede ${shots} şut ve ${sot} isabetli şut${Number.isFinite(xg) ? `; xG artışı ${xg.toFixed(2)}` : ''}.`,
        });
      }

      if (Number.isFinite(shots) && Number.isFinite(sot) && shots >= 3 && sot >= 1) {
        const high = data.elapsedMs >= 4 * 60_000 && shots >= 5 && sot >= 2;
        candidates.push({
          key: side === 0 ? 'team-shots-home' : 'team-shots-away', icon: '🎯',
          title: `${names[side]} şut temposu`,
          market: 'Takım şutu / isabetli şut · izleme', level: high ? 'high' : 'medium', side,
          reason: `${names[side]} son ölçüm penceresinde ${shots} şutun ${sot} tanesini kaleye gönderdi.`,
        });
      }
    }

    const safeLines = {
      matchTotal: [0.5, 1.5, 2.5, 3.5, 4.5].includes(Number(lines.matchTotal)) ? Number(lines.matchTotal) : 2.5,
      firstHalfTotal: [0.5, 1.5, 2.5].includes(Number(lines.firstHalfTotal)) ? Number(lines.firstHalfTotal) : 1.5,
    };
    candidates.push(...makeMarketCandidates(data, safeLines));
    return candidates;
  }

  return { ANALYSIS_TYPES, makeAnalysisCandidates, remainingXg, poissonOutcomes };
}));
