'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSofaClient } = require('../src/sofa-client');

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

test('normal bağlantıda kuyruk tamamlanır ve aynı anda en fazla iki istek çalışır', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const client = createSofaClient({ fetch: async () => {
    calls++;
    maxActive = Math.max(maxActive, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return json({ ok: true });
  } });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => client.get(`event/${i + 1}`)));
  assert.equal(calls, 8);
  assert.equal(maxActive, 2);
  assert.ok(results.every((result) => result.ok));
  assert.equal(client.getState().state, 'connected');
});

test('bir oturumun 403 durumu diğer kullanıcının istemcisini etkilemez', async () => {
  const blocked = createSofaClient({ fetch: async () => json({}, 403) });
  const healthy = createSofaClient({ fetch: async () => json({ event: { id: 1 } }) });
  await assert.rejects(blocked.get('event/1'));
  assert.deepEqual(await healthy.get('event/1'), { event: { id: 1 } });
  assert.equal(healthy.getState().state, 'connected');
  assert.equal(blocked.getState().state, 'blocked');
});

test('geçici sunucu hatası ve olmayan maç normal bağlantıyı engellemez', async () => {
  let calls = 0;
  const client = createSofaClient({ fetch: async () => {
    const status = [503, 404, 200][calls++];
    return json({ events: [] }, status);
  } });
  await assert.rejects(client.get('event/1'), { status: 503 });
  assert.equal(await client.get('event/2'), null);
  assert.deepEqual(await client.get('sport/football/events/live'), { events: [] });
  assert.equal(calls, 3);
  assert.equal(client.getState().state, 'connected');
});

test('403 sonrası kuyruk ve sonraki otomatik istekler ağa gönderilmez', async () => {
  let calls = 0;
  let clock = 1000;
  const client = createSofaClient({ now: () => clock, fetch: async () => {
    calls++;
    return json({ error: { reason: 'challenge' } }, 403);
  } });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => client.get(`event/${i + 1}`)));
  assert.equal(calls, 2);
  assert.ok(results.every((r) => r.status === 'rejected' && r.reason.code === 'SOFA_BLOCKED'));
  assert.equal(client.getState().challenge, true);
  assert.equal(client.getState().cloudflare, false);
  clock += 10_000;
  await assert.rejects(client.get('sport/football/events/live'), { code: 'SOFA_BLOCKED' });
  assert.equal(calls, 2);
  clock += 60 * 60_000;
  await assert.rejects(client.get('event/99'), { code: 'SOFA_BLOCKED' });
  assert.equal(calls, 2, '403 sonrasında süre geçse de kullanıcı kontrolü olmadan yeniden istek yok');
});

test('aynı istek birleştirilir; canlı veri süresi geçince tekrar alınır', async () => {
  let calls = 0;
  let clock = 1000;
  const client = createSofaClient({ now: () => clock, fetch: async () => json({ calls: ++calls }) });
  const results = await Promise.all([client.get('event/10'), client.get('event/10')]);
  assert.deepEqual(results, [{ calls: 1 }, { calls: 1 }]);
  await client.get('event/10');
  assert.equal(calls, 1);
  clock += 2001;
  assert.deepEqual(await client.get('event/10'), { calls: 2 });
  await client.get('config/top-unique-tournaments/TR/football');
  clock += 60_000;
  await client.get('config/top-unique-tournaments/TR/football');
  assert.equal(calls, 3);
});

test('ağ değişimi sonrası tek kullanıcı kontrolü 403 beklemesinden çıkar', async () => {
  let calls = 0;
  const client = createSofaClient({ fetch: async () => ++calls === 1
    ? json({}, 403) : json({ events: [] }) });
  await assert.rejects(client.get('event/10'));
  const [first, second] = await Promise.all([client.retry(), client.retry()]);
  assert.equal(first.state, 'connected');
  assert.deepEqual(first, second);
  assert.equal(calls, 2);
  await client.get('event/11');
  assert.equal(calls, 3);
});

test('fikstür beş dakika saklanır; canlı skorun kısa önbelleğinden ayrıdır', async () => {
  let calls = 0;
  let clock = 1000;
  const client = createSofaClient({ now: () => clock, fetch: async () => json({ calls: ++calls }) });
  const path = 'unique-tournament/17/scheduled-events/2026-10-11';
  await client.get(path);
  clock += 60_000;
  await client.get(path);
  assert.equal(calls, 1);
  clock += 240_001;
  await client.get(path);
  assert.equal(calls, 2);
});

test('429 Retry-After süresini kullanıcı kontrolü de kısaltamaz', async () => {
  let calls = 0;
  let clock = 1000;
  const client = createSofaClient({ now: () => clock, fetch: async () => ++calls === 1
    ? json({}, 429, { 'retry-after': '600' }) : json({ events: [] }) });
  await assert.rejects(client.get('event/10'));
  assert.equal(client.getState().retryAt, 601_000);
  assert.equal((await client.retry()).status, 429);
  assert.equal(calls, 1);
  clock = 601_001;
  assert.equal((await client.retry()).state, 'connected');
  assert.equal(calls, 2);
});

test('önceden başlamış başarılı istek 403 beklemesini kaldırmaz', async () => {
  let finishSecond;
  const client = createSofaClient({ fetch: (url) => url.endsWith('/event/1')
    ? Promise.resolve(json({}, 403)) : new Promise((resolve) => { finishSecond = resolve; }) });
  const first = client.get('event/1');
  const second = client.get('event/2');
  await assert.rejects(first);
  finishSecond(json({ event: { id: 2 } }));
  await second;
  assert.equal(client.getState().state, 'blocked');
});

test('Cloudflare HTML doğrulaması JSON hatasından ayırt edilir', async () => {
  const client = createSofaClient({ fetch: async () => new Response('<html>Challenge</html>', {
    status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' },
  }) });
  await assert.rejects(client.get('event/10'), { code: 'SOFA_BLOCKED' });
  assert.equal(client.getState().cloudflare, true);
});
