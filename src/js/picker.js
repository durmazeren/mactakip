'use strict';

/* Üstteki arama kutusu: canlı + bugünkü maçlar, lig filtresi, takım araması, link yapıştırma */

// Yerel ligler her zaman önde; Şampiyonlar Ligi yalnızca fikstür günlerinde en üstte.
const FEATURED_LEAGUES = [
  [17, 'Premier League'], [8, 'LaLiga'], [35, 'Bundesliga'],
  [23, 'Serie A'], [34, 'Ligue 1'],
  [52, 'Trendyol Süper Lig'], [37, 'Eredivisie'], [238, 'Liga Portugal Betclic'],
].map(([id, name], topRank) => ({ id, name, category: '', topRank }));
const UCL_LEAGUE = { id: 7, name: 'Şampiyonlar Ligi', category: 'Avrupa', topRank: 0 };
const BASKET_FEATURED_LEAGUES = [
  [132, 'NBA', 'ABD'], [138, 'EuroLeague', 'Avrupa'], [519, 'Basketbol Süper Ligi', 'Türkiye'],
  [141, 'EuroCup', 'Avrupa'], [9357, 'Şampiyonlar Ligi', 'FIBA'], [486, 'WNBA', 'ABD'],
].map(([id, name, category], topRank) => ({ id, name, category, topRank }));

function featuredLeaguesForDate() {
  if (state.pickerSport === 'basketball') return BASKET_FEATURED_LEAGUES;
  const local = FEATURED_LEAGUES.map((league) => ({ ...league, topRank: league.topRank + 1 }));
  return typeof isUclMatchDate === 'function' && isUclMatchDate()
    ? [UCL_LEAGUE, ...local] : local;
}

