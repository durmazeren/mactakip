'use strict';

/* Pure, explainable market signal rules. These are live-stat indicators,
 * not bookmaker probabilities or calibrated betting recommendations. */
(function attachAnalysisEngine(root, factory) {
  const oddsEngine = typeof module === 'object' && module.exports ? require('./odds-engine.js') : root.OddsEngine;
  const engine = factory(oddsEngine);
  root.AnalysisEngine = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
}(globalThis, (oddsEngine) => {
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

  function eventRegime(data) {
    const xg = validPair(data?.changes?.xg);
    const windowMinutes = Math.max(3, (data?.elapsedMs || 0) / 60_000);
    const cumulative = validPair(data?.cumulativeXg);
    const minute = Number.isFinite(data?.minute) ? Math.max(1, data.minute) : null;
    const recentRate = xg ? (xg[0] + xg[1]) / windowMinutes : null;
    const matchRate = cumulative && minute ? (cumulative[0] + cumulative[1]) / minute : null;
    const ratio = Number.isFinite(recentRate) && Number.isFinite(matchRate)
      ? recentRate / Math.max(0.035, matchRate) : null;
    const pressure = (Number(data?.totalSot) || 0) * 1.5
      + (Number(data?.totalShots) || 0) * 0.25
      + (Number(data?.totalBigChances) || 0) * 1.2;
    if (!Number.isFinite(ratio)) {
      return { key: 'insufficient', label: 'Yetersiz veri', ratio: null, volatility: 0.24, quality: 0.35 };
    }
    if (ratio >= 2 && (recentRate >= 0.12 || data?.totalBigChances >= 1)) {
      return { key: 'surge', label: 'Baskı artışı', ratio, volatility: 0.28, quality: 0.72 };
    }
    if (ratio <= 0.35 && matchRate >= 0.04 && pressure <= 3) {
      return { key: 'cooldown', label: 'Tempo düşüşü', ratio, volatility: 0.12, quality: 0.78 };
    }
    if (ratio >= 1.55 || ratio <= 0.55) {
      return { key: 'transition', label: 'Oyun rejimi değişiyor', ratio, volatility: 0.38, quality: 0.52 };
    }
    return { key: 'balanced', label: 'Dengeli tempo', ratio, volatility: 0.08, quality: 0.88 };
  }

  function dataQualityScore(data) {
    const freshness = Number.isFinite(data?.dataAgeMs)
      ? Math.max(0, 1 - data.dataAgeMs / 35_000) : 0.65;
    const window = Number.isFinite(data?.elapsedMs) ? Math.min(1, Math.max(0, data.elapsedMs / 300_000)) : 0;
    const stats = data?.changes || {};
    const requiredCoverage = ['shots', 'sot', 'corners'].filter((key) => validPair(stats[key])).length / 3;
    const hasXg = !!(validPair(stats.xg) && validPair(data?.cumulativeXg));
    const clock = data?.clock?.known === true;
    const scoreKnown = !!validPair(data?.score);
    const sampleCoverage = Number.isFinite(data?.sampleCount) ? Math.min(1, data.sampleCount / 12) : 0.75;
    const regime = eventRegime(data);
    const total = freshness * 25 + window * 20 + requiredCoverage * 15
      + (hasXg ? 15 : 0) + (clock ? 10 : 0) + (scoreKnown ? 5 : 0)
      + sampleCoverage * 5 + regime.quality * 5;
    return Math.round(Math.max(0, Math.min(100, total)));
  }

  function dynamicThreshold(data, base) {
    const qualityPenalty = (100 - dataQualityScore(data)) * 0.0014;
    const regimePenalty = eventRegime(data).volatility * 0.04;
    return Math.min(0.97, base + qualityPenalty + regimePenalty);
  }

  function bounded(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function nextGoalProbabilities(data, horizonMinutes = 8) {
    const rates = validPair(data?.weightedXgRate)
      || (validPair(data?.changes?.xg)
        ? data.changes.xg.map((value) => value / Math.max(3, (data.elapsedMs || 0) / 60_000))
        : null);
    if (!rates) return null;
    const shots = validPair(data?.changes?.shots) || [0, 0];
    const sot = validPair(data?.changes?.sot) || [0, 0];
    const bigChances = validPair(data?.changes?.bigChances) || [0, 0];
    const hazards = rates.map((rate, side) => Math.min(0.12, Math.max(0.002,
      rate + Math.max(0, shots[side]) * 0.002 + Math.max(0, sot[side]) * 0.01
        + Math.max(0, bigChances[side]) * 0.025)));
    const total = hazards[0] + hazards[1];
    const goalWithinWindow = 1 - Math.exp(-total * horizonMinutes);
    return {
      home: goalWithinWindow * hazards[0] / total,
      away: goalWithinWindow * hazards[1] / total,
      none: 1 - goalWithinWindow,
    };
  }

  function teamPressure(data, side) {
    const shots = data.changes.shots?.[side];
    const sot = data.changes.sot?.[side];
    const xg = data.changes.xg?.[side];
    const corners = data.changes.corners?.[side];
    const bigChances = data.changes.bigChances?.[side];
    if (![shots, sot, xg, corners, bigChances].some(Number.isFinite)) return null;
    const scale = fiveMinuteScale(data);
    return ((Number.isFinite(shots) ? shots * 0.4 : 0)
      + (Number.isFinite(sot) ? sot * 1.7 : 0)
      + (Number.isFinite(xg) ? xg * 5 : 0)
      + (Number.isFinite(corners) ? corners * 0.25 : 0)
      + (Number.isFinite(bigChances) ? Math.min(3, bigChances) : 0)) * scale;
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
    if (!current || !Number.isFinite(data.minute) || !Number.isFinite(endMinute)
      || data.minute < 10 || data.minute >= endMinute || data.elapsedMs < 180_000) return null;
    const recent = validPair(data.changes.xg);
    const weighted = validPair(data.weightedXgRate);
    const played = Math.max(10, data.minute);
    const windowMinutes = Math.max(3, data.elapsedMs / 60_000);
    const left = Math.max(0, endMinute - data.minute);
    const redCards = validPair(data.redCards);
    return current.map((xg, side) => {
      const matchRate = Math.max(0, xg / played);
      let remaining = matchRate * left;
      if (weighted || recent) {
        const recentRate = Math.max(0, weighted ? weighted[side] : recent[side] / windowMinutes);
        // Cap a short xG burst before blending it with the match-long pace.
        const cappedRecent = Math.min(recentRate, Math.max(0.04, matchRate * 2.5));
        const recentWeight = weighted ? 0.40 : 0.25;
        remaining = (matchRate * (1 - recentWeight) + cappedRecent * recentWeight) * left;
      }
      if (redCards) {
        const ownRedCards = Math.max(0, Math.min(2, redCards[side]));
        const opponentRedCards = Math.max(0, Math.min(2, redCards[1 - side]));
        remaining *= Math.max(0.70, 1 - ownRedCards * 0.10) * (1 + opponentRedCards * 0.08);
      }
      return remaining;
    });
  }

  function remainingXgScenarios(data, endMinute) {
    const base = remainingXg(data, endMinute);
    if (!base) return null;
    const current = validPair(data.cumulativeXg);
    const recent = validPair(data.changes.xg);
    const played = Math.max(10, data.minute);
    const windowMinutes = Math.max(3, data.elapsedMs / 60_000);
    const low = [];
    const high = [];

    for (let side = 0; side < 2; side++) {
      const matchRate = Math.max(0, current[side] / played);
      const recentRate = recent ? Math.max(0, recent[side] / windowMinutes) : null;
      // A wider fixed band represents weaker evidence; it is not a calibrated interval.
      const disagreement = recentRate == null ? 0.30
        : Math.abs(recentRate - matchRate) / Math.max(0.08, matchRate, recentRate);
      const spread = Math.min(0.62, 0.14 + disagreement * 0.12 + eventRegime(data).volatility * 0.10);
      low.push(Math.max(0, base[side] * (1 - spread)));
      high.push(base[side] * (1 + spread));
    }
    return { low, base, high };
  }

  function scenarioBand(scenarios) {
    if (!scenarios) return null;
    const baseTotal = scenarios.base[0] + scenarios.base[1];
    const width = (scenarios.high[0] + scenarios.high[1]
      - scenarios.low[0] - scenarios.low[1]) / 2;
    const ratio = width / Math.max(0.2, baseTotal);
    if (ratio <= 0.22) return { key: 'narrow', label: 'Dar' };
    if (ratio <= 0.42) return { key: 'medium', label: 'Orta' };
    return { key: 'wide', label: 'Geniş' };
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

  function pushRemainderResult(candidates, data, scenarios, requestedEndMinute) {
    const endMinute = Number.isFinite(requestedEndMinute) ? requestedEndMinute
      : Number.isFinite(data.clock?.matchEndMinute) ? data.clock.matchEndMinute
        : Number.isFinite(data.clock?.endMinute) ? data.clock.endMinute : 90;
    if (!Number.isFinite(data.minute) || data.minute < 18 || data.minute >= endMinute - 2) return;
    const combinations = [
      [scenarios.low[0], scenarios.low[1]],
      [scenarios.low[0], scenarios.high[1]],
      [scenarios.high[0], scenarios.low[1]],
      [scenarios.high[0], scenarios.high[1]],
    ].map(poissonOutcomes);
    if (combinations.some((outcomes) => !outcomes)) return;
    const winners = combinations.map((outcomes) =>
      Object.entries(outcomes).sort((a, b) => b[1] - a[1]));
    const [winner] = winners[0][0];
    if (!winners.every((sorted) => sorted[0][0] === winner)) return;
    const top = Math.min(...winners.map((sorted) => sorted[0][1]));
    const margin = Math.min(...winners.map((sorted) => sorted[0][1] - sorted[1][1]));
    const lambdaSum = scenarios.base[0] + scenarios.base[1];
    const baseThreshold = winner === 'draw' ? 0.60 : 0.52;
    if (top < dynamicThreshold(data, baseThreshold) || lambdaSum < (winner === 'draw' ? 0.15 : 0.3)
      || (winner !== 'draw' && margin < 0.10)) {
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
      modelProbability: top, minimumProbability: baseThreshold,
      marketIdentity: { market: 'remaining-result', period: 'remaining', line: null, selection: winner },
      reason: `Ev/deplasman xG tempo aralığının dört uç senaryosunda da yön değişmedi; mevcut skor hesaba katılmaz. Bu, kalibre edilmiş olasılık veya bahis oranı değildir.`,
    });
  }

  function lineKey(value) {
    return String(value).replace('.', '_');
  }

  function pushLineSignal(candidates, data, { half, line, forecast, forecastLow, forecastHigh, currentGoals }) {
    if (![forecast, forecastLow, forecastHigh, currentGoals].every(Number.isFinite) || currentGoals > line) return;
    const label = half ? 'İY' : 'Maç';
    const keyPrefix = half ? 'half' : 'match';
    const shots = total(data.changes.shots);
    const sot = total(data.changes.sot);
    const xg = total(data.changes.xg);
    const windowGoalSupport = (Number.isFinite(sot) && sot >= 1)
      || (Number.isFinite(xg) && xg >= 0.15);
    const lowLambda = Math.max(0, forecastLow - currentGoals);
    const highLambda = Math.max(0, forecastHigh - currentGoals);
    const overChance = overProbability(lowLambda, currentGoals, line);
    const underChance = underProbability(highLambda, currentGoals, line);
    const underStart = half ? 30 : 55;
    const quietWindow = (!Number.isFinite(sot) || sot === 0)
      && (!Number.isFinite(shots) || shots <= 3)
      && (!Number.isFinite(xg) || xg <= 0.08);

    const overThreshold = dynamicThreshold(data, OVER_DIRECTION_THRESHOLD);
    const underThreshold = dynamicThreshold(data, UNDER_DIRECTION_THRESHOLD);
    if (data.minute >= 12 && overChance >= overThreshold && windowGoalSupport) {
      const level = overChance >= 0.78 && data.elapsedMs >= 240_000 ? 'high' : 'medium';
      candidates.push({
        key: `${keyPrefix}-over-${lineKey(line)}`, icon: '↗',
        title: `${label} ${line} üst yönü`,
        market: `${label} toplam gol · üst ${line}`,
        level, levelLabel: level === 'high' ? 'xG yönü güçlü' : 'xG yönü', side: null,
        modelProbability: overChance, minimumProbability: OVER_DIRECTION_THRESHOLD,
        marketIdentity: { market: 'total-goals', period: half ? 'first-half' : 'match', line, selection: 'over' },
        reason: `Düşük tempo senaryosunda bile Poisson üst yön eşiği aşılıyor; temel tahmin ${forecast.toFixed(1)} gol, son pencerede ${Number.isFinite(sot) ? sot : '—'} isabetli şut ve ${Number.isFinite(xg) ? xg.toFixed(2) : '—'} xG artışı var.`,
      });
    } else if (data.minute >= underStart && underChance >= underThreshold && quietWindow) {
      candidates.push({
        key: `${keyPrefix}-under-${lineKey(line)}`, icon: '↘',
        title: `${label} ${line} alt yönü`,
        market: `${label} toplam gol · alt ${line}`,
        level: underChance >= 0.85 && data.elapsedMs >= 240_000 ? 'high' : 'medium',
        levelLabel: underChance >= 0.85 ? 'xG yönü güçlü' : 'xG yönü', side: null,
        modelProbability: underChance, minimumProbability: UNDER_DIRECTION_THRESHOLD,
        marketIdentity: { market: 'total-goals', period: half ? 'first-half' : 'match', line, selection: 'under' },
        reason: `Yüksek tempo senaryosunda bile Poisson alt yön eşiği korunuyor; temel tahmin ${forecast.toFixed(1)} gol ve son pencerede belirgin şut/xG artışı yok.`,
      });
    }
  }

  function pushBttsSignal(candidates, data, { half, score, scenarios, minuteFloor }) {
    if (!scenarios || !validPair(score)) return;
    const unscored = [0, 1].filter((side) => score[side] === 0);
    if (!unscored.length) return; // KG Evet zaten gerçekleşti.
    const label = half ? 'İY KG' : 'KG';
    const prefix = half ? 'half-btts' : 'btts';
    const recentXg = validPair(data.changes.xg);
    const currentXg = validPair(data.cumulativeXg);
    const recentSot = validPair(data.changes.sot);
    const yesChance = unscored.reduce((chance, side) => chance * (1 - Math.exp(-Math.min(12, scenarios.low[side]))), 1);
    const allHaveScoringPressure = unscored.every((side) =>
      scenarios.low[side] >= (half ? 0.18 : 0.32)
      && ((recentXg && recentXg[side] >= 0.08)
        || (currentXg && currentXg[side] >= 0.18)
        || (recentSot && recentSot[side] >= 1)));
    const yesThreshold = dynamicThreshold(data, BTTS_YES_DIRECTION_THRESHOLD);
    const noThreshold = dynamicThreshold(data, BTTS_NO_DIRECTION_THRESHOLD);
    if (yesChance >= yesThreshold && allHaveScoringPressure) {
      candidates.push({
        key: `${prefix}-yes`, icon: '⚽', title: `${label} Evet yönü`,
        market: half ? 'İlk yarı karşılıklı gol' : 'Karşılıklı gol',
        level: 'medium', levelLabel: 'xG yönü', side: null,
        modelProbability: yesChance, minimumProbability: BTTS_YES_DIRECTION_THRESHOLD,
        marketIdentity: { market: 'btts', period: half ? 'first-half' : 'match', line: null, selection: 'yes' },
        reason: `Düşük tempo senaryosunda henüz golü olmayan taraf(lar)ın xG uzatımı ${unscored.map((side) => `${data.names[side]} ${scenarios.low[side].toFixed(2)}`).join(' · ')}; şut/xG desteği mevcut.`,
      });
      return;
    }

    const highYesChance = unscored.reduce((chance, side) => chance * (1 - Math.exp(-Math.min(12, scenarios.high[side]))), 1);
    const noChanceSide = unscored.find((side) => scenarios.high[side] <= (half ? 0.06 : 0.10));
    const noChance = 1 - highYesChance;
    if (data.minute >= minuteFloor && noChance >= noThreshold && noChanceSide != null) {
      candidates.push({
        key: `${prefix}-no`, icon: '⏸', title: `${label} Hayır yönü`,
        market: half ? 'İlk yarı karşılıklı gol' : 'Karşılıklı gol',
        level: 'medium', levelLabel: 'xG yönü', side: noChanceSide,
        modelProbability: noChance, minimumProbability: BTTS_NO_DIRECTION_THRESHOLD,
        marketIdentity: { market: 'btts', period: half ? 'first-half' : 'match', line: null, selection: 'no' },
        reason: `${data.names[noChanceSide]} henüz gol bulmadı; yüksek tempo senaryosunda bile KG Evet yönü eşiğin altında ve kalan xG uzatımı ${scenarios.high[noChanceSide].toFixed(2)}.`,
      });
    }
  }

  function makeMarketCandidates(data, lines) {
    const candidates = [];
    const regularFirstHalf = data.phase === '1Y';
    const regularMatch = regularFirstHalf || data.phase === '2Y';
    const supportedLivePhase = ['1Y', '2Y', 'UZ1', 'UZ2'].includes(data.phase);
    const periodEnd = Number.isFinite(data.clock?.endMinute)
      ? data.clock.endMinute : ({ '1Y': 45, '2Y': 90, UZ1: 105, UZ2: 120 }[data.phase]);
    const matchEnd = Number.isFinite(data.clock?.matchEndMinute)
      ? data.clock.matchEndMinute : ({ '1Y': 90, '2Y': 90, UZ1: 120, UZ2: 120 }[data.phase]);
    if (!supportedLivePhase || !Number.isFinite(data.minute)) return candidates;

    if (data.minute >= 8 && data.minute < periodEnd) {
      const quality = dataQualityScore(data);
      const next = dominantSide(data, {
        minimum: 2.5 + Math.max(0, 75 - quality) * 0.025,
        margin: 1.35 + Math.max(0, 75 - quality) * 0.015,
      });
      if (next) {
        const name = data.names[next.side];
        const shots = data.changes.shots?.[next.side];
        const sot = data.changes.sot?.[next.side];
        const xg = data.changes.xg?.[next.side];
        const nextProbabilities = nextGoalProbabilities(data);
        candidates.push({
          key: `next-goal-${next.side === 0 ? 'home' : 'away'}`, icon: '⚽',
          title: `Sıradaki gol yönü: ${name}`,
          market: 'Sıradaki golü hangi takım atar?', level: next.lead >= 4 && data.elapsedMs >= 240_000 ? 'high' : 'medium',
          side: next.side,
          modelProbability: nextProbabilities?.[next.side === 0 ? 'home' : 'away'] ?? null,
          minimumProbability: 0.08,
          marketIdentity: { market: 'next-goal', period: 'next', line: null, selection: next.side === 0 ? 'home' : 'away' },
          reason: `${name} son pencerede ${Number.isFinite(shots) ? shots : 0} şut, ${Number.isFinite(sot) ? sot : 0} isabetli şut${Number.isFinite(xg) ? ` ve ${xg.toFixed(2)} xG` : ''} ile daha yüksek hücum baskısı kurdu.`,
        });
      }

    }

    if (data.minute < 12) return candidates;
    if (!regularMatch) {
      const extraTimeScenarios = remainingXgScenarios(data, periodEnd);
      if (extraTimeScenarios) pushRemainderResult(candidates, data, extraTimeScenarios, periodEnd);
      return candidates;
    }
    const matchScenarios = remainingXgScenarios(data, matchEnd);
    if (!matchScenarios) return candidates;
    if (data.minute >= 18) pushRemainderResult(candidates, data, matchScenarios, matchEnd);
    const score = validPair(data.score);
    if (!score) return candidates;
    const currentTotal = score[0] + score[1];
    const matchForecast = currentTotal + matchScenarios.base[0] + matchScenarios.base[1];
    const matchForecastLow = currentTotal + matchScenarios.low[0] + matchScenarios.low[1];
    const matchForecastHigh = currentTotal + matchScenarios.high[0] + matchScenarios.high[1];
    pushLineSignal(candidates, data, {
      half: false, line: lines.matchTotal, forecast: matchForecast,
      forecastLow: matchForecastLow, forecastHigh: matchForecastHigh, currentGoals: currentTotal,
    });
    pushBttsSignal(candidates, data, {
      half: false, score, scenarios: matchScenarios, minuteFloor: 68,
    });

    if (regularFirstHalf) {
      const halfScenarios = remainingXgScenarios(data, periodEnd);
      if (halfScenarios) {
        const halfForecast = currentTotal + halfScenarios.base[0] + halfScenarios.base[1];
        pushLineSignal(candidates, data, {
          half: true, line: lines.firstHalfTotal, forecast: halfForecast,
          forecastLow: currentTotal + halfScenarios.low[0] + halfScenarios.low[1],
          forecastHigh: currentTotal + halfScenarios.high[0] + halfScenarios.high[1],
          currentGoals: currentTotal,
        });
        pushBttsSignal(candidates, data, {
          half: true, score, scenarios: halfScenarios, minuteFloor: 37,
        });
      }
    }
    return candidates;
  }

  function makeAnalysisCandidates(data, lines = { matchTotal: 2.5, firstHalfTotal: 1.5 }) {
    if (data.status !== 'ready') return [];
    const {
      changes, minute, names, totalShots, totalSot, totalCorners, totalXg, totalBigChances,
    } = data;
    const candidates = [];
    const xgAvailable = !!changes.xg;
    const bigChanceActivity = Number.isFinite(totalBigChances) && totalBigChances > 0;
    const enoughGoalActivity = minute >= 8 && minute <= 86 && (
      (changes.shots && changes.sot && ((xgAvailable && totalShots >= 3 && totalSot >= 1 && totalXg >= 0.25)
        || (totalShots >= 5 && totalSot >= 2))) || bigChanceActivity
    );

    if (enoughGoalActivity) {
      const high = data.elapsedMs >= 4 * 60_000 && (
        (Number.isFinite(totalShots) && totalShots >= 7 && totalSot >= 3)
        || (xgAvailable && totalShots >= 4 && totalXg >= 0.6)
        || totalBigChances >= 2
      );
      candidates.push({
        key: 'total-goals', icon: '⚽', title: 'Toplam gol aktivitesi',
        market: 'Toplam gol piyasası · izleme sinyali', level: high ? 'high' : 'medium',
        side: null,
        reason: `${Number.isFinite(totalShots) ? `Bu pencerede ${totalShots} şut ve ${Number.isFinite(totalSot) ? totalSot : 0} isabetli şut` : 'Bu pencerede büyük şans oluştu'}${xgAvailable ? `; xG artışı ${totalXg.toFixed(2)}` : ''}${bigChanceActivity ? `; ${totalBigChances} büyük şans` : ''}.`,
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
      const bigChances = changes.bigChances?.[side];
      const teamGoalActivity = (Number.isFinite(shots) && Number.isFinite(sot) && (
        (shots >= 3 && sot >= 1) || (Number.isFinite(xg) && shots >= 2 && xg >= 0.2)
      )) || (Number.isFinite(bigChances) && bigChances >= 1);
      if (teamGoalActivity && minute >= 8 && minute <= 86) {
        const high = data.elapsedMs >= 4 * 60_000 && (
          (Number.isFinite(shots) && shots >= 5 && sot >= 2)
          || (Number.isFinite(xg) && xg >= 0.45) || bigChances >= 2
        );
        candidates.push({
          key: side === 0 ? 'team-goal-home' : 'team-goal-away', icon: '🥅',
          title: `${names[side]} hücum aktivitesi`,
          market: 'Takım golü · izleme sinyali', level: high ? 'high' : 'medium', side,
          reason: `${names[side]} bu pencerede ${Number.isFinite(shots) ? `${shots} şut ve ${Number.isFinite(sot) ? sot : 0} isabetli şut` : 'büyük şans'}${Number.isFinite(xg) ? `; xG artışı ${xg.toFixed(2)}` : ''}${Number.isFinite(bigChances) && bigChances > 0 ? `; ${bigChances} büyük şans` : ''}.`,
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
    const quality = dataQualityScore(data);
    const regime = eventRegime(data);
    const oddsConfirmed = [];
    for (const candidate of candidates) {
      candidate.group = /^(next-goal-|rest-result-|btts-|half-btts-|match-|half-)/.test(candidate.key)
        ? 'market' : 'activity';
      if (candidate.group === 'market' && quality < 42) continue;
      const threshold = Number.isFinite(candidate.minimumProbability)
        ? dynamicThreshold(data, candidate.minimumProbability) : null;
      if (Number.isFinite(candidate.modelProbability) && Number.isFinite(threshold)
        && candidate.modelProbability < threshold) continue;
      candidate.dataQualityScore = quality;
      candidate.dynamicThreshold = threshold;
      const probabilityMargin = Number.isFinite(candidate.modelProbability) && Number.isFinite(threshold)
        ? bounded((candidate.modelProbability - threshold) / Math.max(0.03, 1 - threshold))
        : (candidate.level === 'high' ? 0.82 : 0.58);
      candidate.confidenceScore = Math.round(quality * (0.65 + 0.20 * probabilityMargin + 0.15 * regime.quality));
      candidate.regime = regime.key;
      candidate.valueEligible = false;
      if (candidate.group === 'market' && candidate.marketIdentity && Number.isFinite(candidate.modelProbability)) {
        const assessment = oddsEngine?.marketAssessment(
          data.liveOdds, candidate.key, candidate.modelProbability,
          data.analysisNowMs, data.eventIdentity,
        );
        if (assessment?.verified) {
          candidate.oddsEvidence = assessment;
          candidate.valueEligible = quality >= 68 && assessment.edge >= Math.max(0.03, (100 - quality) * 0.0005)
            && assessment.expectedValue >= 0.02;
        }
      }
      const edgeRank = Number.isFinite(candidate.oddsEvidence?.edge)
        ? Math.max(-0.25, Math.min(0.25, candidate.oddsEvidence.edge)) * 80 : 0;
      candidate.rankingScore = candidate.confidenceScore
        + (candidate.valueEligible ? 60 : 0) + edgeRank;
      oddsConfirmed.push(candidate);
    }
    return oddsConfirmed.sort((a, b) => b.rankingScore - a.rankingScore);
  }

  return {
    ANALYSIS_TYPES, makeAnalysisCandidates, remainingXg, remainingXgScenarios,
    scenarioBand, poissonOutcomes, eventRegime, dataQualityScore, dynamicThreshold,
    nextGoalProbabilities,
  };
}));
