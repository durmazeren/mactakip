'use strict';

/* Oyuncu verisi: kadro (lineups) + oyuncu istatistikleri + oyundan çıkanlar ve kartlar.
 * Canlı güncellemede yalnızca oyuncu hedefi olan maçlar için sorgulanır.
 * Basketbolda Sofascore oyuncu istatistiğini geç girdiği için desteklenen liglerde (NBA, WNBA,
 * EuroLeague, EuroCup) resmî canlı kaynak da çekilir; önde olan değer kullanılır, resmî düzeltmeye uyulur. */

/* Oyuncu hedefi marketleri: [anahtar, seçim listesindeki ad, Sofascore lineups istatistik alanı
 * (birleşik markette toplanan anahtarlar), seçim listesindeki grup].
 * Kart lineups'ta yok, olaylardan (incidents) sayılır. */
const FOOTBALL_PLAYER_STATS = [
  ['shots', 'Toplam şut', 'totalShots', 'Şut'], ['sot', 'İsabetli şut', 'onTargetScoringAttempt', 'Şut'],
  ['offTarget', 'İsabetsiz şut', 'shotOffTarget', 'Şut'], ['blocked', 'Bloklanan şut', 'blockedScoringAttempt', 'Şut'],
  ['goals', 'Gol', 'goals', 'Gol ve pas'], ['assists', 'Asist', 'goalAssist', 'Gol ve pas'],
  ['passes', 'Pas', 'totalPass', 'Gol ve pas'], ['keyPasses', 'Kilit pas', 'keyPass', 'Gol ve pas'],
  ['crosses', 'Orta', 'totalCross', 'Gol ve pas'], ['dribbles', 'Başarılı çalım', 'wonContest', 'Gol ve pas'],
  ['offsides', 'Ofsayt', 'totalOffside', 'Gol ve pas'],
  ['tackles', 'Müdahale', 'totalTackle', 'Savunma'], ['interceptions', 'Top kapma', 'interceptionWon', 'Savunma'],
  ['recoveries', 'Top kazanma', 'ballRecovery', 'Savunma'], ['clearances', 'Uzaklaştırma', 'totalClearance', 'Savunma'],
  ['saves', 'Kurtarış (kaleci)', 'saves', 'Savunma'],
  ['fouls', 'Faul', 'fouls', 'Disiplin'], ['wasFouled', 'Kazanılan faul', 'wasFouled', 'Disiplin'],
  ['cards', 'Kart (sarı / kırmızı)', null, 'Disiplin'],
];
const BASKET_PLAYER_STATS = [
  ['points', 'Sayı', 'points', 'Temel'], ['rebounds', 'Ribaund', 'rebounds', 'Temel'],
  ['assists', 'Asist', 'assists', 'Temel'], ['threes', "3'lük isabet", 'threePointsMade', 'Temel'],
  ['pra', 'Sayı + Ribaund + Asist', ['points', 'rebounds', 'assists'], 'Birleşik'],
  ['pr', 'Sayı + Ribaund', ['points', 'rebounds'], 'Birleşik'], ['pa', 'Sayı + Asist', ['points', 'assists'], 'Birleşik'],
  ['ra', 'Ribaund + Asist', ['rebounds', 'assists'], 'Birleşik'], ['stocks', 'Top çalma + Blok', ['steals', 'blocks'], 'Birleşik'],
  ['fga', 'Şut denemesi (saha içi)', 'fieldGoalAttempts', 'Şut'], ['fgm', 'Şut isabeti (saha içi)', 'fieldGoalsMade', 'Şut'],
  ['threesAtt', "3'lük deneme", 'threePointAttempts', 'Şut'], ['twosAtt', "2'lik deneme", 'twoPointAttempts', 'Şut'],
  ['twos', "2'lik isabet", 'twoPointsMade', 'Şut'], ['fta', 'Serbest atış denemesi', 'freeThrowAttempts', 'Şut'],
  ['ftm', 'Serbest atış isabeti', 'freeThrowsMade', 'Şut'],
  ['offRebounds', 'Hücum ribaundu', 'offensiveRebounds', 'Diğer'], ['defRebounds', 'Savunma ribaundu', 'defensiveRebounds', 'Diğer'],
  ['steals', 'Top çalma', 'steals', 'Diğer'], ['blocks', 'Blok', 'blocks', 'Diğer'],
  ['turnovers', 'Top kaybı', 'turnovers', 'Diğer'], ['fouls', 'Faul', 'personalFouls', 'Diğer'],
];
// Seçim listesi için gruplar: [[grup, [[anahtar, ad], ...]], ...]
const playerStatGroups = (list) => [...new Set(list.map((m) => m[3]))]
  .map((group) => [group, list.filter((m) => m[3] === group).map(([key, name]) => [key, name])]);
