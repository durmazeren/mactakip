'use strict';

/* Kupon takibi.
 * Takım hedefi: maç + taraf + istatistik (şut / isabetli / korner) + periyot + üst/alt + barem.
 * Oyuncu hedefi: maç + oyuncu + istatistik (şut / isabetli) + üst/alt + barem (maç sonu).
 * Üst: değer baremi geçtiği an tuttu (yeşil), sayaç artmaya devam eder.
 * Alt: değer baremi geçtiği an yattı; periyot bitince altta kaldıysa tuttu.
 * Oyuncu oyundan çıkarsa (değişiklik / kırmızı kart) hedefi o an kapanır. */

const TARGET_STATS = { shots: 'şut', sot: 'isabetli şut', corners: 'korner' };
const TARGET_PERIODS = { ALL: 'Maç', '1ST': '1. yarı', '2ND': '2. yarı' };
const TARGET_STATE_TEXT = {
  won: 'Tuttu ✓', lost: 'Yattı ✗', push: 'İade', live: 'Devam', wait: 'Başlamadı', nodata: 'Veri yok',
};

const isPlayerTarget = (t) => t.kind === 'player';

function sideName(t) {
  const ev = state.events.get(t.matchId);
  if (t.side === 'home') return teamName(ev?.homeTeam);
  if (t.side === 'away') return teamName(ev?.awayTeam);
  return 'Toplam';
}

