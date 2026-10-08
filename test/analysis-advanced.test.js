'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
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
});

test('red-card influence depends nonlinearly on card timing and remaining time', () => {
  const early = fixture({
    minute: 70, redCards: [1, 0], redCardTiming: [[{ minute: 25, ageMinutes: 45 }], []],
  });
  const recent = fixture({
    minute: 70, redCards: [1, 0], redCardTiming: [[{ minute: 68, ageMinutes: 2 }], []],
  });
  const earlyProjection = Engine.remainingXg(early, 94);
  const recentProjection = Engine.remainingXg(recent, 94);
  const noCardProjection = Engine.remainingXg(fixture(), 94);
  assert.ok(earlyProjection[0] < recentProjection[0]);
  assert.ok(recentProjection[0] < noCardProjection[0]);
  assert.ok(earlyProjection[1] > recentProjection[1]);
});

test('remaining-goal projection uses score incentives without adding current score as a goal', () => {
  const trailing = Engine.remainingXg(fixture({ minute: 82, score: [0, 1] }), 94);
  const leading = Engine.remainingXg(fixture({ minute: 82, score: [1, 0] }), 94);
  const tied = Engine.remainingXg(fixture({ minute: 82, score: [0, 0] }), 94);
  assert.ok(trailing[0] > tied[0] && tied[0] > leading[0]);
  assert.ok(trailing[0] < 1, 'forecast is remaining xG, not current score plus goals');
});

test('Dixon-Coles low-score dependence remains normalized and changes independent-Poisson output', () => {
  const independent = Engine.poissonOutcomes([0.7, 0.45], 0);
  const dependent = Engine.poissonOutcomes([0.7, 0.45], -0.08);
  assert.ok(Math.abs(Object.values(dependent).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.notDeepEqual(dependent, independent);
  assert.ok(dependent.home >= 0 && dependent.draw >= 0 && dependent.away >= 0);
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
