# Maç Takip

Seçilen maçların Sofascore canlı animasyonunu ızgarada gösterir; şut takip paneli ve kayan istatistik penceresi kullanan canlı aktivite analizi sunar. Mac ve Windows'ta çalışır.

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

Komut satırından: `npm install` ve ardından `npm start`. Analiz motoru birim testleri için `npm test`.

## Kurulum dosyası (Node.js'siz bilgisayarlar)

Node.js kurmadan dağıtmak için kurulum dosyası üret:

```bash
npm run dist:win   # dist/MacTakip-Setup-<sürüm>.exe
npm run dist:mac   # dist/MacTakip-<sürüm>-mac-arm64.dmg ve -mac-x64.dmg
```

`.exe` Windows'ta veya Mac'te üretilebilir; `.dmg` sadece Mac'te. Uygulama imzasız olduğu için ilk açılışta yukarıdaki güvenlik uyarıları çıkar. Mac'te `.dmg` ile kurulan uygulama açılmazsa: Sistem Ayarları → Gizlilik ve Güvenlik → "Yine de Aç".

## Kullanım

**Maç ekleme**
- Üstteki kutuya tıkla: canlı ve bugünkü maçlar listelenir. Takım adı yazarak filtrele, tıklayınca eklenir.
- Satırdaki **Şut** düğmesi maçı sadece takip paneline ekler (animasyon açmaz). Paneldeki **+ Maç** da aynı işi yapar.
- Listede yoksa Sofascore maç linkini yapıştır (linkin sonunda `#id:12345678` olmalı).
- Animasyonlu en fazla 12, toplam 30 maç. Seçilen maçlar, hedefler ve düzen kapatıp açınca hatırlanır.

**Animasyon ekranı**
- **Izgara:** üst bardan dizilim seçilir: **Oto** (animasyonlar en büyük görünecek şekilde), **Yan yana**, **Alt alta**.
- **Odak modu:** kutudaki ⤢ düğmesi (veya başlığa çift tıklama) o maçı büyütür; diğerleri yanda/altta küçülür ama odaktakinin en az yarı boyunda kalır. Tekrar ⤡ ya da Esc ile çıkılır.
- **Serbest:** kutuları başlığından tutup sürükle; dört kenarından ve dört köşesinden boyutlandır. Alanın kenarlarına, yarım / üçte bir / çeyrek çizgilerine ve diğer kutulara yapışır (yapıştığı yerde kılavuz çizgisi görünür). "Düzeni sıfırla" ızgaraya döner.
- **Tam ekran:** üst bardaki ⛶ düğmesi veya **F** tuşu; üst bar ve şut ekranı gizlenir. Esc veya F ile çıkılır.
- Başlamamış maçta animasyon başlama saatinde kendiliğinden açılır; animasyonu olmayan veya biten maçlarda atak grafiği gösterilir.

**Şut ekranı**
- Her maç için toplam şut, isabetli şut ve korner, her biri tek satırda; "Maç / 1Y / 2Y" ile devre bazında.
- ⚙ ile kartta hangi istatistiklerin görüneceği seçilir (ör. korneri kapat) ve sıralama ayarlanır:
  - **Elle:** kartı takım adlarından tutup sürükle. Sıra animasyon ızgarasına da yansır.
  - **Otomatik:** hedefli canlı maçlar üstte, sonra canlı, başlamamış ve en altta küçülmüş halde biten maçlar.
- Şut, isabetli şut, korner veya gol olunca maçın kutusunda ve kartında renkli bir uyarı belirir.
- ▷ / ▶ ile maçın animasyonu açılır/kapanır.
- ↻ (kartta ve animasyon kutusunda): veri gelmiyor ya da animasyon takıldıysa o maçı baştan yükler.
- Sofascore değeri 0 olan satırları göndermediği için eksik şut / isabetli şut, diğer şut satırlarından hesaplanır.

**Kupon takibi**
- Kartın başlığındaki **+ Hedef** → **Takım** ya da **Oyuncu**.
  - Takım: maç, taraf (ev / deplasman / toplam), istatistik (şut / isabetli şut / korner), periyot, üst/alt ve barem. Kartın altında ince çubuk olarak görünür.
  - Oyuncu: maçın kadrosundan oyuncu (ilk 11 / yedekler), şut veya isabetli şut, üst/alt ve barem (maç sonu). Tüm oyuncu hedefleri şut ekranının en altında "Oyuncu hedefleri" bölümünde listelenir; oyuncunun durumu (sahada, yedek, oyundan çıktı) yazar. Oyuncu oyundan çıkarsa veya kırmızı kart görürse hedefi o an sonuçlanır.
- Üst hedef baremi geçince yeşile döner ("Tuttu"), sayaç artmaya devam eder. Alt hedef baremi aşınca kırmızıya döner. Periyot bitince tutmayanlar "Yattı" olur.
- Şut ekranının üstünde kuponun özeti: kaç hedef tuttu, yattı, devam ediyor.

