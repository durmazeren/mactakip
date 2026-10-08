'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Diagnostic = require('../src/js/live-feed-diagnostic.js');

test('live probe extracts per-team xG, shots, SOT, corners, big chances, and red cards', () => {
  const payload = { statistics: [{ period: 'ALL', groups: [{ statisticsItems: [
    { key: 'totalShotsOnGoal', homeValue: 12, awayValue: 8 },
    { key: 'shotsOnGoal', homeValue: 4, awayValue: 2 },
    { key: 'expectedGoals', homeValue: '1.22', awayValue: '0,73' },
    { key: 'cornerKicks', homeValue: 6, awayValue: 3 },
    { key: 'bigChanceCreated', homeValue: 2, awayValue: 1 },
    { key: 'redCards', homeValue: 1, awayValue: 0 },
  ] }] }] };
  const summary = Diagnostic.summarizeStatistics(payload);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.present, ['shots', 'sot', 'xg', 'corners', 'bigChances', 'redCards']);
  assert.deepEqual(summary.fields.xg, [1.22, 0.73]);
  assert.deepEqual(summary.fields.corners, [6, 3]);
});

test('malformed/partial statistics stay incomplete and never invent zero values', () => {
  assert.equal(Diagnostic.summarizeStatistics({ statistics: [] }).complete, false);
  const summary = Diagnostic.summarizeStatistics({ statistics: [{ period: 'ALL', groups: [] }] });
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.present, []);
  assert.deepEqual(summary.fields.xg, null);
});

test('latency summary handles sparse samples and computes nearest-rank p50/p95', () => {
  assert.deepEqual(Diagnostic.latencySummary([]), { count: 0, p50: null, p95: null, max: null });
  assert.deepEqual(Diagnostic.latencySummary([30, 10, 20, null]), { count: 3, p50: 20, p95: 30, max: 30 });
});
