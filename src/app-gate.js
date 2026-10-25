// Maç Takip © 2026 Eren Durmaz · simonpredicts.app · Tüm hakları saklıdır.
// Sürüm kapısı: resmî sunucu en düşük desteklenen sürümü bildirir; altındaki sürümler veri almaz ve
// kullanıcı resmî siteye yönlendirilir. Sunucuya ulaşılamazsa son geçerli yanıt kullanılır; resmî sunucuyla
// uzun süre (TOLERANS_GUN) hiç doğrulama yapılamazsa da kapı kapanır.
const TOLERANS_GUN = 7;
const GUN_MS = 24 * 60 * 60 * 1000;

function surumKucuk(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '0').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

function createAppGate({ fetchJson, version, key = '', readCache, writeCache, now = () => Date.now(), url, indir }) {
  let durum = { izin: true, sebep: 'baslangic', indir };

  const karar = (kayit) => {
    if (kayit.min && surumKucuk(version, kayit.min)) {
      return { izin: false, sebep: 'eski_surum', min: kayit.min, mesaj: kayit.mesaj, indir: kayit.indir || indir };
    }
    return { izin: true, sebep: 'gecerli', min: kayit.min, indir: kayit.indir || indir };
  };

  async function check() {
    const onbellek = readCache() || {};
    try {
      const yanit = await fetchJson(`${url}?v=${encodeURIComponent(version)}&k=${encodeURIComponent(key)}`);
      const kayit = { at: now(), min: yanit.min, mesaj: yanit.mesaj, indir: yanit.indir, ilk: onbellek.ilk || now() };
      writeCache(kayit);
      durum = karar(kayit);
    } catch {
      const ilk = onbellek.ilk || now();
      if (!onbellek.ilk) writeCache({ ...onbellek, ilk });
      const son = onbellek.at || ilk;
      if (now() - son > TOLERANS_GUN * GUN_MS) {
        durum = { izin: false, sebep: 'dogrulanamadi', indir };
      } else {
        durum = onbellek.at ? karar(onbellek) : { izin: true, sebep: 'cevrimdisi', indir };
      }
    }
    return durum;
  }

  return { check, state: () => durum };
}

module.exports = { createAppGate, surumKucuk, TOLERANS_GUN };
