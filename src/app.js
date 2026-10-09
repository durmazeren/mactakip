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
  pollOne(id).then(() => renderShotList());
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
  players.delete(id);
  forgetAlerts(id); // yeni veriyle sahte şut uyarısı çıkmasın
  for (const k of [...state.lastShown.keys()]) if (k.startsWith(`${id}|`)) state.lastShown.delete(k);
  const tile = state.tiles.get(id);
  if (tile) {
    if (tile.webview) { tile.webview.remove(); tile.webview = null; }
    tile.mode = null; // updateTile animasyonu baştan kurar
  }
  const ok = await pollOne(id);
  renderShotList();
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
  const [evRes, stRes] = await Promise.all([
    api(`event/${id}`).catch(() => undefined),
    api(`event/${id}/statistics`).catch(() => undefined),
    needsPlayers(id) ? loadPlayers(id) : null,
  ]);
  if (!findMatch(id)) return true;
  if (evRes?.event) state.events.set(id, evRes.event);
  if (stRes) {
    state.statsRaw.set(id, stRes);
    state.stats.set(id, parseStats(stRes));
  }
  else if (stRes === null && state.events.get(id)?.status?.type !== 'notstarted') {
    state.statsRaw.delete(id);
    state.stats.set(id, { none: true }); // maç başladı ama Sofascore istatistik tutmuyor
  }
  if (evRes !== undefined) state.lastPoll.set(id, Date.now());
  updateTile(id);
  checkAlerts(id);
  renderStatsModalIfOpen(id);
  return evRes !== undefined && stRes !== undefined;
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
  for (const m of state.matches) if (m.anim) createTile(m.id);
  refresh(false);
  if (state.matches.length) {
    setStatus('Kayıtlı maçlar yükleniyor…');
    pollAll();
  }
  setTimeout(() => loadCatalog(), 3000);
  setInterval(pollAll, POLL_MS);
  setInterval(tickMinutes, 1000);
}

init();
