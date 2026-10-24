'use strict';

/* Şut ekranı: maç başına bir kart. Kartlar bir kez oluşturulur, her güncellemede
 * sadece değerler değişir (açık hedef formu ve yazılan değer kaybolmasın diye). */

const shotCards = new Map(); // id -> { el, refs... }

const formatCardStat = (value, metric) => value == null ? '–'
  : metric.format === 'decimal' ? value.toFixed(2)
    : metric.format === 'percent' ? `${Math.round(value)}%` : String(value);

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

/* Takım adları dar kartta kısaltılmadan sığsın: önce yazı küçülür, yine sığmazsa
 * takımın kısa kodu (ör. FEN) yazılır. Ad, skor veya kart genişliği değişince yeniden ölçülür. */
const NAME_SIZES = { title: [14, 13, 12, 11], board: [15, 14, 13, 12, 11] };

function fitNames(box, nodes, names, sizes) {
  if (!box.isConnected || !box.clientWidth) return;
  // Basketbol panelinde ad iki satıra kırılabilir: yükseklik taşması da sayılır
  const overflow = () => nodes.some((n) => n.scrollWidth > n.clientWidth + 0.5 || n.scrollHeight > n.clientHeight + 1);
  for (const pick of ['short', 'code']) {
    nodes.forEach((n, i) => { n.textContent = names[i][pick]; });
    for (const size of sizes) {
      box.style.fontSize = `${size}px`;
      if (!overflow()) return;
    }
  }
}

const nameForms = (team) => ({ short: teamName(team), code: team?.nameCode || teamName(team) });

function fitCardNames(c) {
  if (!c.names) return;
  if (c.sport === 'basketball') fitNames(c.board, [c.bHomeN, c.bAwayN], c.names, NAME_SIZES.board);
  else fitNames(c.title, [c.homeN, c.awayN], c.names, NAME_SIZES.title);
}

const cardResize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
  for (const entry of entries) {
    const c = [...shotCards.values()].find((x) => x.el === entry.target);
    if (c && Math.abs(entry.contentRect.width - (c.fitWidth || 0)) > 1) {
      c.fitWidth = entry.contentRect.width;
      fitCardNames(c);
    }
  }
}) : null;

