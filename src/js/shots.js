'use strict';

/* Şut ekranı: maç başına bir kart. Kartlar bir kez oluşturulur, her güncellemede
 * sadece değerler değişir (açık hedef formu ve yazılan değer kaybolmasın diye). */

const shotCards = new Map(); // id -> { el, refs... }
const CARD_STATS = [['shots', 'Toplam şut'], ['sot', 'İsabetli şut'], ['corners', 'Korner']];

function cmpRow(label) {
  const root = el('div', 'cmp');
  const top = el('div', 'cmp-top');
  const h = el('span', 'val home');
  const a = el('span', 'val away');
  top.append(h, el('span', 'label', label), a);
  const bars = el('div', 'cmp-bars');
  const hb = el('div', 'half home');
  const ab = el('div', 'half away');
  const hi = el('i');
  const ai = el('i');
  hb.append(hi);
  ab.append(ai);
  bars.append(hb, ab);
  root.append(top, bars);
  return { root, h, a, hb, ab, hi, ai };
}

function ensureCard(id) {
  if (shotCards.has(id)) return shotCards.get(id);
  const card = el('div', 'shot-card');
  const top = el('div', 'sc-top');
  const title = el('div', 'sc-title');
  const meta = el('div', 'sc-meta');
  const animBtn = el('button', 'icon-btn');
  animBtn.addEventListener('click', () => setAnim(id, !findMatch(id)?.anim));
  const rm = el('button', 'icon-btn', '✕');
  rm.title = 'Maçı kaldır';
  rm.addEventListener('click', () => removeMatch(id));
  top.append(title, meta, animBtn, rm);

  const teams = el('div', 'sc-teams');
  const homeN = el('span');
  const awayN = el('span');
  teams.append(homeN, awayN);

  const statsBox = el('div');
  const rows = {};
  for (const [key, label] of CARD_STATS) {
    rows[key] = cmpRow(label);
    statsBox.append(rows[key].root);
  }
  const none = el('div', 'sc-none', 'Sofascore bu maç için istatistik tutmuyor');

  const targets = el('div', 'targets');
  const formHost = el('div');
  const addBtn = el('button', 'sc-add', '+ Hedef ekle (kupon)');
  addBtn.addEventListener('click', () => openTargetForm(id));

  card.append(top, teams, statsBox, none, targets, formHost, addBtn, el('div', 'alert-badge'));
  $('#shotList').append(card);
  const ref = { el: card, title, meta, animBtn, homeN, awayN, statsBox, rows, none, targets, formHost, addBtn };
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
  c.title.textContent = `${teamName(ev.homeTeam)} ${scoreText(ev)} ${teamName(ev.awayTeam)}`;
  c.title.title = `${ev.homeTeam?.name} – ${ev.awayTeam?.name}`;
  c.meta.textContent = minuteText(ev);
  c.meta.classList.toggle('live', isLive(ev));
  c.animBtn.textContent = m.anim ? '▶' : '▷';
  c.animBtn.classList.toggle('on', m.anim);
  c.animBtn.title = m.anim ? 'Animasyonu kapat (sadece şut ekranında kalsın)' : 'Animasyonu aç';
  c.homeN.textContent = teamName(ev.homeTeam);
  c.awayN.textContent = teamName(ev.awayTeam);

  const all = state.stats.get(id);
  const none = !!all?.none;
  c.statsBox.hidden = none;
  c.none.hidden = !none;
  if (!none) {
    const st = all?.[state.period];
    for (const [key] of CARD_STATS) setCmp(c.rows[key], id, key, st?.[key]);
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
