'use strict';

const API_BASE = 'https://www.sofascore.com/api/v1/';
const SOFA_PARTITION = 'persist:sofa-data';
// Our conservative request budget, not a published Sofascore limit.
const DEFAULT_LIMITS = Object.freeze({ minIntervalMs: 1250, maxPerMinute: 36, maxConcurrent: 1, maxQueue: 128 });
const PRIORITY = { interactive: 0, normal: 1, background: 3 };

function cacheKey(path) {
  const url = new URL(API_BASE + path);
  url.searchParams.delete('_');
  return url.pathname.slice('/api/v1/'.length) + url.search;
}

function cacheTime(path, data) {
  if (data === null) return 30_000;
  if (path.startsWith('config/')) return 6 * 60 * 60_000;
  if (path.includes('scheduled-tournaments/') || path.includes('/scheduled-events/')) return 5 * 60_000;
  if (path.includes('/events/live')) return 15_000;
  if (path.endsWith('/lineups') || path.endsWith('/incidents') || path.endsWith('/graph')) return 30_000;
  if (path.startsWith('search/')) return 30_000;
  return 2_000;
}

function retryTime(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return now + Math.max(0, seconds) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : 0;
}

function restoreConnection(value) {
  if (value?.state !== 'blocked' || ![403, 429].includes(value.status)) return null;
  return { state: 'blocked', status: value.status, retryAt: Number.isFinite(value.retryAt) ? value.retryAt : 0,
    challenge: !!value.challenge, cloudflare: !!value.cloudflare,
    ...(value.lastFailure ? { lastFailure: value.lastFailure } : {}) };
}

