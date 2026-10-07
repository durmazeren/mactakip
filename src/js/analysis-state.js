'use strict';

/* Pure live-response and match-continuity guards shared by renderer and tests. */
(function attachAnalysisState(root, factory) {
  const state = factory();
  root.LiveAnalysisState = state;
  if (typeof module === 'object' && module.exports) module.exports = state;
}(globalThis, () => {
  const PERIODS = {
    6: { phase: '1Y', offset: 0, end: 45, stoppageKey: 'injuryTime1' },
    7: { phase: '2Y', offset: 45, end: 90, stoppageKey: 'injuryTime2' },
    41: { phase: 'UZ1', offset: 90, end: 105, stoppageKey: 'extraTime1' },
    42: { phase: 'UZ2', offset: 105, end: 120, stoppageKey: 'extraTime2' },
  };
  const COUNTER_KEYS = [
    'shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed', 'redCards',
  ];

  function responseParts(response) {
    if (response === undefined) return { kind: 'failed' };
    if (response === null) return { kind: 'not-found' };
    if (response && ['failed', 'not-found', 'success'].includes(response.kind)) {
      return response.kind === 'success'
        ? { kind: 'success', value: response.value }
        : { kind: response.kind, error: response.error };
    }
    return { kind: 'success', value: response };
  }

  function classifyApiResponse(response, endpoint, expectedId) {
    const result = responseParts(response);
    if (result.kind !== 'success') return result;
    const value = result.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };

    if (endpoint === 'event') {
      const event = value.event;
      if (!event || typeof event !== 'object') return { kind: 'partial' };
      const id = Number(event.id);
      if (!Number.isSafeInteger(id) || id !== Number(expectedId)) return { kind: 'mismatch' };
      if (!event.status || typeof event.status.type !== 'string'
        || !event.homeTeam || !event.awayTeam) return { kind: 'partial', event };
      if (event.status.type === 'inprogress' && !scorePair(event)) return { kind: 'partial', event };
      return { kind: 'complete', event };
    }

    if (endpoint === 'statistics') {
      if (!Array.isArray(value.statistics)) return { kind: 'partial' };
      if (!value.statistics.length) return { kind: 'empty' };
      const all = value.statistics.find((block) => block?.period === 'ALL');
      if (!all || !Array.isArray(all.groups)) return { kind: 'partial' };
      const structurallyValid = all.groups.every((group) =>
        Array.isArray(group?.statisticsItems));
      return structurallyValid ? { kind: 'complete', value } : { kind: 'partial' };
    }

    return { kind: 'invalid' };
  }

  function classifyOddsResponse(response) {
    const result = responseParts(response);
    if (result.kind !== 'success') return result;
    const value = result.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
    const raw = value.markets || value.odds?.markets || value.eventOdds?.markets || value.data?.markets;
    if (!raw || typeof raw !== 'object') return { kind: 'partial' };
    const markets = Array.isArray(raw) ? raw : Object.values(raw);
    return markets.length ? { kind: 'complete' } : { kind: 'empty' };
  }

  function scorePair(event) {
    const home = event?.homeScore?.current;
    const away = event?.awayScore?.current;
    return Number.isSafeInteger(home) && home >= 0 && Number.isSafeInteger(away) && away >= 0
      ? [home, away] : null;
  }

  function phaseForEvent(event) {
    const code = event?.status?.code;
    if (code === 31) return 'İY';
    if (code === 50) return 'PEN';
    return PERIODS[code]?.phase || `P${code ?? 'BİLİNMİYOR'}`;
  }

  function numericTimestamp(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (value > 1e12) return value / 1000;
    if (value > 1e9) return value;
    return null;
  }

  function boundedAddedTime(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 20 ? Math.ceil(parsed) : null;
  }

  function matchClock(event, nowMs = Date.now()) {
    const status = event?.status;
    if (status?.type !== 'inprogress') return { known: false, minute: null, phase: phaseForEvent(event) };
    const period = PERIODS[status.code];
    if (!period) return { known: false, minute: null, phase: phaseForEvent(event) };
    const time = event.time || {};
    const start = numericTimestamp(time.currentPeriodStartTimestamp);
    if (start == null) {
      return {
        known: false, minute: null, phase: period.phase,
        endMinute: period.end, stoppageKnown: false, source: 'unknown',
      };
    }
    const elapsed = Math.max(0, nowMs / 1000 - start);
    const minute = period.offset + Math.floor(elapsed / 60) + 1;
    const explicitEnd = numericTimestamp(time.currentPeriodEndTimestamp);
    const added = boundedAddedTime(time[period.stoppageKey]);
    let endMinute = period.end;
    let matchEndMinute = status.code === 6 ? 90
      : status.code === 41 ? 120 : period.end;
    let stoppageKnown = false;
    let endSource = 'regulation-boundary';
    if (explicitEnd != null && explicitEnd > start) {
      endMinute = Math.max(period.end, period.offset + Math.ceil((explicitEnd - start) / 60));
      stoppageKnown = true;
      endSource = 'provider-period-end';
    } else if (added != null) {
      endMinute += added;
      stoppageKnown = true;
      endSource = 'provider-added-time';
    }
    if (status.code === 6) {
      const secondHalfAdded = boundedAddedTime(time.injuryTime2);
      if (secondHalfAdded != null) matchEndMinute += secondHalfAdded;
    } else if (status.code === 7) {
      matchEndMinute = endMinute;
    } else if (status.code === 41) {
      const secondExtraAdded = boundedAddedTime(time.extraTime2);
      if (secondExtraAdded != null) matchEndMinute += secondExtraAdded;
    } else if (status.code === 42) {
      matchEndMinute = endMinute;
    }
    return {
      known: true, minute, phase: period.phase, endMinute, matchEndMinute,
      stoppageKnown, inStoppage: minute > period.end,
      source: 'period-start-timestamp', endSource,
    };
  }

  function matchIdentity(event, fallbackId) {
    const identityPart = (item) => item?.id ?? item?.name ?? '';
    return [
      event?.id ?? fallbackId,
      identityPart(event?.homeTeam), identityPart(event?.awayTeam),
      identityPart(event?.tournament), event?.startTimestamp ?? '',
    ].join('|');
  }

  function validPair(pair) {
    return Array.isArray(pair) && pair.length >= 2 && pair.every(Number.isFinite)
      ? [pair[0], pair[1]] : null;
  }

  function resetReason(previous, current) {
    if (!previous) return 'initial';
    if (previous.identity !== current.identity) return 'event-identity';
    if (previous.phase !== current.phase) return 'phase-change';
    const oldScore = validPair(previous.score);
    const newScore = validPair(current.score);
    if (oldScore && newScore && (oldScore[0] !== newScore[0] || oldScore[1] !== newScore[1])) {
      return 'score-change';
    }
    if (Number.isFinite(previous.minute) && Number.isFinite(current.minute)
      && current.minute < previous.minute) return 'clock-regression';
    for (const key of COUNTER_KEYS) {
      const oldPair = validPair(previous.stats?.[key]);
      const newPair = validPair(current.stats?.[key]);
      if (oldPair && newPair && (newPair[0] < oldPair[0] || newPair[1] < oldPair[1])) {
        return `counter-reset:${key}`;
      }
    }
    return null;
  }

  function weightedPairRate(samples, statKey, nowMs, windowMs = 300_000, halfLifeMs = 90_000) {
    const cutoff = nowMs - windowMs;
    const usable = (samples || []).filter((sample) => sample.at >= cutoff && validPair(sample.stats?.[statKey]));
    if (usable.length < 2 || halfLifeMs <= 0) return null;
    const weightedDelta = [0, 0];
    let weightedMinutes = 0;
    for (let index = 1; index < usable.length; index++) {
      const previous = usable[index - 1];
      const current = usable[index];
      const elapsed = current.at - previous.at;
      const before = validPair(previous.stats?.[statKey]);
      const after = validPair(current.stats?.[statKey]);
      if (elapsed <= 0 || !before || !after) continue;
      const delta = [after[0] - before[0], after[1] - before[1]];
      if (delta.some((value) => value < 0)) continue;
      const weight = Math.exp(-Math.LN2 * Math.max(0, nowMs - current.at) / halfLifeMs);
      weightedDelta[0] += delta[0] * weight;
      weightedDelta[1] += delta[1] * weight;
      weightedMinutes += elapsed / 60_000 * weight;
    }
    return weightedMinutes > 0 ? weightedDelta.map((value) => value / weightedMinutes) : null;
  }

  return {
    PERIODS, COUNTER_KEYS,
    classifyApiResponse, classifyOddsResponse, scorePair, phaseForEvent, matchClock, matchIdentity, resetReason,
    weightedPairRate,
  };
}));
