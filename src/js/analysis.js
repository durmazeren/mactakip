'use strict';

/* Açıklanabilir canlı aktivite motoru.
 * Sinyaller olasılık değildir; yalnızca başarılı istatistik kontrollerinden
 * hesaplanır ve maç/oran geçmişiyle kalibre edilmiş bir tahmin modeli değildir. */

const ANALYSIS_WINDOW_MS = 5 * 60_000;
const ANALYSIS_HISTORY_MS = 15 * 60_000 + 20_000;
const ANALYSIS_MIN_WINDOW_MS = 3 * 60_000;
const ANALYSIS_STALE_MS = 35_000;
const ANALYSIS_CONFIRMATIONS = 2;
const ANALYSIS_TYPES = AnalysisEngine.ANALYSIS_TYPES;
const savedMatchLine = Number(load('analysisMatchTotal', 2.5));
const savedHalfLine = Number(load('analysisFirstHalfTotal', 1.5));
const ANALYSIS_LINES = {
  matchTotal: [0.5, 1.5, 2.5, 3.5, 4.5].includes(savedMatchLine) ? savedMatchLine : 2.5,
  firstHalfTotal: [0.5, 1.5, 2.5].includes(savedHalfLine) ? savedHalfLine : 1.5,
};
const analysisHistory = new Map();
const analysisConfirmations = new Map();
const analysisIntegrity = new Map();
const analysisEventState = new Map();
const analysisLatestReceivedAt = new Map();

function analysisPhase(ev) {
  return LiveAnalysisState.phaseForEvent(ev);
}

function analysisMinute(ev, now = Date.now()) {
  return LiveAnalysisState.matchClock(ev, now).minute;
}

function validPair(pair) {
  return Array.isArray(pair) && pair.length >= 2 && pair.every(Number.isFinite)
    ? [pair[0], pair[1]] : null;
}

function pairDelta(current, previous) {
  const now = validPair(current);
  const before = validPair(previous);
  if (!now || !before) return null;
  const delta = [now[0] - before[0], now[1] - before[1]];
  return delta.some((value) => value < 0) ? null : delta;
}

const CUMULATIVE_STAT_KEYS = ['shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed', 'redCards'];

function windowXgRates(history, latest, requestedWindows = [3, 5, 10, 15]) {
  if (!latest || !Array.isArray(history)) return [];
  return requestedWindows.flatMap((requestedMinutes) => {
    const cutoff = latest.at - requestedMinutes * 60_000;
    const baseline = history.find((sample) => sample.at >= cutoff) || history[0];
    const elapsedMinutes = (latest.at - baseline.at) / 60_000;
    const minimumCoverage = requestedMinutes <= 5 ? 0.55 : 0.45;
    const delta = pairDelta(latest.stats.xg, baseline.stats.xg);
    if (!delta || elapsedMinutes < requestedMinutes * minimumCoverage) return [];
    const samples = history.filter((sample) => sample.at >= baseline.at && sample.at <= latest.at);
    const independentSamples = new Set(samples.map((sample) => sample.fingerprint || sample.at));
    return [{
      requestedMinutes,
      elapsedMinutes,
      sampleCount: independentSamples.size,
      delta,
      rate: delta.map((value) => value / Math.max(0.1, elapsedMinutes)),
    }];
  });
}

function providerIncidentTypes(ev, seen = new Set()) {
  const incidents = Array.isArray(ev?.incidents) ? ev.incidents
    : Array.isArray(ev?.event?.incidents) ? ev.event.incidents : [];
  return incidents.flatMap((incident) => {
    const text = [incident?.incidentType, incident?.type, incident?.incident,
      incident?.description, incident?.name, incident?.status].filter(Boolean).join(' ').toLowerCase();
    let type = null;
    if (/\bvar\b|video assistant/.test(text)) type = 'var';
    else if (/penalt/.test(text)) type = 'penalty';
    else if (/red.?card|sent.?off/.test(text)) type = 'red-card';
    else if (/goal/.test(text)) type = 'goal';
    if (!type) return [];
    const signature = String(incident?.id ?? incident?.eventId
      ?? `${type}|${incident?.timeSeconds ?? incident?.time ?? incident?.minute ?? ''}|${text}`);
    return seen.has(signature) ? [] : [{ type, signature }];
  });
}

function eventIsSuspended(ev) {
  const status = ev?.status || {};
  const description = `${status.description || ''} ${status.type || ''}`.toLowerCase();
  return /suspend|interrupted|abandoned/.test(description);
}

function statsRegression(previous, current) {
  if (!previous) return null;
  for (const key of CUMULATIVE_STAT_KEYS) {
    const before = validPair(previous.stats?.[key]);
    const after = validPair(current.stats?.[key]);
    if (before && after && (after[0] < before[0] || after[1] < before[1])) return key;
  }
  return null;
}