function targetLabel(t) {
  const dir = t.dir === 'over' ? 'Üst' : 'Alt';
  if (isPlayerTarget(t)) return `${t.playerName} ${TARGET_STATS[t.stat]} ${t.line} ${dir}`;
  const period = t.period !== 'ALL' ? ` (${TARGET_PERIODS[t.period]})` : '';
  return `${sideName(t)} ${TARGET_STATS[t.stat]} ${t.line} ${dir}${period}`;
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

function teamValue(t) {
  const st = state.stats.get(t.matchId);
  if (!st) return undefined;
  if (st.none) return null;
  const p = st[t.period];
  if (!p) return 0; // periyot henüz başlamadı
  const pair = p[t.stat];
  if (!pair) return null;
  if (t.side === 'home') return pair[0];
  if (t.side === 'away') return pair[1];
  if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return null;
  return pair[0] + pair[1];
}

function evalTarget(t) {
  const ev = state.events.get(t.matchId);
  if (ev?.status?.type === 'notstarted') return { status: 'wait', v: 0, pct: 0, text: '0' };
  const player = isPlayerTarget(t);
  const v = player ? playerValue(t) : teamValue(t);
  if (v === undefined) return { status: 'wait', v: 0, pct: 0, text: '–' };
  if (v === null) return { status: 'nodata', v: null, pct: 0, text: '–' };
  // Oyuncu oyundan çıktıysa sayısı artık değişmez
  const over = periodOver(ev, player ? 'ALL' : t.period) || (player && playerIsOut(t));

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
  players.delete(matchId);
  saveTargets();
}

function targetRow(t, sub) {
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
  row.append(label, el('span', 't-count', r.text), el('span', 't-state', TARGET_STATE_TEXT[r.status]), del);
  if (sub) row.append(el('span', 't-sub', sub));
  row.append(bar);
  return row;
}

// Maç kartının altındaki takım hedefleri
function renderTargets(matchId, box) {
  const list = state.targets.filter((t) => t.matchId === matchId && !isPlayerTarget(t));
  box.hidden = !list.length;
  box.replaceChildren(...list.map((t) => targetRow(t)));
}

// Şut ekranının en altında: tüm açık maçların oyuncu hedefleri
function renderPlayerTargets() {
  let host = $('#playerTargets');
  if (!host) {
    host = el('div', 'player-targets');
    host.id = 'playerTargets';
    host.style.order = '100000';
    $('#shotList').append(host);
  }
  const list = state.targets.filter((t) => isPlayerTarget(t) && findMatch(t.matchId));
  host.hidden = !list.length;
  if (!list.length) return;
  host.replaceChildren(el('div', 'pt-title', 'Oyuncu hedefleri'));
  for (const t of list) {
    const ev = state.events.get(t.matchId);
    const match = ev ? `${teamName(ev.homeTeam)} – ${teamName(ev.awayTeam)}` : '';
    const minute = ev ? minuteText(ev) : '';
    host.append(targetRow(t, [match, minute, playerStatusText(t)].filter(Boolean).join(' · ')));
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

/* Hedef ekleme formu: maç kartının başlığındaki "+ Hedef" ile açılır */
let openForm = null; // { matchId, node }

function closeTargetForm() {
  if (!openForm) return;
  openForm.node.remove();
  const card = shotCards.get(openForm.matchId);
  if (card) card.targetBtn.classList.remove('on');
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
    if (value != null) s.value = value;
    return s;
  };

  const kindSel = select([['team', 'Takım'], ['player', 'Oyuncu']], 'team');
  const matchSel = select(state.matches.map((m) => {
    const ev = state.events.get(m.id);
    return [String(m.id), ev ? `${teamName(ev.homeTeam)} – ${teamName(ev.awayTeam)}` : `#${m.id}`];
  }), String(matchId));
  const sideSel = select([['home', ''], ['away', ''], ['total', 'Toplam (iki takım)']], 'home');
  const playerSel = el('select');
  const statSel = select([['shots', 'Toplam şut'], ['sot', 'İsabetli şut'], ['corners', 'Korner']], 'sot');
  const periodSel = select([['ALL', 'Maç sonu'], ['1ST', '1. yarı'], ['2ND', '2. yarı']], 'ALL');
  const dirSel = select([['over', 'Üst'], ['under', 'Alt']], 'over');
  const lineIn = el('input');
  Object.assign(lineIn, { type: 'number', step: '0.5', min: '0', value: '4.5' });
  const preview = el('div', 'preview');

  const sideField = field('Taraf', sideSel);
  const playerField = field('Oyuncu', playerSel, true);
  const periodField = field('Periyot', periodSel);

  // Kadroyu oyuncu seçimine doldur (ilk 11 ve yedekler, takım takım)
  let playersFor = null;
  const fillPlayers = async () => {
    const mid = Number(matchSel.value);
    if (playersFor === mid) return;
    playersFor = mid;
    playerSel.replaceChildren(el('option', null, 'Kadro yükleniyor…'));
    playerSel.disabled = true;
    const rec = players.get(mid) || await loadPlayers(mid);
    if (playersFor !== mid) return;
    playerSel.replaceChildren();
    if (!rec?.available || !rec.list.length) {
      playerSel.append(el('option', null, 'Kadro henüz açıklanmadı'));
      sync();
      return;
    }
    const ev = state.events.get(mid);
    for (const side of ['home', 'away']) {
      const team = teamName(side === 'home' ? ev?.homeTeam : ev?.awayTeam);
      for (const starter of [true, false]) {
        const ps = rec.list.filter((p) => p.side === side && p.starter === starter);
        if (!ps.length) continue;
        const g = el('optgroup');
        g.label = `${team} · ${starter ? 'İlk 11' : 'Yedekler'}`;
        for (const p of ps) {
          const o = el('option', null, `${p.num ? `#${p.num} ` : ''}${p.name}`);
          o.value = String(p.id);
          g.append(o);
        }
        playerSel.append(g);
      }
    }
    playerSel.disabled = false;
    sync();
  };

  const currentPlayer = () => {
    const rec = players.get(Number(matchSel.value));
    return rec?.list.find((p) => String(p.id) === playerSel.value);
  };

  const build = () => {
    const line = parseFloat(lineIn.value);
    const base = { matchId: Number(matchSel.value), stat: statSel.value, dir: dirSel.value, line };
    if (kindSel.value === 'player') {
      const p = currentPlayer();
      if (!p) return null;
      return { ...base, kind: 'player', playerId: p.id, playerName: p.name, side: p.side, period: 'ALL' };
    }
    return { ...base, kind: 'team', side: sideSel.value, period: periodSel.value };
  };

  const sync = () => {
    const player = kindSel.value === 'player';
    sideField.hidden = player;
    periodField.hidden = player;
    playerField.hidden = !player;
    statSel.options[2].hidden = player; // oyuncu için korner yok
    if (player && statSel.value === 'corners') statSel.value = 'sot';
    if (player) fillPlayers();

    const ev = state.events.get(Number(matchSel.value));
    sideSel.options[0].textContent = `Ev: ${teamName(ev?.homeTeam)}`;
    sideSel.options[1].textContent = `Dep: ${teamName(ev?.awayTeam)}`;
    const line = parseFloat(lineIn.value);
    if (!Number.isFinite(line) || line < 0) { preview.textContent = 'Geçerli bir barem gir (ör. 4.5)'; return; }
    const t = build();
    if (!t) { preview.textContent = 'Oyuncu seç'; return; }
    preview.textContent = t.dir === 'over'
      ? `${targetLabel(t)} → en az ${Math.floor(line) + 1} gerekli`
      : `${targetLabel(t)} → en fazla ${Math.ceil(line) - 1} olmalı`;
  };
  matchSel.addEventListener('change', () => { playersFor = null; sync(); });
  kindSel.addEventListener('change', () => {
    // Oyuncu barem varsayılanı daha düşük olur
    if (kindSel.value === 'player' && lineIn.value === '4.5') lineIn.value = '0.5';
    if (kindSel.value === 'team' && lineIn.value === '0.5') lineIn.value = '4.5';
    sync();
  });
  for (const c of [sideSel, playerSel, statSel, periodSel, dirSel]) c.addEventListener('change', sync);
  lineIn.addEventListener('input', sync);

  const cancel = el('button', 'btn btn-sm', 'İptal');
  cancel.type = 'button';
  cancel.addEventListener('click', closeTargetForm);
  const ok = el('button', 'btn btn-primary btn-sm', 'Ekle');
  ok.type = 'submit';
  const actions = el('div', 'actions');
  actions.append(cancel, ok);

  form.append(
    field('Tür', kindSel),
    field('Maç', matchSel),
    sideField,
    playerField,
    field('İstatistik', statSel),
    periodField,
    field('Üst / Alt', dirSel),
    field('Barem', lineIn, true),
    preview,
    actions,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = parseFloat(lineIn.value);
    if (!Number.isFinite(line) || line < 0) { lineIn.focus(); return; }
    const t = build();
    if (!t) { playerSel.focus(); return; }
    addTarget({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...t });
    closeTargetForm();
  });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTargetForm(); });

  sync();
  card.formHost.append(form);
  card.targetBtn.classList.add('on');
  openForm = { matchId, node: form };
  lineIn.focus();
  lineIn.select();
}
