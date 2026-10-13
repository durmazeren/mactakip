'use strict';

/* Animasyon kutuları: canlı animasyon (Sportradar) veya atak grafiği gösteren webview'ler */

function autoReloadAllowed(tile) {
  const connection = state.sofaConnection;
  return !tile.reloadBlocked && !(connection?.state === 'blocked'
    && (connection.status === 403 || connection.retryAt > Date.now()));
}

function scheduleTileRecovery(tile, webview) {
  const delay = [15_000, 45_000, 120_000][tile.recoveryAttempts];
  if (tile.webview !== webview || tile.recoveryTimer || delay == null || !autoReloadAllowed(tile)) return;
  tile.recoveryAttempts++;
  tile.recoveryTimer = setTimeout(() => {
    tile.recoveryTimer = null;
    if (tile.webview === webview && autoReloadAllowed(tile)) webview.reload();
  }, delay);
}

function createTile(id, preview = false) {
  if (state.tiles.has(id)) return;
  const node = $('#tileTpl').content.firstElementChild.cloneNode(true);
  const tile = { id, el: node, preview, mode: null, webview: null, ready: false, trackerH: null,
    timers: [], fitTimer: null, recoveryTimer: null, recoveryAttempts: 0, reloadBlocked: false, ro: null };
  $('.switch-match', node).hidden = !findMatch(id)?.anim;
  $('.switch-match', node).addEventListener('click', () => {
    if ($('#statsDialog').open) closeStatsModal(false);
    openReplacePicker(id);
  });
  $('.close', node).addEventListener('click', () => removeMatch(id));
  $('.to-shot', node).addEventListener('click', () => setAnim(id, false));
  $('.focus-btn', node).addEventListener('click', () => toggleFocus(id));
  $('.reset-btn', node).addEventListener('click', () => resetMatch(id));
  const head = $('.tile-head', node);
  head.addEventListener('pointerdown', (e) => { if (!tile.preview) startDrag(e, tile); });
  head.addEventListener('dblclick', (e) => { if (!tile.preview && !e.target.closest('button')) toggleFocus(id); });
  for (const h of node.querySelectorAll('.rh')) {
    h.addEventListener('pointerdown', (e) => startResize(e, tile, h.dataset.dir));
  }
  tile.ro = new ResizeObserver(() => scheduleFit(tile));
  tile.ro.observe($('.stage', node));
  state.tiles.set(id, tile);
  $('#grid').append(node);
  $('.placeholder', node).replaceChildren(
    el('b', null, `Maç #${id}`),
    el('span', null, 'Veri bekleniyor · ↻ ile yeniden dene'),
  );
  updateTile(id);
}

function destroyTile(id) {
  const t = state.tiles.get(id);
  if (!t) return;
  t.ro.disconnect();
  t.timers.forEach(clearInterval);
  clearTimeout(t.fitTimer);
  clearTimeout(t.recoveryTimer);
  t.el.remove();
  state.tiles.delete(id);
}

