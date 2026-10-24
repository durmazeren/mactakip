'use strict';

// One ordinary, visible site visit and one connection check. No CAPTCHA input,
// token extraction, identity change, hidden browser, or repeated retry loop.
function createSessionRecovery({ getState, openSite, probe, now = Date.now, initial = {},
  persist = () => {}, onEvent = () => {}, cooldownMs = 2 * 60_000 }) {
  let lastStartedAt = Number.isFinite(initial.lastStartedAt) ? initial.lastStartedAt : null;
  let armed = initial.armed !== false;
  let phase = 'idle', reason = null, running = null;
  const snapshot = () => ({ phase, reason, lastStartedAt, armed, cooldownMs });
  const emit = (next, why = null) => {
    phase = next; reason = why;
    try { persist({ lastStartedAt, armed }); } catch { /* Keep the in-memory guard. */ }
    try { onEvent(snapshot()); } catch { /* A notice must not break recovery. */ }
  };

  function observe(state) {
    if (state.state === 'connected') {
      armed = true;
      if (!running) emit('idle');
      return running;
    }
    if (state.state !== 'blocked' || state.status !== 403 || running) return running;
    if (!armed) { emit('manual', 'previous_attempt_failed'); return null; }
    if (lastStartedAt !== null && now() - lastStartedAt < cooldownMs) {
      emit('manual', 'cooldown'); return null;
    }
    armed = false;
    lastStartedAt = now();
    emit('opening');
    running = (async () => {
      let visit;
      try {
        visit = await openSite();
        if (!visit?.ready) { emit('manual', visit?.reason || 'page_not_ready'); return; }
        const current = getState();
        if (current.state === 'connected') {
          armed = true; emit('restored', 'already_connected'); visit.finish?.(true); return;
        }
        if (current.status === 429) { emit('manual', 'rate_limit'); return; }
        emit('checking');
        const checked = await probe();
        if (checked.state === 'connected' && !checked.error) {
          armed = true; emit('restored'); visit.finish?.(true);
        } else { armed = false; emit('manual', 'check_denied'); }
      } catch {
        armed = false; emit('manual', 'recovery_error');
      } finally {
        visit?.finish?.(false);
      }
    })().finally(() => { running = null; });
    return running;
  }

  return { observe, snapshot };
}

module.exports = { createSessionRecovery };
