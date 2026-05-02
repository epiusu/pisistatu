# 📦 PisiLinux Paket Takip Sistemi

> `https://github.com/pisilinux/main` deposundaki paketleri **modern UI**, **mobil uyumlu tablo** ve güvenlik odaklı takip aracı.

<h2 class="western"><span style="color: #1d1d1f;">🔗 <span style="font-family: system-ui, ui-sans-serif, apple-system, BlinkMacSystemFont, Inter, NotoSansHans, sans-serif;">Bağlantılar</span></span></h2>
<ul>
 	<li><span style="color: #1d1d1f;">🐧 </span><a href="https://pisilinux.org/" target="_blank" rel="noopener"><span style="color: #615ced;"><span style="font-family: system-ui, ui-sans-serif, apple-system, BlinkMacSystemFont, Inter, NotoSansHans, sans-serif;"><span style="font-size: medium;">pisilinux.org</span></span></span></a></li>
 	<li><span style="color: #1d1d1f;">🐙 </span><a href="https://github.com/pisilinux/main" target="_blank" rel="noopener"><span style="color: #615ced;"><span style="font-family: system-ui, ui-sans-serif, apple-system, BlinkMacSystemFont, Inter, NotoSansHans, sans-serif;"><span style="font-size: medium;">github.com/pisilinux</span></span></span></a></li>
 	<li><span style="color: #1d1d1f;">📦 </span><a href="https://github.com/pisilinux/main?spm=a2ty_o01.29997173.0.0.7b3955fbbLryE4" target="_blank" rel="noopener"><span style="color: #615ced;"><span style="font-family: system-ui, ui-sans-serif, apple-system, BlinkMacSystemFont, Inter, NotoSansHans, sans-serif;"><span style="font-size: medium;">main repo</span></span></span></a></li>
 	<li><span style="color: #1d1d1f;">📖 </span><a href="https://github.com/pisilinux/main/wiki/ADIM-ADIM-DOCKER-%C4%B0LE-DERLEME" target="_blank" rel="noopener"><span style="color: #615ced;"><span style="font-family: system-ui, ui-sans-serif, apple-system, BlinkMacSystemFont, Inter, NotoSansHans, sans-serif;"><span style="font-size: medium;">GitHub Wiki » Docker Kulanımı ve daha fazlası</span></span></span></a></li>
</ul>

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
