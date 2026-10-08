'use strict';

/* Maç ekleme/çıkarma, canlı güncelleme ve başlangıç. Yardımcılar js/ altındaki dosyalarda. */

async function addMatch(id, ev, anim) {
  const existing = findMatch(id);
  if (existing) {
    if (anim && !existing.anim) setAnim(id, true);
    return;
  }
  if (state.matches.length >= MAX_TOTAL) { setStatus(`En fazla ${MAX_TOTAL} maç eklenebilir`); return; }
  if (anim && animIds().length >= MAX_ANIM) {
    setStatus(`Animasyon en fazla ${MAX_ANIM} maç; bu maç sadece şut ekranına eklendi`);
    anim = false;
  }
  if (!ev) {
    const res = await api(`event/${id}`).catch(() => null);
    if (!res?.event) { setStatus(`Maç bulunamadı (#${id})`); return; }
    ev = res.event;
  }
  if (findMatch(id)) return; // beklerken eklendiyse
  state.matches.push({ id, anim });
  state.events.set(id, ev);
  saveMatches();
  if (anim) createTile(id);
  refresh(true);
  pollOne(id).catch(() => {});
}

function setAnim(id, anim) {
  const m = findMatch(id);
  if (!m || m.anim === anim) return;
  if (anim && animIds().length >= MAX_ANIM) { setStatus(`Animasyon en fazla ${MAX_ANIM} maç`); return; }
  m.anim = anim;
  saveMatches();
  if (anim) createTile(id); else destroyTile(id);
  refresh(true);
}

function removeMatch(id) {
  cancelPollWaiters(id, { ok: false, failed: false, changed: false, skipped: true, removed: true });
  state.pollRevision.set(id, (state.pollRevision.get(id) || 0) + 1);
  state.matches = state.matches.filter((m) => m.id !== id);
  saveMatches();
  destroyTile(id);
  removeTargetsOf(id);
  forgetAlerts(id);
  state.events.delete(id);
  state.eventIncidents.delete(id);
  state.stats.delete(id);
  state.liveOdds.delete(id);
  state.apiStatus.delete(id);
  state.lastPoll.delete(id);
  state.pollState.delete(id);
  state.pollTelemetry.delete(id);
  state.pollInFlight.delete(id);
  forgetAnalysis(id);
  delete state.layout.free[id];
  state.layout.z = state.layout.z.filter((x) => x !== id);
  if (state.layout.focus === id) state.layout.focus = null;
  saveLayout();
  refresh(true);
}

// ↻ Maçı sıfırdan yükle: önbellekteki veriyi at, animasyonu yeniden aç, hemen sorgula
async function resetMatch(id) {
  if (!findMatch(id)) return;
  state.pollRevision.set(id, (state.pollRevision.get(id) || 0) + 1);
  const buttons = [state.tiles.get(id)?.el, shotCards.get(id)?.el]
    .filter(Boolean).map((n) => $('.reset-btn', n));
  buttons.forEach((b) => b.classList.add('spinning'));
  state.stats.delete(id);
  state.liveOdds.delete(id);
  state.eventIncidents.delete(id);
  const priorEvent = state.events.get(id);
  if (priorEvent) state.events.set(id, { ...priorEvent, incidents: [] });
  state.lastPoll.delete(id);
  state.lastOddsPoll.delete(id);
  state.apiStatus.delete(id);
  state.pollState.delete(id);
  state.pollTelemetry.delete(id);
  players.delete(id);
  forgetAnalysis(id);
  forgetAlerts(id); // yeni veriyle sahte şut uyarısı çıkmasın
  for (const k of [...state.lastShown.keys()]) if (k.startsWith(`${id}|`)) state.lastShown.delete(k);
  const tile = state.tiles.get(id);
  if (tile) {
    if (tile.webview) { tile.webview.remove(); tile.webview = null; }
    tile.mode = null; // updateTile animasyonu baştan kurar
  }
  const result = await pollOne(id, { force: true });
  renderShotList();
  renderAnalysisList();
  buttons.forEach((b) => b.classList.remove('spinning'));
  const ev = state.events.get(id);
  setStatus(result?.ok ? `${teamName(ev?.homeTeam)} – ${teamName(ev?.awayTeam)} yenilendi` : 'Yenilenemedi, bağlantıyı kontrol et');
}

function refresh(animate) {
  const hasAnim = animIds().length > 0;
  $('#empty').hidden = hasAnim;
  $('#empty h2').textContent = state.matches.length ? 'Animasyonlu maç yok' : 'Henüz maç seçilmedi';
  $('#empty p').textContent = state.matches.length
    ? 'Şut ekranındaki ▷ düğmesiyle bir maçın animasyonunu açabilirsin.'
    : 'Üstteki kutuya tıklayıp canlı ya da bugünkü maçlardan seç, veya bir Sofascore maç linki yapıştır.';
  applyLayout(animate);
  renderShotList();
  renderAnalysisList();
  updateFeedHealth();
}