function analysisSnapshot(id, now) {
  const ev = state.events.get(id);
  const history = analysisHistory.get(id) || [];
  if (!isLive(ev)) return { status: 'inactive', ev };
  if (ev.status?.code === 31) return { status: 'halftime', ev };
  const currentStats = state.stats.get(id);
  const apiStatus = state.apiStatus.get(id) || null;
  const telemetry = state.pollTelemetry?.get(id) || {};
  const statisticsTelemetry = telemetry.statistics || {};
  const eventTelemetry = telemetry.event || {};
  if (apiStatus) {
    if ([apiStatus.event, apiStatus.statistics].includes('failed')) return { status: 'api-failed', ev, apiStatus };
    if (['partial', 'invalid', 'mismatch'].some((kind) => [apiStatus.event, apiStatus.statistics].includes(kind))) {
      return { status: 'api-partial', ev, apiStatus };
    }
    if (['not-found', 'empty'].some((kind) => [apiStatus.event, apiStatus.statistics].includes(kind))) {
      return { status: 'api-empty', ev, apiStatus };
    }
  }
  if (!currentStats || currentStats.none || !currentStats.ALL) {
    if (apiStatus?.statistics === 'failed' || apiStatus?.event === 'failed') return { status: 'api-failed', ev, apiStatus };
    if (apiStatus?.statistics === 'partial' || apiStatus?.statistics === 'invalid'
      || apiStatus?.event === 'partial' || apiStatus?.event === 'mismatch') return { status: 'api-partial', ev, apiStatus };
    return { status: 'nodata', ev, apiStatus };
  }
  const integrity = analysisIntegrity.get(id);
  if (integrity?.broken) {
    return { status: 'integrity', ev, apiStatus, integritySamplesRemaining: Math.max(0, 3 - integrity.goodSnapshots) };
  }
  if (!history.length) {
    if (apiStatus?.statistics === 'failed' || apiStatus?.event === 'failed') return { status: 'api-failed', ev, apiStatus };
    if (apiStatus?.statistics === 'partial' || apiStatus?.statistics === 'invalid'
      || apiStatus?.event === 'partial' || apiStatus?.event === 'mismatch') return { status: 'api-partial', ev, apiStatus };
    if (apiStatus?.statistics === 'complete') return { status: 'nodata', ev, apiStatus };
    return { status: 'warming', ev, elapsedMs: 0, apiStatus };
  }

  const latest = history[history.length - 1];
  const receiveAt = analysisLatestReceivedAt.get(id) || latest.receivedAt || latest.at;
  const reportedStatsAge = Number.isFinite(statisticsTelemetry.dataAgeMs)
    ? statisticsTelemetry.dataAgeMs : null;
  const dataAgeMs = Math.max(0, reportedStatsAge == null ? now - receiveAt : reportedStatsAge);
  const eventAgeMs = Number.isFinite(eventTelemetry.dataAgeMs)
    ? Math.max(0, eventTelemetry.dataAgeMs)
    : Number.isFinite(eventTelemetry.receivedAt) ? Math.max(0, now - eventTelemetry.receivedAt) : dataAgeMs;
  if (dataAgeMs > ANALYSIS_STALE_MS || eventAgeMs > ANALYSIS_STALE_MS) {
    return { status: 'stale', ev, latest, dataAgeMs: Math.max(dataAgeMs, eventAgeMs), statisticsAgeMs: dataAgeMs, eventAgeMs };
  }

  const cutoff = latest.at - ANALYSIS_WINDOW_MS;
  const baseline = history.find((sample) => sample.at >= cutoff) || history[0];
  const elapsedMs = latest.at - baseline.at;
  if (elapsedMs < ANALYSIS_MIN_WINDOW_MS) {
    return { status: 'warming', ev, latest, elapsedMs, dataAgeMs };
  }

  const changes = {};
  for (const key of ['shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed']) {
    changes[key] = pairDelta(latest.stats[key], baseline.stats[key]);
  }
  const hasShots = !!changes.shots;
  const hasSot = !!changes.sot;
  const hasCorners = !!changes.corners;
  if (!hasShots && !hasSot && !hasCorners && !changes.bigChances) {
    return { status: 'nodata', ev, latest, elapsedMs, dataAgeMs };
  }

  const sum = (pair) => pair ? pair[0] + pair[1] : null;
  const totalShots = sum(changes.shots);
  const totalSot = sum(changes.sot);
  const totalCorners = sum(changes.corners);
  const totalXg = sum(changes.xg);
  const totalBigChances = sum(changes.bigChances);
  const score = LiveAnalysisState.scorePair(ev);
  const clock = LiveAnalysisState.matchClock(ev, now);
  const eventState = analysisEventState.get(id) || {};
  const redCardTiming = (eventState.redCardTiming || [[], []]).map((records) => records.map((record) => ({
    ...record, ageMinutes: Math.max(0, clock.minute - record.minute),
  })));
  const cumulativeStats = Object.fromEntries(CUMULATIVE_STAT_KEYS.map((key) => [key, latest.stats[key]]));
  return {
    status: 'ready', ev, latest, changes, elapsedMs, dataAgeMs, analysisNowMs: now, apiStatus,
    statisticsAgeMs: dataAgeMs, eventAgeMs,
    statisticsObservedAt: statisticsTelemetry.receivedAt || receiveAt,
    statisticsSourceUpdatedAt: statisticsTelemetry.sourceUpdatedAt || null,
    statisticsFingerprint: statisticsTelemetry.fingerprint || latest.fingerprint || null,
    statisticsUnchangedCount: Number(statisticsTelemetry.unchangedCount) || 0,
    statsIntegrity: integrity?.broken !== true,
    xgWindows: windowXgRates(history, latest),
    minute: clock.minute, phase: clock.phase, clock, score,
    eventIdentity: LiveAnalysisState.matchIdentity(ev, id),
    names: [teamName(ev.homeTeam), teamName(ev.awayTeam)],
    totalShots, totalSot, totalCorners, totalXg, totalBigChances,
    cumulativeXg: validPair(latest.stats.xg),
    cumulativeStats,
    possession: validPair(latest.stats.possession),
    redCards: validPair(latest.stats.redCards),
    redCardDelta: validPair(latest.redCardDelta),
    redCardTiming,
    regimeEvents: latest.regimeEvents || [],
    scoreChanged: latest.regimeEvents?.includes('goal') || false,
    frozen: eventState.freezeUntil > now || eventIsSuspended(ev),
    sampleCount: new Set(history.filter((sample) => sample.at >= cutoff)
      .map((sample) => sample.fingerprint || sample.at)).size,
    weightedXgRate: weightedRollingXgRate(history, now),
    liveOdds: state.liveOdds.get(id) || null,
  };
}

