'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const OddsEngine = require('../src/js/odds-engine.js');
const {
  ANALYSIS_TYPES, makeAnalysisCandidates, remainingXg, remainingXgScenarios, scenarioBand, poissonOutcomes,
  eventRegime, dataQualityScore, dynamicThreshold,
} = require('../src/js/analysis-engine.js');

function fixture(overrides = {}) {
  const data = {
    status: 'ready',
    phase: '2Y',
    minute: 55,
    elapsedMs: 300_000,
    dataAgeMs: 500,
    sampleCount: 12,
    clock: { known: true, endMinute: 94, matchEndMinute: 94 },
    score: [0, 2],
    names: ['Ev', 'Deplasman'],
    changes: {
      shots: [6, 1],
      sot: [3, 0],
      corners: [1, 0],
      xg: [0.45, 0.05],
    },
    cumulativeXg: [1.5, 0.3],
    totalShots: 7,
    totalSot: 3,
    totalCorners: 1,
    totalXg: 0.5,
  };
  return { ...data, ...overrides, changes: { ...data.changes, ...overrides.changes } };
}

function keys(data, lines) {
  return makeAnalysisCandidates(data, lines).map((signal) => signal.key);
}

test('next-goal and remaining-match direction follow recent pressure, not current score', () => {
  const found = keys(fixture(), { matchTotal: 2.5, firstHalfTotal: 1.5 });
  assert.ok(found.includes('next-goal-home'));
  assert.ok(found.includes('rest-result-home'));
  assert.ok(!found.includes('rest-result-away'));
});

test('half-time totals and half-time BTTS are limited to first-half live play', () => {
  const firstHalf = fixture({
    phase: '1Y', minute: 18, score: [0, 0],
    clock: { known: true, endMinute: 45, matchEndMinute: 94 },
    changes: { shots: [5, 3], sot: [2, 1], xg: [0.5, 0.5] },
    cumulativeXg: [1.5, 1.3], totalShots: 8, totalSot: 3, totalXg: 1.0,
  });
  const firstKeys = keys(firstHalf, { matchTotal: 2.5, firstHalfTotal: 0.5 });
  assert.ok(firstKeys.includes('half-over-0_5'));
  assert.ok(firstKeys.includes('half-btts-yes'));

  const secondKeys = keys(fixture(), { matchTotal: 2.5, firstHalfTotal: 0.5 });
  assert.ok(!secondKeys.some((key) => key.startsWith('half-')));
});

test('match over and BTTS signals use the selected line and per-team xG', () => {
  const data = fixture({
    score: [0, 2],
    cumulativeXg: [1.5, 0.3],
  });
  const standardLine = keys(data, { matchTotal: 2.5, firstHalfTotal: 1.5 });
  const higherLine = keys(data, { matchTotal: 4.5, firstHalfTotal: 1.5 });
  assert.ok(standardLine.includes('match-over-2_5'));
  assert.ok(standardLine.includes('btts-yes'));
  assert.ok(!higherLine.includes('match-over-4_5'));
});

test('late low-xG match can show under and BTTS-no direction', () => {
  const quiet = fixture({
    minute: 75,
    score: [0, 0],
    changes: { shots: [0, 0], sot: [0, 0], corners: [0, 0], xg: [0, 0] },
    cumulativeXg: [0, 0],
    totalShots: 0, totalSot: 0, totalCorners: 0, totalXg: 0,
  });
  const found = keys(quiet, { matchTotal: 2.5, firstHalfTotal: 1.5 });
  assert.ok(found.includes('match-under-2_5'));
  assert.ok(found.includes('btts-no'));
});

test('remaining-match model can select a draw without using the current score', () => {
  const quietAndBalanced = fixture({
    minute: 75,
    score: [3, 0],
    changes: { shots: [0, 0], sot: [0, 0], corners: [0, 0], xg: [0.05, 0.05] },
    cumulativeXg: [0.4, 0.4],
    totalShots: 0, totalSot: 0, totalCorners: 0, totalXg: 0.1,
  });
  const found = keys(quietAndBalanced, { matchTotal: 4.5, firstHalfTotal: 1.5 });
  assert.ok(found.includes('rest-result-draw'));
  assert.ok(!found.includes('rest-result-away'));
});

test('Poisson remaining-goal outcomes are normalized and symmetric', () => {
  const balanced = poissonOutcomes([0.8, 0.8]);
  assert.ok(Math.abs(balanced.home - balanced.away) < 1e-12);
  assert.ok(Math.abs(balanced.home + balanced.draw + balanced.away - 1) < 1e-12);
  assert.equal(poissonOutcomes([0, 0]).draw, 1);
});

