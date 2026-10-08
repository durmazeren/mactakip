'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchJson } = require('../src/api-request.js');

test('feed transport returns parsed JSON and propagates bounded request options', async () => {
  let received;
  const result = await fetchJson(async (url, options) => {
    received = { url, options };
    return { status: 200, ok: true, json: async () => ({ event: { id: 42 } }) };
  }, 'https://feed.invalid/event/42', { headers: { Accept: 'application/json' } }, 500);
  assert.deepEqual(result, { event: { id: 42 } });
  assert.equal(received.url, 'https://feed.invalid/event/42');
  assert.equal(received.options.headers.Accept, 'application/json');
  assert.ok(received.options.signal instanceof AbortSignal);
  assert.equal(received.options.signal.aborted, false);
});

test('feed transport keeps not-found and HTTP failures distinct', async () => {
  assert.equal(await fetchJson(async () => ({ status: 404, ok: false }), '/missing', {}, 500), null);
  await assert.rejects(fetchJson(async () => ({ status: 429, ok: false }), '/limited', {}, 500), /Sofascore 429/);
});

test('feed transport aborts a hung request at its deadline and surfaces timeout classification', async () => {
  let signal;
  const pending = fetchJson((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), '/hung', {}, 15);
  await assert.rejects(pending, (error) => error.name === 'AbortError' && /timed out/.test(error.message));
  assert.equal(signal.aborted, true);
});
