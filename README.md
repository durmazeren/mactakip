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
- Analiz aileleri: **sıradaki golü atacak takım** (baskı yönü), **İY alt/üst**, **İY KG**, **maç KG**, seçilebilir çizgide **maç alt/üst**, **takım gol temposu**, **maçın kalanını kim kazanır** (ev/beraberlik/deplasman yönü), **toplam korner** ve **takım şutu/isabetli şut**. İY marketleri yalnızca ilk yarıda izlenir. Gol alt/üst yönü, seçilen baremde skor ve kalan xG temposuyla Poisson dağılımının çizgi üstü/altı kütlesini değerlendirir. Kalan maç sonucu için mevcut skor hariç tutularak iki takımın kalan gol sayısı bağımsız Poisson dağılımlarıyla karşılaştırılır. Sıradaki gol baskı ölçüsü, 3–5 dakikalık veri pencereleri arasında kıyaslanabilmesi için beş dakikaya normalize edilir.
- Sinyaller açıklanabilir istatistik göstergeleridir; oran, bahis sağlayıcısı çizgisi, maç geçmişiyle kalibrasyon veya beklenen getiri hesabı yoktur. Poisson/xG yönleri de tarihsel maçlarla kalibre edilmemiştir; iç sinyal eşikleri gerçek bahis olasılığı olarak yorumlanmamalıdır. xG projeksiyonu maç sonunu 94', ilk yarıyı 49' kabul eden sabit 4 dakikalık uzatma varsayımı kullanır. xG bulunmayan maçta xG'ye bağlı alt/üst, KG ve kalan maç sonucu yönü üretilmez; şut verileriyle sıradaki gol baskı yönü yine izlenebilir. Maç sonu 1X2, handikap, kart ve oyuncu bahisleri motorun kapsamında değildir. Oyuncu şut hedefleri kupon takibi özelliğidir.
- Sofascore verileri sağlayıcı tanımlarına göre değişebilir. Resmî sayfa, API uç noktalarının paylaşılmadığını ve verilerinin bahisleri doğrulamak için kullanılmaması gerektiğini belirtiyor; motor çıktısını kesin sonuç ya da bahis tavsiyesi olarak görme.

**Güncelleme**
- Yeni sürüm çıkınca üst barda "Yeni sürüm" uyarısı görünür; güncellemek isteğe bağlıdır. Windows'ta "Güncelle" → "Yeniden başlat ve kur". Mac'te yeni sürümün indirme sayfası açılır.

## Yeni sürüm yayınlama

`package.json` içindeki `version` alanını artırıp (ör. 1.3.1 → 1.3.2) `main`'e push et. GitHub Actions Windows ve Mac kurulum dosyalarını derleyip Releases'a yükler; kurulu uygulamalar açılışta yeni sürümü görür. Sürüm artırılmadan yapılan push'lar yeni sürüm oluşturmaz.

## Teknik not

Electron uygulaması (`src/`). Veri Sofascore'un resmi olmayan uç noktalarından gelir (`/api/v1/event/{id}`, `/statistics`, `/live-match-tracker`); istekler Electron'un ağ katmanından yapılır, normal sunucu istekleri Sofascore tarafından engelleniyor. Sofascore bu uç noktaları değiştirirse güncelleme gerekebilir.
