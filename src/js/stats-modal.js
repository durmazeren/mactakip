'use strict';

/* Şut kartından açılan maç ve oyuncu istatistikleri. Ağ isteği yalnızca
 * oyuncu sekmesi ilk kez açıldığında (veya kullanıcı yenilediğinde) eklenir. */

const STAT_GROUP_NAMES = {
  'Match overview': 'Genel bakış',
  Shots: 'Şutlar',
  Attack: 'Hücum',
  Passes: 'Paslar',
  Duels: 'Mücadeleler',
  Defending: 'Savunma',
  Goalkeeping: 'Kaleci',
};
const STAT_NAMES = {
  ballPossession: 'Topla oynama', expectedGoals: 'Beklenen gol (xG)',
  expectedGoalsOnTarget: 'İsabetli şut xG', bigChanceCreated: 'Net pozisyon',
  totalShotsOnGoal: 'Toplam şut', shotsOnGoal: 'İsabetli şut',
  shotsOffGoal: 'İsabetsiz şut', blockedScoringAttempt: 'Bloklanan şut',
  hitWoodwork: 'Direkten dönen şut', totalShotsInsideBox: 'Ceza sahası içi şut',
  totalShotsOutsideBox: 'Ceza sahası dışı şut', cornerKicks: 'Korner',
  fouls: 'Faul', passes: 'Pas', accuratePasses: 'İsabetli pas',
  totalTackle: 'Toplam müdahale', freeKicks: 'Serbest vuruş',
  yellowCards: 'Sarı kart', redCards: 'Kırmızı kart', avgRating: 'Ortalama puan',
  bigChanceScored: 'Değerlendirilen net pozisyon',
  bigChanceMissed: 'Kaçırılan net pozisyon',
  accurateThroughBall: 'Ara pas', touchesInOppBox: 'Rakip ceza sahasında topla buluşma',
  fouledFinalThird: 'Hücum bölgesinde kazanılan faul', offsides: 'Ofsayt',
  throwIns: 'Taç', finalThirdEntries: 'Hücum bölgesine giriş',
  finalThirdPhaseStatistic: 'Hücum bölgesinde pas',
  accurateLongBalls: 'Uzun pas', accurateCross: 'Orta',
  duelWonPercent: 'Kazanılan mücadele', dispossessed: 'Top kaybı',
  groundDuelsPercentage: 'Yer mücadelesi',
  aerialDuelsPercentage: 'Hava mücadelesi',
  dribblesPercentage: 'Çalım', wonTacklePercent: 'Başarılı müdahale',
  interceptionWon: 'Top kapma', ballRecovery: 'Top kazanma',
  totalClearance: 'Uzaklaştırma', errorsLeadToShot: 'Şuta yol açan hata',
  goalkeeperSaves: 'Kurtarış', goalsPrevented: 'Önlenen gol',
  diveSaves: 'Kritik kurtarış', highClaims: 'Havadan alınan top',
  punches: 'Yumruklama', goalKicks: 'Aut atışı',
};
const PLAYER_STAT_NAMES = {
  minutesPlayed: 'Oynanan dakika', rating: 'Puan',
  totalShots: 'Şut', onTargetScoringAttempt: 'İsabetli şut',
  goals: 'Gol', goalAssist: 'Asist', expectedGoals: 'Beklenen gol (xG)',
  expectedAssists: 'Beklenen asist (xA)', totalPass: 'Pas',
  accuratePass: 'İsabetli pas', totalLongBalls: 'Uzun pas',
  accurateLongBalls: 'İsabetli uzun pas', keyPass: 'Kilit pas',
  touches: 'Topla buluşma', possessionLostCtrl: 'Top kaybı',
  duelWon: 'Kazanılan mücadele', aerialWon: 'Kazanılan hava topu',
  totalTackle: 'Müdahale', totalClearance: 'Uzaklaştırma',
  ballRecovery: 'Top kazanma', interceptionWon: 'Top kapma',
  saves: 'Kurtarış', savedShotsFromInsideTheBox: 'Ceza sahası içi kurtarış',
  goalsPrevented: 'Önlenen gol', goodHighClaim: 'Havadan alınan top',
  punches: 'Yumruklama', totalOwnHalfPasses: 'Kendi yarı sahasında pas',
  accurateOwnHalfPasses: 'Kendi yarı sahasında isabetli pas',
  totalOppositionHalfPasses: 'Rakip yarı sahada pas',
  accurateOppositionHalfPasses: 'Rakip yarı sahada isabetli pas',
  totalBallCarriesDistance: 'Top sürme mesafesi', ballCarriesCount: 'Top sürme sayısı',
  totalProgression: 'Topla ilerleme', progressiveBallCarriesCount: 'İleri top taşıma',
  keeperSaveValue: 'Kurtarış değeri',
};
const PLAYER_HIDDEN_KEYS = new Set(['ratingVersions', 'statisticsType']);

