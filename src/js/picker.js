'use strict';

/* Üstteki arama kutusu: canlı + bugünkü maçlar, lig filtresi, takım araması, link yapıştırma */

// Öne çıkanlarda yalnızca yerel ligler görünür; diğer turnuvalar altta kalır.
const FEATURED_LEAGUES = [
  [17, 'Premier League'], [8, 'LaLiga'], [35, 'Bundesliga'],
  [23, 'Serie A'], [34, 'Ligue 1'],
  [52, 'Trendyol Süper Lig'], [37, 'Eredivisie'], [238, 'Liga Portugal Betclic'],
].map(([id, name], topRank) => ({ id, name, category: '', topRank }));

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
  FEATURED_LEAGUES.forEach((u) => add(u, null, u.topRank));
  top.slice(0, 20).forEach((u) => add(u, null));
  for (const ev of live) add(ev.tournament?.uniqueTournament, ev.tournament);
  for (const s of scheduled) add(s.tournament?.uniqueTournament, s.tournament);
  for (const ev of today) add(ev.tournament?.uniqueTournament, ev.tournament);
  return [...leagues.values()].sort(leagueOrder);
}

function availableLeagues() {
  const catalog = state.catalog.leagues.length ? state.catalog.leagues : FEATURED_LEAGUES;
  const leagues = new Map(catalog.map((league) => [league.id, league]));
  for (const ev of state.searchResults) {
    const league = leagueFrom(ev.tournament?.uniqueTournament, ev.tournament);
    if (league && !leagues.has(league.id)) leagues.set(league.id, league);
  }
  const selected = state.leagueFilter;
  if (selectedLeagueId() && !leagues.has(selectedLeagueId())) {
    const featured = FEATURED_LEAGUES.find((league) => league.id === selectedLeagueId());
    leagues.set(selectedLeagueId(), {
      id: selectedLeagueId(),
      name: typeof selected.name === 'string' && selected.name ? selected.name : `Lig #${selectedLeagueId()}`,
      category: typeof selected.category === 'string' ? selected.category : '',
      ...(featured ? { topRank: featured.topRank } : {}),
    });
  }
  return [...leagues.values()].sort(leagueOrder);
}

function leagueLabel(league) {
  return [league.name, league.category].filter(Boolean).join(' · ');
}

async function loadCatalog(force = false) {
  const c = state.catalog;
  if (!force && Date.now() - c.loadedAt < CATALOG_TTL_MS) return;
  if (c.loading) return c.loading;
  c.loading = (async () => {
    const date = localDate();
    const [live, top, ...schedPages] = await Promise.all([
      api('sport/football/events/live').catch(() => null),
      api('config/top-unique-tournaments/TR/football').catch(() => null),
      ...[1, 2, 3].map((page) => api(`sport/football/scheduled-tournaments/${date}/page/${page}`).catch(() => null)),
    ]);
    c.live = (live?.events || []).sort(byPopularity);
    const scheduled = schedPages.flatMap((page) => page?.scheduled || []);
    c.leagues = collectLeagues(top?.uniqueTournaments || [], scheduled, c.live, []);
    if (!c.loadedAt && typeof document !== 'undefined' && !$('#dropdown').hidden && document.activeElement?.id !== 'leagueFilter') {
      renderDropdown();
    }

    // Bugünün maçları: popüler ligler + bugün maçı olan ilk ligler
    const ids = [];
    for (const u of top?.uniqueTournaments || []) ids.push(u.id);
    for (const s of scheduled) {
      const id = s.tournament?.uniqueTournament?.id;
      if (id) ids.push(id);
    }
    const uniq = [...new Set(ids)].slice(0, 40);
    const lists = await mapLimit(uniq, 6, (id) => api(`unique-tournament/${id}/scheduled-events/${date}`));
    const seen = new Set(c.live.map((e) => e.id));
    c.today = lists.flatMap((l) => l?.events || [])
      .filter((e) => localDate(new Date(e.startTimestamp * 1000)) === date && !seen.has(e.id) && seen.add(e.id))
      .sort((a, b) => a.startTimestamp - b.startTimestamp);
    c.leagues = collectLeagues(top?.uniqueTournaments || [], scheduled, c.live, c.today);
    c.loadedAt = Date.now();
  })().finally(() => { c.loading = null; });
  return c.loading;
}

// Seçilen ligin kendi fikstürünü getirir; genel listedeki ilk 40 lig sınırına bağlı değildir.
async function loadLeagueMatches(id, force = false) {
  if (!id) return;
  const c = state.catalog;
  const date = localDate();
  const old = c.leagueData;
  if (!force && old?.id === id && old.date === date) {
    if (old.loading) return old.loading;
    if (old.loadedAt && Date.now() - old.loadedAt < CATALOG_TTL_MS) return;
  }
  const data = { id, date, events: [], loadedAt: 0, loading: null, error: false, partial: false };
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
  searchTimer = setTimeout(async () => {
    const res = await api(`search/events?q=${encodeURIComponent(q)}&page=0`).catch(() => null);
    if ($('#search').value !== q) return;
    const now = Date.now() / 1000;
    state.searchResults = (res?.results || []).map((r) => r.entity)
      .filter((e) => e?.homeTeam && (isLive(e) || (e.startTimestamp > now - 4 * 3600 && e.startTimestamp < now + 3 * 86400)))
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
    save('leagueFilter', state.leagueFilter);
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

  dd.append(el('div', 'dd-hint', state.addMode === 'shot'
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
  const leagueData = c.leagueData?.id === selectedLeagueId() ? c.leagueData : null;
  const leagueLoading = selectedLeagueId() && (!leagueData || !!leagueData.loading);
  if (leagueLoading) dd.append(el('div', 'dd-hint', 'Ligin yaklaşan maçları yükleniyor…'));
  if (selectedLeagueId() && leagueData?.error) dd.append(el('div', 'dd-hint', 'Lig maçları alınamadı. Aramayı yeniden açınca tekrar denenecek.'));
  else if (selectedLeagueId() && leagueData?.partial) dd.append(el('div', 'dd-hint', 'Bazı günlerin maçları alınamadı. Aramayı yeniden açınca tekrar denenecek.'));
  if (!live.length && !today.length && !upcoming.length && !found.length && !leagueLoading && !leagueData?.error) {
    dd.append(el('div', 'dd-empty', c.loading || !c.loadedAt ? 'Maçlar yükleniyor…'
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
  if (!m && state.addMode === 'anim') {
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
  addMatch(ev.id, ev._linkOnly ? null : ev, anim);
  $('#search').value = '';
  state.searchResults = [];
  closeDropdown();
  $('#search').blur();
}

function updateSearchPlaceholder() {
  const s = $('#search');
  const league = state.leagueFilter;
  const prefix = selectedLeagueId() ? `${league.name || `Lig #${selectedLeagueId()}`} · ` : '';
  s.placeholder = prefix + (state.addMode === 'shot'
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
  if (state.addMode !== 'anim') {
    state.addMode = 'anim';
    updateSearchPlaceholder();
  }
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