/* ---------- Canlı güncelleme ---------- */

const ENDPOINT_LABELS = { event: 'Maç', statistics: 'İstatistik', odds: 'Oran' };

ENDPOINT_LABELS.incidents = 'Olay';

function matchPollState(id) {
  let entry = state.pollState.get(id);
  if (!entry) {
    entry = {
      hotUntil: 0,
      priorityUntil: 0,
      lastPriorityAt: 0,
      endpoints: Object.fromEntries(POLL_ENDPOINTS.map((endpoint) => [endpoint, {
        nextDueAt: 0, priorityRounds: 0,
      }])),
    };
    state.pollState.set(id, entry);
  }
  return entry;
}

function endpointNamesDue(id, now = Date.now()) {
  const event = state.events.get(id);
  if (!findMatch(id) || isOver(event)) return [];
  const schedule = matchPollState(id);
  if (schedule.priorityUntil && now >= schedule.priorityUntil) {
    schedule.priorityUntil = 0;
    for (const endpoint of POLL_ENDPOINTS) schedule.endpoints[endpoint].priorityRounds = 0;
  }
  let eligible = ['event'];
  if (event?.status?.type === 'notstarted') {
    const kickoffInMs = Number.isFinite(event.startTimestamp) ? event.startTimestamp * 1000 - now : Infinity;
    schedule.endpoints.event.normalDelay = kickoffInMs > 120_000 ? IDLE_POLL_MS : POLL_INTERVALS.event.base;
  } else if (isLive(event)) {
    eligible.push('statistics', 'incidents');
    if ([6, 7, 41, 42].includes(event.status?.code)) eligible.push('odds');
  }
  return eligible.filter((endpoint) => PollingQuality.due(schedule.endpoints[endpoint], now));
}

function scheduleEndpoint(id, endpoint, packet, kind, now = Date.now(), stages = {}) {
  const schedule = matchPollState(id);
  const endpointState = schedule.endpoints[endpoint];
  const old = state.pollTelemetry.get(id)?.[endpoint];
  const record = PollingQuality.observe(old, packet, kind, now, endpoint, stages);
  const priority = endpointState.priorityRounds > 0 && now < schedule.priorityUntil;
  const priorityDelay = priority && endpointState.priorityRounds > 1;
  const live = isLive(state.events.get(id));
  const interval = endpointState.normalDelay || POLL_INTERVALS[endpoint].base;
  const delay = live
    ? PollingQuality.nextDelay(endpoint, record, { priority: priorityDelay, hot: now < schedule.hotUntil })
    : interval;
  endpointState.nextDueAt = Number.isFinite(delay) ? record.receivedAt + delay : Infinity;
  endpointState.lastRequestAt = record.requestStartedAt;
  endpointState.consecutiveFailures = record.consecutiveFailures;
  if (priority && packet?.kind !== 'failed') endpointState.priorityRounds = Math.max(0, endpointState.priorityRounds - 1);
  const telemetry = state.pollTelemetry.get(id) || {};
  telemetry[endpoint] = { ...record, nextDueAt: endpointState.nextDueAt };
  state.pollTelemetry.set(id, telemetry);
  return record;
}

function prioritizeMatch(id, now = Date.now(), { immediate = false, eventKey = null } = {}) {
  const schedule = matchPollState(id);
  if (eventKey && schedule.lastPriorityKey === eventKey) return false;
  if (!eventKey && schedule.lastPriorityAt && now - schedule.lastPriorityAt < 30_000) return false;
  schedule.lastPriorityAt = now;
  schedule.lastPriorityKey = eventKey || schedule.lastPriorityKey || null;
  schedule.hotUntil = Math.max(schedule.hotUntil, now + 30_000);
  schedule.priorityUntil = now + 20_000;
  for (const endpoint of POLL_ENDPOINTS) {
    const endpointState = schedule.endpoints[endpoint];
    endpointState.priorityRounds = immediate ? 1 : 2;
    const dueAt = PollingQuality.priorityDueAt(now, POLL_INTERVALS[endpoint].priority, immediate);
    endpointState.nextDueAt = Math.min(endpointState.nextDueAt, dueAt);
    const record = state.pollTelemetry.get(id)?.[endpoint];
    if (record) record.nextDueAt = endpointState.nextDueAt;
  }
  if (immediate) schedule.priorityEventAt = now;
  return true;
}

function pairIncreased(current, previous) {
  return Array.isArray(current) && Array.isArray(previous)
    && current.length >= 2 && previous.length >= 2
    && current.some((value, index) => Number.isFinite(value) && Number.isFinite(previous[index]) && value > previous[index]);
}

function statsActivityIncreased(current, previous) {
  return ['shots', 'sot', 'xg', 'bigChances', 'corners'].some((key) => pairIncreased(current?.[key], previous?.[key]));
}