function eventLeagueId(ev) {
  const id = Number(ev?.tournament?.uniqueTournament?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function selectedLeagueId() {
  const id = Number(state.leagueFilter?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function leagueFrom(unique, tournament) {
  const id = Number(unique?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: unique.name || tournament?.name || `Lig #${id}`,
    category: unique.category?.name || tournament?.category?.name || '',
  };
}

function leagueOrder(a, b) {
  const aTop = Number.isInteger(a.topRank);
  const bTop = Number.isInteger(b.topRank);
  if (aTop !== bTop) return aTop ? -1 : 1;
  if (aTop && a.topRank !== b.topRank) return a.topRank - b.topRank;
  return a.name.localeCompare(b.name, 'tr') || a.category.localeCompare(b.category, 'tr');
}

function collectLeagues(top, scheduled, live, today) {
  const leagues = new Map();
  const add = (unique, tournament, topRank = null) => {
    const league = leagueFrom(unique, tournament);
    if (!league) return;
    const old = leagues.get(league.id);
    if (!old) { leagues.set(league.id, { ...league, ...(topRank != null ? { topRank } : {}) }); return; }
    if (old.name.startsWith('Lig #') && !league.name.startsWith('Lig #')) old.name = league.name;
    if (!old.category && league.category) old.category = league.category;
    if (topRank != null) old.topRank = topRank;
  };
  featuredLeaguesForDate().forEach((u) => add(u, null, u.topRank));
  top.slice(0, 20).forEach((u) => add(u, null));
  for (const ev of live) add(ev.tournament?.uniqueTournament, ev.tournament);
  for (const s of scheduled) add(s.tournament?.uniqueTournament, s.tournament);
  for (const ev of today) add(ev.tournament?.uniqueTournament, ev.tournament);
  return [...leagues.values()].sort(leagueOrder);
}

function availableLeagues() {
  const featured = featuredLeaguesForDate();
  const featuredById = new Map(featured.map((league) => [league.id, league]));
  const catalog = state.catalog.leagues.length ? state.catalog.leagues : featured;
  const leagues = new Map(catalog.map((league) => {
    const current = { ...league };
    delete current.topRank;
    if (featuredById.has(league.id)) current.topRank = featuredById.get(league.id).topRank;
    return [league.id, current];
  }));
  for (const league of featured) {
    if (!leagues.has(league.id)) leagues.set(league.id, league);
  }
  for (const ev of state.searchResults) {
    const league = leagueFrom(ev.tournament?.uniqueTournament, ev.tournament);
    if (league && !leagues.has(league.id)) leagues.set(league.id, league);
  }
  const selected = state.leagueFilter;
  if (selectedLeagueId() && !leagues.has(selectedLeagueId())) {
    const selectedFeatured = featuredById.get(selectedLeagueId());
    leagues.set(selectedLeagueId(), {
      id: selectedLeagueId(),
      name: typeof selected.name === 'string' && selected.name ? selected.name : `Lig #${selectedLeagueId()}`,
      category: typeof selected.category === 'string' ? selected.category : '',
      ...(selectedFeatured ? { topRank: selectedFeatured.topRank } : {}),
    });
  }
  return [...leagues.values()].sort(leagueOrder);
}

function leagueLabel(league) {
  return [league.name, league.category].filter(Boolean).join(' · ');
}

function newCatalog(sport) {
  return { sport, live: [], today: [], leagues: [], leagueData: null, loadedAt: 0, lastAttemptAt: 0,
    date: null, loading: null, error: false, partial: false };
}

// Futbol / Basketbol: liste, lig filtresi ve öne çıkan ligler seçilen spora göre
function setPickerSport(sport) {
  if (sport === state.pickerSport) return;
  state.pickerSport = sport;
  save('pickerSport', sport);
  state.leagueFilter = load(leagueFilterKey(), null);
  state.catalog = newCatalog(sport);
  state.searchResults = [];
  updateSearchPlaceholder();
  renderDropdown();
  loadCatalog().then(() => { if (!$('#dropdown').hidden && state.pickerSport === sport) renderDropdown(); });
  const leagueId = selectedLeagueId();
  if (leagueId) loadLeagueMatches(leagueId).then(() => {
    if (!$('#dropdown').hidden && selectedLeagueId() === leagueId) renderDropdown();
  });
  onSearchInput();
}

const leagueFilterKey = () => state.pickerSport === 'basketball' ? 'leagueFilterBasketball' : 'leagueFilter';

async function loadCatalog(force = false) {
  if (state.catalog.sport !== state.pickerSport) state.catalog = newCatalog(state.pickerSport);
  const c = state.catalog;
  const sport = c.sport;
  const date = localDate();
  if (c.loading) return c.loading;
  if (!force && c.date === date && Date.now() - c.loadedAt < CATALOG_TTL_MS) return;
  if (!force && Date.now() - c.lastAttemptAt < 30_000) return;
  c.lastAttemptAt = Date.now();
  c.loading = (async () => {
    const [live, today] = await Promise.all([
      api(`sport/${sport}/events/live`).catch(() => undefined),
      api(`sport/${sport}/scheduled-events/${date}`).catch(() => undefined),
    ]);
    c.error = live === undefined && today === undefined;
    c.partial = !c.error && (live === undefined || today === undefined);
    if (live !== undefined) c.live = (live?.events || []).sort(byPopularity);
    if (today !== undefined) {
      const seen = new Set(c.live.map((ev) => ev.id));
      c.today = (today?.events || []).filter((ev) => ev?.id &&
        localDate(new Date(ev.startTimestamp * 1000)) === date && !seen.has(ev.id) && seen.add(ev.id))
        .sort((a, b) => a.startTimestamp - b.startTimestamp);
    }
    c.leagues = collectLeagues([], [], c.live, c.today);
    c.date = date;
    c.loadedAt = c.error ? 0 : Date.now();
  })().finally(() => {
    c.loading = null;
    if (typeof document !== 'undefined' && state.catalog === c && !$('#dropdown').hidden
      && document.activeElement?.id !== 'leagueFilter') renderDropdown();
  });
  return c.loading;
}

async function loadLeagueMatches(id, force = false) {
  if (!id) return;
  const c = state.catalog;
  const date = localDate();
  const old = c.leagueData;
  if (!force && old?.id === id && old.date === date && old.sport === c.sport) {
    if (old.loading) return old.loading;
    if (old.loadedAt && Date.now() - old.loadedAt < CATALOG_TTL_MS) return;
  }
  const data = { id, date, sport: c.sport, events: [], loadedAt: 0, loading: null, error: false, partial: false };
  c.leagueData = data;
  data.loading = (async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const dates = [0, 1, 2].map((offset) => {
      const day = new Date(start);
      day.setDate(start.getDate() + offset);
      return localDate(day);
    });
    // api() 404 için null döndürür: o gün maç yoktur. Ağ hatası ise undefined'dır.
    const lists = await Promise.all(dates.map((day) => api(`unique-tournament/${id}/scheduled-events/${day}`).catch(() => undefined)));
    const seen = new Set();
    data.events = lists.flatMap((list) => list?.events || [])
      .filter((ev) => ev?.id && !seen.has(ev.id) && seen.add(ev.id));
    data.error = lists.every((list) => list === undefined);
    data.partial = lists.some((list) => list === undefined);
    data.loadedAt = data.partial ? 0 : Date.now();
  })().finally(() => { data.loading = null; });
  return data.loading;
}

function byPopularity(a, b) {
  return (b.tournament?.uniqueTournament?.userCount || 0) - (a.tournament?.uniqueTournament?.userCount || 0);
}

let searchTimer = null;
function onSearchInput() {
  const q = $('#search').value;
  clearTimeout(searchTimer);
  state.searchResults = [];
  renderDropdown();
  if (norm(q).length < 3 || parseEventId(q)) return;
  const sport = state.pickerSport;
  $('#search').dataset.sport = sport;
  searchTimer = setTimeout(async () => {
    const res = await api(`search/events?q=${encodeURIComponent(q)}&page=0`).catch(() => null);
    if ($('#search').value !== q || $('#search').dataset.sport !== sport) return;
    const now = Date.now() / 1000;
    state.searchResults = (res?.results || []).map((r) => r.entity)
      .filter((e) => e?.homeTeam && (eventSport(e) || 'football') === sport && (isLive(e) || (e.startTimestamp > now - 4 * 3600 && e.startTimestamp < now + 3 * 86400)))
      .sort((a, b) => a.startTimestamp - b.startTimestamp);
    renderDropdown();
  }, 400);
}

function matchesQuery(ev, q) {
  if (!q) return true;
  const hay = norm(`${ev.homeTeam?.name} ${ev.awayTeam?.name} ${ev.homeTeam?.shortName || ''} ${ev.awayTeam?.shortName || ''} ${ev.tournament?.name || ''} ${ev.tournament?.uniqueTournament?.name || ''} ${ev.tournament?.category?.name || ''}`);
  return norm(q).split(/\s+/).every((w) => hay.includes(w));
}

function dropdownGroups(raw) {
  const c = state.catalog;
  const leagueId = selectedLeagueId();
  const leagueEvents = c.leagueData?.id === leagueId ? c.leagueData.events : [];
  const sameLeague = (ev) => !leagueId || eventLeagueId(ev) === leagueId;
  const visible = (ev) => ev?.id && sameLeague(ev) && matchesQuery(ev, raw);
  const seen = new Set();
  const take = (events, limit, predicate = () => true) => {
    const result = [];
    for (const ev of events) {
      if (!visible(ev) || !predicate(ev) || seen.has(ev.id)) continue;
      seen.add(ev.id);
      result.push(ev);
      if (result.length >= limit) break;
    }
    return result;
  };
  const live = take(leagueId ? [...c.live, ...leagueEvents.filter(isLive)] : c.live, 40,
    leagueId ? isLive : () => true);
  const today = take(leagueId ? [...c.today, ...leagueEvents].sort((a, b) => a.startTimestamp - b.startTimestamp) : c.today,
    60, leagueId ? (ev) => ev.status?.type === 'notstarted' && localDate(new Date(ev.startTimestamp * 1000)) === localDate() : () => true);
  const upcoming = leagueId ? take(leagueEvents.sort((a, b) => a.startTimestamp - b.startTimestamp), 60,
    (ev) => ev.status?.type === 'notstarted' && localDate(new Date(ev.startTimestamp * 1000)) > localDate()) : [];
  const found = take(state.searchResults, 15);
  return { live, today, upcoming, found };
}

function renderLeagueFilter(dd) {
  const row = el('div', 'dd-league-row');
  const sports = el('div', 'seg dd-sport');
  sports.setAttribute('role', 'tablist');
  sports.setAttribute('aria-label', 'Spor');
  for (const [sport, text] of Object.entries(SPORTS)) {
    const b = el('button', state.pickerSport === sport ? 'on' : null, text);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.pickerSport === sport));
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      setPickerSport(sport);
    });
    sports.append(b);
  }
  row.append(sports);
  const label = el('label', 'dd-league-label', 'Lig');
  const select = el('select', 'dd-league-select');
  label.htmlFor = select.id = 'leagueFilter';
  select.setAttribute('aria-label', 'Lig filtresi');
  const all = el('option', null, 'Tüm ligler');
  all.value = '';
  select.append(all);
  const leagues = availableLeagues();
  const topGroup = el('optgroup');
  topGroup.label = 'Öne çıkan ligler';
  const otherGroup = el('optgroup');
  otherGroup.label = 'Diğer ligler';
  for (const league of leagues) {
    const option = el('option', null, leagueLabel(league));
    option.value = String(league.id);
    (Number.isInteger(league.topRank) ? topGroup : otherGroup).append(option);
  }
  if (topGroup.children.length) select.append(topGroup);
  if (otherGroup.children.length) select.append(otherGroup);
  select.value = selectedLeagueId() ? String(selectedLeagueId()) : '';
  select.addEventListener('change', () => {
    const league = leagues.find((item) => item.id === Number(select.value));
    state.leagueFilter = league || null;
    save(leagueFilterKey(), state.leagueFilter);
    updateSearchPlaceholder();
    renderDropdown();
    $('#search').focus();
    if (league) loadLeagueMatches(league.id).then(() => {
      if (!$('#dropdown').hidden && selectedLeagueId() === league.id) renderDropdown();
    });
  });
  row.append(label, select);
  dd.append(row);
}

