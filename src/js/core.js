'use strict';

/* Ortak sabitler, durum ve yardımcılar. Diğer dosyalar bunları global olarak kullanır. */

const POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;          // başlamamış maçlar için
const FALLBACK_RETRY_MS = 2 * 60_000; // yalnız animasyon açıkken veri yeniden denenir
const MOMENTUM_RELOAD_MS = 60_000;    // atak grafiği kendi kendine güncellenmiyor
const CATALOG_TTL_MS = 60_000;
const MAX_ANIM = 12;
const MAX_TOTAL = 30;
const PARTITION = 'persist:sofa'; // çalışan animasyon oturumu korunur; veri artık ayrı sofa-data oturumundadır
const TRACKER_W = 620;                // animasyonun doğal boyutu (px)
const TRACKER_H = 349;
const MOMENTUM_W = 480;
const TRACKER_URL = (id) => `https://www.sofascore.com/api/v1/event/${id}/live-match-tracker`;
const MOMENTUM_URL = (id) => `https://widgets.sofascore.com/tr/embed/attackMomentum?id=${id}&widgetTheme=dark`;
const LOGO_URL = (teamId) => `https://img.sofascore.com/api/v1/team/${teamId}/image`;

// Şut kartı seçenekleri. Tamamı maç için zaten alınan statistics yanıtından okunur.
const CARD_STATS = [
  { key: 'shots', label: 'Şut', name: 'Toplam şut', group: 'Şutlar', source: 'totalShotsOnGoal' },
  { key: 'sot', label: 'İsabetli', name: 'İsabetli şut', group: 'Şutlar', source: 'shotsOnGoal' },
  { key: 'offTarget', label: 'İsabetsiz', name: 'İsabetsiz şut', group: 'Şutlar', source: 'shotsOffGoal' },
  { key: 'blocked', label: 'Bloklanan', name: 'Bloklanan şut', group: 'Şutlar', source: 'blockedScoringAttempt' },
  { key: 'insideBox', label: 'Ceza içi', name: 'Ceza sahası içi şut', group: 'Şutlar', source: 'totalShotsInsideBox' },
  { key: 'outsideBox', label: 'Ceza dışı', name: 'Ceza sahası dışı şut', group: 'Şutlar', source: 'totalShotsOutsideBox' },
  { key: 'woodwork', label: 'Direk', name: 'Direkten dönen şut', group: 'Şutlar', source: 'hitWoodwork' },
  { key: 'xg', label: 'xG', name: 'Beklenen gol (xG)', group: 'Şutlar', source: 'expectedGoals', format: 'decimal' },
  { key: 'xgot', label: 'xGOT', name: 'İsabetli şut xG', group: 'Şutlar', source: 'expectedGoalsOnTarget', format: 'decimal' },
  { key: 'bigChances', label: 'Net fırsat', name: 'Net pozisyon', group: 'Şutlar', source: 'bigChanceCreated' },
  { key: 'missedChances', label: 'Kaçan', name: 'Kaçırılan net pozisyon', group: 'Şutlar', source: 'bigChanceMissed' },
  { key: 'corners', label: 'Korner', name: 'Korner', group: 'Hücum', source: 'cornerKicks' },
  { key: 'possession', label: 'Top %', name: 'Topla oynama', group: 'Hücum', source: 'ballPossession', format: 'percent' },
  { key: 'touchesBox', label: 'Ceza temas', name: 'Rakip ceza sahasında topla buluşma', group: 'Hücum', source: 'touchesInOppBox' },
  { key: 'finalThird', label: '3. bölge', name: 'Hücum bölgesine giriş', group: 'Hücum', source: 'finalThirdEntries' },
  { key: 'offsides', label: 'Ofsayt', name: 'Ofsayt', group: 'Hücum', source: 'offsides' },
  { key: 'throwIns', label: 'Taç', name: 'Taç', group: 'Hücum', source: 'throwIns' },
  { key: 'goalKicks', label: 'Aut', name: 'Aut atışı', group: 'Hücum', source: 'goalKicks' },
  { key: 'freeKicks', label: 'Serbest', name: 'Serbest vuruş', group: 'Hücum', source: 'freeKicks' },
  { key: 'passes', label: 'Pas', name: 'Pas', group: 'Paslar', source: 'passes' },
  { key: 'accuratePasses', label: 'İs. pas', name: 'İsabetli pas', group: 'Paslar', source: 'accuratePasses' },
  { key: 'accurateCross', label: 'İs. orta', name: 'İsabetli orta', group: 'Paslar', source: 'accurateCross' },
  { key: 'fouls', label: 'Faul', name: 'Faul', group: 'Disiplin ve savunma', source: 'fouls' },
  { key: 'yellowCards', label: 'Sarı kart', name: 'Sarı kart', group: 'Disiplin ve savunma', source: 'yellowCards' },
  { key: 'redCards', label: 'Kırmızı', name: 'Kırmızı kart', group: 'Disiplin ve savunma', source: 'redCards' },
  { key: 'tackles', label: 'Müdahale', name: 'Toplam müdahale', group: 'Disiplin ve savunma', source: 'totalTackle' },
  { key: 'interceptions', label: 'Top kapma', name: 'Top kapma', group: 'Disiplin ve savunma', source: 'interceptionWon' },
  { key: 'recoveries', label: 'Kazanma', name: 'Top kazanma', group: 'Disiplin ve savunma', source: 'ballRecovery' },
  { key: 'clearances', label: 'Uzaklaş.', name: 'Uzaklaştırma', group: 'Disiplin ve savunma', source: 'totalClearance' },
  { key: 'saves', label: 'Kurtarış', name: 'Kaleci kurtarışı', group: 'Disiplin ve savunma', source: 'goalkeeperSaves' },
];

