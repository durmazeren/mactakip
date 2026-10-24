'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoxSources, pickGame, parseEuro, parseNba, parseEspn, euroName } = require('../src/box-sources');

const START = Date.parse('2026-10-23T18:15:00Z') / 1000;
const query = (over = {}) => ({ tournamentId: 138, tournament: 'Euroleague', start: START,
  home: { name: 'Olympiacos BC', shortName: 'Olympiacos', nameCode: 'OLY' },
  away: { name: 'Fenerbahçe Beko', shortName: 'Fenerbahçe', nameCode: 'FEN' }, ...over });

const euroGames = { data: [
  { gameCode: 69, utcDate: '2026-10-23T18:45:00Z', local: { club: { name: 'Paris Basketball' } }, road: { club: { name: 'Valencia Basket' } } },
  { gameCode: 70, utcDate: '2026-10-23T18:15:00Z', local: { club: { name: 'Olympiacos Piraeus' } },
    road: { club: { name: 'Fenerbahce Tarfin Istanbul' } } },
] };
const euroBox = { Live: true, Stats: [
  { PlayersStats: [{ Player_ID: 'P003733   ', IsStarter: 1, Dorsal: '14', Player: 'VEZENKOV, ALEKSANDAR', Minutes: '12:30',
    Points: 11, FieldGoalsMade2: 2, FieldGoalsAttempted2: 3, FieldGoalsMade3: 2, FieldGoalsAttempted3: 5, FreeThrowsMade: 1,
    FreeThrowsAttempted: 2, OffensiveRebounds: 1, DefensiveRebounds: 3, TotalRebounds: 4, Assistances: 1, FoulsCommited: 2,
    Steals: 0, BlocksFavour: 0, Turnovers: 1 }] },
  { PlayersStats: [{ Player_ID: 'P000001', IsStarter: 0, Dorsal: '7', Player: 'YEDEK, OYUNCU', Minutes: 'DNP', Points: 0 }] },
] };

test('maç eşleştirme: sponsorlu adlar, başlama saati ve ters yazılmış ev/deplasman', () => {
  const games = euroGames.data.map((g) => ({ id: g.gameCode, start: Date.parse(g.utcDate) / 1000,
    home: { names: [g.local.club.name] }, away: { names: [g.road.club.name] } }));
  assert.equal(pickGame(query(), games).id, 70);
  assert.equal(pickGame(query({ start: START + 3 * 86400 }), games), null); // başka gün
  const swapped = pickGame(query({ home: query().away, away: query().home }), games);
  assert.deepEqual([swapped.id, swapped.swap], [70, true]);
  const nba = [{ id: '0022600006', start: START, home: { names: ['Philadelphia 76ers'], code: 'PHI' },
    away: { names: ['Cleveland Cavaliers'], code: 'CLE' } }];
  assert.equal(pickGame(query({ home: { name: 'Philadelphia 76ers', nameCode: 'PHI' },
    away: { name: 'Cleveland Cavaliers', nameCode: 'CLE' } }), nba).id, '0022600006');
});