test('xG projection exposes ordered low/base/high scenarios and widens with tempo disagreement', () => {
  const stable = fixture({ changes: { xg: [0.136, 0.027] } });
  const volatile = fixture({ changes: { xg: [1.1, 0] } });
  const stableRange = remainingXgScenarios(stable, 94);
  const volatileRange = remainingXgScenarios(volatile, 94);
  assert.ok(stableRange.low.every((value, side) => value <= stableRange.base[side]));
  assert.ok(stableRange.high.every((value, side) => value >= stableRange.base[side]));
  const width = (range) => range.high.reduce((sum, value, side) => sum + value - range.low[side], 0);
  assert.ok(width(volatileRange) > width(stableRange));
  assert.ok(['narrow', 'medium', 'wide'].includes(scenarioBand(volatileRange).key));
});

test('weighted recent xG changes the remaining-goal rate without replacing match baseline', () => {
  const quietRecent = remainingXg(fixture({ weightedXgRate: [0.01, 0.01] }), 94);
  const risingRecent = remainingXg(fixture({ weightedXgRate: [0.09, 0.01] }), 94);
  assert.ok(risingRecent[0] > quietRecent[0]);
  assert.ok(risingRecent[1] >= quietRecent[1]);
});

test('regime detection and data-quality score adapt thresholds to volatile or weak feeds', () => {
  const stable = fixture({ changes: { xg: [0.15, 0.10] }, weightedXgRate: [0.03, 0.02] });
  const surge = fixture({ changes: { xg: [1.1, 0.3] }, totalBigChances: 2 });
  const quiet = fixture({
    changes: { shots: [0, 0], sot: [0, 0], corners: [0, 0], xg: [0, 0], bigChances: [0, 0] },
    cumulativeXg: [1.5, 1.5], totalShots: 0, totalSot: 0, totalBigChances: 0,
  });
  assert.equal(eventRegime(stable).key, 'balanced');
  assert.equal(eventRegime(surge).key, 'surge');
  assert.equal(eventRegime(quiet).key, 'cooldown');

  const quality = dataQualityScore(stable);
  const staleQuality = dataQualityScore({ ...stable, dataAgeMs: 35_000 });
  const noClockQuality = dataQualityScore({ ...stable, clock: { known: false } });
  assert.ok(quality > staleQuality);
  assert.ok(quality > noClockQuality);
  assert.ok(dynamicThreshold(surge, 0.62) > dynamicThreshold(stable, 0.62));
});

test('a total line that clears only the central tempo scenario is suppressed', () => {
  const borderline = fixture({ score: [0, 0] });
  const found = keys(borderline, { matchTotal: 1.5, firstHalfTotal: 1.5 });
  assert.ok(!found.includes('match-over-1_5'));
});

test('market directions and activity observations are grouped separately', () => {
  const candidates = makeAnalysisCandidates(fixture(), { matchTotal: 2.5, firstHalfTotal: 1.5 });
  assert.ok(candidates.some((candidate) => candidate.key.startsWith('next-goal-') && candidate.group === 'market'));
  assert.ok(candidates.some((candidate) => candidate.key === 'total-goals' && candidate.group === 'activity'));
});

test('fresh live odds add fair-price, edge, and EV evidence without erasing model direction', () => {
  const now = Date.now();
  const makeOdds = (over, under) => OddsEngine.parseSnapshot({
    markets: [{
      marketId: 'total-goals-2.5', bookmakerId: 'bookmaker-test', eventId: 'event-test',
      isLive: true, marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
      choices: [{ id: 'over-2.5', name: 'Over 2.5', decimalValue: over }, { id: 'under-2.5', name: 'Under 2.5', decimalValue: under }],
    }],
  }, { eventLive: true, observedAt: now });

  const confirmed = makeAnalysisCandidates(fixture({ liveOdds: makeOdds(1.4, 3.2), analysisNowMs: now }))
    .find((candidate) => candidate.key === 'match-over-2_5');
  assert.ok(confirmed?.oddsEvidence?.verified);
  assert.ok(Number.isFinite(confirmed.oddsEvidence.modelFairOdds));
  assert.ok(Number.isFinite(confirmed.oddsEvidence.impliedProbability));
  assert.ok(Number.isFinite(confirmed.oddsEvidence.edge));
  assert.ok(Number.isFinite(confirmed.oddsEvidence.expectedValue));

  const opposed = makeAnalysisCandidates(fixture({ liveOdds: makeOdds(3.7, 1.25), analysisNowMs: now }))
    .find((candidate) => candidate.key === 'match-over-2_5');
  assert.ok(opposed, 'the model direction remains visible alongside opposing market evidence');
  assert.ok(opposed.oddsEvidence.edge > 0, 'the model-market disagreement is exposed as a positive edge');
  assert.ok(opposed.oddsEvidence.expectedValue > 0);
  assert.equal(opposed.valueEligible, true);
});

