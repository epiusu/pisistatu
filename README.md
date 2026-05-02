# 📡 PisiLinux Feed Takip Sistemi

> `https://github.com/pisilinux/main` deposunun **Atom/RSS feed** akışını kullanarak paket güncellemelerini gerçek zamanlı takip eden modern web uygulaması.

## ✨ Neden Feed Tabanlı?

| Geleneksel API | Feed Tabanlı |
|---------------|-----------|
| ❌ ~3000+ API isteği (rate limit sorunu) | ✅ Tek feed isteği |
| ❌ 1-3 dakika yükleme süresi | ✅ <10 saniye |
| ❌ Karmaşık pspec.xml parsing | ✅ Standart Atom/RSS parser |
| ❌ GitHub token gereksinimi | ✅ Token gerekmez |
| ✅ Detaylı paket bilgisi | ⚠️ Özet bilgi (commit mesajı) |

## 🔗 Kullanılan Feed URL'leri

GitHub, repo aktiviteleri için yerleşik Atom feed desteği sunar [[7]]:
