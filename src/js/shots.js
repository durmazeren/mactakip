'use strict';

/* Şut ekranı: maç başına bir kart. Kartlar bir kez oluşturulur, her güncellemede
 * sadece değerler değişir (açık hedef formu ve yazılan değer kaybolmasın diye). */

const shotCards = new Map(); // id -> { el, refs... }
const CARD_STATS = [['shots', 'Şut', 'Toplam şut'], ['sot', 'İsabetli', 'İsabetli şut'], ['corners', 'Korner', 'Korner']];

// Kartta hangi istatistiklerin görüneceği (⚙ ayarı)
const cardStatsVisible = () => state.cardStats;

// Tek satırlık karşılaştırma: 19 ▬▬▬ Şut ▬▬▬ 16
function cmpRow(label) {
  const root = el('div', 'cmp');
  const h = el('span', 'val home');
  const a = el('span', 'val away');
  const hb = el('div', 'bar home');
  const ab = el('div', 'bar away');
  const hi = el('i');
  const ai = el('i');
  hb.append(hi);
  ab.append(ai);
  root.append(h, hb, el('span', 'label', label), ab, a);
  return { root, h, a, hb, ab, hi, ai };
}

function ensureCard(id) {
  if (shotCards.has(id)) return shotCards.get(id);
  const card = el('div', 'shot-card');
  const top = el('div', 'sc-top');
  const title = el('div', 'sc-title');
  const homeN = el('span', 'home');
  const score = el('b', 'sc-score');
  const awayN = el('span', 'away');
  title.append(homeN, score, awayN);
  const meta = el('div', 'sc-meta');
  const targetBtn = el('button', 'sc-target-btn', '+ Hedef');
  targetBtn.title = 'Kupon hedefi ekle';
  targetBtn.addEventListener('click', () => {
    if (openForm?.matchId === id) closeTargetForm(); else openTargetForm(id);
  });
  const animBtn = el('button', 'icon-btn');
  animBtn.addEventListener('click', () => setAnim(id, !findMatch(id)?.anim));
  const rm = el('button', 'icon-btn', '✕');
  rm.title = 'Maçı kaldır';
  rm.addEventListener('click', () => removeMatch(id));
  top.append(title, meta, targetBtn, animBtn, rm);

  const statsBox = el('div', 'sc-stats');
  const rows = {};
  for (const [key, label, full] of CARD_STATS) {
    rows[key] = cmpRow(label);
    rows[key].root.title = full;
    statsBox.append(rows[key].root);
  }
  const none = el('div', 'sc-none', 'Sofascore bu maç için istatistik tutmuyor');
  const targets = el('div', 'targets');
  const formHost = el('div');

  card.append(top, statsBox, none, targets, formHost, el('div', 'alert-badge'));
  $('#shotList').append(card);
  const ref = { el: card, title, homeN, score, awayN, meta, targetBtn, animBtn, statsBox, rows, none, targets, formHost };
  shotCards.set(id, ref);
  return ref;
}

function setCmp(row, id, key, val) {
  const [h, a] = val || [null, null];
  row.h.textContent = h ?? '–';
  row.a.textContent = a ?? '–';
  const max = Math.max(h || 0, a || 0);
  row.hi.style.width = max ? `${((h || 0) / max) * 100}%` : '0%';
  row.ai.style.width = max ? `${((a || 0) / max) * 100}%` : '0%';
  const homeLead = val && h >= a && h > 0;
  const awayLead = val && a >= h && a > 0;
  for (const [node, lead] of [[row.h, homeLead], [row.hb, homeLead], [row.a, awayLead], [row.ab, awayLead]]) {
    node.classList.toggle('lead', !!lead);
  }
  // Değer değiştiyse yanıp sönsün
  for (const [side, node, v] of [['h', row.h, h], ['a', row.a, a]]) {
    const k = `${id}|${state.period}|${key}|${side}`;
    const prev = state.lastShown.get(k);
    if (v != null && prev != null && v !== prev) restartClass(node, 'flash');
    if (v != null) state.lastShown.set(k, v);
  }
}

function updateCard(id) {
  const ev = state.events.get(id);
  const m = findMatch(id);
  if (!ev || !m) return;
  const c = ensureCard(id);
  c.el.classList.toggle('shot-only', !m.anim);
  c.homeN.textContent = teamName(ev.homeTeam);
  c.awayN.textContent = teamName(ev.awayTeam);
  c.score.textContent = scoreText(ev);
  c.title.title = `${ev.homeTeam?.name} – ${ev.awayTeam?.name}`;
  c.meta.textContent = minuteText(ev);
  c.meta.classList.toggle('live', isLive(ev));
  c.targetBtn.classList.toggle('on', openForm?.matchId === id);
  c.animBtn.textContent = m.anim ? '▶' : '▷';
  c.animBtn.classList.toggle('on', m.anim);
  c.animBtn.title = m.anim ? 'Animasyonu kapat (sadece şut ekranında kalsın)' : 'Animasyonu aç';

  const all = state.stats.get(id);
  const none = !!all?.none;
  const visible = cardStatsVisible();
  c.statsBox.hidden = none || !visible.length;
  c.none.hidden = !none;
  if (!none) {
    const st = all?.[state.period];
    for (const [key] of CARD_STATS) {
      c.rows[key].root.hidden = !visible.includes(key);
      setCmp(c.rows[key], id, key, st?.[key]);
    }
  }
  renderTargets(id, c.targets);
}

function renderShotList() {
  const list = $('#shotList');
  const ids = new Set(state.matches.map((m) => m.id));
  for (const [id, c] of shotCards) {
    if (!ids.has(id)) {
      if (openForm?.matchId === id) closeTargetForm();
      c.el.remove();
      shotCards.delete(id);
    }
  }
  state.matches.forEach((m, i) => {
    if (!state.events.has(m.id)) return;
    const c = ensureCard(m.id);
    c.el.style.order = i;
    updateCard(m.id);
  });

  let empty = $('.sc-empty', list);
  if (!state.matches.length) {
    if (!empty) {
      empty = el('div', 'sc-empty', 'Seçtiğin maçların şut, isabetli şut ve korner sayıları burada görünür. Sadece buraya maç eklemek için "+ Maç ekle".');
      list.append(empty);
    }
  } else if (empty) {
    empty.remove();
  }
  renderCouponBar();
}

/* ⚙ Kart ayarı: hangi istatistikler görünsün */
function initCardSettings() {
  const btn = $('#cardCfgBtn');
  const pop = $('#cardCfg');
  for (const [key, , full] of CARD_STATS) {
    const label = el('label', 'cfg-row');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = state.cardStats.includes(key);
    box.addEventListener('change', () => {
      state.cardStats = CARD_STATS.map(([k]) => k)
        .filter((k) => (k === key ? box.checked : state.cardStats.includes(k)));
      save('cardStats', state.cardStats);
      renderShotList();
    });
    label.append(box, el('span', null, full));
    pop.append(label);
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
  });
}