async function runPollOne(id, requestedEndpoints) {
  const matchRef = findMatch(id);
  if (!matchRef) return { ok: false, failed: true, changed: false, skipped: true };
  const pollStartedAt = Date.now();
  const revision = (state.pollRevision.get(id) || 0) + 1;
  state.pollRevision.set(id, revision);
  const endpoints = requestedEndpoints?.length ? requestedEndpoints : endpointNamesDue(id, pollStartedAt);
  if (!endpoints.length) return { ok: true, failed: false, changed: false, skipped: true };
  const previousEvent = state.events.get(id);
  const previousStats = state.stats.get(id)?.ALL;
  const previousIncidents = state.eventIncidents.get(id);
  const capture = (endpoint) => {
    const paths = {
      event: `event/${id}`,
      statistics: `event/${id}/statistics`,
      odds: `event/${id}/odds/1/all`,
      incidents: `event/${id}/incidents`,
    };
    return PollingQuality.captureRequest(api, paths[endpoint]).then((packet) => {
      let validationResult;
      if (endpoint === 'event' || endpoint === 'statistics') {
        validationResult = LiveAnalysisState.classifyApiResponse(packet, endpoint, id);
      } else if (endpoint === 'odds') {
        validationResult = LiveAnalysisState.classifyOddsResponse(packet);
      } else if (packet.kind === 'success') {
        validationResult = PollingQuality.classifyIncidentsResponse(packet.value, id);
      } else {
        validationResult = { kind: packet.kind };
      }
      return { ...packet, validationResult, validatedAt: Date.now() };
    });
  };
  const [eventResponse, statsResponse, oddsResponse, incidentsResponse] = await Promise.all([
    endpoints.includes('event') ? capture('event') : null,
    endpoints.includes('statistics') ? capture('statistics') : null,
    endpoints.includes('odds') ? capture('odds') : null,
    endpoints.includes('incidents') ? capture('incidents') : null,
    endpoints.includes('statistics') && needsPlayers(id) ? loadPlayers(id).catch(() => null) : null,
  ]);
  const eventPacket = eventResponse;
  const statsPacket = statsResponse;
  const oddsPacket = oddsResponse;
  const incidentsPacket = incidentsResponse;
  if (state.pollRevision.get(id) !== revision || findMatch(id) !== matchRef) {
    return { ok: false, failed: false, changed: false, skipped: true, stale: true };
  }

  const eventResult = eventResponse
    ? eventResponse.validationResult
    : { kind: 'skipped' };
  const statsResult = statsResponse
    ? statsResponse.validationResult
    : { kind: 'skipped' };
  const oddsShape = oddsResponse ? oddsResponse.validationResult : { kind: 'skipped' };
  const incidentsShape = incidentsResponse
    ? { ...incidentsResponse.validationResult, incidents: incidentsResponse.validationResult.incidents ?? null }
    : { kind: 'skipped', incidents: null };
  const stages = {
    event: { validatedAt: eventResponse?.validatedAt ?? null },
    statistics: { validatedAt: statsResponse?.validatedAt ?? null },
    odds: { validatedAt: oddsResponse?.validatedAt ?? null },
    incidents: { validatedAt: incidentsResponse?.validatedAt ?? null },
  };
  const previousIdentity = previousEvent && LiveAnalysisState.matchIdentity(previousEvent, id);
  const nextIdentity = eventResult.kind === 'complete'
    ? LiveAnalysisState.matchIdentity(eventResult.event, id) : previousIdentity;
  const previousScore = LiveAnalysisState.scorePair(previousEvent);
  const nextScore = eventResult.kind === 'complete' ? LiveAnalysisState.scorePair(eventResult.event) : previousScore;
  const scoreChanged = !!previousScore && !!nextScore
    && (previousScore[0] !== nextScore[0] || previousScore[1] !== nextScore[1]);
  const previousStatus = previousEvent?.status || {};
  const nextStatus = eventResult.event?.status || {};
  const statusChanged = eventResult.kind === 'complete' && previousEvent && (
    previousStatus.type !== nextStatus.type || previousStatus.code !== nextStatus.code
  );
  const descriptionChanged = eventResult.kind === 'complete' && previousEvent
    && previousStatus.description !== nextStatus.description;
  const eventReset = eventResult.kind === 'complete' && previousEvent && (
    previousIdentity !== nextIdentity || statusChanged || scoreChanged
  );
  if (eventResult.kind === 'complete') {
    if (eventReset) {
      forgetAnalysis(id);
      if (previousIdentity !== nextIdentity) {
        state.stats.delete(id);
        state.eventIncidents.delete(id);
      }
    }
    const retainedIncidents = state.eventIncidents.get(id) || [];
    state.events.set(id, { ...eventResult.event, incidents: retainedIncidents });
    state.lastPoll.set(id, eventPacket.receivedAt);
    stages.event.committedAt = Date.now();
  }

  let parsedStats = null;
  if (statsResult.kind === 'complete') {
    parsedStats = parseStats(statsResult.value);
    state.stats.set(id, parsedStats);
    stages.statistics.committedAt = Date.now();
  }
  if (incidentsShape.kind === 'complete') {
    state.eventIncidents.set(id, incidentsShape.incidents);
    const current = state.events.get(id);
    if (current) state.events.set(id, { ...current, incidents: incidentsShape.incidents });
    stages.incidents.committedAt = Date.now();
  }
  const currentEvent = state.events.get(id);
  const liveOddsPhase = isLive(currentEvent) && [6, 7, 41, 42].includes(currentEvent.status?.code);
  if (eventReset) state.liveOdds.delete(id);
  let oddsResult = oddsShape;
  const latestEventMeta = state.pollTelemetry.get(id)?.event;
  const priorEventStatus = state.apiStatus.get(id)?.event;
  const eventFreshForOdds = eventPacket
    ? eventResult.kind === 'complete'
    : (priorEventStatus === 'complete' && Number.isFinite(latestEventMeta?.receivedAt)
      && Date.now() - latestEventMeta.receivedAt <= POLL_INTERVALS.event.base * 2 + 2_000);
  if (oddsPacket && (eventReset || !liveOddsPhase || !eventFreshForOdds)) oddsResult = { kind: 'skipped' };
  if (oddsPacket && !eventReset && eventFreshForOdds && oddsShape.kind === 'complete' && liveOddsPhase) {
    const recorded = recordLiveOddsSnapshot(id, oddsPacket.value, currentEvent, oddsPacket.receivedAt);
    if (!recorded) oddsResult = { kind: 'empty' };
    else stages.odds.committedAt = Date.now();
  }
  if (!liveOddsPhase) state.liveOdds.delete(id);

  const previousApiStatus = state.apiStatus.get(id) || {};
  const apiStatus = {
    ...previousApiStatus,
    event: eventPacket ? eventResult.kind : (previousApiStatus.event || 'skipped'),
    statistics: statsPacket ? statsResult.kind : (previousApiStatus.statistics || 'skipped'),
    odds: oddsPacket ? oddsResult.kind : (previousApiStatus.odds || 'skipped'),
    incidents: incidentsPacket ? incidentsShape.kind : (previousApiStatus.incidents || 'skipped'),
    at: Date.now(),
  };
  state.apiStatus.set(id, apiStatus);

  const now = Date.now();
  if (eventPacket) scheduleEndpoint(id, 'event', eventPacket, eventResult.kind, now, stages.event);
  if (statsPacket) scheduleEndpoint(id, 'statistics', statsPacket, statsResult.kind, now, stages.statistics);
  if (oddsPacket) scheduleEndpoint(id, 'odds', oddsPacket, oddsResult.kind, now, stages.odds);
  if (incidentsPacket) scheduleEndpoint(id, 'incidents', incidentsPacket, incidentsShape.kind, now, stages.incidents);
  const cardIncreased = parsedStats && pairIncreased(parsedStats.ALL?.redCards, previousStats?.redCards);
  const eventText = `${previousStatus.description || ''} ${nextStatus.description || ''}`;
  const criticalStatusText = /\b(var|penalt\w*|suspend\w*|interrupt\w*|stoppage)\b/i.test(eventText);
  const identityChanged = !!previousIdentity && previousIdentity !== nextIdentity;
  const newlyCriticalIncidents = PollingQuality.newCriticalIncidentKeys(
    identityChanged ? [] : previousIncidents,
    incidentsShape.kind === 'complete' ? incidentsShape.incidents : previousIncidents,
  );
  const priorityEvent = !!eventReset || !!cardIncreased || (!!descriptionChanged && criticalStatusText)
    || newlyCriticalIncidents.length > 0;
  const immediatePriority = !!scoreChanged || !!statusChanged || !!cardIncreased
    || newlyCriticalIncidents.length > 0 || (!!descriptionChanged && criticalStatusText);
  const priorityKey = priorityEvent
    ? `${nextIdentity || id}|${(nextScore || []).join(':')}|${nextStatus.type || ''}:${nextStatus.code || ''}|${newlyCriticalIncidents.join(',') || (cardIncreased ? `card:${(parsedStats?.ALL?.redCards || []).join(':')}` : '')}`
    : null;
  const hotData = !!(parsedStats && statsActivityIncreased(parsedStats.ALL, previousStats));
  const matchSchedule = matchPollState(id);
  if (hotData) matchSchedule.hotUntil = Math.max(matchSchedule.hotUntil, now + 30_000);
  if (priorityEvent) prioritizeMatch(id, now, { immediate: immediatePriority, eventKey: priorityKey });

  const eventMeta = state.pollTelemetry.get(id)?.event;
  const eventDataUsable = apiStatus.event === 'complete' && Number.isFinite(eventMeta?.receivedAt)
    && !eventMeta.frozen;
  const sameCycleComplete = eventResult.kind === 'complete' && statsResult.kind === 'complete';
  const analysisStartedAt = Date.now();
  const statisticsMeta = state.pollTelemetry.get(id)?.statistics;
  recordAnalysisSnapshot(id, statsResult.kind === 'complete' && eventDataUsable && !statisticsMeta?.frozen);
  const analysisLatencyMs = Date.now() - analysisStartedAt;
  const analysisAt = Date.now();
  const telemetry = state.pollTelemetry.get(id) || {};
  for (const endpoint of ['event', 'statistics', 'odds', 'incidents']) {
    const record = telemetry[endpoint];
    if (record && Number.isFinite(record.receivedAt)) {
      record.analysisAt = analysisAt;
      record.receiveToAnalysisMs = Math.max(0, analysisAt - record.receivedAt);
    }
  }
  telemetry.analysisLatencyMs = analysisLatencyMs;
  telemetry.sameCycleComplete = sameCycleComplete;
  telemetry.pollStartedAt = pollStartedAt;
  telemetry.polledAt = Date.now();
  telemetry.pollLatencyMs = telemetry.polledAt - pollStartedAt;
  state.pollTelemetry.set(id, telemetry);

  if (eventResult.kind === 'complete' || statsResult.kind === 'complete') {
    updateTile(id);
    const alertCheckStartedAt = Date.now();
    checkAlerts(id);
    const alertInputAt = Math.max(eventPacket?.receivedAt || 0, statsPacket?.receivedAt || 0);
    const alertTelemetry = state.pollTelemetry.get(id) || {};
    alertTelemetry.alertCheckedAt = alertCheckStartedAt;
    alertTelemetry.alertCheckLatencyMs = alertInputAt ? Math.max(0, alertCheckStartedAt - alertInputAt) : null;
    state.pollTelemetry.set(id, alertTelemetry);
  }
  updateFeedHealth();
  const failed = [eventPacket, statsPacket, oddsPacket, incidentsPacket].some((packet) => packet?.kind === 'failed')
    || [eventResult, statsResult, oddsResult, incidentsShape].some((result) => ['failed', 'not-found', 'invalid', 'partial', 'mismatch'].includes(result.kind));
  return {
    ok: apiStatus.event === 'complete', failed,
    changed: !!(eventResult.kind === 'complete' && state.pollTelemetry.get(id)?.event?.changed)
      || !!(statsResult.kind === 'complete' && state.pollTelemetry.get(id)?.statistics?.changed)
      || !!(oddsResult.kind === 'complete' && state.pollTelemetry.get(id)?.odds?.changed)
      || !!(incidentsShape.kind === 'complete' && state.pollTelemetry.get(id)?.incidents?.changed),
    priorityEvent,
  };
}