test('kaynak yanıtları ortak oyuncu biçimine çevrilir', () => {
  const euro = parseEuro(euroBox, false);
  assert.equal(euro.live, true);
  assert.deepEqual(euro.players[0], { id: 'P003733', side: 'home', name: 'Aleksandar Vezenkov', num: '14', starter: true, played: true,
    stats: { points: 11, rebounds: 4, offRebounds: 1, defRebounds: 3, assists: 1, threes: 2, threesAtt: 5, twos: 2, twosAtt: 3,
      fgm: 4, fga: 8, ftm: 1, fta: 2, seconds: 750, fouls: 2, steals: 0, blocks: 0, turnovers: 1 } });
  assert.equal(euro.players[1].played, false);
  assert.equal(euro.players[1].stats, null);
  assert.equal(parseEuro(euroBox, true).players[0].side, 'away');
  assert.equal(euroName("O'NEALE, ROYCE"), "Royce O'Neale");

  const nba = parseNba({ game: { gameStatus: 2, homeTeam: { players: [{ personId: 1627759, name: 'Jaylen Brown', jerseyNum: '7',
    starter: '1', played: '1', statistics: { points: 21, reboundsTotal: 8, assists: 4, threePointersMade: 1,
      minutes: 'PT37M43.00S', foulsPersonal: 4, steals: 1, blocks: 0, turnovers: 4 } }] }, awayTeam: { players: [] } } }, false);
  assert.equal(nba.live, true);
  assert.equal(nba.players[0].stats.seconds, 2263);
  assert.equal(nba.players[0].stats.rebounds, 8);

  const espn = parseEspn({ header: { competitions: [{ status: { type: { state: 'in' } },
    competitors: [{ id: '20', homeAway: 'home' }, { id: '5', homeAway: 'away' }] }] },
  boxscore: { players: [{ team: { id: '5' }, statistics: [{ keys: ['minutes', 'points',
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'rebounds', 'assists', 'fouls', 'fieldGoalsMade-fieldGoalsAttempted'],
  athletes: [{ athlete: { id: '4066328', displayName: 'Jarrett Allen', jersey: '31' }, starter: true,
    stats: ['28', '14', '1-3', '7', '0', '1', '6-10'] }, { athlete: { id: '9', displayName: 'X' }, didNotPlay: true, stats: [] }] }] }] } }, false);
  assert.equal(espn.live, true);
  const allen = espn.players[0].stats;
  assert.deepEqual([espn.players[0].side, allen.points, allen.threes, allen.seconds, allen.fga, allen.twos, allen.twosAtt],
    ['away', 14, 1, 1680, 10, 5, 7]);
  assert.equal(espn.players[1].played, false);
});

test('lige göre kaynak seçilir, önbellek kullanılır; NBA kaynağı reddederse ESPN denenir ve NBA bekletilir', async () => {
  const calls = [];
  let now = 1_000_000;
  const responses = (url) => {
    if (url.includes('/games')) return euroGames;
    if (url.includes('Boxscore?gamecode=70&seasoncode=E2026')) return euroBox;
    if (url.includes('cdn.nba.com')) throw Object.assign(new Error('HTTP 403'), { status: 403 });
    if (url.includes('/nba/scoreboard')) return { events: [{ id: '401', date: '2026-10-23T18:15Z', competitions: [{ competitors: [
      { homeAway: 'home', team: { displayName: 'Philadelphia 76ers', abbreviation: 'PHI' } },
      { homeAway: 'away', team: { displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' } }] }] }] };
    if (url.includes('/nba/summary?event=401')) return { header: { competitions: [{ competitors: [{ id: '1', homeAway: 'home' }] }] },
      boxscore: { players: [{ team: { id: '1' }, statistics: [{ keys: ['points'], athletes: [{ athlete: { id: '7', displayName: 'A B' }, stats: ['3'] }] }] }] } };
    throw new Error(`beklenmeyen ${url}`);
  };
  const sources = createBoxSources({ now: () => now, fetchJson: async (url, headers) => { calls.push({ url, headers }); return responses(url); } });

  const euro = await sources.players(query());
  assert.equal(euro.source, 'euroleague');
  assert.equal(euro.gameId, 'E2026_70');
  assert.equal(euro.players.length, 2);
  await sources.players(query());
  assert.equal(calls.length, 2, 'maç listesi ve boxscore önbellekten');
  now += 11_000;
  await sources.players(query());
  assert.equal(calls.length, 3, 'boxscore 10 sn sonra yenilenir, sezon listesi önbellekte');

  const nbaQuery = query({ tournamentId: 132, tournament: 'NBA', home: { name: 'Philadelphia 76ers', nameCode: 'PHI' },
    away: { name: 'Cleveland Cavaliers', nameCode: 'CLE' } });
  const nba = await sources.players(nbaQuery);
  assert.equal(nba.source, 'espn');
  assert.ok(calls.some((c) => c.url.includes('cdn.nba.com') && c.headers?.Referer === 'https://www.nba.com/'));
  const before = calls.filter((c) => c.url.includes('cdn.nba.com')).length;
  now += 61_000;
  await sources.players(nbaQuery);
  assert.equal(calls.filter((c) => c.url.includes('cdn.nba.com')).length, before, '403 sonrası NBA bekletilir');

  assert.equal(await sources.players(query({ tournamentId: 1, tournament: 'BSL' })), null);
  assert.equal(await sources.players(query({ start: undefined })), null);
});
