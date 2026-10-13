'use strict';

/* Maç paneli mevcut istatistikleri kullanır. Açık animasyon taşınmadan büyütülür.
 * Kadro yalnızca Oyuncular sekmesi açılınca, önbellekte yoksa istenir. */

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
  totalCross: 'Orta', accurateCross: 'İsabetli orta', aerialLost: 'Kaybedilen hava topu',
  duelLost: 'Kaybedilen mücadele', dispossessed: 'Top kaptırma', totalContest: 'Çalım denemesi',
  wonContest: 'Başarılı çalım', shotOffTarget: 'İsabetsiz şut',
  blockedScoringAttempt: 'Bloklanan şut', wonTackle: 'Başarılı müdahale',
  unsuccessfulTouch: 'Hatalı kontrol', wasFouled: 'Kazanılan faul', fouls: 'Faul',
  expectedGoalsOnTarget: 'İsabetli şut xG (xGOT)', totalKeeperSweeper: 'Kaleci çıkışı',
  accurateKeeperSweeper: 'Başarılı kaleci çıkışı', bestBallCarryProgression: 'En uzun ilerleme',
  totalProgressiveBallCarriesDistance: 'İleri top taşıma mesafesi',
};
const PLAYER_HIDDEN_KEYS = new Set(['ratingVersions', 'statisticsType']);
const RING_STAT_KEYS = new Set(['duelWonPercent', 'groundDuelsPercentage',
  'aerialDuelsPercentage', 'dribblesPercentage', 'wonTacklePercent']);

let statsModalMatchId = null;
let statsModalTab = 'ALL';
let statsModalView = 'team';
let statsModalSide = 'home';
let statsModalPlayerId = null;
let statsPreview = null;
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