function ensureCard(id) {
  if (shotCards.has(id)) return shotCards.get(id);
  const card = el('div', 'shot-card');
  const top = el('div', 'sc-top');
  const head = el('div', 'sc-head');
  const title = el('div', 'sc-title');
  title.tabIndex = 0;
  title.setAttribute('role', 'button');
  const homeN = el('span', 'home');
  const score = el('b', 'sc-score');
  const awayN = el('span', 'away');
  const league = el('span', 'sc-league');
  title.append(homeN, score, awayN, league);
  const meta = el('div', 'sc-meta');
  // Kartta normalde yalnız adlar ve skor; düğmeler fareyle üstüne gelince adların üstünde
  // bulanık bir katmanda çıkar (klavyeyle odaklanınca da)
  const actions = el('div', 'sc-actions');
  const targetBtn = el('button', 'icon-btn sc-target-btn', '+');
  targetBtn.title = 'Kupon hedefi ekle';
  targetBtn.setAttribute('aria-label', 'Kupon hedefi ekle');
  targetBtn.addEventListener('click', () => {
    if (openForm?.matchId === id) closeTargetForm(); else openTargetForm(id);
  });
  const animBtn = el('button', 'icon-btn');
  animBtn.addEventListener('click', () => setAnim(id, !findMatch(id)?.anim));
  const rm = el('button', 'icon-btn', '✕');
  rm.title = 'Maçı kaldır';
  rm.addEventListener('click', () => removeMatch(id));
  const resetBtn = el('button', 'icon-btn reset-btn', '↻');
  resetBtn.title = 'Bu maçı yenile (veriyi ve animasyonu baştan yükle)';
  resetBtn.addEventListener('click', () => resetMatch(id));
  actions.append(targetBtn, speakerButton(id), resetBtn, animBtn, rm);
  head.append(title, actions);
  top.append(head, meta);
  // Basketbol: logolar ve skor kartın büyük kısmını kaplar; takım istatistikleri kartta gösterilmez
  const board = el('div', 'sc-board');
  const side = (cls) => {
    const team = el('div', `scb-team ${cls}`);
    const logo = el('img', 'scb-logo');
    logo.alt = '';
    logo.addEventListener('error', () => { logo.hidden = true; });
    const name = el('span', 'scb-name');
    team.append(logo, name);
    return { team, logo, name };
  };
  const bHome = side('home');
  const bAway = side('away');
  const bMid = el('div', 'scb-mid');
  const bScore = el('b', 'scb-score');
  const bClock = el('span', 'scb-clock');
  const bQuarters = el('span', 'scb-quarters');
  bMid.append(bScore, bClock);
  board.append(bHome.team, bMid, bAway.team, bQuarters);
  const statsBox = el('div', 'sc-stats');
  const none = el('div', 'sc-none', 'Sofascore bu maç için istatistik tutmuyor');
  const targets = el('div', 'targets');
  const formHost = el('div', 'sc-form-host');
  const goalOverlay = el('div', 'goal-overlay');
  goalOverlay.setAttribute('role', 'status');
  goalOverlay.setAttribute('aria-live', 'polite');
  goalOverlay.setAttribute('aria-atomic', 'true');
  const goalContent = el('div', 'goal-overlay-content');
  const goalWord = el('div', 'goal-overlay-word', 'GOOOOOOOOOOOOOL');
  const goalScore = el('strong', 'goal-overlay-score');
  goalScore.setAttribute('aria-label', 'Maç skoru');
  goalContent.append(goalWord, el('span', 'goal-overlay-team'), goalScore);
  goalOverlay.append(goalContent);

  card.append(top, board, statsBox, none, targets, formHost, el('div', 'alert-badge'), goalOverlay);
  let lastPointerUp = 0;
  card.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input, select, textarea, a, label, .targets, .sc-form-host, .goal-overlay')) return;
    startCardDrag(event, id, () => { lastPointerUp = performance.now(); });
  });
  card.addEventListener('click', (event) => {
    if (performance.now() - lastPointerUp < 500) return;
    if (event.target.closest('button, input, select, textarea, a, label, .targets, .sc-form-host, .goal-overlay')) return;
    if (state.events.get(id)?._animationOnly) return;
    openStatsModal(id);
  });
  title.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (state.events.get(id)?._animationOnly) return;
    openStatsModal(id);
  });
  $('#shotList').append(card);
  const ref = { el: card, title, homeN, score, awayN, league, meta, targetBtn, animBtn, statsBox, rows: {}, sport: null, none,
    targets, formHost, board, bHomeN: bHome.name, bAwayN: bAway.name, bHomeLogo: bHome.logo, bAwayLogo: bAway.logo,
    bScore, bClock, bQuarters, names: null, fitKey: '' };
  shotCards.set(id, ref);
  cardResize?.observe(card);
  return ref;
}

// Satırlar maçın sporuna göre kurulur (futbol: şut/korner…, basketbol: ribaund/asist…)
function ensureRows(c, sport) {
  if (c.sport === sport) return;
  c.sport = sport;
  c.rows = {};
  c.statsBox.replaceChildren();
  for (const metric of cardMetrics(sport)) {
    c.rows[metric.key] = cmpRow(metric.label);
    c.rows[metric.key].root.title = metric.name;
    c.statsBox.append(c.rows[metric.key].root);
  }
}

function setCmp(row, id, metric, val) {
  const key = metric.key;
  const [h, a] = val || [null, null];
  row.h.textContent = formatCardStat(h, metric);
  row.a.textContent = formatCardStat(a, metric);
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
    if (metric.format !== 'percent' && v != null && prev != null && v > prev) {
      restartClass(side === 'h' ? row.hb : row.ab, 'shot-burst');
    }
    if (v != null) state.lastShown.set(k, v);
  }
}

