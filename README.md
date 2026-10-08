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
- Event, istatistik, oran ve olay akışları maç başına ayrı scheduler ile yönetilir. Normal aralık 10 sn; yükselen tempo, kritik olay, sessiz maç ve 429/timeout durumları her uç noktanın bir sonraki zamanını ayrı ayarlar. 500 ms scheduler tik'i API istek aralığı değildir. Öncelikli maç yenilemesi, global 8 istek limiti, sıra yaşlandırma ve eski cevap/revision koruması bulunur.
- Her maçın state'i sağlayıcı event kimliği, takımlar, turnuva ve başlangıç zamanı ile bağlanır. Skor/devre değişimi ve sayaç gerilemesi geçmiş pencere veya sinyal onaylarını temizler; provider xG düzeltmesi/negatif delta projeksiyona alınmaz. Eksik/bozuk yanıtlar son tam snapshot'ı ezmez. İstek, kaynak zamanı, alım, doğrulama, commit, analiz ve arayüz aşamalarının latency/yaş değerleri uç nokta bazında izlenir.
- Maç saati sağlayıcı periyot başlangıcı ve sunulan uzatma/sonlanma bilgisiyle hesaplanır. 1Y, 2Y ve uzatma ayrı ele alınır; clock belirsizse motor sabit 49'/94' ufku uydurmaz.
- Analiz aileleri: **sıradaki gol yönü ve ayrı baskı göstergesi**, **İY alt/üst**, **İY KG**, **maç KG**, seçilebilir çizgide **maç alt/üst**, **maçın kalanını kim kazanır** (ev/beraberlik/deplasman), **toplam korner aktivitesi** ve **takım şutu/isabetli şut aktivitesi**. Son iki aile istatistiksel aktivite ölçümüdür; scraper destekli ayrı bahis-market/model veya bookmaker fiyatı oldukları anlamına gelmez. İY aileleri yalnızca ilk yarıda çalışır.
- Goal modeli 3/5/10/15 dakikalık ve maç geneli xG pencerelerini örneklem güveniyle birleştirir; tempo büyüklüğü ile kanıt güvenini ayrı tutar, düşük örneklemli ani artışı baseline'a çeker. Skor teşvikleri ve dakika/oyun durumu duyarlı kırmızı kart düzeltmesi kalan gol oranını değiştirir. Dixon–Coles türü düşük skor bağımlılık düzeltmesi, çoklu feature rejim algısı ve gol/kart/VAR/penaltı sonrası regime reset/freeze uygulanır. Veri kalitesi markete özel hesaplanır ve düşük eşik altında ilgili yön kapatılır.
- Her sinyal; market/çizgi/seçim/devre/skor anahtarına bağlı `DETECTED → CONFIRMING → CONFIRMED/ACTIVE → INVALIDATED/EXPIRED` yaşam döngüsüne, kısa TTL'ye ve neden/kanıt alanlarına sahiptir. Normalde iki ardışık doğrulama gerekir; kritik gol/kart sonrası yalnızca yüksek güvenli, yeni snapshot için tek doğrulama istisnası vardır. UI tempo, confidence, data quality, market yönü ve bookmaker value kanıtını birbirine karıştırmaz.
- Oran parser'ı Sofascore market family/period alanlarını, `choiceGroup` çizgilerini, takım adıyla gelen sıradaki gol seçimlerini ve `sourceId` seçim kimliklerini tanır. Her quote market/period/line/selection ve kaynak kimliğine bağlanır. Piyasa adil olasılığı, en iyi fiyat, robust median-log-ratio no-vig consensus ve aynı kaynak/market üzerinde zaman damgalı fiyat hareketi ayrıdır. Normal odds 0–5 sn LIVE, 5–10 sn AGING; 10 sn üzeri kullanılamaz. Gol/kart/VAR/penaltı sonrasında 2.5 sn sınırı uygulanır.
- **Model yönü** ile **bookmaker value** ayrıdır. Model olasılıkları tarihsel sonuçlarla eğitilmediğinden UI bunları kalibre edilmemiş heuristik tahmin olarak işaretler; teorik edge/EV eyleme açık değer sinyali sayılmaz. Value için aynı event/market/devre/çizgi/seçim kimliği, açık ve taze fiyat, desteklenen settlement çizgisi, market kalitesinin en az 75 olması ve tam o market/period/line için güncel, doğrulanmış Platt modeli gerekir (en az 1.000 outcome ve holdout Brier ≤ 0.30). Quarter/whole Asian goal line'larında push/yarım settlement modeli yoksa EV kapalıdır.
- Gerçek scraper'ın mevcut yanıtları fiyat pazarları içerse de sağlayıcı timestamp'i ve bookmaker kimliği her yanıtta bulunmuyor. Bu yüzden parser market şeklini gösterebilir; bu alanlar olmadan fiyatı fresh/verified veya value-eligible yapmaz. Dış feed'i salt okunur ölçmek için `npm run smoke:live-feed` çalıştırılabilir; bu komut en çok üç aktif maçı bir kez örnekler, ham cevapları kaydetmez ve ağ erişimi gerektirir. Bu bir sezon kapsamı/başarı testi değildir.
- Analiz market yönleri: sıradaki gol, İY ve maç toplam golleri, İY ve maç KG, kalan maç sonucu. Korner ve şut/isabetli şut mevcut motor içinde aktivite ailesidir. Maç sonu 1X2, handikap, kart ve oyuncu bahisleri yoktur; oyuncu şut hedefleri kupon takibidir.
- `npm test` birim/regresyon matrisini çalıştırır; `npm run simulate:analysis` sentetik replay ve skor resetlerini tekrarlanabilir şekilde oynatır; `npm run backtest:analysis -- ./dataset.json` etiketli dış veriyi değerlendirir. Backtest aracı tarihsel snapshot indirmez. Off-line isotonic rapor tek başına canlı kalibrasyon oluşturmaz; gerçek accuracy/ROI iddiası için maç ayrımlı, kronolojik ve etiketli veri gerekir.
- Sofascore verileri ve oran uç noktası sağlayıcı tanımlarına göre değişebilir; bu uç nokta resmî bir geliştirici API'si olarak belgelenmemiştir. [Sofascore, spor verisi API uç noktalarını paylaşmadığını ve sitesinin bahisleri doğrulamak için kullanılmaması gerektiğini belirtiyor](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=en). Oran/istatistik sinyalini kesin sonuç veya bahis tavsiyesi olarak görme.

**Güncelleme**
- Yeni sürüm çıkınca üst barda "Yeni sürüm" uyarısı görünür; güncellemek isteğe bağlıdır. Windows'ta "Güncelle" → "Yeniden başlat ve kur". Mac'te yeni sürümün indirme sayfası açılır.

## Yeni sürüm yayınlama

`package.json` içindeki `version` alanını artırıp (ör. 1.3.1 → 1.3.2) `main`'e push et. GitHub Actions Windows ve Mac kurulum dosyalarını derleyip Releases'a yükler; kurulu uygulamalar açılışta yeni sürümü görür. Sürüm artırılmadan yapılan push'lar yeni sürüm oluşturmaz.

## Teknik not

Electron uygulaması (`src/`). Veri Sofascore'un resmi olmayan uç noktalarından gelir (`/api/v1/event/{id}`, `/statistics`, `/live-match-tracker`, oran sağlanıyorsa `/odds/1/all`); istekler Electron'un ağ katmanından yapılır. Bu uç noktalar değişirse güncelleme gerekebilir.
