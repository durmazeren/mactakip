'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OddsEngine = require('../src/js/odds-engine.js');

function oddsFixture(updatedAt = Date.now(), overrides = {}) {
  return {
    markets: [
      {
        marketName: 'Total Goals Over/Under', updatedAt,
        choices: [
          { name: 'Over 2.5', decimalValue: 1.8 },
          { name: 'Under 2.5', decimalValue: 2.1 },
        ],
      },
      {
        marketName: '1st Half Goals Over/Under', updatedAt,
        choices: [
          { name: 'Over 1.5', decimalValue: 2.05 },
          { name: 'Under 1.5', decimalValue: 1.72 },
        ],
      },
      {
        marketName: 'Both Teams To Score', updatedAt,
        choices: [
          { name: 'Yes', decimalValue: 1.91 },
          { name: 'No', decimalValue: 1.95 },
        ],
      },
      {
        marketName: 'Next Team to Score', updatedAt,
        choices: [
          { name: 'Home', decimalValue: 2.4 },
          { name: 'No Goal', decimalValue: 3.2 },
          { name: 'Away', decimalValue: 2.8 },
        ],
      },
      {
        marketName: 'Rest of Match Result', updatedAt,
        choices: [
          { name: 'Home', decimalValue: 2.2 },
          { name: 'Draw', decimalValue: 2.7 },
          { name: 'Away', decimalValue: 3.1 },
        ],
      },
      ...((overrides.markets) || []),
    ],
  };
}

test('parses supported live markets and removes the two-way/three-way overround', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(oddsFixture(now), { eventLive: true, observedAt: now });
  assert.ok(snapshot);
  const total = snapshot.markets.matchTotals['2.5'];
  assert.ok(Math.abs(total.fair.over + total.fair.under - 1) < 1e-12);
  assert.ok(total.fair.over > 0.53 && total.fair.over < 0.55);
  assert.ok(snapshot.markets.firstHalfTotals['1.5']);
  assert.ok(snapshot.markets.matchBtts);
  assert.ok(snapshot.markets.nextGoal.fair.none > 0);
  assert.ok(snapshot.markets.remainingResult.fair.draw > 0);
});

