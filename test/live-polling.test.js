'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness(count = 1) {
  let time = 1_000_000;
  const calls = [], notices = [];
  const event = id => ({ id, status: { type: 'inprogress' }, tournament: { category: { sport: { slug: 'football' } } } });
  const state = { matches: Array.from({ length: count }, (_, i) => ({ id: i + 1, anim: false })),
    events: new Map(Array.from({ length: count }, (_, i) => [i + 1, event(i + 1)])),
    stats: new Map(), statsRaw: new Map(), lastPoll: new Map(), lastAttempt: new Map(),
    sofaConnection: { state: 'connected' }, targets: [], layout: {} };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const context = vm.createContext({ state, Date: ClockDate, Promise, Map, Set, console, statsModalMatchId: null,
    findMatch: id => state.matches.find(m => m.id === id),
    isLive: ev => ev?.status?.type === 'inprogress', isOver: ev => ['finished', 'canceled', 'postponed'].includes(ev?.status?.type),
    matchSport: () => 'football', eventSport: () => 'football',
    saveMatches() {}, updateTile() {}, checkAlerts() {}, renderStatsModalIfOpen() {}, renderShotList() {},
    needsPlayers: () => false, parseStats: data => data, setStatus: text => notices.push(text),
    mapLimit: async (items, limit, fn) => {
      assert.equal(limit, 1);
      const out = []; for (const item of items) out.push(await fn(item)); return out;
    },
    api: async (p, options) => {
      calls.push({ p, options });
      if (p.includes('/events/live')) return { events: [...state.events.values()] };
      const id = Number(p.split('/')[1]);
      return p.endsWith('/statistics') ? { statistics: [] } : { event: state.events.get(id) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/poll-policy.js'), 'utf8'), context);
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
  vm.runInContext(app, context);
  return { state, calls, context, notices, event, advance: ms => { time += ms; }, run: code => vm.runInContext(code, context) };
}

test('30 live matches use one score batch and at most six sequential statistics per round', async () => {
  const h = harness(30);
  await h.run('pollAll()');
  assert.equal(h.calls.filter(c => c.p.endsWith('/events/live')).length, 1);
  assert.equal(h.calls.filter(c => c.p.endsWith('/statistics')).length, 6);
  assert.equal(h.calls.filter(c => /^event\/\d+$/.test(c.p)).length, 0);
  assert.equal(h.state.lastPoll.size, 6);
  assert.match(h.notices.at(-1), /diğer maçlar sırayla/);
  h.calls.length = 0; h.advance(10_000);
  await h.run('pollAll()');
  assert.deepEqual(h.calls.filter(c => c.p.endsWith('/statistics')).map(c => Number(c.p.split('/')[1])), [7, 8, 9, 10, 11, 12]);
});

test('the focused match is first even when it was added last', async () => {
  const h = harness(30); h.state.layout.focus = 30;
  await h.run('pollAll()');
  assert.equal(h.calls.find(c => c.p.endsWith('/statistics')).p, 'event/30/statistics');
  assert.equal(h.calls.find(c => c.p.endsWith('/statistics')).options.priority, 'interactive');
});

test('background matches eventually refresh even with twelve active animations', async () => {
  const h = harness(30);
  for (const m of h.state.matches.slice(0, 12)) m.anim = true;
  for (let i = 0; i < 10; i++) { await h.run('pollAll()'); h.advance(20_000); }
  assert.equal(h.state.lastPoll.size, 30);
});

test('prematch fixtures do not request statistics and distant fixtures wait five minutes', async () => {
  const h = harness(); h.state.events.set(1, { id: 1, status: { type: 'notstarted' }, startTimestamp: 8000 });
  await h.run('pollOne(1)');
  assert.deepEqual(h.calls.map(c => c.p), ['event/1']);
  h.advance(299_999); assert.equal(h.run('needsPoll(1)'), false);
  h.advance(1); assert.equal(h.run('needsPoll(1)'), true);
});

test('missing live-list entries use a real event response instead of inferring a result', async () => {
  const h = harness(8), original = h.context.api;
  h.context.api = async (p, options) => p.includes('/events/live') ? { events: [] } : original(p, options);
  await h.run('pollAll()');
  assert.equal(h.calls.filter(c => /^event\/\d+$/.test(c.p)).length, 6);
});

test('duplicate requests for one match share the same in-flight refresh', async () => {
  const h = harness();
  await h.run('Promise.all([pollOne(1), pollOne(1), pollOne(1, true)])');
  assert.deepEqual(h.calls.map(c => c.p), ['event/1', 'event/1/statistics']);
});

test('a 403 pause skips the entire UI polling cycle', async () => {
  const h = harness(30); h.state.sofaConnection = { state: 'blocked', status: 403, retryAt: 0 };
  await h.run('pollAll()');
  assert.equal(h.calls.length, 0);
});

test('a final match retries failed statistics and stops only after a successful final refresh', async () => {
  const h = harness(); h.state.events.set(1, { id: 1, status: { type: 'finished' } });
  const original = h.context.api;
  h.context.api = async (p, options) => { if (p.endsWith('/statistics')) throw new Error('offline'); return original(p, options); };
  assert.equal(await h.run('pollOne(1)'), false);
  h.advance(60_000); assert.equal(h.run('needsPoll(1)'), true);
  h.context.api = original; await h.run('pollOne(1)');
  h.advance(600_000); assert.equal(h.run('needsPoll(1)'), false);
});

test('a statistics 404 does not trigger an automatic cache-busting request', async () => {
  const h = harness(), original = h.context.api;
  h.context.api = async (p, options) => { const result = await original(p, options); return p.endsWith('/statistics') ? null : result; };
  await h.run('pollOne(1)');
  assert.deepEqual(h.calls.map(c => c.p), ['event/1', 'event/1/statistics']);
});

test('a removed match is not restored by a late response', async () => {
  const h = harness(); let finish;
  h.context.api = () => new Promise(resolve => { finish = resolve; });
  const work = h.run('pollOne(1)');
  h.state.matches = []; h.state.events.clear();
  finish({ event: h.event(1) }); await work;
  assert.equal(h.state.events.size, 0);
  assert.equal(h.state.stats.size, 0);
});
