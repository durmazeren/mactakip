'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSofaDiagnostics } = require('../src/sofa-diagnostics');
const { createSofaClient } = require('../src/sofa-client');
const vm = require('node:vm');

test('tracker compatibility cannot share the API connection cookie jar', () => {
  const context = vm.createContext({ localStorage: { getItem: () => null } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/core.js'), 'utf8'), context);
  const tracker = vm.runInContext('PARTITION', context);
  const { SOFA_PARTITION } = require('../src/sofa-client');
  assert.equal(tracker, 'persist:sofa');
  assert.equal(SOFA_PARTITION, 'persist:sofa-data');
  assert.notEqual(tracker, SOFA_PARTITION);
});

test('a denial log retains recent response timing and drops headers, bodies and URL queries', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sofa-diagnostics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'diagnostics.jsonl'), log = createSofaDiagnostics(file);
  log.record({ type: 'response', status: 200, path: 'event/1?token=secret', headers: { cookie: 'secret' }, body: 'secret' });
  log.record({ type: 'denied', status: 403, path: 'event/2', reason: 'challenge' });
  const raw = fs.readFileSync(file, 'utf8'), row = JSON.parse(raw);
  assert.equal(row.recent[0].path, 'event/1');
  assert.equal(row.reason, 'challenge');
  assert.ok(!raw.includes('secret'));
});

test('provider denial retains the endpoint and reason after a successful recovery', async () => {
  let calls = 0;
  const details = [];
  const client = createSofaClient({ limits: { minIntervalMs: 0 }, onDiagnostic: d => details.push(d), fetch: async () =>
    new Response(JSON.stringify(++calls === 1 ? { error: { reason: 'challenge' } } : { events: [] }), {
      status: calls === 1 ? 403 : 200, headers: { 'content-type': 'application/json' },
    }) });
  await assert.rejects(client.get('event/1/statistics'));
  assert.equal(client.getState().lastFailure.path, 'event/1/statistics');
  await client.retry();
  assert.equal(client.getState().state, 'connected');
  assert.equal(client.getState().lastFailure.reason, 'challenge');
  assert.equal(client.getState().lastFailure.cloudflare, false);
  assert.equal(details.length, 2);
  const restarted = createSofaClient({ initialState: client.getState(), fetch: () => assert.fail('read-only restore') });
  assert.equal(restarted.getState().lastFailure.reason, 'challenge');
});

test('logging failure cannot break ordinary provider responses', async () => {
  const client = createSofaClient({ onDiagnostic: () => { throw new Error('disk unavailable'); },
    fetch: async () => new Response('{"event":{"id":1}}') });
  assert.equal((await client.get('event/1')).event.id, 1);
});
