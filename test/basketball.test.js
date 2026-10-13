'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function basketContext() {
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    window: { sofa: { get: () => { throw new Error('ek veri isteği'); } } },
    document: {},
  });
  vm.runInContext(source('core.js'), context);
  vm.runInContext(source('players.js'), context);
  vm.runInContext(source('coupon.js'), context);
  return context;
}

const SPORT = { category: { sport: { slug: 'basketball' } } };
const event = (over) => ({ id: 1, tournament: SPORT, homeTeam: { name: 'Ev' }, awayTeam: { name: 'Dep' }, ...over });

test('basketbol maçı tanınır ve saat çeyrek + kalan süre olarak gösterilir', () => {
  const c = basketContext();
  c.ev = event({ status: { code: 14, type: 'inprogress', description: '2nd quarter' },
    time: { played: 953, periodLength: 600, overtimeLength: 300, totalPeriodCount: 4 } });
  assert.equal(vm.runInContext('eventSport(ev)', c), 'basketball');
  assert.equal(vm.runInContext('minuteText(ev)', c), '2Ç 4:07');
  c.ev.status = { code: 40, type: 'inprogress', description: 'Overtime' };
  c.ev.time.played = 2500;
  assert.equal(vm.runInContext('minuteText(ev)', c), 'UZ 3:20');
  c.ev.status = { code: 31, type: 'inprogress', description: 'Halftime' };
  assert.equal(vm.runInContext('minuteText(ev)', c), 'Devre');
  assert.equal(vm.runInContext("minuteText({ tournament: { category: { sport: { slug: 'football' } } }, status: { code: 31, type: 'inprogress' } })", c), 'İY');
});

test('saat çalışırken son güncellemeden beri geçen süre düşülür, dururken sabit kalır', () => {
  const c = basketContext();
  const now = Date.parse('2026-10-13T12:00:30Z');
  vm.runInContext(`Date.now = () => ${now}`, c);
  c.ev = event({ status: { code: 13, type: 'inprogress', description: '1st quarter' },
    time: { played: 100, periodLength: 600, totalPeriodCount: 4, clockRunning: true, clockRunningLastUpdated: '2026-10-13T12:00:00+00:00' } });
  assert.equal(vm.runInContext('minuteText(ev)', c), '1Ç 7:50');
  c.ev.time.clockRunning = false;
  assert.equal(vm.runInContext('minuteText(ev)', c), '1Ç 8:20');
});

test('biten çeyrek sayısı ara ve devre arasında da doğru hesaplanır', () => {
  const c = basketContext();
  const done = (status, time, homeScore) => vm.runInContext('basketQuartersDone(ev)',
    Object.assign(c, { ev: event({ status, time, homeScore }) }));
  const t = (played) => ({ played, periodLength: 600, totalPeriodCount: 4 });
  assert.equal(done({ code: 15, type: 'inprogress' }, t(1300)), 2);
  assert.equal(done({ code: 30, type: 'inprogress', description: 'Pause' }, t(600)), 1);
  assert.equal(done({ code: 31, type: 'inprogress', description: 'Halftime' }, t(1200)), 2);
  assert.equal(done({ code: 30, type: 'inprogress', description: 'Pause' }, { periodLength: 600 }, { period1: 20, period2: 21, period3: 19 }), 3);
  assert.equal(done({ code: 40, type: 'inprogress', description: 'Overtime' }, t(2450)), 4);
  assert.equal(done({ code: 100, type: 'finished' }, t(2400)), 4);
});

test('basketbol istatistikleri okunur; NBA çeyreklerinden yarılar toplanır', () => {
  const c = basketContext();
  const items = (reb, ast) => [{ statisticsItems: [
    { key: 'threePointersScored', homeValue: 10, awayValue: 9, home: '10/25 (40%)' },
    { key: 'rebounds', homeValue: reb[0], awayValue: reb[1] },
    { key: 'assists', homeValue: ast[0], awayValue: ast[1] },
  ] }];
  c.payload = { statistics: [
    { period: 'ALL', groups: items([40, 38], [20, 18]) },
    { period: '1Q', groups: items([10, 9], [5, 4]) },
    { period: '2Q', groups: items([11, 10], [6, 5]) },
    { period: '3Q', groups: items([9, 9], [4, 4]) },
  ] };
  const parsed = plain(vm.runInContext("parseStats(payload, 'basketball')", c));
  assert.deepEqual(parsed.ALL.rebounds, [40, 38]);
  assert.deepEqual(parsed.ALL.threes, [10, 9]);
  assert.equal(parsed.ALL.turnovers, null);
  assert.deepEqual(parsed['1ST'].rebounds, [21, 19]);
  assert.deepEqual(parsed['2ND'].assists, [4, 4]);
});

