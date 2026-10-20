// Sağ alt gol penceresi: ana süreçten gelen bildirimi gösterir; tıklanınca maça gider, ✕ kapatır.
const card = document.getElementById('card');
let hideTimer = null;
window.appToast.onShow((p) => {
  document.getElementById('t').textContent = p.title || 'GOL';
  document.getElementById('b').textContent = p.body || '';
  card.dataset.match = p.matchId ?? '';
  card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { card.classList.remove('show'); setTimeout(() => window.appToast.done(), 400); }, 7000);
});
card.addEventListener('click', (e) => {
  clearTimeout(hideTimer);
  if (e.target.classList.contains('x')) window.appToast.done();
  else window.appToast.open(card.dataset.match ? Number(card.dataset.match) : null);
});