const BOX_SOURCE_MS = 10_000; // resmî kaynağa en sık istek

const playerLoads = new Map();
const players = new Map(); // matchId -> { available, list, stats, out }

const needsPlayers = (matchId) => state.targets.some((t) => t.kind === 'player' && t.matchId === matchId);

async function loadPlayers(matchId, includeIncidents = true) {
  const pending = playerLoads.get(matchId);
  if (pending) {
    if (includeIncidents && !pending.includeIncidents) return pending.promise.then(() => loadPlayers(matchId, true));
    return pending.promise;
  }
  const promise = fetchPlayers(matchId, includeIncidents).finally(() => playerLoads.delete(matchId));
  playerLoads.set(matchId, { promise, includeIncidents });
  return promise;
}

async function fetchPlayers(matchId, includeIncidents) {
  const [lineups, inc] = await Promise.all([
    api(`event/${matchId}/lineups`).catch(() => undefined),
    includeIncidents && !isBasket(matchId) ? api(`event/${matchId}/incidents`).catch(() => undefined) : null,
  ]);
  if (lineups === undefined) return players.get(matchId); // bağlantı hatası: eldekini koru
  const basket = isBasket(matchId);
  const prev = players.get(matchId);
  // Basketbolda faul limiti dolan oyuncu oyundan atılır (NBA/WNBA 6, FIBA 5)
  const ev = state.events.get(matchId);
  const foulLimit = [132, 486].includes(ev?.tournament?.uniqueTournament?.id) ? 6 : 5;
  const fresh = includeIncidents && inc !== undefined;
  const rec = { available: !!lineups, list: [], stats: new Map(), details: new Map(), alias: new Map(),
    loadedAt: Date.now(), foulLimit, source: null, box: prev?.box || null,
    formation: { home: lineups?.home?.formation, away: lineups?.away?.formation },
    out: fresh ? new Map() : (prev?.out || new Map()),
    cards: fresh ? new Map() : (prev?.cards || null),
    // Resmî kaynağın son değerleri ve düzeltilen (düşen) istatistikler, yüklemeler arasında korunur
    boxLast: prev?.boxLast || new Map(), boxFixed: prev?.boxFixed || new Set() };
  for (const side of ['home', 'away']) {
    for (const p of lineups?.[side]?.players || []) {
      const id = p.player?.id;
      if (!id) continue;
      rec.list.push({
        id,
        name: p.player.shortName || p.player.name,
        fullName: p.player.name,
        num: p.shirtNumber ?? p.jerseyNumber ?? p.player.jerseyNumber ?? '',
        side,
        starter: !p.substitute,
        position: p.player.position || '',
      });
      const s = p.statistics;
      // İstatistiği olan oyuncu sahaya çıkmış demek; değeri 0 olan alan hiç gelmiyor
      if (s && Object.keys(s).length) {
        rec.details.set(id, s);
        const markets = basket ? BASKET_PLAYER_STATS : FOOTBALL_PLAYER_STATS;
        const values = Object.fromEntries(markets.filter(([, , src]) => typeof src === 'string')
          .map(([key, , src]) => [key, s[src] ?? 0]));
        if (basket) {
          rec.stats.set(id, { ...values, seconds: s.secondsPlayed ?? 0 });
          if ((s.personalFouls ?? 0) >= foulLimit) rec.out.set(id, { minute: null, reason: 'fouls' });
        } else rec.stats.set(id, values);
      }
    }
  }
  if (rec.list.length) rec.source = 'Sofascore';
  for (const i of basket ? [] : inc?.incidents || []) {
    if (i.incidentType === 'substitution' && i.playerOut?.id) {
      rec.out.set(i.playerOut.id, { minute: i.time, reason: 'sub' });
    } else if (i.incidentType === 'card' && i.player?.id && !i.rescinded) {
      rec.cards.set(i.player.id, (rec.cards.get(i.player.id) || 0) + 1);
      if (['red', 'yellowRed'].includes(i.incidentClass)) rec.out.set(i.player.id, { minute: i.time, reason: 'red' });
    }
  }
  if (basket && ev && ev.status?.type !== 'notstarted') {
    rec.boxAt = prev?.boxAt || 0;
    if (Date.now() - rec.boxAt > BOX_SOURCE_MS) {
      rec.boxAt = Date.now();
      rec.box = await window.boxScore?.players?.(boxQuery(ev)).catch(() => null) || rec.box;
    }
    mergeBoxScore(rec, rec.box);
  }
  players.set(matchId, rec);
  return rec;
}

