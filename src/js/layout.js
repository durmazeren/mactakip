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

/* Izgara dizilimi:
 *  auto: animasyonları en büyük gösteren düzen
 *  row:  yan yana (satır başına en fazla 4 maç)
 *  col:  alt alta (sütun başına en fazla 4 maç) */
function gridFor(n, W, H, arrange) {
  if (!n) return null;
  if (arrange !== 'row' && arrange !== 'col') return bestGrid(n, W, H);
  let c, r;
  if (arrange === 'row') { r = Math.ceil(n / 4); c = Math.ceil(n / r); }
  else { c = Math.ceil(n / 4); r = Math.ceil(n / c); }
  const tw = (W - (c - 1) * GAP) / c;
  const th = (H - (r - 1) * GAP) / r;
  return { c, r, tw, th, s: contentScale(tw, th) };
}

function placeGrid(ids, area, arrange = 'auto') {
  const rects = {};
  const g = gridFor(ids.length, area.w, area.h, arrange);
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
    const base = placeGrid(ids, area, state.layout.arrange);
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
  else rects = placeGrid(ids, area, lay.arrange);

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
    const base = placeGrid(animIds(), area, state.layout.arrange);
    for (const id of animIds()) {
      if (!state.layout.free[id]) state.layout.free[id] = toFraction(base[id], area);
    }
  }
  state.layout.mode = mode;
  saveLayout();
  syncLayoutControls();
  applyLayout(true);
}

function setArrange(arrange) {
  state.layout.arrange = arrange;
  state.layout.focus = null;
  saveLayout();
  syncLayoutControls();
  applyLayout(true);
}

function resetFreeLayout() {
  const area = gridArea();
  const base = placeGrid(animIds(), area, state.layout.arrange);
  state.layout.free = {};
  for (const id of animIds()) state.layout.free[id] = toFraction(base[id], area);
  saveLayout();
  applyLayout(true);
}

function syncLayoutControls() {
  const mode = state.layout.mode;
  document.body.classList.toggle('free', mode === 'free');
  for (const b of $('#layoutSeg').children) b.classList.toggle('on', b.dataset.layout === mode);
  for (const b of $('#arrangeSeg').children) b.classList.toggle('on', b.dataset.arrange === (state.layout.arrange || 'auto'));
  $('#arrangeSeg').hidden = mode !== 'grid';
  $('#resetFree').hidden = mode !== 'free';
}

function bringToFront(id) {
  const z = state.layout.z.filter((x) => x !== id);
  z.push(id);
  state.layout.z = z;
}

/* Yapışma: alanın kenarları, yarım/üçte bir/çeyrek çizgileri ve diğer kutuların
 * kenarları. Yapışınca o noktada ince bir kılavuz çizgisi görünür. */
const SNAP_FRACTIONS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];

function snapValue(v, candidates) {
  let best = v;
  let dist = SNAP_PX + 1;
  for (const c of candidates) {
    const d = Math.abs(c - v);
    if (d < dist) { dist = d; best = c; }
  }
  return { v: best, hit: dist <= SNAP_PX };
}

// Bir kutunun başlangıç (sol/üst) kenarının yapışabileceği konumlar
function startEdges(size, others, axis) {
  const pos = axis === 'x' ? 'x' : 'y';
  const len = axis === 'x' ? 'w' : 'h';
  return [0, ...SNAP_FRACTIONS.map((f) => f * size + GAP / 2), ...others.flatMap((o) => [o[pos], o[pos] + o[len] + GAP])];
}
// Bitiş (sağ/alt) kenarının yapışabileceği konumlar
function endEdges(size, others, axis) {
  const pos = axis === 'x' ? 'x' : 'y';
  const len = axis === 'x' ? 'w' : 'h';
  return [size, ...SNAP_FRACTIONS.map((f) => f * size - GAP / 2), ...others.flatMap((o) => [o[pos] - GAP, o[pos] + o[len]])];
}

function otherRects(id) {
  return animIds().filter((x) => x !== id).map((x) => state.tiles.get(x)).filter(Boolean).map((t) => readRect(t.el));
}

function showGuides(gx, gy) {
  const v = $('#guideV'), h = $('#guideH');
  v.hidden = gx == null;
  h.hidden = gy == null;
  if (gx != null) v.style.left = `${Math.round(PAD + gx)}px`;
  if (gy != null) h.style.top = `${Math.round(PAD + gy)}px`;
}

