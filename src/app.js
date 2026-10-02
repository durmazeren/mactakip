'use strict';

const POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;          // başlamamış maçlar için
const MOMENTUM_RELOAD_MS = 60_000;    // atak grafiği kendi kendine güncellenmiyor
const CATALOG_TTL_MS = 60_000;
const MAX_ANIM = 12;
const MAX_TOTAL = 30;
const PARTITION = 'persist:sofa';     // ortak oturum: Sportradar dosyaları bir kez indirilip önbellekte kalır
const TRACKER_URL = (id) => `https://www.sofascore.com/api/v1/event/${id}/live-match-tracker`;
const MOMENTUM_URL = (id) => `https://widgets.sofascore.com/tr/embed/attackMomentum?id=${id}&widgetTheme=dark`;
const LOGO_URL = (teamId) => `https://img.sofascore.com/api/v1/team/${teamId}/image`;

// Animasyon sayfasını koyu temaya uydurmak için içine eklenen CSS
const STAGE_CSS = `
  html, body { background: #0b0f17 !important; overflow: hidden !important; }
  body:has(.widgets) { min-height: 100vh !important; align-items: center !important; }
  .sr-bb { background: transparent !important; }
  .is-embed > div > a:last-child { display: none !important; }
`;

const $ = (sel, root = document) => root.querySelector(sel);
const api = (path) => window.sofa.get(path);

const state = {
  matches: loadMatches(),            // [{ id, anim }] — anim: false ise sadece şut ekranında
  events: new Map(),                 // id -> son event verisi
  stats: new Map(),                  // id -> { ALL: {...}, '1ST': {...}, '2ND': {...} }
  lastPoll: new Map(),               // id -> son sorgu zamanı (ms)
  tiles: new Map(),                  // id -> animasyon kutusu durumu
  period: 'ALL',
  addMode: 'anim',                   // arama kutusundan seçilen maç nereye eklensin
  catalog: { live: [], today: [], loadedAt: 0, loading: null },
  searchResults: [],
  lastShown: new Map(),              // şut ekranında yanıp sönme için önceki değerler
};

/* ---------- Yardımcılar ---------- */

function loadMatches() {
  try {
    const saved = JSON.parse(localStorage.getItem('matches') || 'null');
    if (Array.isArray(saved)) return saved.filter((m) => Number.isInteger(m?.id)).map((m) => ({ id: m.id, anim: !!m.anim }));
    // Eski sürümden kalan liste: hepsi animasyonlu
    return JSON.parse(localStorage.getItem('selected') || '[]').filter(Number.isInteger).map((id) => ({ id, anim: true }));
  } catch { return []; }
}
function saveMatches() {
  try { localStorage.setItem('matches', JSON.stringify(state.matches)); } catch { /* yoksay */ }
}
const findMatch = (id) => state.matches.find((m) => m.id === id);
const animIds = () => state.matches.filter((m) => m.anim).map((m) => m.id);

