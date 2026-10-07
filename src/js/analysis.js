'use strict';

/* Açıklanabilir canlı aktivite motoru.
 * Sinyaller olasılık değildir; yalnızca başarılı istatistik kontrollerinden
 * hesaplanır ve maç/oran geçmişiyle kalibre edilmiş bir tahmin modeli değildir. */

const ANALYSIS_WINDOW_MS = 5 * 60_000;
const ANALYSIS_HISTORY_MS = ANALYSIS_WINDOW_MS + 20_000;
const ANALYSIS_MIN_WINDOW_MS = 3 * 60_000;
const ANALYSIS_STALE_MS = 35_000;
const ANALYSIS_CONFIRMATIONS = 2;
const LIVE_ODDS_POLL_MS = 30_000;
const ANALYSIS_TYPES = AnalysisEngine.ANALYSIS_TYPES;
const savedMatchLine = Number(load('analysisMatchTotal', 2.5));
const savedHalfLine = Number(load('analysisFirstHalfTotal', 1.5));
const ANALYSIS_LINES = {
  matchTotal: [0.5, 1.5, 2.5, 3.5, 4.5].includes(savedMatchLine) ? savedMatchLine : 2.5,
  firstHalfTotal: [0.5, 1.5, 2.5].includes(savedHalfLine) ? savedHalfLine : 1.5,
};
const analysisHistory = new Map();
const analysisConfirmations = new Map();

function analysisPhase(ev) {
  const code = ev?.status?.code;
  return ({ 6: '1Y', 31: 'İY', 7: '2Y', 41: 'UZ1', 42: 'UZ2', 50: 'PEN' })[code]
    || `P${code ?? 'BİLİNMİYOR'}`;
}

function analysisMinute(ev) {
  const match = minuteText(ev).match(/^(\d+)(?:\+(\d+))?/);
  return match ? Number(match[1]) + Number(match[2] || 0) : 0;
}

function validPair(pair) {
  return Array.isArray(pair) && pair.length >= 2 && pair.every(Number.isFinite)
    ? [pair[0], pair[1]] : null;
}

function pairDelta(current, previous) {
  const now = validPair(current);
  const before = validPair(previous);
  if (!now || !before) return null;
  const delta = [now[0] - before[0], now[1] - before[1]];
  return delta.some((value) => value < 0) ? null : delta;
}

function analysisSnapshot(id, now) {
  const ev = state.events.get(id);
  const history = analysisHistory.get(id) || [];
  if (!isLive(ev)) return { status: 'inactive', ev };
  if (ev.status?.code === 31) return { status: 'halftime', ev };
  const currentStats = state.stats.get(id);
  if (!currentStats || currentStats.none || !currentStats.ALL) return { status: 'nodata', ev };
  if (!history.length) return { status: 'warming', ev, elapsedMs: 0 };

  const latest = history[history.length - 1];
  const dataAgeMs = Math.max(0, now - latest.at);
  if (dataAgeMs > ANALYSIS_STALE_MS) return { status: 'stale', ev, latest, dataAgeMs };

  const cutoff = latest.at - ANALYSIS_WINDOW_MS;
  const baseline = history.find((sample) => sample.at >= cutoff) || history[0];
  const elapsedMs = latest.at - baseline.at;
  if (elapsedMs < ANALYSIS_MIN_WINDOW_MS) {
    return { status: 'warming', ev, latest, elapsedMs, dataAgeMs };
  }

  const changes = {};
  for (const key of ['shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed']) {
    changes[key] = pairDelta(latest.stats[key], baseline.stats[key]);
  }
  const hasShots = !!changes.shots;
  const hasSot = !!changes.sot;
  const hasCorners = !!changes.corners;
  if (!hasShots && !hasSot && !hasCorners && !changes.bigChances) {
    return { status: 'nodata', ev, latest, elapsedMs, dataAgeMs };
  }

  const sum = (pair) => pair ? pair[0] + pair[1] : null;
  const totalShots = sum(changes.shots);
  const totalSot = sum(changes.sot);
  const totalCorners = sum(changes.corners);
  const totalXg = sum(changes.xg);
  const totalBigChances = sum(changes.bigChances);
  const homeScore = ev.homeScore?.current;
  const awayScore = ev.awayScore?.current;
  const score = [Number.isFinite(homeScore) ? homeScore : null, Number.isFinite(awayScore) ? awayScore : null];
  return {
    status: 'ready', ev, latest, changes, elapsedMs, dataAgeMs, analysisNowMs: now,
    minute: analysisMinute(ev), phase: analysisPhase(ev), score,
    names: [teamName(ev.homeTeam), teamName(ev.awayTeam)],
    totalShots, totalSot, totalCorners, totalXg, totalBigChances,
    cumulativeXg: validPair(latest.stats.xg),
    possession: validPair(latest.stats.possession),
    redCards: validPair(latest.stats.redCards),
    liveOdds: state.liveOdds.get(id) || null,
  };
}
const makeAnalysisCandidates = (data) => AnalysisEngine.makeAnalysisCandidates(data, ANALYSIS_LINES);

