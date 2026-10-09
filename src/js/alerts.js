'use strict';

/* Şut / isabetli şut / korner / gol uyarıları. */

const ALERT_ORDER = ['goal', 'sot', 'shot', 'corner'];
const ALERT_CLASSES = ['alerting', 'alert-goal', 'alert-sot', 'alert-shot', 'alert-corner'];
const ALERT_MS = 5000;
const GOAL_OVERLAY_MS = 4800;
const GOAL_THEMES = ['emerald', 'blue', 'violet', 'red', 'gold', 'teal'];
const snaps = new Map(); // id -> son durum

function goalTheme(teamId, teamNameText) {
  const id = Number(teamId);
  if (Number.isInteger(id) && id > 0) return GOAL_THEMES[id % GOAL_THEMES.length];
  const hash = [...(teamNameText || '')].reduce((value, char) => value + char.codePointAt(0), 0);
  return GOAL_THEMES[hash % GOAL_THEMES.length];
}

function showGoalOverlay(id, team, teamId, scoringSide, previousScore) {
  const ev = state.events.get(id);
  const homeScore = ev?.homeScore?.current ?? 0;
  const awayScore = ev?.awayScore?.current ?? 0;
  const theme = goalTheme(teamId, team);
  for (const card of [shotCards.get(id)?.el, state.tiles.get(id)?.el]) {
    if (!card) continue;
    const overlay = $('.goal-overlay', card);
    if (!overlay) continue;
    overlay.dataset.theme = theme;
    if (card.classList.contains('tile')) {
      const stage = $('.stage', card);
      stage.classList.add('goal-blur');
      clearTimeout(stage._goalBlurTimer);
      stage._goalBlurTimer = setTimeout(() => stage.classList.remove('goal-blur'), GOAL_OVERLAY_MS);
    } else {
      card.style.setProperty('--ring', getComputedStyle(overlay).getPropertyValue('--goal-mid').trim());
    }
    $('.goal-overlay-team', overlay).textContent = team;

    const score = $('.goal-overlay-score', overlay);
    const home = el('span', `goal-score-value${scoringSide === 'home' && homeScore > (previousScore?.[0] ?? homeScore) ? ' is-scoring' : ''}`, String(homeScore));
    const separator = el('span', 'goal-score-separator', '–');
    const away = el('span', `goal-score-value${scoringSide === 'away' && awayScore > (previousScore?.[1] ?? awayScore) ? ' is-scoring' : ''}`, String(awayScore));
    score.replaceChildren(home, separator, away);
    score.setAttribute('aria-label', `${homeScore} - ${awayScore}`);

    overlay.classList.remove('show');
    void overlay.offsetWidth; // Peş peşe gelen gollerde animasyonu baştan başlat.
    overlay.classList.add('show');
    clearTimeout(overlay._goalTimer);
    overlay._goalTimer = setTimeout(() => overlay.classList.remove('show'), GOAL_OVERLAY_MS);
  }
}

function snapshot(id) {
  const ev = state.events.get(id);
  const all = state.stats.get(id)?.ALL;
  return {
    goal: ev && ev.status?.type !== 'notstarted' ? [ev.homeScore?.current ?? 0, ev.awayScore?.current ?? 0] : null,
    sot: all?.sot || null,
    shot: all?.shots || null,
    corner: all?.corners || null,
  };
}

function checkAlerts(id) {
  const prev = snaps.get(id);
  const cur = snapshot(id);
  snaps.set(id, cur);
  if (!prev) return; // ilk veri: uyarı yok
  for (const kind of ALERT_ORDER) {
    const a = prev[kind], b = cur[kind];
    if (!a || !b) continue;
    if (b[0] > a[0]) return fireAlert(id, kind, 'home', prev[kind]);
    if (b[1] > a[1]) return fireAlert(id, kind, 'away', prev[kind]);
  }
}

function fireAlert(id, kind, side, previousScore) {
  const ev = state.events.get(id);
  const team = side === 'home' ? teamName(ev?.homeTeam) : teamName(ev?.awayTeam);
  const text = {
    goal: `⚽ GOL! ${team}`,
    sot: `İsabetli şut · ${team}`,
    shot: `Şut · ${team}`,
    corner: `Korner · ${team}`,
  }[kind];
  if (kind === 'goal') {
    const scoringTeam = side === 'home' ? ev?.homeTeam : ev?.awayTeam;
    showGoalOverlay(id, team, scoringTeam?.id, side, previousScore);
  }
  for (const node of [state.tiles.get(id)?.el, shotCards.get(id)?.el]) {
    if (!node) continue;
    const badge = $('.alert-badge', node);
    badge.textContent = text;
    badge.className = `alert-badge ${kind}`;
    node.classList.remove(...ALERT_CLASSES);
    void node.offsetWidth; // animasyonu baştan başlat
    node.classList.add('alerting', `alert-${kind}`);
    clearTimeout(node._alertTimer);
    node._alertTimer = setTimeout(() => node.classList.remove(...ALERT_CLASSES), ALERT_MS);
  }
}

function forgetAlerts(id) { snaps.delete(id); }