// Sürükleme ve boyutlandırma için ortak işaretçi takibi
function trackPointer(e, target, bodyClass, onMove, onEnd) {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.add(bodyClass);
  target.setPointerCapture(e.pointerId);
  const move = (ev) => onMove(ev.clientX - e.clientX, ev.clientY - e.clientY);
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    document.body.classList.remove(bodyClass);
    showGuides(null, null);
    onEnd();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

function saveFreeRect(tile, area) {
  state.layout.free[tile.id] = toFraction(readRect(tile.el), area);
  saveLayout();
}

function startDrag(e, tile) {
  if (state.layout.mode !== 'free' || e.button !== 0 || e.target.closest('button')) return;
  const area = gridArea();
  const s = readRect(tile.el);
  const others = otherRects(tile.id);
  const xs = startEdges(area.w, others, 'x'), xe = endEdges(area.w, others, 'x');
  const ys = startEdges(area.h, others, 'y'), ye = endEdges(area.h, others, 'y');
  bringToFront(tile.id);
  applyLayout(false);

  // Kutunun sol ya da sağ kenarı (üst ya da alt) — hangisi daha yakınsa ona yapışır
  const snapAxis = (pos, len, starts, ends) => {
    const a = snapValue(pos, starts);
    const b = snapValue(pos + len, ends);
    if (b.hit && (!a.hit || Math.abs(b.v - (pos + len)) < Math.abs(a.v - pos))) return { v: b.v - len, guide: b.v };
    if (a.hit) return { v: a.v, guide: a.v };
    return { v: pos, guide: null };
  };

  trackPointer(e, e.currentTarget, 'dragging', (dx, dy) => {
    const x = snapAxis(s.x + dx, s.w, xs, xe);
    const y = snapAxis(s.y + dy, s.h, ys, ye);
    setRect(tile.el, clampRect({ x: x.v, y: y.v, w: s.w, h: s.h }, area));
    showGuides(x.guide, y.guide);
  }, () => saveFreeRect(tile, area));
}

// dir: n, s, e, w, ne, nw, se, sw — hangi kenar(lar)dan boyutlandırıldığı
function startResize(e, tile, dir) {
  if (state.layout.mode !== 'free' || e.button !== 0) return;
  const area = gridArea();
  const s = readRect(tile.el);
  const others = otherRects(tile.id);
  const xs = startEdges(area.w, others, 'x'), xe = endEdges(area.w, others, 'x');
  const ys = startEdges(area.h, others, 'y'), ye = endEdges(area.h, others, 'y');
  bringToFront(tile.id);
  applyLayout(false);
  document.body.style.setProperty('--rz-cursor', getComputedStyle(e.currentTarget).cursor);

  trackPointer(e, e.currentTarget, 'resizing', (dx, dy) => {
    let L = s.x, T = s.y, R = s.x + s.w, B = s.y + s.h;
    let gx = null, gy = null;
    if (dir.includes('w')) {
      const r = snapValue(s.x + dx, xs);
      L = Math.min(Math.max(r.v, 0), R - MIN_W);
      if (r.hit) gx = L;
    }
    if (dir.includes('e')) {
      const r = snapValue(R + dx, xe);
      R = Math.max(Math.min(r.v, area.w), L + MIN_W);
      if (r.hit) gx = R;
    }
    if (dir.includes('n')) {
      const r = snapValue(s.y + dy, ys);
      T = Math.min(Math.max(r.v, 0), B - MIN_H);
      if (r.hit) gy = T;
    }
    if (dir.includes('s')) {
      const r = snapValue(B + dy, ye);
      B = Math.max(Math.min(r.v, area.h), T + MIN_H);
      if (r.hit) gy = B;
    }
    setRect(tile.el, { x: L, y: T, w: R - L, h: B - T });
    showGuides(gx, gy);
  }, () => saveFreeRect(tile, area));
}

function initLayout() {
  $('#layoutSeg').addEventListener('click', (e) => {
    const mode = e.target?.dataset?.layout;
    if (mode) setLayoutMode(mode);
  });
  $('#resetFree').addEventListener('click', resetFreeLayout);
  $('#arrangeSeg').addEventListener('click', (e) => {
    const arrange = e.target?.dataset?.arrange;
    if (arrange) setArrange(arrange);
  });
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