function advanceAnalysisConfirmations(id, candidates) {
  const previous = analysisConfirmations.get(id) || {};
  const activeKeys = new Set(candidates.map((candidate) => candidate.key));
  const next = {};
  for (const key of ANALYSIS_TYPES) {
    next[key] = activeKeys.has(key) ? Math.min(ANALYSIS_CONFIRMATIONS, (previous[key] || 0) + 1) : 0;
  }
  analysisConfirmations.set(id, next);
}

function recordAnalysisSnapshot(id, statsFresh) {
  if (!statsFresh) return;
  const ev = state.events.get(id);
  const all = state.stats.get(id)?.ALL;
  if (!isLive(ev) || ev.status?.code === 31 || !all || state.stats.get(id)?.none) {
    if (ev?.status?.code === 31) {
      analysisHistory.set(id, []);
      analysisConfirmations.delete(id);
    }
    return;
  }

  const now = Date.now();
  const phase = analysisPhase(ev);
  const stats = {};
  for (const key of ['shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed', 'redCards', 'possession']) {
    const pair = all[key];
    stats[key] = Array.isArray(pair) ? [...pair] : null;
  }
  const hasData = ['shots', 'sot', 'corners', 'xg', 'bigChances']
    .some((key) => validPair(stats[key]));
  if (!hasData) return;

  let history = analysisHistory.get(id) || [];
  const previous = history[history.length - 1];
  if (previous && previous.phase !== phase) {
    history = [];
    analysisConfirmations.delete(id);
  }
  if (previous && previous.at >= now) return;

  // Sağlayıcı bir sayacı geriye alırsa bu ölçümü kullanma; yeni bir pencere başlat.
  if (previous) {
    const reset = ['shots', 'sot', 'corners', 'xg', 'bigChances', 'bigChancesMissed', 'redCards'].some((key) => {
      const current = validPair(stats[key]);
      const old = validPair(previous.stats[key]);
      return current && old && (current[0] < old[0] || current[1] < old[1]);
    });
    if (reset) {
      history = [];
      analysisConfirmations.delete(id);
    }
  }

  history.push({
    at: now, phase, minute: analysisMinute(ev),
    score: [
      Number.isFinite(ev.homeScore?.current) ? ev.homeScore.current : null,
      Number.isFinite(ev.awayScore?.current) ? ev.awayScore.current : null,
    ], stats,
  });
  while (history.length && history[0].at < now - ANALYSIS_HISTORY_MS) history.shift();
  if (history.length > 45) history.splice(0, history.length - 45);
  analysisHistory.set(id, history);

  const candidates = makeAnalysisCandidates(analysisSnapshot(id, now));
  advanceAnalysisConfirmations(id, candidates);
}

function shouldPollLiveOdds(id, ev = state.events.get(id), now = Date.now()) {
  if (!isLive(ev) || ![6, 7].includes(ev.status?.code)) return false;
  if (now - (state.lastOddsPoll.get(id) || 0) < LIVE_ODDS_POLL_MS) return false;
  state.lastOddsPoll.set(id, now);
  return true;
}