function renderDropdown() {
  const dd = $('#dropdown');
  const raw = $('#search').value.trim();
  dd.hidden = false;
  dd.replaceChildren();

  dd.append(el('div', 'dd-hint', state.replaceMatchId != null
    ? 'Yeni maçı seç: eski maç şut ekranında ve hedeflerde kalır'
    : state.addMode === 'shot'
    ? 'Tıkladığın maç sadece şut ekranına eklenir'
    : 'Tıkla: animasyon + şut ekranı  ·  "Şut" düğmesi: sadece şut ekranı'));
  renderLeagueFilter(dd);

  const linkId = parseEventId(raw);
  if (linkId) {
    dd.append(el('div', 'dd-section', 'Link'), ddRow({ id: linkId, _linkOnly: true }));
    return;
  }

  const c = state.catalog;
  const { live, today, upcoming, found } = dropdownGroups(raw);

  if (live.length) dd.append(el('div', 'dd-section', `Canlı (${live.length})`), ...live.map(ddRow));
  if (today.length) dd.append(el('div', 'dd-section', 'Bugün'), ...today.map(ddRow));
  if (upcoming.length) dd.append(el('div', 'dd-section', 'Yaklaşan (önümüzdeki 2 gün)'), ...upcoming.map(ddRow));
  if (found.length) dd.append(el('div', 'dd-section', 'Arama sonuçları'), ...found.map(ddRow));
  if (c.partial) dd.append(el('div', 'dd-hint', 'Maç listesinin bir kısmı alınamadı; eldeki maçlar gösteriliyor.'));
  const leagueData = c.leagueData?.id === selectedLeagueId() ? c.leagueData : null;
  const leagueLoading = selectedLeagueId() && (!leagueData || !!leagueData.loading);
  if (leagueLoading) dd.append(el('div', 'dd-hint', 'Ligin yaklaşan maçları yükleniyor…'));
  if (selectedLeagueId() && leagueData?.error) dd.append(el('div', 'dd-hint', 'Lig maçları alınamadı. Aramayı yeniden açınca tekrar denenecek.'));
  else if (selectedLeagueId() && leagueData?.partial) dd.append(el('div', 'dd-hint', 'Bazı günlerin maçları alınamadı. Aramayı yeniden açınca tekrar denenecek.'));
  if (!live.length && !today.length && !upcoming.length && !found.length && !leagueLoading && !leagueData?.error) {
    dd.append(el('div', 'dd-empty', c.loading ? 'Maçlar yükleniyor…' : c.error ? 'Sofascore maç listesi alınamıyor. Maç linki yapıştırarak animasyonu açabilirsin.' : !c.loadedAt ? 'Maçlar yükleniyor…'
      : raw ? selectedLeagueId() ? 'Bu ligde aramana uygun maç bulunamadı.' : 'Bulunamadı. Takım adını farklı yaz ya da Sofascore linkini yapıştır.'
        : selectedLeagueId() ? 'Bu ligde önümüzdeki 3 gün canlı veya yaklaşan maç yok.' : 'Maç bulunamadı.'));
  }
}