function setStage(tile, mode) {
  if (tile.mode === mode) return;
  tile.mode = mode;
  tile.trackerH = null;
  const stage = $('.stage', tile.el);
  if (tile.webview) { tile.webview.remove(); tile.webview = null; }
  tile.ready = false;
  tile.timers.forEach(clearInterval);
  tile.timers = [];
  clearTimeout(tile.recoveryTimer);
  tile.recoveryTimer = null;
  tile.recoveryAttempts = 0;
  tile.reloadBlocked = false;
  const ph = $('.placeholder', stage);
  const ev = state.events.get(tile.id);

  if (mode === 'wait') {
    ph.hidden = false;
    ph.replaceChildren(
      el('b', null, `Başlama ${minuteText(ev)}`),
      el('span', null, 'Animasyon maç başlayınca kendiliğinden açılır'),
    );
    $('.src', tile.el).textContent = '';
    if (!tile.preview && state.layout.mode === 'grid' && !state.layout.focus && state.layout.arrange === 'auto') applyLayout(false);
    return;
  }

  ph.hidden = true;
  const wv = document.createElement('webview');
  // Animasyonlar ortak oturumda (önbellek paylaşılır) ve sayfa içinden ölçeklenir.
  // Atak grafiği boyutunu pencere genişliğinden hesapladığı için sayfa yakınlaştırması
  // kullanır; yakınlaştırma oturum başına ortak olduğundan her grafiğe ayrı oturum.
  wv.setAttribute('partition', mode === 'tracker' ? PARTITION : `momentum-${tile.id}`);
  wv.setAttribute('src', mode === 'tracker' ? TRACKER_URL(tile.id) : MOMENTUM_URL(tile.id));
  wv.addEventListener('dom-ready', () => {
    if (tile.webview !== wv) return;
    tile.ready = true;
    // Eski sürümden kalmış olabilecek sayfa yakınlaştırmasını sıfırla
    if (mode === 'tracker') { try { wv.setZoomFactor(1); } catch { /* yoksay */ } }
    wv.insertCSS(STAGE_CSS).catch(() => {});
    fitTile(tile);
  });
  // Geçici hatada en fazla üç deneme; engellenen bağlantıya sürekli istek gönderme.
  let loadFailed = false;
  wv.addEventListener('did-start-loading', () => { loadFailed = false; });
  wv.addEventListener('did-finish-load', () => {
    if (tile.webview !== wv || loadFailed || tile.reloadBlocked) return;
    tile.recoveryAttempts = 0;
    clearTimeout(tile.recoveryTimer);
    tile.recoveryTimer = null;
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    loadFailed = true;
    scheduleTileRecovery(tile, wv);
  });
  wv.addEventListener('render-process-gone', () => {
    loadFailed = true;
    scheduleTileRecovery(tile, wv);
  });
  wv.addEventListener('did-navigate', (e) => {
    if (tile.webview !== wv) return;
    if (e.httpResponseCode === 429 || (mode === 'momentum' && e.httpResponseCode === 403)) {
      tile.reloadBlocked = true;
      clearTimeout(tile.recoveryTimer);
      tile.recoveryTimer = null;
    }
  });
  if (mode === 'tracker') {
    // Animasyon yoksa (lisans yok, küçük lig) atak grafiğine geç
    wv.addEventListener('page-title-updated', (e) => {
      if (tile.webview === wv && e.title === 'SR_NO_CONTENT') setStage(tile, 'momentum');
    });
    wv.addEventListener('did-navigate', (e) => {
      if (tile.webview === wv && e.httpResponseCode >= 400 && e.httpResponseCode !== 429) setStage(tile, 'momentum');
    });
  } else {
    // Atak grafiği açıldıktan sonra veri çekmiyor: canlı maçta dakikada bir yenile
    tile.timers.push(setInterval(() => {
      if (tile.ready && autoReloadAllowed(tile) && isLive(state.events.get(tile.id))) wv.reload();
    }, MOMENTUM_RELOAD_MS));
  }
  stage.append(wv);
  tile.webview = wv;
  // Widget içeriği yüklendikçe boyu değişiyor; birkaç saniyede bir yeniden sığdır
  tile.timers.push(setInterval(() => fitTile(tile), 3000));
  $('.src', tile.el).textContent = mode === 'tracker' ? 'Canlı animasyon' : 'Atak grafiği';
  if (!tile.preview && state.layout.mode === 'grid' && !state.layout.focus && state.layout.arrange === 'auto') applyLayout(false);
}

function scheduleFit(tile) {
  clearTimeout(tile.fitTimer);
  tile.fitTimer = setTimeout(() => fitTile(tile), 60);
}

/* İçeriği kutuya sığdırır.
 * Animasyon: kendi sayfasında CSS zoom ile ölçeklenir; odak/serbest modda farklı
 * boyuttaki kutular birbirini etkilemez.
 * Atak grafiği: ayrı oturumundaki sayfa yakınlaştırmasıyla ölçeklenir. */
