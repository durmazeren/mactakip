# Maç Takip

Seçilen maçların Sofascore canlı animasyonunu tek ekranda ızgara halinde gösterir. Sağdaki "Şut ekranı" seçili maçların istatistiklerini gösterir; odaktaki maçlar daha sık, arka plandaki maçlar sırayla güncellenir. Mac ve Windows'ta aynı şekilde çalışır.

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

Uygulama aynı veri klasörüyle bir kez çalışır. İkinci kez açılırsa mevcut pencereye dönülür; ikinci bir veri sorgulama döngüsü başlamaz.

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
- Açılan listedeki **Lig** menüsünden bir lig seç. Popüler ligler üstte, diğerleri alfabetik sıralanır. O ligin canlı, bugünkü ve önümüzdeki iki gündeki başlayacak maçları görünür; takım araması seçili lig içinde çalışır. **Tüm ligler** genel listeye döner. Seçim uygulamayı kapatıp açınca korunur.
- Satırdaki **Şut** düğmesi maçı sadece şut ekranına ekler (animasyon açmaz). Şut ekranındaki **+ Maç ekle** de aynı işi yapar.
- Listede yoksa Sofascore maç linkini yapıştır (linkin sonunda `#id:12345678` olmalı).
- Animasyonlu en fazla 12, toplam 30 maç. Seçilen maçlar, hedefler ve düzen kapatıp açınca hatırlanır.

**Animasyon ekranı**
- **Görünüm ▾** menüsü (üst bar): yerleşim (Izgara / Serbest) ve dizilim.
- **Izgara:** dizilim seçilir: **Oto** (animasyonları en büyük gösterir; uygun kutularda alt istatistikleri yan boşluğa alır), **Yan yana**, **Alt alta**.
- **Odak modu:** kutudaki ⤢ düğmesi (veya başlığa çift tıklama) o maçı büyütür; diğerleri yanda/altta küçülür ama odaktakinin en az yarı boyunda kalır. Tekrar ⤡ ya da Esc ile çıkılır.
- **Serbest:** kutuları başlığından tutup sürükle; dört kenarından ve dört köşesinden boyutlandır. Alanın kenarlarına, yarım / üçte bir / çeyrek çizgilerine ve diğer kutulara yapışır (yapıştığı yerde kılavuz çizgisi görünür). "Düzeni sıfırla" ızgaraya döner.
- **Tam ekran:** üst bardaki ⛶ düğmesi veya **F** tuşu; üst bar ve şut ekranı gizlenir. Esc veya F ile çıkılır.
- Kutu başlığında yalnız 🔊 (maçın sesi), ⤢ (büyüt), **⋯** ve ✕ görünür. **⋯** menüsünde: **Maçı değiştir** (eski maç şut ekranında ve hedeflerde kalır), **Yenile**, **Yalnız şut ekranında tut**.
- Başlamamış maçta animasyon başlama saatinde kendiliğinden açılır; animasyonu olmayan veya biten maçlarda atak grafiği gösterilir.

