'use strict';
const fs = require('node:fs');

// Bounded local log of response metadata. Never log cookies, token values,
// request headers, API payloads or URL query strings.
function createSofaDiagnostics(file) {
  const recent = [];
  function record(detail) {
    const safe = {};
    for (const key of ['at', 'type', 'path', 'status', 'durationMs', 'error', 'challenge', 'cloudflare', 'reason',
      'contentType', 'retryAfter', 'load', 'phase', 'lastStartedAt', 'armed', 'cooldownMs', 'profiles']) {
      if (detail[key] !== undefined) safe[key] = key === 'path' ? String(detail[key]).split('?')[0] : detail[key];
    }
    recent.push(safe);
    if (recent.length > 100) recent.shift();
    if (!['denied', 'network_error', 'recovery', 'site', 'profiles'].includes(safe.type)) return;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.previous');
      fs.appendFileSync(file, JSON.stringify({ ...safe, recent: recent.slice(-60) }) + '\n', { mode: 0o600 });
    } catch { /* Logging cannot interrupt live matches. */ }
  }
  return { record };
}

module.exports = { createSofaDiagnostics };
