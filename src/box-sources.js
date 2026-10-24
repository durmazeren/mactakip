'use strict';

/* Basketbol oyuncu istatistiği için resmî canlı kaynaklar. Sofascore oyuncu istatistiğini geç
 * girdiği için canlı maçta renderer buradan da ister (birleştirme kuralı players.js mergeBoxScore).
 * NBA: cdn.nba.com canlı boxscore (yalnız ücretsiz Maç Takip'te yedek olarak).
 * EuroLeague / EuroCup: resmî canlı istatistik servisi.
 * NBA ve WNBA için ikinci yedek: ESPN. */

const LEAGUES = [
  { test: (t) => t.id === 132 || /^nba( cup| preseason)?$/i.test(t.name), sources: ['nba', 'espn:nba'] },
  { test: (t) => t.id === 486 || /^wnba$/i.test(t.name), sources: ['espn:wnba'] },
  { test: (t) => /euroleague/i.test(t.name) && !/women/i.test(t.name), sources: ['euroleague:E'] },
  { test: (t) => /eurocup/i.test(t.name) && !/women/i.test(t.name), sources: ['euroleague:U'] },
];
const LABELS = { nba: 'NBA', espn: 'ESPN', euroleague: 'EuroLeague' };
const NBA_HEADERS = { Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com' };
const TTL = { list: 60_000, season: 6 * 60 * 60_000, box: 10_000, summary: 20_000 };
const BLOCK_MS = 5 * 60_000;      // 403/429 alan kaynağa bir süre istek gönderilmez
const MATCH_WINDOW_S = 4 * 60 * 60; // başlama saati farkı en fazla

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/ß/g, 'ss');
const TEAM_STOP = new Set(['bc', 'bk', 'kk', 'fc', 'cb', 'sad', 'basket', 'basketball', 'club', 'the', 'and']);
const tokens = (...names) => new Set(names.flatMap((n) => fold(n).split(/[^a-z0-9]+/))
  .filter((w) => w.length >= 3 && !TEAM_STOP.has(w)));

// Sofascore takımı ile kaynaktaki takımın benzerliği: kod eşitliği veya ortak ad parçaları
function teamScore(sofa, names, code) {
  let score = code && sofa.nameCode && fold(code) === fold(sofa.nameCode) ? 3 : 0;
  const mine = tokens(sofa.name, sofa.shortName);
  for (const w of tokens(...names)) if (mine.has(w)) score++;
  return score;
}

