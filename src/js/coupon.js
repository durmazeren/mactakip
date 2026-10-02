'use strict';

/* Kupon takibi: maç + istatistik + taraf + periyot + üst/alt + barem.
 * Üst: değer baremi geçtiği an tuttu (yeşil), sayaç artmaya devam eder.
 * Alt: değer baremi geçtiği an yattı; periyot bitince altta kaldıysa tuttu. */

const TARGET_STATS = { shots: 'şut', sot: 'isabetli şut', corners: 'korner' };
const TARGET_PERIODS = { ALL: 'Maç', '1ST': '1. yarı', '2ND': '2. yarı' };
const TARGET_STATE_TEXT = {
  won: 'Tuttu ✓', lost: 'Yattı ✗', push: 'İade', live: 'Devam', wait: 'Başlamadı', nodata: 'Veri yok',
};

function sideName(t) {
  const ev = state.events.get(t.matchId);
  if (t.side === 'home') return teamName(ev?.homeTeam);
  if (t.side === 'away') return teamName(ev?.awayTeam);
  return 'Toplam';
}

function targetLabel(t) {
  const period = t.period !== 'ALL' ? ` (${TARGET_PERIODS[t.period]})` : '';
  return `${sideName(t)} ${TARGET_STATS[t.stat]} ${t.line} ${t.dir === 'over' ? 'Üst' : 'Alt'}${period}`;
}

// Hedefin periyodu bitti mi? (Bahisler normal süreye göre: uzatmalar sayılmaz)
function periodOver(ev, period) {
  const st = ev?.status;
  if (!st) return false;
  if (st.type === 'finished') return true;
  if (st.type !== 'inprogress') return false;
  if (period === '1ST') return st.code !== 6;
  return ![6, 31, 7].includes(st.code); // Maç ve 2. yarı: 90 dakika bitince
}

function targetValue(t) {
  const st = state.stats.get(t.matchId);
  if (!st) return undefined;
  if (st.none) return null;
  const p = st[t.period];
  if (!p) return 0; // periyot henüz başlamadı
  const pair = p[t.stat];
  if (!pair) return null;
  if (t.side === 'home') return pair[0];
  if (t.side === 'away') return pair[1];
  return pair[0] + pair[1];
}

function evalTarget(t) {
  const ev = state.events.get(t.matchId);
  if (ev?.status?.type === 'notstarted') return { status: 'wait', v: 0, pct: 0, text: '0' };
  const v = targetValue(t);
  if (v === undefined) return { status: 'wait', v: 0, pct: 0, text: '–' };
  if (v === null) return { status: 'nodata', v: null, pct: 0, text: '–' };
  const over = periodOver(ev, t.period);

  if (t.dir === 'over') {
    const need = Math.floor(t.line) + 1;
    const status = v > t.line ? 'won' : over ? (v === t.line ? 'push' : 'lost') : 'live';
    return { status, v, pct: Math.min(1, v / need), text: `${v} / ${need}` };
  }
  const max = Math.ceil(t.line) - 1;   // altta kalmak için en fazla
  const status = v > t.line ? 'lost' : over ? (v === t.line ? 'push' : 'won') : 'live';
  return { status, v, pct: Math.min(1, v / (max + 1)), text: `${v} / en fazla ${max}` };
}

function addTarget(t) {
  state.targets.push(t);
  saveTargets();
  renderShotList();
}

function removeTarget(tid) {
  state.targets = state.targets.filter((t) => t.id !== tid);
  state.targetStatus.delete(tid);
  saveTargets();
  renderShotList();
}

function removeTargetsOf(matchId) {
  state.targets = state.targets.filter((t) => t.matchId !== matchId);
  saveTargets();
}

function renderTargets(matchId, box) {
  const list = state.targets.filter((t) => t.matchId === matchId);
  box.hidden = !list.length;
  box.replaceChildren();
  for (const t of list) {
    const r = evalTarget(t);
    const prev = state.targetStatus.get(t.id);
    state.targetStatus.set(t.id, r.status);
    const row = el('div', `target ${r.status}`);
    if (r.status === 'won' && prev && prev !== 'won') row.classList.add('just-won');
    const label = el('span', 't-label', targetLabel(t));
    label.title = label.textContent;
    const del = el('button', 'icon-btn', '✕');
    del.title = 'Hedefi sil';
    del.addEventListener('click', () => removeTarget(t.id));
    const bar = el('div', 't-bar');
    const fill = el('i');
    fill.style.width = `${Math.round(r.pct * 100)}%`;
    bar.append(fill);
    row.append(label, el('span', 't-count', r.text), el('span', 't-state', TARGET_STATE_TEXT[r.status]), del, bar);
    box.append(row);
  }
}

