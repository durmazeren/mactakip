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

Komut satırından: `npm install` ve ardından `npm start`. Analiz motoru testleri için `npm test`; sentetik canlı snapshot akışını tekrar oynatmak için `npm run simulate:analysis`; etiketli tarihsel örnekleri değerlendirmek için `npm run backtest:analysis -- ./dataset.json`. Veri biçimi ve kalibrasyon ayrıntıları için [canlı analiz backtest kılavuzuna](LIVE_ANALYSIS_BACKTEST.md) bakın.

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
- Maç state'i event kimliği, takım kimlikleri ve başlama zamanı ile bağlanır. Skor, devre, saat veya istatistik sayacı sıfırlanırsa eski sinyal onayları temizlenir. Maç, istatistik ve oran isteklerinin başarılı, eksik, boş, bulunamadı ve başarısız durumları ayrı tutulur; kısmi yanıtlar önceki iyi veriyi ezmez ve geç dönen istek yeni maç state'ine yazılamaz.
- Maç saati Sofascore'un güncel periyot başlangıç zamanından hesaplanır; 1Y, 2Y ve uzatma periyotları ayrı ele alınır. Sağlayıcı periyot bitişini veya ilan edilmiş uzatma süresini verirse kullanılır. Uzatma süresi paylaşılmıyorsa motor 49'/94' gibi sabit bir süre uydurmaz; belirsizliği gösterir ve o periyodun projeksiyon ufkunu ihtiyatlı tutar.
- Analiz aileleri: **sıradaki golü atacak takım** (baskı yönü), **İY alt/üst**, **İY KG**, **maç KG**, seçilebilir çizgide **maç alt/üst**, **takım gol temposu**, **maçın kalanını kim kazanır** (ev/beraberlik/deplasman yönü), **toplam korner** ve **takım şutu/isabetli şut**. İY marketleri yalnızca ilk yarıda izlenir. Panel, bahis market yönlerini maç içi aktivite göstergelerinden ayrı gruplar. Sinyal, en az iki başarılı kontrol üst üste aynı koşulu sağladığında görünür.
- Takım hücum baskısı şut, isabetli şut, xG, korner ve büyük şans artışını birlikte değerlendirir. Büyük şanslar takım baskısı ve aktivite seviyesine katkı sağlar; topa sahip olma ve kırmızı kart bilgisi maç bağlamı olarak gösterilir, kırmızı kart sayısı kalan xG hızını ihtiyatlı biçimde düzeltir.
- Kalan xG hesabı son beş dakikadaki xG artışlarını 90 saniye yarı ömürlü üstel ağırlıkla birleştirir; maç temposu ve yakın dönem temposu ayrıştıkça senaryo aralığı genişler. Motor baskı artışı, tempo düşüşü, dengeli tempo ve rejim geçişi için ayrı etiket kullanır; rejim oynaklığı ile veri kalitesi dinamik eşikleri etkiler.
- Her analiz snapshot'ı için **Veri kalitesi (0–100)** ve her sinyal için **model/girdi güveni**, eşik payı ve sıralama skoru gösterilir. Bunlar maç sonucunun olasılığı veya başarı yüzdesi değildir. Sinyaller en az iki başarılı ölçümde doğrulanır; en yüksek puanlılar üstte listelenir.
- Uygulama canlı maç başına yaklaşık 30 saniyede bir mevcut Electron/Sofascore istek katmanından `event/{id}/odds/1/all` verisini ister (normal ve uzatma periyotları). Sağlayıcı döndürürse maç/İY toplam gol, KG, sıradaki gol ve maçın kalan sonucu marketlerini market, periyot, çizgi, seçim ve yanıtta varsa sağlayıcı/bookmaker kimliğiyle eşleştirir. Ondalık, kesirli ve Amerikan fiyatları ortak biçime çevrilir; iki/üç yönlü fiyatlarda ham ima olasılığı, marj arındırılmış piyasa olasılığı ve piyasa adil oranı hesaplanır. Sağlayıcı zaman damgası 90 saniyeden eskiyse veya event kimliği eşleşmiyorsa oranlar analiz teyidi/EV hesabında kullanılmaz.
- Eşleşen güncel market varsa xG/Poisson tabanlı model olasılığıyla piyasa olasılığı kıyaslanır: model adil oranı, model-piyasa farkı (edge), fiyat üzerinden teorik model EV ve öncelik sıralaması gösterilir. Model-değer eşiği yalnızca yeterli veri kalitesi, en az 3 puan edge ve en az %2 teorik EV birlikte sağlanırsa işaretlenir. Oran gelmezse istatistik motoru çalışmaya devam eder; eksik teyit varmış gibi davranmaz.
- Gol alt/üst ve KG yönleri tek nokta tahminiyle karar vermez: maç boyu tempo ile son 3–5 dakikanın xG hızını karşılaştırıp düşük, temel ve yüksek kalan xG senaryoları üretir. Üst yönü düşük; alt/KG Hayır yönü yüksek senaryoda da eşiği geçmelidir. Kalan maç sonucu ev/deplasman tempo aralıklarının dört uç kombinasyonunda aynı yönü korumalıdır. Paneldeki dar/orta/geniş tempo aralığı senaryolar arasındaki ayrışmayı anlatır, başarı olasılığı değildir. Sıradaki gol baskı ölçüsü pencereler arasında kıyaslanabilmesi için beş dakikaya normalize edilir.
- Canlı oran EV'si model tahminine dayalı, **kalibre edilmemiş teorik karşılaştırmadır**; bahis tavsiyesi, gerçekleşmiş getiri veya başarı garantisi değildir. Şu anda geçmiş maç sonuçlarıyla eğitilmiş/kalibre edilmiş model ya da tarihsel backtest veri kümesi yoktur. xG bulunmayan maçta xG'ye bağlı Alt/Üst, KG ve kalan maç yönleri üretilmez. Maç sonu 1X2, handikap, kart ve oyuncu bahisleri bu motorun kapsamı dışındadır. Oyuncu şut hedefleri kupon takibi özelliğidir.
- Tekrarlanabilir regresyon/senaryo kontrolü için `npm run simulate:analysis` kullanılabilir. Replay deterministik sentetik snapshot'lardan sinyal ve reset akışını üretir; tarihsel maç backtest'i veya model kalibrasyonu değildir.
- Sofascore verileri ve oran uç noktası sağlayıcı tanımlarına göre değişebilir; bu uç nokta resmî bir geliştirici API'si olarak belgelenmemiştir. [Sofascore, spor verisi API uç noktalarını paylaşmadığını ve sitesinin bahisleri doğrulamak için kullanılmaması gerektiğini belirtiyor](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=en). Oran/istatistik sinyalini kesin sonuç veya bahis tavsiyesi olarak görme.

**Güncelleme**
- Yeni sürüm çıkınca üst barda "Yeni sürüm" uyarısı görünür; güncellemek isteğe bağlıdır. Windows'ta "Güncelle" → "Yeniden başlat ve kur". Mac'te yeni sürümün indirme sayfası açılır.

## Yeni sürüm yayınlama

`package.json` içindeki `version` alanını artırıp (ör. 1.3.1 → 1.3.2) `main`'e push et. GitHub Actions Windows ve Mac kurulum dosyalarını derleyip Releases'a yükler; kurulu uygulamalar açılışta yeni sürümü görür. Sürüm artırılmadan yapılan push'lar yeni sürüm oluşturmaz.

## Teknik not

Electron uygulaması (`src/`). Veri Sofascore'un resmi olmayan uç noktalarından gelir (`/api/v1/event/{id}`, `/statistics`, `/live-match-tracker`, oran sağlanıyorsa `/odds/1/all`); istekler Electron'un ağ katmanından yapılır. Bu uç noktalar değişirse güncelleme gerekebilir.
