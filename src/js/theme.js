'use strict';

// 2026/27 UEFA kupa maç günleri (Türkiye tarihi). Lig aşaması: resmî fikstür (her turun gerçek
// maç günleri); eleme turları ve finaller: UEFA'nın açıkladığı sezon takvimi. Bu günlerde kupa lig filtresinde
// görünür; Şampiyonlar Ligi günlerinde ayrıca tema seçeneği açılır. Yeni sezonda yeniden doldurulmalı.
const UEFA_MATCH_DATES = {
  // Şampiyonlar Ligi (Salı–Çarşamba)
  7: new Set([
    '2026-09-08', '2026-09-09', '2026-09-10', '2026-10-13', '2026-10-14', '2026-10-20', '2026-10-21',
    '2026-11-03', '2026-11-04', '2026-11-24', '2026-11-25', '2026-12-08', '2026-12-09',
    '2027-01-19', '2027-01-20', '2027-01-27',
    '2027-02-16', '2027-02-17', '2027-02-23', '2027-02-24', // eleme play-off
    '2027-03-09', '2027-03-10', '2027-03-16', '2027-03-17', // son 16
    '2027-04-06', '2027-04-07', '2027-04-13', '2027-04-14', // çeyrek final
    '2027-04-27', '2027-04-28', '2027-05-04', '2027-05-05', // yarı final
    '2027-06-05', // final (Madrid)
  ]),
  // Avrupa Ligi (Perşembe; lig aşamasının ilk turu Çarşamba–Perşembe)
  679: new Set([
    '2026-09-16', '2026-09-17', '2026-10-15', '2026-10-22', '2026-11-05', '2026-11-26', '2026-12-10',
    '2027-01-21', '2027-01-28',
    '2027-02-18', '2027-02-25', '2027-03-11', '2027-03-18', '2027-04-08', '2027-04-15',
    '2027-04-29', '2027-05-06', '2027-05-26', // final (Frankfurt)
  ]),
  // Konferans Ligi (Perşembe)
  17015: new Set([
    '2026-10-15', '2026-10-22', '2026-11-05', '2026-11-26', '2026-12-10', '2026-12-17',
    '2027-02-18', '2027-02-25', '2027-03-11', '2027-03-18', '2027-04-08', '2027-04-15',
    '2027-04-29', '2027-05-06', '2027-06-02', // final (İstanbul)
  ]),
};
const UCL_MATCH_DATES = UEFA_MATCH_DATES[7];
const UCL_THEME_OFF_KEY = 'uclThemeOffDate';

function themeDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isUclMatchDate(date = new Date()) {
  return UCL_MATCH_DATES.has(themeDateKey(date));
}

// Kupa (UEFA turnuva kimliği) bugün oynanıyor mu?
function isUefaMatchDate(leagueId, date = new Date()) {
  const days = UEFA_MATCH_DATES[leagueId];
  return !days || days.has(themeDateKey(date));
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
  document.getElementById('themeToggleLabel').textContent = active ? 'Klasik görünüme dön' : 'Temayı aç';
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
  module.exports = { UCL_MATCH_DATES, UEFA_MATCH_DATES, themeDateKey, isUclMatchDate, isUefaMatchDate, shouldUseUclTheme };
}
