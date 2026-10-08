'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OddsEngine = require('../src/js/odds-engine.js');

const EVENT_ID = '701|home-1|away-2|league-3|1800000000';

function totalMarket({
  updatedAt, line = '2.5', over = 1.8, under = 2.1, marketId = 12,
  providerId = 9, providerName = 'Example Book', eventId = 701, isLive = true,
} = {}) {
  const result = {
    marketId, marketName: 'Total Goals Over/Under ' + line,
    providerId, providerName, eventId, isLive,
    choices: [
      { choiceId: 'over-' + line, name: 'Over ' + line, decimalValue: over },
      { choiceId: 'under-' + line, name: 'Under ' + line, decimalValue: under },
    ],
  };
  if (updatedAt !== undefined) result.lastUpdatedTimestamp = updatedAt;
  return result;
}

function payload(markets, overrides = {}) {
  return { markets, ...overrides };
}

function assess(snapshot, key = 'match-over-2_5', p = 0.62, now, options = {}) {
  return OddsEngine.marketAssessment(snapshot, key, p, now, EVENT_ID, options);
}

test('Sofascore scraper-shaped market/provider/choice payload keeps source and receive timestamps separate', () => {
  const receivedAt = Date.now();
  const sourceAt = receivedAt - 1_800;
  const snapshot = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: Math.floor(sourceAt / 1000), marketId: 124, providerId: 35, providerName: 'North Book' }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: receivedAt });
  const evidence = assess(snapshot, 'match-over-2_5', 0.7, receivedAt);

  assert.equal(evidence.verified, true);
  assert.equal(evidence.identity.marketId, 124);
  assert.equal(evidence.identity.bookmakerId, 35);
  assert.equal(evidence.identity.sourceEventId, 701);
  assert.equal(evidence.identity.selectionId, 'over-2.5');
  assert.equal(evidence.updatedAt, sourceAt - (sourceAt % 1000));
  assert.equal(evidence.observedAt, receivedAt);
  assert.equal(evidence.oddsAgeMs, receivedAt - evidence.updatedAt);
  assert.equal(evidence.identityCompleteness, 'complete');
});

test('live scraper Match goals choiceGroup lines parse without promoting missing source clocks to fresh odds', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(payload([{
    marketId: 9,
    id: 9,
    marketName: 'Match goals',
    marketGroup: 'Match goals',
    marketPeriod: 'Full-time',
    choiceGroup: '2.5',
    isLive: true,
    fid: 202450842,
    suspended: false,
    choices: [
      { name: 'Over', fractionalValue: '4/5', sourceId: 11401 },
      { name: 'Under', fractionalValue: '1/1', sourceId: 11402 },
    ],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });

  assert.ok(snapshot.markets.matchTotals['2.5']);
  assert.equal(snapshot.markets.matchTotals['2.5'].bookQuotes[0].prices.over, 1.8);
  assert.equal(snapshot.markets.matchTotals['2.5'].prices.over, undefined,
    'unverified source prices are retained for diagnostics but excluded from fair prices');
  assert.equal(snapshot.markets.matchTotals['2.5'].sourceTimestampKnown, false);
  assert.equal(OddsEngine.summary(snapshot, now).key, 'unverified');
  assert.equal(assess(snapshot, 'match-over-2_5', 0.7, now).reason, 'source-timestamp-missing');
  assert.equal(assess(snapshot, 'match-over-2_5', 0.7, now).valueEligible, false);
});

test('freshness uses strict live, aging, stale and post-event volatility windows', () => {
  const now = Date.now();
  const get = (age, volatile = false) => assess(
    OddsEngine.parseSnapshot(payload([totalMarket({ updatedAt: now - age })]), {
      eventLive: true, eventIdentity: EVENT_ID, observedAt: now,
    }),
    'match-over-2_5', 0.65, now, { volatile },
  );
  assert.equal(get(4_999).freshnessBand, 'LIVE');
  assert.equal(get(5_001).freshnessBand, 'AGING');
  assert.equal(get(10_000).verified, true);
  assert.equal(get(10_001).reason, 'stale-price');
  assert.equal(get(2_501, true).reason, 'stale-price');
  assert.equal(get(2_500, true).verified, true);
  assert.equal(get(-1).reason, 'future-timestamp');
});

test('best selection price and median no-vig consensus aggregate only matching market semantics', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now, line: '2.5', over: 1.8, under: 2.1, marketId: 12, providerId: 1, providerName: 'Book A' }),
    totalMarket({ updatedAt: now, line: '2.5', over: 2.0, under: 1.9, marketId: 77, providerId: 2, providerName: 'Book B' }),
    totalMarket({ updatedAt: now, line: '3.5', over: 3.1, under: 1.3, marketId: 78, providerId: 2, providerName: 'Book B' }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const evidence = assess(snapshot, 'match-over-2_5', 0.6, now);
  const consensus = snapshot.markets.matchTotals['2.5'].fair.over;

  assert.equal(evidence.verified, true);
  assert.equal(evidence.price, 2.0);
  assert.equal(evidence.bestAvailableBookmaker, 'Book B');
  assert.equal(evidence.marketId, 77);
  assert.equal(evidence.consensusBookCount, 2);
  assert.ok(Math.abs(evidence.fairMarketProbability - consensus) < 1e-12);
  assert.equal(evidence.bookmakerValueEvidence.status, 'uncalibrated-theoretical-only');
  assert.equal(evidence.identity.line, '2.5');
  assert.equal(evidence.identity.selection, 'over');
  assert.equal(assess(snapshot, 'match-over-3_5', 0.6, now).price, 3.1);
});