let statsModalMatchId = null;
let statsModalTab = 'ALL';
let statsModalSide = 'home';
const statsModalPlayerRequests = new Map();

function statValue(value, numeric) {
  if (value != null && value !== '') return String(value);
  if (numeric == null) return '–';
  return String(numeric);
}

function statsEmpty(message, retry = null) {
  const box = el('div', 'stats-empty');
  box.append(el('span', null, message));
  if (retry) {
    const button = el('button', 'btn btn-sm', 'Tekrar dene');
    button.addEventListener('click', retry);
    box.append(button);
  }
  return box;
}

function renderTeamStats(id) {
  const raw = state.statsRaw.get(id);
  if (!raw) return statsEmpty(state.stats.get(id)?.none
    ? 'Sofascore bu maç için ayrıntılı istatistik vermiyor.'
    : 'İstatistikler yükleniyor. Birazdan yeniden denenecek.',
  state.stats.get(id)?.none ? null : () => pollOne(id));
  const block = raw.statistics?.find((item) => item.period === statsModalTab);
  if (!block?.groups?.length) return statsEmpty('Bu dönem için istatistik henüz yok.');
  const container = el('div', 'stats-groups');
  for (const group of block.groups) {
    if (!group.statisticsItems?.length) continue;
    const section = el('section', 'stats-group');
    section.append(el('h3', null, STAT_GROUP_NAMES[group.groupName] || group.groupName));
    for (const item of group.statisticsItems) {
      const row = el('div', 'stats-row');
      row.append(
        el('span', 'stats-home', statValue(item.home, item.homeValue)),
        el('span', 'stats-label', STAT_NAMES[item.key] || item.name || item.key),
        el('span', 'stats-away', statValue(item.away, item.awayValue)),
      );
      section.append(row);
    }
    container.append(section);
  }
  return container.children.length ? container : statsEmpty('Bu dönem için istatistik henüz yok.');
}

function playerStatLabel(key) {
  return PLAYER_STAT_NAMES[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function playerStatValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value)
      : value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  }
  return String(value);
}