function norm(s) {
  return (s || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clock(ts) {
  return new Date(ts * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function teamName(t) {
  return t?.shortName || t?.name || '?';
}

const STATUS_TR = {
  Postponed: 'Ertelendi', Canceled: 'İptal', Cancelled: 'İptal', Interrupted: 'Durdu',
  Abandoned: 'Yarıda kaldı', Suspended: 'Askıda', 'Awaiting extra time': 'Uzatma bekleniyor',
  'Extra time halftime': 'Uzatma arası', 'Awaiting penalties': 'Penaltı bekleniyor',
};
const statusText = (st) => STATUS_TR[st?.description] || st?.description || '';

function isLive(ev) { return ev?.status?.type === 'inprogress'; }
function isOver(ev) { return ['finished', 'canceled', 'postponed'].includes(ev?.status?.type); }

// Dakika metni: Sofascore'un periyot başlangıç zamanından hesaplanır
function minuteText(ev) {
  if (!ev) return '';
  const st = ev.status || {};
  if (st.type === 'notstarted') {
    const sameDay = localDate(new Date(ev.startTimestamp * 1000)) === localDate();
    return sameDay ? clock(ev.startTimestamp)
      : new Date(ev.startTimestamp * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + clock(ev.startTimestamp);
  }
  if (st.type === 'finished') return 'MS';
  if (st.type !== 'inprogress') return statusText(st);
  if (st.code === 31) return 'İY';
  if (st.code === 50) return 'Pen.';
  const periods = { 6: [0, 45], 7: [45, 90], 41: [90, 105], 42: [105, 120] };
  const p = periods[st.code];
  const start = ev.time?.currentPeriodStartTimestamp;
  if (!p || !start) return statusText(st) || 'Canlı';
  const elapsed = Math.max(1, Math.floor((Date.now() / 1000 - start) / 60) + 1 + p[0]);
  return elapsed > p[1] ? `${p[1]}+${elapsed - p[1]}'` : `${elapsed}'`;
}

function scoreText(ev) {
  if (!ev || ev.status?.type === 'notstarted') return '–';
  return `${ev.homeScore?.current ?? 0} - ${ev.awayScore?.current ?? 0}`;
}

function parseStats(json) {
  const out = {};
  for (const block of json?.statistics || []) {
    const items = block.groups.flatMap((g) => g.statisticsItems);
    const pick = (key) => {
      const it = items.find((i) => i.key === key);
      if (!it) return null;
      const h = it.homeValue ?? parseInt(it.home, 10);
      const a = it.awayValue ?? parseInt(it.away, 10);
      return [Number.isFinite(h) ? h : 0, Number.isFinite(a) ? a : 0];
    };
    out[block.period] = { shots: pick('totalShotsOnGoal'), sot: pick('shotsOnGoal') };
  }
  return out;
}

function parseEventId(text) {
  const t = text.trim();
  const m = t.match(/[#?&]id[:=](\d+)/) || t.match(/\/event\/(\d+)/) || t.match(/^(\d{5,})$/);
  return m ? Number(m[1]) : null;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function setStatus(text) { $('#status').textContent = text; }

/* ---------- Maç listesi (seçici) ---------- */

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

  const hint = el('div', 'dd-hint', state.addMode === 'shot'
    ? 'Tıkladığın maç sadece şut ekranına eklenir'
    : 'Tıkla: animasyon + şut ekranı  ·  "Şut" düğmesi: sadece şut ekranı');
  dd.append(hint);

  const linkId = parseEventId(raw);
  if (linkId) {
    dd.append(section('Link'), ddRow({ id: linkId, _linkOnly: true }));
    return;
  }

  const c = state.catalog;
  const live = c.live.filter((e) => matchesQuery(e, raw)).slice(0, 40);
  const today = c.today.filter((e) => matchesQuery(e, raw)).slice(0, 60);
  const known = new Set([...live, ...today].map((e) => e.id));
  const found = state.searchResults.filter((e) => !known.has(e.id)).slice(0, 15);

  if (live.length) dd.append(section(`Canlı (${live.length})`), ...live.map(ddRow));
  if (today.length) dd.append(section('Bugün'), ...today.map(ddRow));
  if (found.length) dd.append(section('Arama sonuçları'), ...found.map(ddRow));
  if (!live.length && !today.length && !found.length) {
    dd.append(el('div', 'dd-empty', c.loading || !c.loadedAt ? 'Maçlar yükleniyor…'
      : raw ? 'Bulunamadı. Takım adını farklı yaz ya da Sofascore linkini yapıştır.' : 'Maç bulunamadı.'));
  }
}

function section(text) { return el('div', 'dd-section', text); }

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
      pick(ev, false);
    });
    right.append(shotBtn);
  }
  row.append(time, teams, right);
  row.addEventListener('mousedown', (e) => {
    e.preventDefault();
    pick(ev, state.addMode === 'anim');
  });
  return row;
}

function pick(ev, anim) {
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
  if (state.addMode !== 'anim') openPickerReset();
}
function openPickerReset() {
  state.addMode = 'anim';
  $('#search').placeholder = 'Takım ara veya Sofascore maç linki yapıştır…';
}

/* ---------- Maç ekleme / çıkarma ---------- */

async function addMatch(id, ev, anim) {
  const existing = findMatch(id);
  if (existing) {
    if (anim && !existing.anim) setAnim(id, true);
    return;
  }
  if (state.matches.length >= MAX_TOTAL) { setStatus(`En fazla ${MAX_TOTAL} maç eklenebilir`); return; }
  if (anim && animIds().length >= MAX_ANIM) {
    setStatus(`Animasyon en fazla ${MAX_ANIM} maç; bu maç sadece şut ekranına eklendi`);
    anim = false;
  }
  if (!ev) {
    const res = await api(`event/${id}`).catch(() => null);
    if (!res?.event) { setStatus(`Maç bulunamadı (#${id})`); return; }
    ev = res.event;
  }
  if (findMatch(id)) return; // beklerken eklendiyse
  state.matches.push({ id, anim });
  state.events.set(id, ev);
  saveMatches();
  if (anim) createTile(id);
  layout();
  pollOne(id).then(() => renderShotList());
}

function setAnim(id, anim) {
  const m = findMatch(id);
  if (!m || m.anim === anim) return;
  if (anim && animIds().length >= MAX_ANIM) { setStatus(`Animasyon en fazla ${MAX_ANIM} maç`); return; }
  m.anim = anim;
  saveMatches();
  if (anim) createTile(id); else destroyTile(id);
  layout();
}

function removeMatch(id) {
  state.matches = state.matches.filter((m) => m.id !== id);
  saveMatches();
  destroyTile(id);
  state.events.delete(id);
  state.stats.delete(id);
  state.lastPoll.delete(id);
  layout();
}

/* ---------- Animasyon kutuları ---------- */

function gridShape(n) {
  if (n <= 1) return [1, 1];
  if (n === 2) return [2, 1];
  if (n === 3) return [3, 1];
  if (n === 4) return [2, 2];
  if (n <= 6) return [3, 2];
  if (n <= 8) return [4, 2];
  if (n === 9) return [3, 3];
  return [4, 3];
}

function layout() {
  const ids = animIds();
  const [cols, rows] = gridShape(ids.length);
  const grid = $('#grid');
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', rows);
  // Sıra CSS order ile verilir: webview DOM'da taşınırsa yeniden yüklenip bozuluyor
  ids.forEach((id, i) => {
    const t = state.tiles.get(id);
    if (t) t.el.style.order = i;
  });
  $('#empty').hidden = ids.length > 0;
  $('#empty h2').textContent = state.matches.length ? 'Animasyonlu maç yok' : 'Henüz maç seçilmedi';
  $('#empty p').textContent = state.matches.length
    ? 'Şut ekranındaki ▷ düğmesiyle bir maçın animasyonunu açabilirsin.'
    : 'Üstteki kutuya tıklayıp canlı ya da bugünkü maçlardan seç, veya bir Sofascore maç linki yapıştır.';
  renderShotList();
}

function createTile(id) {
  if (state.tiles.has(id)) return;
  const node = $('#tileTpl').content.firstElementChild.cloneNode(true);
  const tile = { id, el: node, mode: null, webview: null, ready: false, contentH: 0, timers: [], ro: null };
  $('.close', node).addEventListener('click', () => removeMatch(id));
  $('.to-shot', node).addEventListener('click', () => setAnim(id, false));
  tile.ro = new ResizeObserver(() => fitTile(tile));
  tile.ro.observe($('.stage', node));
  state.tiles.set(id, tile);
  $('#grid').append(node);
  updateTile(id);
}

function destroyTile(id) {
  const t = state.tiles.get(id);
  if (!t) return;
  t.ro.disconnect();
  t.timers.forEach(clearInterval);
  t.el.remove();
  state.tiles.delete(id);
}

function setStage(tile, mode) {
  if (tile.mode === mode) return;
  tile.mode = mode;
  const stage = $('.stage', tile.el);
  if (tile.webview) { tile.webview.remove(); tile.webview = null; tile.ready = false; }
  tile.timers.forEach(clearInterval);
  tile.timers = [];
  const ph = $('.placeholder', stage);
  const ev = state.events.get(tile.id);

  if (mode === 'wait') {
    ph.hidden = false;
    ph.replaceChildren(
      el('b', null, `Başlama ${minuteText(ev)}`),
      el('span', null, 'Animasyon maç başlayınca kendiliğinden açılır'),
    );
    $('.src', tile.el).textContent = '';
    return;
  }

  ph.hidden = true;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', PARTITION);
  wv.setAttribute('src', mode === 'tracker' ? TRACKER_URL(tile.id) : MOMENTUM_URL(tile.id));
  wv.addEventListener('dom-ready', () => {
    tile.ready = true;
    wv.insertCSS(STAGE_CSS).catch(() => {});
    fitTile(tile);
  });
  // Bağlantı koparsa veya sayfa çökerse kendini toparlasın
  wv.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) setTimeout(() => { if (tile.webview === wv) wv.reload(); }, 5000);
  });
  wv.addEventListener('render-process-gone', () => {
    setTimeout(() => { if (tile.webview === wv) wv.reload(); }, 2000);
  });
  if (mode === 'tracker') {
    // Animasyon yoksa (lisans yok, küçük lig) atak grafiğine geç
    wv.addEventListener('page-title-updated', (e) => {
      if (e.title === 'SR_NO_CONTENT') setStage(tile, 'momentum');
    });
    wv.addEventListener('did-navigate', (e) => {
      if (e.httpResponseCode >= 400) setStage(tile, 'momentum');
    });
  } else {
    // Atak grafiği açıldıktan sonra veri çekmiyor: canlı maçta dakikada bir yenile
    tile.timers.push(setInterval(() => {
      if (tile.ready && isLive(state.events.get(tile.id))) wv.reload();
    }, MOMENTUM_RELOAD_MS));
  }
  stage.append(wv);
  tile.webview = wv;
  tile.ready = false;
  tile.contentH = 0;
  // Widget içeriği yüklendikçe boyu değişiyor; birkaç saniyede bir yeniden sığdır
  tile.timers.push(setInterval(() => fitTile(tile), 3000));
  $('.src', tile.el).textContent = mode === 'tracker' ? 'Canlı animasyon' : 'Atak grafiği';
}