function statNumber(item, side) {
  const value = item[side + 'Value'] ?? item[side];
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function statComparisonValue(item, side, hasRing) {
  const node = el('strong', `stats-${side}`);
  const text = statValue(item[side], item[side + 'Value']);
  if (hasRing && /^[\d.,]+\s*%$/.test(text.trim())) return node;
  const ratio = text.match(/^(.+?)\s*\(\s*([\d.,]+\s*%)\s*\)$/);
  if (ratio) {
    node.append(el('span', 'stats-value-main', ratio[1].trim()));
    if (!hasRing) node.append(el('small', 'stats-value-percent', ratio[2].replace(/\s+/g, '')));
  } else node.textContent = text;
  return node;
}

function statRingCount(item, side) {
  const text = statValue(item[side], item[side + 'Value']).trim();
  if (/^[\d.,]+\s*%$/.test(text)) return '';
  return text.replace(/\s*\(\s*[\d.,]+\s*%\s*\)$/, '');
}

function renderStatRow(item) {
  const home = statNumber(item, 'home');
  const away = statNumber(item, 'away');
  const max = Math.max(home, away, 1);
  const hasRing = RING_STAT_KEYS.has(item.key);
  const row = el('div', 'stats-comparison');
  if (hasRing) {
    row.append(el('div', 'stats-ring-label stats-label', STAT_NAMES[item.key] || item.name || item.key));
    const homePercent = statPercentage(item, 'home');
    const awayPercent = statPercentage(item, 'away');
    if (item.key === 'duelWonPercent') {
      const total = homePercent + awayPercent;
      const ring = el('div', 'stats-ring-shared');
      ring.setAttribute('role', 'img');
      ring.setAttribute('aria-label', `Ev sahibi %${Math.round(homePercent)}, deplasman %${Math.round(awayPercent)}`);
      ring.style.setProperty('--home-share', `${total ? homePercent / total * 100 : 50}%`);
      ring.append(
        el('span', 'home', `${Math.round(homePercent)}%`),
        el('span', 'away', `${Math.round(awayPercent)}%`),
      );
      const wrap = el('div', 'stats-ring-shared-wrap');
      wrap.append(ring);
      row.append(wrap);
    } else {
      const rings = el('div', 'stats-rings');
      for (const side of ['home', 'away']) {
        const value = side === 'home' ? homePercent : awayPercent;
        const pair = el('div', `stats-ring-side ${side}`);
        const count = statRingCount(item, side);
        const ring = el('span', `stats-ring ${side}`, `${Math.round(value)}%`);
        ring.style.setProperty('--ring-value', `${value}%`);
        if (side === 'home' && count) pair.append(el('strong', 'stats-ring-count', count));
        pair.append(ring);
        if (side === 'away' && count) pair.append(el('strong', 'stats-ring-count', count));
        rings.append(pair);
      }
      row.append(rings);
    }
    return row;
  }
  const heading = el('div', 'stats-comparison-heading');
  heading.append(
    statComparisonValue(item, 'home', false),
    el('span', 'stats-label', STAT_NAMES[item.key] || item.name || item.key),
    statComparisonValue(item, 'away', false),
  );
  row.append(heading);
  if (item.key === 'ballPossession') {
    const total = home + away || 1;
    const possession = el('div', 'stats-possession');
    const first = el('span', 'home');
    first.style.width = `${home / total * 100}%`;
    possession.append(first, el('span', 'away'));
    row.append(possession);
  } else {
    const bars = el('div', 'stats-bars');
    for (const [side, value] of [['home', home], ['away', away]]) {
      const track = el('span', `stats-track ${side}`);
      const fill = el('i');
      fill.style.width = `${Math.min(100, value / max * 100)}%`;
      track.append(fill);
      bars.append(track);
    }
    const combined = el('div', 'stats-ucl-bar');
    const total = home + away;
    for (const [side, value] of [['home', home], ['away', away]]) {
      const segment = el('span', side);
      segment.style.width = `${total ? value / total * 100 : 0}%`;
      combined.append(segment);
    }
    row.append(bars, combined);
  }
  return row;
}

function renderTeamStats(id) {
  const raw = state.statsRaw.get(id);
  if (!raw) return statsEmpty(state.events.get(id)?.status?.type === 'notstarted'
    ? 'Maç başlayınca istatistikler burada görünecek.'
    : state.stats.get(id)?.none
      ? 'Sofascore bu maç için ayrıntılı istatistik vermiyor.'
      : 'İstatistikler henüz alınamadı. Mevcut bağlantı durumunu kontrol et.');
  const block = raw.statistics?.find((item) => item.period === statsModalTab);
  if (!block?.groups?.length) return statsEmpty('Bu dönem için istatistik henüz yok.');
  const container = el('div', 'stats-groups');
  for (const group of block.groups) {
    if (!group.statisticsItems?.length) continue;
    const section = el('section', 'stats-group');
    section.append(el('h3', null, STAT_GROUP_NAMES[group.groupName] || group.groupName));
    for (const item of group.statisticsItems) section.append(renderStatRow(item));
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
      statsModalPlayerId = null;
      $('#statsBody').scrollTop = 0;
      renderStatsModal();
    });
    switcher.append(button);
  }
  root.append(switcher);
  const sidePlayers = rec.list.filter((item) => item.side === statsModalSide);
  if (!sidePlayers.some((item) => item.id === statsModalPlayerId)) statsModalPlayerId = sidePlayers[0]?.id ?? null;
  const starters = sidePlayers.filter((item) => item.starter);
  const formation = String(rec.formation?.[statsModalSide] || '');
  const bands = formation.split('-').map(Number);
  const hasFormation = starters.length === 11 && bands.length >= 3
    && bands.every((n) => n > 0) && bands.reduce((a, b) => a + b, 0) === 10;
  if (hasFormation) {
    const pitch = el('div', 'stats-lineup-pitch');
    pitch.append(el('span', 'stats-lineup-formation', `Diziliş ${formation}`));
    const keeper = starters.find((item) => item.position === 'G') || starters[0];
    const fieldPlayers = starters.filter((item) => item !== keeper);
    let offset = 0;
    const rows = [];
    for (const size of bands) { rows.push(fieldPlayers.slice(offset, offset + size)); offset += size; }
    for (const playersInRow of [...rows].reverse().concat([[keeper]])) {
      const row = el('div', 'stats-lineup-row');
      for (const player of playersInRow) row.append(playerPickerButton(player, rec));
      pitch.append(row);
    }
    root.append(pitch);
  } else {
    const list = el('div', 'stats-player-picker-list');
    for (const player of sidePlayers) list.append(playerPickerButton(player, rec));
    root.append(list.children.length ? list : statsEmpty('Bu takımın kadrosu henüz yok.'));
  }
  const bench = sidePlayers.filter((item) => !item.starter);
  if (bench.length && hasFormation) {
    const list = el('div', 'stats-bench');
    list.append(el('h3', null, 'Yedekler'));
    for (const player of bench) list.append(playerPickerButton(player, rec));
    root.append(list);
  }
  if (sidePlayers.length) {
    const index = sidePlayers.findIndex((item) => item.id === statsModalPlayerId);
    const player = sidePlayers[index];
    const detail = el('section', 'stats-player-detail');
    const head = el('div', 'stats-player-detail-head');
    const photo = playerAvatar(player, 'stats-player-photo');
    const heading = el('div');
    heading.append(el('h3', null, player.name), el('span', null, `${player.num || '–'} · ${player.starter ? 'İlk 11' : 'Yedek'}`));
    head.append(photo, heading);
    const data = rec.details.get(player.id);
    if (data?.rating != null) head.append(playerRating(data.rating));
    detail.append(head);
    if (data) {
      const values = el('div', 'stats-player-values');
      for (const [key, value] of Object.entries(data)) {
        if (PLAYER_HIDDEN_KEYS.has(key) || key.endsWith('ValueNormalized')
          || value == null || typeof value === 'object') continue;
        const row = el('div', 'stats-player-value');
        row.append(el('span', null, playerStatLabel(key)), el('strong', null, playerStatValue(value)));
        values.append(row);
      }
      detail.append(values);
    } else detail.append(el('div', 'stats-player-no-data', 'Henüz oyuncu istatistiği yok.'));
    const nav = el('div', 'stats-player-nav');
    const previous = el('button', 'stats-arrow', '‹');
    const next = el('button', 'stats-arrow', '›');
    previous.setAttribute('aria-label', 'Önceki oyuncu');
    next.setAttribute('aria-label', 'Sonraki oyuncu');
    previous.addEventListener('click', () => { statsModalPlayerId = sidePlayers[(index + sidePlayers.length - 1) % sidePlayers.length].id; renderStatsModal(); });
    next.addEventListener('click', () => { statsModalPlayerId = sidePlayers[(index + 1) % sidePlayers.length].id; renderStatsModal(); });
    nav.append(previous, el('span', null, `${index + 1} / ${sidePlayers.length} · ${player.name}`), next);
    detail.append(nav);
    root.append(detail);
  }
  const refresh = el('button', 'stats-player-refresh', statsModalPlayerRequests.has(id) ? 'Yenileniyor…' : '↻ Oyuncuları yenile');
  refresh.title = 'En fazla dakikada bir yenilenir';
  refresh.disabled = statsModalPlayerRequests.has(id);
  refresh.addEventListener('click', () => ensureModalPlayers(id, true));
  root.append(refresh);
  return root;
}