const pollQueue = new Map();
const activePollJobs = new Map();
const activePollWaiters = new Map();

function cancelPollWaiters(id, result) {
  const queued = pollQueue.get(id);
  if (queued) {
    pollQueue.delete(id);
    PollingQuality.resolveWaiters(queued.waiters, result);
  }
  const activeWaiters = activePollWaiters.get(id) || [];
  activePollWaiters.delete(id);
  PollingQuality.resolveWaiters(activeWaiters, result);
}

function enqueuePoll(id, options = {}) {
  return new Promise((resolve) => {
    if (!findMatch(id)) {
      resolve({ ok: false, failed: false, changed: false, skipped: true, removed: true });
      return;
    }
    const existing = pollQueue.get(id);
    if (existing) {
      existing.force ||= !!options.force;
      existing.waiters.push(resolve);
    } else {
      pollQueue.set(id, { force: !!options.force, waiters: [resolve], enqueuedAt: Date.now() });
    }
    pumpPollQueue();
  });
}

function pollOne(id, options = {}) {
  return enqueuePoll(id, options);
}

function pollPriority(id, now) {
  const schedule = state.pollState.get(id);
  if (!schedule || schedule.priorityUntil <= now) return 0;
  return POLL_ENDPOINTS.some((endpoint) => schedule.endpoints[endpoint].priorityRounds > 0) ? 1 : 0;
}

