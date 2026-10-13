'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');

class Node {
  constructor(text = '') {
    this.textContent = text;
    this.children = [];
    this.dataset = {};
    this.scrollTop = 0;
    this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = { add: (key) => classes.add(key), remove: (key) => classes.delete(key),
      toggle: (key, on) => on ? classes.add(key) : classes.delete(key), contains: (key) => classes.has(key) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(key, value) { this[key] = value; }
  getAttribute(key) { return this[key]; }
  focus() {}
  getBoundingClientRect() { return { top: 60 }; }
  show() { this.open = true; }
  close() { this.open = false; }
}

function modalContext() {
  const nodes = new Map();
  const $ = (key) => {
    if (!nodes.has(key)) nodes.set(key, new Node());
    return nodes.get(key);
  };
  const tiles = new Map([1, 2].map((id) => [id, { id, el: new Node(), webview: { id }, preview: false }]));
  const block = { statistics: [{ period: 'ALL', groups: [{ groupName: 'Shots', statisticsItems: [
    { key: 'totalShotsOnGoal', home: '10', away: '2', homeValue: 10, awayValue: 2 },
  ] }] }] };
  const state = { period: 'ALL', events: new Map(), stats: new Map(), tiles,
    statsRaw: new Map([[1, block], [2, block]]) };
  const players = new Map([[1, { available: true, loadedAt: Date.now(), list: [], details: new Map() }]]);
  const context = vm.createContext({ state, players, $, console,
    document: { body: new Node() }, shotCards: new Map(),
    el: (_tag, className, text) => { const node = new Node(text); node.className = className; return node; },
    findMatch: (id) => ({ id, anim: true }),
    cardOrder: () => [1, 2], teamName: (team) => team?.name || '?', minuteText: () => '', scoreText: () => '0 - 0',
    LOGO_URL: (id) => String(id), closeDropdown() {}, scheduleFit() {},
    api: () => { throw new Error('Panel ek veri isteği attı'); },
    createTile: () => { throw new Error('Açık animasyon için yeni webview oluşturuldu'); },
    destroyTile: () => { throw new Error('Açık animasyon kaldırıldı'); },
    loadPlayers: () => { throw new Error('Önbellekteki kadro yeniden istendi'); },
  });
  vm.runInContext(source('stats-modal.js'), context);
  return { context, tiles, $ };
}

test('panel ve maç okları eldeki istatistik ve webview ile çalışır; yeni veri isteği yok', () => {
  const { context, tiles, $ } = modalContext();
  const firstWebview = tiles.get(1).webview;
  const secondWebview = tiles.get(2).webview;
  vm.runInContext('openStatsModal(1); stepStatsMatch(1); ensureModalPlayers(1); closeStatsModal();', context);
  assert.equal(tiles.size, 2);
  assert.equal(tiles.get(1).webview, firstWebview);
  assert.equal(tiles.get(2).webview, secondWebview);
  assert.equal($('#statsDialog').open, false);
  assert.equal(context.document.body.classList.contains('stats-open'), false);
});

test('yalnız şut ekranındaki maçın önizlemesi bir kez açılır ve panel kapanınca kaldırılır', () => {
  const { context, tiles } = modalContext();
  tiles.delete(2);
  const firstWebview = tiles.get(1).webview;
  let created = 0;
  let destroyed = 0;
  context.findMatch = (id) => ({ id, anim: id === 1 });
  context.createTile = (id, preview) => {
    created++;
    assert.equal(preview, true);
    tiles.set(id, { id, el: new Node(), webview: { id }, preview });
  };
  context.destroyTile = (id) => { destroyed++; tiles.delete(id); };
  vm.runInContext('openStatsModal(2); renderStatsModal(); closeStatsModal();', context);
  assert.equal(created, 1);
  assert.equal(destroyed, 1);
  assert.equal(tiles.has(2), false);
  assert.equal(tiles.get(1).webview, firstWebview);
});

test('yüzde halkası ham adet yerine ekrandaki yüzdeyi veya doğru oranı kullanır', () => {
  const { context } = modalContext();
  assert.equal(vm.runInContext("statPercentage({home: '61% (48/78)', homeValue: 48, homeTotal: 78}, 'home')", context), 61);
  assert.equal(vm.runInContext("statPercentage({homeValue: 3, homeTotal: 4}, 'home')", context), 75);
});

test('oranlı değerler halkada ve çubukta dar alana uygun ayrılır', () => {
  const { context } = modalContext();
  const ring = vm.runInContext("statComparisonValue({home: '9/28 (32%)'}, 'home', true)", context);
  assert.equal(ring.children[0].textContent, '9/28');
  assert.equal(ring.children.length, 1);
  const bar = vm.runInContext("statComparisonValue({home: '40/58 (69%)'}, 'home', false)", context);
  assert.equal(bar.children[0].textContent, '40/58');
  assert.equal(bar.children[1].textContent, '69%');
  const percentOnly = vm.runInContext("statComparisonValue({home: '35%'}, 'home', true)", context);
  assert.equal(percentOnly.textContent, '');
});

test('mücadele yüzdeleri tek halkada, oranlı değerler halka yanında gösterilir', () => {
  const { context } = modalContext();
  const shared = vm.runInContext("renderStatRow({key:'duelWonPercent',home:'33%',away:'67%'})", context);
  assert.equal(shared.children[0].textContent, 'Kazanılan mücadele');
  const sharedRing = shared.children[1].children[0];
  assert.equal(sharedRing.className, 'stats-ring-shared');
  assert.deepEqual(sharedRing.children.map((node) => node.textContent), ['33%', '67%']);
  const paired = vm.runInContext("renderStatRow({key:'groundDuelsPercentage',home:'10/32 (31%)',away:'22/32 (69%)'})", context);
  assert.equal(paired.children[0].textContent, 'Yer mücadelesi');
  const [home, away] = paired.children[1].children;
  assert.deepEqual(home.children.map((node) => node.textContent), ['10/32', '31%']);
  assert.deepEqual(away.children.map((node) => node.textContent), ['69%', '22/32']);
});

test('genel maç listesi iki istek kullanır; her lig için ayrı fikstür çekilmez', async () => {
  const calls = [];
  const state = { catalog: { live: [], today: [], leagues: [], loadedAt: 0, lastAttemptAt: 0 }, searchResults: [] };
  const context = vm.createContext({ state, CATALOG_TTL_MS: 60_000, localDate: () => '2026-10-11',
    api: async (request) => { calls.push(request); return { events: [] }; },
  });
  vm.runInContext(source('picker.js'), context);
  await vm.runInContext('loadCatalog()', context);
  await vm.runInContext('loadCatalog()', context);
  assert.deepEqual(calls, ['sport/football/events/live', 'sport/football/scheduled-events/2026-10-11']);
  assert.equal(state.catalog.leagues.length, 8);
});

test('Şampiyonlar Ligi yalnız fikstür gününde lig filtresinin en üstündedir', () => {
  let matchDay = true;
  const state = { catalog: { leagues: [] }, searchResults: [], leagueFilter: null };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 9, matchDay ? 13 : 15, 12])); }
  }
  const context = vm.createContext({ state, Date: FixtureDate });
  vm.runInContext(source('theme.js'), context);
  vm.runInContext(source('picker.js'), context);
  const matchDayList = vm.runInContext('availableLeagues()', context);
  assert.equal(matchDayList[0].id, 7);
  state.catalog.leagues = matchDayList;
  matchDay = false;
  const ordinaryList = vm.runInContext('availableLeagues()', context);
  assert.equal(ordinaryList[0].id, 17);
  assert.equal(ordinaryList.find((league) => league.id === 7).topRank, undefined);
});

