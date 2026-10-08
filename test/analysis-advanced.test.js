'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const OddsEngine = require('../src/js/odds-engine.js');
const BacktestEngine = require('../src/js/backtest-engine.js');
const Engine = require('../src/js/analysis-engine.js');

function fixture(overrides = {}) {
  const data = {
    status: 'ready', phase: '2Y', minute: 70, elapsedMs: 300_000,
    dataAgeMs: 400, statisticsAgeMs: 400, eventAgeMs: 350,
    sampleCount: 12, statisticsUnchangedCount: 0, statsIntegrity: true,
    clock: { known: true, endMinute: 94, matchEndMinute: 94 }, score: [1, 1],
    names: ['Home', 'Away'], changes: {
      shots: [6, 3], sot: [3, 1], corners: [2, 1], xg: [0.45, 0.22],
      bigChances: [1, 0],
    }, cumulativeXg: [1.5, 1.1], cumulativeStats: {
      xg: [1.5, 1.1], shots: [13, 9], sot: [5, 3], corners: [6, 4], bigChances: [2, 1],
    }, totalShots: 9, totalSot: 4, totalCorners: 3, totalXg: 0.67, totalBigChances: 1,
  };
  return { ...data, ...overrides, changes: { ...data.changes, ...overrides.changes } };
}

function byKey(data, key) {
  return Engine.makeAnalysisCandidates(data).find((candidate) => candidate.key === key);
}

function strongOverFixture(overrides = {}) {
  const base = fixture();
  return fixture({
    ...overrides,
    changes: { ...base.changes, shots: [8, 8], sot: [3, 3], xg: [1, 1], ...overrides.changes },
    cumulativeXg: overrides.cumulativeXg || [1.5, 1.5],
    cumulativeStats: {
      ...base.cumulativeStats, xg: [1.5, 1.5], shots: [15, 15], sot: [7, 7],
      ...overrides.cumulativeStats,
    },
  });
}

test('market-specific quality applies a hard gate and rejects broken counter integrity', () => {
  const weak = fixture({
    dataAgeMs: 25_000, statisticsAgeMs: 25_000, eventAgeMs: 18_000,
    clock: { known: false }, score: null, sampleCount: 1, statsIntegrity: false,
    changes: { xg: null }, cumulativeXg: null,
  });
  assert.ok(Engine.marketDataQuality(weak, 'total-goals') < Engine.MARKET_DATA_QUALITY_GATE);
  assert.ok(Engine.marketDataQuality(fixture(), 'next-goal') >= Engine.MARKET_DATA_QUALITY_GATE);
  const candidates = Engine.makeAnalysisCandidates(weak);
  assert.ok(!candidates.some((candidate) => candidate.group === 'market'));
});

test('tempo magnitude and evidence confidence remain independent dimensions', () => {
  const complete = fixture({ sampleCount: 12 });
  const sparse = fixture({ sampleCount: 2 });
  const completeSignal = byKey(complete, 'next-goal-home');
  const sparseSignal = byKey(sparse, 'next-goal-home');
  assert.ok(completeSignal && sparseSignal);
  assert.equal(completeSignal.tempoScore, sparseSignal.tempoScore);
  assert.ok(completeSignal.evidenceConfidence > sparseSignal.evidenceConfidence);
  assert.ok(completeSignal.modelProbability > 0 && completeSignal.modelProbability < 1);
  assert.match(completeSignal.probabilityKind, /uncalibrated/);
});

test('multi-window xG blend shrinks a sparse short burst toward the match prior', () => {
  const sparse = fixture({
    xgWindows: [{ requestedMinutes: 3, elapsedMinutes: 1.8, sampleCount: 2, rate: [0.25, 0.01] }],
  });
  const dense = fixture({
    xgWindows: [
      { requestedMinutes: 3, elapsedMinutes: 2.5, sampleCount: 8, rate: [0.25, 0.01] },
      { requestedMinutes: 5, elapsedMinutes: 4.7, sampleCount: 12, rate: [0.19, 0.02] },
      { requestedMinutes: 10, elapsedMinutes: 9.4, sampleCount: 22, rate: [0.12, 0.025] },
      { requestedMinutes: 15, elapsedMinutes: 14.4, sampleCount: 30, rate: [0.09, 0.03] },
    ],
  });
  const sparseRate = Engine.blendedXgRate(sparse)[0];
  const denseRate = Engine.blendedXgRate(dense)[0];
  const matchRate = sparse.cumulativeXg[0] / sparse.minute;
  assert.ok(sparseRate < denseRate);
  assert.ok(sparseRate - matchRate < 0.10, 'a low-sample burst is strongly shrunk');
  assert.ok(denseRate > matchRate, 'independent longer windows support the elevated rate');
});

