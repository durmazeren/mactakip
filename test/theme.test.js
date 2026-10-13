const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
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

test('tema düğmesi yalnız fikstür günlerinde görünür', () => {
  const button = { hidden: false, dataset: {}, setAttribute(key, value) { this[key] = value; } };
  const label = { textContent: '' };
  const kicker = { textContent: '' };
  const nodes = { themeToggle: button, themeToggleLabel: label, statsKicker: kicker };
  const body = { themed: false, classList: { toggle(_name, active) { body.themed = active; } } };
  const context = vm.createContext({ document: { body, getElementById: (id) => nodes[id] }, load: () => null });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'theme.js'), 'utf8'), context);
  context.day = localDay(2026, 10, 15);
  vm.runInContext('updateTheme(day)', context);
  assert.equal(button.hidden, true);
  assert.equal(body.themed, false);
  context.day = localDay(2026, 10, 20);
  vm.runInContext('updateTheme(day)', context);
  assert.equal(button.hidden, false);
  assert.equal(body.themed, true);
});
