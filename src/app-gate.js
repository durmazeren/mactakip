// Maç Takip © 2026 Eren Durmaz · simonpredicts.app · Tüm hakları saklıdır.
// Sürüm kapısı + çalışma bileti: resmî sunucu (simonpredicts.app) her açılışta en düşük desteklenen sürümü bildirir ve
// süreli, imzalı bir "çalışma bileti" verir. Uygulama veriyi yalnızca (sürüm >= min) VE (geçerli, süresi dolmamış,
// imzası resmî açık anahtarla doğrulanan bir bilet) varken alır. Bileti yalnız sunucu (gizli anahtar) üretebilir;
// taklit edilemez. Sunucu desteği kesince biletler en geç BILET_OMRU kadar sonra dolar ve uygulama veri almaz.
// Sunucuya geçici ulaşılamazsa son geçerli bilet TOLERANS_GUN'e kadar kullanılır; ilk açılış çevrimdışıysa açık kalır.
const crypto = require('crypto');

const TOLERANS_GUN = 7;
const GUN_MS = 24 * 60 * 60 * 1000;

// Çalışma biletini doğrulayan resmî açık anahtar (Ed25519, SPKI/DER base64). Gizli anahtar yalnız sunucudadır.
const RESMI_ACIK_ANAHTAR = 'MCowBQYDK2VwAyEAkZQczsVQl6ynQUQo4bLCFp925TXc2j4wtmIpS/chmYk=';

function surumKucuk(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '0').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

// Bilet: base64url(JSON{exp,v}) + "." + base64url(imza). Açık anahtarla doğrulanır.
function biletGecerli(bilet, { version, now, acikAnahtar = RESMI_ACIK_ANAHTAR } = {}) {
  try {
    const [govde, imza] = String(bilet).split('.');
    if (!govde || !imza) return false;
    const key = crypto.createPublicKey({ key: Buffer.from(acikAnahtar, 'base64'), format: 'der', type: 'spki' });
    if (!crypto.verify(null, Buffer.from(govde), key, Buffer.from(imza, 'base64url'))) return false;
    const veri = JSON.parse(Buffer.from(govde, 'base64url').toString('utf8'));
    if (!veri.exp || veri.exp < now) return false;
    if (veri.v && version && surumKucuk(version, veri.v)) return false;
    return true;
  } catch { return false; }
}

function createAppGate({ fetchJson, version, key = '', readCache, writeCache, now = () => Date.now(),
  url, indir, acikAnahtar = RESMI_ACIK_ANAHTAR }) {
  let durum = { izin: true, sebep: 'baslangic', indir };

  const karar = (kayit, t) => {
    if (kayit.min && surumKucuk(version, kayit.min)) {
      return { izin: false, sebep: 'eski_surum', min: kayit.min, mesaj: kayit.mesaj, indir: kayit.indir || indir };
    }
    if (!biletGecerli(kayit.bilet, { version, now: t, acikAnahtar })) {
      return { izin: false, sebep: 'bilet_yok', mesaj: kayit.mesaj, indir: kayit.indir || indir };
    }
    return { izin: true, sebep: 'gecerli', min: kayit.min, indir: kayit.indir || indir };
  };

  async function check() {
    const onbellek = readCache() || {};
    const t = now();
    try {
      const yanit = await fetchJson(`${url}?v=${encodeURIComponent(version)}&k=${encodeURIComponent(key)}`);
      const kayit = { at: t, min: yanit.min, mesaj: yanit.mesaj, indir: yanit.indir, bilet: yanit.bilet, ilk: onbellek.ilk || t };
      writeCache(kayit);
      durum = karar(kayit, t);
    } catch {
      const ilk = onbellek.ilk || t;
      if (!onbellek.ilk) writeCache({ ...onbellek, ilk });
      if (!onbellek.at) {
        durum = { izin: true, sebep: 'cevrimdisi', indir };            // ilk açılış, hiç doğrulama yok: açık
      } else if (t - onbellek.at > TOLERANS_GUN * GUN_MS) {
        durum = { izin: false, sebep: 'dogrulanamadi', indir };        // çok uzun süre sunucuya ulaşılamadı
      } else {
        durum = karar(onbellek, t);                                    // son geçerli bilet hâlâ dolmadıysa açık
      }
    }
    return durum;
  }

  return { check, state: () => durum };
}

module.exports = { createAppGate, surumKucuk, biletGecerli, RESMI_ACIK_ANAHTAR, TOLERANS_GUN };
