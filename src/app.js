'use strict';

/* Maç ekleme/çıkarma, canlı güncelleme ve başlangıç. Yardımcılar js/ altındaki dosyalarda. */

async function addMatch(id, ev, anim, fromLink = false) {
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
  let animationOnly = false;
  if (!ev) {
    const res = await api(`event/${id}`).catch(() => undefined);
    if (res === undefined && anim && fromLink) {
      // Maç JSON'u engellense de Sofascore'un animasyon webview'i açılabiliyor.
      ev = animationOnlyEvent(id);
      animationOnly = true;
      state.lastPoll.set(id, Date.now());
    } else if (!res?.event) {
      setStatus(res === undefined ? 'Sofascore maç verisi alınamadı' : `Maç bulunamadı (#${id})`);
      return;
    } else ev = res.event;
  }
  if (findMatch(id)) return; // beklerken eklendiyse
  // Yalnız animasyon açılan linkte spor bilinmiyor; seçicide hangi spor açıksa o varsayılır
  const sport = eventSport(ev) || (fromLink ? state.pickerSport : 'football');
  state.matches.push({ id, anim, animationOnly, ...(sport === 'basketball' ? { sport } : {}) });
  state.events.set(id, ev);
  saveMatches();
  if (anim) createTile(id);
  refresh(true);
  if (animationOnly) {
    setStatus(`Maç #${id}: yalnız animasyon açık; skor ve istatistik verisi alınamıyor`);
    return;
  }
  pollOne(id).then(() => renderShotList());
}

async function replaceAnimation(oldId, newId, ev) {
  const old = findMatch(oldId);
  if (!old?.anim || oldId === newId) return;
  let next = findMatch(newId);
  if (!next && state.matches.length >= MAX_TOTAL) {
    setStatus(`En fazla ${MAX_TOTAL} maç eklenebilir`);
    return;
  }
  if (!ev && !state.events.has(newId)) {
    const result = await api(`event/${newId}`).catch(() => undefined);
    if (result === undefined) { setStatus('Maç verisi alınamadı: Sofascore erişimini kontrol et'); return; }
    if (!result?.event) { setStatus(`Maç bulunamadı (#${newId})`); return; }
    ev = result.event;
  }
  if (!findMatch(oldId)?.anim) return;
  next = findMatch(newId);
  if (statsModalMatchId != null) closeStatsModal(false);
  const oldIndex = state.matches.indexOf(old);
  const nextIndex = next ? state.matches.indexOf(next) : -1;
  if (next?.anim) {
    [state.matches[oldIndex], state.matches[nextIndex]] = [next, old];
    const oldFree = state.layout.free[oldId];
    state.layout.free[oldId] = state.layout.free[newId];
    state.layout.free[newId] = oldFree;
  } else {
    old.anim = false;
    if (next) state.matches.splice(nextIndex, 1);
    else next = { id: newId, anim: false, animationOnly: false,
      ...(eventSport(ev) === 'basketball' ? { sport: 'basketball' } : {}) };
    next.anim = true;
    state.matches.splice(state.matches.indexOf(old), 0, next);
    state.layout.free[newId] = state.layout.free[oldId];
    delete state.layout.free[oldId];
    destroyTile(oldId);
    if (ev) state.events.set(newId, ev);
    createTile(newId);
  }
  if (state.layout.focus === oldId) state.layout.focus = newId;
  else if (state.layout.focus === newId && old.anim) state.layout.focus = oldId;
  state.layout.z = nextIndex >= 0 && old.anim
    ? state.layout.z.map((id) => id === oldId ? newId : id === newId ? oldId : id)
    : state.layout.z.filter((id) => id !== newId).map((id) => id === oldId ? newId : id);
  saveMatches();
  saveLayout();
  refresh(true);
  if (ev) state.events.set(newId, ev);
  if (!state.lastPoll.has(newId)) pollOne(newId).then(() => renderShotList());
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
  if (statsModalMatchId === id) closeStatsModal(false);
  state.matches = state.matches.filter((m) => m.id !== id);
  saveMatches();
  destroyTile(id);
  removeTargetsOf(id);
  forgetAlerts(id);
  state.events.delete(id);
  state.stats.delete(id);
  state.statsRaw.delete(id);
  players.delete(id);
  state.lastPoll.delete(id);
  state.lastAttempt.delete(id);
  finalPolls.delete(id);
  waitingSince.delete(id);
  delete state.layout.free[id];
  state.layout.z = state.layout.z.filter((x) => x !== id);
  if (state.layout.focus === id) state.layout.focus = null;
  saveLayout();
  refresh(true);
}