function fitTile(tile) {
  const wv = tile.webview;
  if (!wv || !wv.isConnected || !tile.ready) return;
  const stage = $('.stage', tile.el);
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;

  if (tile.mode === 'tracker') {
    wv.executeJavaScript(`(function (W, H, baseW) {
      const de = document.documentElement;
      const zc = parseFloat(de.style.zoom) || 1;
      const lmt = document.querySelector('.widgets');
      if (!lmt) return 0;
      const ch = lmt.offsetHeight;
      if (ch < 50) return 0;
      const z = Math.max(0.25, Math.min(2.5, Math.min(W / baseW, H / ch)));
      if (Math.abs(z - zc) > 0.005) de.style.zoom = String(z);
      // Animasyonu dikeyde ortala
      lmt.style.marginTop = Math.max(0, (H / z - ch) / 2) + 'px';
      return { z, ch };
    })(${w}, ${h}, ${TRACKER_W})`).then((result) => {
      if (tile.webview !== wv || !result?.ch) return;
      tile.trackerH = result.ch;
      if (tile.preview || state.layout.mode !== 'grid' || state.layout.focus || state.layout.arrange !== 'auto') return;
      const should = useSideStats(tile.el.offsetWidth, tile.el.offsetHeight, result.ch);
      if (should !== tile.el.classList.contains('side-stats')) applyLayout(false);
    }).catch(() => { /* sayfa henüz hazır değil */ });
    return;
  }

  wv.executeJavaScript(`(function () {
    const chart = document.querySelector('.is-embed a');
    return chart ? chart.getBoundingClientRect().bottom + 16 : 0;
  })()`).then((ch) => {
    if (tile.webview !== wv || ch < 50) return;
    const z = Math.max(0.25, Math.min(2.5, Math.min(w / MOMENTUM_W, h / ch)));
    if (Math.abs(wv.getZoomFactor() - z) > 0.01) wv.setZoomFactor(z);
  }).catch(() => { /* sayfa henüz hazır değil */ });
}

function updateTile(id) {
  const tile = state.tiles.get(id);
  const ev = state.events.get(id);
  if (!tile || !ev) return;
  const node = tile.el;
  if (ev._animationOnly) {
    $('.home-name', node).textContent = `Maç #${id}`;
    $('.away-name', node).textContent = '';
    $('.score', node).textContent = '–';
    $('.minute', node).textContent = 'Animasyon';
    $('.tile-foot', node).classList.add('no-stats');
    $('.tile-foot', node).classList.add('animation-only');
    if (tile.mode !== 'tracker') setStage(tile, 'tracker');
    return;
  }
  $('.home-name', node).textContent = teamName(ev.homeTeam);
  $('.away-name', node).textContent = teamName(ev.awayTeam);
  $('.home-name', node).title = ev.homeTeam?.name || '';
  $('.away-name', node).title = ev.awayTeam?.name || '';
  if (ev.homeTeam?.id && !$('.home-logo', node).src) $('.home-logo', node).src = LOGO_URL(ev.homeTeam.id);
  if (ev.awayTeam?.id && !$('.away-logo', node).src) $('.away-logo', node).src = LOGO_URL(ev.awayTeam.id);
  $('.score', node).textContent = scoreText(ev);
  const m = $('.minute', node);
  m.textContent = minuteText(ev);
  m.classList.toggle('live', isLive(ev));

  const st = state.stats.get(id);
  const all = st?.ALL;
  const pair = (v) => (v ? `${v[0]} – ${v[1]}` : '–');
  $('.tile-foot', node).classList.toggle('no-stats', !!st?.none);
  $('.tile-foot', node).classList.remove('animation-only');
  // Futbolda şut / isabetli / korner; basketbolda kartta seçili ilk üç istatistik
  const basket = matchSport(id) === 'basketball';
  const keys = basket ? state.basketCardStats.slice(0, 3) : ['shots', 'sot', 'corners'];
  const metrics = cardMetrics(basket ? 'basketball' : 'football');
  node.querySelectorAll('.tile-foot > span:not(.src)').forEach((span, i) => {
    const metric = metrics.find((m) => m.key === keys[i]);
    span.hidden = !metric;
    if (!metric) return;
    $('.fl', span).textContent = metric.label;
    $('.fv', span).textContent = pair(metric.key === 'points' ? basketPoints(ev, 'ALL') : all?.[metric.key]);
  });

  if (ev.status?.type === 'notstarted') {
    if (tile.mode !== 'wait') setStage(tile, 'wait');
    else $('.placeholder b', node).textContent = `Başlama ${minuteText(ev)}`;
  } else if (isOver(ev)) {
    // Maç bitince animasyon boş saha gösteriyor; maçın özeti olarak atak grafiğine geç
    if (tile.mode !== 'momentum') setStage(tile, 'momentum');
  } else if (tile.mode === 'wait' || tile.mode === null) {
    setStage(tile, 'tracker');
  }
}