function updateCard(id) {
  const ev = state.events.get(id);
  const m = findMatch(id);
  if (!m) return;
  const c = ensureCard(id);
  c.el.classList.toggle('shot-only', !m.anim);
  c.targetBtn.disabled = !ev;
  c.animBtn.textContent = m.anim ? '▶' : '▷';
  c.animBtn.classList.toggle('on', m.anim);
  c.animBtn.title = m.anim ? 'Animasyonu kapat (sadece şut ekranında kalsın)' : 'Animasyonu aç';
  if (!ev || ev._animationOnly) {
    c.names = null;
    c.fitKey = '';
    c.title.style.fontSize = '';
    c.el.classList.remove('basket');
    c.league.textContent = '';
  }
  if (!ev) {
    c.el.classList.remove('live');
    c.meta.classList.remove('live');
    c.homeN.textContent = `Maç #${id}`;
    c.title.setAttribute('aria-label', `Maç #${id} istatistiklerini aç`);
    c.awayN.textContent = '';
    c.score.textContent = '';
    c.meta.textContent = 'Yükleniyor';
    c.statsBox.hidden = true;
    c.none.hidden = false;
    c.none.textContent = 'Veri bekleniyor · ↻ ile yeniden dene';
    c.targets.hidden = true;
    return;
  }
  if (ev._animationOnly) {
    c.el.classList.remove('live');
    c.meta.classList.remove('live');
    c.homeN.textContent = `Maç #${id}`;
    c.awayN.textContent = '';
    c.score.textContent = '–';
    c.meta.textContent = 'Yalnız animasyon';
    c.title.title = 'Sofascore skor ve istatistik verisi alınamıyor';
    c.title.setAttribute('aria-label', `Maç #${id}: yalnız animasyon`);
    c.targetBtn.disabled = true;
    c.statsBox.hidden = true;
    c.none.hidden = false;
    c.none.textContent = 'Skor ve istatistikler alınamıyor · ↻ ile yeniden dene';
    c.targets.hidden = true;
    return;
  }
  c.none.textContent = 'Sofascore bu maç için istatistik tutmuyor';
  c.score.textContent = scoreText(ev);
  c.title.title = `${ev.homeTeam?.name} – ${ev.awayTeam?.name} · Tıkla: istatistikler · Basılı tut: sırala`;
  c.title.setAttribute('aria-label', `${ev.homeTeam?.name} – ${ev.awayTeam?.name} istatistiklerini aç`);
  c.meta.textContent = minuteText(ev);
  const live = isLive(ev);
  c.meta.classList.toggle('live', live);
  c.el.classList.toggle('live', live);
  c.targetBtn.classList.toggle('on', openForm?.matchId === id);

  const sport = matchSport(id);
  const basket = sport === 'basketball';
  ensureRows(c, sport);
  c.el.classList.toggle('basket', basket);
  c.league.textContent = basket ? ev.tournament?.uniqueTournament?.name || ev.tournament?.name || '' : '';
  if (basket) renderCardBoard(c, ev);
  c.names = [nameForms(ev.homeTeam), nameForms(ev.awayTeam)];
  const fitKey = [sport, c.names[0].short, c.names[1].short, c.score.textContent, basket ? '' : c.meta.textContent.length].join('|');
  if (fitKey !== c.fitKey) {
    c.fitKey = fitKey;
    c.homeN.textContent = c.bHomeN.textContent = c.names[0].short;
    c.awayN.textContent = c.bAwayN.textContent = c.names[1].short;
    c.title.style.fontSize = '';
    fitCardNames(c);
  }
  const all = state.stats.get(id);
  const none = !!all?.none;
  const visible = new Set(cardStatsFor(sport));
  // Basketbol kartında takım istatistikleri yok: logolar, skor ve süre yeterli
  c.statsBox.hidden = basket || none || !visible.size;
  c.none.hidden = basket || !none;
  if (!none && !basket) {
    const st = all?.[state.period];
    for (const metric of cardMetrics(sport)) {
      const selected = visible.has(metric.key);
      c.rows[metric.key].root.hidden = !selected;
      if (!selected) continue;
      const value = metric.key === 'points' && sport === 'basketball' ? basketPoints(ev, state.period) : st?.[metric.key];
      setCmp(c.rows[metric.key], id, metric, value);
    }
  }
  renderTargets(id, c.targets);
}