// ↻ Maçı sıfırdan yükle: önbellekteki veriyi at, animasyonu yeniden aç, hemen sorgula
async function resetMatch(id) {
  if (!findMatch(id)) return;
  const buttons = [state.tiles.get(id)?.el, shotCards.get(id)?.el]
    .filter(Boolean).map((n) => $('.reset-btn', n));
  buttons.forEach((b) => b.classList.add('spinning'));
  state.stats.delete(id);
  state.statsRaw.delete(id);
  state.lastPoll.delete(id);
  state.lastAttempt.delete(id);
  finalPolls.delete(id);
  waitingSince.delete(id);
  players.delete(id);
  forgetAlerts(id); // yeni veriyle sahte şut uyarısı çıkmasın
  for (const k of [...state.lastShown.keys()]) if (k.startsWith(`${id}|`)) state.lastShown.delete(k);
  const tile = state.tiles.get(id);
  if (tile) {
    if (tile.webview) { tile.webview.remove(); tile.webview = null; }
    tile.graph = null;
    tile.mode = null; // updateTile animasyonu baştan kurar
  }
  const ok = await pollOne(id, true);
  renderShotList();
  buttons.forEach((b) => b.classList.remove('spinning'));
  const ev = state.events.get(id);
  setStatus(ok ? `${teamName(ev?.homeTeam)} – ${teamName(ev?.awayTeam)} yenilendi`
    : ev?._animationOnly ? 'Animasyon açık; skor ve istatistikler hâlâ alınamıyor' : 'Yenilenemedi, bağlantıyı kontrol et');
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
}

/* ---------- Canlı güncelleme ---------- */

const finalPolls = new Set();
const matchPolls = new Map();
const waitingSince = new Map();

function pollContext(id) {
  const match = findMatch(id);
  return { ...match, event: state.events.get(id), now: Date.now(),
    focused: state.layout.focus === id || statsModalMatchId === id,
    hasTargets: state.targets.some((t) => t.matchId === id),
    liveCount: state.matches.filter((m) => !state.events.has(m.id) || isLive(state.events.get(m.id))).length };
}

function pollOptions(id) {
  const rank = SofaPollPolicy.priority(pollContext(id));
  return { priority: rank === 0 ? 'interactive' : rank <= 2 ? 'normal' : 'background' };
}

function needsPoll(id) {
  if (matchPolls.has(id)) return false;
  const ev = state.events.get(id);
  const last = state.lastAttempt.get(id) || 0;
  if (!last) { if (!waitingSince.has(id)) waitingSince.set(id, Date.now()); return true; }
  if (isOver(ev) && finalPolls.has(id)) return false;
  const due = Date.now() - last >= SofaPollPolicy.interval(pollContext(id));
  if (due && !waitingSince.has(id)) waitingSince.set(id, Date.now());
  return due;
}

const pollRank = (id) => Math.max(0, SofaPollPolicy.priority(pollContext(id))
  - Math.floor((Date.now() - (waitingSince.get(id) ?? Date.now())) / 30_000));

function pollOne(id, force = false, snapshot = null) {
  if (matchPolls.has(id)) return matchPolls.get(id);
  const work = fetchMatch(id, force, snapshot).finally(() => matchPolls.delete(id));
  matchPolls.set(id, work);
  return work;
}