// En iyi eşleşen maç; ev/deplasman ters yazılmışsa swap: true
function pickGame(q, games) {
  let best = null;
  for (const g of games) {
    if (!Number.isFinite(g.start) || Math.abs(g.start - q.start) > MATCH_WINDOW_S) continue;
    for (const swap of [false, true]) {
      const [h, a] = swap ? [g.away, g.home] : [g.home, g.away];
      const sh = teamScore(q.home, h.names, h.code);
      const sa = teamScore(q.away, a.names, a.code);
      if (!sh || !sa) continue;
      const score = sh + sa - (swap ? 0.5 : 0);
      if (!best || score > best.score) best = { id: g.id, swap, score };
    }
  }
  return best;
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
// "JONES, CARLIK" → "Carlik Jones"
const euroName = (s) => {
  const [last, first] = String(s || '').split(',').map((x) => x.trim());
  return titleCase(first ? `${first} ${last}` : last || '');
};
const clockSeconds = (s) => {
  const iso = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s || '');
  if (iso && (iso[1] || iso[2])) return Math.round(Number(iso[1] || 0) * 60 + Number(iso[2] || 0));
  const mm = /^(\d+):(\d+)$/.exec(String(s || '').trim());
  return mm ? Number(mm[1]) * 60 + Number(mm[2]) : 0;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// "6-10" → [6, 10]
const pair = (v) => String(v ?? '').split('-').map(num);
// Kaynaklardan gelen sayımları ortak biçime çevirir; isabet / deneme çiftleri [isabet, deneme]
const boxStats = ({ points, rebounds, off, def, assists, two, three, ft, seconds, fouls, steals, blocks, turnovers }) => ({
  points: num(points), rebounds: num(rebounds), offRebounds: num(off), defRebounds: num(def), assists: num(assists),
  threes: num(three[0]), threesAtt: num(three[1]), twos: num(two[0]), twosAtt: num(two[1]),
  fgm: num(two[0]) + num(three[0]), fga: num(two[1]) + num(three[1]), ftm: num(ft[0]), fta: num(ft[1]),
  seconds, fouls: num(fouls), steals: num(steals), blocks: num(blocks), turnovers: num(turnovers),
});

function parseNba(json, swap) {
  const game = json?.game;
  if (!game) return null;
  const players = [];
  for (const [key, side] of [['homeTeam', 'home'], ['awayTeam', 'away']]) {
    for (const p of game[key]?.players || []) {
      const s = p.statistics || {};
      const played = p.played === '1' || num(s.points) > 0 || clockSeconds(s.minutes) > 0;
      players.push({ id: String(p.personId), side: flip(side, swap), name: p.name, num: String(p.jerseyNum ?? ''),
        starter: p.starter === '1', played, stats: played ? boxStats({
          points: s.points, rebounds: s.reboundsTotal, off: s.reboundsOffensive, def: s.reboundsDefensive,
          assists: s.assists, two: [s.twoPointersMade, s.twoPointersAttempted], three: [s.threePointersMade, s.threePointersAttempted],
          ft: [s.freeThrowsMade, s.freeThrowsAttempted], seconds: clockSeconds(s.minutes), fouls: s.foulsPersonal,
          steals: s.steals, blocks: s.blocks, turnovers: s.turnovers }) : null });
    }
  }
  return { live: game.gameStatus === 2, players };
}

function parseEuro(json, swap) {
  if (!Array.isArray(json?.Stats)) return null;
  const players = [];
  json.Stats.slice(0, 2).forEach((team, i) => {
    const side = flip(i === 0 ? 'home' : 'away', swap);
    for (const p of team.PlayersStats || []) {
      const seconds = clockSeconds(p.Minutes);
      const played = seconds > 0 || num(p.Points) > 0;
      players.push({ id: String(p.Player_ID || '').trim(), side, name: euroName(p.Player), num: String(p.Dorsal ?? '').trim(),
        starter: num(p.IsStarter) === 1, played, stats: played ? boxStats({
          points: p.Points, rebounds: p.TotalRebounds, off: p.OffensiveRebounds, def: p.DefensiveRebounds,
          assists: p.Assistances, two: [p.FieldGoalsMade2, p.FieldGoalsAttempted2], three: [p.FieldGoalsMade3, p.FieldGoalsAttempted3],
          ft: [p.FreeThrowsMade, p.FreeThrowsAttempted], seconds, fouls: p.FoulsCommited, steals: p.Steals,
          blocks: p.BlocksFavour, turnovers: p.Turnovers }) : null });
    }
  });
  return { live: !!json.Live, players };
}

function parseEspn(json, swap) {
  const sides = new Map((json?.header?.competitions?.[0]?.competitors || []).map((c) => [String(c.id ?? c.team?.id), c.homeAway]));
  const players = [];
  for (const team of json?.boxscore?.players || []) {
    const side = sides.get(String(team.team?.id));
    const block = team.statistics?.[0];
    if (!side || !block) continue;
    const keys = block.keys || [];
    const at = (stats, key) => stats?.[keys.indexOf(key)];
    for (const a of block.athletes || []) {
      const played = !a.didNotPlay && Array.isArray(a.stats) && a.stats.length > 0;
      const v = (key) => at(a.stats, key);
      // ESPN saha içi toplamı verir; 2'lik = saha içi − 3'lük
      const fg = pair(v('fieldGoalsMade-fieldGoalsAttempted'));
      const three = pair(v('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
      players.push({ id: String(a.athlete?.id ?? ''), side: flip(side, swap), name: a.athlete?.displayName || '',
        num: String(a.athlete?.jersey ?? ''), starter: !!a.starter, played, stats: played ? boxStats({
          points: v('points'), rebounds: v('rebounds'), off: v('offensiveRebounds'), def: v('defensiveRebounds'),
          assists: v('assists'), two: [num(fg[0]) - num(three[0]), num(fg[1]) - num(three[1])], three,
          ft: pair(v('freeThrowsMade-freeThrowsAttempted')), seconds: num(v('minutes')) * 60, fouls: v('fouls'),
          steals: v('steals'), blocks: v('blocks'), turnovers: v('turnovers') }) : null });
    }
  }
  const state = json?.header?.competitions?.[0]?.status?.type?.state;
  return { live: state === 'in', players };
}

const flip = (side, swap) => (swap ? (side === 'home' ? 'away' : 'home') : side);

function createBoxSources({ fetchJson, now = Date.now }) {
  const cache = new Map();   // url -> { at, data, promise }
  const blockedUntil = new Map(); // kaynak -> zaman

  async function get(source, url, ttl, headers) {
    if ((blockedUntil.get(source) || 0) > now()) throw new Error(`${source} bekletiliyor`);
    const hit = cache.get(url);
    if (hit?.promise) return hit.promise;
    if (hit && now() - hit.at < ttl) return hit.data;
    const promise = fetchJson(url, headers).then((data) => {
      cache.set(url, { at: now(), data });
      return data;
    }, (err) => {
      cache.delete(url);
      if (err?.status === 403 || err?.status === 429) blockedUntil.set(source, now() + BLOCK_MS);
      throw err;
    });
    cache.set(url, { ...hit, promise });
    return promise;
  }

  const providers = {
    async nba(q) {
      const sb = await get('nba', 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json', TTL.list, NBA_HEADERS);
      const games = (sb?.scoreboard?.games || []).map((g) => ({ id: g.gameId, start: Date.parse(g.gameTimeUTC) / 1000,
        home: { names: [`${g.homeTeam?.teamCity} ${g.homeTeam?.teamName}`, g.homeTeam?.teamName], code: g.homeTeam?.teamTricode },
        away: { names: [`${g.awayTeam?.teamCity} ${g.awayTeam?.teamName}`, g.awayTeam?.teamName], code: g.awayTeam?.teamTricode } }));
      const hit = pickGame(q, games);
      if (!hit) return null;
      const box = await get('nba', `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${hit.id}.json`, TTL.box, NBA_HEADERS);
      return { gameId: hit.id, ...parseNba(box, hit.swap) };
    },
    async espn(q, slug) {
      const day = (s) => new Date(s * 1000).toISOString().slice(0, 10).replace(/-/g, '');
      const days = [...new Set([day(q.start - 6 * 3600), day(q.start)])];
      const games = [];
      for (const d of days) {
        const sb = await get('espn', `https://site.api.espn.com/apis/site/v2/sports/basketball/${slug}/scoreboard?dates=${d}`, TTL.list);
        for (const e of sb?.events || []) {
          const cs = e.competitions?.[0]?.competitors || [];
          const team = (side) => {
            const t = cs.find((c) => c.homeAway === side)?.team || {};
            return { names: [t.displayName, t.shortDisplayName, t.location, t.name], code: t.abbreviation };
          };
          games.push({ id: e.id, start: Date.parse(e.date) / 1000, home: team('home'), away: team('away') });
        }
      }
      const hit = pickGame(q, games);
      if (!hit) return null;
      const sum = await get('espn', `https://site.api.espn.com/apis/site/v2/sports/basketball/${slug}/summary?event=${hit.id}`, TTL.summary);
      return { gameId: hit.id, ...parseEspn(sum, hit.swap) };
    },
    async euroleague(q, comp) {
      const d = new Date(q.start * 1000);
      const season = `${comp}${d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1}`;
      const list = await get('euroleague', `https://api-live.euroleague.net/v2/competitions/${comp}/seasons/${season}/games`, TTL.season);
      const club = (c) => ({ names: [c?.name, c?.editorialName, c?.abbreviatedName], code: c?.tvCode });
      const games = (list?.data || []).map((g) => ({ id: g.gameCode, start: Date.parse(g.utcDate) / 1000,
        home: club(g.local?.club), away: club(g.road?.club) }));
      const hit = pickGame(q, games);
      if (!hit) return null;
      const box = await get('euroleague', `https://live.euroleague.net/api/Boxscore?gamecode=${hit.id}&seasoncode=${season}`, TTL.box);
      return { gameId: `${season}_${hit.id}`, ...parseEuro(box, hit.swap) };
    },
  };

  async function players(q) {
    if (!q?.home || !q?.away || !Number.isFinite(q.start)) return null;
    const league = LEAGUES.find((l) => l.test({ id: q.tournamentId, name: String(q.tournament || '').trim() }));
    for (const spec of league?.sources || []) {
      const [source, arg] = spec.split(':');
      try {
        const box = await providers[source](q, arg);
        if (box?.players?.length) return { source, label: LABELS[source], fetchedAt: now(), ...box };
      } catch { /* sıradaki kaynağı dene */ }
    }
    return null;
  }

  return { players };
}

module.exports = { createBoxSources, pickGame, parseNba, parseEuro, parseEspn, euroName };
