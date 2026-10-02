'use strict';

/* Animasyon kutularının yerleşimi: ızgara, odak modu ve serbest mod.
 * Tüm modlarda kutular mutlak konumlanır; webview'ler DOM'da hiç taşınmaz
 * (taşınırsa yeniden yüklenip bozuluyor). */

const GAP = 8;
const PAD = 8;
const FOCUS_MIN_RATIO = 0.5;   // odakta diğer maçlar, odaktakinin en az yarı boyunda kalsın
const FOCUS_MAX_SHARE = 0.78;  // odaktaki maç alanın en fazla bu kadarını kaplasın
const SNAP_PX = 10;
const MIN_W = 240;
const MIN_H = 160;
const TILE_CHROME = 62;        // kutu başlığı + alt satır yüksekliği

// Animasyonun bu kutuda ne kadar büyük görüneceği (1 = doğal boyut)
function contentScale(w, h) {
  return Math.min(w / TRACKER_W, Math.max(0, h - TILE_CHROME) / TRACKER_H);
}

// n kutu için animasyonları en büyük gösteren sütun/satır sayısını bulur
function bestGrid(n, W, H) {
  let best = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const tw = (W - (c - 1) * GAP) / c;
    const th = (H - (r - 1) * GAP) / r;
    if (tw <= 0 || th <= 0) continue;
    const s = contentScale(tw, th);
    const empty = c * r - n;
    if (!best || s > best.s + 1e-6 || (Math.abs(s - best.s) <= 1e-6 && empty < best.empty)) {
      best = { c, r, tw, th, s, empty };
    }
  }
  return best;
}

function placeGrid(ids, area) {
  const rects = {};
  const g = bestGrid(ids.length, area.w, area.h);
  if (!g) return rects;
  ids.forEach((id, i) => {
    const row = Math.floor(i / g.c);
    const col = i % g.c;
    // Son satır eksikse ortala
    const inRow = row === g.r - 1 ? ids.length - row * g.c : g.c;
    const offset = (area.w - (inRow * g.tw + (inRow - 1) * GAP)) / 2;
    rects[id] = {
      x: area.x + offset + col * (g.tw + GAP),
      y: area.y + row * (g.th + GAP),
      w: g.tw,
      h: g.th,
    };
  });
  return rects;
}

/* Odak modu: seçilen maç büyük alana, diğerleri yandaki ya da alttaki şeride.
 * Odaktaki maçı olabildiğince büyütür, ama diğerlerinin animasyonu odaktakinin
 * en az FOCUS_MIN_RATIO'su kadar kalır. Sağ ve alt şerit denenir, iyisi seçilir. */
function focusLayout(ids, focusId, area) {
  const others = ids.filter((id) => id !== focusId);
  if (!others.length) return { [focusId]: { ...area } };

  let best = null;
  let fallback = null;
  for (const orient of ['right', 'bottom']) {
    for (let f = 0.5; f <= FOCUS_MAX_SHARE + 1e-9; f += 0.01) {
      let main, strip;
      if (orient === 'right') {
        const mw = area.w * f - GAP / 2;
        main = { x: area.x, y: area.y, w: mw, h: area.h };
        strip = { x: area.x + mw + GAP, y: area.y, w: area.w - mw - GAP, h: area.h };
      } else {
        const mh = area.h * f - GAP / 2;
        main = { x: area.x, y: area.y, w: area.w, h: mh };
        strip = { x: area.x, y: area.y + mh + GAP, w: area.w, h: area.h - mh - GAP };
      }
      const g = bestGrid(others.length, strip.w, strip.h);
      if (!g) continue;
      const sM = contentScale(main.w, main.h);
      const sO = g.s;
      const cand = { main, strip, sM, sO };
      if (sO >= FOCUS_MIN_RATIO * sM) {
        if (!best || sM > best.sM + 1e-6 || (Math.abs(sM - best.sM) <= 1e-6 && sO > best.sO)) best = cand;
      }
      // Hiçbiri şartı sağlamazsa: diğerlerini en az küçülten düzen
      if (!fallback || sO / sM > fallback.sO / fallback.sM) fallback = cand;
    }
  }
  const pick = best || fallback;
  return { [focusId]: pick.main, ...placeGrid(others, pick.strip) };
}