// İçeriği kutuya sığdırmak için webview yakınlaştırmasını ayarlar.
// Yakınlaştırma alan adı başına ortak; aynı türdeki kutular aynı boyutta olduğu için sorun olmuyor.
async function fitTile(tile) {
  const wv = tile.webview;
  if (!wv || !wv.isConnected || !tile.ready) return;
  const stage = $('.stage', tile.el);
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const baseW = tile.mode === 'tracker' ? 620 : 480;
  let content = 0;
  try {
    content = await wv.executeJavaScript(`(() => {
      const lmt = document.querySelector('.widgets');
      if (lmt) return lmt.getBoundingClientRect().height;
      const chart = document.querySelector('.is-embed a');
      return chart ? chart.getBoundingClientRect().bottom + 16 : 0;
    })()`);
  } catch { return; } // henüz yüklenmedi
  if (tile.webview !== wv) return; // bu arada kaynak değişti
  if (content > 50) tile.contentH = content;
  if (!tile.contentH) return; // içerik ölçülmeden yakınlaştırma yapma: diğer kutuları da etkiler
  const z = Math.max(0.25, Math.min(2, Math.min(w / baseW, h / tile.contentH)));
  try {
    if (Math.abs(wv.getZoomFactor() - z) > 0.01) wv.setZoomFactor(z);
  } catch { /* webview hazır değil */ }
}

