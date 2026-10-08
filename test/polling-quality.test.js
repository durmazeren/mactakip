'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

global.localStorage = { getItem: () => null, setItem: () => {} };
const PollingQuality = require('../src/js/core.js');
delete global.localStorage;

test('request capture uses injected clock and keeps 404, success, and transport failure distinct', async () => {
  let now = 10_000;
  const clock = () => now;
  const success = await PollingQuality.captureRequest(async (route) => {
    assert.equal(route, 'event/77');
    now += 23;
    return { event: { id: 77 } };
  }, 'event/77', clock);
  assert.deepEqual([success.kind, success.requestStartedAt, success.receivedAt, success.latencyMs], ['success', 10_000, 10_023, 23]);

  const notFound = await PollingQuality.captureRequest(async () => null, '/missing', clock);
  assert.equal(notFound.kind, 'not-found');
  const failed = await PollingQuality.captureRequest(async () => { throw new Error('Sofascore 429'); }, 'limited', clock);
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.errorClass, 'rate-limit');
  assert.equal(failed.httpStatus, 429);
});

test('transport error classes separate rate limit, server, HTTP, network, and timeout failures', () => {
  assert.deepEqual(PollingQuality.classifyRequestError(new Error('Sofascore 429')), { key: 'rate-limit', status: 429 });
  assert.deepEqual(PollingQuality.classifyRequestError(new Error('Sofascore 503')), { key: 'server', status: 503 });
  assert.deepEqual(PollingQuality.classifyRequestError(new Error('Sofascore 403')), { key: 'http', status: 403 });
  assert.deepEqual(PollingQuality.classifyRequestError(new TypeError('fetch failed')), { key: 'network', status: null });
  assert.deepEqual(PollingQuality.classifyRequestError(Object.assign(new Error('request failed'), { name: 'AbortError' })), { key: 'timeout', status: null });
});

test('hung request becomes an explicit timeout packet', async () => {
  const result = await PollingQuality.captureRequest(() => new Promise(() => {}), 'hung', Date.now, 5);
  assert.equal(result.kind, 'failed');
  assert.equal(result.errorClass, 'timeout');
  assert.match(result.error.message, /timed out/i);
});

test('capture records dispatch queue wait separately from request latency', async () => {
  let now = 5_000;
  const packet = await PollingQuality.captureRequest(async (_route, { onStart }) => {
    onStart(5_200, { queueWaitMs: 200 });
    now = 5_225;
    return { ok: true };
  }, 'event/8', () => now);
  assert.equal(packet.requestQueuedAt, 5_000);
  assert.equal(packet.requestStartedAt, 5_200);
  assert.equal(packet.queueWaitMs, 200);
  assert.equal(packet.latencyMs, 25);
  assert.equal(packet.elapsedMs, 225);
});

test('network limiter enforces a global bound and dispatches queued work FIFO', async () => {
  const gate = PollingQuality.createRequestLimiter(2);
  let active = 0;
  let maximum = 0;
  const started = [];
  const releases = [];
  const task = (name) => gate.run(async () => {
    active++;
    maximum = Math.max(maximum, active);
    started.push(name);
    await new Promise((resolve) => releases.push(resolve));
    active--;
  });
  const first = task('a');
  const second = task('b');
  const third = task('c');
  assert.deepEqual(started, ['a', 'b']);
  assert.deepEqual(gate.snapshot(), { active: 2, queued: 1, limit: 2 });
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b', 'c']);
  releases.shift()();
  releases.shift()();
  await Promise.all([first, second, third]);
  assert.equal(maximum, 2);
});

test('stable fingerprints ignore object key ordering and detect meaningful payload changes', () => {
  assert.equal(PollingQuality.fingerprint({ event: { id: 7, score: 1 }, status: 'live' }),
    PollingQuality.fingerprint({ status: 'live', event: { score: 1, id: 7 } }));
  assert.notEqual(PollingQuality.fingerprint({ odds: 1.8 }), PollingQuality.fingerprint({ odds: 1.7 }));
});