function dueOrdering(id, now) {
  const schedule = matchPollState(id);
  const due = endpointNamesDue(id, now);
  if (!due.length) return null;
  const deadlines = due.map((endpoint) => schedule.endpoints[endpoint].nextDueAt || 0);
  const earliest = Math.min(...deadlines);
  const priority = pollPriority(id, now);
  return {
    id, endpoints: due, priority, earliest,
    effectivePriority: PollingQuality.effectivePollPriority(priority, earliest > 0 ? now - earliest : 0),
  };
}

function collectPollCandidates(now = Date.now()) {
  const candidates = [];
  for (const match of state.matches) {
    const id = match.id;
    if (activePollJobs.has(id)) continue;
    const queued = pollQueue.get(id);
    if (queued?.force) {
      const event = state.events.get(id);
      const endpoints = ['event', ...(isLive(event) ? ['statistics', 'incidents'] : []),
        ...(isLive(event) && [6, 7, 41, 42].includes(event.status?.code) ? ['odds'] : [])];
      const waitedMs = Math.max(0, now - queued.enqueuedAt);
      candidates.push({ id, endpoints, priority: 2, effectivePriority: PollingQuality.effectivePollPriority(2, waitedMs), earliest: queued.enqueuedAt, queued });
      continue;
    }
    const scheduled = dueOrdering(id, now);
    if (scheduled) candidates.push({ ...scheduled, queued });
  }
  return candidates.sort(PollingQuality.comparePollCandidates);
}