// Basketbol kartı seçenekleri. "Sayı" istatistik yanıtında yok, skordan okunur.
const BASKET_CARD_STATS = [
  { key: 'points', label: 'Sayı', name: 'Sayı', group: 'Sayılar', source: null },
  { key: 'threes', label: "3'lük", name: "3'lük isabet", group: 'Sayılar', source: 'threePointersScored' },
  { key: 'twos', label: "2'lik", name: "2'lik isabet", group: 'Sayılar', source: 'twoPointersScored' },
  { key: 'freeThrows', label: 'Serbest', name: 'Serbest atış isabeti', group: 'Sayılar', source: 'freeThrowsScored' },
  { key: 'fieldGoals', label: 'Saha içi', name: 'Saha içi isabet', group: 'Sayılar', source: 'fieldGoalsScored' },
  { key: 'rebounds', label: 'Ribaund', name: 'Ribaund', group: 'Oyun', source: 'rebounds' },
  { key: 'offRebounds', label: 'Hüc. rib.', name: 'Hücum ribaundu', group: 'Oyun', source: 'offensiveRebounds' },
  { key: 'defRebounds', label: 'Sav. rib.', name: 'Savunma ribaundu', group: 'Oyun', source: 'defensiveRebounds' },
  { key: 'assists', label: 'Asist', name: 'Asist', group: 'Oyun', source: 'assists' },
  { key: 'turnovers', label: 'Top kaybı', name: 'Top kaybı', group: 'Oyun', source: 'turnovers' },
  { key: 'steals', label: 'Top çalma', name: 'Top çalma', group: 'Oyun', source: 'steals' },
  { key: 'blocks', label: 'Blok', name: 'Blok', group: 'Oyun', source: 'blocks' },
  { key: 'fouls', label: 'Faul', name: 'Faul', group: 'Oyun', source: 'totalFouls' },
  { key: 'timeouts', label: 'Mola', name: 'Mola', group: 'Oyun', source: 'timeouts' },
  { key: 'maxRun', label: 'En uzun seri', name: 'Üst üste en fazla sayı', group: 'Liderlik', source: 'maxPointsInARow' },
  { key: 'leadChanges', label: 'Lider değ.', name: 'Liderlik değişimi', group: 'Liderlik', source: 'leadChanges' },
  { key: 'biggestLead', label: 'En büyük fark', name: 'En büyük fark', group: 'Liderlik', source: 'biggestLead' },
];
const DEFAULT_CARD_STATS = { football: ['shots', 'sot', 'corners'], basketball: ['threes', 'rebounds', 'assists', 'turnovers'] };
const SPORTS = { football: 'Futbol', basketball: 'Basketbol' };
const cardMetrics = (sport) => sport === 'basketball' ? BASKET_CARD_STATS : CARD_STATS;