test('recent big chances add pressure and red cards adjust remaining xG by team', () => {
  const chancePressure = fixture({
    changes: { shots: [0, 0], sot: [0, 0], xg: [0, 0], corners: [0, 0], bigChances: [3, 0] },
    totalShots: 0, totalSot: 0, totalXg: 0, totalBigChances: 3,
  });
  assert.ok(keys(chancePressure).includes('next-goal-home'));

  const level = remainingXg(fixture(), 94);
  const redCard = remainingXg(fixture({ redCards: [1, 0] }), 94);
  assert.ok(redCard[0] < level[0]);
  assert.ok(redCard[1] > level[1]);
  assert.deepEqual(remainingXg(fixture({ redCards: [-2, 0] }), 94), level);
});

test('next-goal pressure is normalized to a five-minute window', () => {
  const fiveMinutes = fixture({
    elapsedMs: 300_000,
    changes: { shots: [4, 0], sot: [2, 0], corners: [0, 0], xg: [0.3, 0] },
  });
  const threeMinutes = fixture({
    elapsedMs: 180_000,
    changes: { shots: [2.4, 0], sot: [1.2, 0], corners: [0, 0], xg: [0.18, 0] },
  });
  assert.ok(keys(fiveMinutes).includes('next-goal-home'));
  assert.ok(keys(threeMinutes).includes('next-goal-home'));
});

test('xG markets stay unavailable without xG while shot-pressure markets remain usable', () => {
  const noXg = fixture({
    changes: { xg: null },
    cumulativeXg: null,
  });
  const found = keys(noXg, { matchTotal: 2.5, firstHalfTotal: 1.5 });
  assert.ok(found.includes('next-goal-home'));
  assert.ok(!found.some((key) => /^(match|half)-(over|under)|^(half-)?btts-/.test(key)));
});

test('unknown score is not silently treated as 0-0 for totals or BTTS', () => {
  const unknownScore = fixture({ score: [null, null] });
  const found = keys(unknownScore, { matchTotal: 2.5, firstHalfTotal: 1.5 });
  assert.ok(found.includes('next-goal-home'));
  assert.ok(found.includes('rest-result-home'));
  assert.ok(!found.some((key) => /^(match|half)-(over|under)|^(half-)?btts-/.test(key)));
});

test('non-ready data never generates signals', () => {
  assert.deepEqual(makeAnalysisCandidates({ status: 'stale' }), []);
});

test('xG horizon is not extrapolated after the fixed match cutoff', () => {
  assert.equal(remainingXg(fixture({ minute: 94 }), 94), null);
});

test('every generated market key has a confirmation slot', () => {
  const firstHalf = fixture({
    phase: '1Y', minute: 38, score: [0, 0],
    changes: { shots: [5, 3], sot: [2, 1], xg: [0.45, 0.35] },
    cumulativeXg: [1.8, 1.2], totalShots: 8, totalSot: 3, totalXg: 0.8,
  });
  const candidates = [
    ...makeAnalysisCandidates(fixture(), { matchTotal: 2.5, firstHalfTotal: 1.5 }),
    ...makeAnalysisCandidates(firstHalf, { matchTotal: 2.5, firstHalfTotal: 0.5 }),
  ];
  const confirmationSlots = new Set(ANALYSIS_TYPES);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => confirmationSlots.has(candidate.key)));
});

test('renderer loads the pure engine before analysis and exposes both line selectors', () => {
  const html = readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  assert.ok(html.indexOf('js/odds-engine.js') < html.indexOf('js/analysis-engine.js'));
  assert.ok(html.indexOf('js/analysis-engine.js') < html.indexOf('js/analysis.js'));
  assert.match(html, /id="analysisMatchLine"/);
  assert.match(html, /id="analysisHalfLine"/);
  assert.match(html, /aria-live="polite"/);
  const renderer = readFileSync(path.join(__dirname, '../src/js/analysis.js'), 'utf8');
  assert.match(renderer, /Bahis market yönleri/);
  assert.match(renderer, /Maç içi aktivite/);
  const css = readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
  assert.match(css, /\.analysis-quality/);
  assert.match(css, /\.analysis-regime/);
  assert.match(css, /\.signal-confidence/);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const selectorSources = ['app.js', 'js/analysis.js'].map((file) =>
    readFileSync(path.join(__dirname, '../src', file), 'utf8'));
  const selectors = selectorSources.flatMap((source) =>
    [...source.matchAll(/\$\('#([\w-]+)'/g)].map((match) => match[1]));
  assert.ok(selectors.length > 0);
  assert.ok(selectors.every((id) => ids.includes(id)), 'renderer selectors must resolve to static UI IDs');
});
