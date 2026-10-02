'use strict';

/* Üstteki arama kutusu: canlı + bugünkü maçlar, takım araması, link yapıştırma */

async function loadCatalog(force = false) {
  const c = state.catalog;
  if (!force && Date.now() - c.loadedAt < CATALOG_TTL_MS) return;
  if (c.loading) return c.loading;
  c.loading = (async () => {
    const date = localDate();
    const [live, top, sched] = await Promise.all([
      api('sport/football/events/live').catch(() => null),
      api('config/top-unique-tournaments/TR/football').catch(() => null),
      api(`sport/football/scheduled-tournaments/${date}/page/1`).catch(() => null),
    ]);
    c.live = (live?.events || []).sort(byPopularity);

    // Bugünün maçları: popüler ligler + bugün maçı olan ilk ligler
    const ids = [];
    for (const u of top?.uniqueTournaments || []) ids.push(u.id);
    for (const s of sched?.scheduled || []) {
      const id = s.tournament?.uniqueTournament?.id;
      if (id) ids.push(id);
    }
    const uniq = [...new Set(ids)].slice(0, 40);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const from = dayStart.getTime() / 1000, to = from + 86400;
    const lists = await mapLimit(uniq, 6, (id) => api(`unique-tournament/${id}/scheduled-events/${date}`));
    const seen = new Set(c.live.map((e) => e.id));
    c.today = lists.flatMap((l) => l?.events || [])
      .filter((e) => e.startTimestamp >= from && e.startTimestamp < to && !seen.has(e.id) && seen.add(e.id))
      .sort((a, b) => a.startTimestamp - b.startTimestamp);
    c.loadedAt = Date.now();
  })().finally(() => { c.loading = null; });
  return c.loading;
}

function byPopularity(a, b) {
  return (b.tournament?.uniqueTournament?.userCount || 0) - (a.tournament?.uniqueTournament?.userCount || 0);
}

let searchTimer = null;
function onSearchInput() {
  const q = $('#search').value;
  renderDropdown();
  clearTimeout(searchTimer);
  state.searchResults = [];
  if (norm(q).length < 3 || parseEventId(q)) return;
  searchTimer = setTimeout(async () => {
    const res = await api(`search/events?q=${encodeURIComponent(q)}&page=0`).catch(() => null);
    const now = Date.now() / 1000;
    state.searchResults = (res?.results || []).map((r) => r.entity)
      .filter((e) => e?.homeTeam && (isLive(e) || (e.startTimestamp > now - 4 * 3600 && e.startTimestamp < now + 3 * 86400)))
      .sort((a, b) => a.startTimestamp - b.startTimestamp);
    if ($('#search').value === q) renderDropdown();
  }, 400);
}

function matchesQuery(ev, q) {
  if (!q) return true;
  const hay = norm(`${ev.homeTeam?.name} ${ev.awayTeam?.name} ${ev.homeTeam?.shortName || ''} ${ev.awayTeam?.shortName || ''} ${ev.tournament?.name || ''}`);
  return norm(q).split(/\s+/).every((w) => hay.includes(w));
}

function renderDropdown() {
  const dd = $('#dropdown');
  const raw = $('#search').value.trim();
  dd.hidden = false;
  dd.replaceChildren();

  dd.append(el('div', 'dd-hint', state.addMode === 'shot'
    ? 'Tıkladığın maç sadece şut ekranına eklenir'
    : 'Tıkla: animasyon + şut ekranı  ·  "Şut" düğmesi: sadece şut ekranı'));

  const linkId = parseEventId(raw);
  if (linkId) {
    dd.append(el('div', 'dd-section', 'Link'), ddRow({ id: linkId, _linkOnly: true }));
    return;
  }

  const c = state.catalog;
  const live = c.live.filter((e) => matchesQuery(e, raw)).slice(0, 40);
  const today = c.today.filter((e) => matchesQuery(e, raw)).slice(0, 60);
  const known = new Set([...live, ...today].map((e) => e.id));
  const found = state.searchResults.filter((e) => !known.has(e.id)).slice(0, 15);

  if (live.length) dd.append(el('div', 'dd-section', `Canlı (${live.length})`), ...live.map(ddRow));
  if (today.length) dd.append(el('div', 'dd-section', 'Bugün'), ...today.map(ddRow));
  if (found.length) dd.append(el('div', 'dd-section', 'Arama sonuçları'), ...found.map(ddRow));
  if (!live.length && !today.length && !found.length) {
    dd.append(el('div', 'dd-empty', c.loading || !c.loadedAt ? 'Maçlar yükleniyor…'
      : raw ? 'Bulunamadı. Takım adını farklı yaz ya da Sofascore linkini yapıştır.' : 'Maç bulunamadı.'));
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
    teams.textContent = `${ev.homeTeam.name} – ${ev.awayTeam.name}`;
    teams.append(el('small', null, [ev.tournament?.category?.name, ev.tournament?.name].filter(Boolean).join(' · ')));
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
  $('#search').blur();
}

function openPicker(mode) {
  state.addMode = mode;
  const s = $('#search');
  s.placeholder = mode === 'shot'
    ? 'Şut ekranına maç ekle: takım ara veya link yapıştır…'
    : 'Takım ara veya Sofascore maç linki yapıştır…';
  s.focus();
  renderDropdown();
}

function closeDropdown() {
  $('#dropdown').hidden = true;
  if (state.addMode !== 'anim') {
    state.addMode = 'anim';
    $('#search').placeholder = 'Takım ara veya Sofascore maç linki yapıştır…';
  }
}

function initPicker() {
  const search = $('#search');
  search.addEventListener('focus', () => {
    renderDropdown();
    loadCatalog().then(() => { if (!$('#dropdown').hidden) renderDropdown(); });
  });
  search.addEventListener('input', onSearchInput);
  search.addEventListener('blur', () => setTimeout(closeDropdown, 120));
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
}