function recordLiveOddsSnapshot(id, payload, now = Date.now()) {
  const snapshot = OddsEngine.parseSnapshot(payload, { eventLive: true, observedAt: now });
  if (!snapshot) return false;
  state.liveOdds.set(id, OddsEngine.withMovement(snapshot, state.liveOdds.get(id)));
  return true;
}

function forgetAnalysis(id) {
  analysisHistory.delete(id);
  analysisConfirmations.delete(id);
  state.liveOdds.delete(id);
  state.lastOddsPoll.delete(id);
}

function activityBand(stats, side, elapsedMs) {
  const covered = ['shots', 'sot', 'xg', 'bigChances'].some((key) => Number.isFinite(stats?.[key]?.[side]));
  if (!covered) return { key: 'na', label: 'Veri yok', width: 0 };
  const shots = stats?.shots?.[side] || 0;
  const sot = stats?.sot?.[side] || 0;
  const xg = stats?.xg?.[side] || 0;
  const bigChances = stats?.bigChances?.[side] || 0;
  const fiveMinuteScale = 300_000 / Math.max(ANALYSIS_MIN_WINDOW_MS, elapsedMs || 0);
  const activity = (shots * 7 + sot * 10 + xg * 14 + bigChances * 18) * fiveMinuteScale;
  if (activity >= 48) return { key: 'high', label: 'Yüksek', width: 100 };
  if (activity >= 22) return { key: 'medium', label: 'Orta', width: 63 };
  return { key: 'low', label: 'Düşük', width: 28 };
}

function analysisResult(id, now = Date.now()) {
  const ev = state.events.get(id);
  if (!ev) return { status: 'loading' };
  if (ev.status?.type === 'notstarted') return { status: 'upcoming', ev };
  if (isOver(ev)) return { status: 'finished', ev };
  if (ev.status?.code === 31) return { status: 'halftime', ev };
  const data = analysisSnapshot(id, now);
  if (data.status !== 'ready') return { ...data, ev };

  const confirmations = analysisConfirmations.get(id) || {};
  const signals = makeAnalysisCandidates(data)
    .filter((candidate) => confirmations[candidate.key] >= ANALYSIS_CONFIRMATIONS);
  const projection = AnalysisEngine.remainingXgScenarios(data, data.phase === '1Y' ? 49 : 94);
  return {
    ...data,
    signals,
    oddsSummary: OddsEngine.summary(data.liveOdds, now),
    projectionBand: AnalysisEngine.scenarioBand(projection),
    teamBands: [
      activityBand(data.changes, 0, data.elapsedMs),
      activityBand(data.changes, 1, data.elapsedMs),
    ],
  };
}

function analysisDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes} dk ${String(seconds).padStart(2, '0')} sn` : `${seconds} sn`;
}

function pairLabel(pair, digits = 0) {
  const values = validPair(pair);
  return values ? values.map((value) => digits ? value.toFixed(digits) : value).join(' – ') : 'Veri yok';
}

function marketContext(data) {
  const score = validPair(data.score);
  const scoreTextValue = score ? `${score[0]}–${score[1]}` : 'veri yok';
  return `Skor ${scoreTextValue} · ${data.phase} · ${minuteText(data.ev)}`;
}

function analysisContextDetails(data) {
  const details = [];
  if (validPair(data.possession)) {
    details.push(`Topa sahip olma ${data.possession[0]}%–${data.possession[1]}%`);
  }
  if (validPair(data.redCards) && data.redCards.some((count) => count > 0)) {
    details.push(`Kırmızı kart ${data.redCards[0]}–${data.redCards[1]}`);
  }
  if (validPair(data.changes?.bigChances) && data.totalBigChances > 0) {
    details.push(`Büyük şans ${data.changes.bigChances[0]}–${data.changes.bigChances[1]} · pencere`);
  }
  return details;
}

function analysisOddsReference(data) {
  const markets = data.liveOdds?.markets;
  if (!markets) return '';
  const parts = [];
  const addPair = (label, quote, names) => {
    if (!quote) return;
    const values = names.map((name) => quote.prices?.[name]);
    if (values.some((value) => !Number.isFinite(value))) return;
    parts.push(`${label} ${values.map((value) => value.toFixed(2)).join(' / ')}`);
  };
  const line = Number(ANALYSIS_LINES.matchTotal).toFixed(1);
  addPair(`Maç ${line} Ü/A`, markets.matchTotals?.[line], ['over', 'under']);
  if (data.phase === '1Y') {
    const halfLine = Number(ANALYSIS_LINES.firstHalfTotal).toFixed(1);
    addPair(`İY ${halfLine} Ü/A`, markets.firstHalfTotals?.[halfLine], ['over', 'under']);
  }
  addPair('KG E/H', markets.matchBtts, ['yes', 'no']);
  if (markets.nextGoal) {
    const next = ['home', 'none', 'away'].filter((side) => Number.isFinite(markets.nextGoal.prices?.[side]));
    const labels = { home: 'Ev', none: 'Gol yok', away: 'Dep' };
    if (next.length >= 2) parts.push(`Sıradaki gol ${next.map((side) => `${labels[side]} ${markets.nextGoal.prices[side].toFixed(2)}`).join(' / ')}`);
  }
  return parts.join(' · ');
}

function analysisScoreText(ev) {
  if (ev?.status?.type === 'notstarted') return '–';
  const score = [ev?.homeScore?.current, ev?.awayScore?.current];
  return validPair(score) ? `${score[0]} - ${score[1]}` : 'Skor –';
}

function makeSignalRow(signal) {
  const row = el('article', `analysis-signal ${signal.level} ${signal.group || 'activity'}`);
  const top = el('div', 'signal-top');
  top.append(
    el('span', 'signal-icon', signal.icon),
    el('b', 'signal-title', signal.title),
    el('span', `signal-level ${signal.level}`, signal.levelLabel || (signal.level === 'high' ? 'Yüksek aktivite' : 'Orta aktivite')),
  );
  row.append(top, el('div', 'signal-market', signal.market), el('div', 'signal-reason', signal.reason));
  if (signal.oddsEvidence) {
    const evidence = signal.oddsEvidence;
    const movement = Number.isFinite(evidence.movement) && Math.abs(evidence.movement) >= 0.005
      ? ` · piyasa ${evidence.movement > 0 ? '+' : ''}${(evidence.movement * 100).toFixed(1)} puan` : '';
    row.append(el('div', 'signal-odds-evidence',
      `Oran teyidi ${Number(evidence.price).toFixed(2)} · marj arındırılmış yön %${(evidence.fairProbability * 100).toFixed(0)}${movement}`));
  }
  return row;
}

function makeMetric(label, pair, digits = 0) {
  const row = el('div', 'analysis-metric');
  row.append(el('span', null, label), el('b', null, pairLabel(pair, digits)));
  return row;
}

function makeSignalSection(title, signals, kind) {
  if (!signals.length) return null;
  const section = el('section', `analysis-signal-section ${kind}`);
  const heading = el('div', 'analysis-section-head');
  heading.append(
    el('b', null, title),
    el('span', null, String(signals.length)),
  );
  const list = el('div', 'analysis-signals');
  signals.forEach((signal) => list.append(makeSignalRow(signal)));
  section.append(heading, list);
  return section;
}

function buildAnalysisCard(id, result = analysisResult(id)) {
  const card = el('article', 'analysis-card');
  const ev = result.ev;
  const header = el('div', 'analysis-card-head');
  const teams = el('div', 'analysis-match');
  if (ev) {
    teams.append(
      el('b', 'analysis-title', `${teamName(ev.homeTeam)} ${analysisScoreText(ev)} ${teamName(ev.awayTeam)}`),
      el('span', 'analysis-competition', ev.tournament?.name || ev.uniqueTournament?.name || 'Canlı maç'),
    );
    header.append(teams, el('span', 'analysis-minute', minuteText(ev)));
  } else {
    teams.append(el('b', 'analysis-title', `Maç #${id}`), el('span', 'analysis-competition', 'Maç verisi yükleniyor'));
    header.append(teams, el('span', 'analysis-minute', '…'));
  }
  card.append(header);

  const states = {
    upcoming: ['Sıradaki maç', 'Canlı analiz maç başladıktan sonra açılır.'],
    finished: ['Maç tamamlandı', 'Canlı sinyaller durduruldu.'],
    halftime: ['Devre arası', 'Yeni ölçüm penceresi ikinci yarı başlayınca açılacak.'],
    inactive: ['Canlı değil', 'Bu karşılaşma şu anda canlı durumda değil.'],
    loading: ['Veri bekleniyor', 'Maç verisi yükleniyor.'],
    nodata: ['İstatistik yok', 'Bu maç için analize uygun şut, isabetli şut veya korner verisi gelmedi.'],
    stale: ['Veri gecikiyor', `Son başarılı kontrol ${analysisDuration(result.dataAgeMs)} önceydi; yeni veri gelene kadar sinyal gizlendi.`],
    warming: ['Ölçüm hazırlanıyor', `Güvenilir pencere için en az 3 dk veri gerekiyor. Şu an ${analysisDuration(result.elapsedMs)} ölçüldü.`],
  };
  if (result.status !== 'ready') {
    const [label, message] = states[result.status] || ['Analiz beklemede', 'Yeni ölçüm bekleniyor.'];
    const stateRow = el('div', `analysis-state ${result.status}`);
    stateRow.append(el('b', null, label), el('span', null, message));
    if (result.dataAgeMs != null) stateRow.append(el('small', null, `Son başarılı kontrol: ${analysisDuration(result.dataAgeMs)} önce`));
    card.append(stateRow);
    return card;
  }

  const topMeta = el('div', 'analysis-meta');
  topMeta.append(
    el('span', 'analysis-live-pill', '● CANLI'),
    el('span', 'analysis-window', `${analysisDuration(result.elapsedMs)} ölçüm`),
    el('span', 'analysis-freshness', `Kontrol ${analysisDuration(result.dataAgeMs)} önce`),
  );
  if (result.oddsSummary) {
    topMeta.append(el('span', `analysis-odds-status ${result.oddsSummary.key}`, result.oddsSummary.label));
  }
  if (result.projectionBand) {
    topMeta.append(el('span', `analysis-projection-range ${result.projectionBand.key}`, `Tempo aralığı ${result.projectionBand.label.toLowerCase()}`));
  }
  card.append(topMeta);
  const oddsReference = analysisOddsReference(result);
  if (oddsReference) card.append(el('div', 'analysis-odds-reference', oddsReference));

  const teamGrid = el('div', 'analysis-team-grid');
  for (const side of [0, 1]) {
    const band = result.teamBands[side];
    const team = el('div', `analysis-team ${side === 0 ? 'home' : 'away'} ${band.key}`);
    const line = el('div', 'analysis-team-label');
    line.append(el('span', null, teamName(side === 0 ? ev.homeTeam : ev.awayTeam)), el('b', null, `${band.label} tempo`));
    const track = el('div', 'analysis-team-track');
    const fill = el('i');
    fill.style.width = `${band.width}%`;
    track.append(fill);
    team.append(line, track);
    teamGrid.append(team);
  }
  card.append(teamGrid);

  const metrics = el('div', `analysis-metrics${result.changes.xg ? ' has-xg' : ''}`);
  metrics.append(
    makeMetric('Şut', result.changes.shots),
    makeMetric('İsabetli şut', result.changes.sot),
    makeMetric('Korner', result.changes.corners),
  );
  if (result.changes.xg) metrics.append(makeMetric('xG artışı', result.changes.xg, 2));
  card.append(metrics);

  const scoreContext = el('div', 'analysis-context', marketContext(result));
  card.append(scoreContext);
  const contextDetails = analysisContextDetails(result);
  if (contextDetails.length) card.append(el('div', 'analysis-context-details', contextDetails.join(' · ')));
  const marketSignals = result.signals.filter((signal) => signal.group === 'market');
  const activitySignals = result.signals.filter((signal) => signal.group !== 'market');
  if (!result.signals.length) {
    card.append(el('div', 'analysis-no-signal', 'Bu ölçümde eşik aşan, iki kontrolde doğrulanmış sinyal yok.'));
  } else {
    const marketSection = makeSignalSection('Bahis market yönleri', marketSignals, 'market');
    const activitySection = makeSignalSection('Maç içi aktivite', activitySignals, 'activity');
    if (marketSection) card.append(marketSection);
    if (activitySection) card.append(activitySection);
  }
  return card;
}

