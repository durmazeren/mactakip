'use strict';

/* Şut / isabetli şut / korner / gol olunca maçın kutusunda ve şut kartında
 * kısa bir renk halkası ve rozet gösterir. Ses yok. */

const ALERT_ORDER = ['goal', 'sot', 'shot', 'corner'];
const ALERT_CLASSES = ['alerting', 'alert-goal', 'alert-sot', 'alert-shot', 'alert-corner'];
const ALERT_MS = 5000;
const snaps = new Map(); // id -> son durum

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
    if (b[0] > a[0]) return fireAlert(id, kind, 'home');
    if (b[1] > a[1]) return fireAlert(id, kind, 'away');
  }
}

function fireAlert(id, kind, side) {
  const ev = state.events.get(id);
  const team = side === 'home' ? teamName(ev?.homeTeam) : teamName(ev?.awayTeam);
  const text = {
    goal: `⚽ GOL! ${team}`,
    sot: `İsabetli şut · ${team}`,
    shot: `Şut · ${team}`,
    corner: `Korner · ${team}`,
  }[kind];
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
