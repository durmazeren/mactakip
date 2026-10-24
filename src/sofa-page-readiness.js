'use strict';

// Passive response metadata for the visible connection window. This neither
// sends requests nor changes headers, cookies, sessions or challenge controls.
function createSofaPageReadiness(session) {
  const waiting = new Map();
  session.webRequest.onResponseStarted({ urls: ['https://www.sofascore.com/api/v1/*'] }, (details) => {
    if (details.fromCache || details.statusCode < 200 || details.statusCode >= 300) return;
    let path;
    try {
      const url = new URL(details.url);
      if (url.origin !== 'https://www.sofascore.com') return;
      path = url.pathname;
    } catch { return; }
    if (!/^\/api\/v1\/(?:sport\/football\/(?:events\/live$|scheduled-events\/)|event\/\d+(?:\/|$))/.test(path)) return;
    const entry = Object.entries(details.responseHeaders || {}).find(([key]) => key.toLowerCase() === 'content-type');
    const contentType = Array.isArray(entry?.[1]) ? entry[1].join(';') : entry?.[1];
    if (!String(contentType || '').toLowerCase().includes('application/json')) return;
    waiting.get(details.webContentsId)?.({ path, status: details.statusCode });
  });
  return { watch: (page, callback) => {
    waiting.set(page.id, callback);
    return () => { if (waiting.get(page.id) === callback) waiting.delete(page.id); };
  } };
}

module.exports = { createSofaPageReadiness };