function weightedRollingXgRate(history, now, halfLifeMs = 90_000) {
  return LiveAnalysisState.weightedPairRate(history, 'xg', now, ANALYSIS_WINDOW_MS, halfLifeMs);
}
const makeAnalysisCandidates = (data) => AnalysisEngine.makeAnalysisCandidates(data, ANALYSIS_LINES);

function advanceAnalysisConfirmations(id, candidates, context = {}, now = Date.now(), options = {}) {
  const previous = analysisConfirmations.get(id) || {};
  const advanced = AnalysisEngine.advanceSignalLifecycle(previous, candidates, context, now, {
    confirmationsRequired: ANALYSIS_CONFIRMATIONS,
    ttlMs: 15_000,
    ...options,
  });
  analysisConfirmations.set(id, advanced.lifecycle);
  return advanced.signals;
}

function recordAnalysisSnapshot(id, statsFresh) {
  if (!statsFresh) return;
  const ev = state.events.get(id);
  const all = state.stats.get(id)?.ALL;
  if (!isLive(ev) || ev.status?.code === 31 || !all || state.stats.get(id)?.none) {
    if (ev?.status?.code === 31) {
      analysisHistory.set(id, []);
      analysisConfirmations.delete(id);
    }
    return;
  }

  const now = Date.now();
  const phase = analysisPhase(ev);
  const clock = LiveAnalysisState.matchClock(ev, now);
  const stats = {};
  for (const key of ['shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed', 'redCards', 'possession']) {
    const pair = all[key];
    stats[key] = Array.isArray(pair) ? [...pair] : null;
  }
  const hasData = ['shots', 'sot', 'corners', 'xg', 'bigChances']
    .some((key) => validPair(stats[key]));
  if (!hasData) return;

  let history = analysisHistory.get(id) || [];
  const previous = history[history.length - 1];
  const identity = LiveAnalysisState.matchIdentity(ev, id);
  const score = LiveAnalysisState.scorePair(ev);
  const oldEventState = analysisEventState.get(id);
  const sameEvent = oldEventState?.identity === identity;
  const oldScore = sameEvent ? validPair(oldEventState.score) : null;
  const oldCards = sameEvent ? validPair(oldEventState.redCards) : null;
  const newCards = validPair(stats.redCards);
  const scoreChanged = !!(oldScore && score && (oldScore[0] !== score[0] || oldScore[1] !== score[1]));
  const redCardDelta = oldCards && newCards
    ? newCards.map((value, side) => Math.max(0, value - oldCards[side])) : [0, 0];
  const knownIncidentKeys = new Set(sameEvent ? oldEventState.incidentKeys || [] : []);
  const freshIncidentEvents = providerIncidentTypes(ev, knownIncidentKeys);
  const incidentKeys = [...knownIncidentKeys, ...freshIncidentEvents.map((item) => item.signature)];
  const regimeEvents = freshIncidentEvents.map((item) => item.type);
  if (scoreChanged) regimeEvents.push('goal');
  if (redCardDelta.some((value) => value > 0)) regimeEvents.push('red-card');
  if (sameEvent && oldEventState.phase !== phase) regimeEvents.push('period-change');
  if (eventIsSuspended(ev)) regimeEvents.push('suspension');
  const redCardTiming = sameEvent && Array.isArray(oldEventState.redCardTiming)
    ? oldEventState.redCardTiming.map((records) => [...records]) : [[], []];
  for (const side of [0, 1]) {
    for (let index = 0; index < Math.min(2, redCardDelta[side]); index++) {
      redCardTiming[side].push({ minute: clock.minute, at: now });
    }
  }
  const hasFreezeEvent = regimeEvents.some((event) => ['var', 'penalty', 'suspension'].includes(event));
  const freezeUntil = eventIsSuspended(ev) ? Number.POSITIVE_INFINITY
    : hasFreezeEvent ? now + 20_000
      : sameEvent && Number.isFinite(oldEventState.freezeUntil) ? oldEventState.freezeUntil : 0;
  analysisEventState.set(id, {
    identity, phase, score, redCards: newCards, redCardTiming, freezeUntil, incidentKeys,
  });

  const current = {
    at: now, receivedAt: now, phase, identity,
    minute: clock.minute, score, stats, redCardDelta, regimeEvents: [...new Set(regimeEvents)],
  };
  const resetReason = LiveAnalysisState.resetReason(previous, current);
  const regression = statsRegression(previous, current);
  const eventReset = regimeEvents.some((event) => [
    'red-card', 'var', 'penalty', 'suspension', 'period-change',
  ].includes(event));
  if (resetReason || regression || eventReset) {
    history = [];
    analysisConfirmations.delete(id);
  }

  const integrity = analysisIntegrity.get(id) || { broken: false, goodSnapshots: 3, lastStats: null };
  if (regression) {
    integrity.broken = true;
    integrity.goodSnapshots = 0;
    integrity.reason = `counter-reset:${regression}`;
  } else if (integrity.broken) {
    integrity.goodSnapshots += 1;
    if (integrity.goodSnapshots >= 3) {
      integrity.broken = false;
      integrity.reason = null;
    }
  }
  integrity.lastStats = stats;
  analysisIntegrity.set(id, integrity);

  if (previous && previous.at >= now) return;
  const telemetry = state.pollTelemetry?.get(id) || {};
  const statsTelemetry = telemetry.statistics || {};
  const eventTelemetry = telemetry.event || {};
  current.fingerprint = statsTelemetry.fingerprint
    || CUMULATIVE_STAT_KEYS.map((key) => `${key}:${stats[key]?.join(',') ?? '-'}`).join('|');
  current.sourceUpdatedAt = statsTelemetry.sourceUpdatedAt || null;
  current.sourceChanged = statsTelemetry.changed !== false;
  current.eventAgeMs = eventTelemetry.dataAgeMs;
  if (resetReason === 'score-change' || resetReason === 'phase-change'
    || resetReason === 'event-identity' || regression || regimeEvents.includes('var')
    || regimeEvents.includes('penalty') || regimeEvents.includes('suspension')) {
    // A score, period, data-integrity or dangerous live event breaks signal continuity.
    analysisConfirmations.set(id, {});
  }
  history.push(current);
  while (history.length && history[0].at < now - ANALYSIS_HISTORY_MS) history.shift();
  if (history.length > 225) history.splice(0, history.length - 225);
  analysisHistory.set(id, history);
  analysisLatestReceivedAt.set(id, now);

  const data = analysisSnapshot(id, now);
  const candidates = data.frozen ? [] : makeAnalysisCandidates(data);
  const majorEvent = regimeEvents.some((event) => ['goal', 'red-card'].includes(event));
  advanceAnalysisConfirmations(id, candidates, {
    phase, score,
    frozen: data.frozen === true,
    sourceFresh: data.status === 'ready' && data.dataAgeMs <= ANALYSIS_STALE_MS,
  }, now, { majorEvent });
}

