'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function context(responses, box = null) {
  const calls = { box: 0 };
  const ctx = vm.createContext({
    localStorage: { getItem: () => null },
    window: {
      sofa: { get: async (p) => { if (!(p in responses)) throw new Error(`beklenmeyen istek ${p}`); return responses[p]; } },
      boxScore: { players: async () => { calls.box++; return box; } },
    },
    document: {},
  });
  vm.runInContext(source('core.js'), ctx);
  vm.runInContext(source('players.js'), ctx);
  vm.runInContext(source('coupon.js'), ctx);
  ctx.calls = calls;
  return ctx;
}

const FOOTBALL = { category: { sport: { slug: 'football' } } };
const BASKET = { category: { sport: { slug: 'basketball' } }, uniqueTournament: { id: 138, name: 'Euroleague' } };
const lineupPlayer = (id, name, num, statistics, substitute = false) =>
  ({ player: { id, name, shortName: name }, shirtNumber: num, substitute, statistics });

test('futbol oyuncu hedefinde gol, asist, pas, kilit pas, top kapma, faul, ofsayt ve kart marketleri var', () => {
  const ctx = context({});
  const keys = plain(vm.runInContext('FOOTBALL_PLAYER_STATS', ctx)).map(([k]) => k);
  for (const k of ['shots', 'sot', 'goals', 'assists', 'passes', 'keyPasses', 'interceptions', 'fouls', 'cards', 'offsides']) {
    assert.ok(keys.includes(k), k);
    assert.ok(vm.runInContext(`TARGET_STATS[${JSON.stringify(k)}]`, ctx), `${k} etiketi`);
  }
  for (const k of ['offTarget', 'blocked', 'wasFouled', 'tackles', 'dribbles', 'crosses', 'saves']) assert.ok(keys.includes(k), k);
  const basket = plain(vm.runInContext('BASKET_PLAYER_STATS', ctx)).map(([k]) => k);
  for (const k of ['points', 'rebounds', 'assists', 'threes', 'fga', 'fgm', 'threesAtt', 'fta', 'ftm', 'steals', 'blocks', 'pra', 'pr', 'pa', 'ra', 'stocks']) {
    assert.ok(basket.includes(k), k);
    assert.ok(vm.runInContext(`TARGET_STATS[${JSON.stringify(k)}]`, ctx), `${k} etiketi`);
  }
  const groups = plain(vm.runInContext('playerStatGroups(BASKET_PLAYER_STATS)', ctx)).map(([g]) => g);
  assert.deepEqual(groups, ['Temel', 'Birleşik', 'Şut', 'Diğer']);
  assert.equal(vm.runInContext("targetLabel({ kind: 'player', playerName: 'Icardi', stat: 'keyPasses', line: 1.5, dir: 'over' })", ctx),
    'Icardi kilit pas 1.5 Üst');
});

