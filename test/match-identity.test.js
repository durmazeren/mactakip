'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LiveAnalysisState = require('../src/js/analysis-state.js');

function event(overrides = {}) {
  return {
    id: 701,
    startTimestamp: 1_800_000_000,
    homeTeam: { id: 11, name: 'Old name' },
    awayTeam: { id: 22, name: 'Away' },
    tournament: { id: 33, name: 'League' },
    ...overrides,
  };
}

test('match state identity uses immutable provider IDs and ignores renamed display labels', () => {
  const first = event();
  const renamed = event({
    homeTeam: { id: 11, name: 'New name' },
    awayTeam: { id: 22, name: 'Away (updated)' },
    tournament: { id: 33, name: 'League renamed' },
  });
  assert.equal(LiveAnalysisState.matchIdentity(first, 701), LiveAnalysisState.matchIdentity(renamed, 701));
});

test('match state identity changes for a different event, participant, tournament, or kickoff', () => {
  const base = LiveAnalysisState.matchIdentity(event(), 701);
  for (const changed of [
    event({ id: 702 }),
    event({ homeTeam: { id: 99, name: 'Old name' } }),
    event({ tournament: { id: 44, name: 'League' } }),
    event({ startTimestamp: 1_800_000_100 }),
  ]) {
    assert.notEqual(LiveAnalysisState.matchIdentity(changed, 701), base);
  }
});

test('team-name fallback remains deterministic when provider participant IDs are missing', () => {
  const first = event({ homeTeam: { name: 'Café FC' } });
  const equivalent = event({ homeTeam: { name: 'Cafe\u0301 FC' } });
  assert.equal(LiveAnalysisState.matchIdentity(first, 701), LiveAnalysisState.matchIdentity(equivalent, 701));
});