function recordLiveOddsSnapshot(id, payload, event, now = Date.now()) {
  const snapshot = OddsEngine.parseSnapshot(payload, {
    eventLive: true, observedAt: now,
    eventIdentity: LiveAnalysisState.matchIdentity(event, id),
  });
  if (!snapshot) return false;
  state.liveOdds.set(id, OddsEngine.withMovement(snapshot, state.liveOdds.get(id)));
  return true;
}

function forgetAnalysis(id) {
  analysisHistory.delete(id);
  analysisConfirmations.delete(id);
  analysisIntegrity.delete(id);
  analysisEventState.delete(id);
  analysisLatestReceivedAt.delete(id);
  state.liveOdds.delete(id);
  state.lastOddsPoll.delete(id);
}

function activityBand(stats, side, elapsedMs) {
  const covered = ['shots', 'sot', 'xg', 'bigChances'].some((key) => Number.isFinite(stats?.[key]?.[side]));
  if (!covered) return { key: 'na', label: 'Veri yok', width: 0 };
  const shots = stats?.shots?.[side] || 0;
  const sot = stats?.sot?.[side] || 0;
  const xg = stats?.xg?.[side] || 0;
  const bigChances = stats?.bigChances?.[side] || 0;
  const fiveMinuteScale = 300_000 / Math.max(ANALYSIS_MIN_WINDOW_MS, elapsedMs || 0);
  const activity = (shots * 7 + sot * 10 + xg * 14 + bigChances * 18) * fiveMinuteScale;
  if (activity >= 48) return { key: 'high', label: 'Yüksek', width: 100 };
  if (activity >= 22) return { key: 'medium', label: 'Orta', width: 63 };
  return { key: 'low', label: 'Düşük', width: 28 };
}

function analysisResult(id, now = Date.now()) {
  const ev = state.events.get(id);
  if (!ev) return { status: 'loading' };
  if (ev.status?.type === 'notstarted') return { status: 'upcoming', ev };
  if (isOver(ev)) return { status: 'finished', ev };
  if (ev.status?.code === 31) return { status: 'halftime', ev };
  const data = analysisSnapshot(id, now);
  if (data.status !== 'ready') return { ...data, ev };

  const lifecycle = analysisConfirmations.get(id) || {};
  const signals = AnalysisEngine.activeLifecycleSignals(lifecycle, now);
  const projection = data.clock?.known
    ? AnalysisEngine.remainingXgScenarios(data, data.clock.endMinute) : null;
  const quality = AnalysisEngine.dataQualityScore(data);
  const regime = AnalysisEngine.eventRegime(data);
  const oddsPollStatus = data.apiStatus?.odds;
  const oddsSummary = ['failed', 'partial', 'invalid'].includes(oddsPollStatus)
    ? { key: oddsPollStatus, label: oddsPollStatus === 'failed' ? 'Oran isteği başarısız' : 'Oran yanıtı eksik' }
    : ['empty', 'not-found'].includes(oddsPollStatus)
      ? { key: 'empty', label: 'Eşleşen canlı oran yok' }
    : OddsEngine.summary(data.liveOdds, now);
  const marketState = ['verified', 'live'].includes(oddsSummary?.key) ? 'OPEN'
    : oddsSummary?.key === 'aging' ? 'AGING'
      : ['failed', 'partial', 'invalid', 'stale', 'unverified', 'future'].includes(oddsSummary?.key) ? 'STALE'
        : ['closed', 'disappeared'].includes(oddsSummary?.key) ? 'MARKET_CLOSED'
          : 'PRICE_UNAVAILABLE';
  const signalState = signals.length ? 'SIGNAL'
    : marketState === 'MARKET_CLOSED' ? 'MARKET_CLOSED'
      : ['STALE', 'AGING'].includes(marketState) ? 'STALE'
        : marketState === 'PRICE_UNAVAILABLE' ? 'PRICE_UNAVAILABLE' : 'NO_SIGNAL';
  return {
    ...data,
    signals: signals.sort((a, b) => b.rankingScore - a.rankingScore),
    dataQualityScore: quality,
    regime,
    oddsSummary,
    marketState,
    signalState,
    projectionBand: AnalysisEngine.scenarioBand(projection),
    teamBands: [
      activityBand(data.changes, 0, data.elapsedMs),
      activityBand(data.changes, 1, data.elapsedMs),
    ],
  };
}

function analysisDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes} dk ${String(seconds).padStart(2, '0')} sn` : `${seconds} sn`;
}

function pairLabel(pair, digits = 0) {
  const values = validPair(pair);
  return values ? values.map((value) => digits ? value.toFixed(digits) : value).join(' – ') : 'Veri yok';
}

function marketContext(data) {
  const score = validPair(data.score);
  const scoreTextValue = score ? `${score[0]}–${score[1]}` : 'veri yok';
  return `Skor ${scoreTextValue} · ${data.phase} · ${minuteText(data.ev)}`;
}

function analysisContextDetails(data) {
  const details = [];
  if (data.regime) details.push(`Oyun rejimi ${data.regime.label}`);
  if (data.clock?.inStoppage && !data.clock.stoppageKnown) details.push('Uzatma süresi sağlayıcıda belirsiz');
  if (validPair(data.possession)) {
    details.push(`Topa sahip olma ${data.possession[0]}%–${data.possession[1]}%`);
  }
  if (validPair(data.redCards) && data.redCards.some((count) => count > 0)) {
    details.push(`Kırmızı kart ${data.redCards[0]}–${data.redCards[1]}`);
  }
  if (validPair(data.changes?.bigChances) && data.totalBigChances > 0) {
    details.push(`Büyük şans ${data.changes.bigChances[0]}–${data.changes.bigChances[1]} · pencere`);
  }
  return details;
}

function analysisOddsReference(data) {
  const markets = data.liveOdds?.markets;
  if (!markets) return '';
  const parts = [];
  const addPair = (label, quote, names) => {
    if (!quote) return;
    const values = names.map((name) => quote.prices?.[name]);
    if (values.some((value) => !Number.isFinite(value))) return;
    parts.push(`${label} ${values.map((value) => value.toFixed(2)).join(' / ')}`);
  };
  const line = Number(ANALYSIS_LINES.matchTotal).toFixed(1);
  if (['1Y', '2Y'].includes(data.phase)) {
    addPair(`Maç ${line} Ü/A`, markets.matchTotals?.[line], ['over', 'under']);
  }
  if (data.phase === '1Y') {
    const halfLine = Number(ANALYSIS_LINES.firstHalfTotal).toFixed(1);
    addPair(`İY ${halfLine} Ü/A`, markets.firstHalfTotals?.[halfLine], ['over', 'under']);
  }
  addPair('KG E/H', markets.matchBtts, ['yes', 'no']);
  if (markets.nextGoal) {
    const next = ['home', 'none', 'away'].filter((side) => Number.isFinite(markets.nextGoal.prices?.[side]));
    const labels = { home: 'Ev', none: 'Gol yok', away: 'Dep' };
    if (next.length >= 2) parts.push(`Sıradaki gol ${next.map((side) => `${labels[side]} ${markets.nextGoal.prices[side].toFixed(2)}`).join(' / ')}`);
  }
  return parts.join(' · ');
}

function analysisScoreText(ev) {
  if (ev?.status?.type === 'notstarted') return '–';
  const score = [ev?.homeScore?.current, ev?.awayScore?.current];
  return validPair(score) ? `${score[0]} - ${score[1]}` : 'Skor –';
}

function makeSignalRow(signal) {
  const row = el('article', `analysis-signal ${signal.level} ${signal.group || 'activity'}`);
  const top = el('div', 'signal-top');
  top.append(
    el('span', 'signal-icon', signal.icon),
    el('b', 'signal-title', signal.title),
    el('span', `signal-level ${signal.level}`, signal.levelLabel || (signal.level === 'high' ? 'Yüksek aktivite' : 'Orta aktivite')),
  );
  row.append(top, el('div', 'signal-market', signal.market), el('div', 'signal-reason', signal.reason));
  const confidenceParts = [
    `Kanıt gücü ${signal.confidenceScore}/100`,
    `veri ${signal.dataQualityScore}/100`,
    Number.isFinite(signal.marketDataQuality) ? `market veri kalitesi ${signal.marketDataQuality}/100` : null,
    Number.isFinite(signal.tempoScore) ? `tempo ${signal.tempoScore}/100` : null,
    signal.marketPriceState && signal.marketPriceState !== 'OPEN' ? `oran ${signal.marketPriceState}` : null,
    `sıralama ${Math.round(signal.rankingScore)}`,
    signal.lifecycle ? `durum ${signal.lifecycle}` : null,
    signal.valueEligible ? 'teorik değer filtresi geçti' : null,
  ].filter(Boolean);
  const confidence = el('div', 'signal-confidence', confidenceParts.join(' · '));
  confidence.title = 'Kanıt gücü ve tempo ayrı ölçülür. Bunlar gerçek sonuç olasılığı değildir; model olasılıkları tarihsel olarak kalibre edilmemiştir.';
  row.append(confidence);
  if (Number.isFinite(signal.modelProbability)) {
    const probabilityLabel = signal.probabilityKind?.includes('uncalibrated')
      ? 'Kalibre edilmemiş model projeksiyonu' : 'Model projeksiyonu';
    row.append(el('div', 'signal-model-probability',
      `${probabilityLabel} %${(signal.modelProbability * 100).toFixed(1)}${Number.isFinite(signal.pressureScore) ? ` · baskı ${signal.pressureScore.toFixed(1)}` : ''}`));
  }
  if (signal.oddsEvidence) {
    const evidence = signal.oddsEvidence;
    const movement = Number.isFinite(evidence.movement) && Math.abs(evidence.movement) >= 0.005
      ? ` · piyasa ${evidence.movement > 0 ? '+' : ''}${(evidence.movement * 100).toFixed(1)} puan` : '';
    const consensus = Number.isFinite(evidence.consensusBookCount)
      ? ` · ${evidence.consensusBookCount} sağlayıcı konsensüsü` : '';
    const quoteAge = Number.isFinite(evidence.oddsAgeMs)
      ? ` · oran yaşı ${analysisDuration(evidence.oddsAgeMs)}` : '';
    row.append(el('div', 'signal-odds-evidence',
      `${evidence.provider ? `${evidence.provider} · ` : ''}oran ${evidence.price.toFixed(2)} · ham ima %${(evidence.impliedProbability * 100).toFixed(1)} · marjsız piyasa %${(evidence.fairMarketProbability * 100).toFixed(1)} (piyasa adil oranı ${evidence.marketFairOdds.toFixed(2)}) · heuristik model %${(evidence.modelProbability * 100).toFixed(1)} (model adil oranı ${evidence.modelFairOdds.toFixed(2)}) · fark ${evidence.edge >= 0 ? '+' : ''}${(evidence.edge * 100).toFixed(1)} puan · teorik EV ${evidence.expectedValue >= 0 ? '+' : ''}${(evidence.expectedValue * 100).toFixed(1)}%${consensus}${quoteAge}${movement}`));
  }
  return row;
}

function makeMetric(label, pair, digits = 0) {
  const row = el('div', 'analysis-metric');
  row.append(el('span', null, label), el('b', null, pairLabel(pair, digits)));
  return row;
}

function makeSignalSection(title, signals, kind) {
  if (!signals.length) return null;
  const section = el('section', `analysis-signal-section ${kind}`);
  const heading = el('div', 'analysis-section-head');
  heading.append(
    el('b', null, title),
    el('span', null, String(signals.length)),
  );
  const list = el('div', 'analysis-signals');
  signals.forEach((signal) => list.append(makeSignalRow(signal)));
  section.append(heading, list);
  return section;
}

function buildAnalysisCard(id, result = analysisResult(id)) {
  const card = el('article', 'analysis-card');
  card.dataset.matchId = String(id);
  const ev = result.ev;
  const header = el('div', 'analysis-card-head');
  const teams = el('div', 'analysis-match');
  if (ev) {
    teams.append(
      el('b', 'analysis-title', `${teamName(ev.homeTeam)} ${analysisScoreText(ev)} ${teamName(ev.awayTeam)}`),
      el('span', 'analysis-competition', ev.tournament?.name || ev.uniqueTournament?.name || 'Canlı maç'),
    );
    header.append(teams, el('span', 'analysis-minute', minuteText(ev)));
  } else {
    teams.append(el('b', 'analysis-title', `Maç #${id}`), el('span', 'analysis-competition', 'Maç verisi yükleniyor'));
    header.append(teams, el('span', 'analysis-minute', '…'));
  }
  card.append(header);

  const states = {
    upcoming: ['Sıradaki maç', 'Canlı analiz maç başladıktan sonra açılır.'],
    finished: ['Maç tamamlandı', 'Canlı sinyaller durduruldu.'],
    halftime: ['Devre arası', 'Yeni ölçüm penceresi ikinci yarı başlayınca açılacak.'],
    inactive: ['Canlı değil', 'Bu karşılaşma şu anda canlı durumda değil.'],
    loading: ['Veri bekleniyor', 'Maç verisi yükleniyor.'],
    nodata: ['WAITING DATA · İstatistik yok', 'Bu maç için analize uygun şut, isabetli şut veya korner verisi henüz gelmedi.'],
    'api-failed': ['WAITING DATA · API isteği başarısız', 'Canlı maç veya istatistik servisine ulaşılamadı; önceki veriden yeni sinyal üretilmedi.'],
    'api-partial': ['WAITING DATA · Eksik API yanıtı', 'Maç kimliği, skor veya istatistik yanıtı eksik; kısmi veri analiz penceresine alınmadı.'],
    'api-empty': ['WAITING DATA · API verisi boş', 'Maç veya istatistik uç noktası bu kontrolde veri döndürmedi; eski veriyle yeni sinyal üretilmedi.'],
    'price-unavailable': ['NO LIVE QUOTE · Canlı fiyat yok', 'Açık ve eşleşen bir bookmaker fiyatı alınmadı. Yönsel analiz gösterilebilir; fiyat ve value sinyali üretilemez.'],
    stale: ['STALE · Veri gecikiyor', `Event/istatistik kaynağından en yaşlı veri ${analysisDuration(result.dataAgeMs)} önceydi; yeni veri gelene kadar sinyal gizlendi.`],
    integrity: ['İstatistik bütünlüğü kontrolü', `Sayaç gerilemesi algılandı. Yeni sinyal üretimi üç yeni başarılı snapshot doğrulanana kadar durduruldu (${result.integritySamplesRemaining ?? 3} kaldı).`],
    warming: ['WAITING DATA · Ölçüm hazırlanıyor', `Güvenilir pencere için en az 3 dk veri gerekiyor. Şu an ${analysisDuration(result.elapsedMs)} ölçüldü.`],
  };
  if (result.status !== 'ready') {
    const [label, message] = states[result.status] || ['Analiz beklemede', 'Yeni ölçüm bekleniyor.'];
    const stateRow = el('div', `analysis-state ${result.status}`);
    stateRow.append(el('b', null, label), el('span', null, message));
    if (result.dataAgeMs != null) stateRow.append(el('small', null, `Son başarılı kontrol: ${analysisDuration(result.dataAgeMs)} önce`));
    card.append(stateRow);
    return card;
  }

  const topMeta = el('div', 'analysis-meta');
  topMeta.append(
    el('span', 'analysis-live-pill', '● CANLI'),
    el('span', 'analysis-window', `${analysisDuration(result.elapsedMs)} ölçüm`),
    el('span', 'analysis-freshness', `Kontrol ${analysisDuration(result.dataAgeMs)} önce`),
  );
  if (result.oddsSummary) {
    topMeta.append(el('span', `analysis-odds-status ${result.oddsSummary.key}`, result.oddsSummary.label));
  }
  topMeta.append(el('span', 'analysis-quality', `Veri kalitesi ${result.dataQualityScore}/100`));
  if (result.regime) topMeta.append(el('span', `analysis-regime ${result.regime.key}`, result.regime.label));
  if (result.clock?.inStoppage && !result.clock.stoppageKnown) {
    topMeta.append(el('span', 'analysis-clock-warning', 'Uzatma süresi belirsiz'));
  }
  if (result.projectionBand) {
    topMeta.append(el('span', `analysis-projection-range ${result.projectionBand.key}`, `Tempo aralığı ${result.projectionBand.label.toLowerCase()}`));
  }
  card.append(topMeta);
  const oddsReference = analysisOddsReference(result);
  if (oddsReference) card.append(el('div', 'analysis-odds-reference', oddsReference));

  const teamGrid = el('div', 'analysis-team-grid');
  for (const side of [0, 1]) {
    const band = result.teamBands[side];
    const team = el('div', `analysis-team ${side === 0 ? 'home' : 'away'} ${band.key}`);
    const line = el('div', 'analysis-team-label');
    line.append(el('span', null, teamName(side === 0 ? ev.homeTeam : ev.awayTeam)), el('b', null, `${band.label} tempo`));
    const track = el('div', 'analysis-team-track');
    const fill = el('i');
    fill.style.width = `${band.width}%`;
    track.append(fill);
    team.append(line, track);
    teamGrid.append(team);
  }
  card.append(teamGrid);

  const metrics = el('div', `analysis-metrics${result.changes.xg ? ' has-xg' : ''}`);
  metrics.append(
    makeMetric('Şut', result.changes.shots),
    makeMetric('İsabetli şut', result.changes.sot),
    makeMetric('Korner', result.changes.corners),
  );
  if (result.changes.xg) metrics.append(makeMetric('xG artışı', result.changes.xg, 2));
  card.append(metrics);

  const scoreContext = el('div', 'analysis-context', marketContext(result));
  card.append(scoreContext);
  const contextDetails = analysisContextDetails(result);
  if (contextDetails.length) card.append(el('div', 'analysis-context-details', contextDetails.join(' · ')));
  const marketSignals = result.signals.filter((signal) => signal.group === 'market');
  const activitySignals = result.signals.filter((signal) => signal.group !== 'market');
  if (!result.signals.length) {
    const signalMessages = {
      MARKET_CLOSED: 'MARKET CLOSED · Bu market açıkça kapalı veya feed’den kaldırılmış; value sinyali üretilemez.',
      PRICE_UNAVAILABLE: 'NO LIVE QUOTE · Açık markete ait eşleşen canlı fiyat yok; value sinyali üretilemez.',
      STALE: 'STALE · Oran/veri kaynağı eski veya zaman damgası doğrulanamıyor; value değerlendirmesi durduruldu.',
      NO_SIGNAL: 'NO SIGNAL · Veri yeterli, fakat market yönü eşiği ve kanıt koşulları birlikte oluşmadı.',
    };
    const message = signalMessages[result.signalState] || signalMessages.NO_SIGNAL;
    card.append(el('div', `analysis-no-signal ${result.signalState?.toLowerCase() || ''}`, message));
  } else {
    if (result.marketState === 'AGING') {
      card.append(el('div', 'analysis-market-state', 'ORAN YAŞLANIYOR · Yönsel model sinyali gösteriliyor; value sinyali için 5 saniyeden yeni fiyat gerekir.'));
    } else if (result.marketState !== 'OPEN') {
      const marketMessage = result.marketState === 'MARKET_CLOSED'
        ? 'MARKET CLOSED · Market açıkça askıda, kapalı veya feed’den kaldırılmış.'
        : result.marketState === 'STALE'
          ? 'STALE · Fiyat zaman damgası eski, eksik veya doğrulanamıyor; value sinyali bastırıldı.'
          : 'NO LIVE QUOTE · Yönsel model sinyalleri gösteriliyor; eşleşen canlı fiyat ve value sinyali yok.';
      card.append(el('div', 'analysis-market-state', marketMessage));
    }
    const marketSection = makeSignalSection('Bahis market yönleri', marketSignals, 'market');
    const activitySection = makeSignalSection('Maç içi aktivite', activitySignals, 'activity');
    if (marketSection) card.append(marketSection);
    if (activitySection) card.append(activitySection);
  }
  return card;
}

