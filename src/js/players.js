'use strict';

/* Oyuncu verisi: kadro (lineups) + oyuncu şut istatistikleri + oyundan çıkanlar.
 * Canlı güncellemede yalnızca oyuncu hedefi olan maçlar için sorgulanır. */

const players = new Map(); // matchId -> { available, list, stats, out }

const needsPlayers = (matchId) => state.targets.some((t) => t.kind === 'player' && t.matchId === matchId);

async function loadPlayers(matchId, includeIncidents = true) {
  const [lineups, inc] = await Promise.all([
    api(`event/${matchId}/lineups`).catch(() => undefined),
    includeIncidents ? api(`event/${matchId}/incidents`).catch(() => undefined) : null,
  ]);
  if (lineups === undefined) return players.get(matchId); // bağlantı hatası: eldekini koru
  const rec = { available: !!lineups, list: [], stats: new Map(), details: new Map(),
    out: includeIncidents ? new Map() : (players.get(matchId)?.out || new Map()) };
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
      });
      const s = p.statistics;
      // İstatistiği olan oyuncu sahaya çıkmış demek; isabetli şutu yoksa alan hiç gelmiyor
      if (s && Object.keys(s).length) {
        rec.details.set(id, s);
        rec.stats.set(id, { shots: s.totalShots ?? 0, sot: s.onTargetScoringAttempt ?? 0 });
      }
    }
  }
  for (const i of inc?.incidents || []) {
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
  if (out) return out.reason === 'red' ? `Kırmızı kart ${out.minute}'` : `Oyundan çıktı ${out.minute}'`;
  if (rec.stats.has(t.playerId)) return 'Sahada';
  const p = rec.list.find((x) => x.id === t.playerId);
  return p && !p.starter ? 'Yedek' : 'İlk 11';
}

const playerIsOut = (t) => !!players.get(t.matchId)?.out.get(t.playerId);
