/**
 * PisiLinux Paket Takip — Modern JS Edition
 * ES2022+ · DOMParser · AbortController · Intl API
 * @license MIT
 */
'use strict';

/* ───────────────────────────────────────────────
   Konfigürasyon — Immutable, Typed-like Structure
─────────────────────────────────────────────── */
const CONFIG = Object.freeze({
  REPO: {
    owner: 'pisilinux',
    name: 'main',
    branch: 'master',
  },
  API: {
    base: 'https://api.github.com',
    allowedHosts: ['github.com', 'api.github.com'],
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PisiLinux-Tracker/3.0',
    },
  },
  CACHE: {
    key: 'plx_pkg_v3',
    ttl: 15 * 60 * 1000, // 15 dakika
  },
  LIMITS: {
    searchMax: 100,
    thresholds: {
      updated: 7 * 86_400_000,   // ≤7 gün
      stale: 30 * 86_400_000,    // ≤30 gün
    },
  },
});

/* Durum Tanımları — Enum Pattern */
const STATUS = Object.freeze({
  UPDATED: { key: 'updated', label: 'Güncel', badge: 'badge-updated', icon: 'fa-circle-check', order: 0 },
  STALE: { key: 'stale', label: 'Orta', badge: 'badge-stale', icon: 'fa-triangle-exclamation', order: 1 },
  OLD: { key: 'old', label: 'Eski', badge: 'badge-old', icon: 'fa-circle-exclamation', order: 2 },
  UNKNOWN: { key: 'unknown', label: 'Bilinmiyor', badge: 'badge-unknown', icon: 'fa-question-circle', order: 3 },
});

/* ───────────────────────────────────────────────
   DOM Selector Helper — Null-safe
─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ───────────────────────────────────────────────
   Uygulama State'i — Reactive Pattern
─────────────────────────────────────────────── */
const appState = {
  packages: [],
  filtered: [],
  sort: { key: 'lastUpdate', asc: false },
  loading: false,
  abortController: null,
  rateLimit: { remaining: null, reset: null },
  
  // Getter: Filtrelenmiş ve sıralanmış veri
  get visiblePackages() {
    return this.filtered;
  },
};

