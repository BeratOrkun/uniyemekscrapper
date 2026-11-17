# Yemek listesi – GitHub Actions ile

Bu proje, üniversite yemek listelerini **GitHub Actions** ile günde birkaç kez çekip repoya
`docs/data/*.json` olarak kaydeder. **GitHub Pages** bu JSON'ları herkese açık (ve CORS'a açık)
sunar. Sitenizdeki JavaScript doğrudan o JSON'u okur. Sunucu kurmanız, ücret ödemeniz gerekmez.

```
GitHub Actions (zamanlanmış)  ──►  scripts/fetch-menus.mjs  ──►  docs/data/hacettepe-1.json ...
                                                                       │ commit
                                                      GitHub Pages ◄───┘
                                                           │  (Access-Control-Allow-Origin: *)
                                                      Sizin siteniz: fetch("https://.../data/hacettepe-1.json")
```

## Adım adım kurulum

### 1. GitHub'da repo oluşturun
- github.com → **New repository** → ad: `yemek-listesi` (istediğiniz ad olur)
- **Public** seçin (ücretsiz Pages için gerekli; Actions süresi de public repoda sınırsızdır)
- README/gitignore eklemeyin (boş repo olsun)

### 2. Dosyaları yükleyin
Zip'i açın. Terminalde:

```bash
cd yemek-actions
git init -b main
git add .
git commit -m "İlk sürüm"
git remote add origin https://github.com/KULLANICI/yemek-listesi.git
git push -u origin main
```

Terminal kullanmak istemezseniz: repo sayfasında **uploading an existing file** → klasörün içindeki
her şeyi sürükleyin. **Dikkat:** `.github` klasörü gizli klasördür; Windows/macOS'ta gizli dosyaları
göstermeyi açın, yoksa workflow yüklenmez.

### 3. Actions'a yazma izni verin
Repo → **Settings → Actions → General → Workflow permissions** →
**Read and write permissions** seçin → **Save**.
(Workflow dosyasında `permissions: contents: write` var ama bu ayar kapalıysa yine push edemez.)

### 4. İlk çalıştırma
Repo → **Actions** sekmesi → "Yemek listelerini güncelle" → **Run workflow**.
Yaklaşık 1-2 dakika sürer (siteyi yormamak için istekler arasında bekler).
Yeşil tik gelince `docs/data/` altında `hacettepe-1.json`, `hacettepe-2.json` ve (başarılıysa) `anku.json`
oluşmuş olur. Actions'ın yaptığı commit'i **Code** sekmesinde görürsünüz.

İlk çalıştırma push'la da otomatik başlayabilir (workflow dosyasında `push` tetikleyicisi var).

### 5. GitHub Pages'i açın
Repo → **Settings → Pages** → **Build and deployment**:
- Source: **Deploy from a branch**
- Branch: **main**, klasör: **/docs** → **Save**

1-2 dakika sonra site yayında: `https://KULLANICI.github.io/yemek-listesi/`
- Örnek sayfa: `.../` (docs/index.html)
- Veri: `.../data/hacettepe-1.json`, `.../data/hacettepe-2.json`, `.../data/anku.json`

### 6. Kendi sitenizde kullanın

```html
<div id="menu">Yükleniyor…</div>
<script>
  const DATA = "https://KULLANICI.github.io/yemek-listesi/data";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }); // YYYY-MM-DD

  fetch(`${DATA}/hacettepe-1.json`)           // 1: Beytepe, 2: Sıhhiye
    .then(r => r.json())
    .then(d => {
      const ogle = d.days[today]?.meals.ogle;
      document.getElementById("menu").textContent =
        ogle?.items.length ? ogle.items.map(i => i.name).join(" · ") : "Bugün için menü yok";
    })
    .catch(() => (document.getElementById("menu").textContent = "Menü alınamadı"));
</script>
```

GitHub Pages `Access-Control-Allow-Origin: *` gönderdiği için başka sitelerden `fetch` çalışır.
Kendi sitenizi de aynı Pages'te barındırıyorsanız (`docs/` içine koyun) göreli yol (`./data/...`) yeterli.

## JSON biçimi

`hacettepe-<konum>.json`:

```json
{
  "source": "beslenme.hacettepe.edu.tr",
  "updated": "2026-11-17T15:20:11.000Z",
  "days": {
    "2026-11-17": {
      "date": "2026-11-17",
      "location": { "id": 1, "name": "Beytepe" },
      "meals": {
        "ogle": {
          "time": "11:30 - 14:00",
          "totalKcal": 1173,
          "items": [ { "category": "ÇORBA", "name": "Hanımağa Çorbası", "kcal": 260, "description": null, "allergens": [] } ],
          "text": null
        },
        "sabah": { "time": "08:00-09:15", "items": [], "text": "Sabah Kahvaltısı Çay ..." },
        "aksam": {}, "vegan": {}
      }
    }
  }
}
```