test('only a fresh provider timestamp can confirm a signal direction', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot(oddsFixture(now), { eventLive: true, observedAt: now });
  const supported = OddsEngine.confirmation(snapshot, 'match-over-2_5', now);
  assert.equal(supported.verified, true);
  assert.equal(supported.supported, true);
  assert.ok(supported.price > 1);

  const stale = OddsEngine.parseSnapshot(oddsFixture(now - 91_000), { eventLive: true, observedAt: now });
  assert.equal(OddsEngine.confirmation(stale, 'match-over-2_5', now).verified, false);

  const unknownTime = {
    markets: [{
      marketName: 'Total Goals Over/Under',
      choices: [{ name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 2.5', decimalValue: 2.1 }],
    }],
  };
  const unverified = OddsEngine.parseSnapshot(unknownTime, { eventLive: true, observedAt: now });
  assert.equal(OddsEngine.confirmation(unverified, 'match-over-2_5', now).verified, false);
  assert.equal(OddsEngine.summary(unverified, now).key, 'unverified');
});

test('market assessment binds event, market, period, line, selection and calculates fair value', () => {
  const now = Date.now();
  const eventIdentity = 'event-1|home-1|away-2|league-5|1800000000';
  const snapshot = OddsEngine.parseSnapshot({ markets: [{
    id: 77, provider: { id: 12, name: 'Example Book' },
    marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
    choices: [{ name: 'Over 2.5', decimalValue: 1.8 }, { name: 'Under 2.5', decimalValue: 2.1 }],
  }] }, { eventLive: true, observedAt: now, eventIdentity });

  const assessment = OddsEngine.marketAssessment(snapshot, 'match-over-2_5', 0.70, now, eventIdentity);
  assert.equal(assessment.verified, true);
  assert.equal(assessment.identity.market, 'total-goals');
  assert.equal(assessment.identity.period, 'match');
  assert.equal(assessment.identity.line, '2.5');
  assert.equal(assessment.identity.bookmakerId, 12);
  assert.equal(assessment.provider, 'Example Book');
  assert.equal(assessment.modelFairOdds, 1 / 0.70);
  assert.ok(Math.abs(assessment.edge - (0.70 - snapshot.markets.matchTotals['2.5'].fair.over)) < 1e-12);
  assert.ok(Math.abs(assessment.expectedValue - (0.70 * 1.8 - 1)) < 1e-12);
  assert.equal(OddsEngine.marketAssessment(snapshot, 'match-over-3_5', 0.7, now, eventIdentity), null);
  assert.equal(OddsEngine.marketAssessment(snapshot, 'match-over-2_5', 0.7, now, 'another-event').verified, false);
});

test('fractional and American prices normalize to decimal market quotes', () => {
  const now = Date.now();
  const snapshot = OddsEngine.parseSnapshot({ markets: [{
    marketName: 'Over/Under 1.5 Goals', updatedAt: now,
    choices: [
      { name: 'Over 1.5', fractionalValue: '4/5' },
      { name: 'Under 1.5', americanValue: '-110' },
    ],
  }] }, { eventLive: true, observedAt: now });
  assert.equal(snapshot.markets.matchTotals['1.5'].prices.over, 1.8);
  assert.ok(Math.abs(snapshot.markets.matchTotals['1.5'].prices.under - (1 + 100 / 110)) < 1e-12);
});

test('suspended, malformed, and pre-match payloads are ignored', () => {
  const now = Date.now();
  assert.equal(OddsEngine.parseSnapshot(oddsFixture(now), { eventLive: false, observedAt: now }), null);
  const suspended = { markets: [{
    marketName: 'Both Teams To Score', updatedAt: now, suspended: true,
    choices: [{ name: 'Yes', decimalValue: 1.8 }, { name: 'No', decimalValue: 2.0 }],
  }] };
  const snapshot = OddsEngine.parseSnapshot(suspended, { eventLive: true, observedAt: now });
  assert.equal(snapshot, null);

  const malformed = OddsEngine.parseSnapshot({ markets: [{
    marketName: 'Total Goals Over/Under 2.5', updatedAt: now,
    choices: [{ name: 'Over 2.5', decimalValue: 1 }, { name: 'Under 2.5', decimalValue: 'bad' }],
  }] }, { eventLive: true, observedAt: now });
  assert.equal(malformed, null);
});

test('market movement is measured only when the provider advances its timestamp', () => {
  const firstAt = Date.now();
  const first = OddsEngine.parseSnapshot(oddsFixture(firstAt), { eventLive: true, observedAt: firstAt });
  const secondAt = firstAt + 30_000;
  const changed = oddsFixture(secondAt, {
    markets: [{
      marketName: 'Total Goals Over/Under', updatedAt: secondAt,
      choices: [{ name: 'Over 2.5', decimalValue: 1.65 }, { name: 'Under 2.5', decimalValue: 2.25 }],
    }],
  });
  const second = OddsEngine.withMovement(
    OddsEngine.parseSnapshot(changed, { eventLive: true, observedAt: secondAt }), first,
  );
  assert.ok(second.markets.matchTotals['2.5'].movement.over > 0);

  const sameAt = OddsEngine.parseSnapshot(oddsFixture(firstAt), { eventLive: true, observedAt: secondAt + 30_000 });
  const noChange = OddsEngine.withMovement(sameAt, first);
  assert.equal(noChange.markets.matchTotals['2.5'].movement, null);
});

test('the odds scraper is scheduled independently per match by the feed scheduler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '../src/js/core.js'), 'utf8');
  assert.match(app, /event\/\$\{id\}\/odds\/1\/all/);
  assert.match(app, /endpointNamesDue\(id/);
  assert.match(app, /scheduleEndpoint\(id, 'odds'/);
  assert.match(core, /odds: Object\.freeze\(\{ base:/);
  assert.doesNotMatch(app, /setInterval\(pollOne/);
});