/* ───────────────────────────────────────────────
   Güvenlik Modülü — Security Utilities
─────────────────────────────────────────────── */
const Security = {
  /** XSS: HTML entity encode */
  escapeHtml: (str) => {
    if (typeof str !== 'string') return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, (m) => map[m]);
  },

  /** URL Validation — SSRF Protection */
  validateUrl: (url, allowedHosts = CONFIG.API.allowedHosts) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return null;
      return allowedHosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? url : null;
    } catch {
      return null;
    }
  },

  /** Path Traversal Prevention */
  isSafePath: (...parts) => parts.every(p => /^[\w.\-/\s]+$/.test(p) && !p.includes('..')),

  /** Input Sanitization */
  sanitize: (input, maxLen = CONFIG.LIMITS.searchMax) =>
    String(input ?? '').slice(0, maxLen).replace(/[<>"'`;(){}[\]\\]/g, ''),
};

/* ───────────────────────────────────────────────
   Tarih & Format Modülü — Intl API
─────────────────────────────────────────────── */
const Formatter = {
  date: new Intl.DateTimeFormat('tr-TR', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }),

  relative: new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto' }),

  formatDate: (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d) ? 'Geçersiz' : Formatter.date.format(d);
  },

  formatRelative: (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.round(diff / 86_400_000);
    
    if (days === 0) return 'bugün';
    if (days < 7) return Formatter.relative.format(-days, 'day');
    if (days < 30) return Formatter.relative.format(-Math.round(days / 7), 'week');
    if (days < 365) return Formatter.relative.format(-Math.round(days / 30), 'month');
    return Formatter.relative.format(-Math.round(days / 365), 'year');
  },

  formatSize: (bytes) => {
    if (!bytes || isNaN(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  },
};

/* ───────────────────────────────────────────────
   XML Parser Modülü — DOMParser (Modern)
─────────────────────────────────────────────── */
const XMLParser = {
  /**
   * Atom/RSS feed parse et — DOMParser ile güvenli parsing
   * @param {string} xmlText - Raw XML string
   * @param {'atom'|'rss'} [type='atom'] - Feed türü
   * @returns {Array<FeedEntry>}
   */
  parseFeed: (xmlText, type = 'atom') => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    
    // Parse error kontrolü
    const error = doc.querySelector('parsererror');
    if (error) throw new Error(`XML Parse Hatası: ${error.textContent}`);
    
    const entries = doc.querySelectorAll(type === 'atom' ? 'entry' : 'item');
    
    return Array.from(entries).map(entry => ({
      id: entry.querySelector('id')?.textContent?.trim() 
          ?? entry.querySelector('guid')?.textContent?.trim()
          ?? crypto.randomUUID(),
      title: entry.querySelector('title')?.textContent?.trim() ?? 'Başlıksız',
      link: entry.querySelector('link')?.getAttribute('href')
            ?? entry.querySelector('link')?.textContent?.trim()
            ?? '#',
      published: entry.querySelector('published, pubDate, updated')?.textContent,
      updated: entry.querySelector('updated')?.textContent,
      summary: entry.querySelector('summary, description')?.textContent?.trim() ?? '',
      content: entry.querySelector('content')?.textContent?.trim() ?? '',
      author: entry.querySelector('author name')?.textContent 
              ?? entry.querySelector('author')?.textContent?.trim()
              ?? 'Bilinmeyen',
      categories: Array.from(entry.querySelectorAll('category')).map(c => c.getAttribute('term')).filter(Boolean),
    }));
  },

  /**
   * pspec.xml'den versiyon çıkar — DOMParser ile
   * @param {string} xmlText - Base64 decoded XML
   * @returns {string}
   */
  extractVersion: (xmlText) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      
      // History > Update > Version path'i
      const version = doc.querySelector('History > Update > Version')?.textContent?.trim();
      if (version) return version;
      
      // Fallback: Source > Version
      return doc.querySelector('Source > Version')?.textContent?.trim() ?? 'N/A';
    } catch {
      // Fallback regex (DOMParser başarısız olursa)
      const match = xmlText.match(/<Version>\s*([^\s<]{1,60})\s*<\/Version>/);
      return match?.[1]?.trim() ?? 'N/A';
    }
  },

  /**
   * pspec.xml'den paket özetini çıkar
   * @param {string} xmlText
   * @returns {string}
   */
  extractSummary: (xmlText) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      return doc.querySelector('Summary')?.textContent?.trim() ?? '';
    } catch {
      return '';
    }
  },
};

/* ───────────────────────────────────────────────
   GitHub API Client — Modern Fetch + AbortController
─────────────────────────────────────────────── */
const GitHubAPI = {
  /**
   * Güvenli GET isteği — AbortController destekli
   * @param {string} endpoint 
   * @param {Record<string, string>} params
   * @param {AbortSignal} [signal]
   * @returns {Promise<any>}
   */
  async get(endpoint, params = {}, signal = null) {
    // Validasyon
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
      throw new TypeError('Geçersiz endpoint formatı');
    }

    const url = new URL(`${CONFIG.API.base}${endpoint}`);
    
    // Params ekle — sadece string değerler
    Object.entries(params)
      .filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
      .forEach(([k, v]) => url.searchParams.set(k, v));

    // Host validation (SSRF protection)
    if (url.hostname !== 'api.github.com') {
      throw new SecurityError(`İzinsiz host: ${url.hostname}`);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: CONFIG.API.headers,
      cache: 'default',
      signal, // AbortController desteği
    });

    // Rate limit header'larını kaydet
    appState.rateLimit.remaining = response.headers.get('X-RateLimit-Remaining')?.parseInt() ?? null;
    appState.rateLimit.reset = response.headers.get('X-RateLimit-Reset')?.parseInt() 
      ? new Date(parseInt(response.headers.get('X-RateLimit-Reset')) * 1000) 
      : null;

    // Hata yönetimi
    if (!response.ok) {
      if (response.status === 403 && appState.rateLimit.remaining === 0) {
        const resetTime = appState.rateLimit.reset?.toLocaleTimeString('tr-TR') ?? 'bilinmiyor';
        throw new RateLimitError(`API limiti doldu. ${resetTime} sonra deneyin.`);
      }
      if (response.status === 404) throw new NotFoundError('Kaynak bulunamadı');
      throw new APIError(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Content-Type validation
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json') && !contentType.includes('javascript')) {
      throw new TypeError(`Beklenmeyen içerik türü: ${contentType}`);
    }

    return response.json();
  },

  /**
   * Base64 içerik decode + XML parse
   * @param {Object} contentRes - GitHub contents API yanıtı
   * @returns {Promise<string>}
   */
  async fetchAndParseXML(contentRes) {
    if (!contentRes?.content || typeof contentRes.content !== 'string') {
      throw new Error('Geçersiz içerik yanıtı');
    }
    
    // Base64 decode — güvenli karakter kontrolü
    const raw = contentRes.content.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
      throw new Error('Geçersiz base64 içerik');
    }
    
    return atob(raw);
  },
};

