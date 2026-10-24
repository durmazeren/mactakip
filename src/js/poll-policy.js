'use strict';

// Focus stays responsive; background matches share the remaining request budget.
const SofaPollPolicy = {
  interval({ event, animationOnly, anim, focused, hasTargets, liveCount, now }) {
    if (animationOnly) return 120_000;
    if (!event) return 30_000;
    if (event.status?.type === 'notstarted') {
      const until = event.startTimestamp * 1000 - now;
      return until > 15 * 60_000 ? 300_000 : until > 2 * 60_000 ? 60_000 : 30_000;
    }
    if (focused) return 10_000;
    if (anim) return 20_000;
    if (hasTargets) return 30_000;
    return Math.max(60_000, liveCount * 4_000);
  },
  priority({ focused, anim, hasTargets }) {
    return focused ? 0 : anim ? 1 : hasTargets ? 2 : 3;
  },
};