const boxQuery = (ev) => {
  const team = (t) => ({ name: t?.name, shortName: t?.shortName, nameCode: t?.nameCode });
  return { tournamentId: ev.tournament?.uniqueTournament?.id,
    tournament: ev.tournament?.uniqueTournament?.name || ev.tournament?.name,
    start: ev.startTimestamp, home: team(ev.homeTeam), away: team(ev.awayTeam) };
};

const surname = (name) => norm(name).replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').trim().split(/[\s.]+/).filter(Boolean).pop() || '';

// Yedek kaynaktaki oyuncunun Sofascore karşılığı: aynı takımda forma numarası ve soyadı
function matchBoxPlayer(list, bp, used) {
  const same = list.filter((p) => p.side === bp.side && !used.has(p.id));
  const last = surname(bp.name);
  const byNum = same.filter((p) => String(p.num) !== '' && String(p.num) === String(bp.num));
  const byName = same.filter((p) => last && [p.name, p.fullName].some((n) => surname(n) === last));
  return byNum.find((p) => byName.includes(p)) || (byNum.length === 1 ? byNum[0] : null)
    || (byName.length === 1 ? byName[0] : null);
}

/* Resmî kaynak ile Sofascore birleştirilir. Canlı ölçümde (EuroLeague, 23 Ekim) iki kaynak da
 * zaman zaman 30–70 sn önde gitti; bu yüzden her istatistikte büyük olan değer alınır. Resmî kaynak
 * bir değeri düşürürse (geri alınan ribaund vb. düzeltme) o istatistikte artık resmî değere uyulur.
 * Sofascore kadrosu hiç yoksa oyuncular resmî kaynaktan "kaynak:id" kimliğiyle eklenir;
 * Sofascore kadrosu sonradan gelince bu kimlik eşleşen Sofascore oyuncusuna yönlenir. */