test('semantic field fingerprints identify event, statistics, and market changes without exposing values', () => {
  const statsBefore = { statistics: [{ period: 'ALL', groups: [{ statisticsItems: [
    { key: 'totalShotsOnGoal', homeValue: 4, awayValue: 1 },
  ] }] }] };
  const statsAfter = { statistics: [{ period: 'ALL', groups: [{ statisticsItems: [
    { key: 'totalShotsOnGoal', homeValue: 5, awayValue: 1 },
  ] }] }] };
  const statsDiff = PollingQuality.changedFieldPaths(
    PollingQuality.fieldFingerprints(statsBefore, 'statistics'),
    PollingQuality.fieldFingerprints(statsAfter, 'statistics'),
  );
  assert.ok(statsDiff.some((field) => field.includes('homeValue')));
  assert.ok(!statsDiff.some((field) => field.includes('4') || field.includes('5')));

  const oddsBefore = { markets: [{ marketName: 'Total Goals', marketId: 99, choices: [
    { name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 2.5', decimalValue: 2.0 },
  ] }] };
  const oddsAfter = { markets: [{ marketName: 'Total Goals', marketId: 99, choices: [
    { name: 'Over 2.5', decimalValue: 1.7 }, { name: 'Under 2.5', decimalValue: 2.1 },
  ] }] };
  const oddsDiff = PollingQuality.changedFieldPaths(
    PollingQuality.fieldFingerprints(oddsBefore, 'odds'),
    PollingQuality.fieldFingerprints(oddsAfter, 'odds'),
  );
  assert.equal(oddsDiff.length, 2);
  assert.ok(oddsDiff.every((field) => field.includes('decimalValue')));
});

test('feed observations distinguish provider timestamp age, receive age, and unchanged-data age', () => {
  const epoch = 1_800_000_000_000;
  const firstPacket = {
    kind: 'success', requestStartedAt: epoch - 1_000, receivedAt: epoch, latencyMs: 1_000,
    value: { updatedAt: epoch - 500, score: [0, 0] },
  };
  const first = PollingQuality.observe(null, firstPacket, 'complete', epoch);
  assert.equal(first.sourceUpdatedAt, epoch - 500);
  assert.equal(first.sourceAgeMs, 500);
  assert.equal(first.receivedAgeMs, 0);
  assert.equal(first.changed, true);
  assert.equal(first.unchangedCount, 0);
  assert.deepEqual(first.changedFields, ['score[0]', 'score[1]']);

  const second = PollingQuality.observe(first, {
    ...firstPacket, requestStartedAt: epoch + 9_000, receivedAt: epoch + 10_000,
  }, 'complete', epoch + 10_000);
  assert.equal(second.changed, false);
  assert.equal(second.unchangedCount, 1);
  assert.equal(second.lastChangedAt, epoch);
  assert.equal(second.lastSuccessAt, epoch + 10_000);
  assert.deepEqual(second.changedFields, []);
  assert.equal(second.dataAgeMs, 10_500, 'provider timestamp age is current time minus source timestamp');

  const unknownSourceClock = PollingQuality.observe(null, {
    kind: 'success', receivedAt: epoch + 15_000, value: { score: [1, 0] },
  }, 'complete', epoch + 15_000);
  assert.equal(unknownSourceClock.sourceUpdatedAt, null);
  assert.equal(unknownSourceClock.sourceAgeMs, null, 'receive time must never be presented as provider time');
  assert.equal(unknownSourceClock.receivedAt, epoch + 15_000);
  assert.equal(unknownSourceClock.dataAgeMs, 0, 'without provider clock, data age starts at first meaningful payload');

  const frozen = PollingQuality.observe(second, {
    kind: 'success', requestStartedAt: epoch + 40_000, receivedAt: epoch + 41_000,
    value: { updatedAt: epoch + 40_900, score: [0, 0] },
  }, 'complete', epoch + 41_000, 'statistics');
  assert.equal(frozen.sourceAgeMs, 100);
  assert.equal(frozen.unchangedAgeMs, 41_000);
  assert.equal(frozen.dataAgeMs, 100, 'trusted source age remains distinct from content stability age');
  assert.equal(frozen.frozen, false, 'fresh successful payload with a recent provider timestamp remains usable');
  assert.equal(frozen.unchangedConcern, true, 'unchanged content is tracked separately from freshness');
  const aged = PollingQuality.ageRecord(frozen, epoch + 41_100);
  assert.equal(aged.receivedAgeMs, 100);
  assert.equal(aged.sourceAgeMs, 200);
  assert.equal(aged.unchangedAgeMs, 41_100);
  assert.equal(aged.frozen, false);
});

test('partial and failed responses preserve the last complete snapshot and do not refresh payload age', () => {
  const epoch = 1_800_000_000_000;
  const complete = PollingQuality.observe(null, {
    kind: 'success', receivedAt: epoch, value: { shots: [4, 2] },
  }, 'complete', epoch, 'statistics');
  const partial = PollingQuality.observe(complete, {
    kind: 'success', receivedAt: epoch + 20_000, value: { shots: [9, 9], partial: true },
  }, 'partial', epoch + 20_000, 'statistics');
  assert.equal(partial.fingerprint, complete.fingerprint);
  assert.equal(partial.payloadReceivedAt, epoch);
  assert.equal(partial.dataAgeMs, 20_000);
  assert.deepEqual(partial.changedFields, []);
  assert.equal(partial.lastValidAt, epoch);

  const failed = PollingQuality.observe(partial, {
    kind: 'failed', receivedAt: epoch + 50_000, errorClass: 'network', error: new Error('offline'),
  }, 'failed', epoch + 50_000, 'statistics');
  assert.equal(failed.fingerprint, complete.fingerprint);
  assert.equal(failed.payloadReceivedAt, epoch);
  assert.equal(failed.dataAgeMs, 50_000);
  assert.equal(failed.frozen, true, 'a failed feed becomes stale when the last complete payload ages out');
});

test('unchanged successful payloads remain usable without provider clocks; stale provider clocks freeze', () => {
  const epoch = 1_800_000_000_000;
  const first = PollingQuality.observe(null, {
    kind: 'success', receivedAt: epoch, value: { shots: [2, 1] },
  }, 'complete', epoch, 'statistics');
  const repeated = PollingQuality.observe(first, {
    kind: 'success', receivedAt: epoch + 60_000, value: { shots: [2, 1] },
  }, 'complete', epoch + 60_000, 'statistics');
  assert.equal(repeated.unchangedAgeMs, 60_000);
  assert.equal(repeated.unchangedConcern, true);
  assert.equal(repeated.dataAgeMs, 0, 'successful receipt is freshness when the provider publishes no source clock');
  assert.equal(repeated.frozen, false);

  const oldSource = PollingQuality.observe(null, {
    kind: 'success', receivedAt: epoch + 60_000,
    value: { updatedAt: epoch, shots: [2, 1] },
  }, 'complete', epoch + 60_000, 'statistics');
  assert.equal(oldSource.receivedAgeMs, 0);
  assert.equal(oldSource.sourceAgeMs, 60_000);
  assert.equal(oldSource.frozen, true, 'an explicit old provider timestamp remains a hard freshness failure');
});

test('incidents responses validate shape and priority keys dedupe critical VAR and penalty events', () => {
  assert.deepEqual(PollingQuality.classifyIncidentsResponse({ incidents: [] }, 7), { kind: 'complete', incidents: [] });
  assert.equal(PollingQuality.classifyIncidentsResponse({ incidents: null }, 7).kind, 'invalid');
  assert.equal(PollingQuality.classifyIncidentsResponse({ incidents: [{ eventId: 8 }] }, 7).kind, 'mismatch');
  const before = [{ id: 12, incidentType: 'var', time: 68 }];
  const after = [...before, { id: 13, incidentType: 'penalty', time: 71 }];
  assert.deepEqual(PollingQuality.newCriticalIncidentKeys(before, after), ['penalty:13']);
  assert.deepEqual(PollingQuality.newCriticalIncidentKeys(after, after), []);
  assert.deepEqual(PollingQuality.criticalIncidentKeys([{ id: 14, incidentType: 'card', incidentClass: 'red' }]), ['red-card:14']);
  assert.equal(PollingQuality.priorityDueAt(1234, 3500, true), 1234, 'critical event refresh is due immediately');
  assert.equal(PollingQuality.priorityDueAt(1234, 3500, false), 4734, 'follow-up refresh remains capped by its interval');
});

test('match removal settles every queued and in-flight poll waiter exactly once', async () => {
  let queuedResult;
  let activeResult;
  const queued = new Promise((resolve) => { queuedResult = resolve; });
  const active = new Promise((resolve) => { activeResult = resolve; });
  const result = { skipped: true, removed: true };
  assert.equal(PollingQuality.resolveWaiters([queuedResult], result), 1);
  assert.equal(PollingQuality.resolveWaiters([activeResult], result), 1);
  assert.deepEqual(await queued, result);
  assert.deepEqual(await active, result);
  assert.equal(PollingQuality.resolveWaiters([], result), 0);
});

test('poll observation exposes distinct receive, validation, commit, and payload-age stages', () => {
  const epoch = 1_800_000_000_000;
  const record = PollingQuality.observe(null, {
    kind: 'success', requestQueuedAt: epoch - 20, requestStartedAt: epoch - 10,
    queueWaitMs: 10, receivedAt: epoch, latencyMs: 10, elapsedMs: 20,
    value: { score: [1, 0] },
  }, 'complete', epoch, 'event', { validatedAt: epoch + 3, committedAt: epoch + 5 });
  assert.equal(record.endpoint, 'event');
  assert.equal(record.queueWaitMs, 10);
  assert.equal(record.validationLatencyMs, 3);
  assert.equal(record.commitLatencyMs, 5);
  assert.equal(record.payloadAgeMs, 0);
  assert.equal(record.dataAgeMs, 0);
});

test('source timestamps accept seconds, milliseconds, and ISO values while rejecting future clocks', () => {
  assert.equal(PollingQuality.sourceTimestamp({ updatedAt: 1_800_000_000 }, 1_800_000_100_000), 1_800_000_000_000);
  assert.equal(PollingQuality.sourceTimestamp({ updatedAt: '2027-01-15T00:00:00.000Z' }, Date.parse('2027-01-15T00:00:01Z')),
    Date.parse('2027-01-15T00:00:00.000Z'));
  assert.equal(PollingQuality.sourceTimestamp({ updatedAt: 1_900_000_000_000 }, 1_800_000_000_000), null);
});

test('endpoint scheduling adapts to quiet, active, priority, rate-limit, and server-failure states', () => {
  assert.equal(PollingQuality.nextDelay('event'), 10_000);
  assert.equal(PollingQuality.nextDelay('event', {}, { hot: true }), 5_000);
  assert.equal(PollingQuality.nextDelay('event', {}, { priority: true }), 3_500);
  assert.equal(PollingQuality.nextDelay('odds'), 10_000);
  assert.equal(PollingQuality.nextDelay('odds', {}, { hot: true }), 5_000);
  assert.equal(PollingQuality.nextDelay('odds', {}, { priority: true }), 2_000);
  assert.equal(PollingQuality.nextDelay('statistics', { unchangedCount: 4 }), 30_000);
  assert.equal(PollingQuality.nextDelay('odds', { unchangedCount: 8 }), 40_000);
  assert.equal(PollingQuality.nextDelay('event', { requestKind: 'failed', errorClass: 'rate-limit', consecutiveFailures: 1 }), 10_000);
  assert.equal(PollingQuality.nextDelay('event', { requestKind: 'failed', errorClass: 'server', consecutiveFailures: 3 }), 20_000);
  assert.equal(PollingQuality.nextDelay('event', { requestKind: 'failed', errorClass: 'timeout', consecutiveFailures: 1 }), 30_000);
  assert.equal(PollingQuality.nextDelay('statistics', { requestKind: 'not-found' }), 60_000);
  assert.equal(PollingQuality.nextDelay('event', { kind: 'partial' }), 20_000);
});

test('endpoint deadline helper is deterministic and treats missing schedule as immediately due', () => {
  assert.equal(PollingQuality.due(null, 50), true);
  assert.equal(PollingQuality.due({ nextDueAt: 100 }, 99), false);
  assert.equal(PollingQuality.due({ nextDueAt: 100 }, 100), true);
  assert.equal(PollingQuality.due({ nextDueAt: Infinity }, 1_000), false);
});

test('dispatcher ordering favors scoped priority refresh then the oldest due match', () => {
  const candidates = [
    { id: 30, priority: 0, earliest: 10 },
    { id: 20, priority: 1, earliest: 100 },
    { id: 11, priority: 0, earliest: 5 },
  ];
  assert.deepEqual(candidates.sort(PollingQuality.comparePollCandidates).map((candidate) => candidate.id), [20, 11, 30]);
});

test('scheduler aging promotes an overdue normal match so repeated priority work cannot starve it', () => {
  const oldNormal = {
    id: 3, priority: 0, effectivePriority: PollingQuality.effectivePollPriority(0, 30_000), earliest: 1,
  };
  const newPriority = {
    id: 4, priority: 1, effectivePriority: PollingQuality.effectivePollPriority(1, 0), earliest: 2,
  };
  assert.ok(PollingQuality.comparePollCandidates(oldNormal, newPriority) < 0);
});

test('app uses independent endpoint due clocks, priority reset, stale-response guard, and targeted panel telemetry', () => {
  const app = readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /endpointNamesDue\(id/);
  assert.match(app, /POLL_ENDPOINTS\.map/);
  assert.match(app, /state\.pollRevision\.get\(id\) !== revision/);
  assert.match(app, /prioritizeMatch\(id, now, \{ immediate: immediatePriority, eventKey: priorityKey \}\)/);
  assert.match(app, /event\/\$\{id\}\/incidents/);
  assert.match(app, /state\.events\.set\(id, \{ \.\.\.current, incidents: incidentsShape\.incidents \}\)/);
  assert.match(app, /cancelPollWaiters\(id/);
  assert.match(app, /activePollWaiters\.delete\(id\)/);
  assert.match(app, /pollQueue\.delete\(id\)/);
  assert.match(app, /state\.liveOdds\.delete\(id\)/);
  assert.match(app, /state\.eventIncidents\.delete\(id\)/);
  assert.match(app, /renderAnalysisMatches\(\[id\]\)/);
  assert.match(app, /feed-health-source/);
  assert.match(app, /sourceAge == null \? 'paylaşılmıyor'/);
  assert.match(app, /pollLatencyMs/);
  assert.match(app, /analysisLatencyMs/);
  assert.match(app, /!statisticsMeta\?\.frozen/);
  assert.match(app, /receiveToUiMs/);
  assert.match(app, /receiveToVisibleMs/);
  assert.match(app, /validatedAt/);
  assert.match(app, /priorityDueAt\(now, POLL_INTERVALS\[endpoint\]\.priority, immediate\)/);
  assert.match(app, /activePollJobs\.size < POLL_CONCURRENCY/);
  assert.match(app, /finally\(\(\) => \{/);
  assert.match(app, /pumpPollQueue\(\);/);
  assert.match(app, /SCHEDULER_TICK_MS/);
  assert.doesNotMatch(app, /setInterval\(pollAll, POLL_MS\)/);
  assert.doesNotMatch(app, /state\.lastOddsPoll\.set\(id/);
});