function playerPickerButton(player, rec) {
  const button = el('button', player.id === statsModalPlayerId ? 'stats-lineup-player on' : 'stats-lineup-player');
  button.dataset.playerId = String(player.id);
  const photo = playerAvatar(player);
  button.append(photo, el('span', null, `${player.num || ''} ${player.name}`.trim()));
  const rating = rec.details.get(player.id)?.rating;
  if (rating != null) button.append(playerRating(rating));
  button.addEventListener('click', () => {
    statsModalPlayerId = player.id;
    renderStatsModal();
    $('#statsBody').querySelector('.stats-player-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  return button;
}

function renderStatsModal() {
  const id = statsModalMatchId;
  if (id == null || !findMatch(id)) return;
  const ev = state.events.get(id);
  const body = $('#statsBody');
  const scroll = body.scrollTop;
  const focusedPlayer = document.activeElement?.dataset?.playerId;
  $('#statsTitle').textContent = ev
    ? `${teamName(ev.homeTeam)}  ${scoreText(ev)}  ${teamName(ev.awayTeam)}`
    : `Maç #${id}`;
  for (const side of ['Home', 'Away']) {
    const logo = $(`#stats${side}Logo`);
    const team = ev?.[side.toLowerCase() + 'Team'];
    logo.hidden = !team?.id;
    if (team?.id && logo.getAttribute('src') !== LOGO_URL(team.id)) logo.src = LOGO_URL(team.id);
  }
  $('#statsMeta').textContent = ev
    ? [ev.tournament?.uniqueTournament?.name || ev.tournament?.name, minuteText(ev)].filter(Boolean).join(' · ')
    : 'Veri bekleniyor';
  for (const button of $('#statsViews').children) {
    const active = button.dataset.statsView === statsModalView;
    button.classList.toggle('on', active);
    button.setAttribute('aria-selected', String(active));
  }
  $('#statsTabs').hidden = statsModalView === 'players';
  for (const button of $('#statsTabs').children) {
    const active = button.dataset.statsTab === statsModalTab;
    button.classList.toggle('on', active);
    button.setAttribute('aria-selected', String(active));
  }
  body.replaceChildren(statsModalView === 'players' ? renderPlayerStats(id) : renderTeamStats(id));
  body.scrollTop = scroll;
  if (focusedPlayer) body.querySelector(`[data-player-id="${focusedPlayer}"]`)?.focus({ preventScroll: true });
  const ids = cardOrder();
  const position = ids.indexOf(id);
  $('#statsMatchPosition').textContent = `${position + 1} / ${ids.length} · ${ev ? teamName(ev.homeTeam) + ' – ' + teamName(ev.awayTeam) : 'Maç #' + id}`;
  $('#statsPrevMatch').disabled = ids.length < 2;
  $('#statsNextMatch').disabled = ids.length < 2;
  syncStatsPreview(id);
}

function renderStatsModalIfOpen(id) {
  if (statsModalMatchId === id && $('#statsDialog').open) {
    renderStatsModal();
  }
}

function destroyStatsPreview() {
  if (!statsPreview) return;
  const previous = statsPreview;
  statsPreview = null;
  previous.el.classList.remove('stats-preview-active');
  previous.preview = false;
  if (!findMatch(previous.id)?.anim) destroyTile(previous.id);
  else scheduleFit(previous);
}

function syncStatsPreview(id) {
  const top = $('#grid').getBoundingClientRect().top;
  document.body.style.setProperty('--stats-top', `${top}px`);
  if (statsPreview?.id === id) return;
  destroyStatsPreview();
  let tile = state.tiles.get(id);
  // Şut ekranına eklenmiş maç için yalnızca açık panel süresince bir animasyon.
  if (!tile) { createTile(id, true); tile = state.tiles.get(id); }
  statsPreview = tile;
  tile.preview = true;
  tile.el.classList.add('stats-preview-active');
  scheduleFit(tile);
}

function ensureModalPlayers(id, force = false) {
  if (!force && players.has(id)) return;
  const rec = players.get(id);
  // Sekme ve yenile düğmesi aynı kadroyu tekrar tekrar istemesin.
  if (force && rec?.loadedAt && Date.now() - rec.loadedAt < 60_000) return;
  if (statsModalPlayerRequests.has(id)) return;
  const request = loadPlayers(id, false).catch(() => null).finally(() => {
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
  statsModalView = 'team';
  statsModalSide = 'home';
  statsModalPlayerId = null;
  const dialog = $('#statsDialog');
  closeDropdown();
  document.body.classList.add('stats-open');
  $('#statsBackdrop').hidden = false;
  if (!dialog.open) dialog.show();
  $('#statsBody').scrollTop = 0;
  renderStatsModal();
  $('#statsClose').focus();
}

function stepStatsMatch(direction) {
  const ids = cardOrder();
  if (ids.length < 2) return;
  const index = ids.indexOf(statsModalMatchId);
  statsModalMatchId = ids[(index + direction + ids.length) % ids.length];
  statsModalSide = 'home';
  statsModalPlayerId = null;
  $('#statsBody').scrollTop = 0;
  renderStatsModal();
  if (statsModalView === 'players') ensureModalPlayers(statsModalMatchId);
}

function clearStatsPanel(restoreFocus = true) {
  const id = statsModalMatchId;
  statsModalMatchId = null;
  destroyStatsPreview();
  document.body.classList.remove('stats-open');
  $('#statsBackdrop').hidden = true;
  if (restoreFocus) shotCards.get(id)?.title.focus();
}

function closeStatsModal(restoreFocus = true) {
  const dialog = $('#statsDialog');
  if (!dialog.open) return;
  clearStatsPanel(restoreFocus);
  dialog.close();
}

function initStatsModal() {
  const dialog = $('#statsDialog');
  $('#statsClose').addEventListener('click', () => closeStatsModal());
  $('#statsPrevMatch').addEventListener('click', () => stepStatsMatch(-1));
  $('#statsNextMatch').addEventListener('click', () => stepStatsMatch(1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeStatsModal(); }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button:not(:disabled)')].filter((node) => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  dialog.addEventListener('close', () => {
    if (statsModalMatchId != null) clearStatsPanel();
  });
  $('#statsBackdrop').addEventListener('click', () => closeStatsModal());
  window.addEventListener('resize', () => { if (dialog.open) syncStatsPreview(statsModalMatchId); });
  $('#statsViews').addEventListener('click', (event) => {
    const button = event.target.closest('[data-stats-view]');
    if (!button || statsModalMatchId == null) return;
    statsModalView = button.dataset.statsView;
    if (statsModalView === 'players') statsModalTab = 'ALL';
    $('#statsBody').scrollTop = 0;
    renderStatsModal();
    if (statsModalView === 'players') ensureModalPlayers(statsModalMatchId);
  });
  $('#statsTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-stats-tab]');
    if (!button || statsModalMatchId == null) return;
    statsModalTab = button.dataset.statsTab;
    $('#statsBody').scrollTop = 0;
    renderStatsModal();
  });
}

function playerAvatar(player, className = 'stats-player-avatar') {
  const avatar = el('span', className, player.num || player.name?.split(' ').map((part) => part[0]).slice(0, 2).join('') || '–');
  avatar.setAttribute('aria-hidden', 'true');
  return avatar;
}

function playerRating(value) {
  const badge = el('strong', 'stats-player-rating', playerStatValue(value));
  badge.dataset.grade = Number(value) >= 8 ? 'high' : Number(value) < 7 ? 'low' : 'normal';
  return badge;
}

function statPercentage(item, side) {
  const percentage = String(item[side] || '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (percentage) return Math.min(100, Number(percentage[1].replace(',', '.')));
  const total = Number(item[side + 'Total']);
  return Math.min(100, total > 0 ? statNumber(item, side) / total * 100 : statNumber(item, side));
}
