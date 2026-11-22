# İlan Savaşları

Fiyatı birbirine yakın iki ikinci el arabayı karşı karşıya getirip "hangisini alırdın?" diye soran, mobil öncelikli oylama sitesi.

**Özellikler:** versus eşleşmesi (±%8 fiyat bandı, farklı segment/yıl tercih edilir) · "Bunu alırım" / "Pazarlıkla alırım" / "İkisi de pahalı" · oy sonrası kazanma oranı · en çok kazananlar listesi · Google ile giriş · ilan ekleme · kendi ilanının performansı (gösterim, seçilme, pazarlık, "pahalı" sayısı, sıra) · paylaşılabilir düello linki (`#/v/12-34`) · Web Share.

## Mimari (sunucu maliyeti ≈ 0 ₺)

| Katman | Servis | Ücretsiz limit |
|---|---|---|
| Arayüz (statik) | Cloudflare Pages | Sınırsız bant genişliği ve istek |
| API | Pages Functions (Workers) | 100.000 istek/gün |
| Veritabanı | Cloudflare D1 (SQLite) | 5 milyon satır okuma/gün, 100.000 satır yazma/gün |

Trafik dostu tasarım:
- Ilan havuzu ve liderlik tablosu edge cache'te 60 sn tutulur → veritabanı okumaları trafikle neredeyse artmaz.
- Eşleştirme veritabanına gitmeden bellekte yapılır; sıradaki eşleşme istemcide önceden yüklenir.
- Bir oy yalnızca 2 satır günceller (sayaçlar). Oy kaydı tutulmaz. → günde ≈ **50.000 oy** ücretsiz limitte.
- Oy tokenları imzalıdır (sahte ID ile oy atılamaz), aynı token ikinci kez kullanılamaz.

**Viral olursa:** günlük limit dolarsa Workers Paid ($5/ay) D1 yazma/okuma ve istek limitlerini binlerce kat artırır; kodda değişiklik gerekmez.

## Domain

- Canlı: `https://ilan-savaslari.pages.dev` (ücretsiz, kart gerekmez). GitHub `main` dalına her push otomatik deploy edilir.
- Özel alan adı istersen `.com` ≈ 10 $/yıl; Cloudflare Registrar maliyetine satar (ek kâr yok). `.com.tr` için TRABIS/yetkili kayıtçı gerekir.

## Kurulum (≈ 10 dk)

```bash
npm i -g wrangler && wrangler login
wrangler d1 create arabavs            # (D1 adı arabavs kalıyor) çıkan database_id'yi wrangler.toml'a yaz
wrangler d1 execute arabavs --remote --file=schema.sql
wrangler d1 execute arabavs --remote --file=seed.sql     # örnek ilanlar (istersen atla)
wrangler pages project create ilan-savaslari --production-branch main
wrangler pages deploy public
wrangler pages secret put SESSION_SECRET                  # uzun rastgele bir metin
```

**Google girişi:** Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web). "Authorized JavaScript origins"e site adresini ekle. Client ID'yi `wrangler.toml` içindeki `GOOGLE_CLIENT_ID`'ye yaz ve tekrar `wrangler pages deploy public` çalıştır.

**Yerelde çalıştırma:**

Önce proje kökünde `.dev.vars` dosyası oluştur (API, `SESSION_SECRET` yoksa hata verir). Bu dosya `.gitignore`'da, repoya eklenmez:
```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .dev.vars
```
Sonra yerel veritabanını hazırlayıp çalıştır:
```bash
wrangler d1 execute arabavs --local --file=schema.sql
wrangler d1 execute arabavs --local --file=seed.sql
wrangler pages dev public        # http://localhost:8788
```
`/api` yoksa (ör. `index.html`'i doğrudan açarsan) site otomatik **demo moduna** geçer ve veriyi tarayıcıda tutar.

## Dosyalar
- `public/` — arayüz (`index.html`, `style.css`, `app.js`; `mock.js` + `seed-data.js` yalnızca demo için)
- `functions/api/[[path]].js` — tüm API
- `schema.sql`, `seed.sql`, `seed.json` — veritabanı ve örnek ilanlar (**örnek ilanlar gerçek değildir**)

## Yayına çıkmadan önce yapılması gerekenler
1. **Şikâyet / moderasyon:** ilanlar şu an anında yayına girer. "Şikâyet et" butonu ve onay kuyruğu eklenmeli (sahte/kötü niyetli ilan, telefon/link içeren notlar).
2. **Oy suistimali:** bot oylarına karşı Cloudflare Turnstile (ücretsiz) eklemek en kolay yol.
3. **Hukuki:** ilan sahibi verisi için KVKK aydınlatma metni; sitedeki ilanların gerçek satış ilanı mı yoksa oylama içeriği mi olduğunu açıkça belirt.
4. **Fotoğraf:** şimdilik yalnızca https linki. Yükleme için Cloudflare R2 (10 GB ücretsiz) eklenebilir.
5. **Sosyal paylaşım önizlemesi:** `og:image` ekle (düello başına dinamik görsel için Pages Function + SVG/PNG üretimi).