test('xG corrections, negative deltas and inconsistent windows cannot enter projections or goal markets', () => {
  const corrected = fixture({
    changes: { xg: [-0.12, 0.04] }, xgCorrectionDetected: true,
  });
  assert.equal(Engine.xgIntegrityValid(corrected), false);
  assert.equal(Engine.remainingXg(corrected, 94), null);
  assert.equal(Engine.nextGoalProbabilities(corrected), null);
  assert.equal(Engine.marketDataQuality(corrected, 'total-goals'), 0);
  assert.ok(!Engine.makeAnalysisCandidates(corrected).some((candidate) =>
    ['total-goals', 'btts', 'remaining-result'].includes(candidate.marketIdentity?.market)));

  const negativeCumulative = fixture({
    cumulativeStats: { ...fixture().cumulativeStats, xg: [1.5, -0.01] },
  });
  assert.equal(Engine.xgIntegrityValid(negativeCumulative), false);
  assert.equal(Engine.blendedXgRate(negativeCumulative), null);
  assert.equal(Engine.eventRegime(negativeCumulative).ratio == null, false,
    'valid non-xG features may still describe the activity regime');
  assert.equal(Engine.marketDataQuality(negativeCumulative, 'btts'), 0);

  const malformedWindow = fixture({ xgWindows: [
    { requestedMinutes: 5, elapsedMinutes: 4, sampleCount: 4, rate: [0.12, 0.03], delta: [-0.2, 0.1] },
  ] });
  assert.equal(Engine.blendedXgRate(malformedWindow), null);
  assert.equal(Engine.remainingXg(malformedWindow, 94), null);
});

test('event regime fuses multiple stats and explicit provider events', () => {
  const quiet = fixture({
    changes: { shots: [0, 0], sot: [0, 0], corners: [0, 0], xg: [0, 0], bigChances: [0, 0] },
    cumulativeStats: { xg: [1.5, 1.1], shots: [13, 9], sot: [5, 3], corners: [6, 4], bigChances: [2, 1] },
  });
  const busy = fixture({
    changes: { shots: [14, 8], sot: [7, 4], corners: [5, 3], xg: [0.9, 0.5], bigChances: [3, 2] },
  });
  assert.notEqual(Engine.eventRegime(quiet).key, Engine.eventRegime(busy).key);
  assert.equal(Engine.eventRegime({ ...busy, regimeEvents: ['red-card'] }).event, 'red-card');
  const varRegime = Engine.eventRegime({ ...busy, regimeEvents: ['var'] });
  assert.equal(varRegime.key, 'frozen');
  assert.equal(varRegime.freeze, true);
  assert.equal(Engine.eventRegime({ ...busy, regimeEvents: ['penalty'] }).freeze, true);
  assert.equal(Engine.eventRegime({ scoreChanged: true }).key, 'transition',
    'score changes remain explicit before enough features exist for a tempo ratio');
  assert.deepEqual(Engine.makeAnalysisCandidates({ ...busy, frozen: true }), [],
    'an active suspension/VAR freeze suppresses activity and market output alike');
  assert.deepEqual(Engine.makeAnalysisCandidates({ ...busy, regimeEvents: ['penalty'] }), [],
    'a validated penalty incident freezes signals while the event is unresolved');
});

test('red-card influence depends nonlinearly on card timing and remaining time', () => {
  const early = fixture({
    minute: 70, redCards: [1, 0], redCardTiming: [[{ minute: 25 }], []],
  });
  const recent = fixture({
    minute: 70, redCards: [1, 0], redCardTiming: [[{ minute: 68 }], []],
  });
  const earlyProjection = Engine.remainingXg(early, 94);
  const recentProjection = Engine.remainingXg(recent, 94);
  const noCardProjection = Engine.remainingXg(fixture(), 94);
  assert.ok(earlyProjection[0] < recentProjection[0]);
  assert.ok(recentProjection[0] < noCardProjection[0]);
  assert.ok(earlyProjection[1] > recentProjection[1]);

  const nearEnd = Engine.remainingXg(fixture({
    minute: 88, clock: { known: true, endMinute: 94, matchEndMinute: 94 },
    redCards: [1, 0], redCardTiming: [[{ minute: 25 }], []],
  }), 94);
  const noCardNearEnd = Engine.remainingXg(fixture({
    minute: 88, clock: { known: true, endMinute: 94, matchEndMinute: 94 },
  }), 94);
  assert.ok(nearEnd[0] < noCardNearEnd[0]);
  assert.ok(noCardNearEnd[0] - nearEnd[0] < noCardProjection[0] - earlyProjection[0],
    'the same card has less remaining-match impact close to full time');
});

