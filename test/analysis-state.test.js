'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const LiveAnalysisState = require('../src/js/analysis-state.js');

function liveEvent(overrides = {}) {
  return {
    id: 100,
    status: { type: 'inprogress', code: 7 },
    homeTeam: { id: 1, name: 'Home' },
    awayTeam: { id: 2, name: 'Away' },
    homeScore: { current: 1 },
    awayScore: { current: 0 },
    startTimestamp: 1_800_000_000,
    time: { currentPeriodStartTimestamp: 1_800_001_000 },
    ...overrides,
  };
}

test('API outcomes keep failed, not-found, partial, empty, mismatched, and complete distinct', () => {
  assert.equal(LiveAnalysisState.classifyApiResponse(undefined, 'event', 100).kind, 'failed');
  assert.equal(LiveAnalysisState.classifyApiResponse(null, 'event', 100).kind, 'not-found');
  assert.equal(LiveAnalysisState.classifyApiResponse({ event: { id: 101 } }, 'event', 100).kind, 'mismatch');
  assert.equal(LiveAnalysisState.classifyApiResponse({ event: { id: 100 } }, 'event', 100).kind, 'partial');
  assert.equal(LiveAnalysisState.classifyApiResponse({ statistics: [] }, 'statistics', 100).kind, 'empty');
  assert.equal(LiveAnalysisState.classifyApiResponse({ statistics: [{ period: '1ST', groups: [] }] }, 'statistics', 100).kind, 'partial');

  const completeEvent = LiveAnalysisState.classifyApiResponse({ event: liveEvent() }, 'event', 100);
  const completeStats = LiveAnalysisState.classifyApiResponse({ statistics: [{
    period: 'ALL', groups: [{ statisticsItems: [{ key: 'shotsOnGoal' }] }],
  }] }, 'statistics', 100);
  assert.equal(completeEvent.kind, 'complete');
  assert.equal(completeStats.kind, 'complete');
  assert.equal(LiveAnalysisState.classifyApiResponse({ kind: 'failed' }, 'statistics', 100).kind, 'failed');
  assert.equal(LiveAnalysisState.classifyApiResponse({ kind: 'not-found' }, 'statistics', 100).kind, 'not-found');
  assert.equal(LiveAnalysisState.classifyOddsResponse({ markets: [] }).kind, 'empty');
  assert.equal(LiveAnalysisState.classifyOddsResponse({ odds: {} }).kind, 'partial');
  assert.equal(LiveAnalysisState.classifyOddsResponse({ markets: [{ marketName: 'BTTS' }] }).kind, 'complete');
});

test('poll integration rejects stale revisions and only records complete event/stat responses', () => {
  const app = readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /LiveAnalysisState\.classifyApiResponse\(packet, endpoint, id\)/);
  assert.match(app, /eventResponse\.validationResult/);
  assert.match(app, /statsResponse\.validationResult/);
  assert.match(app, /state\.pollRevision\.get\(id\) !== revision/);
  assert.match(app, /eventResult\.kind === 'complete' && statsResult\.kind === 'complete'/);
  assert.match(app, /previousIdentity !== nextIdentity/);
  assert.match(app, /LiveAnalysisState\.classifyOddsResponse\(packet\)/);
});

