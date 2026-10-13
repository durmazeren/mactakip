'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');

function cardContext() {
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    window: { sofa: { get: () => { throw new Error('Kart ek veri isteği attı'); } } },
    document: {},
  });
  vm.runInContext(source('core.js'), context);
  vm.runInContext(source('shots.js'), context);
  return context;
}

test('kart mevcut istatistik yanıtından yeni metrikleri ve iki dönemi okur', () => {
  const context = cardContext();
  context.payload = { statistics: [
    { period: 'ALL', groups: [{ statisticsItems: [
      { key: 'totalShotsOnGoal', homeValue: 12, awayValue: 8 },
      { key: 'shotsOnGoal', homeValue: 5, awayValue: 2 },
      { key: 'expectedGoals', homeValue: 1.23, away: '0,64' },
      { key: 'ballPossession', home: '61% (48/78)', homeValue: 48, away: '39%', awayValue: 30 },
      { key: 'cornerKicks', homeValue: 6, awayValue: 3 },
      { key: 'throwIns', homeValue: 20, awayValue: 18 },
      { key: 'fouls', homeValue: 8, awayValue: 10 },
      { key: 'goalkeeperSaves', homeValue: 1, awayValue: 4 },
    ] }] },
    { period: '1ST', groups: [{ statisticsItems: [
      { key: 'shotsOnGoal', homeValue: 2, awayValue: 3 },
      { key: 'shotsOffGoal', homeValue: 4, awayValue: 2 },
      { key: 'blockedScoringAttempt', homeValue: 1, awayValue: 1 },
    ] }] },
  ] };
  const parsed = JSON.parse(JSON.stringify(vm.runInContext('parseStats(payload)', context)));
  assert.deepEqual(parsed.ALL.shots, [12, 8]);
  assert.deepEqual(parsed.ALL.sot, [5, 2]);
  assert.deepEqual(parsed.ALL.xg, [1.23, 0.64]);
  assert.deepEqual(parsed.ALL.possession, [61, 39]);
  assert.deepEqual(parsed.ALL.throwIns, [20, 18]);
  assert.deepEqual(parsed.ALL.fouls, [8, 10]);
  assert.deepEqual(parsed.ALL.saves, [1, 4]);
  assert.equal(parsed.ALL.yellowCards, null);
  assert.deepEqual(parsed['1ST'].shots, [7, 6]);
  assert.deepEqual(parsed['1ST'].sot, [2, 3]);
  assert.equal(parsed['1ST'].corners, null);
});

test('kart xG, yüzde ve eksik veriyi uygun gösterir', () => {
  const context = cardContext();
  assert.equal(vm.runInContext("formatCardStat(0.8, {format: 'decimal'})", context), '0.80');
  assert.equal(vm.runInContext("formatCardStat(53, {format: 'percent'})", context), '53%');
  assert.equal(vm.runInContext("formatCardStat(null, {})", context), '–');
  assert.equal(vm.runInContext("state.cardStats.join(',')", context), 'shots,sot,corners');
});