test('animasyon kurtarması üç aralıklı denemeyle sınırlıdır ve engelde durur', () => {
  const state = { sofaConnection: { state: 'connected' } };
  const timers = [];
  let reloads = 0;
  const webview = { reload: () => reloads++ };
  const tile = { webview, recoveryAttempts: 0, recoveryTimer: null, reloadBlocked: false };
  const context = vm.createContext({ state, tile, webview, Date: { now: () => 1000 },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; } });
  vm.runInContext(source('tiles.js'), context);
  for (let i = 0; i < 3; i++) {
    vm.runInContext('scheduleTileRecovery(tile, webview); scheduleTileRecovery(tile, webview);', context);
    timers[i].callback();
  }
  vm.runInContext('scheduleTileRecovery(tile, webview)', context);
  assert.deepEqual(timers.map((timer) => timer.delay), [15_000, 45_000, 120_000]);
  assert.equal(reloads, 3);
  state.sofaConnection = { state: 'blocked', status: 403, retryAt: 0 };
  assert.equal(vm.runInContext('autoReloadAllowed(tile)', context), false);
  state.sofaConnection = { state: 'blocked', status: 429, retryAt: 61_000 };
  assert.equal(vm.runInContext('autoReloadAllowed(tile)', context), false);
  state.sofaConnection.retryAt = 999;
  assert.equal(vm.runInContext('autoReloadAllowed(tile)', context), true);
  tile.reloadBlocked = true;
  assert.equal(vm.runInContext('autoReloadAllowed(tile)', context), false);
});

test('bekleyen animasyon kurtarması sırasında gelen 403 yeni yükleme başlatmaz', () => {
  const state = { sofaConnection: { state: 'connected' } };
  let callback;
  let reloads = 0;
  const webview = { reload: () => reloads++ };
  const tile = { webview, recoveryAttempts: 0, recoveryTimer: null, reloadBlocked: false };
  const context = vm.createContext({ state, tile, webview,
    setTimeout: (fn) => { callback = fn; return 1; } });
  vm.runInContext(source('tiles.js'), context);
  vm.runInContext('scheduleTileRecovery(tile, webview)', context);
  state.sofaConnection = { state: 'blocked', status: 403, retryAt: 0 };
  callback();
  assert.equal(reloads, 0);
  assert.equal(tile.recoveryTimer, null);
});