function renderAnalysisList() {
  const list = $('#analysisList');
  if (!list) return;
  const scrollTop = list.scrollTop;
  const results = state.matches.map((match) => analysisResult(match.id));
  const activeCount = results.reduce((sum, result) => sum + (result.signals?.length || 0), 0);
  const activeMatches = results.filter((result) => result.signals?.length).length;
  const marketCount = results.reduce((sum, result) => sum + (result.signals?.filter((signal) => signal.group === 'market').length || 0), 0);
  const activityCount = results.reduce((sum, result) => sum + (result.signals?.filter((signal) => signal.group !== 'market').length || 0), 0);
  const summary = $('#analysisSummary');
  if (summary) {
    summary.replaceChildren(
      el('b', null, activeCount ? `${activeCount} aktif sinyal` : 'Aktif sinyal yok'),
      el('span', null, `${activeMatches} maçta · ${marketCount} market yönü · ${activityCount} aktivite`),
    );
    summary.classList.toggle('has-active', activeCount > 0);
  }
  const tab = $('#analysisTab');
  if (tab) {
    tab.classList.toggle('has-signals', activeCount > 0);
    tab.title = activeCount ? `${activeCount} doğrulanmış canlı sinyal` : 'Canlı analiz';
    tab.setAttribute('aria-label', activeCount ? `Canlı analiz, ${activeCount} aktif sinyal` : 'Canlı analiz');
  }
  const cards = state.matches.map((match, index) => buildAnalysisCard(match.id, results[index]));
  if (!cards.length) cards.push(el('div', 'analysis-empty', 'Analiz için önce canlı bir maç ekle.'));
  list.replaceChildren(...cards);
  list.scrollTop = scrollTop;
}