async function fetchMatch(id, force, snapshot) {
  state.lastAttempt.set(id, Date.now());
  waitingSince.delete(id);
  const animationOnly = !!findMatch(id)?.animationOnly;
  const options = { ...pollOptions(id), fresh: force };
  const evRes = snapshot ? { event: snapshot } : await api(`event/${id}`, options).catch(() => undefined);
  if (!findMatch(id)) return true;
  if (evRes?.event) {
    state.events.set(id, evRes.event);
    const match = findMatch(id);
    const sport = eventSport(evRes.event);
    if (match && sport && (match.sport || 'football') !== sport) {
      if (sport === 'basketball') match.sport = sport; else delete match.sport;
      saveMatches();
    }
    if (match?.animationOnly) { match.animationOnly = false; saveMatches(); }
  }
  const wantStats = !findMatch(id)?.animationOnly && !!state.events.get(id)
    && state.events.get(id).status?.type !== 'notstarted' && evRes !== undefined;
  const [stRes] = await Promise.all([
    wantStats ? api(`event/${id}/statistics`, options).catch(() => undefined) : null,
    wantStats && needsPlayers(id) ? loadPlayers(id) : null,
  ]);
  if (!findMatch(id)) return true;
  if (wantStats && stRes) {
    state.statsRaw.set(id, stRes);
    state.stats.set(id, parseStats(stRes, matchSport(id)));
  }
  else if (wantStats && stRes === null) {
    state.statsRaw.delete(id);
    state.stats.set(id, { none: true }); // maç başladı ama Sofascore istatistik tutmuyor
  }
  if (animationOnly || evRes !== undefined) state.lastPoll.set(id, Date.now());
  if (isOver(state.events.get(id)) && evRes !== undefined && stRes !== undefined) finalPolls.add(id);
  updateTile(id);
  checkAlerts(id);
  renderStatsModalIfOpen(id);
  return animationOnly ? !!evRes?.event : evRes !== undefined && stRes !== undefined;
}

let polling = false;
async function pollAll() {
  if (polling) return;
  const connection = state.sofaConnection;
  if (connection?.state === 'blocked' && (connection.status === 403 || connection.retryAt > Date.now())) return;
  const due = state.matches.map((m) => m.id).filter(needsPoll).sort((a, b) =>
    pollRank(a) - pollRank(b)
      || (state.lastAttempt.get(a) || 0) - (state.lastAttempt.get(b) || 0));
  // Small rounds prevent bulk selection/startup from filling the request queue.
  const ids = due.slice(0, 6);
  if (!ids.length) return;
  polling = true;
  try {
    const snapshots = new Map();
    if (state.matches.length >= 8) {
      // One live-score response covers many matches. Missing entries still get
      // their own event request, so finished/missing matches are not inferred.
      const sports = new Set(ids.filter((id) => !state.events.has(id) || isLive(state.events.get(id))).map(matchSport));
      for (const sport of sports) {
        const list = await api(`sport/${sport}/events/live`, { priority: 'normal' }).catch(() => null);
        for (const ev of list?.events || []) if (findMatch(ev.id)) snapshots.set(ev.id, ev);
      }
    }
    const ok = await mapLimit(ids, 1, (id) => findMatch(id) ? pollOne(id, false, snapshots.get(id)) : true);
    renderShotList();
    const failed = ok.filter((x) => !x).length;
    setStatus(failed ? `Bağlantı sorunu (${failed} maç güncellenemedi)`
      : `Güncellendi ${new Date().toLocaleTimeString('tr-TR')}${due.length > ids.length ? ' · diğer maçlar sırayla' : ''}`);
  } finally {
    polling = false;
  }
}

// Dakikaları (basketbolda çeyrek saatini) her saniye yerel olarak ilerlet
function tickMinutes() {
  for (const { id } of state.matches) {
    const ev = state.events.get(id);
    if (!ev || !isLive(ev)) continue;
    const text = minuteText(ev);
    const t = state.tiles.get(id);
    if (t) $('.minute', t.el).textContent = text;
    if (t?.mode === 'board') $('.b-clock', t.el).textContent = text;
    const card = shotCards.get(id);
    if (card && card.meta.textContent !== text) card.meta.textContent = text;
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
  // Görünüm menüsü (yerleşim + dizilim) ve açık kutu menüleri: dışarı tıklayınca / Esc ile kapanır
  const viewMenu = $('#viewMenu'), viewBtn = $('#viewMenuBtn');
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    viewMenu.hidden = !viewMenu.hidden;
    viewBtn.setAttribute('aria-expanded', String(!viewMenu.hidden));
  });
  const closeMenus = () => {
    viewMenu.hidden = true;
    viewBtn.setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.tile-menu').forEach((m) => { m.hidden = true; });
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#viewMenu, .tile-more')) closeMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
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
    if ($('#statsDialog').open) {
      if (e.key === 'Escape') { e.preventDefault(); closeStatsModal(); }
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey
      && !e.target.closest('input, select, textarea')) toggleFullscreen();
  });
  window.appShortcut.on((key) => {
    if ($('#statsDialog').open) { if (key === 'Escape') closeStatsModal(); return; }
    if (key === 'f') toggleFullscreen();
    if (key === 'Escape' && state.layout.focus) {
      state.layout.focus = null;
      saveLayout();
      applyLayout(true);
    }
  });
}

