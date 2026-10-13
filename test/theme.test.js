const test = require('node:test');
const assert = require('node:assert/strict');
const { UCL_MATCH_DATES, themeDateKey, isUclMatchDate, shouldUseUclTheme } = require('../src/js/theme');

function localDay(year, month, day) {
  return new Date(year, month - 1, day, 12);
}

test('lig aşamasının PDF takvimindeki 16 günü temaya açık', () => {
  assert.equal(UCL_MATCH_DATES.size, 16);
  for (const date of UCL_MATCH_DATES) {
    const [year, month, day] = date.split('-').map(Number);
    assert.equal(themeDateKey(localDay(year, month, day)), date);
    assert.equal(isUclMatchDate(localDay(year, month, day)), true);
  }
});

test('maç günü kapatılan tema ertesi maç gününde yeniden açılır', () => {
  const matchDay = localDay(2026, 10, 13);
  assert.equal(shouldUseUclTheme(matchDay), true);
  assert.equal(shouldUseUclTheme(matchDay, '2026-10-13'), false);
  assert.equal(shouldUseUclTheme(localDay(2026, 10, 14), '2026-10-13'), true);
  assert.equal(shouldUseUclTheme(localDay(2026, 10, 15)), false);
  assert.equal(shouldUseUclTheme(localDay(2027, 1, 28)), false);
});