function gridArea() {
  const grid = $('#grid');
  return { x: 0, y: 0, w: grid.clientWidth - 2 * PAD, h: grid.clientHeight - 2 * PAD };
}

/* Serbest mod: konumlar alanın oranı olarak saklanır, pencere boyu değişince ölçeklenir */
function freeRects(ids, area) {
  const free = state.layout.free;
  const missing = ids.filter((id) => !free[id]);
  if (missing.length) {
    const base = placeGrid(ids, area);
    for (const id of missing) free[id] = toFraction(base[id], area);
    saveLayout();
  }
  const rects = {};
  for (const id of ids) rects[id] = clampRect(fromFraction(free[id], area), area);
  return rects;
}

const toFraction = (r, a) => ({ x: r.x / a.w, y: r.y / a.h, w: r.w / a.w, h: r.h / a.h });
const fromFraction = (f, a) => ({ x: f.x * a.w, y: f.y * a.h, w: f.w * a.w, h: f.h * a.h });

function clampRect(r, a) {
  const w = Math.min(Math.max(r.w, MIN_W), a.w);
  const h = Math.min(Math.max(r.h, MIN_H), a.h);
  return { x: Math.min(Math.max(r.x, 0), a.w - w), y: Math.min(Math.max(r.y, 0), a.h - h), w, h };
}

function setRect(node, r) {
  node.style.left = `${Math.round(PAD + r.x)}px`;
  node.style.top = `${Math.round(PAD + r.y)}px`;
  node.style.width = `${Math.round(r.w)}px`;
  node.style.height = `${Math.round(r.h)}px`;
}

function readRect(node) {
  return {
    x: node.offsetLeft - PAD,
    y: node.offsetTop - PAD,
    w: node.offsetWidth,
    h: node.offsetHeight,
  };
}

let animateTimer = null;
function applyLayout(animate = false) {
  const area = gridArea();
  if (area.w <= 0 || area.h <= 0) return;
  const ids = animIds();
  const lay = state.layout;
  if (lay.focus && !ids.includes(lay.focus)) lay.focus = null;

  let rects;
  if (lay.mode === 'free') rects = freeRects(ids, area);
  else if (lay.focus) rects = focusLayout(ids, lay.focus, area);
  else rects = placeGrid(ids, area);

  const grid = $('#grid');
  clearTimeout(animateTimer);
  grid.classList.toggle('animate', animate);
  if (animate) animateTimer = setTimeout(() => grid.classList.remove('animate'), 350);

  for (const id of ids) {
    const t = state.tiles.get(id);
    const r = rects[id];
    if (!t || !r) continue;
    setRect(t.el, r);
    const focused = lay.mode === 'grid' && lay.focus === id;
    t.el.classList.toggle('focused', focused);
    const fb = $('.focus-btn', t.el);
    fb.textContent = focused ? '⤡' : '⤢';
    fb.title = focused ? 'Odaktan çık' : 'Odak modu: bu maçı büyüt';
    t.el.style.zIndex = lay.mode === 'free' ? String(10 + lay.z.indexOf(id) + 1) : '';
  }
}

function toggleFocus(id) {
  if (state.layout.mode !== 'grid') return;
  state.layout.focus = state.layout.focus === id ? null : id;
  saveLayout();
  applyLayout(true);
}

function setLayoutMode(mode) {
  if (state.layout.mode === mode) return;
  if (mode === 'free') {
    // Serbest moda ilk geçişte mevcut ızgara düzeninden başla
    const area = gridArea();
    const base = placeGrid(animIds(), area);
    for (const id of animIds()) {
      if (!state.layout.free[id]) state.layout.free[id] = toFraction(base[id], area);
    }
  }
  state.layout.mode = mode;
  saveLayout();
  syncLayoutControls();
  applyLayout(true);
}

function resetFreeLayout() {
  const area = gridArea();
  const base = placeGrid(animIds(), area);
  state.layout.free = {};
  for (const id of animIds()) state.layout.free[id] = toFraction(base[id], area);
  saveLayout();
  applyLayout(true);
}