// Animasyon sayfasını koyu temaya uydurmak için içine eklenen CSS
const STAGE_CSS = `
  html, body { background: #000 !important; overflow: hidden !important; }
  .sr-bb { background: transparent !important; }
  .is-embed > div > a:last-child { display: none !important; }
`;

const $ = (sel, root = document) => root.querySelector(sel);
const api = (path, options) => window.sofa.get(path, options);

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
  sofaConnection: { state: 'unknown', status: 0, retryAt: 0 },
  matches: loadMatches(),            // [{ id, anim }] — anim: false ise sadece şut ekranında
  events: new Map(),                 // id -> son event verisi
  stats: new Map(),                  // id -> { ALL: {...}, '1ST': {...}, '2ND': {...} } veya { none: true }
  statsRaw: new Map(),               // id -> Sofascore'un tüm maç istatistikleri
  lastPoll: new Map(),               // id -> son sorgu zamanı (ms)
  lastAttempt: new Map(),            // failed/background requests also wait their turn
  tiles: new Map(),                  // id -> animasyon kutusu durumu
  period: 'ALL',
  replaceMatchId: null,
  addMode: 'anim',                   // arama kutusundan seçilen maç nereye eklensin
  catalog: { sport: null, live: [], today: [], leagues: [], leagueData: null, loadedAt: 0, lastAttemptAt: 0, date: null, loading: null, error: false, partial: false },
  leagueFilter: null,                // { id, name, category } veya null; spor başına ayrı saklanır
  searchResults: [],
  lastShown: new Map(),              // şut ekranında yanıp sönme için önceki değerler
  targets: load('targets', []),      // kupon hedefleri
  targetStatus: new Map(),           // hedef id -> son durum (tuttu animasyonu için)
  cardStats: load('cardStats', DEFAULT_CARD_STATS.football), // şut kartında görünen istatistikler
  basketCardStats: load('basketCardStats', DEFAULT_CARD_STATS.basketball),
  pickerSport: load('pickerSport', 'football') === 'basketball' ? 'basketball' : 'football',
  cardSort: load('cardSort', 'manual'), // şut kartı sıralaması: manual | auto
  layout: Object.assign({ mode: 'grid', arrange: 'auto', focus: null, free: {}, z: [] }, load('layout', {})),
};

state.leagueFilter = load(state.pickerSport === 'basketball' ? 'leagueFilterBasketball' : 'leagueFilter', null);

function loadMatches() {
  const saved = load('matches', null);
  if (Array.isArray(saved)) {
    return saved.filter((m) => Number.isInteger(m?.id)).map((m) => ({ id: m.id, anim: !!m.anim,
      animationOnly: !!m.animationOnly, ...(m.sport === 'basketball' ? { sport: 'basketball' } : {}) }));
  }
  // Eski sürümden kalan liste: hepsi animasyonlu
  return load('selected', []).filter(Number.isInteger).map((id) => ({ id, anim: true }));
}
const syncWatched = () => window.sofa.watch?.(state.matches.map((m) => m.id))?.catch(() => {});
const saveMatches = () => { save('matches', state.matches); syncWatched(); };
const saveTargets = () => save('targets', state.targets);
const saveLayout = () => save('layout', state.layout);
const findMatch = (id) => state.matches.find((m) => m.id === id);
const animIds = () => state.matches.filter((m) => m.anim).map((m) => m.id);

