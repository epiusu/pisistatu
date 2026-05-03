# 📦 PisiLinux Paket Takip Sistemi

> [`github.com/pisilinux/main`](https://github.com/pisilinux/main) deposundaki tüm paketlerin güncelleme durumlarını **tarihine göre** otomatik takip eden, güvenli, mobil uyumlu web arayüzü.
>
> **Token gerekmez · Sunucu gerekmez · Tek klasör, aç-çalıştır**

---

## 🖥️ Tablo Sütunları

| Sütun | Açıklama |
|-------|----------|
| **Paket Adı** | Paket adı (kategori altında) · GitHub klasörüne bağlantı |
| **Boyut** | `pspec.xml` dosyasının KB cinsinden boyutu |
| **Sistem** | Paket sistemi (pisi) |
| **Güncel** | Son commit tarihi |
| **Güncel olmayan** | Kaç gün/hafta/ay önce güncellendiği |
| **Durum** | ✅ Güncel / ⚠️ Orta / ❌ Eski |
| **Kısa Not** | Okunabilir özet + son commit bağlantısı |

---

## ✨ Özellikler

- 🔄 **Otomatik tarama** — GitHub API üzerinden tüm kategori ve paketler
- 📅 **Tarih bazlı durum** — Son commit'e göre sınıflandırma
- 🔍 **Canlı arama** — Paket adı, kategori, versiyon
- 🗂️ **Kategori filtresi** — API'den otomatik doldurulur
- 📊 **Chip istatistikler** — Güncel / Orta / Eski sayıları
- 💾 **sessionStorage önbelleki** — 15 dk, gereksiz API isteği yok
- 📥 **CSV dışa aktarma** — Görünen listeyi tek tıkla indir
- 📱 **Mobil uyumlu** — 320px'e kadar tam destek (kart görünümü)
- 🛡️ **Güvenli** — XSS, SSRF, Path Traversal korumaları + CSP
<!-- Responsive GIF resim -->
<img
  src="https://raw.githubusercontent.com/epiusu/pisistatu/refs/heads/main/plpts.gif"
  alt="plpts animated gif"
  style="
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
  "
/>
<img
  src="https://raw.githubusercontent.com/epiusu/pisistatu/refs/heads/main/plpts1.png"
  alt="plpts animated gif"
  style="
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
  "
/>
<img
  src="https://raw.githubusercontent.com/epiusu/pisistatu/refs/heads/main/plpts2.png"
  alt="plpts animated gif"
  style="
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
  "
/>
---

## 🚀 Kurulum

### Seçenek 1 — Doğrudan aç (en kolay)

```bash
git clone https://github.com/KULLANICI/pisilinux-tracker.git
cd pisilinux-tracker
# index.html dosyasını tarayıcınızda açın
```

> ⚠️ Bazı tarayıcılar `file://` protokolünde CORS kısıtlar. Aşağıdaki yöntemler daha güvenilirdir.

### Seçenek 2 — Yerel sunucu

```bash
# Python 3
python3 -m http.server 8080

# Node.js
npx serve .

# Tarayıcı: http://localhost:8080
```

### Seçenek 3 — GitHub Pages

1. Repoyu fork'layın
2. **Settings → Pages → Source: `main` / `/ (root)`**
3. `https://KULLANICI.github.io/REPO/` adresinde yayına girer

---

## 📁 Dosya Yapısı

```
pisilinux-tracker/
├── index.html   ← HTML yapısı, CSP, ARIA
├── styles.css   ← Dark tema, mobile-first CSS
├── tracker.js   ← API istemcisi, güvenlik, önbellek
└── README.md
```

---

## 🔒 Güvenlik

| Katman | Uygulama |
|--------|----------|
| **CSP** | `connect-src` yalnızca `api.github.com` |
| **XSS** | Tüm API verileri `escHtml()` ile sanitize |
| **SSRF** | Her `fetch` öncesi hostname doğrulaması |
| **URL** | Tüm bağlantılar `safeUrl()` ile `github.com` whitelist kontrolü |
| **Input** | Arama girdisi özel karakter temizleme + 100 karakter sınırı |
| **Rate limit** | `X-RateLimit-Remaining` izleme + kullanıcı uyarısı |

---

## ⚡ GitHub API Limitleri

Token olmadan: **60 istek/saat**

| İşlem | İstek sayısı |
|-------|-------------|
| Kategoriler | 1 |
| Paket listesi | ~kategori sayısı |
| pspec.xml + commit / paket | 2 |
| Toplam (~1800 paket) | ~3700 |

**Bu nedenle:**
- İlk yükleme 15 dakika önbelleğe alır
- "Yenile" butonu önbelleği temizleyip yeniden çeker
- Kısa aralıklarla defalarca çalıştırmaktan kaçının

---

## 📊 Durum Eşikleri

| Durum | Kriter |
|-------|--------|
| ✅ Güncel | Son 7 gün içinde güncellendi |
| ⚠️ Orta | 7–30 gün arası |
| ❌ Eski | 30 günden uzun süredir güncellenmedi |

`tracker.js` → `THRESHOLDS` sabitinden değiştirilebilir.

---

## 📱 Mobil Davranış

- **≤ 540px** → Tablo satırları karta dönüşür (CSS Grid)
- **541–768px** → Boyut ve Sistem sütunları gizlenir
- **≥ 769px** → Tam tablo görünümü

---

## 🌐 Tarayıcı Desteği

Chrome 90+, Firefox 90+, Safari 14+, Samsung Internet 14+

---

## 🔗 Bağlantılar

- 🐧 [pisilinux.org](https://pisilinux.org)
- 🐙 [github.com/pisilinux](https://github.com/pisilinux)
- 📦 [github.com/pisilinux/main](https://github.com/pisilinux/main)

---

**MIT Lisansı** · PisiLinux Topluluğu