/* ---------- Başlangıç ---------- */

function initConnection() {
  const notice = $('#sofaConnection');
  const text = $('#sofaConnectionText');
  const retry = $('#sofaRetry');
  let connection = { state: 'unknown' };
  let checking = false;
  const render = () => {
    notice.hidden = connection.state !== 'blocked';
    if (notice.hidden) return;
    const wait = Math.max(0, Math.ceil((connection.retryAt - Date.now()) / 60_000));
    text.textContent = connection.status === 429
      ? `SofaScore istek sınırı. Otomatik istekler ${wait || 1} dakika bekliyor.`
      : ['opening', 'checking'].includes(connection.recovery?.phase)
        ? 'SofaScore oturumu yenileniyor. Bağlantı bir kez kontrol edilecek…'
        : 'SofaScore erişimi reddetti (403). Oturum yenilemesi durdu; siteyi açıp bağlantıyı kontrol edebilirsin.';
    retry.disabled = checking || ['opening', 'checking'].includes(connection.recovery?.phase)
      || (connection.status === 429 && connection.retryAt > Date.now());
  };
  const update = (value) => {
    const recovered = connection.state === 'blocked' && value.state === 'connected';
    connection = value; state.sofaConnection = value; render();
    if (recovered) {
      state.lastAttempt.clear(); waitingSince.clear(); state.catalog.loadedAt = 0;
    }
  };
  window.sofa.onConnection(update);
  window.sofa.connection().then(update);
  setInterval(render, 1000);
  $('#sofaOpen').addEventListener('click', () => window.sofa.open());
  retry.addEventListener('click', async () => {
    if (checking) return;
    checking = true;
    retry.disabled = true;
    retry.textContent = 'Kontrol ediliyor…';
    try {
      const result = await window.sofa.retry();
      update(result);
      if (result.state === 'connected' && !result.error) {
        state.catalog.loadedAt = 0;
        state.lastPoll.clear();
        state.lastAttempt.clear();
        waitingSince.clear();
        const pickerOpen = !$('#dropdown').hidden;
        await Promise.all([pollAll(), pickerOpen ? loadCatalog(true) : null,
          pickerOpen ? loadLeagueMatches(selectedLeagueId(), true) : null]);
        if (!$('#dropdown').hidden) renderDropdown();
        const latest = await window.sofa.connection();
        update(latest);
        if (latest.state === 'connected') setStatus('SofaScore bağlantısı yeniden kuruldu');
      } else if (result.error) setStatus(result.error);
    } finally {
      checking = false;
      retry.textContent = 'Bağlantıyı kontrol et';
      render();
    }
  });
}

function init() {
  syncWatched();
  initTheme();
  initSoundSettings();
  initMasterSpeaker();
  initSoundBoard();
  initConnection();
  initPicker();
  initLayout();
  initUpdates();
  initCardSettings();
  initStatsModal();
  initFullscreen();
  $('#toggleSide').addEventListener('click', () => document.body.classList.toggle('side-hidden'));
  $('#periodSeg').addEventListener('click', (e) => {
    const p = e.target?.dataset?.period;
    if (!p) return;
    state.period = p;
    for (const b of $('#periodSeg').children) b.classList.toggle('on', b.dataset.period === p);
    renderShotList();
  });

  // Kayıtlı liste ağ hatasında korunur; veri gelmeyen maç sonraki turda tekrar denenir.
  for (const m of state.matches) {
    if (m.animationOnly) state.events.set(m.id, animationOnlyEvent(m.id));
    if (m.anim) createTile(m.id);
  }
  refresh(false);
  if (state.matches.length) {
    setStatus('Kayıtlı maçlar yükleniyor…');
    pollAll();
  }
  setInterval(pollAll, POLL_MS);
  setInterval(tickMinutes, 1000);
}

init();