/* Özel Hata Sınıfları — Modern Class Syntax */
class APIError extends Error {
  constructor(message) {
    super(message);
    this.name = 'APIError';
  }
}

class RateLimitError extends APIError {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = appState.rateLimit.reset;
  }
}

class NotFoundError extends APIError {
  constructor(message = 'Kaynak bulunamadı') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}

/* ───────────────────────────────────────────────
   DOM Yönetim Modülü — Reactive Updates
─────────────────────────────────────────────── */
const DOM = {
  refs: {
    loading: $('#loading'),
    loadingDetail: $('#loadingDetail'),
    progressBar: $('#progressBar'),
    error: $('#error'),
    errorMessage: $('#errorMessage'),
    rateLimitWarn: $('#rateLimitWarn'),
    rateLimitMsg: $('#rateLimitMsg'),
    tableContainer: $('#tableContainer'),
    packageBody: $('#packageBody'),
    emptyState: $('#emptyState'),
    resultsCount: $('#resultsCount'),
    statusText: $('#statusText'),
    statusDot: document.querySelector('.status-bar .status-dot'),
    searchInput: $('#searchInput'),
    clearSearch: $('#clearSearch'),
    statusFilter: $('#statusFilter'),
    categoryFilter: $('#categoryFilter'),
    refreshBtn: $('#refreshBtn'),
    retryBtn: $('#retryBtn'),
    clearFilters: $('#clearFilters'),
    exportBtn: $('#exportBtn'),
    headerStats: $('#headerStats'),
    statUpdated: $('#statUpdated'),
    statStale: $('#statStale'),
    statOld: $('#statOld'),
    statTotal: $('#statTotal'),
    lastFetchTime: $('#lastFetchTime'),
  },

  showPanel: (name) => {
    const panels = ['loading', 'error', 'tableContainer', 'emptyState'];
    panels.forEach(id => {
      const el = DOM.refs[id];
      if (el) el.hidden = !(id === name || (name === 'table' && id === 'tableContainer'));
    });
    DOM.refs.resultsBar?.toggleAttribute('hidden', !['table', 'empty'].includes(name));
  },

  setStatus: (message, type = 'loading') => {
    DOM.refs.statusText.textContent = message;
    DOM.refs.statusDot?.className = `status-dot ${type === 'loading' ? 'pulsing' : type}`;
  },

  setProgress: (pct) => {
    DOM.refs.progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  },

  updateStats: (counts) => {
    const { updated, stale, old, total } = counts;
    DOM.refs.statUpdated.textContent = updated ?? 0;
    DOM.refs.statStale.textContent = stale ?? 0;
    DOM.refs.statOld.textContent = old ?? 0;
    DOM.refs.statTotal.textContent = total ?? 0;
    DOM.refs.headerStats.hidden = false;
  },
};

/* ───────────────────────────────────────────────
   Önbellek Modülü — sessionStorage + TTL
─────────────────────────────────────────────── */
const Cache = {
  get: () => {
    try {
      const raw = sessionStorage.getItem(CONFIG.CACHE.key);
      if (!raw) return null;
      
      const { timestamp, data } = JSON.parse(raw);
      const isExpired = Date.now() - timestamp > CONFIG.CACHE.ttl;
      
      return isExpired ? (Cache.clear(), null) : (Array.isArray(data) ? data : null);
    } catch {
      return null;
    }
  },

  set: (data) => {
    try {
      sessionStorage.setItem(CONFIG.CACHE.key, JSON.stringify({
        timestamp: Date.now(),
        data,
      }));
    } catch (e) {
      console.warn('Cache save failed:', e.message);
    }
  },

  clear: () => {
    try {
      sessionStorage.removeItem(CONFIG.CACHE.key);
    } catch {}
  },

  isValid: (data) => Array.isArray(data) && data.length > 0,
};

