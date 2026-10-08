'use strict';

/* Small pure helpers for the opt-in, read-only Electron live-feed smoke probe. */
(function attachLiveFeedDiagnostic(root, factory) {
  const diagnostic = factory();
  root.LiveFeedDiagnostic = diagnostic;
  if (typeof module === 'object' && module.exports) module.exports = diagnostic;
}(globalThis, () => {
  const STAT_KEYS = Object.freeze({
    shots: ['totalShotsOnGoal', 'shotsOnGoal', 'shotsOffGoal', 'blockedScoringAttempt'],
    sot: ['shotsOnGoal'],
    xg: ['expectedGoals'],
    corners: ['cornerKicks'],
    bigChances: ['bigChanceCreated', 'bigChancesCreated'],
    redCards: ['redCards'],
  });

  function numeric(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const parsed = Number(value.trim().replace('%', '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function summarizeStatistics(payload) {
    const all = payload?.statistics?.find((block) => block?.period === 'ALL');
    if (!Array.isArray(all?.groups)) return { complete: false, fields: {}, present: [], missing: Object.keys(STAT_KEYS) };
    const items = all.groups.flatMap((group) => Array.isArray(group?.statisticsItems)
      ? group.statisticsItems.filter((item) => item && typeof item === 'object') : []);
    const byKey = new Map(items.map((item) => [item.key, item]));
    const fields = {};
    const present = [];
    const missing = [];
    for (const [field, aliases] of Object.entries(STAT_KEYS)) {
      const item = aliases.map((key) => byKey.get(key)).find(Boolean);
      if (!item) {
        missing.push(field);
        fields[field] = null;
        continue;
      }
      const pair = [numeric(item.homeValue ?? item.home), numeric(item.awayValue ?? item.away)];
      fields[field] = pair;
      if (pair.every(Number.isFinite)) present.push(field);
      else missing.push(field);
    }
    return { complete: true, fields, present, missing, itemCount: items.length };
  }

  function latencySummary(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return { count: 0, p50: null, p95: null, max: null };
    const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
    return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted[sorted.length - 1] };
  }

  return Object.freeze({ STAT_KEYS, numeric, summarizeStatistics, latencySummary });
}));
