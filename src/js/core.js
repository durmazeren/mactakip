'use strict';

/* Ortak sabitler, durum ve yardımcılar. Diğer dosyalar bunları global olarak kullanır. */

const POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;          // başlamamış maçlar için
const SCHEDULER_TICK_MS = 500;
const POLL_CONCURRENCY = 4;
const POLL_ENDPOINTS = Object.freeze(['event', 'statistics', 'odds', 'incidents']);
const POLL_INTERVALS = Object.freeze({
  event: Object.freeze({ base: 10_000, hot: 5_000, priority: 3_500, quiet: 20_000, maxQuiet: 60_000 }),
  statistics: Object.freeze({ base: 10_000, hot: 8_000, priority: 5_000, quiet: 30_000, maxQuiet: 60_000 }),
  odds: Object.freeze({ base: 10_000, hot: 5_000, priority: 2_000, quiet: 30_000, maxQuiet: 60_000 }),
  incidents: Object.freeze({ base: 10_000, hot: 5_000, priority: 3_500, quiet: 20_000, maxQuiet: 60_000 }),
});
const POLL_STALE_HORIZONS = Object.freeze({ event: 35_000, statistics: 35_000, odds: 10_000, incidents: 35_000 });
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
const api = (path, options) => PollingQuality.requestGate.run(() => window.sofa.get(path), options);

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
  eventIncidents: new Map(),         // id -> son doÄŸrulanmÄ±ÅŸ /incidents snapshot'ı
  stats: new Map(),                  // id -> { ALL: {...}, '1ST': {...}, '2ND': {...} } veya { none: true }
  liveOdds: new Map(),               // id -> son canlı fiyatlar; API zaman damgası doğrulanmadan model teyidi sayılmaz
  apiStatus: new Map(),              // id -> event/statistics/odds yanıtlarının ayrı sağlık durumu
  pollRevision: new Map(),           // id -> eski/in-flight yanıtların yeni maça yazılmasını engeller
  pollState: new Map(),
  pollTelemetry: new Map(),
  pollInFlight: new Map(),
  pollRenderTelemetry: null,
  lastPoll: new Map(),               // id -> son sorgu zamanı (ms)
  lastOddsPoll: new Map(),           // id -> son canlı oran sorgusu zamanı (ms)
  tiles: new Map(),                  // id -> animasyon kutusu durumu
  period: 'ALL',
  addMode: 'anim',                   // arama kutusundan seçilen maç nereye eklensin
  catalog: { live: [], today: [], loadedAt: 0, loading: null },
  searchResults: [],
  lastShown: new Map(),              // şut ekranında yanıp sönme için önceki değerler
  targets: load('targets', []),      // kupon hedefleri
  targetStatus: new Map(),           // hedef id -> son durum (tuttu animasyonu için)
  cardStats: load('cardStats', ['shots', 'sot', 'corners']), // şut kartında görünen istatistikler
  cardSort: load('cardSort', 'manual'), // şut kartı sıralaması: manual | auto
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
  const score = globalThis.LiveAnalysisState?.scorePair(ev);
  return score ? `${score[0]} - ${score[1]}` : 'Skor –';
}