function ddRow(ev) {
  const m = findMatch(ev.id);
  const row = el('div', 'dd-item');
  const time = el('div', 'dd-time' + (isLive(ev) ? ' live' : ''));
  const teams = el('div', 'dd-teams');
  const right = el('div', 'dd-right');

  if (ev._linkOnly) {
    time.textContent = 'ID';
    teams.textContent = `Maç #${ev.id}`;
  } else {
    time.textContent = minuteText(ev);
    teams.textContent = `${ev.homeTeam?.name || '?'} – ${ev.awayTeam?.name || '?'}`;
    teams.append(el('small', null, [ev.tournament?.category?.name, ev.tournament?.uniqueTournament?.name || ev.tournament?.name].filter(Boolean).join(' · ')));
    if (ev.status?.type !== 'notstarted') right.append(el('span', 'dd-score', scoreText(ev)));
  }

  if (m) {
    right.append(el('span', 'dd-tag', m.anim ? '✓ Animasyon' : '✓ Şut'));
    row.classList.add('selected');
  }
  // "Şut" düğmesi: sadece şut ekranına ekle
  if (!m && state.addMode === 'anim' && state.replaceMatchId == null) {
    const shotBtn = el('button', 'dd-shot', 'Şut');
    shotBtn.title = 'Sadece şut ekranına ekle';
    shotBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pickMatch(ev, false);
    });
    right.append(shotBtn);
  }
  row.append(time, teams, right);
  row.addEventListener('mousedown', (e) => {
    e.preventDefault();
    pickMatch(ev, state.addMode === 'anim');
  });
  return row;
}