function renderAnalysisList() {
  const list = $('#analysisList');
  if (!list) return;
  const scrollTop = list.scrollTop;
  const results = state.matches.map((match) => analysisResult(match.id));
  updateAnalysisSummary(results);
  const cards = state.matches.map((match, index) => buildAnalysisCard(match.id, results[index]));
  if (!cards.length) cards.push(el('div', 'analysis-empty', 'Analiz için önce canlı bir maç ekle.'));
  list.replaceChildren(...cards);
  list.scrollTop = scrollTop;
}

function updateAnalysisSummary(results) {
  const activeCount = results.reduce((sum, result) => sum + (result.signals?.length || 0), 0);
  const activeMatches = results.filter((result) => result.signals?.length).length;
  const marketCount = results.reduce((sum, result) => sum + (result.signals?.filter((signal) => signal.group === 'market').length || 0), 0);
  const activityCount = results.reduce((sum, result) => sum + (result.signals?.filter((signal) => signal.group !== 'market').length || 0), 0);
  const summary = $('#analysisSummary');
  if (summary) {
    summary.replaceChildren(
      el('b', null, activeCount ? `${activeCount} aktif sinyal` : 'Aktif sinyal yok'),
      el('span', null, `${activeMatches} maçta · ${marketCount} market yönü · ${activityCount} aktivite`),
    );
    summary.classList.toggle('has-active', activeCount > 0);
  }
  const tab = $('#analysisTab');
  if (tab) {
    tab.classList.toggle('has-signals', activeCount > 0);
    tab.title = activeCount ? `${activeCount} doğrulanmış canlı sinyal` : 'Canlı analiz';
    tab.setAttribute('aria-label', activeCount ? `Canlı analiz, ${activeCount} aktif sinyal` : 'Canlı analiz');
  }
}

