'use strict';

/* Oyuncu verisi: kadro (lineups) + oyuncu şut istatistikleri + oyundan çıkanlar.
 * Canlı güncellemede yalnızca oyuncu hedefi olan maçlar için sorgulanır. */

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
  // Basketbolda faul limiti dolan oyuncu oyundan atılır (NBA/WNBA 6, FIBA 5)
  const ev = state.events.get(matchId);
  const foulLimit = [132, 486].includes(ev?.tournament?.uniqueTournament?.id) ? 6 : 5;
  const rec = { available: !!lineups, list: [], stats: new Map(), details: new Map(),
    loadedAt: Date.now(),
    formation: { home: lineups?.home?.formation, away: lineups?.away?.formation },
    out: includeIncidents && inc !== undefined ? new Map() : (players.get(matchId)?.out || new Map()) };
  for (const side of ['home', 'away']) {
    for (const p of lineups?.[side]?.players || []) {
      const id = p.player?.id;
      if (!id) continue;
      rec.list.push({
        id,
        name: p.player.shortName || p.player.name,
        num: p.shirtNumber ?? p.jerseyNumber ?? p.player.jerseyNumber ?? '',
        side,
        starter: !p.substitute,
        position: p.player.position || '',
      });
      const s = p.statistics;
      // İstatistiği olan oyuncu sahaya çıkmış demek; isabetli şutu yoksa alan hiç gelmiyor
      if (s && Object.keys(s).length) {
        rec.details.set(id, s);
        if (basket) {
          rec.stats.set(id, { points: s.points ?? 0, rebounds: s.rebounds ?? 0, assists: s.assists ?? 0,
            threes: s.threePointsMade ?? 0, seconds: s.secondsPlayed ?? 0 });
          if ((s.personalFouls ?? 0) >= foulLimit) rec.out.set(id, { minute: null, reason: 'fouls' });
        } else rec.stats.set(id, { shots: s.totalShots ?? 0, sot: s.onTargetScoringAttempt ?? 0 });
      }
    }
  }
  for (const i of basket ? [] : inc?.incidents || []) {
    if (i.incidentType === 'substitution' && i.playerOut?.id) {
      rec.out.set(i.playerOut.id, { minute: i.time, reason: 'sub' });
    } else if (i.incidentType === 'card' && ['red', 'yellowRed'].includes(i.incidentClass) && i.player?.id) {
      rec.out.set(i.player.id, { minute: i.time, reason: 'red' });
    }
  }
  players.set(matchId, rec);
  return rec;
}

// Oyuncunun hedefteki istatistiği: undefined = henüz yüklenmedi, null = kadro yok
function playerValue(t) {
  const rec = players.get(t.matchId);
  if (!rec) return undefined;
  if (!rec.available) return null;
  return rec.stats.get(t.playerId)?.[t.stat] ?? 0;
}

function playerStatusText(t) {
  const rec = players.get(t.matchId);
  if (!rec?.available) return 'Kadro yok';
  const out = rec.out.get(t.playerId);
  if (out) return out.reason === 'fouls' ? 'Faul limiti doldu'
    : out.reason === 'red' ? `Kırmızı kart ${out.minute}'` : `Oyundan çıktı ${out.minute}'`;
  const played = rec.stats.get(t.playerId);
  if (isBasket(t.matchId)) {
    if (played?.seconds) return `${Math.round(played.seconds / 60)} dk oynadı`;
    const p = rec.list.find((x) => x.id === t.playerId);
    return p && !p.starter ? 'Yedek' : 'İlk 5';
  }
  if (played) return 'Sahada';
  const p = rec.list.find((x) => x.id === t.playerId);
  return p && !p.starter ? 'Yedek' : 'İlk 11';
}

const playerIsOut = (t) => !!players.get(t.matchId)?.out.get(t.playerId);
