'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openRecoverySite } = require('../src/sofa-site-visit');

function harness({ created = true, loaded = Promise.resolve() } = {}) {
  const page = new EventEmitter(), timers = new Map(); let serial = 0, closes = 0, focuses = 0;
  let ready, unwatches = 0;
  page.getTitle = () => 'Football Live Scores | Sofascore';
  page.getURL = () => 'https://www.sofascore.com/';
  page.isDestroyed = () => false;
  const window = { webContents: page, isDestroyed: () => false, close: () => { closes++; } };
  const work = openRecoverySite({ openWindow: () => ({ window, created, loaded }),
    watchPage: (_page, callback) => { ready = callback; return () => { unwatches++; }; },
    schedule: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; }, cancel: id => timers.delete(id),
    focusApp: () => { focuses++; } });
  return { page, work, timers, closes: () => closes, focuses: () => focuses,
    signalReady: () => ready({ status: 200, path: '/api/v1/sport/football/events/live' }), unwatches: () => unwatches,
    async fire(ms) {
      await Promise.resolve();
      const timer = [...timers].find(([_id, value]) => value.ms === ms);
      assert.ok(timer, `timer ${ms} exists`); timers.delete(timer[0]); timer[1].fn();
    } };
}

test('normal page can be checked and only its untouched automatic window closes', async () => {
  const h = harness(); await h.fire(10_000); const visit = await h.work;
  assert.equal(visit.ready, true); visit.finish(true); visit.finish(false);
  assert.equal(h.closes(), 1); assert.equal(h.focuses(), 1);
  assert.equal(h.page.listenerCount('before-input-event'), 0);
  assert.equal(h.timers.size, 0);
});

test('visible verification title requires the user and is never clicked or closed', async () => {
  const h = harness(); h.page.getTitle = () => 'Verify you are human';
  await h.fire(10_000); const visit = await h.work;
  assert.equal(visit.ready, false); assert.equal(visit.reason, 'verification_required');
  visit.finish(false); assert.equal(h.closes(), 0);
});

test('homepage HTTP 403 is not mistaken for successful navigation', async () => {
  const h = harness(); h.page.emit('did-navigate', {}, 'https://www.sofascore.com/', 403);
  await h.fire(10_000); const visit = await h.work;
  assert.equal(visit.ready, false); visit.finish(false);
});

test('an existing user window stays open after successful reconnection', async () => {
  const h = harness({ created: false }); await h.fire(10_000); const visit = await h.work;
  visit.finish(true); assert.equal(h.closes(), 0);
});

test('a user click preserves the automatic window; incidental mouse movement does not', async () => {
  const h = harness(); h.page.emit('before-mouse-event', {}, { type: 'mouseDown' });
  await h.fire(10_000); (await h.work).finish(true); assert.equal(h.closes(), 0);
  const moved = harness(); moved.page.emit('before-mouse-event', {}, { type: 'mouseMove' });
  await moved.fire(10_000); (await moved.work).finish(true); assert.equal(moved.closes(), 1);
});

test('timeout has no late restart when the page finishes loading afterwards', async () => {
  let resolve;
  const h = harness({ loaded: new Promise(r => { resolve = r; }) });
  await h.fire(30_000); const visit = await h.work;
  assert.equal(visit.reason, 'page_timeout'); visit.finish(false);
  resolve(); await Promise.resolve(); assert.equal(h.timers.size, 0);
});

test('unexpected site origin never becomes ready for the API probe', async () => {
  const h = harness(); h.page.getURL = () => 'https://unrelated.example/';
  await h.fire(10_000); const visit = await h.work;
  assert.equal(visit.reason, 'unexpected_page'); visit.finish(false);
});

test('even a successful page JSON response preserves the startup grace and is unsubscribed', async () => {
  const h = harness(); await Promise.resolve();
  assert.ok([...h.timers.values()].some(t => t.ms === 10_000));
  h.signalReady(); h.signalReady();
  assert.ok([...h.timers.values()].some(t => t.ms === 10_000));
  await h.fire(10_000); const visit = await h.work;
  assert.equal(visit.ready, true); visit.finish(true);
  assert.equal(h.unwatches(), 1); assert.equal(h.timers.size, 0);
});