test('sayı skordan okunur: 2. yarı uzatmayı içerir, çeyrek içermez', () => {
  const c = basketContext();
  c.ev = event({ status: { code: 100, type: 'finished' },
    homeScore: { current: 95, period1: 20, period2: 25, period3: 22, period4: 18, overtime1: 10 },
    awayScore: { current: 90, period1: 22, period2: 21, period3: 20, period4: 22, overtime1: 5 } });
  const pts = (p) => plain(vm.runInContext(`basketPoints(ev, '${p}')`, c));
  assert.deepEqual(pts('ALL'), [95, 90]);
  assert.deepEqual(pts('1ST'), [45, 43]);
  assert.deepEqual(pts('2ND'), [50, 47]);
  assert.deepEqual(pts('Q4'), [18, 22]);
});

test('toplam sayı hedefi: üst barem geçince tutar, çeyrek bitince alt sonuçlanır', () => {
  const c = basketContext();
  vm.runInContext(`state.events.set(1, ${JSON.stringify(event({
    status: { code: 15, type: 'inprogress', description: '3rd quarter' },
    time: { played: 1500, periodLength: 600, totalPeriodCount: 4 },
    homeScore: { current: 70, period1: 20, period2: 25, period3: 25 },
    awayScore: { current: 64, period1: 22, period2: 21, period3: 21 },
  }))})`, c);
  const evalT = (t) => plain(vm.runInContext(`evalTarget(${JSON.stringify({ matchId: 1, kind: 'team', stat: 'points', ...t })})`, c));
  assert.equal(evalT({ side: 'total', period: 'ALL', dir: 'over', line: 160.5 }).status, 'live');
  assert.equal(evalT({ side: 'total', period: 'ALL', dir: 'over', line: 120.5 }).status, 'won');
  assert.equal(evalT({ side: 'total', period: '1ST', dir: 'under', line: 90.5 }).status, 'won');
  assert.equal(evalT({ side: 'total', period: 'Q2', dir: 'under', line: 45.5 }).status, 'lost');
  assert.equal(evalT({ side: 'home', period: 'Q3', dir: 'under', line: 30.5 }).status, 'live');
  assert.equal(evalT({ side: 'away', period: 'Q1', dir: 'over', line: 22 }).status, 'push');
});

test('basketbol oyuncu hedefinde faul limiti dolan oyuncunun hedefi kapanır', async () => {
  const c = basketContext();
  vm.runInContext(`state.events.set(1, ${JSON.stringify(event({ status: { code: 16, type: 'inprogress' } }))});
    state.matches = [{ id: 1, anim: false, sport: 'basketball' }];`, c);
  c.window.sofa.get = async (p) => p.endsWith('/lineups') ? { home: { players: [
    { player: { id: 7, name: 'A' }, statistics: { points: 12, rebounds: 3, assists: 2, threePointsMade: 2, personalFouls: 5, secondsPlayed: 900 } },
  ] }, away: { players: [] } } : (() => { throw new Error(`gereksiz istek ${p}`); })();
  await vm.runInContext('loadPlayers(1)', c);
  const t = { matchId: 1, kind: 'player', playerId: 7, stat: 'points', dir: 'over', line: 14.5, period: 'ALL' };
  c.t = t;
  assert.equal(vm.runInContext('playerValue(t)', c), 12);
  assert.equal(vm.runInContext('evalTarget(t).status', c), 'lost');
  assert.equal(vm.runInContext('playerStatusText(t)', c), 'Faul limiti doldu');
});