function setSideView(view) {
  const analysis = view === 'analysis';
  $('#shotsView').hidden = analysis;
  $('#analysisView').hidden = !analysis;
  $('#periodSeg').hidden = analysis;
  $('#cardCfgBtn').hidden = analysis;
  $('#shotsTab').classList.toggle('on', !analysis);
  $('#analysisTab').classList.toggle('on', analysis);
  $('#shotsTab').setAttribute('aria-selected', String(!analysis));
  $('#analysisTab').setAttribute('aria-selected', String(analysis));
  $('#sideFootText').textContent = analysis
    ? 'Başarılı istatistik kontrolü · yaklaşık 10 sn' : 'Her 10 sn’de güncellenir';
  save('sideView', analysis ? 'analysis' : 'shots');
}

function initAnalysisLines() {
  const matchLine = $('#analysisMatchLine');
  const halfLine = $('#analysisHalfLine');
  matchLine.value = String(ANALYSIS_LINES.matchTotal);
  halfLine.value = String(ANALYSIS_LINES.firstHalfTotal);
  matchLine.addEventListener('change', () => {
    ANALYSIS_LINES.matchTotal = Number(matchLine.value);
    save('analysisMatchTotal', ANALYSIS_LINES.matchTotal);
    renderAnalysisList();
  });
  halfLine.addEventListener('change', () => {
    ANALYSIS_LINES.firstHalfTotal = Number(halfLine.value);
    save('analysisFirstHalfTotal', ANALYSIS_LINES.firstHalfTotal);
    renderAnalysisList();
  });
}