function mergeBoxScore(rec, box) {
  if (!box?.players?.length) return rec;
  const sofaList = rec.list.length > 0;
  const used = new Set();
  let ahead = 0;
  for (const bp of box.players) {
    const extId = `${box.source}:${bp.id}`;
    const match = sofaList ? matchBoxPlayer(rec.list, bp, used) : null;
    if (sofaList && !match) continue;
    const id = match ? match.id : extId;
    if (match) { used.add(id); rec.alias.set(extId, id); }
    else rec.list.push({ id, name: bp.name, fullName: bp.name, num: bp.num, side: bp.side, starter: bp.starter, position: '' });
    if (!bp.stats) continue;
    const sofa = rec.stats.get(id) || {};
    const merged = { ...sofa };
    for (const [key, value] of Object.entries(bp.stats)) {
      if (typeof value !== 'number') continue;
      const k = `${id}|${key}`;
      if (rec.boxLast.has(k) && value < rec.boxLast.get(k)) rec.boxFixed.add(k);
      rec.boxLast.set(k, value);
      if (key !== 'seconds' && value > (sofa[key] ?? 0)) ahead++;
      merged[key] = rec.boxFixed.has(k) ? value : Math.max(value, sofa[key] ?? 0);
    }
    rec.stats.set(id, merged);
    const s = merged;
    rec.details.set(id, { ...rec.details.get(id), secondsPlayed: s.seconds, points: s.points, rebounds: s.rebounds,
      offensiveRebounds: s.offRebounds, defensiveRebounds: s.defRebounds, assists: s.assists,
      threePointsMade: s.threes, threePointAttempts: s.threesAtt, twoPointsMade: s.twos, twoPointAttempts: s.twosAtt,
      fieldGoalsMade: s.fgm, fieldGoalAttempts: s.fga, freeThrowsMade: s.ftm, freeThrowAttempts: s.fta,
      steals: s.steals, blocks: s.blocks, turnovers: s.turnovers, personalFouls: s.fouls });
    if (s.fouls >= rec.foulLimit) rec.out.set(id, { minute: null, reason: 'fouls' });
  }
  rec.available = rec.list.length > 0;
  rec.source = !sofaList ? box.label : ahead ? `${box.label} canlı (Sofascore geride)` : `${box.label} + Sofascore`;
  return rec;
}

const playerKey = (rec, id) => rec.alias?.get(id) ?? id;

// Oyuncunun hedefteki istatistiği: undefined = henüz yüklenmedi, null = kadro yok
function playerValue(t) {
  const rec = players.get(t.matchId);
  if (!rec) return undefined;
  if (!rec.available) return null;
  const id = playerKey(rec, t.playerId);
  if (t.stat === 'cards') return rec.cards ? rec.cards.get(id) ?? 0 : undefined;
  const stats = rec.stats.get(id);
  // Birleşik market (ör. sayı + ribaund + asist): parçaların toplamı
  const combo = BASKET_PLAYER_STATS.find(([key, , src]) => key === t.stat && Array.isArray(src));
  if (combo) return combo[2].reduce((sum, key) => sum + (stats?.[key] ?? 0), 0);
  return stats?.[t.stat] ?? 0;
}

function playerStatusText(t) {
  const rec = players.get(t.matchId);
  if (!rec?.available) return 'Kadro yok';
  const id = playerKey(rec, t.playerId);
  const source = rec.source && rec.source !== 'Sofascore' ? ` · ${rec.source}` : '';
  const out = rec.out.get(id);
  if (out) return out.reason === 'fouls' ? 'Faul limiti doldu'
    : out.reason === 'red' ? `Kırmızı kart ${out.minute}'` : `Oyundan çıktı ${out.minute}'`;
  const played = rec.stats.get(id);
  if (isBasket(t.matchId)) {
    if (played?.seconds) return `${Math.round(played.seconds / 60)} dk oynadı${source}`;
    const p = rec.list.find((x) => x.id === id);
    return (p && !p.starter ? 'Yedek' : 'İlk 5') + source;
  }
  if (played) return 'Sahada';
  const p = rec.list.find((x) => x.id === id);
  return p && !p.starter ? 'Yedek' : 'İlk 11';
}

const playerIsOut = (t) => {
  const rec = players.get(t.matchId);
  return !!rec?.out.get(playerKey(rec, t.playerId));
};
