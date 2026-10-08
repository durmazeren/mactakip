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
  const MARKET_DATA_QUALITY_GATE = 65;
  const SIGNAL_TTL_MS = 15_000;
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
    const windowMinutes = Math.max(0.1, (data?.elapsedMs || 0) / 60_000);
    const minute = Math.max(1, Number(data?.minute) || 1);
    const features = [
      { key: 'xg', weight: 0.38, scale: 1 },
      { key: 'sot', weight: 0.24, scale: 0.28 },
      { key: 'shots', weight: 0.17, scale: 0.12 },
      { key: 'bigChances', weight: 0.14, scale: 0.48 },
      { key: 'corners', weight: 0.07, scale: 0.07 },
    ];
    const ratios = [];
    let activeWeight = 0;
    for (const feature of features) {
      const recent = validPair(data?.changes?.[feature.key]);
      const cumulative = validPair(data?.cumulativeStats?.[feature.key]
        || (feature.key === 'xg' ? data?.cumulativeXg : null));
      if (!recent || !cumulative) continue;
      const recentRate = recent.reduce((sum, value) => sum + Math.max(0, value), 0) / windowMinutes;
      const baselineRate = cumulative.reduce((sum, value) => sum + Math.max(0, value), 0) / minute;
      const normalized = recentRate / Math.max(feature.scale / 18, baselineRate);
      ratios.push({ ratio: bounded(normalized, 0, 5), weight: feature.weight });
      activeWeight += feature.weight;
    }
    let ratio = null;
    if (activeWeight >= 0.18) {
      // A weighted trimmed mean lets shots/SOT corroborate xG without one counter dominating.
      const ordered = ratios.sort((a, b) => a.ratio - b.ratio);
      let consumed = 0;
      let weighted = 0;
      const cap = activeWeight * 0.82;
      for (const entry of ordered) {
        const take = Math.min(entry.weight, Math.max(0, cap - consumed));
        weighted += entry.ratio * take;
        consumed += take;
        if (consumed >= cap) break;
      }
      ratio = consumed ? weighted / consumed : null;
    }

    const recentEvents = Array.isArray(data?.regimeEvents) ? data.regimeEvents : [];
    const event = recentEvents.find((item) => [
      'goal', 'red-card', 'var', 'penalty', 'suspension', 'period-change',
    ].includes(typeof item === 'string' ? item : item?.type));
    const eventType = typeof event === 'string' ? event : event?.type;
    if (eventType) {
      const labels = {
        goal: 'Gol sonrası rejim değişimi', 'red-card': 'Kırmızı kart rejim değişimi',
        var: 'VAR kontrolü', penalty: 'Penaltı olayı', suspension: 'Oyun durdu',
        'period-change': 'Devre rejimi değişimi',
      };
      return {
        key: eventType === 'suspension' || eventType === 'var' || eventType === 'penalty' ? 'frozen' : 'transition',
        label: labels[eventType], event: eventType, ratio, volatility: 0.52, quality: 0.42,
        freeze: ['suspension', 'var', 'penalty'].includes(eventType),
      };
    }
    if (!Number.isFinite(ratio)) {
      return { key: 'insufficient', label: 'Yetersiz veri', ratio: null, volatility: 0.24, quality: 0.35 };
    }
    const redCards = validPair(data?.redCards);
    const redCardAdded = validPair(data?.redCardDelta)?.some((value) => value > 0);
    const scoreChanged = data?.scoreChanged === true;
    if (redCardAdded || scoreChanged) {
      return {
        key: 'transition', label: redCardAdded ? 'Kırmızı kart rejim değişimi' : 'Gol sonrası rejim değişimi',
        event: redCardAdded ? 'red-card' : 'goal', ratio, volatility: 0.48, quality: 0.46,
      };
    }
    const redCardContext = redCards?.some((count) => count > 0) ? 0.08 : 0;
    if (ratio >= 1.75) return { key: 'surge', label: 'Çoklu gösterge baskı artışı', ratio, volatility: 0.34 + redCardContext, quality: 0.67 };
    if (ratio <= 0.42) return { key: 'cooldown', label: 'Çoklu gösterge tempo düşüşü', ratio, volatility: 0.13, quality: 0.78 };
    if (ratio >= 1.4 || ratio <= 0.62) return { key: 'transition', label: 'Oyun rejimi değişiyor', ratio, volatility: 0.36, quality: 0.55 };
    return { key: 'balanced', label: 'Dengeli tempo', ratio, volatility: 0.09 + redCardContext, quality: 0.86 };
  }

  function dataQualityScore(data) {
    const freshness = freshnessScore(data?.statisticsAgeMs ?? data?.dataAgeMs, 20_000);
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
    const eventFresh = freshnessScore(data?.eventAgeMs ?? data?.dataAgeMs, 20_000);
    const integrity = data?.statsIntegrity === false ? 0 : 1;
    const unchangedPenalty = Math.max(0.70, 1 - Math.max(0, Number(data?.statisticsUnchangedCount) || 0) * 0.025);
    const freshnessAdjusted = total * (0.85 + 0.15 * eventFresh) * integrity * unchangedPenalty;
    return Math.round(Math.max(0, Math.min(100, freshnessAdjusted)));
  }

  function freshnessScore(ageMs, staleAfterMs = 20_000) {
    if (!Number.isFinite(ageMs) || ageMs < 0) return ageMs == null ? 0.65 : 0;
    return bounded(1 - ageMs / staleAfterMs, 0, 1);
  }

  function marketDataQuality(data, marketIdentity = {}) {
    const market = typeof marketIdentity === 'string' ? marketIdentity : marketIdentity?.market;
    const age = freshnessScore(data?.statisticsAgeMs ?? data?.dataAgeMs, 20_000);
    const eventAge = freshnessScore(data?.eventAgeMs ?? data?.dataAgeMs, 12_000);
    const sourceAge = Number(data?.statisticsAgeMs ?? data?.dataAgeMs);
    const eventSourceAge = Number(data?.eventAgeMs ?? data?.dataAgeMs);
    const hasClock = data?.clock?.known === true;
    const hasScore = !!validPair(data?.score);
    const stats = data?.changes || {};
    const hasXg = !!(validPair(stats.xg) && validPair(data?.cumulativeXg));
    const hasShots = !!validPair(stats.shots);
    const hasSot = !!validPair(stats.sot);
    const hasBigChances = !!validPair(stats.bigChances);
    const sample = Number.isFinite(data?.sampleCount) ? bounded(data.sampleCount / 8, 0, 1) : 0.25;
    const window = Number.isFinite(data?.elapsedMs) ? bounded(data.elapsedMs / 300_000, 0, 1) : 0;
    const integrity = data?.statsIntegrity === false ? 0 : 1;
    const unchangedPenalty = Math.max(0.72, 1 - Math.max(0, Number(data?.statisticsUnchangedCount) || 0) * 0.025);
    const regimes = eventRegime(data);
    const xgScore = hasXg ? 1 : 0;
    const scoreScore = hasScore ? 1 : 0;
    const clockScore = hasClock ? 1 : 0;
    let score;
    if (market === 'next-goal') {
      score = 22 * age + 14 * eventAge + 16 * xgScore + 14 * (hasShots ? 1 : 0)
        + 12 * (hasSot ? 1 : 0) + 7 * (hasBigChances ? 1 : 0)
        + 6 * clockScore + 5 * sample + 4 * window;
    } else if (market === 'remaining-result') {
      score = 18 * age + 12 * eventAge + 17 * xgScore + 18 * scoreScore
        + 12 * clockScore + 8 * sample + 8 * window + 7 * regimes.quality;
    } else if (market === 'btts') {
      score = 21 * age + 16 * eventAge + 21 * xgScore + 19 * scoreScore
        + 9 * clockScore + 8 * sample + 6 * window;
    } else {
      // Goal totals rely most on both-side xG, score, and a trustworthy remaining-time horizon.
      score = 23 * age + 13 * eventAge + 24 * xgScore + 17 * scoreScore
        + 12 * clockScore + 6 * sample + 5 * window;
    }
    if (integrity === 0 || (Number.isFinite(sourceAge) && sourceAge > 20_000)
      || (Number.isFinite(eventSourceAge) && eventSourceAge > 15_000)) return 0;
    return Math.round(bounded(score * integrity * unchangedPenalty, 0, 100));
  }

  function dynamicThreshold(data, base) {
    const qualityPenalty = (100 - dataQualityScore(data)) * 0.0014;
    const regimePenalty = eventRegime(data).volatility * 0.04;
    return Math.min(0.97, base + qualityPenalty + regimePenalty);
  }

  function dynamicMarketThreshold(data, marketIdentity, base) {
    const qualityPenalty = (100 - marketDataQuality(data, marketIdentity)) * 0.0014;
    const regimePenalty = eventRegime(data).volatility * 0.04;
    return Math.min(0.98, base + qualityPenalty + regimePenalty);
  }

  function bounded(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function blendedXgRate(data) {
    const cumulative = validPair(data?.cumulativeXg);
    const minute = Number(data?.minute);
    const baseline = cumulative && Number.isFinite(minute) && minute > 0
      ? cumulative.map((value) => Math.max(0, value / minute)) : null;
    const windows = Array.isArray(data?.xgWindows) ? data.xgWindows : [];
    const weights = { 3: 0.15, 5: 0.25, 10: 0.25, 15: 0.20 };
    const out = [0, 1].map((side) => {
      let weighted = 0;
      let weightTotal = 0;
      for (const window of windows) {
        const requested = Number(window?.requestedMinutes);
        const rate = validPair(window?.rate);
        if (!rate || !weights[requested]) continue;
        const duration = Number(window.elapsedMinutes);
        const samples = Number(window.sampleCount);
        const temporalCoverage = bounded(duration / (requested * 0.70), 0, 1);
        const sampleCoverage = bounded((samples - 1) / 5, 0, 1);
        const evidence = temporalCoverage * (0.35 + 0.65 * sampleCoverage);
        const raw = Math.max(0, rate[side]);
        const anchor = baseline?.[side] ?? raw;
        // Empirical-Bayes style shrinkage: short, sparse windows regress toward match pace.
        const shrunk = anchor * (1 - evidence) + raw * evidence;
        weighted += shrunk * weights[requested];
        weightTotal += weights[requested];
      }
      const anchor = baseline?.[side];
      const ewma = validPair(data?.weightedXgRate)?.[side];
      if (!weightTotal) {
        if (Number.isFinite(ewma)) return ewma;
        const recent = validPair(data?.changes?.xg);
        const elapsed = Math.max(3, (data?.elapsedMs || 0) / 60_000);
        return recent ? Math.max(0, recent[side] / elapsed) : anchor;
      }
      const multiWindow = weighted / weightTotal;
      // Keep the full-match prior material so a single burst cannot set the forecast.
      return Number.isFinite(anchor)
        ? anchor * 0.30 + multiWindow * 0.60 + (Number.isFinite(ewma) ? ewma * 0.10 : 0)
        : multiWindow;
    });
    return out.every(Number.isFinite) ? out : null;
  }

  function gameStateMultiplier(score, side, minute) {
    if (!validPair(score)) return 1;
    const difference = score[side] - score[1 - side];
    const urgency = bounded((minute - 48) / 42, 0, 1);
    const margin = Math.min(3, Math.abs(difference));
    if (difference < 0) return 1 + urgency * (0.14 + 0.06 * margin);
    if (difference > 0) return Math.max(0.68, 1 - urgency * (0.10 + 0.045 * margin));
    return 1 + urgency * 0.035;
  }

  function redCardMultiplier(data, side, remainingMinutes) {
    const cards = validPair(data?.redCards);
    if (!cards) return 1;
    const count = Math.min(2, Math.max(0, cards[side]));
    const opponentCount = Math.min(2, Math.max(0, cards[1 - side]));
    if (!count && !opponentCount) return 1;
    const timing = data?.redCardTiming || [];
    const exposureFor = (cardSide, cardCount) => {
      if (!cardCount) return 0;
      const records = Array.isArray(timing[cardSide]) ? timing[cardSide] : [];
      const knownRecords = records.slice(-cardCount);
      if (!knownRecords.length) {
        // Unknown card timestamps use a conservative current-minute exposure.
        return 0.48 * bounded(remainingMinutes / 35, 0.20, 1);
      }
      return knownRecords.reduce((sum, record) => {
        const age = Number.isFinite(record.ageMinutes) ? Math.max(0, record.ageMinutes) : 0;
        const minute = Number.isFinite(record.minute) ? record.minute : data.minute;
        const matchEndMinute = Number.isFinite(data.clock?.matchEndMinute)
          ? data.clock.matchEndMinute : data.minute + remainingMinutes;
        const timeRemainingFactor = bounded((matchEndMinute - minute) / 50, 0.18, 1);
        const tacticalAdaptation = 0.62 + 0.38 * (1 - Math.exp(-age / 5));
        return sum + timeRemainingFactor * tacticalAdaptation;
      }, 0);
    };
    const ownExposure = exposureFor(side, count);
    const opponentExposure = exposureFor(1 - side, opponentCount);
    const ownPenalty = 0.22 * (1 - Math.exp(-0.72 * ownExposure));
    const opponentBoost = 0.16 * (1 - Math.exp(-0.72 * opponentExposure));
    return bounded((1 - ownPenalty) * (1 + opponentBoost), 0.65, 1.35);
  }

  function nextGoalProbabilities(data, horizonMinutes = 8) {
    const rates = blendedXgRate(data)
      || validPair(data?.weightedXgRate)
      || (validPair(data?.changes?.xg)
        ? data.changes.xg.map((value) => value / Math.max(3, (data.elapsedMs || 0) / 60_000))
        : null);
    if (!rates) return null;
    const shots = validPair(data?.changes?.shots) || [0, 0];
    const sot = validPair(data?.changes?.sot) || [0, 0];
    const bigChances = validPair(data?.changes?.bigChances) || [0, 0];
    const redCards = validPair(data?.redCards);
    const score = validPair(data?.score);
    const remaining = Math.max(1, (data?.clock?.matchEndMinute || 90) - (data?.minute || 0));
    const hazards = rates.map((rate, side) => {
      const cardMultiplier = redCardMultiplier(data, side, remaining);
      const gameState = gameStateMultiplier(score, side, data?.minute || 0);
      const pressureSupport = Math.max(0, shots[side]) * 0.0015
        + Math.max(0, sot[side]) * 0.008 + Math.max(0, bigChances[side]) * 0.02;
      return bounded((Math.max(0, rate) + pressureSupport) * cardMultiplier * gameState, 0.001, 0.35);
    });
    const total = hazards[0] + hazards[1];
    const goalWithinWindow = 1 - Math.exp(-total * horizonMinutes);
    return {
      home: goalWithinWindow * hazards[0] / total,
      away: goalWithinWindow * hazards[1] / total,
      none: 1 - goalWithinWindow,
      calibrationStatus: 'heuristic-uncalibrated',
      probabilityKind: 'heuristic-uncalibrated hazard; not historically calibrated',
      horizonMinutes: Math.max(1, Math.min(20, horizonMinutes)),
      hazardsPerMinute: hazards,
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
    const smoothedRates = blendedXgRate(data);
    const sampleStrength = Number.isFinite(data.sampleCount)
      ? bounded((data.sampleCount - 1) / 7, 0.15, 1) : 0.55;
    return current.map((xg, side) => {
      const matchRate = Math.max(0, xg / played);
      let remaining = matchRate * left;
      const candidateRate = Number.isFinite(smoothedRates?.[side])
        ? smoothedRates[side]
        : Number.isFinite(weighted?.[side]) ? weighted[side]
          : recent ? recent[side] / windowMinutes : null;
      if (Number.isFinite(candidateRate)) {
        // Winsorize the blended windows and shrink toward the match prior when sampling is sparse.
        const cappedRecent = Math.min(Math.max(0, candidateRate), Math.max(0.04, matchRate * 2.5));
        const recentWeight = weighted || data.xgWindows?.length ? 0.52 : 0.25;
        const posteriorRate = matchRate * (1 - recentWeight) + cappedRecent * recentWeight;
        const sampleAdjustedRate = matchRate * (1 - sampleStrength) + posteriorRate * sampleStrength;
        remaining = sampleAdjustedRate * left;
      }
      remaining *= redCardMultiplier(data, side, left);
      remaining *= gameStateMultiplier(validPair(data.score), side, data.minute);
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
      const recentRate = Number.isFinite(blendedXgRate(data)?.[side])
        ? Math.max(0, blendedXgRate(data)[side])
        : recent ? Math.max(0, recent[side] / windowMinutes) : null;
      // A wider fixed band represents weaker evidence; it is not a calibrated interval.
      const disagreement = recentRate == null ? 0.30
        : Math.abs(recentRate - matchRate) / Math.max(0.08, matchRate, recentRate);
      const sampleUncertainty = Number.isFinite(data.sampleCount)
        ? (1 - bounded(data.sampleCount / 10, 0, 1)) * 0.18 : 0.12;
      const spread = Math.min(0.72, 0.12 + disagreement * 0.14
        + eventRegime(data).volatility * 0.10 + sampleUncertainty);
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

  function poissonOutcomes(lambda, correlation = -0.035) {
    if (!validPair(lambda)) return null;
    const distribution = lambda.map(poissonDistribution);
    const result = { home: 0, draw: 0, away: 0 };
    const rho = bounded(Number(correlation) || 0, -0.10, 0.10);
    let mass = 0;
    for (let homeGoals = 0; homeGoals < distribution[0].length; homeGoals++) {
      for (let awayGoals = 0; awayGoals < distribution[1].length; awayGoals++) {
        let correction = 1;
        // Dixon-Coles low-score correction captures scoreline dependence around 0/1 goal.
        if (homeGoals === 0 && awayGoals === 0) correction = 1 - lambda[0] * lambda[1] * rho;
        else if (homeGoals === 1 && awayGoals === 0) correction = 1 + lambda[1] * rho;
        else if (homeGoals === 0 && awayGoals === 1) correction = 1 + lambda[0] * rho;
        else if (homeGoals === 1 && awayGoals === 1) correction = 1 - rho;
        correction = bounded(correction, 0.70, 1.30);
        const probability = distribution[0][homeGoals] * distribution[1][awayGoals] * correction;
        mass += probability;
        if (homeGoals > awayGoals) result.home += probability;
        else if (homeGoals < awayGoals) result.away += probability;
        else result.draw += probability;
      }
    }
    return mass > 0 ? Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value / mass])) : null;
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
    ].map((lambda) => {
      const score = validPair(data.score);
      const margin = score ? Math.min(3, Math.abs(score[0] - score[1])) : 0;
      const dependence = bounded(-0.035 - margin * 0.008 + eventRegime(data).volatility * 0.015, -0.08, 0.01);
      return poissonOutcomes(lambda, dependence);
    });
    if (combinations.some((outcomes) => !outcomes)) return;
    const winners = combinations.map((outcomes) =>
      Object.entries(outcomes).sort((a, b) => b[1] - a[1]));
    const [winner] = winners[0][0];
    if (!winners.every((sorted) => sorted[0][0] === winner)) return;
    const top = Math.min(...winners.map((sorted) => sorted[0][1]));
    const margin = Math.min(...winners.map((sorted) => sorted[0][1] - sorted[1][1]));
    const lambdaSum = scenarios.base[0] + scenarios.base[1];
    const baseThreshold = winner === 'draw' ? 0.60 : 0.48;
    if (top < dynamicMarketThreshold(data, 'remaining-result', baseThreshold) || lambdaSum < (winner === 'draw' ? 0.15 : 0.3)
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
      reason: `Ev/deplasman xG temposu, mevcut skorun oluşturduğu oyun teşviki ve düşük skorlu ortak değişim düzeltmesiyle dört belirsizlik senaryosunda aynı kalan-oyun yönünü verdi. Skor kalan gol olarak eklenmedi. Bu, geçmişle kalibre edilmiş olasılık veya bahis oranı değildir.`,
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

    const overThreshold = dynamicMarketThreshold(data, 'total-goals', OVER_DIRECTION_THRESHOLD);
    const underThreshold = dynamicMarketThreshold(data, 'total-goals', UNDER_DIRECTION_THRESHOLD);
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
    const yesThreshold = dynamicMarketThreshold(data, 'btts', Math.min(BTTS_YES_DIRECTION_THRESHOLD, 0.58));
    const noThreshold = dynamicMarketThreshold(data, 'btts', BTTS_NO_DIRECTION_THRESHOLD);
    if (yesChance >= yesThreshold && allHaveScoringPressure) {
      candidates.push({
        key: `${prefix}-yes`, icon: '⚽', title: `${label} Evet yönü`,
        market: half ? 'İlk yarı karşılıklı gol' : 'Karşılıklı gol',
        level: 'medium', levelLabel: 'xG yönü', side: null,
        modelProbability: yesChance, minimumProbability: Math.min(BTTS_YES_DIRECTION_THRESHOLD, 0.58),
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
      const quality = marketDataQuality(data, 'next-goal');
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
          probabilityKind: nextProbabilities?.probabilityKind || 'heuristic-uncalibrated',
          minimumPressureScore: 2.5,
          pressureScore: next.side === 0 ? next.home : next.away,
          tempoScore: Math.round(bounded((next.side === 0 ? next.home : next.away) / 8, 0, 1) * 100),
          marketIdentity: { market: 'next-goal', period: 'next', line: null, selection: next.side === 0 ? 'home' : 'away' },
          reason: `${name} son pencerede ${Number.isFinite(shots) ? shots : 0} şut, ${Number.isFinite(sot) ? sot : 0} isabetli şut${Number.isFinite(xg) ? ` ve ${xg.toFixed(2)} xG` : ''} ile daha yüksek hücum baskısı kurdu. Bu baskı puanı, sıradaki gol olasılığı değildir; gösterilen olasılık tarihsel olarak kalibre edilmemiş bir hazard modelidir.`,
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
      const marketQuality = candidate.group === 'market'
        ? marketDataQuality(data, candidate.marketIdentity || {}) : quality;
      if (candidate.group === 'market' && (marketQuality < MARKET_DATA_QUALITY_GATE
        || data.statsIntegrity === false || regime.freeze)) continue;
      const threshold = Number.isFinite(candidate.minimumProbability)
        ? dynamicMarketThreshold(data, candidate.marketIdentity || {}, candidate.minimumProbability) : null;
      if (Number.isFinite(candidate.modelProbability) && Number.isFinite(threshold)
        && candidate.modelProbability < threshold) continue;
      candidate.dataQualityScore = quality;
      candidate.marketDataQuality = marketQuality;
      candidate.dynamicThreshold = threshold;
      const observedFeatureCount = ['xg', 'shots', 'sot', 'bigChances', 'corners']
        .filter((key) => validPair(data.changes?.[key])).length;
      const corroboration = bounded(observedFeatureCount / 4, 0, 1);
      const sampleEvidence = Number.isFinite(data.sampleCount) ? bounded(data.sampleCount / 8, 0, 1) : 0.2;
      const windowEvidence = Number.isFinite(data.elapsedMs) ? bounded(data.elapsedMs / 300_000, 0, 1) : 0;
      // Confidence is evidence quality, independent of tempo magnitude and model output.
      candidate.confidenceScore = Math.round(marketQuality * 0.60
        + sampleEvidence * 15 + windowEvidence * 10 + corroboration * 15);
      candidate.evidenceConfidence = candidate.confidenceScore;
      if (!Number.isFinite(candidate.tempoScore)) {
        const pressure = [0, 1].map((side) => teamPressure(data, side) || 0);
        candidate.tempoScore = Math.round(bounded(Math.max(...pressure) / 8, 0, 1) * 100);
      }
      candidate.regime = regime.key;
      candidate.valueEligible = false;
      if (candidate.group === 'market' && candidate.marketIdentity && Number.isFinite(candidate.modelProbability)) {
        const assessment = oddsEngine?.marketAssessment(
          data.liveOdds, candidate.key, candidate.modelProbability,
          data.analysisNowMs, data.eventIdentity,
          { volatile: regime.volatility >= 0.40 || regime.freeze },
        );
        if (assessment?.verified) {
          candidate.oddsEvidence = assessment;
          candidate.marketPriceState = assessment.freshnessBand === 'LIVE' ? 'OPEN' : 'AGING';
          candidate.valueEligible = marketQuality >= 75
            && assessment.valueEligible === true
            && assessment.freshnessBand === 'LIVE'
            && assessment.oddsAgeMs <= 5_000
            && assessment.identityCompleteness === 'complete'
            && assessment.eventIdentityVerified === true
            && assessment.edge >= Math.max(0.03, (100 - marketQuality) * 0.0005)
            && assessment.expectedValue >= 0.02;
        } else {
          candidate.marketPriceState = ['market-closed', 'market-disappeared', 'market-unavailable'].includes(assessment?.reason)
            ? 'MARKET_CLOSED'
            : ['stale-price', 'source-timestamp-missing', 'future-timestamp'].includes(assessment?.reason) ? 'STALE'
            : assessment?.reason === 'event-mismatch' ? 'EVENT_MISMATCH'
              : ['market-identity-mismatch', 'market-incomplete', 'selection-unavailable'].includes(assessment?.reason)
                ? 'LINE_MISMATCH'
                : data.liveOdds ? 'NO_MATCH' : 'MARKET_CLOSED';
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

  function lifecycleIdentity(candidate, context) {
    const market = candidate.marketIdentity || {};
    return JSON.stringify({
      key: candidate.key,
      market: market.market || candidate.key,
      period: market.period ?? null,
      line: market.line ?? null,
      selection: market.selection ?? null,
      phase: context.phase ?? null,
      // Exact score binding prevents a pre-goal confirmation from surviving the score transition.
      score: validPair(context.score),
    });
  }

  function advanceSignalLifecycle(previous = {}, candidates = [], context = {}, now = Date.now(), options = {}) {
    const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : SIGNAL_TTL_MS;
    const confirmationsRequired = Number.isFinite(options.confirmationsRequired)
      ? Math.max(1, options.confirmationsRequired) : 2;
    const majorEvent = options.majorEvent === true;
    const next = {};
    const visible = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const identity = lifecycleIdentity(candidate, context);
      const key = candidate.key;
      seen.add(key);
      const old = previous[key];
      const same = old?.identity === identity && ['CONFIRMING', 'CONFIRMED', 'ACTIVE'].includes(old.state)
        && old.expiresAt > now
        && now - old.lastSeenAt <= ttlMs;
      const confirmations = same ? old.confirmations + 1 : 1;
      const required = majorEvent && candidate.confidenceScore >= 85 ? 1 : confirmationsRequired;
      const state = confirmations < required ? 'CONFIRMING'
        : confirmations === required || !same ? 'CONFIRMED' : 'ACTIVE';
      const expiresAt = now + ttlMs;
      const transitions = same ? [...(old.transitions || [old.state])] : ['DETECTED'];
      if (transitions[transitions.length - 1] !== state) transitions.push(state);
      const record = {
        key, identity, state, confirmations, required, createdAt: same ? old.createdAt : now,
        lastSeenAt: now, expiresAt, score: validPair(context.score), phase: context.phase,
        transitions,
        candidate: { ...candidate, lifecycle: state, createdAt: same ? old.createdAt : now, expiresAt },
      };
      next[key] = record;
      if (confirmations >= required && !context.frozen && context.sourceFresh !== false) visible.push(record.candidate);
    }
    for (const [key, old] of Object.entries(previous)) {
      if (seen.has(key)) continue;
      if (old.expiresAt > now && now - old.lastSeenAt <= ttlMs) {
        const state = context.frozen || (validPair(context.score) && validPair(old.score)
          && (context.score[0] !== old.score[0] || context.score[1] !== old.score[1]))
          ? 'INVALIDATED' : 'EXPIRED';
        next[key] = { ...old, state, transitions: [...(old.transitions || []), state] };
      } else {
        next[key] = { ...old, state: 'EXPIRED', transitions: [...(old.transitions || []), 'EXPIRED'] };
      }
    }
    return { lifecycle: next, signals: visible };
  }

  function activeLifecycleSignals(lifecycle = {}, now = Date.now()) {
    return Object.values(lifecycle)
      .filter((record) => ['CONFIRMED', 'ACTIVE'].includes(record.state)
        && record.expiresAt > now && record.candidate)
      .map((record) => ({ ...record.candidate, lifecycle: record.state }))
      .sort((a, b) => b.rankingScore - a.rankingScore);
  }

  function pendingLifecycleSignals(lifecycle = {}, now = Date.now()) {
    return Object.values(lifecycle)
      .filter((record) => record.state === 'CONFIRMING' && record.expiresAt > now && record.candidate)
      .map((record) => ({
        ...record.candidate, lifecycle: record.state,
        confirmations: record.confirmations, confirmationsRequired: record.required,
      }))
      .sort((a, b) => b.rankingScore - a.rankingScore);
  }

  return {
    ANALYSIS_TYPES, makeAnalysisCandidates, remainingXg, remainingXgScenarios,
    scenarioBand, poissonOutcomes, eventRegime, dataQualityScore, dynamicThreshold,
    marketDataQuality, dynamicMarketThreshold, nextGoalProbabilities, blendedXgRate,
    advanceSignalLifecycle, activeLifecycleSignals, pendingLifecycleSignals, MARKET_DATA_QUALITY_GATE,
  };
}));