// Maçın sporu: Sofascore verisinden; veri yoksa listeye eklenirken kaydedilen değer
function eventSport(ev) {
  const slug = ev?.tournament?.category?.sport?.slug || ev?.sport?.slug;
  return slug === 'basketball' ? 'basketball' : slug ? 'football' : null;
}
function matchSport(id) {
  return eventSport(state.events.get(id)) || findMatch(id)?.sport || 'football';
}
const isBasket = (id) => matchSport(id) === 'basketball';
const cardStatsFor = (sport) => sport === 'basketball' ? state.basketCardStats : state.cardStats;

function animationOnlyEvent(id) {
  return { id, _animationOnly: true, homeTeam: { name: `Maç #${id}` },
    awayTeam: { name: '' }, status: { type: 'unknown' } };
}

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
  Pause: 'Ara', Halftime: 'Devre arası', Overtime: 'Uzatma',
};
const statusText = (st) => STATUS_TR[st?.description] || st?.description || '';

function isLive(ev) { return ev?.status?.type === 'inprogress'; }
function isOver(ev) { return ['finished', 'canceled', 'postponed'].includes(ev?.status?.type); }

/* Basketbol saati. Sofascore oynanan süreyi (time.played, saniye) verir; saat
 * çalışıyorsa son güncellemeden beri geçen süre eklenir. Saat durunca durur. */
const BASKET_PERIOD = { 13: 1, 14: 2, 15: 3, 16: 4, 6: 1, 7: 2 }; // 6/7: yarılarla oynanan ligler

function basketPeriodNo(ev) {
  const st = ev?.status || {};
  if (st.type !== 'inprogress') return null;
  if (BASKET_PERIOD[st.code]) return BASKET_PERIOD[st.code];
  const t = ev.time || {};
  const total = t.totalPeriodCount || 4;
  if (/overtime/i.test(st.description || '') && t.played != null && t.periodLength) {
    return total + Math.max(1, Math.ceil((t.played - total * t.periodLength) / (t.overtimeLength || 300)));
  }
  return null; // ara
}

function basketPlayed(ev) {
  const t = ev?.time;
  if (t?.played == null) return null;
  let played = t.played;
  if (t.clockRunning && t.clockRunningLastUpdated) {
    played += Math.max(0, (Date.now() - Date.parse(t.clockRunningLastUpdated)) / 1000);
  }
  return played;
}