function renderAnalysisMatch(id) {
  renderAnalysisMatches([id]);
}

function renderAnalysisMatches(ids) {
  const list = $('#analysisList');
  if (!list) return;
  const requested = new Set((ids || []).map(String));
  const matches = state.matches.filter((match) => requested.has(String(match.id)));
  if (!matches.length || !list.children.length) return renderAnalysisList();
  const scrollTop = list.scrollTop;
  for (const match of matches) {
    const selectorId = String(match.id).replace(/["\\]/g, '\\$&');
    const existing = list.querySelector(`[data-match-id="${selectorId}"]`);
    const replacement = buildAnalysisCard(match.id, analysisResult(match.id));
    if (existing) existing.replaceWith(replacement);
    else return renderAnalysisList();
  }
  updateAnalysisSummary(state.matches.map((match) => analysisResult(match.id)));
  list.scrollTop = scrollTop;
}

function setSideView(view) {
  const analysis = view === 'analysis';
  $('#shotsView').hidden = analysis;
  $('#analysisView').hidden = !analysis;
  $('#periodSeg').hidden = analysis;
  $('#cardCfgBtn').hidden = analysis;
  $('#shotsTab').classList.toggle('on', !analysis);
  $('#analysisTab').classList.toggle('on', analysis);
  $('#shotsTab').setAttribute('aria-selected', String(!analysis));
  $('#analysisTab').setAttribute('aria-selected', String(analysis));
  $('#sideFootText').textContent = analysis
    ? 'Kaynak kontrol aralığı maç temposuna göre uyarlanır' : 'Canlı maçlar duruma göre güncellenir';
  save('sideView', analysis ? 'analysis' : 'shots');
}

function initAnalysisLines() {
  const matchLine = $('#analysisMatchLine');
  const halfLine = $('#analysisHalfLine');
  matchLine.value = String(ANALYSIS_LINES.matchTotal);
  halfLine.value = String(ANALYSIS_LINES.firstHalfTotal);
  matchLine.addEventListener('change', () => {
    ANALYSIS_LINES.matchTotal = Number(matchLine.value);
    save('analysisMatchTotal', ANALYSIS_LINES.matchTotal);
    renderAnalysisList();
  });
  halfLine.addEventListener('change', () => {
    ANALYSIS_LINES.firstHalfTotal = Number(halfLine.value);
    save('analysisFirstHalfTotal', ANALYSIS_LINES.firstHalfTotal);
    renderAnalysisList();
  });
}
