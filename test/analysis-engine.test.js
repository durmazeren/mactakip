'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  ANALYSIS_TYPES, makeAnalysisCandidates, remainingXg, remainingXgScenarios, scenarioBand, poissonOutcomes,
} = require('../src/js/analysis-engine.js');

function fixture(overrides = {}) {
  const data = {
    status: 'ready',
    phase: '2Y',
    minute: 55,
    elapsedMs: 300_000,
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
  assert.ok(html.indexOf('js/analysis-engine.js') < html.indexOf('js/analysis.js'));
  assert.match(html, /id="analysisMatchLine"/);
  assert.match(html, /id="analysisHalfLine"/);
  assert.match(html, /aria-live="polite"/);
  const renderer = readFileSync(path.join(__dirname, '../src/js/analysis.js'), 'utf8');
  assert.match(renderer, /Bahis market yönleri/);
  assert.match(renderer, /Maç içi aktivite/);
});