function syncLayoutControls() {
  const mode = state.layout.mode;
  document.body.classList.toggle('free', mode === 'free');
  for (const b of $('#layoutSeg').children) b.classList.toggle('on', b.dataset.layout === mode);
  $('#resetFree').hidden = mode !== 'free';
}

function bringToFront(id) {
  const z = state.layout.z.filter((x) => x !== id);
  z.push(id);
  state.layout.z = z;
}

/* Yapışma: kenar, alan sınırı ve diğer kutuların kenarlarına SNAP_PX yakınlıkta yapışır */
function snapValue(v, candidates) {
  let best = v;
  let dist = SNAP_PX + 1;
  for (const c of candidates) {
    const d = Math.abs(c - v);
    if (d < dist) { dist = d; best = c; }
  }
  return best;
}

function otherRects(id) {
  return animIds().filter((x) => x !== id).map((x) => state.tiles.get(x)).filter(Boolean).map((t) => readRect(t.el));
}

function startDrag(e, tile) {
  if (state.layout.mode !== 'free' || e.button !== 0 || e.target.closest('button')) return;
  e.preventDefault();
  const area = gridArea();
  const start = readRect(tile.el);
  const sx = e.clientX, sy = e.clientY;
  const others = otherRects(tile.id);
  bringToFront(tile.id);
  applyLayout(false);
  document.body.classList.add('dragging');
  const head = e.currentTarget;
  head.setPointerCapture(e.pointerId);

  const move = (ev) => {
    let x = start.x + ev.clientX - sx;
    let y = start.y + ev.clientY - sy;
    x = snapValue(x, [0, area.w - start.w, ...others.flatMap((o) => [o.x, o.x + o.w + GAP, o.x - GAP - start.w, o.x + o.w - start.w])]);
    y = snapValue(y, [0, area.h - start.h, ...others.flatMap((o) => [o.y, o.y + o.h + GAP, o.y - GAP - start.h, o.y + o.h - start.h])]);
    setRect(tile.el, clampRect({ x, y, w: start.w, h: start.h }, area));
  };
  const up = () => {
    head.removeEventListener('pointermove', move);
    head.removeEventListener('pointerup', up);
    head.removeEventListener('pointercancel', up);
    document.body.classList.remove('dragging');
    state.layout.free[tile.id] = toFraction(readRect(tile.el), area);
    saveLayout();
  };
  head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', up);
  head.addEventListener('pointercancel', up);
}

function startResize(e, tile) {
  if (state.layout.mode !== 'free' || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const area = gridArea();
  const start = readRect(tile.el);
  const sx = e.clientX, sy = e.clientY;
  const others = otherRects(tile.id);
  bringToFront(tile.id);
  applyLayout(false);
  document.body.classList.add('resizing');
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);

  const move = (ev) => {
    let right = start.x + start.w + ev.clientX - sx;
    let bottom = start.y + start.h + ev.clientY - sy;
    right = snapValue(right, [area.w, ...others.flatMap((o) => [o.x - GAP, o.x + o.w])]);
    bottom = snapValue(bottom, [area.h, ...others.flatMap((o) => [o.y - GAP, o.y + o.h])]);
    const w = Math.min(Math.max(right - start.x, MIN_W), area.w - start.x);
    const h = Math.min(Math.max(bottom - start.y, MIN_H), area.h - start.y);
    setRect(tile.el, { x: start.x, y: start.y, w, h });
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    document.body.classList.remove('resizing');
    state.layout.free[tile.id] = toFraction(readRect(tile.el), area);
    saveLayout();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

function initLayout() {
  $('#layoutSeg').addEventListener('click', (e) => {
    const mode = e.target?.dataset?.layout;
    if (mode) setLayoutMode(mode);
  });
  $('#resetFree').addEventListener('click', resetFreeLayout);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.layout.focus && !e.target.closest('input, select')) {
      state.layout.focus = null;
      saveLayout();
      applyLayout(true);
    }
  });
  new ResizeObserver(() => applyLayout(false)).observe($('#grid'));
  syncLayoutControls();
}