function pickMatch(ev, anim) {
  const replaceId = state.replaceMatchId;
  if (replaceId != null) replaceAnimation(replaceId, ev.id, ev._linkOnly ? null : ev);
  else addMatch(ev.id, ev._linkOnly ? null : ev, anim, !!ev._linkOnly);
  $('#search').value = '';
  state.searchResults = [];
  closeDropdown();
  $('#search').blur();
}

function openReplacePicker(id) {
  if (!findMatch(id)?.anim) return;
  state.replaceMatchId = id;
  openPicker('anim');
}

function updateSearchPlaceholder() {
  const s = $('#search');
  const league = state.leagueFilter;
  const prefix = (state.pickerSport === 'basketball' ? '🏀 ' : '')
    + (selectedLeagueId() ? `${league.name || `Lig #${selectedLeagueId()}`} · ` : '');
  s.placeholder = prefix + (state.replaceMatchId != null
    ? 'Bu animasyona yeni maç seç veya link yapıştır…'
    : state.addMode === 'shot'
    ? 'Şut ekranına maç ekle: takım ara veya link yapıştır…'
    : 'Takım ara veya Sofascore maç linki yapıştır…');
  s.classList.toggle('filtered', !!selectedLeagueId());
  s.title = selectedLeagueId() ? `Lig filtresi: ${leagueLabel(league)}` : '';
}

function openPicker(mode) {
  state.addMode = mode;
  const s = $('#search');
  updateSearchPlaceholder();
  s.focus();
  renderDropdown();
}

function closeDropdown() {
  $('#dropdown').hidden = true;
  state.replaceMatchId = null;
  state.addMode = 'anim';
  updateSearchPlaceholder();
}

function initPicker() {
  const search = $('#search');
  updateSearchPlaceholder();
  search.addEventListener('focus', () => {
    renderDropdown();
    loadCatalog().then(() => { if (!$('#dropdown').hidden) renderDropdown(); });
    const leagueId = selectedLeagueId();
    if (leagueId) loadLeagueMatches(leagueId).then(() => {
      if (!$('#dropdown').hidden && selectedLeagueId() === leagueId) renderDropdown();
    });
  });
  search.addEventListener('input', onSearchInput);
  search.addEventListener('blur', () => setTimeout(() => {
    if (!$('.picker').contains(document.activeElement)) closeDropdown();
  }, 120));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.blur(); return; }
    if (e.key === 'Enter') {
      const first = $('#dropdown .dd-item');
      if (first) first.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
    }
  });
  $('#addShot').addEventListener('mousedown', (e) => {
    e.preventDefault();
    openPicker('shot');
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.picker, #addShot')) closeDropdown();
  }, true);
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest('.picker, #addShot')) closeDropdown();
  });
}