function renderCouponBar() {
  const bar = $('#couponBar');
  const ts = state.targets.filter((t) => findMatch(t.matchId));
  bar.hidden = !ts.length;
  if (!ts.length) return;
  const counts = { won: 0, lost: 0, push: 0, open: 0 };
  for (const t of ts) {
    const s = state.targetStatus.get(t.id) || evalTarget(t).status;
    if (s === 'won') counts.won++;
    else if (s === 'lost') counts.lost++;
    else if (s === 'push') counts.push++;
    else counts.open++;
  }
  bar.replaceChildren(el('span', 'title', 'Kupon'));
  if (counts.lost) bar.append(el('span', 'chip lost', 'Kupon yattı'));
  else if (!counts.open) bar.append(el('span', 'chip won', 'Kupon tuttu ✓'));
  bar.append(el('span', 'chip won', `✓ ${counts.won}/${ts.length}`));
  if (counts.lost) bar.append(el('span', 'chip lost', `✗ ${counts.lost} yattı`));
  if (counts.open) bar.append(el('span', 'chip live', `● ${counts.open} devam`));
  if (counts.push) bar.append(el('span', 'chip', `${counts.push} iade`));
  const clear = el('button', 'icon-btn', 'Temizle');
  clear.style.marginLeft = 'auto';
  clear.title = 'Tüm hedefleri sil';
  clear.addEventListener('click', () => {
    if (!confirm('Kupondaki tüm hedefler silinsin mi?')) return;
    state.targets = [];
    state.targetStatus.clear();
    saveTargets();
    renderShotList();
  });
  bar.append(clear);
}

/* Hedef ekleme formu: maç kartındaki "+ Hedef ekle" ile açılır */
let openForm = null; // { matchId, node }

function closeTargetForm() {
  if (!openForm) return;
  openForm.node.remove();
  const card = shotCards.get(openForm.matchId);
  if (card) card.addBtn.hidden = false;
  openForm = null;
}

function openTargetForm(matchId) {
  closeTargetForm();
  const card = shotCards.get(matchId);
  if (!card) return;

  const form = el('form', 'target-form');
  const field = (label, input, full) => {
    const l = el('label', full ? 'full' : null, label);
    l.append(input);
    return l;
  };
  const select = (opts, value) => {
    const s = el('select');
    for (const [v, text] of opts) {
      const o = el('option', null, text);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    return s;
  };

  const matchSel = select(state.matches.map((m) => {
    const ev = state.events.get(m.id);
    return [String(m.id), ev ? `${teamName(ev.homeTeam)} – ${teamName(ev.awayTeam)}` : `#${m.id}`];
  }), String(matchId));
  const sideSel = select([['home', ''], ['away', ''], ['total', 'Toplam (iki takım)']], 'home');
  const statSel = select([['shots', 'Toplam şut'], ['sot', 'İsabetli şut'], ['corners', 'Korner']], 'sot');
  const periodSel = select([['ALL', 'Maç sonu'], ['1ST', '1. yarı'], ['2ND', '2. yarı']], 'ALL');
  const dirSel = select([['over', 'Üst'], ['under', 'Alt']], 'over');
  const lineIn = el('input');
  Object.assign(lineIn, { type: 'number', step: '0.5', min: '0', value: '4.5' });
  const preview = el('div', 'preview');

  const sync = () => {
    const ev = state.events.get(Number(matchSel.value));
    sideSel.options[0].textContent = `Ev: ${teamName(ev?.homeTeam)}`;
    sideSel.options[1].textContent = `Dep: ${teamName(ev?.awayTeam)}`;
    const line = parseFloat(lineIn.value);
    if (!Number.isFinite(line) || line < 0) { preview.textContent = 'Geçerli bir barem gir (ör. 4.5)'; return; }
    const t = { matchId: Number(matchSel.value), side: sideSel.value, stat: statSel.value, period: periodSel.value, dir: dirSel.value, line };
    preview.textContent = t.dir === 'over'
      ? `${targetLabel(t)} → en az ${Math.floor(line) + 1} gerekli`
      : `${targetLabel(t)} → en fazla ${Math.ceil(line) - 1} olmalı`;
  };
  for (const c of [matchSel, sideSel, statSel, periodSel, dirSel]) c.addEventListener('change', sync);
  lineIn.addEventListener('input', sync);

  const cancel = el('button', 'btn btn-sm', 'İptal');
  cancel.type = 'button';
  cancel.addEventListener('click', closeTargetForm);
  const ok = el('button', 'btn btn-primary btn-sm', 'Ekle');
  ok.type = 'submit';
  const actions = el('div', 'actions');
  actions.append(cancel, ok);

  form.append(
    field('Maç', matchSel, true),
    field('Taraf', sideSel),
    field('İstatistik', statSel),
    field('Periyot', periodSel),
    field('Üst / Alt', dirSel),
    field('Barem', lineIn, true),
    preview,
    actions,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = parseFloat(lineIn.value);
    if (!Number.isFinite(line) || line < 0) { lineIn.focus(); return; }
    addTarget({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      matchId: Number(matchSel.value),
      side: sideSel.value,
      stat: statSel.value,
      period: periodSel.value,
      dir: dirSel.value,
      line,
    });
    closeTargetForm();
  });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTargetForm(); });

  sync();
  card.formHost.append(form);
  card.addBtn.hidden = true;
  openForm = { matchId, node: form };
  lineIn.focus();
  lineIn.select();
}