// Basketbol kartının skor paneli: logolar, büyük skor, çeyrek + süre, çeyrek skorları
function renderCardBoard(c, ev) {
  for (const [logo, team] of [[c.bHomeLogo, ev.homeTeam], [c.bAwayLogo, ev.awayTeam]]) {
    const src = team?.id ? LOGO_URL(team.id) : null;
    if (src && logo.getAttribute('src') !== src) { logo.hidden = false; logo.src = src; }
    if (!src) logo.hidden = true;
  }
  c.bScore.textContent = scoreText(ev);
  c.bClock.textContent = minuteText(ev);
  c.bClock.classList.toggle('live', isLive(ev));
  const quarters = [];
  for (let n = 1; n <= 9 && ev.homeScore?.[`period${n}`] != null; n++) {
    quarters.push(`${ev.homeScore[`period${n}`]}-${ev.awayScore?.[`period${n}`] ?? 0}`);
  }
  c.bQuarters.textContent = quarters.join('  ');
  c.bQuarters.hidden = !quarters.length;
}

/* Kart sıralaması
 * Elle: kartta basılı tutup sürükle; sıra animasyon ızgarasına da yansır.
 * Otomatik: hedefli canlı maçlar → canlı → başlamamış → biten (bitenler küçülür). */
function cardGroup(id) {
  const ev = state.events.get(id);
  if (isLive(ev)) return state.targets.some((t) => t.matchId === id) ? 0 : 1;
  if (ev?.status?.type === 'notstarted') return 2;
  return 3;
}

