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
  pollOne(id).then(() => { renderShotList(); renderAnalysisList(); });
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
  state.pollRevision.set(id, (state.pollRevision.get(id) || 0) + 1);
  state.matches = state.matches.filter((m) => m.id !== id);
  saveMatches();
  destroyTile(id);
  removeTargetsOf(id);
  forgetAlerts(id);
  state.events.delete(id);
  state.stats.delete(id);
  state.apiStatus.delete(id);
  state.lastPoll.delete(id);
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
  state.lastPoll.delete(id);
  players.delete(id);
  forgetAnalysis(id);
  forgetAlerts(id); // yeni veriyle sahte şut uyarısı çıkmasın
  for (const k of [...state.lastShown.keys()]) if (k.startsWith(`${id}|`)) state.lastShown.delete(k);
  const tile = state.tiles.get(id);
  if (tile) {
    if (tile.webview) { tile.webview.remove(); tile.webview = null; }
    tile.mode = null; // updateTile animasyonu baştan kurar
  }
  const ok = await pollOne(id);
  renderShotList();
  renderAnalysisList();
  buttons.forEach((b) => b.classList.remove('spinning'));
  const ev = state.events.get(id);
  setStatus(ok ? `${teamName(ev?.homeTeam)} – ${teamName(ev?.awayTeam)} yenilendi` : 'Yenilenemedi, bağlantıyı kontrol et');
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
}

/* ---------- Canlı güncelleme ---------- */

// Gereksiz istek atmamak için: biten maç bir kez, başlamamış maç dakikada bir sorgulanır
function needsPoll(id) {
  const ev = state.events.get(id);
  const last = state.lastPoll.get(id) || 0;
  if (!last) return true;
  if (isOver(ev)) return false;
  if (ev?.status?.type === 'notstarted' && ev.startTimestamp * 1000 - Date.now() > 2 * 60_000) {
    return Date.now() - last >= IDLE_POLL_MS;
  }
  return true;
}

async function pollOne(id) {
  const matchRef = findMatch(id);
  if (!matchRef) return false;
  const revision = (state.pollRevision.get(id) || 0) + 1;
  state.pollRevision.set(id, revision);
  const previousEvent = state.events.get(id);
  const oddsDue = shouldPollLiveOdds(id);
  const capture = (path) => api(path)
    .then((value) => value === null ? { kind: 'not-found' } : { kind: 'success', value })
    .catch((error) => ({ kind: 'failed', error }));
  const [eventResponse, statsResponse, oddsResponse] = await Promise.all([
    capture(`event/${id}`),
    capture(`event/${id}/statistics`),
    oddsDue ? capture(`event/${id}/odds/1/all`) : null,
    needsPlayers(id) ? loadPlayers(id).catch(() => null) : null,
  ]);
  if (state.pollRevision.get(id) !== revision || findMatch(id) !== matchRef) return false;

  const eventResult = LiveAnalysisState.classifyApiResponse(eventResponse, 'event', id);
  const statsResult = LiveAnalysisState.classifyApiResponse(statsResponse, 'statistics', id);
  const previousIdentity = previousEvent && LiveAnalysisState.matchIdentity(previousEvent, id);
  const nextIdentity = eventResult.kind === 'complete'
    ? LiveAnalysisState.matchIdentity(eventResult.event, id) : previousIdentity;
  const previousScore = LiveAnalysisState.scorePair(previousEvent);
  const nextScore = eventResult.kind === 'complete' ? LiveAnalysisState.scorePair(eventResult.event) : previousScore;
  const scoreChanged = !!previousScore && !!nextScore
    && (previousScore[0] !== nextScore[0] || previousScore[1] !== nextScore[1]);
  const eventReset = eventResult.kind === 'complete' && previousEvent && (
    previousIdentity !== nextIdentity
    || previousEvent.status?.type !== eventResult.event.status?.type
    || previousEvent.status?.code !== eventResult.event.status?.code
    || scoreChanged
  );
  if (eventResult.kind === 'complete') {
    if (eventReset) {
      forgetAnalysis(id);
      if (previousIdentity !== nextIdentity) state.stats.delete(id);
    }
    state.events.set(id, eventResult.event);
  }

  const currentEvent = state.events.get(id);
  let oddsResult = oddsResponse
    ? oddsResponse.kind === 'success' ? { kind: 'complete', value: oddsResponse.value } : oddsResponse
    : { kind: 'skipped' };
  if (!oddsDue && !eventReset) {
    oddsResult = { kind: state.apiStatus.get(id)?.odds || 'skipped' };
  }
  if (statsResult.kind === 'complete') state.stats.set(id, parseStats(statsResult.value));
  const liveOddsPhase = isLive(currentEvent) && [6, 7, 41, 42].includes(currentEvent.status?.code);
  if (oddsDue && oddsResult.kind === 'complete'
    && (eventReset || eventResult.kind !== 'complete' || !liveOddsPhase)) {
    oddsResult = { kind: 'skipped' };
  }
  if (oddsDue && !eventReset && eventResult.kind === 'complete'
    && oddsResult.kind === 'complete' && liveOddsPhase) {
    const recorded = recordLiveOddsSnapshot(id, oddsResult.value, currentEvent);
    if (!recorded) {
      const shape = LiveAnalysisState.classifyOddsResponse(oddsResponse);
      oddsResult = { kind: shape.kind === 'complete' ? 'empty' : shape.kind };
    }
    state.lastOddsPoll.set(id, Date.now());
  }
  state.apiStatus.set(id, {
    event: eventResult.kind, statistics: statsResult.kind, odds: oddsResult.kind, at: Date.now(),
  });
  if (!liveOddsPhase) state.liveOdds.delete(id);
  recordAnalysisSnapshot(id, eventResult.kind === 'complete' && statsResult.kind === 'complete');
  if (eventResult.kind === 'complete') state.lastPoll.set(id, Date.now());
  updateTile(id);
  checkAlerts(id);
  return eventResult.kind === 'complete';
}

let polling = false;
async function pollAll() {
  if (polling) return;
  const ids = state.matches.map((m) => m.id).filter(needsPoll);
  if (!ids.length) return;
  polling = true;
  try {
    const ok = await mapLimit(ids, 4, pollOne);
    renderShotList();
    renderAnalysisList();
    const failed = ok.filter((x) => !x).length;
    setStatus(failed ? `Bağlantı sorunu (${failed} maç güncellenemedi)`
      : `Güncellendi ${new Date().toLocaleTimeString('tr-TR')}`);
  } finally {
    polling = false;
  }
}

// Dakikaları her saniye yerel olarak ilerlet
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
  setInterval(pollAll, POLL_MS);
  setInterval(tickMinutes, 1000);
}

init();