Bugünden başlayarak `DAYS_AHEAD` (varsayılan 7) günlük menü tutulur. Geçmiş günler her güncellemede düşer.

## Ayarlar

`.github/workflows/update-menus.yml` içinde:
- **Sıklık:** `cron: "17 * * * *"` -> her saat, :17'de (saatlik). Sadece gündüz isterseniz
  (07:00-22:00 İstanbul): `"17 4-19 * * *"`. Zaman UTC'dir (İstanbul = UTC+3). En sık 5 dakikada bir
  çalıştırılabilir. GitHub zamanlayıcısı yoğun saatlerde 5-30 dk gecikebilir, nadiren bir çalışmayı atlar.
  Tam saatte (`0`) çalıştırmayın. Public repoda dakika sınırı yok; private repoda ücretsiz 2.000 dk/ay,
  saatlik çalışma ayda yaklaşık 720 dk eder.
- **Gün sayısı / konum:** workflow'daki "Menüleri çek" adımına ortam değişkeni ekleyebilirsiniz:
  ```yaml
  - name: Menüleri çek
    run: node scripts/fetch-menus.mjs
    env:
      DAYS_AHEAD: "14"
      HACETTEPE_LOCATIONS: "1,2"
  ```

## Ankara Üniversitesi hakkında önemli not

Ankü menüsü `sksbasvuru.ankara.edu.tr/kayit/moduller/yemeklistesi/aylikmenu.php` adresinde.
Bu sayfanın HTML yapısını geliştirme sırasında **açıp doğrulayamadım**. Bu yüzden `parseAnku`
genel çalışır: sayfadaki tüm tabloları satır/hücre olarak `anku.json`'a yazar ve tarih içeren satırlara
`date` ekler. Yapılacaklar:

1. İlk çalıştırmadan sonra `docs/data/anku.json` dosyasını açın.
2. Tablonun hangi hücrede ne olduğunu görün (ör. 1. sütun tarih, 2. çorba...).
3. `src/parsers.mjs` içindeki `parseAnku` fonksiyonunu buna göre `{ date, soup, main, side, dessert }`
   gibi sadeleştirin (bana `anku.json` içeriğini gösterirseniz yazabilirim).

Ankü alınamazsa iş **kırmızı olmaz**; log'da sarı uyarı çıkar ve Hacettepe devam eder.
Hacettepe için hiçbir konumdan menü alınamazsa iş kırmızı olur ve GitHub size e-posta atar.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| `Permission denied ... github-actions[bot]` / push hatası | 3. adım: Workflow permissions → Read and write |
| Actions sekmesinde workflow görünmüyor | `.github/workflows/update-menus.yml` yüklenmemiş (gizli klasör) |
| Pages 404 | Settings → Pages'te `main` + `/docs` seçili mi? İlk yayın birkaç dakika sürer |
| `data/…json` 404 | Workflow'u bir kez çalıştırdınız mı? Actions'ta yeşil mi? |
| Menü eski görünüyor | Tarayıcı önbelleği; `fetch(url, { cache: "no-cache" })` kullanın. Pages'in kendi önbelleği ~10 dk olabilir |
| Hacettepe 0 gün | Site yapısı değişmiş olabilir; `src/parsers.mjs` içindeki `data-title`, `data-cal`, `section#ogle` varsayımlarına bakın |
| Birkaç ay sonra güncellemeler durdu | Repo 60 gün hareketsiz kalırsa GitHub zamanlanmış workflow'ları kapatır; Actions'tan yeniden etkinleştirin. Bot commit'leri genelde bunu önler ama garanti değildir |

## Yerelde deneme

```bash
node scripts/fetch-menus.mjs      # Node 20+; docs/data/ altına yazar
npx serve docs                    # docs/index.html'i yerelde aç
```

## Nezaket / yasal

İstekler sıralı ve aralıklıdır (günde 3 çalışma × ~16 istek). Çalışma sıklığını gereksiz artırmayın.
Verinin kaynağı ilgili üniversitelerdir; yayımlarken kaynağı belirtin ve üniversitelerin kullanım
koşullarını kontrol edin. Hacettepe menüsünde "zorunlu hallerde değişebilir" uyarısı vardır.