test('futbol oyuncu marketleri lineups istatistiğinden, kart olaylardan sayılır; tuttu / kaldı durumu', async () => {
  const ctx = context({
    'event/1/lineups': { home: { players: [
      lineupPlayer(10, 'Icardi', 9, { totalShots: 4, onTargetScoringAttempt: 2, goals: 1, goalAssist: 1, totalPass: 18,
        keyPass: 2, fouls: 3, totalOffside: 2 }),
      lineupPlayer(11, 'Torreira', 34, { totalPass: 41, interceptionWon: 3 }),
      lineupPlayer(12, 'Yedek', 99, null, true),
    ] }, away: { players: [] } },
    'event/1/incidents': { incidents: [
      { incidentType: 'card', incidentClass: 'yellow', player: { id: 11 }, time: 30 },
      { incidentType: 'card', incidentClass: 'yellow', player: { id: 10 }, time: 40, rescinded: true },
      { incidentType: 'card', incidentClass: 'yellowRed', player: { id: 11 }, time: 70 },
    ] },
  });
  vm.runInContext(`state.events.set(1, { id: 1, tournament: ${JSON.stringify(FOOTBALL)},
    status: { type: 'inprogress', code: 7 }, homeScore: { current: 1 }, awayScore: { current: 0 } })`, ctx);
  await vm.runInContext('loadPlayers(1)', ctx);
  const val = (playerId, stat) => vm.runInContext(`playerValue(${JSON.stringify({ matchId: 1, kind: 'player', playerId, stat })})`, ctx);
  assert.equal(val(10, 'goals'), 1);
  assert.equal(val(10, 'assists'), 1);
  assert.equal(val(10, 'passes'), 18);
  assert.equal(val(10, 'keyPasses'), 2);
  assert.equal(val(10, 'fouls'), 3);
  assert.equal(val(10, 'offsides'), 2);
  assert.equal(val(10, 'interceptions'), 0); // alan yok = 0
  assert.equal(val(11, 'interceptions'), 3);
  assert.equal(val(10, 'cards'), 0);         // iptal edilen kart sayılmaz
  assert.equal(val(11, 'cards'), 2);
  assert.equal(val(12, 'passes'), 0);        // oynamayan oyuncu

  const evalT = (t) => plain(vm.runInContext(`evalTarget(${JSON.stringify({ matchId: 1, kind: 'player', ...t })})`, ctx));
  assert.equal(evalT({ playerId: 10, stat: 'passes', dir: 'over', line: 15.5 }).status, 'won');
  assert.equal(evalT({ playerId: 10, stat: 'keyPasses', dir: 'over', line: 2.5 }).status, 'live');
  assert.equal(evalT({ playerId: 10, stat: 'fouls', dir: 'under', line: 2.5 }).status, 'lost');
  // Kırmızı kart gören oyuncunun hedefi kapanır: altta kaldıysa tuttu, üstü kaldıysa yattı
  assert.equal(evalT({ playerId: 11, stat: 'passes', dir: 'over', line: 50.5 }).status, 'lost');
  assert.equal(evalT({ playerId: 11, stat: 'cards', dir: 'over', line: 0.5 }).status, 'won');
});

test('hedef formu barem önerisi istatistiğe göre değişir', () => {
  const ctx = context({});
  const line = (basket, player, stat) => vm.runInContext(`defaultLine(${basket}, ${player}, ${JSON.stringify(stat)})`, ctx);
  assert.equal(line(false, true, 'passes'), 29.5);
  assert.equal(line(false, true, 'goals'), 0.5);
  assert.equal(line(false, false, 'goals'), 2.5);
  assert.equal(line(true, true, 'points'), 15.5);
  assert.equal(line(true, false, 'points'), 160.5);
});

const box = (s) => ({ points: 0, rebounds: 0, offRebounds: 0, defRebounds: 0, assists: 0, threes: 0, threesAtt: 0, twos: 0,
  twosAtt: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, seconds: 0, fouls: 0, steals: 0, blocks: 0, turnovers: 0, ...s });
const BOX = { source: 'euroleague', label: 'EuroLeague', fetchedAt: Date.now(), players: [
  { id: 'P1', side: 'home', name: 'Sasha Vezenkov', num: '14', starter: true, played: true,
    stats: box({ points: 16, rebounds: 5, assists: 1, threes: 2, threesAtt: 4, fgm: 6, fga: 10, seconds: 900, fouls: 1 }) },
  { id: 'P2', side: 'home', name: 'Evan Fournier', num: '94', starter: true, played: true,
    stats: box({ points: 9, rebounds: 1, assists: 2, threes: 3, seconds: 800, fouls: 5, steals: 1 }) },
  { id: 'P3', side: 'away', name: 'Nigel Hayes-Davis', num: '11', starter: true, played: true,
    stats: box({ points: 7, rebounds: 2, threes: 1, seconds: 700, blocks: 2 }) },
] };

function basketEvent(ctx) {
  vm.runInContext(`state.events.set(2, { id: 2, tournament: ${JSON.stringify(BASKET)}, startTimestamp: 1792780800,
    homeTeam: { name: 'Olympiacos' }, awayTeam: { name: 'Fenerbahçe' },
    status: { type: 'inprogress', code: 14 }, homeScore: { current: 40 }, awayScore: { current: 38 } })`, ctx);
}

