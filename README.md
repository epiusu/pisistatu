# 📦 PisiLinux Paket Takip Sistemi

> **[developer.pisilinux.org/packages](https://developer.pisilinux.org/packages)** üzerindeki **6492+ paketi** harf harf tarayarak tablo halinde gösteren, mobil uyumlu, güvenli web arayüzü.
>
> **Token yok · Sunucu yok · Aç-çalıştır**

---

## 🖥️ Tablo Sütunları

| Sütun | Açıklama |
|-------|----------|
| **Paket Adı** | Paket adı — detay sayfasına bağlantı |
| **Sürüm** | Paket sürümü |
| **Kategori** | `system.base`, `desktop.kde.applications`, … |
| **Depo** | `main` veya `contrib` |
| **Durum** | Sürüm heuristiğine göre: Güncel / Orta / Eski / Alt paket |
| **Kısa Not** | Paket açıklaması + detay linki |

---

## ✨ Özellikler

| Özellik | Detay |
|---------|-------|
| 🌐 **Kaynak** | `developer.pisilinux.org/packages/search/[a-z]` |
| 🔄 **Otomatik tarama** | 26 harfi sırayla çeker, toplam ~6500 paket |
| 🔍 **Canlı arama** | Ad, sürüm, kategori, açıklama |
| 🗂️ **Filtreler** | Kategori + depo (main/contrib) + durum chip'leri |
| 💾 **localStorage önbelleki** | 30 dakika — sayfayı kapatıp açınca yeniden yüklemez |
| 📥 **CSV dışa aktarma** | Görünen listeyi UTF-8 BOM'lu CSV olarak indir |
| 📱 **Mobil uyumlu** | 320px kart görünümü, tablet orta sütun gizleme |
| 🛡️ **Güvenli** | XSS `escHtml()`, SSRF host kontrolü, input sanitize, CSP |

---

**Önizleme**
<img src="https://raw.githubusercontent.com/epiusu/pisistatu/refs/heads/main/plpts1.png" width="1170" height="690" class="aligncenter size-full" />

<img src="https://raw.githubusercontent.com/epiusu/pisistatu/refs/heads/main/plpts.gif" width="1170" height="690" class="aligncenter size-full" />

## 🚀 Kurulum

### En kolay: Yerel sunucu

```bash
# 1) İndir / klonla
git clone https://github.com/KULLANICI/pisilinux-tracker.git
cd pisilinux-tracker

# 2) Yerel sunucu başlat (CORS için gerekli)
python3 -m http.server 8080
# veya: npx serve .
# veya: php -S localhost:8080

# 3) Tarayıcıda aç
# http://localhost:8080
```

> ⚠️ **Önemli:** `file://` protokolüyle açıldığında bazı tarayıcılar `developer.pisilinux.org`'a yapılan istekleri CORS kuralı nedeniyle bloklar.
> Yerel bir sunucu (`http://localhost`) üzerinden çalıştırın.

### GitHub Pages

1. Repoyu fork'layın
2. **Settings → Pages → Source: `main` / `/ (root)`**
3. `https://KULLANICI.github.io/REPO/` adresinde yayına girer

---

## 📁 Dosya Yapısı

```
pisilinux-tracker/
├── index.html   ← HTML, CSP, ARIA erişilebilirlik
├── styles.css   ← Dark tema, mobile-first, CSS Grid kart görünümü
├── tracker.js   ← Tarayıcı, parser, önbellek, CSV, güvenlik
└── README.md
```

---

## 🔄 Nasıl Çalışır

```
Yükle butonu
    │
    ├─► localStorage'dan önbellek var mı?
    │       Evet → Direkt göster (30 dk geçerli)
    │       Hayır ↓
    │
    ├─► /packages/search/a  → HTML → DOMParser → paket listesi
    ├─► /packages/search/b  → ...
    │   ... (26 harf)
    ├─► /packages/search/z  → ...
    │
    ├─► Tüm paketleri birleştir (≈ 6500)
    ├─► Durum heuristiği uygula (sürüm bazlı)
    ├─► localStorage'a kaydet
    └─► Tabloya render et
```

---

## 🟢 Durum Mantığı

Gerçek tarih bilgisi olmadığı için sürüm bazlı heuristik uygulanır:

| Durum | Kriter |
|-------|--------|
| ✅ **Güncel** | Sürümde 2024+ yıl içeriyor veya normal versiyon |
| ⚠️ **Orta** | contrib deposu, alt paket (-devel/-docs/-32bit) veya 2020-2023 yıl |
| ❌ **Eski** | Sürümde < 2020 yıl tarihi |

> Gerçek güncelleme tarihi için GitHub commit geçmişine bakılması gerekir.

---

## 🔒 Güvenlik

| Katman | Uygulama |
|--------|----------|
| **CSP** | `connect-src` yalnızca `developer.pisilinux.org` |
| **XSS** | Tüm site verisi `escHtml()` ile sanitize |
| **SSRF** | Her `fetch` öncesi hostname `developer.pisilinux.org` kontrolü |
| **URL** | `safeUrl()` ile yalnızca güvenli HTTPS bağlantıları |
| **Input** | Arama: özel karakter temizleme + 100 karakter sınırı |

---

## 📱 Mobil Davranış

| Ekran | Görünüm |
|-------|---------|
| **≤ 540px** | Tablo satırları CSS Grid kartlara dönüşür |
| **541–768px** | Kategori sütunu gizlenir |
| **≥ 769px** | Tam 6 sütunlu tablo |

---

## 🌐 Tarayıcı Desteği

Chrome 90+, Firefox 90+, Safari 14+, Edge 90+

---

## 🔗 Bağlantılar

- 🐧 [pisilinux.org](https://pisilinux.org)
- 🛠️ [developer.pisilinux.org](https://developer.pisilinux.org)
- 🐙 [github.com/pisilinux](https://github.com/pisilinux)
- 📦 [Paket listesi](https://developer.pisilinux.org/packages)

---

**MIT Lisansı** · PisiLinux Topluluğu