function updateTile(id) {
  const tile = state.tiles.get(id);
  const ev = state.events.get(id);
  if (!tile || !ev) return;
  const node = tile.el;
  $('.home-name', node).textContent = teamName(ev.homeTeam);
  $('.away-name', node).textContent = teamName(ev.awayTeam);
  $('.home-name', node).title = ev.homeTeam?.name || '';
  $('.away-name', node).title = ev.awayTeam?.name || '';
  if (ev.homeTeam?.id && !$('.home-logo', node).src) $('.home-logo', node).src = LOGO_URL(ev.homeTeam.id);
  if (ev.awayTeam?.id && !$('.away-logo', node).src) $('.away-logo', node).src = LOGO_URL(ev.awayTeam.id);
  $('.score', node).textContent = scoreText(ev);
  const m = $('.minute', node);
  m.textContent = minuteText(ev);
  m.classList.toggle('live', isLive(ev));

  const all = state.stats.get(id)?.ALL;
  $('.tile-foot', node).classList.toggle('no-stats', !!state.stats.get(id)?.none);
  $('.shots', node).textContent = all?.shots ? `${all.shots[0]} – ${all.shots[1]}` : '–';
  $('.sot', node).textContent = all?.sot ? `${all.sot[0]} – ${all.sot[1]}` : '–';

  if (ev.status?.type === 'notstarted') {
    if (tile.mode !== 'wait') setStage(tile, 'wait');
    else $('.placeholder b', node).textContent = `Başlama ${minuteText(ev)}`;
  } else if (isOver(ev)) {
    // Maç bitince animasyon boş saha gösteriyor; maçın özeti olarak atak grafiğine geç
    if (tile.mode !== 'momentum') setStage(tile, 'momentum');
  } else if (tile.mode === 'wait' || tile.mode === null) {
    setStage(tile, 'tracker');
  }
}

