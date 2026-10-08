'use strict';

/* Opt-in read-only check of the same Electron net.fetch feed used by the app. */
const { app, net } = require('electron');
const os = require('node:os');
const path = require('node:path');
const PollingQuality = require('../src/js/core.js');
const LiveAnalysisState = require('../src/js/analysis-state.js');
const OddsEngine = require('../src/js/odds-engine.js');
const LiveFeedDiagnostic = require('../src/js/live-feed-diagnostic.js');

const API_BASE = 'https://www.sofascore.com/api/v1/';
const MAX_LIVE_MATCHES = 3;
const REQUEST_TIMEOUT_MS = 12_000;
const SOURCE_HEADERS = { Accept: 'application/json', Referer: 'https://www.sofascore.com/' };

app.setPath('userData', path.join(os.tmpdir(), 'mactakip-live-feed-smoke'));

async function request(pathname) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await net.fetch(API_BASE + pathname, { headers: SOURCE_HEADERS, signal: controller.signal });
    const headersReceivedAt = Date.now();
    if (response.status === 404) {
      return { kind: 'not-found', status: 404, startedAt, headersReceivedAt, parsedAt: headersReceivedAt,
        networkLatencyMs: headersReceivedAt - startedAt, parseLatencyMs: 0, value: null };
    }
    if (!response.ok) {
      return { kind: 'failed', status: response.status, startedAt, headersReceivedAt, parsedAt: headersReceivedAt,
        networkLatencyMs: headersReceivedAt - startedAt, parseLatencyMs: 0,
        errorClass: response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'server' : 'http' };
    }
    const value = await response.json();
    const parsedAt = Date.now();
    return {
      kind: value && typeof value === 'object' ? 'success' : 'invalid', status: response.status,
      startedAt, headersReceivedAt, parsedAt,
      networkLatencyMs: headersReceivedAt - startedAt,
      parseLatencyMs: parsedAt - headersReceivedAt,
      totalLatencyMs: parsedAt - startedAt,
      sourceUpdatedAt: PollingQuality.sourceTimestamp(value, parsedAt), value,
    };
  } catch (error) {
    const failedAt = Date.now();
    const errorClass = controller.signal.aborted ? 'timeout' : PollingQuality.classifyRequestError(error).key;
    return {
      kind: 'failed', status: null, startedAt, headersReceivedAt: null, parsedAt: failedAt,
      networkLatencyMs: failedAt - startedAt, parseLatencyMs: null,
      totalLatencyMs: failedAt - startedAt, errorClass,
      errorMessage: String(error?.message || error).slice(0, 160),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function eventSummary(packet, expectedId) {
  if (packet.kind !== 'success') return { kind: packet.kind };
  const classified = LiveAnalysisState.classifyApiResponse({ kind: 'success', value: packet.value }, 'event', expectedId);
  if (classified.kind !== 'complete') return { kind: classified.kind };
  const event = classified.event;
  return {
    kind: classified.kind,
    identity: LiveAnalysisState.matchIdentity(event, expectedId),
    status: event.status?.type,
    periodCode: event.status?.code,
    score: LiveAnalysisState.scorePair(event),
    clock: LiveAnalysisState.matchClock(event, Date.now()),
  };
}

function statsSummary(packet) {
  if (packet.kind !== 'success') return { kind: packet.kind };
  const classified = LiveAnalysisState.classifyApiResponse({ kind: 'success', value: packet.value }, 'statistics');
  if (!['complete', 'empty'].includes(classified.kind)) return { kind: classified.kind };
  return { kind: classified.kind, ...LiveFeedDiagnostic.summarizeStatistics(packet.value) };
}

function incidentsSummary(packet, expectedId) {
  if (packet.kind !== 'success') return { kind: packet.kind };
  const classified = PollingQuality.classifyIncidentsResponse(packet.value, expectedId);
  if (classified.kind !== 'complete') return { kind: classified.kind };
  return {
    kind: 'complete',
    count: classified.incidents.length,
    criticalEventCount: PollingQuality.criticalIncidentKeys(classified.incidents).length,
  };
}

function oddsSummary(packet, event) {
  if (packet.kind !== 'success') return { kind: packet.kind };
  const classified = LiveAnalysisState.classifyOddsResponse({ kind: 'success', value: packet.value });
  if (!['complete', 'empty'].includes(classified.kind)) return { kind: classified.kind };
  const observedAt = packet.parsedAt;
  const snapshot = OddsEngine.parseSnapshot(packet.value, {
    eventLive: event?.status?.type === 'inprogress',
    eventIdentity: LiveAnalysisState.matchIdentity(event), observedAt, event,
  });
  const summary = OddsEngine.summary(snapshot, Date.now());
  const marketCount = snapshot?.rawMarketCount || 0;
  const quoteCount = Object.values(snapshot?.markets || {}).reduce((count, group) =>
    count + (group && typeof group === 'object'
      ? (Array.isArray(group) ? group.length : Object.keys(group).length) : Number(!!group)), 0);
  const raw = packet.value?.markets || packet.value?.odds?.markets
    || packet.value?.eventOdds?.markets || packet.value?.data?.markets;
  const marketRows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const families = new Map();
  for (const market of marketRows) {
    const choices = Array.isArray(market?.choices) ? market.choices
      : Array.isArray(market?.outcomes) ? market.outcomes
        : Array.isArray(market?.selections) ? market.selections : [];
    const family = String(market?.marketGroup ?? market?.marketName ?? market?.name ?? 'unknown').slice(0, 80);
    const period = String(market?.marketPeriod ?? market?.periodName ?? 'unknown').slice(0, 40);
    const key = `${family}|${period}`;
    const row = families.get(key) || {
      family, period, marketCount: 0, liveMarketCount: 0, suspendedMarketCount: 0,
      choiceCount: 0, pricedChoiceCount: 0, choiceIdCount: 0,
      marketTimestampCount: 0, selectionTimestampCount: 0, lineSamples: [], outcomeSamples: [],
      providerIdentityCount: 0,
    };
    row.marketCount++;
    if (market?.isLive === true || market?.live === true || market?.inPlay === true) row.liveMarketCount++;
    if (market?.suspended === true || market?.isSuspended === true) row.suspendedMarketCount++;
    row.choiceCount += choices.length;
    row.pricedChoiceCount += choices.filter((choice) =>
      ['decimalValue', 'decimalOdds', 'odds', 'price', 'fractionalValue', 'fractionalOdds', 'americanValue', 'americanOdds', 'value']
        .some((field) => choice?.[field] != null && choice[field] !== '')).length;
    row.choiceIdCount += choices.filter((choice) =>
      choice?.choiceId != null || choice?.selectionId != null || choice?.sourceId != null || choice?.id != null).length;
    const timestampFields = ['lastUpdatedAt', 'lastUpdatedTimestamp', 'lastUpdateTimestamp', 'updatedAt', 'updateTimestamp', 'lastUpdate', 'timestamp'];
    if (timestampFields.some((field) => market?.[field] != null)) row.marketTimestampCount++;
    row.selectionTimestampCount += choices.filter((choice) => timestampFields.some((field) => choice?.[field] != null)).length;
    if (market?.provider || market?.bookmaker || market?.providerId != null || market?.bookmakerId != null) row.providerIdentityCount++;
    if (market?.choiceGroup != null && row.lineSamples.length < 4 && !row.lineSamples.includes(String(market.choiceGroup)))
      row.lineSamples.push(String(market.choiceGroup));
    for (const choice of choices) {
      const label = String(choice?.name ?? choice?.label ?? choice?.selectionName ?? '').slice(0, 48);
      if (label && row.outcomeSamples.length < 4 && !row.outcomeSamples.includes(label)) row.outcomeSamples.push(label);
    }
    families.set(key, row);
  }
  const marketFamilies = [...families.values()].sort((a, b) => b.marketCount - a.marketCount).slice(0, 12);
  return {
    kind: classified.kind, marketCount, parsedQuoteGroups: quoteCount,
    parserDiagnostics: snapshot?.diagnostics ?? null, freshness: summary, marketFamilies,
  };
}

function elapsedSince(timestamp, now = Date.now()) {
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

async function runProbe() {
  const startedAt = Date.now();
  const catalog = await request('sport/football/events/live');
  if (catalog.kind !== 'success') {
    return { status: 'FEED_REQUEST_FAILED', startedAt, catalog: { ...catalog, value: undefined } };
  }
  const events = Array.isArray(catalog.value?.events) ? catalog.value.events : [];
  const liveEvents = events.filter((event) => event?.status?.type === 'inprogress'
    && [6, 7, 41, 42].includes(event.status?.code));
  const requestedId = Number(process.env.MACTAKIP_LIVE_SMOKE_EVENT_ID);
  const requestedMatch = Number.isSafeInteger(requestedId)
    ? liveEvents.find((event) => Number(event.id) === requestedId) : null;
  if (Number.isSafeInteger(requestedId) && !requestedMatch) {
    return {
      status: 'SKIPPED_REQUESTED_EVENT_NOT_ACTIVE', startedAt,
      catalog: { kind: 'success', status: catalog.status, latencyMs: catalog.totalLatencyMs, eventCount: events.length },
      requestedEventId: requestedId,
    };
  }
  const active = requestedMatch ? [requestedMatch] : liveEvents.slice(0, MAX_LIVE_MATCHES);
  if (!active.length) {
    return {
      status: 'SKIPPED_NO_ACTIVE_MATCH', startedAt,
      catalog: { kind: 'success', status: catalog.status, latencyMs: catalog.totalLatencyMs, eventCount: events.length },
      note: 'No supported live football event was available at probe time; event/statistics/odds validation was not run.',
    };
  }

  const matches = await Promise.all(active.map(async (listed) => {
    const id = Number(listed.id);
    const [eventPacket, statsPacket, oddsPacket, incidentsPacket] = await Promise.all([
      request(`event/${id}`), request(`event/${id}/statistics`), request(`event/${id}/odds/1/all`),
      request(`event/${id}/incidents`),
    ]);
    const analysisStartedAt = Date.now();
    const eventCheck = eventSummary(eventPacket, id);
    const actualEvent = eventPacket.kind === 'success' ? eventPacket.value?.event : null;
    const statistics = statsSummary(statsPacket);
    const odds = oddsSummary(oddsPacket, actualEvent);
    const incidents = incidentsSummary(incidentsPacket, id);
    const analysisFinishedAt = Date.now();
    return {
      eventId: id,
      event: eventCheck,
      statistics,
      odds,
      incidents,
      telemetry: {
        event: {
          requestStartedAt: eventPacket.startedAt,
          responseHeadersAt: eventPacket.headersReceivedAt,
          parsedAt: eventPacket.parsedAt,
          providerTimestampAt: eventPacket.sourceUpdatedAt ?? null,
          providerAgeMs: elapsedSince(eventPacket.sourceUpdatedAt),
          networkLatencyMs: eventPacket.networkLatencyMs,
          parseLatencyMs: eventPacket.parseLatencyMs,
          totalLatencyMs: eventPacket.totalLatencyMs ?? eventPacket.networkLatencyMs,
        },
        statistics: {
          requestStartedAt: statsPacket.startedAt,
          responseHeadersAt: statsPacket.headersReceivedAt,
          parsedAt: statsPacket.parsedAt,
          providerTimestampAt: statsPacket.sourceUpdatedAt ?? null,
          providerAgeMs: elapsedSince(statsPacket.sourceUpdatedAt),
          networkLatencyMs: statsPacket.networkLatencyMs,
          parseLatencyMs: statsPacket.parseLatencyMs,
          totalLatencyMs: statsPacket.totalLatencyMs ?? statsPacket.networkLatencyMs,
        },
        odds: {
          requestStartedAt: oddsPacket.startedAt,
          responseHeadersAt: oddsPacket.headersReceivedAt,
          parsedAt: oddsPacket.parsedAt,
          providerTimestampAt: oddsPacket.sourceUpdatedAt ?? null,
          providerAgeMs: elapsedSince(oddsPacket.sourceUpdatedAt),
          networkLatencyMs: oddsPacket.networkLatencyMs,
          parseLatencyMs: oddsPacket.parseLatencyMs,
          totalLatencyMs: oddsPacket.totalLatencyMs ?? oddsPacket.networkLatencyMs,
        },
        incidents: {
          requestStartedAt: incidentsPacket.startedAt,
          responseHeadersAt: incidentsPacket.headersReceivedAt,
          parsedAt: incidentsPacket.parsedAt,
          providerTimestampAt: incidentsPacket.sourceUpdatedAt ?? null,
          providerAgeMs: elapsedSince(incidentsPacket.sourceUpdatedAt),
          networkLatencyMs: incidentsPacket.networkLatencyMs,
          parseLatencyMs: incidentsPacket.parseLatencyMs,
          totalLatencyMs: incidentsPacket.totalLatencyMs ?? incidentsPacket.networkLatencyMs,
        },
        analysisStartedAt,
        analysisFinishedAt,
        analysisLatencyMs: analysisFinishedAt - analysisStartedAt,
      },
      errors: [eventPacket, statsPacket, oddsPacket, incidentsPacket].filter((packet) => packet.kind === 'failed')
        .map((packet) => ({ status: packet.status, errorClass: packet.errorClass, errorMessage: packet.errorMessage })),
    };
  }));

  const latencies = matches.flatMap((match) => Object.values(match.telemetry)
    .filter((stage) => Number.isFinite(stage.totalLatencyMs)).map((stage) => stage.totalLatencyMs));
  const eventsComplete = matches.filter((match) => match.event.kind === 'complete').length;
  const statisticsComplete = matches.filter((match) =>
    match.statistics.kind === 'complete' && match.statistics.complete === true).length;
  const incidentsComplete = matches.filter((match) => match.incidents.kind === 'complete').length;
  const oddsResponses = matches.filter((match) => ['complete', 'empty'].includes(match.odds.kind)).length;
  const parsedQuoteGroups = matches.reduce((sum, match) => sum + (match.odds.parsedQuoteGroups || 0), 0);
  const coreFailure = eventsComplete === 0 || statisticsComplete === 0 || incidentsComplete === 0;
  const anyOddsEndpoint = matches.some((match) => ['complete', 'empty'].includes(match.odds.kind));
  const anyFreshOdds = matches.some((match) => ['live', 'aging'].includes(match.odds.freshness?.key));
  const partialSourceResponses = eventsComplete < matches.length
    || statisticsComplete < matches.length || incidentsComplete < matches.length;
  return {
    status: coreFailure ? 'LIVE_FEED_VALIDATION_FAILED'
      : partialSourceResponses ? 'LIVE_FEED_PARTIAL_SOURCE_RESPONSES'
        : anyFreshOdds ? 'LIVE_FEED_VALIDATED_WITH_FRESH_ODDS'
          : anyOddsEndpoint && parsedQuoteGroups > 0 ? 'LIVE_FEED_VALIDATED_ODDS_UNVERIFIED_OR_STALE'
            : anyOddsEndpoint ? 'LIVE_FEED_VALIDATED_NO_SUPPORTED_ODDS_MARKETS'
              : 'LIVE_FEED_ODDS_ENDPOINT_FAILED',
    startedAt,
    catalog: { kind: 'success', status: catalog.status, latencyMs: catalog.totalLatencyMs, eventCount: events.length },
    sampleCount: matches.length,
    validationCounts: {
      eventComplete: eventsComplete,
      statisticsComplete,
      incidentsComplete,
      oddsResponses,
      parsedQuoteGroups,
      freshOddsMatches: matches.filter((match) => ['live', 'aging'].includes(match.odds.freshness?.key)).length,
    },
    matches,
    aggregateRequestLatencyMs: LiveFeedDiagnostic.latencySummary(latencies),
    note: 'Read-only one-shot sample. This measures Electron transport and source timestamps at probe time; it cannot estimate poll-to-provider delay or empirical prediction accuracy without repeated samples and labeled history.',
  };
}

app.whenReady().then(async () => {
  try {
    const result = await runProbe();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'LIVE_FEED_VALIDATION_FAILED' || result.status === 'FEED_REQUEST_FAILED') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'PROBE_FAILED', error: String(error?.stack || error) })}\n`);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
