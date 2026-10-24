'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionRecovery } = require('../src/sofa-recovery');
const denied = () => ({ state: 'blocked', status: 403, retryAt: 0 });

function harness(options = {}) {
  let time = 1000, state = denied();
  const calls = [], phases = [], saved = [];
  const recovery = createSessionRecovery({
    now: () => time, getState: () => state,
    openSite: async () => { calls.push('open'); return { ready: true, finish: ok => calls.push(`finish:${ok}`) }; },
    probe: async () => { calls.push('probe'); state = { state: 'connected', status: 200 }; return state; },
    persist: value => saved.push({ ...value }), onEvent: value => phases.push(value.phase), ...options,
  });
  return { recovery, calls, phases, saved, advance: ms => { time += ms; }, set: value => { state = value; } };
}

test('one visible normal site visit and one check restore the connection', async () => {
  const h = harness(); await h.recovery.observe(denied());
  assert.deepEqual(h.calls.filter(c => c === 'open' || c === 'probe'), ['open', 'probe']);
  assert.deepEqual(h.phases, ['opening', 'checking', 'restored']);
  assert.equal(h.recovery.snapshot().armed, true);
  assert.ok(h.calls.includes('finish:true'));
});

test('verification page never triggers an automatic API probe', async () => {
  let probes = 0;
  const h = harness({ openSite: async () => ({ ready: false, reason: 'verification_required' }),
    probe: () => { probes++; assert.fail('verification needs the user'); } });
  await h.recovery.observe(denied());
  assert.equal(probes, 0);
  assert.equal(h.recovery.snapshot().phase, 'manual');
  assert.equal(h.recovery.snapshot().reason, 'verification_required');
});

test('a failed automatic check is latched, with no new attempt even hours later', async () => {
  let attempts = 0;
  const h = harness({ probe: async () => { attempts++; return { ...denied(), error: 'denied' }; } });
  await h.recovery.observe(denied());
  h.advance(3_600_000); await h.recovery.observe(denied()); await h.recovery.observe(denied());
  assert.equal(attempts, 1);
  assert.equal(h.calls.filter(c => c === 'open').length, 1);
  assert.equal(h.recovery.snapshot().armed, false);
});

test('429 never opens a site or shortens Retry-After', async () => {
  const h = harness(); await h.recovery.observe({ state: 'blocked', status: 429, retryAt: 90_000 });
  assert.deepEqual(h.calls, []);
});

test('concurrent 403 reports share one recovery operation', async () => {
  let finishPage, opens = 0;
  const h = harness({ openSite: () => { opens++; return new Promise(resolve => { finishPage = resolve; }); } });
  const first = h.recovery.observe(denied()), second = h.recovery.observe(denied());
  assert.equal(first, second);
  finishPage({ ready: true }); await first;
  assert.equal(opens, 1);
});

test('a fresh denial inside two minutes does not cause another popup', async () => {
  const h = harness(); await h.recovery.observe(denied());
  h.set(denied()); h.advance(119_999); await h.recovery.observe(denied());
  assert.equal(h.calls.filter(c => c === 'open').length, 1);
  assert.equal(h.recovery.snapshot().reason, 'cooldown');
  h.advance(1); await h.recovery.observe(denied());
  assert.equal(h.calls.filter(c => c === 'open').length, 2);
});

test('restart cannot bypass a failed automatic attempt', async () => {
  const h = harness({ initial: { armed: false, lastStartedAt: -3_600_000 } });
  await h.recovery.observe(denied()); assert.deepEqual(h.calls, []);
  h.set({ state: 'connected', status: 200 });
  await h.recovery.observe({ state: 'connected', status: 200 });
  h.set(denied()); await h.recovery.observe(denied());
  assert.equal(h.calls.filter(c => c === 'open').length, 1);
});

test('manual reconnection while the page opens avoids a redundant API check', async () => {
  let finishPage;
  const h = harness({ openSite: () => new Promise(resolve => { finishPage = resolve; }) });
  const work = h.recovery.observe(denied());
  h.set({ state: 'connected', status: 200 });
  finishPage({ ready: true }); await work;
  assert.equal(h.calls.filter(c => c === 'probe').length, 0);
  assert.equal(h.recovery.snapshot().phase, 'restored');
});

test('page timeout or navigation error leaves manual control and no retry loop', async () => {
  const h = harness({ openSite: async () => { throw new Error('timeout'); } });
  await h.recovery.observe(denied());
  h.advance(1000000); await h.recovery.observe(denied());
  assert.equal(h.recovery.snapshot().phase, 'manual');
  assert.equal(h.recovery.snapshot().armed, false);
  assert.equal(h.calls.length, 0);
});
