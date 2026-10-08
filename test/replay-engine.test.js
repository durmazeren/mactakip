'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ReplayEngine = require('../src/js/replay-engine.js');

function data(score = [0, 0]) {
  return {
    status: 'ready', phase: '2Y', minute: 55, elapsedMs: 300_000,
    dataAgeMs: 500, sampleCount: 12, clock: { known: true, endMinute: 90 },
    score, names: ['Home', 'Away'],
    changes: { shots: [6, 1], sot: [3, 0], corners: [1, 0], xg: [0.45, 0.05] },
    cumulativeXg: [1.5, 0.3], totalShots: 7, totalSot: 3, totalCorners: 1,
    totalXg: 0.5, weightedXgRate: [0.09, 0.01], eventIdentity: 'event-home-away',
    cumulativeStats: { xg: [1.5, 0.3], shots: [14, 3], sot: [7, 1], corners: [4, 1] },
  };
}

test('replay confirmations are isolated per match and reset on score changes', () => {
  const frames = [
    { matchId: 'A', at: 1_000, data: data() },
    { matchId: 'B', at: 2_000, data: data() },
    { matchId: 'A', at: 11_000, data: data() },
    { matchId: 'A', at: 21_000, data: data([1, 0]) },
    { matchId: 'A', at: 31_000, data: data([1, 0]) },
    { matchId: 'B', at: 12_000, data: data() },
  ];
  const result = ReplayEngine.replayFrames(frames);
  const nextGoal = result.emissions.filter((entry) => entry.candidate.key === 'next-goal-home');
  assert.deepEqual(nextGoal.map((entry) => entry.matchId), ['A', 'A', 'B']);
  assert.equal(nextGoal[1].at, 31_000, 'the score-change frame starts a fresh confirmation window');
  assert.equal(result.summary.resets['score-change'], 1);
  assert.equal(result.summary.matches, 2);
});

test('replay ignores out-of-order frames and isolates event identities', () => {
  const first = data();
  const replacement = { ...data(), eventIdentity: 'another-event' };
  const replay = ReplayEngine.replayFrames([
    { id: 8, at: 10_000, data: first },
    { id: 8, at: 9_000, data: first },
    { id: 8, at: 20_000, data: replacement },
  ]);
  assert.equal(replay.summary.ignoredOutOfOrder, 1);
  assert.equal(replay.summary.resets['event-identity'], 1);
});
