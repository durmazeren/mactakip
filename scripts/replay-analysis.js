'use strict';

require('../src/js/analysis-engine.js');
require('../src/js/analysis-state.js');
const { replayFrames } = require('../src/js/replay-engine.js');

const makeData = (score = [0, 0]) => ({
  status: 'ready', phase: '2Y', minute: 55, elapsedMs: 300_000,
  dataAgeMs: 500, sampleCount: 12, clock: { known: true, endMinute: 90 },
  score, names: ['Simülasyon Ev', 'Simülasyon Dep'],
  changes: { shots: [6, 1], sot: [3, 0], corners: [1, 0], xg: [0.45, 0.05] },
  cumulativeXg: [1.5, 0.3], totalShots: 7, totalSot: 3, totalCorners: 1,
  totalXg: 0.5, weightedXgRate: [0.09, 0.01], eventIdentity: 'replay-demo',
  cumulativeStats: { xg: [1.5, 0.3], shots: [14, 3], sot: [7, 1], corners: [4, 1] },
});

const base = Date.now();
const result = replayFrames([
  { matchId: 'sim-1', at: base, data: makeData() },
  { matchId: 'sim-1', at: base + 10_000, data: makeData() },
  { matchId: 'sim-1', at: base + 20_000, data: makeData([1, 0]) },
  { matchId: 'sim-1', at: base + 30_000, data: makeData([1, 0]) },
]);
console.log(JSON.stringify(result.summary, null, 2));
