'use strict';

/* Deterministic multi-match snapshot replay for regression and scenario analysis. */
(function attachReplayEngine(root, factory) {
  const analysisEngine = typeof module === 'object' && module.exports
    ? require('./analysis-engine.js') : root.AnalysisEngine;
  const liveState = typeof module === 'object' && module.exports
    ? require('./analysis-state.js') : root.LiveAnalysisState;
  const engine = factory(analysisEngine, liveState);
  root.LiveAnalysisReplay = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
}(globalThis, (analysisEngine, liveState) => {
  function continuityFrame(frame, matchKey) {
    const data = frame.data || {};
    return frame.continuity || {
      identity: data.eventIdentity ?? frame.eventIdentity ?? matchKey,
      phase: data.phase,
      minute: data.minute,
      score: data.score,
      stats: frame.stats || data.cumulativeStats || {
        xg: data.cumulativeXg,
        shots: data.cumulativeShots,
        sot: data.cumulativeSot,
        corners: data.cumulativeCorners,
      },
    };
  }

  function replayFrames(frames, {
    lines = { matchTotal: 2.5, firstHalfTotal: 1.5 }, confirmations = 2,
  } = {}) {
    if (!Array.isArray(frames) || !Number.isInteger(confirmations) || confirmations < 1) {
      throw new TypeError('Replay requires a frame array and a positive confirmation count.');
    }
    const matches = new Map();
    const emissions = [];
    const resets = {};
    let ignoredOutOfOrder = 0;

    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      if (!frame || !Number.isFinite(frame.at) || !frame.data || frame.data.status !== 'ready') continue;
      const matchKey = String(frame.matchId ?? frame.id ?? '');
      if (!matchKey) continue;
      const previous = matches.get(matchKey);
      if (previous && frame.at <= previous.at) {
        ignoredOutOfOrder++;
        continue;
      }
      const continuity = continuityFrame(frame, matchKey);
      const reset = liveState.resetReason(previous?.continuity, continuity);
      const counts = reset ? new Map() : new Map(previous?.counts || []);
      if (reset) resets[reset] = (resets[reset] || 0) + 1;

      const data = { ...frame.data, analysisNowMs: frame.at };
      const candidates = analysisEngine.makeAnalysisCandidates(data, lines);
      const active = new Set(candidates.map((candidate) => candidate.key));
      for (const candidate of candidates) {
        const previousCount = counts.get(candidate.key) || 0;
        const count = Math.min(confirmations, (counts.get(candidate.key) || 0) + 1);
        counts.set(candidate.key, count);
        if (count >= confirmations && previousCount < confirmations) emissions.push({
          matchId: matchKey, at: frame.at, frameIndex: index, candidate,
        });
      }
      for (const key of counts.keys()) if (!active.has(key)) counts.set(key, 0);
      matches.set(matchKey, { at: frame.at, continuity, counts });
    }

    const byMatch = {};
    for (const item of emissions) byMatch[item.matchId] = (byMatch[item.matchId] || 0) + 1;
    return {
      emissions,
      summary: {
        frames: frames.length, matches: matches.size, emissions: emissions.length,
        resets, ignoredOutOfOrder, byMatch,
      },
    };
  }

  return { replayFrames };
}));
