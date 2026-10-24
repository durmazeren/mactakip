'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSofaClient, DEFAULT_LIMITS } = require('../src/sofa-client');

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fakeClock() {
  let time = 1_000_000, serial = 0;
  const tasks = new Map();
  return {
    now: () => time,
    schedule: (fn, delay) => { const id = ++serial; tasks.set(id, { fn, at: time + delay }); return id; },
    cancel: (id) => tasks.delete(id),
    async advance(ms) {
      await flush();
      const end = time + ms;
      let count = 0;
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        assert.ok(count++ < 10_000, 'scheduler must make progress');
        tasks.delete(next[0]); time = next[1].at; next[1].fn();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

test('120 queued requests respect real production pacing and every rolling minute', async () => {
  const clock = fakeClock(), times = [];
  const client = createSofaClient({ ...clock, fetch: async () => { times.push(clock.now()); return json({ ok: true }); } });
  const work = Promise.all(Array.from({ length: 120 }, (_, id) => client.get(`event/${id + 1}`)));
  await clock.advance(240_000);
  assert.equal((await work).length, 120);
  for (let i = 0; i < times.length; i++) {
    if (i) assert.ok(times[i] - times[i - 1] >= DEFAULT_LIMITS.minIntervalMs);
    assert.ok(times.filter((t) => t > times[i] - 60_000 && t <= times[i]).length <= DEFAULT_LIMITS.maxPerMinute);
  }
  assert.equal(client.diagnostics().queued, 0);
  assert.equal(client.diagnostics().active, 0);
});

test('a slow response prevents a second in-flight provider request', async () => {
  const clock = fakeClock();
  let finish, calls = 0;
  const client = createSofaClient({ ...clock, fetch: () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(json({}));
  } });
  const first = client.get('event/1'), second = client.get('event/2');
  await clock.advance(10_000);
  assert.equal(calls, 1);
  finish(json({}));
  await flush();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test('one 403 immediately rejects the entire bulk queue; no delayed retries survive', async () => {
  const clock = fakeClock(); let calls = 0;
  const client = createSofaClient({ ...clock, fetch: async () => { calls++; return json({}, 403); } });
  const work = Promise.allSettled(Array.from({ length: 100 }, (_, id) => client.get(`event/${id + 1}`)));
  await clock.advance(600_000);
  assert.ok((await work).every((r) => r.status === 'rejected' && r.reason.code === 'SOFA_BLOCKED'));
  assert.equal(calls, 1);
  assert.equal(client.diagnostics().queued, 0);
});

test('a foreground selection goes ahead of queued background matches', async () => {
  const clock = fakeClock(), order = [];
  const client = createSofaClient({ ...clock, fetch: async (url) => { order.push(url.split('/').pop()); return json({}); } });
  const work = [client.get('event/1'), client.get('event/2', { priority: 'background' }),
    client.get('event/3', { priority: 'background' }), client.get('event/4', { priority: 'interactive' })];
  await clock.advance(10_000); await Promise.all(work);
  assert.deepEqual(order, ['1', '4', '2', '3']);
});

test('an old background request is not starved by new foreground selections', async () => {
  const clock = fakeClock(), order = [];
  const client = createSofaClient({ ...clock, limits: { maxPerMinute: 1 }, fetch: async (url) => {
    order.push(url.split('/').pop()); return json({});
  } });
  await client.get('event/1');
  const old = client.get('event/2', { priority: 'background' });
  const first = client.get('event/3', { priority: 'interactive' });
  await clock.advance(60_000); await first;
  const newer = client.get('event/4', { priority: 'interactive' });
  await clock.advance(60_000); await old;
  assert.deepEqual(order, ['1', '3', '2']);
  await clock.advance(60_000); await newer;
});

test('a persisted 403 survives restart until a successful manual check', async () => {
  const clock = fakeClock(); let saved, calls = 0;
  const before = createSofaClient({ ...clock, onState: s => { saved = JSON.parse(JSON.stringify(s)); }, fetch: async () => json({}, 403) });
  await assert.rejects(before.get('event/1'));
  const after = createSofaClient({ ...clock, initialState: saved, fetch: async () => { calls++; return json({}); } });
  await assert.rejects(after.get('event/2'), { code: 'SOFA_BLOCKED' });
  assert.equal(calls, 0);
  assert.equal((await after.retry()).state, 'connected');
  assert.equal(calls, 1);
});

test('a persisted 429 preserves the full Retry-After after restart', async () => {
  const clock = fakeClock(); let saved, calls = 0;
  const before = createSofaClient({ ...clock, onState: s => { saved = s; }, fetch: async () => json({}, 429, { 'retry-after': '600' }) });
  await assert.rejects(before.get('event/1'));
  const after = createSofaClient({ ...clock, initialState: saved, fetch: async () => { calls++; return json({}); } });
  await clock.advance(599_999);
  assert.equal((await after.retry()).status, 429);
  assert.equal(calls, 0);
  await clock.advance(1);
  assert.equal((await after.retry()).state, 'connected');
  assert.equal(calls, 1);
});

test('timestamp variants and simultaneous manual refreshes coalesce into one request', async () => {
  const clock = fakeClock(); let calls = 0;
  const client = createSofaClient({ ...clock, fetch: async () => { calls++; return json({ statistics: [] }); } });
  const work = [client.get('event/1/statistics?_=100', { fresh: true }), client.get('event/1/statistics?_=101', { fresh: true })];
  await Promise.all(work);
  assert.equal(calls, 1);
  await client.get('event/1/statistics');
  assert.equal(calls, 1);
});

test('missing statistics are cached briefly without an automatic second request', async () => {
  const clock = fakeClock(); let calls = 0;
  const client = createSofaClient({ ...clock, fetch: async () => { calls++; return json({}, 404); } });
  assert.equal(await client.get('event/1/statistics'), null);
  await clock.advance(29_999);
  assert.equal(await client.get('event/1/statistics'), null);
  assert.equal(calls, 1);
  await clock.advance(1);
  assert.equal(await client.get('event/1/statistics'), null);
  assert.equal(calls, 2);
});

test('bounded queues reject excess demand without starting extra requests', async () => {
  const clock = fakeClock(); let finish, calls = 0;
  const client = createSofaClient({ ...clock, limits: { maxQueue: 2 }, fetch: async () => {
    calls++; if (calls === 1) return new Promise(resolve => { finish = resolve; }); return json({});
  } });
  const work = [client.get('event/1'), client.get('event/2'), client.get('event/3')];
  await assert.rejects(client.get('event/4'), { code: 'SOFA_BUSY' });
  assert.equal(calls, 1);
  finish(json({})); await clock.advance(5000); await Promise.all(work);
});