test('basketbol: canlı maçta resmî kaynak da çekilir, her istatistikte önde olan değer kullanılır', async () => {
  const ctx = context({ 'event/2/lineups': { home: { players: [
    // Sofascore sayıda geride (12 < 16), ribaundda önde (6 > 5)
    lineupPlayer(100, 'S. Vezenkov', 14, { points: 12, rebounds: 6, assists: 1, threePointsMade: 2, secondsPlayed: 950 }),
    lineupPlayer(101, 'E. Fournier', 94, null),
  ] }, away: { players: [lineupPlayer(200, 'N. Hayes-Davis', 11, null)] } } }, BOX);
  basketEvent(ctx);
  const rec = await vm.runInContext('loadPlayers(2)', ctx);
  assert.equal(ctx.calls.box, 1);
  const val = (playerId, stat) => vm.runInContext(`playerValue(${JSON.stringify({ matchId: 2, kind: 'player', playerId, stat })})`, ctx);
  assert.equal(val(100, 'points'), 16);   // resmî kaynak önde
  assert.equal(val(100, 'rebounds'), 6);  // Sofascore önde
  assert.equal(val(100, 'fga'), 10);
  assert.equal(val(100, 'pra'), 16 + 6 + 1);
  assert.equal(val(101, 'points'), 9);    // Sofascore'da hiç yok
  assert.equal(val(200, 'stocks'), 2);    // soyadı tireli de eşleşir
  assert.match(rec.source, /EuroLeague canlı/);
  assert.equal(vm.runInContext("playerIsOut({ matchId: 2, playerId: 101 })", ctx), true); // FIBA 5 faul
  assert.equal(vm.runInContext("playerValue({ matchId: 2, playerId: 'euroleague:P1', stat: 'points' })", ctx), 16); // kimlik yönlenir
  // 10 sn içinde ikinci yükleme resmî kaynağa yeniden gitmez
  await vm.runInContext('loadPlayers(2)', ctx);
  assert.equal(ctx.calls.box, 1);
});

test('basketbol: Sofascore kadrosu yoksa oyuncular resmî kaynaktan gelir; maç başlamadıysa istek yok', async () => {
  const ctx = context({ 'event/2/lineups': null }, BOX);
  basketEvent(ctx);
  const rec = await vm.runInContext('loadPlayers(2)', ctx);
  assert.equal(rec.available, true);
  assert.deepEqual(plain(rec.list.map((p) => p.id)), ['euroleague:P1', 'euroleague:P2', 'euroleague:P3']);
  assert.equal(vm.runInContext("playerValue({ matchId: 2, playerId: 'euroleague:P2', stat: 'assists' })", ctx), 2);
  assert.match(vm.runInContext("playerStatusText({ matchId: 2, playerId: 'euroleague:P1' })", ctx), /EuroLeague/);

  const idle = context({ 'event/2/lineups': null }, BOX);
  basketEvent(idle);
  vm.runInContext("state.events.get(2).status = { type: 'notstarted' }", idle);
  await vm.runInContext('loadPlayers(2)', idle);
  assert.equal(idle.calls.box, 0);
});

test('basketbol: resmî kaynak bir değeri düşürürse (düzeltme) o istatistikte resmî değere uyulur', async () => {
  const sofa = { 'event/2/lineups': { home: { players: [
    lineupPlayer(100, 'S. Vezenkov', 14, { points: 16, rebounds: 7, assists: 1, secondsPlayed: 950 }),
  ] }, away: { players: [lineupPlayer(200, 'N. Hayes-Davis', 11, { points: 7 })] } } };
  const first = { ...BOX, players: BOX.players.map((p) => p.id === 'P1' ? { ...p, stats: box({ ...p.stats, rebounds: 7 }) } : p) };
  const ctx = context(sofa, first);
  basketEvent(ctx);
  await vm.runInContext('loadPlayers(2)', ctx);
  const val = (stat) => vm.runInContext(`playerValue({ matchId: 2, playerId: 100, stat: '${stat}' })`, ctx);
  assert.equal(val('rebounds'), 7);
  // Resmî kaynak ribaundu 7'den 5'e düzeltti; Sofascore hâlâ 7 gösteriyor
  ctx.window.boxScore.players = async () => ({ ...BOX, fetchedAt: Date.now() });
  vm.runInContext('players.get(2).boxAt = 0', ctx);
  await vm.runInContext('loadPlayers(2)', ctx);
  assert.equal(val('rebounds'), 5);
  assert.equal(val('points'), 16); // düzeltilmeyen istatistikte büyük değer kuralı sürer
});
