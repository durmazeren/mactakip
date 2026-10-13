'use strict';

// 2026/27 lig aşaması maç günleri: kullanıcının sağladığı UEFA maç günü takvimi.
// Tema yerel takvim tarihine göre açılır; başka tarihlerde seçim düğmesi gösterilmez.
const UCL_MATCH_DATES = new Set([
  '2026-09-08', '2026-09-09', '2026-09-10',
  '2026-10-13', '2026-10-14', '2026-10-20', '2026-10-21',
  '2026-11-03', '2026-11-04', '2026-11-24', '2026-11-25',
  '2026-12-08', '2026-12-09',
  '2027-01-19', '2027-01-20', '2027-01-27',
]);
const UCL_THEME_OFF_KEY = 'uclThemeOffDate';

function themeDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isUclMatchDate(date = new Date()) {
  return UCL_MATCH_DATES.has(themeDateKey(date));
}

function shouldUseUclTheme(date = new Date(), offDate = null) {
  return isUclMatchDate(date) && offDate !== themeDateKey(date);
}

function updateTheme(date = new Date()) {
  const today = themeDateKey(date);
  const available = isUclMatchDate(date);
  const active = shouldUseUclTheme(date, load(UCL_THEME_OFF_KEY, null));
  const button = document.getElementById('themeToggle');
  document.body.classList.toggle('theme-ucl', active);
  button.hidden = !available;
  button.setAttribute('aria-pressed', String(active));
  button.title = active ? 'Klasik görünüme dön' : 'Şampiyonlar Ligi görünümünü aç';
  document.getElementById('themeToggleLabel').textContent = active ? 'Klasik görünüm' : 'Şampiyonlar Ligi';
  document.getElementById('statsKicker').textContent = active ? 'MAÇ VERİLERİ' : 'MAÇ İSTATİSTİKLERİ';
  button.dataset.date = available ? today : '';
}

function initTheme() {
  updateTheme();
  document.getElementById('themeToggle').addEventListener('click', () => {
    const today = themeDateKey();
    if (!isUclMatchDate()) return;
    save(UCL_THEME_OFF_KEY, document.body.classList.contains('theme-ucl') ? today : null);
    updateTheme();
  });
  // Uygulama gece boyunca açık kalırsa gün değişiminde tema da değişir.
  setInterval(updateTheme, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateTheme();
  });
}

if (typeof module !== 'undefined') {
  module.exports = { UCL_MATCH_DATES, themeDateKey, isUclMatchDate, shouldUseUclTheme };
}
