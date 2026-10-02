# Maç Takip

Seçilen maçların Sofascore canlı animasyonunu tek ekranda ızgara halinde gösterir. Sağdaki "Şut ekranı" sadece seçili maçların toplam ve isabetli şutlarını yazar (her 10 sn'de güncellenir). Mac ve Windows'ta aynı şekilde çalışır.

## İndir (önerilen)

**[Releases → son sürüm](https://github.com/durmazeren/mactakip/releases/latest)** sayfasından kurulum dosyasını indir. Node.js gerekmez.

| Bilgisayar | Dosya |
|---|---|
| Windows | `MacTakip-Setup-x.y.z.exe`: çift tıkla, tek tıkla kurulur, masaüstüne **Maç Takip** simgesi gelir |
| Mac (M1/M2/M3/M4) | `MacTakip-x.y.z-mac-arm64.dmg` |
| Mac (Intel) | `MacTakip-x.y.z-mac-x64.dmg` |

- **Windows:** SmartScreen uyarı verirse: "Ek bilgi" → "Yine de çalıştır".
- **Mac:** Uygulamayı Uygulamalar klasörüne sürükle. "Hasarlı" veya "açılamıyor" derse Terminal'de bir kez `xattr -cr "/Applications/Mac Takip.app"`.

## Kaynak koddan çalıştırma

Tek gereksinim **Node.js** (LTS sürümü). Windows'ta yoksa `Baslat-Windows.bat` sorup otomatik kurar (winget ile); Mac'te https://nodejs.org adresinden kurulur.

| Bilgisayar | Çift tıkla |
|---|---|
| Windows | `Baslat-Windows.bat` |
| Mac | `Baslat-Mac.command` |

İlk açılışta gerekli dosyaları ve Electron'u kendisi indirir (1-2 dk), sonraki açılışlar direkt. Repoyu ZIP olarak indirdiysen önce bir klasöre çıkar, ZIP'in içinden çalıştırma.

- **Windows:** SmartScreen "Windows bilgisayarınızı korudu" derse: "Ek bilgi" → "Yine de çalıştır".
- **Mac:** İnternetten indirilen `.command` ilk açılışta engellenirse: sağ tık → Aç. Çalıştırılamıyor derse Terminal'de bir kez `chmod +x Baslat-Mac.command`.

Komut satırından: `npm install` ve ardından `npm start`.

## Kurulum dosyası (Node.js'siz bilgisayarlar)

Node.js kurmadan dağıtmak için kurulum dosyası üret:

```bash
npm run dist:win   # dist/MacTakip-Setup-<sürüm>.exe
npm run dist:mac   # dist/MacTakip-<sürüm>-mac-arm64.dmg ve -mac-x64.dmg
```

`.exe` Windows'ta veya Mac'te üretilebilir; `.dmg` sadece Mac'te. Uygulama imzasız olduğu için ilk açılışta yukarıdaki güvenlik uyarıları çıkar. Mac'te `.dmg` ile kurulan uygulama açılmazsa: Sistem Ayarları → Gizlilik ve Güvenlik → "Yine de Aç".

## Kullanım

- Üstteki kutuya tıkla: canlı ve bugünkü maçlar listelenir. Takım adı yazarak filtrele, tıklayınca eklenir.
- Satırdaki **Şut** düğmesi maçı sadece şut ekranına ekler (animasyon açmaz). Şut ekranındaki **+ Maç ekle** de aynı işi yapar.
- Şut ekranındaki ▷ / ▶ düğmesi bir maçın animasyonunu açar/kapatır; kutudaki ▭ düğmesi animasyonu kapatıp maçı şut ekranında bırakır.
- Listede yoksa Sofascore maç linkini yapıştır (linkin sonunda `#id:12345678` olmalı).
- Animasyonlu en fazla 12, toplam 30 maç; ızgara maç sayısına göre kendini ayarlar (2, 2x2, 3x2, 4x2…).
- Başlamamış maçta animasyon başlama saatinde kendiliğinden açılır.
- Sportradar animasyonu olmayan maçlarda (küçük ligler) yerine Sofascore atak grafiği gösterilir.
- Şut ekranında "Maç / 1Y / 2Y" ile devre bazlı şutlar; artan sayı yeşil yanıp söner.
- Maç bitince animasyonun yerine maçın atak grafiği gelir.
- Küçük liglerde Sofascore şut istatistiği tutmuyorsa kartta bu yazar.
- Seçilen maçlar kapatıp açınca hatırlanır (her bilgisayar kendi listesini tutar).

## Teknik not

Electron uygulaması (`src/`). Veri Sofascore'un resmi olmayan uç noktalarından gelir (`/api/v1/event/{id}`, `/statistics`, `/live-match-tracker`); istekler Electron'un ağ katmanından yapılır, normal sunucu istekleri Sofascore tarafından engelleniyor. Sofascore bu uç noktaları değiştirirse güncelleme gerekebilir.