test('remaining-goal projection uses score incentives without adding current score as a goal', () => {
  const trailing = Engine.remainingXg(fixture({ minute: 82, score: [0, 1] }), 94);
  const leading = Engine.remainingXg(fixture({ minute: 82, score: [1, 0] }), 94);
  const tied = Engine.remainingXg(fixture({ minute: 82, score: [0, 0] }), 94);
  assert.ok(trailing[0] > tied[0] && tied[0] > leading[0]);
  assert.ok(trailing[0] < 1, 'forecast is remaining xG, not current score plus goals');

  const extendedClock = Engine.remainingXg(fixture({
    minute: 108, phase: 'UZ1', score: [0, 1],
    clock: { known: true, endMinute: 120, matchEndMinute: 120 },
  }), 120);
  assert.ok(extendedClock && extendedClock[0] > 0);
});

test('Dixon-Coles low-score dependence remains normalized and changes independent-Poisson output', () => {
  const independent = Engine.poissonOutcomes([0.7, 0.45], 0);
  const dependent = Engine.poissonOutcomes([0.7, 0.45], -0.08);
  assert.ok(Math.abs(Object.values(dependent).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.notDeepEqual(dependent, independent);
  assert.ok(dependent.home >= 0 && dependent.draw >= 0 && dependent.away >= 0);
});

test('next-goal pressure remains independent of the uncalibrated hazard projection and horizon is clamped', () => {
  const pressureOnly = fixture({
    changes: { shots: [7, 0], sot: [3, 0], corners: [0, 0], xg: [0, 0], bigChances: [0, 0] },
    totalShots: 7, totalSot: 3, totalCorners: 0, totalXg: 0, totalBigChances: 0,
    cumulativeXg: [0, 0],
  });
  const next = Engine.makeAnalysisCandidates(pressureOnly).find((candidate) => candidate.key === 'next-goal-home');
  assert.ok(next, 'pressure can create a direction without a minimum pseudo-probability gate');
  assert.ok(next.pressureScore >= next.minimumPressureScore);
  assert.ok(next.modelProbability < 0.08);
  assert.match(next.probabilityKind, /uncalibrated/);

  const normal = Engine.nextGoalProbabilities(fixture(), 8);
  const oversized = Engine.nextGoalProbabilities(fixture(), 10_000);
  assert.equal(oversized.horizonMinutes, 20);
  assert.ok(oversized.none <= normal.none);
  assert.ok(Math.abs(oversized.home + oversized.away + oversized.none - 1) < 1e-12);

  const fiveMinutes = fixture({
    elapsedMs: 300_000, changes: { xg: [0.30, 0], shots: [4, 0], sot: [2, 0], bigChances: [0, 0] },
  });
  const twoAndHalfMinutes = fixture({
    elapsedMs: 150_000, changes: { xg: [0.15, 0], shots: [2, 0], sot: [1, 0], bigChances: [0, 0] },
  });
  const fiveHazard = Engine.nextGoalProbabilities(fiveMinutes);
  const shorterHazard = Engine.nextGoalProbabilities(twoAndHalfMinutes);
  assert.ok(Math.abs(fiveHazard.home - shorterHazard.home) < 1e-12,
    'shot and xG pressure are converted to comparable per-minute rates');
});

test('calibration is disabled by default and only exact, in-date market Platt metadata unlocks value eligibility', () => {
  const now = 1_800_000_000_000;
  const eventIdentity = 'event-cal-1|Home|Away';
  const odds = OddsEngine.parseSnapshot({ markets: [{
    marketId: 'totals-2.5', bookmakerId: 'book-a', bookmakerName: 'Book A',
    eventId: 'event-cal-1', isLive: true, marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
    choices: [
      { id: 'over-choice', name: 'Over 2.5', decimalValue: 3.7 },
      { id: 'under-choice', name: 'Under 2.5', decimalValue: 1.25 },
    ],
  }] }, { eventLive: true, observedAt: now, eventIdentity });
  const base = strongOverFixture({ liveOdds: odds, analysisNowMs: now, eventIdentity });
  const raw = byKey(base, 'match-over-2_5');
  assert.ok(raw, 'fixture provides a theoretical market direction');
  assert.equal(raw.valueEligible, false);
  assert.equal(raw.calibratedProbability, null);
  assert.equal(raw.valueStatus, 'UNCALIBRATED_THEORETICAL_ONLY');
  assert.ok(Number.isFinite(raw.oddsEvidence?.expectedValue), 'theoretical EV remains available as a diagnostic');

  const calibration = {
    status: 'validated', baseModelId: 'live-xg-poisson-total-v1', modelId: 'platt-total-v3', version: '3',
    method: 'platt', slope: 1, intercept: 0, outcomeCount: 1_200, brierScore: 0.21,
    validatedAt: now - 60_000, expiresAt: now + 86_400_000,
    market: 'total-goals', period: 'match', line: 2.5,
  };
  const withCalibration = byKey({ ...base, calibration }, 'match-over-2_5');
  assert.equal(withCalibration.calibrationStatus, 'validated-market-specific');
  assert.match(withCalibration.probabilityKind, /uncalibrated/,
    'the visible raw heuristic probability is never mislabeled as calibrated');
  assert.ok(Math.abs(withCalibration.calibratedProbability - withCalibration.heuristicProbability) < 1e-12);
  assert.equal(withCalibration.oddsEvidence.probabilitySource, 'validated-platt-calibration');
  assert.equal(withCalibration.valueEligible, true);

  const wrongLine = byKey({ ...base, calibration: { ...calibration, line: 3.5 } }, 'match-over-2_5');
  assert.equal(wrongLine.calibratedProbability, null);
  assert.equal(wrongLine.valueEligible, false);
  const expired = byKey({ ...base, calibration: { ...calibration, expiresAt: now } }, 'match-over-2_5');
  assert.equal(expired.calibratedProbability, null);
  assert.equal(expired.valueEligible, false);
});

test('offline isotonic backtest summary cannot unlock a live calibrated candidate', () => {
  const now = 1_800_000_000_000;
  const training = Array.from({ length: 50 }, (_, index) => ({
    matchId: `training-${index}`, timestamp: index + 1,
    resolvedAt: 100, marketKey: 'match/over/2.5', probability: (index + 1) / 51,
    outcome: index % 2 === 0, selected: false,
  }));
  const evaluation = [{
    matchId: 'evaluation-1', timestamp: 200, marketKey: 'match/over/2.5',
    probability: 0.6, outcome: true, selected: true,
  }];
  const report = BacktestEngine.evaluateDataset({ schemaVersion: 1, calibrationTraining: training, evaluation });
  assert.equal(report.modelCalibration.method, 'per-market-isotonic-pava');
  const eventIdentity = 'event-cal-1|Home|Away';
  const odds = OddsEngine.parseSnapshot({ markets: [{
    marketId: 'totals-2.5', bookmakerId: 'book-a', eventId: 'event-cal-1', isLive: true,
    marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
    choices: [
      { id: 'over-choice', name: 'Over 2.5', decimalValue: 3.7 },
      { id: 'under-choice', name: 'Under 2.5', decimalValue: 1.25 },
    ],
  }] }, { eventLive: true, observedAt: now, eventIdentity });
  const candidate = byKey(strongOverFixture({
    liveOdds: odds, analysisNowMs: now, eventIdentity,
    calibration: report.modelCalibration,
  }), 'match-over-2_5');
  assert.ok(candidate);
  assert.equal(candidate.calibratedProbability, null);
  assert.equal(candidate.valueEligible, false);
  assert.equal(candidate.valueStatus, 'UNCALIBRATED_THEORETICAL_ONLY');
});

test('missing, explicitly closed, and stale prices remain separate from model direction', () => {
  const now = 1_800_000_000_000;
  const eventIdentity = 'event-price-state|Home|Away';
  const empty = OddsEngine.parseSnapshot({ markets: [] }, { eventLive: true, observedAt: now, eventIdentity });
  const closed = OddsEngine.parseSnapshot({ markets: [{
    marketId: 'totals-2.5', bookmakerId: 'book-a', eventId: 'event-price-state', isLive: true,
    marketName: 'Total Goals Over/Under 2.5', suspended: true, updatedAt: now,
    choices: [
      { id: 'over-choice', name: 'Over 2.5', decimalValue: 1.9 },
      { id: 'under-choice', name: 'Under 2.5', decimalValue: 1.9 },
    ],
  }] }, { eventLive: true, observedAt: now, eventIdentity });
  const stale = OddsEngine.parseSnapshot({ markets: [{
    marketId: 'totals-2.5', bookmakerId: 'book-a', eventId: 'event-price-state', isLive: true,
    marketName: 'Total Goals Over/Under 2.5', updatedAt: now - 15_000,
    choices: [
      { id: 'over-choice', name: 'Over 2.5', decimalValue: 1.9 },
      { id: 'under-choice', name: 'Under 2.5', decimalValue: 1.9 },
    ],
  }] }, { eventLive: true, observedAt: now, eventIdentity });
  const withOdds = (liveOdds) => byKey(strongOverFixture({ liveOdds, analysisNowMs: now, eventIdentity }), 'match-over-2_5');

  assert.equal(withOdds(null)?.marketPriceState, 'PRICE_UNAVAILABLE');
  assert.equal(withOdds(empty)?.marketPriceState, 'PRICE_UNAVAILABLE');
  assert.equal(withOdds(closed)?.marketPriceState, 'MARKET_CLOSED');
  const staleCandidate = withOdds(stale);
  assert.equal(staleCandidate?.marketPriceState, 'STALE');
  assert.ok(staleCandidate, 'stale prices do not erase independent model direction');
});

test('signal lifecycle confirms only the same line/selection/score state and expires stale signals', () => {
  const candidate = {
    key: 'match-over-2_5', confidenceScore: 80, rankingScore: 80,
    marketIdentity: { market: 'total-goals', period: 'match', line: 2.5, selection: 'over' },
  };
  let state = Engine.advanceSignalLifecycle({}, [candidate], { phase: '2Y', score: [1, 1] }, 100).lifecycle;
  assert.equal(state[candidate.key].state, 'CONFIRMING');
  assert.deepEqual(state[candidate.key].transitions, ['DETECTED', 'CONFIRMING']);
  let advanced = Engine.advanceSignalLifecycle(state, [candidate], { phase: '2Y', score: [1, 1] }, 105);
  state = advanced.lifecycle;
  assert.equal(advanced.signals[0].lifecycle, 'CONFIRMED');
  advanced = Engine.advanceSignalLifecycle(state, [candidate], { phase: '2Y', score: [1, 1] }, 110);
  state = advanced.lifecycle;
  assert.equal(advanced.signals[0].lifecycle, 'ACTIVE');

  const changedLine = { ...candidate, marketIdentity: { ...candidate.marketIdentity, line: 3.5 } };
  advanced = Engine.advanceSignalLifecycle(state, [changedLine], { phase: '2Y', score: [1, 1] }, 112);
  assert.equal(advanced.signals.length, 0, 'a line change starts a new confirmation lifecycle');
  advanced = Engine.advanceSignalLifecycle(advanced.lifecycle, [candidate], { phase: '2Y', score: [2, 1] }, 114);
  assert.equal(advanced.signals.length, 0, 'a score change invalidates the old lifecycle');
  advanced = Engine.advanceSignalLifecycle(state, [candidate], { phase: '2Y', score: [1, 1] }, 20_000);
  assert.equal(advanced.signals.length, 0, 'expired evidence cannot be reactivated with one new poll');

  const major = Engine.advanceSignalLifecycle({}, [{ ...candidate, confidenceScore: 91 }],
    { phase: '2Y', score: [1, 1] }, 30_000, { majorEvent: true });
  assert.equal(major.signals[0].lifecycle, 'CONFIRMED', 'high-quality major-event evidence needs one fresh confirmation');
});

test('analysis renderer exposes lifecycle, distinct feed states and targeted match updates', () => {
  const source = readFileSync(path.join(__dirname, '../src/js/analysis.js'), 'utf8');
  assert.match(source, /function renderAnalysisMatch\(id\)/);
  assert.match(source, /function renderAnalysisMatches\(ids\)/);
  assert.match(source, /data-match-id/);
  assert.match(source, /WAITING DATA/);
  assert.match(source, /STALE/);
  assert.match(source, /MARKET CLOSED/);
  assert.match(source, /NO SIGNAL/);
  assert.match(source, /analysisIntegrity/);
  assert.match(source, /statisticsSourceUpdatedAt/);
  assert.match(source, /statisticsFingerprint/);
});

test('market state classification distinguishes closed, unavailable and stale prices', () => {
  const source = readFileSync(path.join(__dirname, '../src/js/analysis.js'), 'utf8');
  assert.match(source, /\['closed', 'disappeared'\]\.includes\(oddsSummary\?\.key\).*?MARKET_CLOSED/s);
  assert.match(source, /: 'PRICE_UNAVAILABLE';/);
  assert.match(source, /'STALE · Oran\/veri kaynağı eski veya zaman damgası doğrulanamıyor/);
  assert.match(source, /'MARKET CLOSED · Bu market açıkça kapalı veya feed’den kaldırılmış/);
  assert.match(source, /'NO LIVE QUOTE · Açık markete ait eşleşen canlı fiyat yok/);
  assert.doesNotMatch(source, /function shouldPollLiveOdds\(/, 'the per-match scheduler owns odds cadence');
});