function renderPlayerStats(id) {
  const rec = players.get(id);
  const root = el('div', 'stats-players');
  if (!rec) {
    root.append(statsEmpty(statsModalPlayerRequests.has(id)
      ? 'Oyuncu istatistikleri yükleniyor…' : 'Oyuncu verisi alınamadı.',
    statsModalPlayerRequests.has(id) ? null : () => ensureModalPlayers(id, true)));
    return root;
  }
  if (!rec.available) {
    root.append(statsEmpty('Sofascore bu maç için oyuncu kadrosu vermiyor.',
      () => ensureModalPlayers(id, true)));
    return root;
  }
  const ev = state.events.get(id);
  const switcher = el('div', 'stats-player-switch');
  for (const side of ['home', 'away']) {
    const button = el('button', side === statsModalSide ? 'on' : '', teamName(ev?.[side + 'Team']));
    button.addEventListener('click', () => {
      statsModalSide = side;
      $('#statsBody').scrollTop = 0;
      renderStatsModal();
    });
    switcher.append(button);
  }
  const refresh = el('button', 'stats-player-refresh', statsModalPlayerRequests.has(id) ? 'Yenileniyor…' : '↻ Oyuncuları yenile');
  refresh.disabled = statsModalPlayerRequests.has(id);
  refresh.addEventListener('click', () => ensureModalPlayers(id, true));
  root.append(switcher, refresh);
  const expanded = new Set([...$('#statsBody').querySelectorAll('.stats-player[open]')].map((node) => node.dataset.playerId));
  const list = el('div', 'stats-player-list');
  for (const player of rec.list.filter((item) => item.side === statsModalSide)) {
    const details = el('details', 'stats-player');
    details.dataset.playerId = String(player.id);
    details.open = expanded.has(String(player.id));
    const summary = el('summary', 'stats-player-summary');
    summary.append(
      el('span', 'stats-player-number', player.num || '–'),
      el('span', 'stats-player-name', player.name),
      el('span', 'stats-player-status', player.starter ? 'İlk 11' : 'Yedek'),
    );
    const data = rec.details.get(player.id);
    if (data?.rating != null) summary.append(el('strong', 'stats-player-rating', playerStatValue(data.rating)));
    details.append(summary);
    if (data) {
      const values = el('div', 'stats-player-values');
      for (const [key, value] of Object.entries(data)) {
        if (PLAYER_HIDDEN_KEYS.has(key) || key.endsWith('ValueNormalized')
          || value == null || typeof value === 'object') continue;
        const row = el('div', 'stats-player-value');
        row.append(el('span', null, playerStatLabel(key)), el('strong', null, playerStatValue(value)));
        values.append(row);
      }
      details.append(values);
    } else {
      details.append(el('div', 'stats-player-no-data', 'Henüz oyuncu istatistiği yok.'));
    }
    list.append(details);
  }
  root.append(list.children.length ? list : statsEmpty('Bu takımın oyuncu listesi henüz yok.'));
  return root;
}

function renderStatsModal() {
  const id = statsModalMatchId;
  if (id == null || !findMatch(id)) return;
  const ev = state.events.get(id);
  $('#statsTitle').textContent = ev
    ? `${teamName(ev.homeTeam)}  ${scoreText(ev)}  ${teamName(ev.awayTeam)}`
    : `Maç #${id}`;
  $('#statsMeta').textContent = ev
    ? [ev.tournament?.uniqueTournament?.name || ev.tournament?.name, minuteText(ev)].filter(Boolean).join(' · ')
    : 'Veri bekleniyor';
  for (const button of $('#statsTabs').children) {
    const active = button.dataset.statsTab === statsModalTab;
    button.classList.toggle('on', active);
    button.setAttribute('aria-selected', String(active));
  }
  $('#statsBody').replaceChildren(statsModalTab === 'players' ? renderPlayerStats(id) : renderTeamStats(id));
}

function renderStatsModalIfOpen(id) {
  if (statsModalMatchId === id && $('#statsDialog').open) renderStatsModal();
}

function ensureModalPlayers(id, force = false) {
  if (!force && players.has(id)) return;
  if (statsModalPlayerRequests.has(id)) return;
  const request = loadPlayers(id, needsPlayers(id)).catch(() => null).finally(() => {
    statsModalPlayerRequests.delete(id);
    renderStatsModalIfOpen(id);
  });
  statsModalPlayerRequests.set(id, request);
  renderStatsModalIfOpen(id);
}

function openStatsModal(id) {
  if (!findMatch(id)) return;
  statsModalMatchId = id;
  statsModalTab = ['ALL', '1ST', '2ND'].includes(state.period) ? state.period : 'ALL';
  statsModalSide = 'home';
  const dialog = $('#statsDialog');
  if (!dialog.open) dialog.showModal();
  $('#statsBody').scrollTop = 0;
  renderStatsModal();
  $('#statsClose').focus();
}

function closeStatsModal() {
  const dialog = $('#statsDialog');
  if (dialog.open) dialog.close();
}

function initStatsModal() {
  const dialog = $('#statsDialog');
  $('#statsClose').addEventListener('click', closeStatsModal);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeStatsModal();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('close', () => { statsModalMatchId = null; });
  $('#statsTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-stats-tab]');
    if (!button || statsModalMatchId == null) return;
    statsModalTab = button.dataset.statsTab;
    $('#statsBody').scrollTop = 0;
    renderStatsModal();
    if (statsModalTab === 'players') ensureModalPlayers(statsModalMatchId);
  });
}
