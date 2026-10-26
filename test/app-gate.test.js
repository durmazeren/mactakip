// Sürüm kapısı + çalışma bileti: imzalı bilet doğrulanır, eski sürüm ve biletsiz durum kapanır, çevrimdışı tolerans uygulanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppGate, surumKucuk, biletGecerli } = require('../src/app-gate');

const GUN = 24 * 60 * 60 * 1000;
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const b64url = (b) => Buffer.from(b).toString('base64url');
function biletUret(exp, v = '1.0.0', key = privateKey) {
  const govde = b64url(JSON.stringify({ exp, v }));
  return `${govde}.${b64url(crypto.sign(null, Buffer.from(govde), key))}`;
}

function kur({ version = '1.9.0', yanit, hata = false, cache = null, now = 1_000 * GUN }) {
  let kayit = cache;
  const gate = createAppGate({
    version, url: 'https://x/gate', indir: 'https://x/indir', acikAnahtar: PUB, now: () => now,
    fetchJson: async () => { if (hata) throw new Error('ağ yok'); return yanit; },
    readCache: () => kayit, writeCache: (val) => { kayit = val; },
  });
  return { gate, cache: () => kayit };
}

test('sürüm karşılaştırma', () => {
  assert.equal(surumKucuk('1.8.0', '1.9.0'), true);
  assert.equal(surumKucuk('v1.9.0', '1.9.0'), false);
});

test('geçerli bilet + desteklenen sürüm → izin', async () => {
  const d = await kur({ yanit: { min: '1.0.0', bilet: biletUret(1_001 * GUN) } }).gate.check();
  assert.equal(d.izin, true);
});

test('bilet yoksa veri alınmaz', async () => {
  const d = await kur({ yanit: { min: '1.0.0' } }).gate.check();
  assert.equal(d.izin, false);
  assert.equal(d.sebep, 'bilet_yok');
});

test('minimum sürümün altı kapanır', async () => {
  const d = await kur({ version: '1.8.0', yanit: { min: '1.9.0', bilet: biletUret(1_001 * GUN) } }).gate.check();
  assert.equal(d.izin, false);
  assert.equal(d.sebep, 'eski_surum');
});

test('başka anahtarla imzalı (sahte) bilet reddedilir', async () => {
  const sahte = crypto.generateKeyPairSync('ed25519').privateKey;
  const d = await kur({ yanit: { min: '1.0.0', bilet: biletUret(1_001 * GUN, '1.0.0', sahte) } }).gate.check();
  assert.equal(d.izin, false);
});

test('süresi dolmuş bilet reddedilir', () => {
  assert.equal(biletGecerli(biletUret(500 * GUN), { version: '1.9.0', now: 1_000 * GUN, acikAnahtar: PUB }), false);
});

test('sunucu geçici erişilemez: son geçerli bilet dolmadıysa açık', async () => {
  const cache = { at: 999 * GUN, min: '1.0.0', bilet: biletUret(1_001 * GUN), ilk: 900 * GUN };
  assert.equal((await kur({ hata: true, cache }).gate.check()).izin, true);
});

test('sunucu uzun süredir erişilemez: tolerans dolunca kapanır', async () => {
  const cache = { at: 990 * GUN, min: '1.0.0', bilet: biletUret(2_000 * GUN), ilk: 980 * GUN };
  const d = await kur({ hata: true, cache, now: 1_000 * GUN }).gate.check();
  assert.equal(d.izin, false);
  assert.equal(d.sebep, 'dogrulanamadi');
});

test('ilk açılış çevrimdışı: açık', async () => {
  assert.equal((await kur({ hata: true }).gate.check()).izin, true);
});