/* ---------- Şut ekranı ---------- */

function renderShotList() {
  const list = $('#shotList');
  list.replaceChildren();
  if (!state.matches.length) {
    list.append(el('div', 'sc-empty', 'Seçtiğin maçların şut sayıları burada görünür. Sadece buraya maç eklemek için "+ Maç ekle".'));
    return;
  }
  for (const { id, anim } of state.matches) {
    const ev = state.events.get(id);
    if (!ev) continue;
    const st = state.stats.get(id)?.[state.period];
    const card = el('div', 'shot-card' + (anim ? '' : ' shot-only'));

    const top = el('div', 'sc-top');
    const title = el('div', 'sc-title', `${teamName(ev.homeTeam)} ${scoreText(ev)} ${teamName(ev.awayTeam)}`);
    title.title = `${ev.homeTeam?.name} – ${ev.awayTeam?.name}`;
    const meta = el('div', 'sc-meta' + (isLive(ev) ? ' live' : ''), minuteText(ev));
    const animBtn = el('button', 'sc-btn' + (anim ? ' on' : ''), anim ? '▶' : '▷');
    animBtn.title = anim ? 'Animasyonu kapat (sadece şut ekranında kalsın)' : 'Animasyonu aç';
    animBtn.addEventListener('click', () => setAnim(id, !anim));
    const rm = el('button', 'sc-btn', '✕');
    rm.title = 'Maçı kaldır';
    rm.addEventListener('click', () => removeMatch(id));
    top.append(title, meta, animBtn, rm);
    card.append(top);

    if (state.stats.get(id)?.none) {
      card.append(el('div', 'sc-none', 'Sofascore bu maç için şut verisi tutmuyor'));
      list.append(card);
      continue;
    }
    card.append(statRow(id, 'Şut', 'shots', st?.shots));
    card.append(statRow(id, 'İsabetli', 'sot', st?.sot));

    const names = el('div', 'sc-teams');
    names.append(el('span', null, teamName(ev.homeTeam)), el('span', null, teamName(ev.awayTeam)));
    card.append(names);
    list.append(card);
  }
}

