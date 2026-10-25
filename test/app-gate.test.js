// Sürüm kapısı: eski sürüm kapanır, sunucuya ulaşılamazsa önbellek ve tolerans süresi uygulanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppGate, surumKucuk, TOLERANS_GUN } = require('../src/app-gate');

const GUN = 24 * 60 * 60 * 1000;
function kur({ version = '1.9.0', yanit, hata = false, cache = null, now = 1_000 * GUN }) {
  let kayit = cache;
  const gate = createAppGate({
    version, url: 'https://x/gate', indir: 'https://x/indir', now: () => now,
    fetchJson: async () => { if (hata) throw new Error('ağ yok'); return yanit; },
    readCache: () => kayit, writeCache: (v) => { kayit = v; },
  });
  return { gate, cache: () => kayit };
}

test('sürüm karşılaştırma', () => {
  assert.equal(surumKucuk('1.8.0', '1.9.0'), true);
  assert.equal(surumKucuk('v1.9.0', '1.9.0'), false);
  assert.equal(surumKucuk('1.10.0', '1.9.0'), false);
});

test('minimum sürümün altındaki sürüm kapanır, üstündeki açık kalır', async () => {
  assert.equal((await kur({ version: '1.8.0', yanit: { min: '1.9.0' } }).gate.check()).izin, false);
  assert.equal((await kur({ version: '1.9.0', yanit: { min: '1.9.0' } }).gate.check()).izin, true);
});

test('sunucuya ulaşılamazsa son geçerli yanıt kullanılır', async () => {
  const cache = { at: 999 * GUN, min: '2.0.0', ilk: 900 * GUN };
  assert.equal((await kur({ version: '1.9.0', hata: true, cache }).gate.check()).izin, false);
});

test('hiç doğrulama yapılamadan tolerans süresi geçerse kapanır', async () => {
  const ilk = 1_000 * GUN;
  const { gate } = kur({ hata: true, cache: { ilk }, now: ilk + (TOLERANS_GUN + 1) * GUN });
  const d = await gate.check();
  assert.equal(d.izin, false);
  assert.equal(d.sebep, 'dogrulanamadi');
});

test('ilk açılışta çevrimdışıysa açık kalır', async () => {
  assert.equal((await kur({ hata: true }).gate.check()).izin, true);
});
