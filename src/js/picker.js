'use strict';

/* Üstteki arama kutusu: canlı + bugünkü maçlar, lig filtresi, takım araması, link yapıştırma */

// Lig filtresinde yalnız bu ligler gösterilir (bu sırayla); Avrupa kupaları yalnız maç günlerinde. Diğer liglerin maçları "Tüm ligler" seçiliyken
// takım, lig ya da ülke adıyla aranarak yine bulunur.
const FEATURED_LEAGUES = [
  [52, 'Trendyol Süper Lig', 'Türkiye', 'tr'], [98, 'Trendyol 1. Lig', 'Türkiye', 'tr'],
  [17, 'Premier League', 'İngiltere', 'gb-eng'], [35, 'Bundesliga', 'Almanya', 'de'],
  [8, 'LaLiga', 'İspanya', 'es'], [34, 'Ligue 1', 'Fransa', 'fr'], [23, 'Serie A', 'İtalya', 'it'],
  [7, 'Şampiyonlar Ligi', 'Avrupa', 'eu'], [679, 'Avrupa Ligi', 'Avrupa', 'eu'], [17015, 'Konferans Ligi', 'Avrupa', 'eu'],
  [37, 'Eredivisie', 'Hollanda', 'nl'], [238, 'Liga Portugal', 'Portekiz', 'pt'], [38, 'Pro League', 'Belçika', 'be'],
  [36, 'Premiership', 'İskoçya', 'gb-sct'], [18, 'Championship', 'İngiltere', 'gb-eng'],
  [44, '2. Bundesliga', 'Almanya', 'de'], [54, 'LaLiga 2', 'İspanya', 'es'], [182, 'Ligue 2', 'Fransa', 'fr'],
  [53, 'Serie B', 'İtalya', 'it'], [45, 'Bundesliga', 'Avusturya', 'at'], [215, 'Super League', 'İsviçre', 'ch'],
  [185, 'Super League', 'Yunanistan', 'gr'], [39, 'Superliga', 'Danimarka', 'dk'], [202, 'Ekstraklasa', 'Polonya', 'pl'],
  [172, '1. Lig', 'Çekya', 'cz'],
].map(([id, name, category, flag], topRank) => ({ id, name, category, flag, topRank }));
const BASKET_FEATURED_LEAGUES = [
  [132, 'NBA', 'ABD', 'us'], [138, 'EuroLeague', 'Avrupa', 'eu'], [519, 'Basketbol Süper Ligi', 'Türkiye', 'tr'],
  [141, 'EuroCup', 'Avrupa', 'eu'], [9357, 'Şampiyonlar Ligi', 'FIBA', 'world'], [486, 'WNBA', 'ABD', 'us'],
].map(([id, name, category, flag], topRank) => ({ id, name, category, flag, topRank }));

// Avrupa kupaları yalnız kendi maç günlerinde listede (takvim theme.js UEFA_MATCH_DATES)
function featuredLeaguesForDate(date = new Date()) {
  if (state.pickerSport === 'basketball') return BASKET_FEATURED_LEAGUES;
  return typeof isUefaMatchDate === 'function'
    ? FEATURED_LEAGUES.filter((league) => isUefaMatchDate(league.id, date)) : FEATURED_LEAGUES;
}

// Ülke bayrakları uygulamaya gömülü (Windows bayrak emojisini göstermez; ek ağ isteği yok)
const FLAG_SVG = {
  tr: '<rect width="30" height="20" fill="#e30a17"/><circle cx="11" cy="10" r="5" fill="#fff"/><circle cx="12.25" cy="10" r="4" fill="#e30a17"/><polygon fill="#fff" points="15.60,10.00 17.35,9.38 17.40,7.53 18.52,9.00 20.30,8.47 19.25,10.00 20.30,11.53 18.52,11.00 17.40,12.47 17.35,10.62"/>',
  'gb-eng': '<rect width="30" height="20" fill="#fff"/><rect x="13" width="4" height="20" fill="#ce1124"/><rect y="8" width="30" height="4" fill="#ce1124"/>',
  'gb-sct': '<rect width="30" height="20" fill="#005eb8"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="3.2"/>',
  de: '<rect width="30" height="20" fill="#ffce00"/><rect width="30" height="13.33" fill="#dd0000"/><rect width="30" height="6.67" fill="#000"/>',
  es: '<rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/>',
  fr: '<rect width="30" height="20" fill="#ef4135"/><rect width="20" height="20" fill="#fff"/><rect width="10" height="20" fill="#0055a4"/>',
  it: '<rect width="30" height="20" fill="#ce2b37"/><rect width="20" height="20" fill="#fff"/><rect width="10" height="20" fill="#009246"/>',
  nl: '<rect width="30" height="20" fill="#21468b"/><rect width="30" height="13.33" fill="#fff"/><rect width="30" height="6.67" fill="#ae1c28"/>',
  pt: '<rect width="30" height="20" fill="#da291c"/><rect width="12" height="20" fill="#046a38"/><circle cx="12" cy="10" r="3.6" fill="#ffe900"/>',
  be: '<rect width="30" height="20" fill="#ef3340"/><rect width="20" height="20" fill="#fdda24"/><rect width="10" height="20" fill="#000"/>',
  at: '<rect width="30" height="20" fill="#ed2939"/><rect y="6.67" width="30" height="6.67" fill="#fff"/>',
  ch: '<rect width="30" height="20" fill="#d52b1e"/><rect x="13" y="4" width="4" height="12" fill="#fff"/><rect x="9" y="8" width="12" height="4" fill="#fff"/>',
  gr: '<rect width="30" height="20" fill="#0d5eaf"/><path d="M0 3.33h30M0 10h30M0 16.67h30" stroke="#fff" stroke-width="2.22"/><rect width="11.1" height="11.1" fill="#0d5eaf"/><path d="M5.55 0v11.1M0 5.55h11.1" stroke="#fff" stroke-width="2.22"/>',
  dk: '<rect width="30" height="20" fill="#c8102e"/><rect x="9" width="3" height="20" fill="#fff"/><rect y="8.5" width="30" height="3" fill="#fff"/>',
  pl: '<rect width="30" height="20" fill="#dc143c"/><rect width="30" height="10" fill="#fff"/>',
  cz: '<rect width="30" height="20" fill="#d7141a"/><rect width="30" height="10" fill="#fff"/><path d="M0 0L15 10L0 20Z" fill="#11457e"/>',
  eu: '<rect width="30" height="20" fill="#039"/><g fill="#fc0"><circle cx="21" cy="10" r=".9"/><circle cx="20.2" cy="13" r=".9"/><circle cx="18" cy="15.2" r=".9"/><circle cx="15" cy="16" r=".9"/><circle cx="12" cy="15.2" r=".9"/><circle cx="9.8" cy="13" r=".9"/><circle cx="9" cy="10" r=".9"/><circle cx="9.8" cy="7" r=".9"/><circle cx="12" cy="4.8" r=".9"/><circle cx="15" cy="4" r=".9"/><circle cx="18" cy="4.8" r=".9"/><circle cx="20.2" cy="7" r=".9"/></g>',
  us: '<rect width="30" height="20" fill="#b22234"/><path d="M0 2.3h30M0 5.4h30M0 8.5h30M0 11.6h30M0 14.7h30M0 17.8h30" stroke="#fff" stroke-width="1.54"/><rect width="13" height="10.8" fill="#3c3b6e"/>',
  world: '<rect width="30" height="20" fill="#2b3a4a"/><circle cx="15" cy="10" r="6.5" fill="none" stroke="#9fb3c8" stroke-width="1.2"/><path d="M8.5 10h13M15 3.5c-3 3.5-3 9.5 0 13M15 3.5c3 3.5 3 9.5 0 13" fill="none" stroke="#9fb3c8" stroke-width="1"/>',
};