function cardOrder() {
  const ids = state.matches.map((m) => m.id);
  if (state.cardSort !== 'auto') return ids;
  return ids.map((id, i) => [id, cardGroup(id), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
}

function applyCardOrder() {
  cardOrder().forEach((id, i) => {
    const c = shotCards.get(id);
    if (c) c.el.style.order = i;
  });
}

function startCardDrag(e, id, onPointerUp) {
  if (e.button !== 0) return;
  const card = shotCards.get(id)?.el;
  if (!card) return;
  e.preventDefault();
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const startX = e.clientX, startY = e.clientY;
  let dragging = false;
  let canceled = false;
  let moved = false;
  const timer = setTimeout(() => {
    if (canceled || !target.isConnected) return;
    dragging = true;
    card.classList.add('card-dragging');
    document.body.classList.add('card-drag');
  }, 280);

  const move = (ev) => {
    const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
    if (!dragging) {
      if (distance > 7) { canceled = true; clearTimeout(timer); }
      return;
    }
    if (distance < 7) return;
    // İmlecin üstündeki kartı bul; ortasının üstündeysek önüne, altındaysak arkasına taşı
    const over = [...shotCards.entries()].find(([oid, c]) => {
      if (oid === id) return false;
      const r = c.el.getBoundingClientRect();
      return ev.clientY >= r.top && ev.clientY <= r.bottom;
    });
    if (!over) return;
    const [oid, oc] = over;
    const r = oc.el.getBoundingClientRect();
    const after = ev.clientY > r.top + r.height / 2;
    const visibleOrder = cardOrder();
    const list = visibleOrder.filter((matchId) => matchId !== id).map(findMatch);
    let idx = list.findIndex((m) => m.id === oid) + (after ? 1 : 0);
    list.splice(idx, 0, findMatch(id));
    if (list.some((m, i) => m.id !== visibleOrder[i])) {
      state.matches = list;
      moved = true;
      if (state.cardSort === 'auto') {
        state.cardSort = 'manual';
        save('cardSort', 'manual');
        const radio = $('#cardCfg input[name="cardSort"][value="manual"]');
        if (radio) radio.checked = true;
        renderShotList();
      } else applyCardOrder();
    }
  };
  const up = (ev) => {
    onPointerUp();
    clearTimeout(timer);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    card.classList.remove('card-dragging');
    document.body.classList.remove('card-drag');
    if (ev.type === 'pointercancel') return;
    if (moved) {
      saveMatches();
      applyLayout(true);
    } else if (!dragging && !canceled) openStatsModal(id);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

function renderShotList() {
  const list = $('#shotList');
  const ids = new Set(state.matches.map((m) => m.id));
  for (const [id, c] of shotCards) {
    if (!ids.has(id)) {
      if (statsModalMatchId === id) closeStatsModal();
      if (openForm?.matchId === id) closeTargetForm();
      c.el.remove();
      shotCards.delete(id);
    }
  }
  for (const m of state.matches) {
    const c = ensureCard(m.id);
    c.el.classList.toggle('collapsed', state.cardSort === 'auto' && isOver(state.events.get(m.id)));
    c.el.classList.toggle('sortable', state.cardSort !== 'auto');
    updateCard(m.id);
  }
  applyCardOrder();
  renderPlayerTargets();

  let empty = $('.sc-empty', list);
  if (!state.matches.length) {
    if (!empty) {
      empty = el('div', 'sc-empty', 'Seçtiğin maçların canlı istatistikleri burada görünür. Gösterilecek verileri ⚙ ile seçebilirsin. Sadece buraya maç eklemek için "+ Maç ekle".');
      list.append(empty);
    }
  } else if (empty) {
    empty.remove();
  }
  renderCouponBar();
}

/* ⚙ Kart ayarı: hangi istatistikler görünsün (futbol ve basketbol ayrı) */
function initCardSettings() {
  const btn = $('#cardCfgBtn');
  const pop = $('#cardCfg');
  const clean = (list, sport) => Array.isArray(list)
    ? cardMetrics(sport).map(({ key }) => key).filter((key) => list.includes(key))
    : [...DEFAULT_CARD_STATS[sport]];
  state.cardStats = clean(state.cardStats, 'football');
  state.basketCardStats = clean(state.basketCardStats, 'basketball');
  let sport = state.matches.length && state.matches.every((m) => isBasket(m.id)) ? 'basketball' : 'football';

  const render = () => {
    pop.replaceChildren();
    const tabs = el('div', 'seg cfg-sport');
    for (const [value, text] of Object.entries(SPORTS)) {
      const b = el('button', value === sport ? 'on' : null, text);
      b.type = 'button';
      b.addEventListener('click', () => { sport = value; render(); });
      tabs.append(b);
    }
    pop.append(tabs);
    const heading = el('div', 'cfg-heading');
    heading.append(el('strong', null, sport === 'basketball' ? 'Basketbol animasyon kutusunun altında (ilk 3)' : 'Futbol kartında göster'));
    const count = el('span', 'cfg-count', `${cardStatsFor(sport).length} seçili`);
    heading.append(count);
    pop.append(heading);
    const reset = el('button', 'cfg-reset', 'Varsayılana dön');
    reset.type = 'button';
    pop.append(reset);
    const boxes = new Map();
    const apply = (selected) => {
      const list = cardMetrics(sport).map(({ key }) => key).filter((key) => selected.has(key));
      if (sport === 'basketball') { state.basketCardStats = list; save('basketCardStats', list); }
      else { state.cardStats = list; save('cardStats', list); }
      for (const [key, box] of boxes) box.checked = selected.has(key);
      count.textContent = `${list.length} seçili`;
      renderShotList();
      if (sport === 'basketball') for (const id of state.tiles.keys()) updateTile(id);
    };
    reset.addEventListener('click', () => apply(new Set(DEFAULT_CARD_STATS[sport])));
    let group = '';
    for (const { key, name, group: metricGroup } of cardMetrics(sport)) {
      if (metricGroup !== group) {
        group = metricGroup;
        pop.append(el('div', 'cfg-group', group));
      }
      const label = el('label', 'cfg-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = cardStatsFor(sport).includes(key);
      boxes.set(key, box);
      box.addEventListener('change', () => {
        const selected = new Set(cardStatsFor(sport));
        if (box.checked) selected.add(key); else selected.delete(key);
        apply(selected);
      });
      label.append(box, el('span', null, name));
      pop.append(label);
    }
    pop.append(el('div', 'cfg-group cfg-sort-heading', 'Sıralama'));
    for (const [value, text] of [['manual', 'Elle (kartı sürükle)'], ['auto', 'Otomatik (canlı ve hedefli üstte)']]) {
      const label = el('label', 'cfg-row');
      const radio = el('input');
      Object.assign(radio, { type: 'radio', name: 'cardSort', value, checked: state.cardSort === value });
      radio.addEventListener('change', () => {
        state.cardSort = value;
        save('cardSort', value);
        renderShotList();
      });
      label.append(radio, el('span', null, text));
      pop.append(label);
    }
  };
  render();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target.isConnected) pop.hidden = true;
  });
}
