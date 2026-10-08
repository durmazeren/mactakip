'use strict';

/* Bounded JSON transport used by the Electron main-process feed bridge. */
async function fetchJson(fetcher, url, options = {}, timeoutMs = 12_000, timers = globalThis) {
  if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  const controller = new AbortController();
  const timeoutError = Object.assign(new Error(`Sofascore request timed out after ${timeoutMs} ms`), { name: 'AbortError' });
  const timeoutId = timers.setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Sofascore ${response.status}`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason || timeoutError;
    throw error;
  } finally {
    timers.clearTimeout(timeoutId);
  }
}

module.exports = Object.freeze({ fetchJson });