function statRow(id, label, key, val) {
  const row = el('div', 'sc-row');
  const h = el('span', 'val home', val ? val[0] : '–');
  const a = el('span', 'val away', val ? val[1] : '–');
  const bar = el('div', 'bar');
  const fill = el('i');
  const total = val ? val[0] + val[1] : 0;
  fill.style.width = total ? `${(val[0] / total) * 100}%` : '50%';
  bar.append(fill);
  row.append(el('span', 'label', label), h, bar, a);

  // Değer arttıysa yanıp sönsün
  for (const [side, node, v] of [['h', h, val?.[0]], ['a', a, val?.[1]]]) {
    const k = `${id}|${state.period}|${key}|${side}`;
    const prev = state.lastShown.get(k);
    if (v != null && prev != null && v !== prev) node.classList.add('flash');
    if (v != null) state.lastShown.set(k, v);
  }
  return row;
}

/* ---------- Canlı güncelleme ---------- */

// Gereksiz istek atmamak için: biten maç bir kez, başlamamış maç dakikada bir sorgulanır
function needsPoll(id) {
  const ev = state.events.get(id);
  const last = state.lastPoll.get(id) || 0;
  if (!last) return true;
  if (isOver(ev)) return false;
  if (ev?.status?.type === 'notstarted' && ev.startTimestamp * 1000 - Date.now() > 2 * 60_000) {
    return Date.now() - last >= IDLE_POLL_MS;
  }
  return true;
}

async function pollOne(id) {
  const [evRes, stRes] = await Promise.all([
    api(`event/${id}`).catch(() => undefined),
    api(`event/${id}/statistics`).catch(() => undefined),
  ]);
  if (!findMatch(id)) return true;
  if (evRes?.event) state.events.set(id, evRes.event);
  if (stRes) state.stats.set(id, parseStats(stRes));
  else if (stRes === null && state.events.get(id)?.status?.type !== 'notstarted') {
    state.stats.set(id, { none: true }); // maç başladı ama Sofascore istatistik tutmuyor
  }
  if (evRes !== undefined) state.lastPoll.set(id, Date.now());
  updateTile(id);
  return evRes !== undefined;
}

let polling = false;
async function pollAll() {
  if (polling) return;
  const ids = state.matches.map((m) => m.id).filter(needsPoll);
  if (!ids.length) return;
  polling = true;
  try {
    const ok = await mapLimit(ids, 4, pollOne);
    renderShotList();
    const failed = ok.filter((x) => !x).length;
    setStatus(failed ? `Bağlantı sorunu (${failed} maç güncellenemedi)`
      : `Güncellendi ${new Date().toLocaleTimeString('tr-TR')}`);
  } finally {
    polling = false;
  }
}

// Dakikaları her saniye yerel olarak ilerlet
function tickMinutes() {
  for (const id of animIds()) {
    const ev = state.events.get(id);
    const t = state.tiles.get(id);
    if (!ev || !t || !isLive(ev)) continue;
    $('.minute', t.el).textContent = minuteText(ev);
  }
}

/* ---------- Başlangıç ---------- */

function init() {
  const search = $('#search');
  search.addEventListener('focus', () => { renderDropdown(); loadCatalog().then(() => { if (!$('#dropdown').hidden) renderDropdown(); }); });
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
  $('#toggleSide').addEventListener('click', () => document.body.classList.toggle('side-hidden'));
  $('#periodSeg').addEventListener('click', (e) => {
    const p = e.target?.dataset?.period;
    if (!p) return;
    state.period = p;
    for (const b of $('#periodSeg').children) b.classList.toggle('on', b.dataset.period === p);
    renderShotList();
  });

  // Kayıtlı maçları geri yükle
  const saved = state.matches;
  state.matches = [];
  (async () => {
    for (const m of saved) await addMatch(m.id, null, m.anim);
    // Maç listesini kutular yüklendikten sonra hazırla
    setTimeout(() => loadCatalog(), 3000);
  })();

  layout();
  setInterval(pollAll, POLL_MS);
  setInterval(tickMinutes, 1000);
}

init();