function settlePollRender(id, result) {
  if (!findMatch(id)) return;
  if (!result?.skipped) {
    const renderStartedAt = performance.now();
    updateCard(id);
    renderAnalysisMatches([id]);
    const renderedAt = Date.now();
    const telemetry = state.pollTelemetry.get(id) || {};
    const latestInputAt = Math.max(telemetry.event?.receivedAt || 0, telemetry.statistics?.receivedAt || 0, telemetry.odds?.receivedAt || 0, telemetry.incidents?.receivedAt || 0);
    telemetry.visibleAt = renderedAt;
    telemetry.receiveToUiMs = latestInputAt ? Math.max(0, renderedAt - latestInputAt) : null;
    for (const endpoint of ['event', 'statistics', 'odds', 'incidents']) {
      const record = telemetry[endpoint];
      if (record && Number.isFinite(record.receivedAt)) {
        record.visibleAt = renderedAt;
        record.receiveToVisibleMs = Math.max(0, renderedAt - record.receivedAt);
      }
    }
    state.pollTelemetry.set(id, telemetry);
    state.pollRenderTelemetry = {
      latencyMs: performance.now() - renderStartedAt,
      renderedAt,
      matchCount: state.matches.length,
      matchId: id,
    };
    updateFeedHealth();
  }
  if (result?.failed) setStatus(`Maç #${id} için kaynak yanıtı başarısız veya eksik`);
  else if (!result?.skipped) setStatus(`Güncellendi ${new Date().toLocaleTimeString('tr-TR')}`);
}

