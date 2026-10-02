'use strict';

/* Ortak sabitler, durum ve yardımcılar. Diğer dosyalar bunları global olarak kullanır. */

const POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;          // başlamamış maçlar için
const MOMENTUM_RELOAD_MS = 60_000;    // atak grafiği kendi kendine güncellenmiyor
const CATALOG_TTL_MS = 60_000;
const MAX_ANIM = 12;
const MAX_TOTAL = 30;
const PARTITION = 'persist:sofa';     // ortak oturum: Sportradar dosyaları bir kez indirilip önbellekte kalır
const TRACKER_W = 620;                // animasyonun doğal boyutu (px)
const TRACKER_H = 349;
const MOMENTUM_W = 480;
const TRACKER_URL = (id) => `https://www.sofascore.com/api/v1/event/${id}/live-match-tracker`;
const MOMENTUM_URL = (id) => `https://widgets.sofascore.com/tr/embed/attackMomentum?id=${id}&widgetTheme=dark`;
const LOGO_URL = (teamId) => `https://img.sofascore.com/api/v1/team/${teamId}/image`;

// Animasyon sayfasını koyu temaya uydurmak için içine eklenen CSS
const STAGE_CSS = `
  html, body { background: #000 !important; overflow: hidden !important; }
  .sr-bb { background: transparent !important; }
  .is-embed > div > a:last-child { display: none !important; }
`;

const $ = (sel, root = document) => root.querySelector(sel);
const api = (path) => window.sofa.get(path);

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* yoksay */ }
}

const state = {
  matches: loadMatches(),            // [{ id, anim }] — anim: false ise sadece şut ekranında
  events: new Map(),                 // id -> son event verisi
  stats: new Map(),                  // id -> { ALL: {...}, '1ST': {...}, '2ND': {...} } veya { none: true }
  lastPoll: new Map(),               // id -> son sorgu zamanı (ms)
  tiles: new Map(),                  // id -> animasyon kutusu durumu
  period: 'ALL',
  addMode: 'anim',                   // arama kutusundan seçilen maç nereye eklensin
  catalog: { live: [], today: [], loadedAt: 0, loading: null },
  searchResults: [],
  lastShown: new Map(),              // şut ekranında yanıp sönme için önceki değerler
  targets: load('targets', []),      // kupon hedefleri
  targetStatus: new Map(),           // hedef id -> son durum (tuttu animasyonu için)
  layout: Object.assign({ mode: 'grid', arrange: 'auto', focus: null, free: {}, z: [] }, load('layout', {})),
};

function loadMatches() {
  const saved = load('matches', null);
  if (Array.isArray(saved)) {
    return saved.filter((m) => Number.isInteger(m?.id)).map((m) => ({ id: m.id, anim: !!m.anim }));
  }
  // Eski sürümden kalan liste: hepsi animasyonlu
  return load('selected', []).filter(Number.isInteger).map((id) => ({ id, anim: true }));
}
const saveMatches = () => save('matches', state.matches);
const saveTargets = () => save('targets', state.targets);
const saveLayout = () => save('layout', state.layout);
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

// İstatistikler: toplam şut, isabetli şut, korner (periyot bazında)
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
    out[block.period] = { shots: pick('totalShotsOnGoal'), sot: pick('shotsOnGoal'), corners: pick('cornerKicks') };
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

// CSS animasyonunu yeniden başlatır (aynı sınıf tekrar eklendiğinde)
function restartClass(node, ...classes) {
  node.classList.remove(...classes);
  void node.offsetWidth;
  node.classList.add(...classes);
}

function setStatus(text) { $('#status').textContent = text; }