function createSofaClient({ fetch, now = Date.now, onState = () => {}, initialState,
  onDiagnostic = () => {}, limits = {}, schedule = setTimeout, cancel = clearTimeout }) {
  const policy = { ...DEFAULT_LIMITS, ...limits };
  for (const [key, minimum] of Object.entries({ minIntervalMs: 0, maxPerMinute: 1, maxConcurrent: 1, maxQueue: 1 })) {
    if (!Number.isInteger(policy[key]) || policy[key] < minimum) throw new Error(`Geçersiz istek bütçesi: ${key}`);
  }
  const pending = new Map();
  const cache = new Map();
  const queue = [];
  const starts = [];
  let active = 0, revision = 0, timer = null, nextStartAt = 0;
  let connection = restoreConnection(initialState) || { state: 'unknown', status: 0, retryAt: 0, challenge: false, cloudflare: false,
    ...(initialState?.lastFailure ? { lastFailure: initialState.lastFailure } : {}) };
  let retrying = null;

  const getState = () => ({ ...connection });
  const trimStarts = () => { while (starts.length && starts[0] <= now() - 60_000) starts.shift(); };
  const diagnostics = () => {
    trimStarts();
    return { queued: queue.length, active, startsLastMinute: starts.length, ...policy };
  };
  const publish = (next) => {
    connection = next;
    revision++;
    try { onState(getState()); } catch { /* Diagnostics must not break requests. */ }
  };
  const diagnose = (job, extra) => {
    const detail = { at: new Date(now()).toISOString(), path: job.path.split('?')[0],
      ...extra, load: diagnostics() };
    try { onDiagnostic(detail); } catch { /* Diagnostic storage must not affect requests. */ }
    return detail;
  };
  const blockedError = () => Object.assign(new Error(connection.status === 429
    ? 'Sofascore istek sınırı: otomatik istekler bekletiliyor'
    : 'Sofascore erişimi reddetti: otomatik istekler bekletiliyor'), {
    code: 'SOFA_BLOCKED', status: connection.status, retryAt: connection.retryAt,
  });
  const blocked = (probe = false) => (connection.state === 'blocked' && connection.status === 403 && !probe)
    || (connection.retryAt > now() && (!probe || connection.status === 429));
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const rejectWaiting = () => {
    clearTimer();
    for (const job of queue.splice(0)) job.reject(blockedError());
  };

  async function request(job) {
    if (blocked(job.probe)) throw blockedError();
    const startedRevision = revision;
    const startedAt = now();
    let res;
    try {
      res = await fetch(API_BASE + job.path, {
        headers: { Accept: 'application/json', Referer: 'https://www.sofascore.com/' },
        credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      diagnose(job, { type: 'network_error', status: 0, durationMs: now() - startedAt, error: error.name });
      throw error;
    }
    const cloudflare = res.headers.get('cf-mitigated') === 'challenge';
    if (res.status === 403 || res.status === 429 || cloudflare) {
      let challenge = cloudflare;
      let reason = cloudflare ? 'cloudflare_challenge' : null;
      if (res.status === 403 && !cloudflare) {
        const body = await res.json().catch(() => null);
        challenge = body?.error?.reason === 'challenge';
        reason = typeof body?.error?.reason === 'string' ? body.error.reason.slice(0, 100) : null;
      }
      const status = res.status === 429 ? 429 : 403;
      const lastFailure = diagnose(job, { type: 'denied', status, challenge, cloudflare, reason,
        durationMs: now() - startedAt, contentType: res.headers.get('content-type'),
        retryAfter: res.headers.get('retry-after') });
      publish({ state: 'blocked', status, challenge, cloudflare,
        lastFailure,
        retryAt: status === 429 ? Math.max(connection.retryAt, now() + 60_000,
          retryTime(res.headers.get('retry-after'), now())) : 0 });
      rejectWaiting();
      throw blockedError();
    }
    diagnose(job, { type: 'response', status: res.status, durationMs: now() - startedAt });
    if (!res.ok && res.status !== 404) throw Object.assign(new Error(`Sofascore ${res.status}`), { status: res.status });
    const data = res.status === 404 ? null : await res.json();
    if (startedRevision === revision && connection.state !== 'connected') {
      publish({ state: 'connected', status: 200, retryAt: 0, challenge: false, cloudflare: false,
        ...(connection.lastFailure ? { lastFailure: connection.lastFailure } : {}) });
    }
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(job.key, { data, observedAt: now(), until: now() + cacheTime(job.key, data) });
    return data;
  }

  function drain() {
    clearTimer();
    while (active < policy.maxConcurrent && queue.length) {
      trimStarts();
      const wait = Math.max(0, nextStartAt - now(), starts.length >= policy.maxPerMinute ? starts[0] + 60_000 - now() : 0);
      if (wait > 0) {
        timer = schedule(() => { timer = null; drain(); }, wait);
        return;
      }
      // Age waiting jobs so foreground traffic cannot starve other matches.
      const rank = (job) => job.probe ? -2 : Math.max(0, job.priority - Math.floor((now() - job.at) / 30_000));
      let index = 0;
      for (let i = 1; i < queue.length; i++) {
        if (rank(queue[i]) < rank(queue[index]) || (rank(queue[i]) === rank(queue[index]) && queue[i].at < queue[index].at)) index = i;
      }
      const [job] = queue.splice(index, 1);
      if (blocked(job.probe)) { job.reject(blockedError()); continue; }
      active++;
      starts.push(now());
      nextStartAt = now() + policy.minIntervalMs;
      request(job).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }

  function enqueue(path, key, priority, probe = false) {
    if (blocked(probe)) return Promise.reject(blockedError());
    if (queue.length >= policy.maxQueue) return Promise.reject(Object.assign(
      new Error('Maçlar sırayla güncelleniyor; istek kuyruğu dolu'), { code: 'SOFA_BUSY' }));
    const job = { path, key, priority, probe, at: now() };
    const promise = new Promise((resolve, reject) => { Object.assign(job, { resolve, reject }); });
    queue.push(job);
    drain();
    return promise;
  }

  function get(apiPath, options = {}) {
    if (typeof apiPath !== 'string' || !apiPath || apiPath.includes('..') ||
        /[\\\s#]/.test(apiPath) || apiPath.includes('://')) return Promise.reject(new Error('Geçersiz yol'));
    if (blocked()) return Promise.reject(blockedError());
    const path = apiPath.replace(/^\/+/, '');
    // Cache-busting timestamps must not create separate queue entries/cache keys.
    const key = cacheKey(path);
    const priority = Object.hasOwn(PRIORITY, options?.priority) ? PRIORITY[options.priority] : 1;
    if (pending.has(key)) {
      const job = queue.find((item) => item.key === key && !item.probe);
      if (job) job.priority = Math.min(job.priority, priority);
      return pending.get(key);
    }
    const cached = cache.get(key);
    if (!options?.fresh && cached?.until > now()) return Promise.resolve(cached.data);
    const work = enqueue(path, key, priority).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }

  function retry() {
    if (retrying) return retrying;
    // Manual check only; it shares the same pacing budget and Retry-After.
    retrying = enqueue('sport/football/events/live', 'sport/football/events/live', 0, true)
      .then(() => getState(), (err) => ({ ...getState(), error: err.message }))
      .finally(() => { retrying = null; });
    return retrying;
  }

  const observedAt = (path) => cache.get(cacheKey(path))?.observedAt ?? null;
  return { get, retry, getState, diagnostics, observedAt };
}

module.exports = { createSofaClient, SOFA_PARTITION, DEFAULT_LIMITS };