test('caller supplied identity fields are enforced and absent scraper fields are explicit', () => {
  const now = Date.now();
  const complete = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  assert.equal(assess(complete, 'match-over-2_5', 0.65, now, {
    expectedIdentity: { marketId: 12, bookmakerId: 9, eventId: 701, period: 'match', line: '2.5' },
  }).verified, true);
  assert.equal(assess(complete, 'match-over-2_5', 0.65, now, {
    expectedIdentity: { bookmakerId: 10 },
  }).reason, 'market-identity-mismatch');
  assert.equal(assess(complete, 'match-over-2_5', 0.65, now, {
    expectedIdentity: { selectionId: 'not-the-over-id' },
  }).reason, 'market-identity-mismatch');

  const partial = OddsEngine.parseSnapshot(payload([{
    marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
    choices: [{ name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 2.5', decimalValue: 2.1 }],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const evidence = assess(partial, 'match-over-2_5', 0.65, now);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.identityCompleteness, 'partial');
  assert.ok(evidence.missingIdentityFields.includes('bookmakerId'));
  assert.ok(evidence.missingIdentityFields.includes('marketId'));
  assert.equal(evidence.liveFlagSource, 'parent-event-context');
  assert.equal(evidence.valueEligible, false);
});

test('Sofascore family/period labels and team-name next-goal outcomes map to the active structured event identity', () => {
  const now = Date.now();
  const eventIdentity = JSON.stringify({ providerEventId: '701', homeTeam: { providerId: '11' } });
  const event = {
    id: 701,
    homeTeam: { name: 'Home Athletic', shortName: 'Home Ath', nameCode: 'HAT' },
    awayTeam: { name: 'Away United', shortName: 'Away Utd', nameCode: 'AUT' },
  };
  const snapshot = OddsEngine.parseSnapshot({ markets: [
    {
      id: 91, marketId: 9, marketGroup: 'Match goals', marketName: 'Full time',
      marketPeriod: 'Full-time', choiceGroup: '2.5', eventId: 701, isLive: true,
      choices: [
        { sourceId: 1, name: 'Over', fractionalValue: '4/5' },
        { sourceId: 2, name: 'Under', fractionalValue: '6/5' },
      ],
    },
    {
      id: 92, marketId: 8, marketGroup: 'Next goal', marketName: 'Full time',
      marketPeriod: 'Full-time', eventId: 701, isLive: true,
      choices: [
        { sourceId: 3, name: 'Home Athletic', fractionalValue: '6/5' },
        { sourceId: 4, name: 'No goal', fractionalValue: '5/2' },
        { sourceId: 5, name: 'Away United', fractionalValue: '2/1' },
      ],
    },
  ] }, { eventLive: true, observedAt: now, eventIdentity, event });

  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot.markets.matchTotals), ['2.5']);
  assert.deepEqual(Object.keys(snapshot.markets.nextGoal?.bookQuotes?.[0]?.prices || {}).sort(), ['away', 'home', 'none'],
    JSON.stringify(snapshot.diagnostics));
  assert.equal(snapshot.markets.matchTotals['2.5'].sourceTimestampKnown, false);
  assert.deepEqual(snapshot.markets.nextGoal.bookQuotes[0].selectionIds, { home: 3, none: 4, away: 5 });
  assert.equal(snapshot.diagnostics.completeOutcomePairs, 2);
  assert.equal(snapshot.diagnostics.recognizedKinds.totalGoals, 1);
  assert.equal(snapshot.diagnostics.recognizedKinds.nextGoal, 1);
});

test('structured identity event ID is used to reject odds from a different fixture', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(payload([totalMarket({
    updatedAt: now, eventId: 702,
  })]), {
    eventLive: true,
    eventIdentity: JSON.stringify({ providerEventId: '701' }),
    observedAt: now,
  });
  assert.equal(snapshot.diagnostics.eventMismatches, 1);
  assert.equal(Object.keys(snapshot.markets.matchTotals).length, 0);
});

test('market event IDs are bound to the active event and mismatches cannot supply value', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now, eventId: 999 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const evidence = assess(snapshot, 'match-over-2_5', 0.7, now);
  assert.equal(evidence.reason, 'event-mismatch');
  assert.equal(evidence.valueEligible, false);
});

test('incompatible total-goals outcomes stay partial instead of forming a false two-way market', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(payload([{
    marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
    choices: [{ name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 3.5', decimalValue: 1.3 }],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const evidence = assess(snapshot, 'match-over-2_5', 0.7, now);
  assert.equal(evidence.verified, false);
  assert.equal(evidence.reason, 'market-incomplete');
});

test('quarter lines retain their identity and second-half prices are not mistaken for match totals', () => {
  const now = Date.now();
  const quarter = OddsEngine.parseSnapshot(payload([{
    marketId: 27, marketName: 'Total Goals Over/Under 2.25', updatedAt: now,
    providerId: 5, eventId: 701, isLive: true,
    choices: [
      { name: 'Over 2.25', decimalValue: 1.9 },
      { name: 'Under 2.25', decimalValue: 1.9 },
    ],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  assert.ok(quarter.markets.matchTotals['2.25']);
  const quarterEvidence = assess(quarter, 'match-over-2_25', 0.6, now);
  assert.equal(quarterEvidence.identity.line, '2.25');
  assert.equal(quarterEvidence.settlementModelSupported, false);
  assert.equal(quarterEvidence.valueEligible, false);

  const secondHalf = OddsEngine.parseSnapshot(payload([{
    marketId: 28, marketName: '2nd Half Goals Over/Under 1.5', updatedAt: now,
    providerId: 5, eventId: 701, isLive: true,
    choices: [
      { name: 'Over 1.5', decimalValue: 2.1 },
      { name: 'Under 1.5', decimalValue: 1.7 },
    ],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  assert.equal(secondHalf.markets.matchTotals['1.5'], undefined);
  assert.equal(secondHalf.markets.firstHalfTotals['1.5'], undefined);
});

test('suspended, closed and disappeared markets immediately block retained quotes', () => {
  const now = Date.now();
  const open = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const suspended = OddsEngine.parseSnapshot(payload([{
    marketId: 12, marketName: 'Total Goals Over/Under 2.5', providerId: 9,
    status: 'suspended', lastUpdatedTimestamp: now,
    choices: [{ name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 2.5', decimalValue: 2.1 }],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const blocked = OddsEngine.withMovement(suspended, open, now);
  assert.equal(assess(blocked, 'match-over-2_5', 0.7, now).reason, 'market-closed');

  const other = OddsEngine.parseSnapshot(payload([{
    marketName: 'Both Teams To Score', updatedAt: now,
    choices: [{ name: 'Yes', decimalValue: 1.9 }, { name: 'No', decimalValue: 1.9 }],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const disappeared = OddsEngine.withMovement(other, open, now);
  assert.equal(assess(disappeared, 'match-over-2_5', 0.7, now).reason, 'market-disappeared');

  const emptyFeed = OddsEngine.parseSnapshot({ markets: [] }, {
    eventLive: true, eventIdentity: EVENT_ID, observedAt: now,
  });
  assert.equal(
    assess(OddsEngine.withMovement(emptyFeed, open, now), 'match-over-2_5', 0.7, now).reason,
    'market-disappeared',
  );
});

test('invalid and absent source timestamps are distinct and neither can create value', () => {
  const now = Date.now();
  const missing = OddsEngine.parseSnapshot(payload([{
    marketName: 'Total Goals Over/Under 2.5',
    choices: [{ name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 2.5', decimalValue: 2.1 }],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  assert.equal(assess(missing, 'match-over-2_5', 0.7, now).reason, 'source-timestamp-missing');

  const future = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now + 1_000 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  assert.equal(assess(future, 'match-over-2_5', 0.7, now).reason, 'future-timestamp');

  const oneLegStamped = OddsEngine.parseSnapshot(payload([{
    marketName: 'Total Goals Over/Under 2.5',
    choices: [
      { name: 'Over 2.5', decimalValue: 1.8, updatedAt: now },
      { name: 'Under 2.5', decimalValue: 2.1 },
    ],
  }]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  assert.equal(assess(oneLegStamped, 'match-over-2_5', 0.7, now).reason, 'source-timestamp-missing');
});

test('uncalibrated edge and EV remain theoretical and cannot become an actionable value flag', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now, over: 1.8, under: 2.1, providerId: 1 }),
    totalMarket({ updatedAt: now, over: 2.05, under: 1.8, providerId: 2, marketId: 13 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const evidence = assess(snapshot, 'match-over-2_5', 0.7, now);
  assert.ok(Math.abs(evidence.edge - (0.7 - evidence.fairMarketProbability)) < 1e-12);
  assert.ok(Math.abs(evidence.expectedValue - (0.7 * evidence.bestAvailablePrice - 1)) < 1e-12);
  assert.equal(evidence.theoreticalValue, true);
  assert.equal(evidence.theoreticalValueCandidate, true);
  assert.equal(evidence.quoteEligible, true);
  assert.equal(evidence.calibrated, false);
  assert.equal(evidence.valueEligible, false);
  assert.equal(evidence.bookmakerValueEvidence.status, 'uncalibrated-theoretical-only');
});

test('movement only compares the same bookmaker and market ID observations', () => {
  const firstAt = Date.now();
  const first = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: firstAt, over: 1.8, providerId: 1, marketId: 12 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: firstAt });
  const secondAt = firstAt + 5_000;
  const second = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: secondAt, over: 1.65, providerId: 2, marketId: 22 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: secondAt });
  const changedBook = OddsEngine.withMovement(second, first, secondAt);
  assert.equal(changedBook.markets.matchTotals['2.5'].movement, null);

  const sameBook = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: secondAt, over: 1.65, providerId: 1, marketId: 12 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: secondAt });
  const moved = OddsEngine.withMovement(sameBook, first, secondAt);
  assert.ok(moved.markets.matchTotals['2.5'].movement.over > 0);
});

test('calibration must match exact market and line, be current, and use calibrated probability for eligibility', () => {
  const now = Date.now();
  const rawProbability = 0.61;
  const calibratedProbability = 0.78;
  const intercept = Math.log(calibratedProbability / (1 - calibratedProbability))
    - Math.log(rawProbability / (1 - rawProbability));
  const snapshot = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now, over: 2.4, under: 1.55 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now });
  const calibration = {
    status: 'validated', method: 'platt', modelId: 'goal-v3', version: '2026-09',
    baseModelId: 'live-xg-poisson-total-v1', slope: 1, intercept,
    market: 'total-goals', period: 'match', line: '2.5',
    outcomeCount: 2_000, brierScore: 0.19,
    validatedAt: now - 60_000, expiresAt: now + 60_000,
    probability: calibratedProbability,
  };
  const valid = assess(snapshot, 'match-over-2_5', 0.61, now, {
    modelCalibration: calibration, baseModelId: 'live-xg-poisson-total-v1',
  });
  assert.equal(valid.calibrated, true);
  assert.equal(valid.modelProbability, 0.78);
  assert.equal(valid.valueEligible, true);
  assert.ok(Math.abs(valid.edge - (0.78 - valid.fairMarketProbability)) < 1e-12);
  assert.ok(Math.abs(valid.expectedValue - (0.78 * valid.price - 1)) < 1e-12);

  const wrongLine = assess(snapshot, 'match-over-2_5', 0.61, now, {
    modelCalibration: { ...calibration, line: '3.5' },
  });
  assert.equal(wrongLine.calibrated, false);
  assert.equal(wrongLine.valueEligible, false);
  assert.equal(wrongLine.modelProbability, 0.61);

  const expired = assess(snapshot, 'match-over-2_5', 0.61, now, {
    modelCalibration: { ...calibration, expiresAt: now - 1 },
  });
  assert.equal(expired.valueEligible, false);

  const wrongBaseModel = assess(snapshot, 'match-over-2_5', 0.61, now, {
    modelCalibration: calibration, baseModelId: 'live-xg-hazard-v1',
  });
  assert.equal(wrongBaseModel.calibrated, false);
  assert.equal(wrongBaseModel.valueEligible, false);

  const isotonicBacktestReport = assess(snapshot, 'match-over-2_5', 0.61, now, {
    modelCalibration: { ...calibration, method: 'per-market-isotonic-pava' },
    baseModelId: 'live-xg-poisson-total-v1',
  });
  assert.equal(isotonicBacktestReport.calibrated, false);
  assert.equal(isotonicBacktestReport.valueEligible, false);

  const forgedProbability = assess(snapshot, 'match-over-2_5', rawProbability, now, {
    modelCalibration: { ...calibration, probability: 0.95 },
    baseModelId: 'live-xg-poisson-total-v1',
  });
  assert.equal(forgedProbability.calibrated, false);
  assert.equal(forgedProbability.valueEligible, false);
});

test('next-goal books with incompatible two-way/three-way outcome sets cannot be combined', () => {
  const now = Date.now();
  const threeWay = {
    marketId: 41, marketName: 'Next Team to Score', providerId: 1, providerName: 'A',
    eventId: 701, isLive: true, updatedAt: now,
    choices: [
      { choiceId: 'h1', name: 'Home', decimalValue: 2.2 },
      { choiceId: 'a1', name: 'Away', decimalValue: 2.8 },
      { choiceId: 'n1', name: 'No Goal', decimalValue: 3.0 },
    ],
  };
  const twoWay = {
    marketId: 42, marketName: 'Next Team to Score', providerId: 2, providerName: 'B',
    eventId: 701, isLive: true, updatedAt: now,
    choices: [
      { choiceId: 'h2', name: 'Home', decimalValue: 2.0 },
      { choiceId: 'a2', name: 'Away', decimalValue: 2.0 },
    ],
  };
  const snapshot = OddsEngine.parseSnapshot(payload([threeWay, twoWay]), {
    eventLive: true, eventIdentity: EVENT_ID, observedAt: now,
  });
  assert.equal(snapshot.markets.nextGoal.bookQuotes.length, 1);
  assert.deepEqual(snapshot.markets.nextGoal.outcomeSet, ['away', 'home', 'none']);
  assert.equal(assess(snapshot, 'next-goal-home', 0.6, now).consensusBookCount, 1);
});

test('duplicate outcome labels and ambiguous duplicate markets cannot inflate independent-book consensus', () => {
  const now = Date.now();
  const duplicateOutcome = totalMarket({ updatedAt: now });
  duplicateOutcome.choices.push({ choiceId: 'over-copy', name: 'Over 2.5', decimalValue: 1.6 });
  const duplicateBook = totalMarket({ updatedAt: now, marketId: 13, providerId: 9, over: 2.0, under: 1.9 });
  const duplicateBookCopy = totalMarket({ updatedAt: now, marketId: 15, providerId: 9, over: 2.1, under: 1.8 });
  const secondBook = totalMarket({ updatedAt: now, marketId: 14, providerId: 10, over: 2.05, under: 1.8 });
  const snapshot = OddsEngine.parseSnapshot(payload([duplicateOutcome, duplicateBook, duplicateBookCopy, secondBook]), {
    eventLive: true, eventIdentity: EVENT_ID, observedAt: now,
  });
  assert.equal(snapshot.markets.matchTotals['2.5'].bookQuotes.length, 3);
  const evidence = assess(snapshot, 'match-over-2_5', 0.7, now);
  assert.equal(evidence.consensusBookCount, 1);
  assert.notEqual(evidence.price, 2.0);
});

test('volatile freshness applies when quotes are aggregated, assessed, and moved', () => {
  const now = Date.now();
  const firstAt = now - 2_600;
  const previous = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: firstAt }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: firstAt });
  const current = OddsEngine.parseSnapshot(payload([
    totalMarket({ updatedAt: now - 2_501, over: 1.7 }),
  ]), { eventLive: true, eventIdentity: EVENT_ID, observedAt: now, volatile: true });
  assert.deepEqual(current.markets.matchTotals['2.5'].prices, {});
  const moved = OddsEngine.withMovement(current, previous, now);
  const evidence = assess(moved, 'match-over-2_5', 0.7, now, { volatile: true });
  assert.equal(evidence.reason, 'stale-price');
  assert.equal(moved.markets.matchTotals['2.5'].movement, null);
});