test('provider period clock computes live minute, announced added time, and extra-time periods', () => {
  const now = 1_800_001_000_000 + 46 * 60_000;
  const firstHalf = liveEvent({
    status: { type: 'inprogress', code: 6 },
    time: { currentPeriodStartTimestamp: 1_800_001_000, injuryTime1: 5 },
  });
  const firstClock = LiveAnalysisState.matchClock(firstHalf, now);
  assert.equal(firstClock.minute, 47);
  assert.equal(firstClock.endMinute, 50);
  assert.equal(firstClock.matchEndMinute, 90);
  assert.equal(firstClock.inStoppage, true);
  assert.equal(firstClock.stoppageKnown, true);

  const extraTime = liveEvent({
    status: { type: 'inprogress', code: 42 },
    time: { currentPeriodStartTimestamp: 1_800_001_000 },
  });
  const extraClock = LiveAnalysisState.matchClock(extraTime, now);
  assert.equal(extraClock.phase, 'UZ2');
  assert.equal(extraClock.endMinute, 120);
  assert.equal(LiveAnalysisState.matchClock(liveEvent({ time: {} }), now).known, false);

  const providerEnd = LiveAnalysisState.matchClock(liveEvent({
    status: { type: 'inprogress', code: 6 },
    time: { currentPeriodStartTimestamp: 1_800_001_000, currentPeriodEndTimestamp: 1_800_001_000 + 48 * 60 },
  }), now);
  assert.equal(providerEnd.endMinute, 48);
  assert.equal(providerEnd.endSource, 'provider-period-end');
});

test('match continuity resets on event identity, period, score, clock, and counter resets', () => {
  const previous = {
    identity: '100|1|2|league|1800000000', phase: '2Y', minute: 70, score: [1, 0],
    stats: { xg: [1.2, 0.3], shots: [7, 2] },
  };
  const frame = { ...previous, stats: { xg: [1.3, 0.3], shots: [8, 2] } };
  assert.equal(LiveAnalysisState.resetReason(previous, frame), null);
  assert.equal(LiveAnalysisState.resetReason(previous, { ...frame, identity: 'other' }), 'event-identity');
  assert.equal(LiveAnalysisState.resetReason(previous, { ...frame, phase: 'UZ1' }), 'phase-change');
  assert.equal(LiveAnalysisState.resetReason(previous, { ...frame, score: [2, 0] }), 'score-change');
  assert.equal(LiveAnalysisState.resetReason(previous, { ...frame, minute: 68 }), 'clock-regression');
  assert.equal(LiveAnalysisState.resetReason(previous, { ...frame, stats: { xg: [1.1, 0.3] } }), 'counter-reset:xg');
});

test('weighted rolling xG rate gives newer intervals more weight and rejects counter regressions', () => {
  const samples = [
    { at: 0, stats: { xg: [0, 0] } },
    { at: 60_000, stats: { xg: [0.1, 0] } },
    { at: 120_000, stats: { xg: [0.3, 0] } },
  ];
  const weighted = LiveAnalysisState.weightedPairRate(samples, 'xg', 120_000, 300_000, 60_000);
  assert.ok(weighted[0] > 0.15);
  assert.equal(weighted[1], 0);

  const reset = [...samples, { at: 180_000, stats: { xg: [0.05, 0] } }];
  assert.ok(LiveAnalysisState.weightedPairRate(reset, 'xg', 180_000, 300_000, 60_000)[0] >= 0);
});

test('match identity includes participants and event time to prevent reused-id leakage', () => {
  const current = liveEvent();
  const swapped = liveEvent({ homeTeam: { id: 2, name: 'Away' }, awayTeam: { id: 1, name: 'Home' } });
  assert.notEqual(
    LiveAnalysisState.matchIdentity(current, 100),
    LiveAnalysisState.matchIdentity(swapped, 100),
  );
});

test('HTML IDs are unique and the renderer includes the live-analysis controls exactly once', () => {
  const html = readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate id attributes must not be shipped');
  for (const id of ['analysisView', 'analysisMatchLine', 'analysisHalfLine', 'analysisSummary', 'analysisList']) {
    assert.equal(ids.filter((value) => value === id).length, 1, `#${id} should exist once`);
  }
  assert.ok(html.indexOf('js/analysis-state.js') < html.indexOf('js/analysis.js'));

  const analysis = readFileSync(path.join(__dirname, '../src/js/analysis.js'), 'utf8');
  assert.match(analysis, /analysis-quality/);
  assert.match(analysis, /signal-confidence/);
  assert.match(analysis, /api-failed/);
  assert.match(analysis, /api-partial/);
});
