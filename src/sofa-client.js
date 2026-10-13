'use strict';

const API_BASE = 'https://www.sofascore.com/api/v1/';
const SOFA_PARTITION = 'persist:sofa';

function cacheTime(path) {
  if (path.startsWith('config/')) return 6 * 60 * 60_000;
  if (path.includes('scheduled-tournaments/')) return 5 * 60_000;
  if (path.includes('/scheduled-events/')) return 5 * 60_000;
  return 2_000; // Canlı verilerde yalnızca aynı anda yinelenen istekleri birleştir.
}

function retryTime(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return now + Math.max(0, seconds) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : 0;
}

function createSofaClient({ fetch, now = Date.now, onState = () => {} }) {
  const pending = new Map();
  const cache = new Map();
  const queue = [];
  let active = 0;
  let revision = 0;
  let connection = { state: 'unknown', status: 0, retryAt: 0, challenge: false, cloudflare: false };
  let retrying = null;

  const getState = () => ({ ...connection });
  const publish = (next) => {
    connection = next;
    revision++;
    onState(getState());
  };
  const blockedError = () => Object.assign(new Error(connection.status === 429
    ? 'Sofascore istek sınırı: otomatik istekler bekletiliyor'
    : 'Sofascore erişimi reddetti: otomatik istekler bekletiliyor'), {
    code: 'SOFA_BLOCKED', status: connection.status, retryAt: connection.retryAt,
  });

  async function request(path, probe = false) {
    if ((connection.state === 'blocked' && connection.status === 403 && !probe) ||
        (connection.retryAt > now() && (!probe || connection.status === 429))) throw blockedError();
    const startedRevision = revision;
    const res = await fetch(API_BASE + path, {
      headers: { Accept: 'application/json', Referer: 'https://www.sofascore.com/' },
      credentials: 'include',
      cache: 'no-store', // tarayıcı önbelleği eski (ör. maç öncesi 404) yanıt vermesin
      signal: AbortSignal.timeout(8_000),
    });
    const cloudflare = res.headers.get('cf-mitigated') === 'challenge';
    if (res.status === 403 || res.status === 429 || cloudflare) {
      let challenge = cloudflare;
      if (res.status === 403 && !cloudflare) {
        const body = await res.json().catch(() => null);
        challenge = body?.error?.reason === 'challenge';
      }
      const status = res.status === 429 ? 429 : 403;
      publish({ state: 'blocked', status, challenge, cloudflare,
        retryAt: status === 429 ? Math.max(connection.retryAt, now() + 60_000,
          retryTime(res.headers.get('retry-after'), now())) : 0 });
      throw blockedError();
    }
    if (!res.ok && res.status !== 404) {
      throw Object.assign(new Error(`Sofascore ${res.status}`), { status: res.status });
    }
    const data = res.status === 404 ? null : await res.json();
    // Engelleme gelmeden önce başlamış başka bir istek başarılı olsa da beklemeyi kaldırma.
    if (startedRevision === revision && connection.state !== 'connected') {
      publish({ state: 'connected', status: 200, retryAt: 0, challenge: false, cloudflare: false });
    }
    if (cache.size >= 250) cache.delete(cache.keys().next().value);
    cache.set(path, { data, until: now() + cacheTime(path) });
    return data;
  }

  function drain() {
    while (active < 2 && queue.length) {
      const job = queue.shift();
      active++;
      request(job.path, job.probe).then(job.resolve, job.reject).finally(() => {
        active--;
        drain();
      });
    }
  }

  function enqueue(path, probe = false) {
    return new Promise((resolve, reject) => {
      queue.push({ path, probe, resolve, reject });
      drain();
    });
  }

  function get(apiPath) {
    if (typeof apiPath !== 'string' || !apiPath || apiPath.includes('..') ||
        /[\\\s#]/.test(apiPath) || apiPath.includes('://')) {
      return Promise.reject(new Error('Geçersiz yol'));
    }
    const path = apiPath.replace(/^\/+/, '');
    const cached = cache.get(path);
    if (cached?.until > now()) return Promise.resolve(cached.data);
    if (pending.has(path)) return pending.get(path);
    const work = enqueue(path).finally(() => pending.delete(path));
    pending.set(path, work);
    return work;
  }

  function retry() {
    if (retrying) return retrying;
    // Kullanıcının ağ değiştirdikten sonra yaptığı tek kontrol; Retry-After'a uyulur.
    retrying = enqueue('sport/football/events/live', true)
      .then(() => getState(), (err) => ({ ...getState(), error: err.message }))
      .finally(() => { retrying = null; });
    return retrying;
  }

  return { get, retry, getState };
}

module.exports = { createSofaClient, SOFA_PARTITION };