/* ───────────────────────────────────────────────
   Veri İşleme Modülü — Functional Pipeline
─────────────────────────────────────────────── */
const DataProcessor = {
  /** Durum hesaplama */
  calcStatus: (lastUpdate) => {
    if (!lastUpdate) return STATUS.UNKNOWN;
    const diff = Date.now() - new Date(lastUpdate).getTime();
    if (diff <= CONFIG.LIMITS.thresholds.updated) return STATUS.UPDATED;
    if (diff <= CONFIG.LIMITS.thresholds.stale) return STATUS.STALE;
    return STATUS.OLD;
  },

  /** Paket nesnesi oluştur — Immutable */
  createPackage: (base, details = {}) => Object.freeze({
    ...base,
    version: details.version ?? 'N/A',
    lastUpdate: details.lastUpdate ?? null,
    commitUrl: Security.validateUrl(details.commitUrl) ?? base.url,
    status: DataProcessor.calcStatus(details.lastUpdate),
    statusOrder: DataProcessor.calcStatus(details.lastUpdate).order,
  }),

  /** Filtreleme pipeline'ı */
  filter: (packages, filters) => {
    const { query, status, category } = filters;
    const now = Date.now();
    const q = Security.sanitize(query).toLowerCase();

    return packages.filter(pkg => {
      // Kategori filtresi
      if (category && category !== 'all' && pkg.category !== category) return false;
      
      // Durum filtresi
      if (status && status !== 'all' && pkg.lastUpdate) {
        const diff = now - new Date(pkg.lastUpdate).getTime();
        const thresholds = CONFIG.LIMITS.thresholds;
        if (status === 'updated' && diff > thresholds.updated) return false;
        if (status === 'stale' && (diff <= thresholds.updated || diff > thresholds.stale)) return false;
        if (status === 'old' && diff <= thresholds.stale) return false;
      }
      
      // Arama filtresi
      if (q) {
        const haystack = `${pkg.category} ${pkg.name} ${pkg.version}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      
      return true;
    });
  },

  /** Sıralama — Stable sort */
  sort: (packages, { key, asc }) => {
    return [...packages].toSorted((a, b) => {
      const va = a[key] ?? '';
      const vb = b[key] ?? '';
      
      // Özel durumlar
      if (key === 'lastUpdate') {
        const da = va ? new Date(va).getTime() : 0;
        const db = vb ? new Date(vb).getTime() : 0;
        return asc ? da - db : db - da;
      }
      if (key === 'statusOrder') {
        return asc ? (va - vb) : (vb - va);
      }
      
      // Default: locale-aware string compare
      const cmp = String(va).localeCompare(String(vb), 'tr', { numeric: true });
      return asc ? cmp : -cmp;
    });
  },
};

/* ───────────────────────────────────────────────
   Fetch Operations — Async Pipeline
─────────────────────────────────────────────── */
const FetchOps = {
  /** AbortController factory */
  createAbortController: () => {
    appState.abortController?.abort(); // Öncekini iptal et
    return appState.abortController = new AbortController();
  },

  /** Kategorileri getir */
  fetchCategories: async (signal) => {
    const items = await GitHubAPI.get(
      `/repos/${CONFIG.REPO.owner}/${CONFIG.REPO.name}/contents`,
      { ref: CONFIG.REPO.branch },
      signal
    );
    
    return items
      ?.filter(i => i?.type === 'dir' && typeof i?.name === 'string' && !i.name.startsWith('.'))
      .map(i => i.name) ?? [];
  },

  /** Kategori içindeki paketleri getir */
  fetchPackagesInCategory: async (category, signal) => {
    if (!Security.isSafePath(category)) return [];
    
    try {
      const items = await GitHubAPI.get(
        `/repos/${CONFIG.REPO.owner}/${CONFIG.REPO.name}/contents/${encodeURIComponent(category)}`,
        { ref: CONFIG.REPO.branch },
        signal
      );
      
      return items
        ?.filter(i => i?.type === 'dir' && typeof i?.name === 'string')
        .map(i => ({
          category,
          name: i.name,
          path: i.path,
          url: Security.validateUrl(i.html_url) ?? '#',
        })) ?? [];
    } catch (err) {
      console.warn(`[Kategori] ${category}:`, err.message);
      return [];
    }
  },

  /** Paket detayları — pspec.xml + commit */
  fetchPackageDetails: async (pkg, signal) => {
    if (!Security.isSafePath(pkg.path)) {
      return DataProcessor.createPackage(pkg);
    }

    try {
      // pspec.xml fetch + parse
      const pspecRes = await GitHubAPI.get(
        `/repos/${CONFIG.REPO.owner}/${CONFIG.REPO.name}/contents/${encodeURIComponent(pkg.path)}/pspec.xml`,
        { ref: CONFIG.REPO.branch },
        signal
      );
      
      const xmlContent = await GitHubAPI.fetchAndParseXML(pspecRes);
      const version = XMLParser.extractVersion(xmlContent);

      // Son commit bilgisi
      const [commit] = await GitHubAPI.get(
        `/repos/${CONFIG.REPO.owner}/${CONFIG.REPO.name}/commits`,
        { path: pkg.path, ref: CONFIG.REPO.branch, per_page: '1' },
        signal
      ) ?? [];

      return DataProcessor.createPackage(pkg, {
        version,
        lastUpdate: commit?.commit?.author?.date,
        commitUrl: commit?.html_url,
      });
    } catch (err) {
      console.warn(`[Detay] ${pkg.name}:`, err.message);
      return DataProcessor.createPackage(pkg);
    }
  },
};

/* ───────────────────────────────────────────────
   Tablo Render — DocumentFragment + Template
─────────────────────────────────────────────── */
const TableRenderer = {
  /** Tek bir satır oluştur */
  createRow: (pkg) => {
    const tr = document.createElement('tr');
    const status = pkg.status ?? STATUS.UNKNOWN;

    tr.innerHTML = `
      <td class="td-category"><i class="fa-solid fa-folder"></i> ${Security.escapeHtml(pkg.category)}</td>
      <td class="td-name"><strong>${Security.escapeHtml(pkg.name)}</strong></td>
      <td class="td-version"><span class="version-tag"><i class="fa-solid fa-code-branch"></i> ${Security.escapeHtml(pkg.version)}</span></td>
      <td class="td-date">
        ${pkg.lastUpdate ? Formatter.formatDate(pkg.lastUpdate) : '—'}
        <span class="relative-time">${pkg.lastUpdate ? Formatter.formatRelative(pkg.lastUpdate) : ''}</span>
      </td>
      <td class="td-status">
        <span class="status-badge ${status.badge}" role="status">
          <i class="fa-solid ${status.icon}"></i>${Security.escapeHtml(status.label)}
        </span>
      </td>
      <td class="td-actions">
        <a href="${Security.escapeHtml(pkg.url)}" class="action-btn primary" target="_blank" rel="noopener noreferrer">
          <i class="fa-solid fa-folder-open"></i>Klasör
        </a>
        <a href="${Security.escapeHtml(pkg.commitUrl)}" class="action-btn secondary" target="_blank" rel="noopener noreferrer">
          <i class="fa-solid fa-code-commit"></i>Commit
        </a>
      </td>
    `;
    
    return tr;
  },

  /** Tüm tabloyu render et — DocumentFragment ile performans */
  render: (packages) => {
    const tbody = DOM.refs.packageBody;
    if (!tbody) return;

    const fragment = document.createDocumentFragment();
    
    // Empty state
    if (!packages?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Paket bulunamadı.</td></tr>`;
      return;
    }

    // Batch render
    packages.forEach(pkg => {
      fragment.appendChild(TableRenderer.createRow(pkg));
    });
    
    tbody.replaceChildren(fragment);
  },
};

/* ───────────────────────────────────────────────
   CSV Export — Modern Blob API
─────────────────────────────────────────────── */
const Exporter = {
  toCSV: (packages) => {
    const headers = ['Kategori', 'Paket Adı', 'Versiyon', 'Son Güncelleme', 'Durum', 'URL'];
    const rows = packages.map(p => [
      p.category,
      p.name,
      p.version,
      p.lastUpdate ?? '',
      p.status?.label ?? 'Bilinmiyor',
      Security.validateUrl(p.url) ?? '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    return new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  },

  download: (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

/* ───────────────────────────────────────────────
   Ana Yükleme Pipeline — Async/Await + Progress
─────────────────────────────────────────────── */
async function loadPackages(useCache = true) {
  if (appState.loading) return;
  appState.loading = true;

  const signal = FetchOps.createAbortController().signal;
  
  try {
    DOM.showPanel('loading');
    DOM.setStatus('GitHub API\'ye bağlanıyor…');
    DOM.setProgress(0);

    // Cache kontrolü
    if (useCache) {
      const cached = Cache.get();
      if (Cache.isValid(cached)) {
        appState.packages = cached;
        return onDataReady('cache');
      }
    }

    // 1. Kategorileri getir
    DOM.setStatus('Kategoriler taranıyor…');
    const categories = await FetchOps.fetchCategories(signal);
    DOM.setProgress(5);

    // 2. Paketleri paralel fetch — batch işlem
    let allPackages = [];
    for (let i = 0; i < categories.length; i++) {
      const pkgs = await FetchOps.fetchPackagesInCategory(categories[i], signal);
      allPackages = allPackages.concat(pkgs);
      
      DOM.setStatus(`Paketler: ${i + 1}/${categories.length} kategori — ${allPackages.length} paket`);
      DOM.setProgress(5 + ((i + 1) / categories.length) * 25);
      await new Promise(r => setTimeout(r, 30)); // Rate limit friendly
    }

    // 3. Detayları getir — concurrent limit ile
    const CONCURRENCY = 5;
    const results = [];
    
    for (let i = 0; i < allPackages.length; i += CONCURRENCY) {
      const batch = allPackages.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(pkg => FetchOps.fetchPackageDetails(pkg, signal))
      );
      
      results.push(...batchResults
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
      );
      
      DOM.setProgress(30 + ((i + batch.length) / allPackages.length) * 70);
      DOM.setStatus(`Detaylar: ${results.length}/${allPackages.length} paket`);
    }

    // Cache + state update
    Cache.set(results);
    appState.packages = results;
    
    onDataReady('api');
    
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Request aborted');
      return;
    }
    handleError(err);
  } finally {
    appState.loading = false;
    DOM.refs.refreshBtn?.classList.remove('loading');
  }
}

/* Veri hazır: UI güncelle */
function onDataReady(source) {
  populateCategoryFilter(appState.packages);
  applyFilters();
  updateStats();
  DOM.showPanel('table');
  
  DOM.setStatus(`${appState.packages.length} paket yüklendi (${source})`, 'ok');
  DOM.refs.lastFetchTime.textContent = `Son: ${Formatter.formatDate(new Date().toISOString())}`;
  
  // Rate limit warning
  if (appState.rateLimit.remaining !== null && appState.rateLimit.remaining < 10) {
    const reset = appState.rateLimit.reset?.toLocaleTimeString('tr-TR') ?? '?';
    DOM.refs.rateLimitMsg.textContent = `Kalan: ${appState.rateLimit.remaining} · ${reset} sıfırlanır`;
    DOM.refs.rateLimitWarn.hidden = false;
  }
}

/* Hata yönetimi */
function handleError(err) {
  console.error('[App Error]', err);
  
  const message = err instanceof RateLimitError 
    ? err.message 
    : err instanceof SecurityError 
      ? 'Güvenlik hatası: İzin verilmeyen işlem' 
      : err.message ?? 'Beklenmeyen hata';
  
  DOM.refs.errorMessage.textContent = message;
  DOM.showPanel('error');
  DOM.setStatus('Hata', 'error');
}

/* ───────────────────────────────────────────────
   Filtreleme & Sıralama — Reactive
─────────────────────────────────────────────── */
function applyFilters() {
  const filters = {
    query: DOM.refs.searchInput?.value ?? '',
    status: DOM.refs.statusFilter?.value ?? 'all',
    category: DOM.refs.categoryFilter?.value ?? 'all',
  };

  const filtered = DataProcessor.filter(appState.packages, filters);
  const sorted = DataProcessor.sort(filtered, appState.sort);
  
  appState.filtered = sorted;
  
  // UI update
  if (!sorted.length && appState.packages.length) {
    DOM.showPanel('empty');
  } else {
    DOM.showPanel('table');
    TableRenderer.render(sorted);
  }
  
  DOM.refs.resultsCount.textContent = 
    `${sorted.length} paket` + 
    (sorted.length !== appState.packages.length ? ` (${appState.packages.length} içinden)` : '');
}

/* Kategori filtresini populate et */
function populateCategoryFilter(packages) {
  const select = DOM.refs.categoryFilter;
  if (!select) return;
  
  const categories = [...new Set(packages.map(p => p.category))].toSorted((a, b) => 
    a.localeCompare(b, 'tr')
  );
  
  select.replaceChildren(
    new Option('🗂️ Tüm Kategoriler', 'all'),
    ...categories.map(c => new Option(c, c))
  );
}

/* İstatistikleri güncelle */
function updateStats() {
  const counts = appState.packages.reduce((acc, p) => {
    const key = p.status?.key;
    if (key === 'updated') acc.updated++;
    else if (key === 'stale') acc.stale++;
    else acc.old++;
    return acc;
  }, { updated: 0, stale: 0, old: 0 });
  
  DOM.updateStats({
    ...counts,
    total: appState.packages.length,
  });
}

/* ───────────────────────────────────────────────
   Event Handlers — Modern Delegation
─────────────────────────────────────────────── */
function setupEventListeners() {
  // Arama input — debounce ile optimize
  let searchTimer;
  DOM.refs.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      DOM.refs.clearSearch.hidden = !e.target.value;
      applyFilters();
    }, 150);
  });
  
  DOM.refs.clearSearch?.addEventListener('click', () => {
    DOM.refs.searchInput.value = '';
    DOM.refs.clearSearch.hidden = true;
    DOM.refs.searchInput.focus();
    applyFilters();
  });
  
  // Filtre değişiklikleri
  ['statusFilter', 'categoryFilter'].forEach(id => {
    DOM.refs[id]?.addEventListener('change', applyFilters);
  });
  
  // Yenile butonu
  DOM.refs.refreshBtn?.addEventListener('click', () => {
    Cache.clear();
    DOM.refs.refreshBtn.classList.add('loading');
    loadPackages(false);
  });
  
  // Retry butonu
  DOM.refs.retryBtn?.addEventListener('click', () => {
    Cache.clear();
    loadPackages(false);
  });
  
  // Filtreleri temizle
  DOM.refs.clearFilters?.addEventListener('click', () => {
    DOM.refs.searchInput.value = '';
    DOM.refs.statusFilter.value = 'all';
    DOM.refs.categoryFilter.value = 'all';
    DOM.refs.clearSearch.hidden = true;
    applyFilters();
  });
  
  // CSV export
  DOM.refs.exportBtn?.addEventListener('click', () => {
    const blob = Exporter.toCSV(appState.filtered);
    Exporter.download(blob, `pisilinux-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  
  // Tablo başlık sıralama
  document.querySelectorAll('.package-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (!key) return;
      
      // Toggle sort direction
      appState.sort.asc = appState.sort.key === key ? !appState.sort.asc : key !== 'lastUpdate';
      appState.sort.key = key;
      
      // ARIA update
      document.querySelectorAll('.package-table th[data-sort]').forEach(t => {
        t.setAttribute('aria-sort', 'none');
        t.classList.remove('sorted');
      });
      th.setAttribute('aria-sort', appState.sort.asc ? 'ascending' : 'descending');
      th.classList.add('sorted');
      
      applyFilters();
    });
    
    // Klavye erişimi
    th.addEventListener('keydown', (e) => {
      if (['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        th.click();
      }
    });
  });
  
  // Sayfa visibility — otomatik pause/resume
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      appState.abortController?.abort();
    }
  });
}

/* ───────────────────────────────────────────────
   Initialization — DOMContentLoaded
─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadPackages(true);
});

/* ───────────────────────────────────────────────
   Global Error Handler — Uncaught Promise
─────────────────────────────────────────────── */
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise:', event.reason);
  event.preventDefault();
});