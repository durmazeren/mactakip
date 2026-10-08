'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Backtest = require('../src/js/backtest-engine.js');

function row(matchId, timestamp, probability, outcome, selected, extra = {}) {
  return { matchId, timestamp, marketKey: 'match/over/2.5', probability, outcome, selected, ...extra };
}

test('reports classification, proper scoring, calibration, latency, and price-aware ROI separately', () => {
  const report = Backtest.metrics([
    row('m1', 1, 0.9, true, true, { price: 2, oddsAgeMs: 2_000, signalLatencyMs: 450, dataAgeMs: 300 }),
    row('m2', 2, 0.8, false, true, { price: 2, oddsAgeMs: 16_000, signalLatencyMs: 650, dataAgeMs: 500 }),
    row('m3', 3, 0.2, true, false),
    row('m4', 4, 0.1, false, false),
  ]);
  assert.deepEqual(report.confusion, { truePositive: 1, falsePositive: 1, falseNegative: 1, trueNegative: 1 });
  assert.equal(report.precision, 0.5);
  assert.equal(report.recall, 0.5);
  assert.ok(Math.abs(report.brierScore - 0.325) < 1e-12);
  assert.equal(report.rocAuc, 0.75);
  assert.equal(report.odds.selectedWithPrice, 2);
  assert.equal(report.odds.freshWithin10s, 1);
  assert.equal(report.odds.unitStakeYield, 0);
  assert.equal(report.latencyMs.p95, 650);
  assert.ok(report.calibration.expectedCalibrationError >= 0);
  assert.equal(report.selectedHitRateWilson95.length, 2);
});

test('per-market isotonic PAVA merges duplicate probability knots and enforces monotonic calibration', () => {
  const training = [
    row('train-1', 1, 0.1, false, false, { resolvedAt: 10 }),
    row('train-2', 2, 0.4, false, false, { resolvedAt: 10 }),
    row('train-3', 3, 0.5, true, false, { resolvedAt: 10 }),
    row('train-4', 4, 0.5, false, false, { resolvedAt: 10 }),
    row('train-5', 5, 0.6, true, false, { resolvedAt: 10 }),
    row('train-6', 6, 0.9, true, false, { resolvedAt: 10 }),
  ];
  const fitted = Backtest.fitIsotonicByMarket(training, { minimumSamples: 6, minimumMatches: 6 });
  const knots = fitted.markets['match/over/2.5'].knots;
  assert.equal(knots.filter((knot) => knot.maxProbability === 0.5).length, 1);
  assert.ok(Math.abs(Backtest.applyIsotonic(fitted, 'match/over/2.5', 0.5) - 0.5) < 1e-12);
  for (let index = 1; index < knots.length; index++) {
    assert.ok(knots[index - 1].probability <= knots[index].probability);
  }
});

test('calibration evaluation requires chronological match-disjoint holdout data', () => {
  const calibrationTraining = Array.from({ length: 6 }, (_, index) =>
    row(`train-match-${index + 1}`, index + 1, index / 10, index % 2 === 0, false, { resolvedAt: 100 }));
  const evaluation = [row('test-match', 200, 0.6, true, true, { price: 1.8, oddsAgeMs: 3_000 })];
  const report = Backtest.evaluateDataset({ schemaVersion: 1, calibrationTraining, evaluation }, { minimumSamples: 5, minimumMatches: 5 });
  assert.equal(report.modelCalibration.method, 'per-market-isotonic-pava');
  assert.equal(report.calibratedCoverage, 1);
  assert.ok(report.calibrated);

  assert.throws(() => Backtest.evaluateDataset({
    schemaVersion: 1,
    calibrationTraining,
    evaluation: [row('train-match-1', 200, 0.6, true, true)],
  }), /appears in both data splits/);
  assert.throws(() => Backtest.evaluateDataset({
    schemaVersion: 1,
    calibrationTraining: [row('late-training', 1, 0.6, true, false, { resolvedAt: 300 })],
    evaluation,
  }, { minimumSamples: 2 }), /every training outcome must be resolved before the evaluation period/);
});

test('rejects duplicate opportunities and malformed probabilities rather than silently biasing reports', () => {
  const duplicate = [row('m1', 1, 0.5, true, true), row('m1', 1, 0.5, true, true)];
  assert.throws(() => Backtest.metrics(duplicate), /Duplicate match\/market\/timestamp/);
  assert.throws(() => Backtest.metrics([row('m1', 1, 1.1, true, true)]), /probability must be between/);
  assert.throws(() => Backtest.metrics([{ ...row('m1', 1, 0.5, true, true), selected: undefined }]), /selected flag/);
});