**Canlı analiz**
- Takip panelindeki **Canlı analiz** sekmesi seçili canlı maçları yaklaşık 10 saniyede bir gelen başarılı istatistik kontrolleriyle izler. En az 3 dakikalık ölçüm oluşur; en fazla son 5 dakika değerlendirilir. Devre değişiminde veya istatistik sayacı geriye düzeltildiğinde pencere yeniden başlar. Veri 35 saniyeden eskiyse sinyal gizlenir.
- Analiz aileleri: **sıradaki golü atacak takım** (baskı yönü), **İY alt/üst**, **İY KG**, **maç KG**, seçilebilir çizgide **maç alt/üst**, **takım gol temposu**, **maçın kalanını kim kazanır** (ev/beraberlik/deplasman yönü), **toplam korner** ve **takım şutu/isabetli şut**. İY marketleri yalnızca ilk yarıda izlenir. Panel, bahis market yönlerini maç içi aktivite göstergelerinden ayrı gruplar. Sinyal, en az iki başarılı kontrol üst üste aynı koşulu sağladığında görünür.
- Takım hücum baskısı şut, isabetli şut, xG, korner ve büyük şans artışını birlikte değerlendirir. Büyük şanslar takım baskısı ve aktivite seviyesine katkı sağlar; topa sahip olma ve kırmızı kart bilgisi maç bağlamı olarak gösterilir, kırmızı kart sayısı kalan xG hızını ihtiyatlı biçimde düzeltir.
- Uygulama canlı maç başına yaklaşık 30 saniyede bir mevcut Electron/Sofascore istek katmanından `event/{id}/odds/1/all` verisini ister. Sağlayıcı döndürürse maç/İY toplam gol, KG, sıradaki gol ve maçın kalan sonucu marketlerini etiket ve çizgiyle eşleştirir. İki/üç yönlü fiyatlarda marj arındırılmış piyasa payı hesaplanır. Yalnızca aktif, askıya alınmamış ve sağlayıcı zaman damgası 90 saniyeden eski olmayan eşleşen fiyat, ilgili model yönü için teyit olarak kullanılır; ters yöndeki güncel piyasa payı %52 eşiğinin altındaysa o market sinyali gizlenir. Oran verisi, uygun market ya da güvenilir zaman damgası yoksa istatistik modeli çalışmaya devam eder; oran teyidi varmış gibi gösterilmez. Sağlayıcının zaman damgası ilerlediğinde iki sorgu arasındaki marj arındırılmış yön değişimi de sinyale eklenir.
- Gol alt/üst ve KG yönleri tek nokta tahminiyle karar vermez: maç boyu tempo ile son 3–5 dakikanın xG hızını karşılaştırıp düşük, temel ve yüksek kalan xG senaryoları üretir. Üst yönü düşük; alt/KG Hayır yönü yüksek senaryoda da eşiği geçmelidir. Kalan maç sonucu ev/deplasman tempo aralıklarının dört uç kombinasyonunda aynı yönü korumalıdır. Paneldeki dar/orta/geniş tempo aralığı senaryolar arasındaki ayrışmayı anlatır, başarı olasılığı değildir. Sıradaki gol baskı ölçüsü pencereler arasında kıyaslanabilmesi için beş dakikaya normalize edilir.
- Sinyaller açıklanabilir istatistik ve güncel market teyidi göstergeleridir; uygulama beklenen getiri hesabı yapmaz. xG senaryo aralıkları, kırmızı kart etkisi ve model eşikleri tarihsel maçlarla kalibre edilmemiştir; piyasa payı da bahis sonucunun olasılığı ya da garantisi değildir. xG projeksiyonu maç sonunu 94', ilk yarıyı 49' kabul eden sabit 4 dakikalık uzatma varsayımı kullanır. xG bulunmayan maçta xG'ye bağlı alt/üst, KG ve kalan maç sonucu yönü üretilmez; şut/büyük şans verileriyle sıradaki gol baskı yönü yine izlenebilir. Maç sonu 1X2, handikap, kart ve oyuncu bahisleri motorun kapsamı dışındadır. Oyuncu şut hedefleri kupon takibi özelliğidir.
- Sofascore verileri ve oran uç noktası sağlayıcı tanımlarına göre değişebilir; bu uç nokta resmî bir geliştirici API'si olarak belgelenmemiştir. [Sofascore, spor verisi API uç noktalarını paylaşmadığını ve sitesinin bahisleri doğrulamak için kullanılmaması gerektiğini belirtiyor](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=en). Oran/istatistik sinyalini kesin sonuç veya bahis tavsiyesi olarak görme.

**Güncelleme**
- Yeni sürüm çıkınca üst barda "Yeni sürüm" uyarısı görünür; güncellemek isteğe bağlıdır. Windows'ta "Güncelle" → "Yeniden başlat ve kur". Mac'te yeni sürümün indirme sayfası açılır.

## Yeni sürüm yayınlama

`package.json` içindeki `version` alanını artırıp (ör. 1.3.1 → 1.3.2) `main`'e push et. GitHub Actions Windows ve Mac kurulum dosyalarını derleyip Releases'a yükler; kurulu uygulamalar açılışta yeni sürümü görür. Sürüm artırılmadan yapılan push'lar yeni sürüm oluşturmaz.

## Teknik not

Electron uygulaması (`src/`). Veri Sofascore'un resmi olmayan uç noktalarından gelir (`/api/v1/event/{id}`, `/statistics`, `/live-match-tracker`, oran sağlanıyorsa `/odds/1/all`); istekler Electron'un ağ katmanından yapılır. Bu uç noktalar değişirse güncelleme gerekebilir.