// İstatistikler: toplam şut, isabetli şut, korner (periyot bazında)
function parseStats(json) {
  const out = {};
  const numberValue = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const parsed = Number(value.trim().replace('%', '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };

  for (const block of json?.statistics || []) {
    if (!block || typeof block.period !== 'string' || !Array.isArray(block.groups)) continue;
    const items = block.groups.flatMap((group) =>
      Array.isArray(group?.statisticsItems) ? group.statisticsItems.filter((item) => item && typeof item === 'object') : []);
    const pick = (key) => {
      const it = items.find((i) => i.key === key);
      if (!it) return null;
      return [numberValue(it.homeValue ?? it.home), numberValue(it.awayValue ?? it.away)];
    };
    // Sofascore değeri 0 olan satırları göndermiyor (ör. isabetli şut 0-0 ise satır yok).
    // Toplam şut = isabetli + isabetsiz + bloklanan; eksik olanı diğerlerinden tamamla.
    let shots = pick('totalShotsOnGoal');
    let sot = pick('shotsOnGoal');
    const off = pick('shotsOffGoal');
    const blocked = pick('blockedScoringAttempt');
    const component = (pair, side) => pair ? pair[side] : 0;
    const sumComponents = (pairs, side) => {
      const values = pairs.map((pair) => component(pair, side));
      return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    if (!shots && (sot || off || blocked)) {
      shots = [0, 1].map((side) => sumComponents([sot, off, blocked], side));
    }
    if (!sot && shots && (off || blocked)) {
      sot = [0, 1].map((side) => {
        const total = shots[side];
        const other = sumComponents([off, blocked], side);
        return Number.isFinite(total) && Number.isFinite(other) ? Math.max(0, total - other) : null;
      });
    }
    out[block.period] = {
      shots, sot, corners: pick('cornerKicks'),
      xg: pick('expectedGoals'),
      bigChances: pick('bigChanceCreated') || pick('bigChancesCreated'),
      bigChancesMissed: pick('bigChanceMissed'),
      possession: pick('ballPossession'),
      redCards: pick('redCards'),
    };
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

// Pure polling/feed helpers. They deliberately distinguish request freshness from
// provider timestamps and from when the payload's meaningful fields last changed.
const PollingQuality = (() => {
  const SOURCE_TIME_FIELDS = new Set([
    'lastUpdatedAt', 'lastUpdatedTimestamp', 'lastUpdateTimestamp', 'updatedAt',
    'updateTimestamp', 'lastUpdate', 'timestamp', 'generatedAt', 'sourceTimestamp',
  ]);
  const VOLATILE_FINGERPRINT_FIELDS = new Set([
    'requestStartedAt', 'receivedAt', 'observedAt', 'latencyMs', 'elapsedMs',
    'lastUpdatedAt', 'lastUpdatedTimestamp', 'lastUpdateTimestamp', 'updatedAt',
    'updateTimestamp', 'lastUpdate', 'timestamp', 'generatedAt', 'sourceTimestamp',
  ]);

  function createRequestLimiter(maxConcurrent = 8, clock = Date.now) {
    const limit = Math.max(1, Math.floor(maxConcurrent));
    const queue = [];
    let active = 0;
    let sequence = 0;
    const drain = () => {
      while (active < limit && queue.length) {
        const task = queue.shift();
        task.signal?.removeEventListener?.('abort', task.onAbort);
        active++;
        task.startedAt = clock();
        try { task.onStart?.(task.startedAt, { queuedAt: task.queuedAt, queueWaitMs: Math.max(0, task.startedAt - task.queuedAt) }); }
        catch { /* telemetry must not interrupt the request */ }
        let request;
        try { request = task.operation(); }
        catch (error) { request = Promise.reject(error); }
        Promise.resolve(request).then(task.resolve, task.reject).finally(() => {
          active--;
          drain();
        });
      }
    };
    const run = (operation, options = {}) => new Promise((resolve, reject) => {
      if (typeof operation !== 'function') {
        reject(new TypeError('A request operation is required'));
        return;
      }
      const task = {
        operation, resolve, reject, onStart: options.onStart, signal: options.signal,
        queuedAt: clock(), sequence: sequence++,
      };
      task.onAbort = () => {
        const index = queue.indexOf(task);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(task.signal?.reason || Object.assign(new Error('Request cancelled before dispatch'), { name: 'AbortError' }));
      };
      if (task.signal?.aborted) {
        reject(task.signal.reason || Object.assign(new Error('Request cancelled before dispatch'), { name: 'AbortError' }));
        return;
      }
      task.signal?.addEventListener?.('abort', task.onAbort, { once: true });
      queue.push(task);
      drain();
    });
    return Object.freeze({
      run,
      snapshot: () => Object.freeze({ active, queued: queue.length, limit }),
    });
  }

  const requestGate = createRequestLimiter(8);

  function classifyRequestError(error) {
    const message = String(error?.message || error || 'request failed');
    const status = message.match(/(?:Sofascore\s+|HTTP\s+|status\s*)(\d{3})/i)?.[1];
    if (status === '429') return { key: 'rate-limit', status: 429 };
    if (status && Number(status) >= 500) return { key: 'server', status: Number(status) };
    if (status && Number(status) >= 400) return { key: 'http', status: Number(status) };
    if (/timeout|timed out|etimedout|aborterror/i.test(`${error?.name || ''} ${message}`)) return { key: 'timeout', status: null };
    if (/network|fetch failed|econn|enotfound|eai_again|socket|connection/i.test(message)) return { key: 'network', status: null };
    return { key: 'unknown', status: null };
  }

  async function captureRequest(request, path, clock = Date.now, timeoutMs = 15_000, timers = globalThis) {
    const requestQueuedAt = clock();
    let requestStartedAt = null;
    let queueWaitMs = 0;
    let timeoutId;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const onStart = (startedAt, queue) => {
      requestStartedAt = Number.isFinite(startedAt) ? startedAt : clock();
      queueWaitMs = Number.isFinite(queue?.queueWaitMs) ? queue.queueWaitMs : Math.max(0, requestStartedAt - requestQueuedAt);
    };
    const settled = Promise.resolve().then(() => request(path, { onStart, signal: controller?.signal })).then((value) => {
      const receivedAt = clock();
      const startedAt = requestStartedAt ?? requestQueuedAt;
      return {
        kind: value === null ? 'not-found' : 'success', value,
        requestQueuedAt, requestStartedAt: startedAt, receivedAt,
        queueWaitMs, latencyMs: Math.max(0, receivedAt - startedAt),
        elapsedMs: Math.max(0, receivedAt - requestQueuedAt),
      };
    }).catch((error) => {
      const receivedAt = clock();
      const classified = classifyRequestError(error);
      const startedAt = requestStartedAt ?? requestQueuedAt;
      return {
        kind: 'failed', error, errorClass: classified.key, httpStatus: classified.status,
        requestQueuedAt, requestStartedAt: startedAt, receivedAt,
        queueWaitMs, latencyMs: Math.max(0, receivedAt - startedAt),
        elapsedMs: Math.max(0, receivedAt - requestQueuedAt),
      };
    });
    const timeout = new Promise((resolve) => {
      timeoutId = timers.setTimeout(() => {
        const receivedAt = clock();
        controller?.abort(Object.assign(new Error(`Request timed out after ${timeoutMs} ms`), { name: 'AbortError' }));
        resolve({
          kind: 'failed', error: new Error(`Request timed out after ${timeoutMs} ms`),
          errorClass: 'timeout', httpStatus: null, requestQueuedAt,
          requestStartedAt: requestStartedAt ?? requestQueuedAt, receivedAt,
          queueWaitMs, latencyMs: Math.max(0, receivedAt - (requestStartedAt ?? requestQueuedAt)),
          elapsedMs: Math.max(0, receivedAt - requestQueuedAt),
        });
      }, timeoutMs);
    });
    const result = await Promise.race([settled, timeout]);
    timers.clearTimeout(timeoutId);
    return result;
  }

  function timestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 1e12) return value;
      if (value > 1e9) return value * 1000;
      return null;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function sourceTimestamp(payload, now = Date.now()) {
    const candidates = [];
    const seen = new Set();
    const visit = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 2_000)) visit(item, depth + 1);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (SOURCE_TIME_FIELDS.has(key)) {
          const parsed = timestampMs(child);
          if (parsed != null && parsed <= now + 30_000) candidates.push(parsed);
        }
        if (child && typeof child === 'object') visit(child, depth + 1);
      }
    };
    visit(payload, 0);
    return candidates.reduce((latest, candidate) => Math.max(latest, candidate), null);
  }

  function stableSerialize(value, depth = 0) {
    if (depth > 16) return '"[depth-limit]"';
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item, depth + 1)).join(',')}]`;
    const entries = Object.entries(value)
      .filter(([key]) => !VOLATILE_FINGERPRINT_FIELDS.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item, depth + 1)}`).join(',')}}`;
  }

  function fingerprint(payload) {
    const input = stableSerialize(payload);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < input.length; index++) {
      const code = input.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
    }
    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
  }

  function fieldFingerprints(payload, endpoint) {
    const result = {};
    const add = (key, value) => {
      if (Object.keys(result).length >= 48) return;
      result[key] = fingerprint(value);
    };
    const visit = (value, prefix = '', depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 10 || Object.keys(result).length >= 48) return;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length && index < 300; index++) {
          const item = value[index];
          const label = item?.key || item?.marketName || item?.name || item?.period || item?.id || index;
          const itemPath = `${prefix}[${String(label).slice(0, 40)}]`;
          if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
            if (/score|shots|sot|corner|xg|chance|possession|redcard|value|price|odds/i.test(itemPath)) add(itemPath, item);
          } else visit(item, itemPath, depth + 1);
          if (Object.keys(result).length >= 48) break;
        }
        return;
      }
      for (const [name, child] of Object.entries(value)) {
        if (SOURCE_TIME_FIELDS.has(name) || VOLATILE_FINGERPRINT_FIELDS.has(name)) continue;
        const fieldPath = prefix ? `${prefix}.${name}` : name;
        if (child === null || ['string', 'number', 'boolean'].includes(typeof child)) {
          const semanticPath = `${fieldPath}${typeof child === 'string' && name === 'key' ? `:${child}` : ''}`;
          if (/score|status|\.type$|\.code$|\.description$|shots|sot|corner|xg|chance|possession|redcard|yellowcard|homevalue|awayvalue|price|odds|value|selection|choice|market|period|\.name$|\.active$|suspend|live/i.test(semanticPath)) {
            add(semanticPath.slice(-120), child);
          }
        } else visit(child, fieldPath, depth + 1);
        if (Object.keys(result).length >= 48) break;
      }
    };
    visit(payload);
    if (!Object.keys(result).length) add(`${endpoint || 'payload'}.content`, payload);
    return result;
  }

  function changedFieldPaths(previous, current) {
    const before = previous || {};
    const after = current || {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 20);
  }

  function classifyIncidentsResponse(payload, matchId) {
    const incidents = Array.isArray(payload) ? payload : payload?.incidents;
    if (!Array.isArray(incidents)) return { kind: payload == null ? 'not-found' : 'invalid', incidents: null };
    const expectedId = Number(matchId);
    const mismatch = incidents.some((incident) => Number.isFinite(expectedId)
      && incident?.eventId != null && Number(incident.eventId) !== expectedId);
    return mismatch ? { kind: 'mismatch', incidents: null } : { kind: 'complete', incidents };
  }

  function criticalIncidentKeys(incidents) {
    if (!Array.isArray(incidents)) return [];
    const keys = [];
    for (const incident of incidents) {
      const text = [incident?.incidentType, incident?.type, incident?.incident,
        incident?.incidentClass, incident?.description, incident?.name, incident?.status]
        .filter(Boolean).join(' ').toLowerCase();
      const incidentType = String(incident?.incidentType || incident?.type || '').toLowerCase();
      const incidentClass = String(incident?.incidentClass || '').toLowerCase();
      let kind = null;
      if (/\bvar\b|video assistant|video review/.test(text)) kind = 'var';
      else if (/penalt/.test(text)) kind = 'penalty';
      else if ((incidentType === 'card' && ['red', 'yellowred'].includes(incidentClass))
        || /red.?card|yellow.?red|second yellow/.test(text)) kind = 'red-card';
      else if (/\bgoal\b/.test(text)) kind = 'goal';
      if (!kind) continue;
      const detail = String(incident?.id ?? incident?.eventId
        ?? `${incident?.timeSeconds ?? incident?.time ?? incident?.minute ?? ''}|${incident?.incidentClass ?? ''}|${incident?.description ?? incident?.name ?? ''}`);
      keys.push(`${kind}:${detail}`.slice(0, 180));
    }
    return [...new Set(keys)].sort();
  }

  function newCriticalIncidentKeys(previous, current) {
    if (!Array.isArray(previous) || !Array.isArray(current)) return [];
    const known = new Set(criticalIncidentKeys(previous));
    return criticalIncidentKeys(current).filter((key) => !known.has(key));
  }

  function priorityDueAt(now, priorityIntervalMs, immediate = false) {
    return immediate ? now : now + priorityIntervalMs;
  }

  function resolveWaiters(waiters, result) {
    const pending = Array.isArray(waiters) ? [...waiters] : [];
    for (const resolve of pending) {
      try { resolve(result); } catch { /* one consumer must not block the others */ }
    }
    return pending.length;
  }

  function effectivePollPriority(priority, waitedMs) {
    const base = Number.isFinite(priority) ? priority : 0;
    const wait = Number.isFinite(waitedMs) ? Math.max(0, waitedMs) : 0;
    return base + Math.min(2, wait / 15_000);
  }

  function ageRecord(record, now = Date.now()) {
    if (!record) return null;
    const receivedAgeMs = Number.isFinite(record.receivedAt) ? Math.max(0, now - record.receivedAt) : null;
    const payloadAgeMs = Number.isFinite(record.payloadReceivedAt) ? Math.max(0, now - record.payloadReceivedAt) : null;
    const sourceAgeMs = Number.isFinite(record.sourceUpdatedAt) ? Math.max(0, now - record.sourceUpdatedAt) : null;
    const unchangedAgeMs = Number.isFinite(record.lastChangedAt) ? Math.max(0, now - record.lastChangedAt) : null;
    const dataAgeMs = sourceAgeMs == null ? payloadAgeMs : sourceAgeMs;
    const staleHorizonMs = record.staleHorizonMs || POLL_STALE_HORIZONS[record.endpoint] || 120_000;
    return {
      ...record,
      receivedAgeMs,
      payloadAgeMs,
      sourceAgeMs,
      unchangedAgeMs,
      dataAgeMs,
      staleHorizonMs,
      unchangedConcern: unchangedAgeMs != null && unchangedAgeMs > staleHorizonMs,
      frozen: (sourceAgeMs != null && sourceAgeMs > staleHorizonMs)
        || (payloadAgeMs != null && payloadAgeMs > staleHorizonMs),
    };
  }

  function observe(previous, packet, validationKind = packet?.kind, now = packet?.receivedAt ?? Date.now(), endpoint = 'event', stages = {}) {
    const prior = previous || {};
    const hasPayload = packet?.kind === 'success' && packet.value != null && validationKind === 'complete';
    const nextFingerprint = hasPayload ? fingerprint(packet.value) : prior.fingerprint ?? null;
    const nextFields = hasPayload ? fieldFingerprints(packet.value, endpoint) : prior.fieldFingerprints || {};
    const changedFields = hasPayload ? changedFieldPaths(prior.fieldFingerprints, nextFields) : [];
    const changed = hasPayload && changedFields.length > 0;
    const receivedAt = Number.isFinite(packet?.receivedAt) ? packet.receivedAt : now;
    const sourceUpdatedAt = hasPayload ? sourceTimestamp(packet.value, receivedAt) : prior.sourceUpdatedAt ?? null;
    const lastChangedAt = hasPayload
      ? (changedFields.length || prior.lastChangedAt == null ? receivedAt : prior.lastChangedAt)
      : prior.lastChangedAt ?? null;
    const unchangedAgeMs = lastChangedAt == null ? null : Math.max(0, now - lastChangedAt);
    const sourceAgeMs = sourceUpdatedAt == null ? null : Math.max(0, now - sourceUpdatedAt);
    const staleHorizonMs = POLL_STALE_HORIZONS[endpoint] || 120_000;
    const payloadReceivedAt = hasPayload ? receivedAt : prior.payloadReceivedAt ?? null;
    const payloadAgeMs = payloadReceivedAt == null ? null : Math.max(0, now - payloadReceivedAt);
    const dataAgeMs = sourceAgeMs == null ? payloadAgeMs : sourceAgeMs;
    const unchangedConcern = unchangedAgeMs != null && unchangedAgeMs > staleHorizonMs;
    const frozen = (sourceAgeMs != null && sourceAgeMs > staleHorizonMs)
      || (payloadAgeMs != null && payloadAgeMs > staleHorizonMs);
    const requestFailed = packet?.kind === 'failed';
    const consecutiveFailures = requestFailed ? (prior.consecutiveFailures || 0) + 1 : 0;
    return {
      endpoint,
      kind: validationKind || packet?.kind || 'unknown',
      requestKind: packet?.kind || 'unknown',
      requestStartedAt: Number.isFinite(packet?.requestStartedAt) ? packet.requestStartedAt : receivedAt,
      requestQueuedAt: Number.isFinite(packet?.requestQueuedAt) ? packet.requestQueuedAt : null,
      queueWaitMs: Number.isFinite(packet?.queueWaitMs) ? packet.queueWaitMs : null,
      receivedAt,
      latencyMs: Number.isFinite(packet?.latencyMs) ? packet.latencyMs : null,
      elapsedMs: Number.isFinite(packet?.elapsedMs) ? packet.elapsedMs : null,
      validatedAt: Number.isFinite(stages.validatedAt) ? stages.validatedAt : null,
      validationLatencyMs: Number.isFinite(stages.validatedAt) ? Math.max(0, stages.validatedAt - receivedAt) : null,
      committedAt: Number.isFinite(stages.committedAt) ? stages.committedAt : null,
      commitLatencyMs: Number.isFinite(stages.committedAt) ? Math.max(0, stages.committedAt - receivedAt) : null,
      sourceUpdatedAt,
      sourceAgeMs,
      receivedAgeMs: Math.max(0, now - receivedAt),
      payloadReceivedAt,
      payloadAgeMs,
      dataAgeMs,
      unchangedAgeMs,
      unchangedConcern,
      staleHorizonMs,
      frozen,
      fingerprint: nextFingerprint,
      fieldFingerprints: nextFields,
      changedFields,
      changed,
      unchangedCount: hasPayload ? (changed ? 0 : (prior.unchangedCount || 0) + 1) : (prior.unchangedCount || 0),
      lastChangedAt,
      lastSuccessAt: packet?.kind === 'success' ? receivedAt : prior.lastSuccessAt ?? null,
      lastValidAt: validationKind === 'complete' ? receivedAt : prior.lastValidAt ?? null,
      consecutiveFailures,
      errorClass: packet?.errorClass || null,
      httpStatus: packet?.httpStatus ?? null,
      errorMessage: requestFailed ? String(packet?.error?.message || packet?.error || '').slice(0, 180) : null,
    };
  }

  function nextDelay(endpoint, telemetry = {}, options = {}) {
    const policy = POLL_INTERVALS[endpoint];
    if (!policy) return POLL_MS;
    if (options.finished || options.skip) return Infinity;
    if (options.upcoming) return options.kickoffInMs > 120_000 ? IDLE_POLL_MS : policy.base;
    if (telemetry.requestKind === 'not-found') return endpoint === 'event' ? 30_000 : 60_000;
    if (['invalid', 'partial', 'mismatch'].includes(telemetry.kind)) return Math.min(120_000, policy.base * 2);
    if (telemetry.requestKind === 'failed') {
      const base = telemetry.errorClass === 'timeout' ? 30_000
        : telemetry.errorClass === 'rate-limit' ? 10_000 : 5_000;
      return Math.min(120_000, base * (2 ** Math.min(5, Math.max(0, (telemetry.consecutiveFailures || 1) - 1))));
    }
    if (options.priority) return policy.priority;
    if (options.hot) return policy.hot;
    const unchanged = telemetry.unchangedCount || 0;
    if (unchanged >= 4) {
      const quietMultiplier = 2 ** Math.min(4, Math.floor(unchanged / 4));
      return Math.min(policy.maxQuiet, Math.max(policy.quiet, policy.base * quietMultiplier));
    }
    return policy.base;
  }

  function due(endpointState, now = Date.now()) {
    if (!endpointState || endpointState.nextDueAt == null) return true;
    return Number.isFinite(endpointState.nextDueAt) && endpointState.nextDueAt <= now;
  }

  function comparePollCandidates(left, right) {
    return (Number.isFinite(right.effectivePriority) ? right.effectivePriority : (right.priority || 0))
      - (Number.isFinite(left.effectivePriority) ? left.effectivePriority : (left.priority || 0))
      || (left.earliest || 0) - (right.earliest || 0)
      || Number(left.id) - Number(right.id);
  }

  return Object.freeze({
    classifyRequestError, createRequestLimiter, requestGate, captureRequest,
    sourceTimestamp, fingerprint, fieldFingerprints, changedFieldPaths,
    classifyIncidentsResponse, criticalIncidentKeys, newCriticalIncidentKeys,
    effectivePollPriority, priorityDueAt, resolveWaiters,
    ageRecord, observe, nextDelay, due, comparePollCandidates,
  });
})();

globalThis.PollingQuality = PollingQuality;
if (typeof module === 'object' && module.exports) module.exports = PollingQuality;

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