function pumpPollQueue(now = Date.now()) {
  const candidates = collectPollCandidates(now);
  while (activePollJobs.size < POLL_CONCURRENCY && candidates.length) {
    const candidate = candidates.shift();
    if (activePollJobs.has(candidate.id) || !findMatch(candidate.id)) continue;
    const queued = pollQueue.get(candidate.id);
    if (queued) pollQueue.delete(candidate.id);
    const request = runPollOne(candidate.id, candidate.endpoints);
    let job;
    activePollWaiters.set(candidate.id, queued?.waiters || []);
    job = Promise.resolve(request).catch((error) => ({
      ok: false, failed: true, changed: false, error: String(error?.message || error),
    })).then((result) => {
      const waiters = activePollWaiters.get(candidate.id) || [];
      activePollWaiters.delete(candidate.id);
      PollingQuality.resolveWaiters(waiters, result);
      settlePollRender(candidate.id, result);
      return result;
    }).finally(() => {
      if (activePollJobs.get(candidate.id) === job) activePollJobs.delete(candidate.id);
      if (state.pollInFlight.get(candidate.id) === job) state.pollInFlight.delete(candidate.id);
      pumpPollQueue();
    });
    activePollJobs.set(candidate.id, job);
    state.pollInFlight.set(candidate.id, job);
  }
}
function ageText(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'bilinmiyor';
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} sn`;
  return `${Math.floor(seconds / 60)} dk`;
}

function feedEndpointState(endpoint, telemetry, now, active, expectedInterval = POLL_INTERVALS[endpoint].base) {
  if (!active) return 'idle';
  if (!telemetry) return 'warming';
  if (telemetry.requestKind === 'failed' || ['invalid', 'partial', 'mismatch'].includes(telemetry.kind)
    || (endpoint !== 'odds' && telemetry.requestKind === 'not-found')) return 'failed';
  if (!Number.isFinite(telemetry.receivedAt)) return 'warming';
  if (telemetry.frozen) return 'frozen';
  const receiveLimit = Math.max(expectedInterval * 2, 30_000);
  if (now - telemetry.receivedAt > receiveLimit) return 'stale';
  if (Number.isFinite(telemetry.sourceUpdatedAt) && now - telemetry.sourceUpdatedAt > receiveLimit) return 'stale';
  return 'fresh';
}

function updateFeedHealth(now = Date.now()) {
  const host = $('#feedHealth');
  if (!host) return;
  const newlyFrozen = [];
  for (const [id, records] of state.pollTelemetry) {
    for (const endpoint of POLL_ENDPOINTS) {
      const previous = records[endpoint];
      if (!previous) continue;
      const updated = PollingQuality.ageRecord(previous, now);
      if (!previous.frozen && updated.frozen) newlyFrozen.push(id);
      records[endpoint] = updated;
    }
    state.pollTelemetry.set(id, records);
  }
  if (newlyFrozen.length) renderAnalysisMatches([...new Set(newlyFrozen)]);
  const startedAt = performance.now();
  const priorPanel = $('.feed-health-panel', host);
  const wasOpen = priorPanel ? priorPanel.open : true;
  const details = document.createElement('details');
  details.className = 'feed-health-panel';
  details.open = wasOpen;
  const heading = el('summary', 'feed-health-heading');
  const list = el('div', 'feed-health-list');
  if (!state.matches.length) list.append(el('div', 'feed-health-empty', 'Takip edilen maç yok.'));
  let unhealthy = 0;
  for (const match of state.matches) {
    const id = match.id;
    const event = state.events.get(id);
    const telemetry = state.pollTelemetry.get(id) || {};
    const row = el('div', 'feed-health-match');
    const score = event ? `${teamName(event.homeTeam)} ${scoreText(event)} ${teamName(event.awayTeam)}` : `Maç #${id}`;
    row.append(el('b', 'feed-health-name', score));
    const endpoints = el('div', 'feed-health-sources');
    for (const endpoint of POLL_ENDPOINTS) {
      const active = endpoint === 'event' ? !isOver(event)
        : endpoint === 'statistics' || endpoint === 'incidents' ? isLive(event)
          : isLive(event) && [6, 7, 41, 42].includes(event.status?.code);
      const record = telemetry[endpoint];
      const longIdleEventPoll = endpoint === 'event' && event?.status?.type === 'notstarted'
        && Number.isFinite(event.startTimestamp) && event.startTimestamp * 1000 - now > 120_000;
      const expectedInterval = longIdleEventPoll ? IDLE_POLL_MS : POLL_INTERVALS[endpoint].base;
      const status = feedEndpointState(endpoint, record, now, active, expectedInterval);
      if (status === 'stale' || status === 'failed' || status === 'frozen') unhealthy++;
      const chip = el('span', 'feed-health-source');
      chip.dataset.state = status;
      if (!active) {
        chip.textContent = `${ENDPOINT_LABELS[endpoint]} · beklemiyor`;
        chip.title = 'Bu maç durumunda bu kaynak için sorgu planlanmıyor.';
      } else if (!record) {
        chip.textContent = `${ENDPOINT_LABELS[endpoint]} · bekleniyor`;
        chip.title = 'İlk kaynak yanıtı henüz alınmadı.';
      } else {
        const receivedAge = now - record.receivedAt;
        const changeAge = record.lastChangedAt == null ? null : now - record.lastChangedAt;
        const sourceAge = record.sourceUpdatedAt == null ? null : now - record.sourceUpdatedAt;
        const request = record.requestKind === 'failed'
          ? `${record.errorClass || 'hata'}${record.httpStatus ? ` ${record.httpStatus}` : ''}`
          : `${record.kind || 'yanıt'}`;
        const integrity = record.frozen ? ' · eski veri'
          : record.unchangedConcern ? ' · içerik sabit, yanıtlar sürüyor' : '';
        chip.textContent = `${ENDPOINT_LABELS[endpoint]} · ${request} · yanıt ${ageText(receivedAge)}${integrity}`;
        chip.title = [
          `Queue wait: ${Number.isFinite(record.queueWaitMs) ? `${record.queueWaitMs} ms` : 'unknown'}`,
          `Validation: ${Number.isFinite(record.validationLatencyMs) ? `${record.validationLatencyMs} ms` : 'pending'}`,
          `Commit: ${Number.isFinite(record.commitLatencyMs) ? `${record.commitLatencyMs} ms` : 'not committed'}`,
          `Analysis: ${Number.isFinite(record.receiveToAnalysisMs) ? `${record.receiveToAnalysisMs} ms` : 'pending'}`,
          `Visible: ${Number.isFinite(record.receiveToVisibleMs) ? `${record.receiveToVisibleMs} ms` : 'pending'}`,
          `İstek gecikmesi: ${Number.isFinite(record.latencyMs) ? `${record.latencyMs} ms` : 'bilinmiyor'}`,
          `Son içerik değişimi: ${ageText(changeAge)}`,
          `Sağlayıcı zaman damgası yaşı: ${sourceAge == null ? 'paylaşılmıyor' : ageText(sourceAge)}`,
          `Veri yaşı: ${ageText(record.dataAgeMs)} · donuk eşiği ${ageText(record.staleHorizonMs)}`,
          `Değişen alanlar: ${record.changedFields?.join(', ') || 'yok'}`,
          `Aynı içerik yanıtı: ${record.unchangedCount || 0}`,
          record.errorMessage || '',
        ].filter(Boolean).join(' · ');
      }
      endpoints.append(chip);
    }
    row.append(endpoints);
    const timings = el('small', 'feed-health-timing',
      `tur ${Number.isFinite(telemetry.pollLatencyMs) ? `${telemetry.pollLatencyMs} ms` : '—'} · analiz ${Number.isFinite(telemetry.analysisLatencyMs) ? `${telemetry.analysisLatencyMs} ms` : '—'} · yanıt→UI ${Number.isFinite(telemetry.receiveToUiMs) ? `${telemetry.receiveToUiMs} ms` : '—'} · uyarı denetimi ${Number.isFinite(telemetry.alertCheckLatencyMs) ? `${telemetry.alertCheckLatencyMs} ms` : '—'} · UI ${Number.isFinite(state.pollRenderTelemetry?.latencyMs) ? `${Math.round(state.pollRenderTelemetry.latencyMs)} ms` : '—'}`);
    row.append(timings);
    list.append(row);
  }
  const renderTelemetry = state.pollRenderTelemetry || {};
  heading.append(
    el('b', null, 'Canlı kaynak sağlığı'),
    el('span', null, `${state.matches.length} maç · ${unhealthy} eski/hatalı kaynak · analiz ${Math.round(Math.max(0, ...state.matches.map((m) => state.pollTelemetry.get(m.id)?.analysisLatencyMs || 0)))} ms · UI ${Number.isFinite(renderTelemetry.latencyMs) ? `${renderTelemetry.latencyMs} ms` : '—'}`),
  );
  details.append(heading, list);
  host.replaceChildren(details);
  const panelRenderMs = performance.now() - startedAt;
  state.pollRenderTelemetry = { ...renderTelemetry, feedPanelLatencyMs: panelRenderMs, feedPanelRenderedAt: now };
}