function basketMinuteText(ev) {
  const st = ev.status || {};
  const n = basketPeriodNo(ev);
  if (!n) return st.code === 31 ? 'Devre' : statusText(st) || 'Ara';
  const t = ev.time || {};
  const total = t.totalPeriodCount || 4;
  const halves = total === 2;
  const label = n > total ? `UZ${n - total > 1 ? n - total : ''}` : `${n}${halves ? 'Y' : 'Ç'}`;
  const played = basketPlayed(ev);
  if (played == null || !t.periodLength) return label;
  const end = n <= total ? n * t.periodLength : total * t.periodLength + (n - total) * (t.overtimeLength || 300);
  const left = Math.max(0, Math.ceil(end - played));
  return `${label} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// Biten çeyrek sayısı (uzatmalar dahil değil). Ara ve devre arasında oynanan süreye bakılır.
function basketQuartersDone(ev) {
  const st = ev?.status || {};
  const total = ev?.time?.totalPeriodCount || 4;
  if (st.type === 'finished') return total;
  if (st.type !== 'inprogress') return 0;
  const n = basketPeriodNo(ev);
  if (n) return Math.min(total, n - 1);
  if (st.code === 31) return total / 2;
  const t = ev.time || {};
  if (t.played != null && t.periodLength) return Math.min(total, Math.floor(t.played / t.periodLength + 0.001));
  // Oynanan süre yoksa skorda yer alan son periyot bitmiş sayılır
  let done = 0;
  while (done < total && ev.homeScore?.[`period${done + 1}`] != null) done++;
  return done;
}

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
  if (eventSport(ev) === 'basketball') return basketMinuteText(ev);
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

// Kart istatistikleri: aynı Sofascore yanıtını periyot bazında işler.
function parseStats(json, sport = 'football') {
  if (sport === 'basketball') return parseBasketStats(json);
  const out = {};
  for (const block of json?.statistics || []) {
    const items = (block.groups || []).flatMap((g) => g.statisticsItems || []);
    const byKey = new Map(items.map((item) => [item.key, item]));
    const pick = (key, format) => {
      const it = byKey.get(key);
      if (!it) return null;
      const number = (value) => {
        const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.'));
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      };
      const side = (name) => {
        // Yüzde satırlarında homeValue bazen adet, home metni ise yüzde olabilir.
        const percent = format === 'percent' && String(it[name] ?? '').match(/([\d.,]+)\s*%/);
        return number(percent ? percent[1] : it[`${name}Value`] ?? it[name]);
      };
      return [side('home'), side('away')];
    };
    // Sofascore değeri 0 olan satırları göndermiyor (ör. isabetli şut 0-0 ise satır yok).
    // Toplam şut = isabetli + isabetsiz + bloklanan; eksik olanı diğerlerinden tamamla.
    let shots = pick('totalShotsOnGoal');
    let sot = pick('shotsOnGoal');
    const off = pick('shotsOffGoal');
    const blocked = pick('blockedScoringAttempt');
    const z = (v, i) => (v ? v[i] : 0);
    if (!shots && (sot || off || blocked)) shots = [0, 1].map((i) => z(sot, i) + z(off, i) + z(blocked, i));
    if (!sot && shots && (off || blocked)) sot = [0, 1].map((i) => Math.max(0, shots[i] - z(off, i) - z(blocked, i)));
    const values = Object.fromEntries(CARD_STATS.map(({ key, source, format }) => [key, pick(source, format)]));
    out[block.period] = { ...values, shots, sot };
  }
  return out;
}

function statPicker(block) {
  const items = (block?.groups || []).flatMap((g) => g.statisticsItems || []);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const number = (value) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  return (key) => {
    const it = byKey.get(key);
    return it ? [number(it.homeValue ?? it.home), number(it.awayValue ?? it.away)] : null;
  };
}

/* Basketbol: NBA/WNBA gibi liglerde çeyrek blokları (1Q..4Q) da gelir; yarılar
 * bunların toplamıdır. "Sayı" satırı skordan doldurulur (bkz. basketPoints). */
function parseBasketStats(json) {
  const out = {};
  for (const block of json?.statistics || []) {
    const pick = statPicker(block);
    out[block.period] = Object.fromEntries(BASKET_CARD_STATS.filter((m) => m.source)
      .map(({ key, source }) => [key, pick(source)]));
  }
  const sum = (periods) => {
    const blocks = periods.map((p) => out[p]).filter(Boolean);
    if (!blocks.length) return null;
    return Object.fromEntries(BASKET_CARD_STATS.filter((m) => m.source).map(({ key }) => {
      const pairs = blocks.map((b) => b[key]).filter(Boolean);
      return [key, pairs.length ? [0, 1].map((i) => pairs.reduce((a, p) => a + p[i], 0)) : null];
    }));
  };
  if (out['1Q']) out['1ST'] = sum(['1Q', '2Q']);
  if (out['3Q']) out['2ND'] = sum(['3Q', '4Q']);
  return out;
}

// Basketbol skoru periyot bazında: 1ST = ilk yarı, 2ND = ikinci yarı + uzatmalar,
// Q1..Q4 = çeyrek (uzatma hariç), ALL = maç (uzatma dahil)
function basketPoints(ev, period) {
  if (!ev || ev.status?.type === 'notstarted') return null;
  const side = (score) => {
    const p = (n) => score?.[`period${n}`] ?? 0;
    if (period === 'ALL') return score?.current ?? 0;
    if (period === '1ST') return p(1) + p(2);
    if (period === '2ND') return Math.max(0, (score?.current ?? 0) - p(1) - p(2));
    const q = /^Q([1-4])$/.exec(period);
    return q ? p(Number(q[1])) : null;
  };
  const h = side(ev.homeScore), a = side(ev.awayScore);
  return h == null || a == null ? null : [h, a];
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