**Şut ekranı**
- Her maç için toplam şut, isabetli şut ve korner, her biri tek satırda; "Maç / 1Y / 2Y" ile devre bazında.
- Karta tıkla: mevcut maç istatistikleri sağda dikey bir panelde açılır; solda maçın açık animasyonu büyür. Çubuklar, topla oynama grafiği ve yüzde halkalarıyla karşılaştırma yapılır. Panelin altındaki oklarla şut ekranındaki maçlar arasında geçilir. Esc ya da ✕ ile kapanır.
- **Oyuncular** sekmesinde kadro ve oyuncu istatistikleri görünür. Diziliş bilgisi varsa ilk 11 sahaya yerleşir; yoksa liste gösterilir. Oyuncuya tıkla veya detayın altındaki oklarla oyuncu değiştir. Forma numaralarıyla gösterilir; ek fotoğraf ve şut haritası isteği gönderilmez. Oyuncu verisi önbellekte yoksa bu sekme ilk açıldığında bir kadro isteği yapılır.
- ⚙ ile kartta hangi istatistiklerin görüneceği seçilir (ör. korneri kapat) ve sıralama ayarlanır:
  - **Elle:** kartın üstünde basılı tut ve sürükle. Sıra animasyon ızgarasına da yansır (Otomatik moddayken sürüklersen Elle'ye geçer).
  - **Otomatik:** hedefli canlı maçlar üstte, sonra canlı, başlamamış ve en altta küçülmüş halde biten maçlar.
- Basketbol kartında takım logoları, skor, çeyrek ve süre büyük görünür; takım istatistikleri kartta gösterilmez.
- Şut, isabetli şut, korner veya gol olunca maçın kutusunda ve kartında renkli bir uyarı belirir.
- Gol olunca şut kartı birkaç saniyeliğine tam boy bir gol animasyonuna dönüşür; ardından istatistik ve hedefler kaldığı yerden görünür.
- Kartın üstüne gelince ses, ↻ ve ▷ / ▶ düğmeleri görünür: ▷ / ▶ maçın animasyonunu açar/kapatır; ↻ veri gelmiyor ya da animasyon takıldıysa o maçı baştan yükler.
- Sofascore değeri 0 olan satırları göndermediği için eksik şut / isabetli şut, diğer şut satırlarından hesaplanır.

**Kupon takibi**
- Kartın üstüne gelince takım adlarının üstünde düğmeler çıkar: **+** (hedef ekle), ses, ↻, ▷ ve ✕. **+** → **Takım** ya da **Oyuncu**.
  - Takım: maç, taraf (ev / deplasman / toplam), istatistik (şut / isabetli şut / korner), periyot, üst/alt ve barem. Kartın altında ince çubuk olarak görünür.
  - Oyuncu: maçın kadrosundan oyuncu (ilk 11 / yedekler), istatistik, üst/alt ve barem (maç sonu).
    - Futbol: toplam / isabetli / isabetsiz / bloklanan şut, gol, asist, pas, kilit pas, orta, başarılı çalım, ofsayt, müdahale, top kapma, top kazanma, uzaklaştırma, kurtarış, faul, kazanılan faul, kart.
    - Basketbol: sayı, ribaund, asist, üçlük; sayı+ribaund+asist, sayı+ribaund, sayı+asist, ribaund+asist, top çalma+blok; saha içi / 2'lik / 3'lük / serbest atış deneme ve isabet; hücum / savunma ribaundu, top çalma, blok, top kaybı, faul.
    - Sofascore basketbolda oyuncu istatistiğini geç girdiği için NBA, WNBA, EuroLeague ve EuroCup maçlarında resmî canlı istatistik de (NBA, EuroLeague, yedek olarak ESPN) okunur; her istatistikte önde olan değer kullanılır, resmî kaynak bir değeri düzeltirse ona uyulur. Tüm oyuncu hedefleri şut ekranının en altında "Oyuncu hedefleri" bölümünde listelenir; oyuncunun durumu (sahada, yedek, oyundan çıktı) yazar. Oyuncu oyundan çıkarsa veya kırmızı kart görürse hedefi o an sonuçlanır.
- Üst hedef baremi geçince yeşile döner ("Tuttu"), sayaç artmaya devam eder. Alt hedef baremi aşınca kırmızıya döner. Periyot bitince tutmayanlar "Yattı" olur.
- Şut ekranının üstünde kuponun özeti: kaç hedef tuttu, yattı, devam ediyor.

**Ses ve bildirimler**
- Üst bardaki 🔊 bütün sesleri açar/kapatır; yanındaki **▾** menüsünde ses panosu, olay sesleri ve bildirim ayarları var.
- Maçta gol olunca **Gol** sesi çalar. Her maçın sesi kutusundaki/kartındaki 🔊 ile ayrı ayarlanır.
- **Masaüstü gol bildirimi:** uygulama arka plandayken gol olursa ekranın sağ altında küçük bir kart çıkar (7 sn). Tıklayınca Maç Takip açılır ve o maça gider. Bildirim ayarlarındaki **Masaüstü bildirimini dene** ile 3 saniye sonra örnek kart gösterilir.
- **Ses panosu** ayrı pencerede açılır (📌 ile her zaman üstte kalır): Spor, Eğlence ve kendi eklediğin sesler. ☆ ile favorilere ekle (en üstte görünür), sesleri sürükleyerek sırala, 🗑 ile kaldır (hazır sesler alttaki bağlantıyla geri gelir), ✎ ile adını değiştir. Panonun kendi ses seviyesi var; çalan butona tekrar basınca durur.

**Güncelleme**
- Yeni sürüm çıkınca üst barda "Yeni sürüm" uyarısı görünür; güncellemek isteğe bağlıdır. Windows'ta "Güncelle" → "Yeniden başlat ve kur". Mac'te yeni sürümün indirme sayfası açılır.

**SofaScore bağlantısı**
- 403 uyarısı çıkarsa **SofaScore'u aç** düğmesine bas. Site açıldıktan sonra Maç Takip'e dönüp **Bağlantıyı kontrol et** düğmesine bir kez bas. Doğrulama istenirse sitede kendin tamamla.
- Erişim reddedildiğinde otomatik veri istekleri bekletilir. Ağ değiştirirsen aynı kontrol düğmesiyle bağlantıyı yeniden deneyebilirsin.

## Yeni sürüm yayınlama

`package.json` içindeki `version` alanını artırıp (ör. 1.1.0 → 1.2.0) `main`'e push et. GitHub Actions Windows ve Mac kurulum dosyalarını derleyip Releases'a yükler; kurulu uygulamalar açılışta yeni sürümü görür. Sürüm artırılmadan yapılan push'lar yeni sürüm oluşturmaz.

## Teknik not

Yayın öncesinde ve her iki işletim sisteminde testler çalışır. Test veya derleme başarısızsa sürüm yayınlanmaz. Sürüme ait değişiklikler `release-notes/<sürüm>.md` dosyasından yayın notlarına eklenir.

Animasyon yükleme hatalarında en fazla üç deneme yapılır: 15, 45 ve 120 saniye arayla. Başarılı yüklemede sayaç sıfırlanır. API bağlantısı engelliyken otomatik animasyon yenilemesi bekletilir; animasyon sayfasının kendi 403/429 yanıtında da yenileme durur. Veri istekleri ve animasyonun iç servis bağlantıları farklıdır; uygulama animasyon sağlayıcısının kendi iç istek sıklığını yönetmez.

Electron uygulaması (`src/`). Veri Sofascore'un resmi olmayan uç noktalarından gelir (`/api/v1/event/{id}`, `/statistics`, `/live-match-tracker`); istekler Electron'un ağ katmanından yapılır, normal sunucu istekleri Sofascore tarafından engelleniyor. Sofascore bu uç noktaları değiştirirse güncelleme gerekebilir.

Veri ve bağlantı kontrol sayfası `persist:sofa-data` oturumunu paylaşır; animasyonlar mevcut `persist:sofa` oturumunda kalır. Farklı tarayıcı uyumluluk ayarlarının çerez depoları ayrıdır. Uygulamanın JSON istekleri tek kuyruktan geçer: aynı anda bir istek, başlangıçlar arasında en az 1,25 saniye ve kayan 60 saniyede en fazla 36 istek. Bunlar bizim ihtiyatlı bütçemizdir; Sofascore'un açıkladığı veya erişim garantisi veren limitler değildir. Yinelenen istekler birleştirilir; aynı maçın eşzamanlı yenilemeleri tek işe dönüşür. Lig ayarları, fikstür, kadro ve oranlar uygun süreyle önbellekte tutulur. Çok maçta skor için toplu canlı liste kullanılır; her turda en fazla altı maçın ayrıntısı sırayla yenilenir. Odak 10, animasyonlu maç 20, hedefli maç 30 saniye; arka plan en az 60 saniye bekler ve maç sayısıyla yavaşlar. Bunlar asgari aralıklardır; dolu kuyrukta daha uzun sürebilir. Başlamasına 15 dakikadan çok kalan maçta yalnız maç durumu beş dakikada bir kontrol edilir, istatistik istenmez.

403 yanıtı bekleyen kuyruğu iptal eder ve otomatik veri isteklerini durdurur; 429 yanıtında sunucunun `Retry-After` süresine uyulur. Bekleme uygulama veri klasörüne kaydedilir; yeniden açılış bunu sıfırlamaz. Ağ değiştirildikten sonra uyarıdaki **Bağlantıyı kontrol et** düğmesi aynı hız bütçesi içinde tek istekle erişimi sınar. **SofaScore'u aç**, aynı uygulama oturumunda siteyi açar; doğrulama istenirse kullanıcı tamamlar. Bu davranış IP engelini kaldırmayı garanti etmez. Animasyon sağlayıcısının kendi iç istekleri bu JSON bütçesine dahil değildir.

Maç seçici genel liste için yalnızca canlı maçlar ve günün toplu fikstürünü ister; ayrı ayrı 40 lig sorgulanmaz. Fikstür beş dakika önbellekte tutulur. Belirli ligin önümüzdeki üç günlük fikstürü ancak kullanıcı ligi seçtiğinde istenir. Maç istatistik paneli yeni istatistik isteği veya ikinci bir animasyon bağlantısı açmaz; mevcut animasyon büyütülür. Yalnız şut ekranındaki maç için panel açıkken tek bir geçici animasyon açılır.


403 sonrasında aynı oturumda görünür SofaScore sayfasını açıp bir kez bağlantı kontrolü yapan otomatik yenileme vardır. Sayfa açıldıktan sonra normal oturum hazırlığı için on saniye beklenir; sayfanın kendi taze, başarılı futbol JSON yanıtı da tanı amacıyla gözlenir. İnsan doğrulaması, site reddi, sayfa hatası veya tekrar 403 durumunda işlem durur. Başarısız deneme kendini yinelemez; başarılı bağlantıdan sonraki yeni olayda da otomatik denemeler arasında en az iki dakika vardır. Bekleme yeniden açılışta korunur. Kullanıcının açık olan veya etkileştiği pencere otomatik kapatılmaz.

`sofa-diagnostics.jsonl` uygulama veri klasöründe tutulur. Son 403'ün yolu, yanıt türü, `challenge` nedeni, istek sayısı ve otomatik yenileme aşamaları kaydedilir; cookie/token değerleri, istek başlıkları ve API gövdeleri kaydedilmez. Kayıt boyutu sınırlıdır. HTTP 403 tek başına IP engeli veya istek limiti kanıtı değildir.