function flagIcon(code) {
  const box = el('span', 'dd-flag');
  box.innerHTML = `<svg viewBox="0 0 30 20" preserveAspectRatio="none" aria-hidden="true">${FLAG_SVG[code] || FLAG_SVG.world}</svg>`;
  return box;
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
  const featured = featuredLeaguesForDate().map((league) => ({ ...league }));
  const selected = state.leagueFilter;
  if (selectedLeagueId() && !featured.some((league) => league.id === selectedLeagueId())) {
    // Eski sürümde listeden seçilmiş başka bir lig: seçim kaybolmasın, listede görünsün
    featured.push({
      id: selectedLeagueId(),
      name: typeof selected.name === 'string' && selected.name ? selected.name : `Lig #${selectedLeagueId()}`,
      category: typeof selected.category === 'string' ? selected.category : '',
      flag: selected.flag || 'world',
    });
  }
  return featured;
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
      && !state.leagueListOpen) renderDropdown();
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
  const label = el('span', 'dd-league-label', 'Lig');
  const leagues = availableLeagues();
  const current = leagues.find((league) => league.id === selectedLeagueId());
  const button = el('button', 'dd-league-btn' + (state.leagueListOpen ? ' open' : ''));
  button.type = 'button';
  button.id = 'leagueFilter';
  button.setAttribute('aria-label', 'Lig filtresi');
  button.setAttribute('aria-expanded', String(!!state.leagueListOpen));
  button.append(flagIcon(current ? current.flag : 'world'), el('span', 'dd-league-name', current ? current.name : 'Tüm ligler'));
  if (current?.category) button.append(el('small', null, current.category));
  button.append(el('span', 'dd-caret', '▾'));
  // mousedown + preventDefault: odak arama kutusunda kalır, liste kapanmaz
  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    state.leagueListOpen = !state.leagueListOpen;
    renderDropdown();
  });
  row.append(label, button);
  dd.append(row);
  if (!state.leagueListOpen) return;

  const choose = (league) => {
    state.leagueFilter = league ? { id: league.id, name: league.name, category: league.category, flag: league.flag } : null;
    state.leagueListOpen = false;
    save(leagueFilterKey(), state.leagueFilter);
    updateSearchPlaceholder();
    renderDropdown();
    $('#search').focus();
    if (league) loadLeagueMatches(league.id).then(() => {
      if (!$('#dropdown').hidden && selectedLeagueId() === league.id) renderDropdown();
    });
  };
  const list = el('div', 'dd-league-list');
  list.setAttribute('role', 'listbox');
  for (const league of [null, ...leagues]) {
    const on = league ? league.id === selectedLeagueId() : !selectedLeagueId();
    const item = el('button', 'dd-league-item' + (on ? ' on' : ''));
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(on));
    item.append(flagIcon(league ? league.flag : 'world'), el('span', 'dd-league-name', league ? league.name : 'Tüm ligler'));
    if (league?.category) item.append(el('small', null, league.category));
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      choose(league);
    });
    list.append(item);
  }
  dd.append(list);
  if (!state.leagueFilter) dd.append(el('div', 'dd-hint', 'Listede olmayan ligler: "Tüm ligler" seçiliyken takım, lig ya da ülke adıyla ara.'));
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
  state.leagueListOpen = false;
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
