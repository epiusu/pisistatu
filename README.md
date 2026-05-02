# 📦 PisiLinux Paket Takip Sistemi

> `https://github.com/pisilinux/main` deposundaki paketleri **modern UI**, **mobil uyumlu tablo** ve güvenlik odaklı takip aracı.

🔗 Bağlantılar
    • 🐧 pisilinux.org
    • 🐙 github.com/pisilinux
    • 📦 main repo
    • 📖 GitHub API Docs

## ✨ Özellikler

| Özellik | Açıklama |
|---------|----------|
| 🎨 Modern UI | Koyu tema, FontAwesome simgeler, animasyonlar |
| 📱 Mobil Uyumlu | Kart görünümü (mobil) / Tablo (masaüstü) |
| 🔍 Canlı Arama | Paket adı, kategori, versiyon, not içinde arama |
| 🗂️ Kategori Filtresi | Repo'dan otomatik çekilen kategoriler |
| 📊 İstatistikler | Güncel/Orta/Eski paket sayıları |
| 💾 Önbellek | 15 dk sessionStorage — gereksiz API isteği yok |
| 📥 CSV İndir | Görünen listeyi CSV olarak dışa aktar |
| 🛡️ Güvenlik | XSS, SSRF, Path Traversal, CSP korumaları |
| ♿ Erişilebilir | ARIA etiketleri, klavye navigasyonu, skip-link |

## 📋 Tablo Sütunları

| Sütun | Açıklama |
|-------|----------|
| 📦 Paket Adı | Paketin adı (link ile klasöre gider) |
| 📏 Boyutu | pspec.xml'den okunan paket boyutu |
| 🔧 Paket Sistemi | Sabit: `pisi` (PisiLinux) |
| ✅ Güncel | Son güncelleme tarihi (bağıl zaman) |
| ❌ Eski | Durum badge'i: Güncel/Orta/Eski |
| 📝 Kısa Not | pspec.xml'den `<Summary>` alanı |

## 🚀 Kurulum

### Seçenek 1: Doğrudan Tarayıcı
```bash
git clone https://github.com/KULLANICI/pisilinux-tracker.git
cd pisilinux-tracker
# index.html'yi tarayıcıda açın
