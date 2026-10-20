'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');

function context() {
  const ctx = vm.createContext({ localStorage: { getItem: () => null }, window: {}, document: {} });
  vm.runInContext(source('core.js'), ctx);
  vm.runInContext(source('coupon.js'), ctx);
  return ctx;
}

test('hedef listesinde gol ve şut kartının bütün sayım istatistikleri var', () => {
  const ctx = context();
  const groups = JSON.parse(JSON.stringify(vm.runInContext('FOOTBALL_TEAM_TARGETS', ctx)));
  const keys = groups.flatMap(([, opts]) => opts.map(([k]) => k));
  assert.equal(groups[0][0], 'Gol');
  for (const k of ['goals', 'shots', 'sot', 'corners', 'fouls', 'yellowCards', 'offsides', 'throwIns', 'goalKicks', 'saves', 'xg']) {
    assert.ok(keys.includes(k), k);
  }
  assert.ok(!keys.includes('possession'), 'yüzde satırı hedef olmaz');
  assert.equal(vm.runInContext("TARGET_STATS.yellowCards", ctx), 'sarı kart');
});

test('gol hedefi skordan, eksik sayım satırı şut verisi varsa 0', () => {
  const ctx = context();
  vm.runInContext(`
    state.events.set(1, { status: { type: 'inprogress', code: 7 },
      homeScore: { current: 2, period1: 1, period2: 1 }, awayScore: { current: 1, period1: 0, period2: 1 } });
    state.stats.set(1, { ALL: { shots: [10, 6], corners: [4, 2], offsides: null, xg: null } });
    state.stats.set(2, { ALL: { shots: null, sot: null, corners: null, offsides: null } });
    state.events.set(2, { status: { type: 'inprogress', code: 7 }, homeScore: { current: 0 }, awayScore: { current: 0 } });
  `, ctx);
  const v = (t) => vm.runInContext(`teamValue(${JSON.stringify(t)})`, ctx);
  assert.equal(v({ matchId: 1, stat: 'goals', side: 'total', period: 'ALL' }), 3);
  assert.equal(v({ matchId: 1, stat: 'goals', side: 'home', period: '1ST' }), 1);
  assert.equal(v({ matchId: 1, stat: 'goals', side: 'away', period: '2ND' }), 1);
  assert.equal(v({ matchId: 1, stat: 'offsides', side: 'total', period: 'ALL' }), 0);   // satır yok = 0
  assert.equal(v({ matchId: 1, stat: 'xg', side: 'home', period: 'ALL' }), null);       // xG tutulmuyorsa bilinmez
  assert.equal(v({ matchId: 2, stat: 'offsides', side: 'home', period: 'ALL' }), null); // ligde istatistik yok
});
