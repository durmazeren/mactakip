'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSofaPageReadiness } = require('../src/sofa-page-readiness');

test('only successful public JSON from the visible site window marks readiness', () => {
  let listener; const calls = [];
  const observer = createSofaPageReadiness({ webRequest: { onResponseStarted: (_filter, fn) => { listener = fn; } } });
  const stop = observer.watch({ id: 7 }, value => calls.push(value));
  const sample = { webContentsId: 7, url: 'https://www.sofascore.com/api/v1/sport/football/events/live',
    statusCode: 200, responseHeaders: { 'Content-Type': ['application/json; charset=utf-8'] } };
  for (const change of [{ statusCode: 403 }, { statusCode: 429 }, { webContentsId: 8 }, { fromCache: true },
    { responseHeaders: { 'content-type': ['text/html'] } }, { url: 'https://www.sofascore.com/api/v1/config/foo' },
    { url: 'https://unrelated.example/api/v1/sport/football/events/live' }]) listener({ ...sample, ...change });
  assert.equal(calls.length, 0);
  listener(sample); assert.equal(calls.length, 1);
  stop(); listener(sample); assert.equal(calls.length, 1);
});
