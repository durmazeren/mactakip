const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { UCL_MATCH_DATES, UEFA_MATCH_DATES, themeDateKey, isUclMatchDate, isUefaMatchDate, shouldUseUclTheme } = require('../src/js/theme');

function localDay(year, month, day) {
  return new Date(year, month - 1, day, 12);
}

test('Şampiyonlar Ligi sezonunun 33 maç günü (lig aşaması 16 + eleme + final) temaya açık', () => {
  assert.equal(UCL_MATCH_DATES.size, 33);
  for (const d of ['2026-09-08', '2027-01-27', '2027-02-16', '2027-03-17', '2027-05-05', '2027-06-05']) assert.ok(UCL_MATCH_DATES.has(d), d);
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


test('Avrupa kupaları yalnız kendi maç günlerinde: Salı-Çarşamba ŞL, Perşembe AL ve KL', () => {
  assert.equal(UEFA_MATCH_DATES[679].size, 18);
  assert.equal(UEFA_MATCH_DATES[17015].size, 15);
  const tue = localDay(2026, 10, 20), thu = localDay(2026, 10, 22), sun = localDay(2026, 10, 18);
  assert.deepEqual([7, 679, 17015].map((id) => isUefaMatchDate(id, tue)), [true, false, false]);
  assert.deepEqual([7, 679, 17015].map((id) => isUefaMatchDate(id, thu)), [false, true, true]);
  assert.deepEqual([7, 679, 17015].map((id) => isUefaMatchDate(id, sun)), [false, false, false]);
  assert.equal(isUefaMatchDate(52, sun), true, 'kupa olmayan lig her gün');
  assert.equal(isUefaMatchDate(17015, localDay(2027, 6, 2)), true, 'KL finali');
  assert.equal(isUefaMatchDate(679, localDay(2027, 5, 26)), true, 'AL finali');
});

test('lig filtresi kupaları tarihe göre gösterir', () => {
  const state = { pickerSport: 'football', catalog: { leagues: [] }, searchResults: [], leagueFilter: null };
  const context = vm.createContext({ state });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'theme.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'picker.js'), 'utf8'), context);
  context.day = localDay(2026, 10, 22);
  const thursday = JSON.parse(JSON.stringify(vm.runInContext('featuredLeaguesForDate(day).map((l) => l.id)', context)));
  assert.ok(thursday.includes(679) && thursday.includes(17015) && !thursday.includes(7));
  assert.deepEqual(thursday.slice(0, 2), [52, 98], 'Türkiye ligleri yine en üstte');
  context.day = localDay(2026, 10, 18);
  const sunday = JSON.parse(JSON.stringify(vm.runInContext('featuredLeaguesForDate(day).map((l) => l.id)', context)));
  assert.ok(![7, 679, 17015].some((id) => sunday.includes(id)));
});