function pollAll() {
  pumpPollQueue();
}
function tickMinutes() {
  for (const id of animIds()) {
    const ev = state.events.get(id);
    const t = state.tiles.get(id);
    if (!ev || !t || !isLive(ev)) continue;
    $('.minute', t.el).textContent = minuteText(ev);
  }
}

/* ---------- Güncelleme bandı (isteğe bağlı) ---------- */

function initUpdates() {
  const box = $('#update');
  const text = $('#updateText');
  const btn = $('#updateBtn');
  let ready = false;
  window.appUpdate.version().then((v) => { $('#appVersion').textContent = `v${v}`; });
  window.appUpdate.onStatus((u) => {
    if (u.state === 'available') {
      ready = false;
      box.hidden = false;
      text.textContent = `Yeni sürüm v${u.version}`;
      btn.textContent = u.manual ? 'İndir' : 'Güncelle';
      btn.disabled = false;
    } else if (u.state === 'downloading') {
      box.hidden = false;
      text.textContent = `İndiriliyor %${u.percent}`;
      btn.disabled = true;
    } else if (u.state === 'ready') {
      ready = true;
      box.hidden = false;
      text.textContent = `v${u.version} hazır`;
      btn.textContent = 'Yeniden başlat ve kur';
      btn.disabled = false;
    } else if (u.state === 'error') {
      box.hidden = true;
      setStatus('Güncelleme indirilemedi, sonra tekrar denenecek');
    }
  });
  btn.addEventListener('click', () => {
    if (ready) window.appUpdate.install();
    else { btn.disabled = true; window.appUpdate.download(); }
  });
  $('#updateClose').addEventListener('click', () => { box.hidden = true; });
}

/* ---------- Tam ekran ---------- */

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function initFullscreen() {
  $('#fsBtn').addEventListener('click', toggleFullscreen);
  const hint = $('#fsHint');
  let hintTimer = null;
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    document.body.classList.toggle('fs', on);
    clearTimeout(hintTimer);
    hint.hidden = !on;
    if (on) hintTimer = setTimeout(() => { hint.hidden = true; }, 2500);
  });
  // F: tam ekran. Animasyonun içindeyken de çalışsın diye ana süreç de kısayolu iletiyor.
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey
      && !e.target.closest('input, select, textarea')) toggleFullscreen();
  });
  window.appShortcut.on((key) => {
    if (key === 'f') toggleFullscreen();
    if (key === 'Escape' && state.layout.focus) {
      state.layout.focus = null;
      saveLayout();
      applyLayout(true);
    }
  });
}

/* ---------- Başlangıç ---------- */

function init() {
  initPicker();
  initLayout();
  initUpdates();
  initCardSettings();
  initFullscreen();
  initAnalysisLines();
  $('#toggleSide').addEventListener('click', () => document.body.classList.toggle('side-hidden'));
  $('#periodSeg').addEventListener('click', (e) => {
    const p = e.target?.dataset?.period;
    if (!p) return;
    state.period = p;
    for (const b of $('#periodSeg').children) b.classList.toggle('on', b.dataset.period === p);
    renderShotList();
  });
  $('#shotsTab').addEventListener('click', () => setSideView('shots'));
  $('#analysisTab').addEventListener('click', () => setSideView('analysis'));
  setSideView(load('sideView', 'shots'));

  // Kayıtlı maçları geri yükle
  const saved = state.matches;
  state.matches = [];
  (async () => {
    for (const m of saved) await addMatch(m.id, null, m.anim);
    // Maç listesini kutular yüklendikten sonra hazırla
    setTimeout(() => loadCatalog(), 3000);
  })();

  refresh(false);
  updateFeedHealth();
  setInterval(pollAll, SCHEDULER_TICK_MS);
  setInterval(updateFeedHealth, 1000);
  setInterval(tickMinutes, 1000);
}

init();
