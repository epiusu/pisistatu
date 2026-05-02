/**
 * PisiLinux Paket Takip — tracker.js
 * Modern UI · Mobile Responsive · Güvenli
 * @license MIT
 */
'use strict';

/* ───────────────────────────────────────────────
   Konfigürasyon
─────────────────────────────────────────────── */
const CONFIG = Object.freeze({
  REPO_OWNER: 'pisilinux',
  REPO_NAME: 'main',
  BRANCH: 'master',
  API_BASE: 'https://api.github.com',
  CACHE_KEY: 'plx_tracker_v3',
  CACHE_TTL: 15 * 60 * 1000, // 15 dakika
  MAX_INPUT: 100,
  THRESHOLDS: {
    updated: 7 * 86400000,   // ≤7 gün
    stale: 30 * 86400000,    // ≤30 gün
  }
});

/* Durum Tanımları */
const STATUS = Object.freeze({
  updated: { key: 'updated', label: 'Güncel', badge: 'badge-updated', icon: 'fa-circle-check' },
  stale: { key: 'stale', label: 'Orta', badge: 'badge-stale', icon: 'fa-clock' },
  old: { key: 'old', label: 'Eski', badge: 'badge-old', icon: 'fa-triangle-exclamation' },
  unknown: { key: 'unknown', label: '?', badge: 'badge-unknown', icon: 'fa-question' }
});

/* ───────────────────────────────────────────────
   DOM Referansları
─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const DOM = {
  loading: $('loading'),
  loadingDetail: $('loadingDetail'),
  progressBar: $('progressBar'),
  error: $('error'),
  errorMessage: $('errorMessage'),
  rateLimitWarn: $('rateLimitWarn'),
  rateLimitMsg: $('rateLimitMsg'),
  tableContainer: $('tableContainer'),
  packageBody: $('packageBody'),
  empty: $('empty'),
  resultsCount: $('resultsCount'),
  statusText: $('statusText'),
  statusDot: document.querySelector('.status-dot'),
  lastFetch: $('lastFetch'),
  search: $('searchInput'),
  clearSearch: $('clearSearch'),
  statusFilter: $('statusFilter'),
  categoryFilter: $('categoryFilter'),
  refresh: $('refreshBtn'),
  retry: $('retryBtn'),
  clearFilters: $('clearFilters'),
  export: $('exportBtn'),
  export2: $('exportBtn2'),
  stats: $('stats'),
  statUpdated: $('statUpdated'),
  statStale: $('statStale'),
  statOld: $('statOld'),
  statTotal: $('statTotal')
};

/* ───────────────────────────────────────────────
   Uygulama Durumu
─────────────────────────────────────────────── */
let state = {
  packages: [],
  filtered: [],
  sortKey: 'name',
  sortAsc: true,
  loading: false,
  rateLimit: { remaining: null, reset: null }
};

/* ───────────────────────────────────────────────
   Güvenlik Yardımcıları
─────────────────────────────────────────────── */
function escHtml(str) {
  if (typeof str !== 'string') return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function safeUrl(url, allowed = ['github.com', 'api.github.com']) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const ok = allowed.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
    return ok ? url : null;
  } catch { return null; }
}

function isSafePath(...parts) {
  return parts.every(p => /^[\w.\-/\s]+$/.test(p) && !p.includes('..'));
}

function sanitizeInput(s) {
  return String(s).slice(0, CONFIG.MAX_INPUT).replace(/[<>"'`;(){}[\]\\]/g, '');
}

/* ───────────────────────────────────────────────
   Yardımcı Fonksiyonlar
─────────────────────────────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('tr-TR', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'bugün';
  if (days < 7) return `${days} gün önce`;
  if (days < 30) return `${Math.floor(days/7)} hf önce`;
  if (days < 365) return `${Math.floor(days/30)} ay önce`;
  return `${Math.floor(days/365)} yıl önce`;
}

function calcStatus(date) {
  if (!date) return STATUS.unknown;
  const diff = Date.now() - new Date(date).getTime();
  if (diff <= CONFIG.THRESHOLDS.updated) return STATUS.updated;
  if (diff <= CONFIG.THRESHOLDS.stale) return STATUS.stale;
  return STATUS.old;
}

function extractVersion(xml) {
  if (typeof xml !== 'string') return 'N/A';
  const m = xml.match(/<Version>\s*([^\s<]{1,60})\s*<\/Version>/);
  return m ? m[1].trim() : 'N/A';
}

function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let num = bytes;
  while (num >= 1024 && i < units.length - 1) { num /= 1024; i++; }
  return `${num.toFixed(num < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function setProgress(pct) {
  if (DOM.progressBar) {
    DOM.progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }
}

function setStatus(msg, type = 'loading') {
  if (DOM.statusText) DOM.statusText.textContent = msg;
  if (DOM.statusDot) {
    DOM.statusDot.className = 'status-dot';
    if (type === 'loading') DOM.statusDot.classList.add('pulsing');
    if (type === 'ok') DOM.statusDot.classList.add('ok');
    if (type === 'error') DOM.statusDot.classList.add('error');
  }
}

/* ───────────────────────────────────────────────
   Önbellek (sessionStorage)
─────────────────────────────────────────────── */
const Cache = {
  load() {
    try {
      const raw = sessionStorage.getItem(CONFIG.CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CONFIG.CACHE_TTL) { this.clear(); return null; }
      return Array.isArray(data) ? data : null;
    } catch { return null; }
  },
  save(data) {
    try {
      sessionStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  },
  clear() {
    try { sessionStorage.removeItem(CONFIG.CACHE_KEY); } catch {}
  }
};

/* ───────────────────────────────────────────────
   GitHub API İstemcisi
─────────────────────────────────────────────── */
const GH = {
  async get(endpoint, params = {}) {
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
      throw new Error('Geçersiz endpoint');
    }
    
    const url = new URL(`${CONFIG.API_BASE}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (typeof k === 'string' && typeof v === 'string') {
        url.searchParams.set(k, v);
      }
    }
    
    if (url.hostname !== 'api.github.com') {
      throw new Error('Güvenlik: izinsiz host');
    }
    
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PisiLinux-Tracker/3.0'
      },
      cache: 'default'
    });
    
    // Rate limit takibi
    const rem = res.headers.get('X-RateLimit-Remaining');
    const reset = res.headers.get('X-RateLimit-Reset');
    if (rem !== null) {
      state.rateLimit.remaining = parseInt(rem, 10);
      state.rateLimit.reset = reset ? new Date(parseInt(reset, 10) * 1000) : null;
    }
    
    if (!res.ok) {
      if (res.status === 403 && state.rateLimit.remaining === 0) {
        const t = state.rateLimit.reset?.toLocaleTimeString('tr-TR') || '?';
        throw new RateLimitError(`API limiti doldu. ${t} sonra deneyin.`);
      }
      if (res.status === 404) throw new Error('Kaynak bulunamadı (404)');
      throw new Error(`API Hatası: ${res.status}`);
    }
    
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json') && !ct.includes('javascript')) {
      throw new Error('Beklenmeyen içerik türü');
    }
    
    return res.json();
  }
};

class RateLimitError extends Error {
  constructor(msg) { super(msg); this.name = 'RateLimitError'; }
}

/* ───────────────────────────────────────────────
   Veri Çekme
─────────────────────────────────────────────── */
async function fetchCategories() {
  const items = await GH.get(
    `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents`,
    { ref: CONFIG.BRANCH }
  );
  if (!Array.isArray(items)) throw new Error('Geçersiz yanıt');
  return items
    .filter(i => i.type === 'dir' && typeof i.name === 'string' && !i.name.startsWith('.'))
    .map(i => i.name);
}

async function fetchPackagesInCategory(cat) {
  if (!isSafePath(cat)) return [];
  try {
    const items = await GH.get(
      `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${encodeURIComponent(cat)}`,
      { ref: CONFIG.BRANCH }
    );
    if (!Array.isArray(items)) return [];
    return items
      .filter(i => i.type === 'dir' && typeof i.name === 'string')
      .map(i => ({
        category: cat,
        name: i.name,
        path: i.path,
        url: safeUrl(i.html_url) || '#'
      }));
  } catch (e) {
    console.warn(`[Kategori] ${cat}:`, e.message);
    return [];
  }
}

async function fetchPackageDetails(pkg) {
  if (!isSafePath(pkg.path)) {
    return { ...pkg, version: 'N/A', size: null, system: 'pisi', lastUpdate: null, url: pkg.url, status: STATUS.unknown };
  }
  
  try {
    // pspec.xml
    const pspec = await GH.get(
      `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${encodeURIComponent(pkg.path)}/pspec.xml`,
      { ref: CONFIG.BRANCH }
    );
    
    let version = 'N/A', size = null, summary = '';
    if (pspec?.content && typeof pspec.content === 'string') {
      const raw = pspec.content.replace(/\s/g, '');
      if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
        try {
          const xml = atob(raw);
          version = extractVersion(xml);
          // Boyut: <Package><Part> veya <Source><Size>
          const sizeMatch = xml.match(/<Size[^>]*>(\d+)<\/Size>/);
          if (sizeMatch) size = parseInt(sizeMatch[1], 10);
          // Kısa not: <Summary>
          const sumMatch = xml.match(/<Summary[^>]*>([^<]{1,120})<\/Summary>/);
          if (sumMatch) summary = sumMatch[1].trim();
        } catch {}
      }
    }
    
    // Son commit
    const commits = await GH.get(
      `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/commits`,
      { path: pkg.path, ref: CONFIG.BRANCH, per_page: '1' }
    );
    
    const commit = Array.isArray(commits) && commits[0];
    const lastUpdate = commit?.commit?.author?.date || null;
    const commitUrl = safeUrl(commit?.html_url) || pkg.url;
    
    return {
      ...pkg,
      version,
      size,
      system: 'pisi', // PisiLinux paket sistemi
      lastUpdate,
      commitUrl,
      note: summary || '—',
      status: calcStatus(lastUpdate)
    };
  } catch (e) {
    console.warn(`[Detay] ${pkg.name}:`, e.message);
    return {
      ...pkg,
      version: 'N/A',
      size: null,
      system: 'pisi',
      lastUpdate: null,
      commitUrl: pkg.url,
      note: 'Hata',
      status: STATUS.unknown
    };
  }
}

/* ───────────────────────────────────────────────
   Ana Yükleme
─────────────────────────────────────────────── */
async function loadPackages(useCache = true) {
  if (state.loading) return;
  state.loading = true;
  
  showPanel('loading');
  setStatus('GitHub API bağlanıyor…');
  setProgress(0);
  
  try {
    // Önbellek
    if (useCache) {
      const cached = Cache.load();
      if (cached) {
        state.packages = cached;
        onDataReady('önbellek');
        return;
      }
    }
    
    // Kategoriler
    setStatus('Kategoriler taranıyor…');
    const cats = await fetchCategories();
    setProgress(5);
    
    // Paketler
    let all = [];
    for (let i = 0; i < cats.length; i++) {
      const pkgs = await fetchPackagesInCategory(cats[i]);
      all = all.concat(pkgs);
      setStatus(`Paketler: ${i+1}/${cats.length} kategori — ${all.length} paket`);
      setProgress(5 + ((i+1)/cats.length) * 25);
      await tick(40);
    }
    
    // Detaylar
    const results = [];
    for (let i = 0; i < all.length; i++) {
      const d = await fetchPackageDetails(all[i]);
      results.push(d);
      if (i % 10 === 9) {
        setStatus(`Detaylar: ${i+1}/${all.length}`);
        setProgress(30 + ((i+1)/all.length) * 70);
        await tick(60);
      }
    }
    
    setProgress(100);
    Cache.save(results);
    state.packages = results;
    onDataReady('API');
    
  } catch (e) {
    handleError(e);
  } finally {
    state.loading = false;
    DOM.refresh?.classList.remove('loading');
  }
}

function onDataReady(source) {
  populateCategories();
  applyFilters();
  updateStats();
  showPanel('table');
  setStatus(`${state.packages.length} paket yüklendi (${source})`, 'ok');
  if (DOM.lastFetch) {
    DOM.lastFetch.textContent = `Son: ${formatDate(new Date().toISOString())}`;
  }
  
  // Rate limit uyarısı
  if (state.rateLimit.remaining !== null && state.rateLimit.remaining < 10) {
    const t = state.rateLimit.reset?.toLocaleTimeString('tr-TR') || '?';
    if (DOM.rateLimitMsg) {
      DOM.rateLimitMsg.textContent = `Kalan: ${state.rateLimit.remaining} · ${t} sıfırlanır`;
    }
    if (DOM.rateLimitWarn) DOM.rateLimitWarn.hidden = false;
  }
}

function handleError(e) {
  console.error('[Hata]', e);
  const msg = e instanceof RateLimitError ? e.message : (e.message || 'Beklenmeyen hata');
  if (DOM.errorMessage) DOM.errorMessage.textContent = msg;
  showPanel('error');
  setStatus('Hata', 'error');
}

/* ───────────────────────────────────────────────
   UI Panelleri
─────────────────────────────────────────────── */
function showPanel(name) {
  const panels = ['loading', 'error', 'tableContainer', 'empty'];
  panels.forEach(id => {
    const el = DOM[id] || $(id);
    if (el) el.hidden = (id !== name && !(name === 'table' && id === 'tableContainer'));
  });
  if (DOM.stats) DOM.stats.hidden = (name !== 'table');
}

/* ───────────────────────────────────────────────
   Filtreleme & Sıralama
─────────────────────────────────────────────── */
function applyFilters() {
  const q = sanitizeInput(DOM.search?.value || '').toLowerCase().trim();
  const statF = DOM.statusFilter?.value || 'all';
  const catF = DOM.categoryFilter?.value || 'all';
  const now = Date.now();
  
  let result = state.packages.filter(p => {
    if (catF !== 'all' && p.category !== catF) return false;
    
    if (statF !== 'all' && p.lastUpdate) {
      const diff = now - new Date(p.lastUpdate).getTime();
      if (statF === 'updated' && diff > CONFIG.THRESHOLDS.updated) return false;
      if (statF === 'stale' && (diff <= CONFIG.THRESHOLDS.updated || diff > CONFIG.THRESHOLDS.stale)) return false;
      if (statF === 'old' && diff <= CONFIG.THRESHOLDS.stale) return false;
    }
    
    if (q) {
      const h = `${p.category} ${p.name} ${p.version} ${p.note}`.toLowerCase();
      if (!h.includes(q)) return false;
    }
    return true;
  });
  
  result = sortPkgs(result, state.sortKey, state.sortAsc);
  state.filtered = result;
  
  if (result.length === 0 && state.packages.length > 0) {
    showPanel('empty');
  } else {
    showPanel('table');
    renderTable(result);
  }
  
  if (DOM.resultsCount) {
    DOM.resultsCount.textContent = `${result.length} paket` + 
      (result.length !== state.packages.length ? ` (${state.packages.length} içinden)` : '');
  }
}

function sortPkgs(pkgs, key, asc) {
  return [...pkgs].sort((a, b) => {
    let va = a[key] ?? '', vb = b[key] ?? '';
    
    if (key === 'lastUpdate') {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
      return asc ? va - vb : vb - va;
    }
    if (key === 'size') {
      va = va ?? 0; vb = vb ?? 0;
      return asc ? va - vb : vb - va;
    }
    if (key === 'status') {
      const order = { updated: 0, stale: 1, old: 2, unknown: 3 };
      va = order[a.status?.key] ?? 3;
      vb = order[b.status?.key] ?? 3;
      return asc ? va - vb : vb - va;
    }
    
    const cmp = String(va).localeCompare(String(vb), 'tr', { numeric: true });
    return asc ? cmp : -cmp;
  });
}

/* ───────────────────────────────────────────────
   Tablo Render
─────────────────────────────────────────────── */
function renderTable(pkgs) {
  if (!DOM.packageBody) return;
  const frag = document.createDocumentFragment();
  
  pkgs.forEach(p => {
    const tr = document.createElement('tr');
    const st = p.status || STATUS.unknown;
    
    // Paket Adı
    const tdName = document.createElement('td');
    tdName.className = 'td-name';
    tdName.innerHTML = `<strong><i class="fa-solid fa-box-open"></i> ${escHtml(p.name)}</strong>`;
    
    // Boyut
    const tdSize = document.createElement('td');
    tdSize.className = 'td-size';
    tdSize.innerHTML = `<span class="size-tag">${formatSize(p.size)}</span>`;
    
    // Sistem
    const tdSys = document.createElement('td');
    tdSys.className = 'td-system';
    tdSys.innerHTML = `<span class="system-badge"><i class="fa-solid fa-cube"></i> ${escHtml(p.system)}</span>`;
    
    // Güncel (son güncelleme tarihi)
    const tdCurrent = document.createElement('td');
    tdCurrent.className = 'td-current';
    tdCurrent.innerHTML = p.lastUpdate 
      ? `<span title="${escHtml(formatDate(p.lastUpdate))}">${escHtml(relativeTime(p.lastUpdate))}</span>`
      : '<span>—</span>';
    
    // Eski (durum badge)
    const tdOld = document.createElement('td');
    tdOld.className = 'td-old';
    tdOld.innerHTML = `<span class="status-badge ${st.badge}"><i class="fa-solid ${st.icon}"></i> ${escHtml(st.label)}</span>`;
    
    // Kısa Not
    const tdNote = document.createElement('td');
    tdNote.className = 'td-note';
    tdNote.innerHTML = `<span class="note-text" title="${escHtml(p.note)}">${escHtml(p.note)}</span>`;
    
    // Aksiyonlar
    const tdAct = document.createElement('td');
    tdAct.className = 'td-actions';
    const folderUrl = safeUrl(p.url) || '#';
    const commitUrl = safeUrl(p.commitUrl) || '#';
    
    tdAct.innerHTML = `
      <a href="${escHtml(folderUrl)}" class="action-link" target="_blank" rel="noopener noreferrer">
        <i class="fa-solid fa-folder"></i>
      </a>
      <a href="${escHtml(commitUrl)}" class="action-link" target="_blank" rel="noopener noreferrer">
        <i class="fa-solid fa-code-commit"></i>
      </a>
    `;
    
    tr.appendChild(tdName);
    tr.appendChild(tdSize);
    tr.appendChild(tdSys);
    tr.appendChild(tdCurrent);
    tr.appendChild(tdOld);
    tr.appendChild(tdNote);
    tr.appendChild(tdAct);
    
    frag.appendChild(tr);
  });
  
  DOM.packageBody.replaceChildren(frag);
}

/* ───────────────────────────────────────────────
   İstatistikler & Kategori Filtresi
─────────────────────────────────────────────── */
function updateStats() {
  const c = { updated: 0, stale: 0, old: 0 };
  state.packages.forEach(p => {
    const k = p.status?.key;
    if (k === 'updated') c.updated++;
    else if (k === 'stale') c.stale++;
    else c.old++;
  });
  if (DOM.statUpdated) DOM.statUpdated.textContent = c.updated;
  if (DOM.statStale) DOM.statStale.textContent = c.stale;
  if (DOM.statOld) DOM.statOld.textContent = c.old;
  if (DOM.statTotal) DOM.statTotal.textContent = state.packages.length;
  if (DOM.stats) DOM.stats.hidden = false;
}

function populateCategories() {
  if (!DOM.categoryFilter) return;
  const cats = [...new Set(state.packages.map(p => p.category))].sort((a,b) => a.localeCompare(b, 'tr'));
  const frag = document.createDocumentFragment();
  
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = '🗂️ Tüm Kategoriler';
  frag.appendChild(all);
  
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    frag.appendChild(opt);
  });
  
  DOM.categoryFilter.replaceChildren(frag);
}

/* ───────────────────────────────────────────────
   CSV Dışa Aktarma
─────────────────────────────────────────────── */
function exportCSV() {
  const rows = [
    ['Paket Adı', 'Boyutu', 'Paket Sistemi', 'Güncel', 'Eski', 'Kısa Not'],
    ...state.filtered.map(p => [
      p.name,
      formatSize(p.size),
      p.system,
      p.lastUpdate ? formatDate(p.lastUpdate) : '—',
      p.status?.label || '?',
      p.note || '—'
    ])
  ];
  
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pisilinux-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───────────────────────────────────────────────
   Sıralama & Event'ler
─────────────────────────────────────────────── */
function setupSorting() {
  document.querySelectorAll('.package-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (state.sortKey === key) state.sortAsc = !state.sortAsc;
      else { state.sortKey = key; state.sortAsc = key !== 'lastUpdate'; }
      
      document.querySelectorAll('.package-table th[data-sort]').forEach(t => {
        t.setAttribute('aria-sort', 'none'); t.classList.remove('sorted');
      });
      th.setAttribute('aria-sort', state.sortAsc ? 'ascending' : 'descending');
      th.classList.add('sorted');
      applyFilters();
    });
    
    th.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
    });
  });
}

function setupEvents() {
  DOM.search?.addEventListener('input', () => {
    const has = DOM.search.value.length > 0;
    if (DOM.clearSearch) DOM.clearSearch.hidden = !has;
    applyFilters();
  });
  
  DOM.clearSearch?.addEventListener('click', () => {
    if (DOM.search) { DOM.search.value = ''; DOM.search.focus(); }
    if (DOM.clearSearch) DOM.clearSearch.hidden = true;
    applyFilters();
  });
  
  DOM.statusFilter?.addEventListener('change', applyFilters);
  DOM.categoryFilter?.addEventListener('change', applyFilters);
  
  DOM.refresh?.addEventListener('click', () => {
    Cache.clear();
    DOM.refresh?.classList.add('loading');
    loadPackages(false);
  });
  
  DOM.retry?.addEventListener('click', () => { Cache.clear(); loadPackages(false); });
  DOM.clearFilters?.addEventListener('click', () => {
    if (DOM.search) DOM.search.value = '';
    if (DOM.statusFilter) DOM.statusFilter.value = 'all';
    if (DOM.categoryFilter) DOM.categoryFilter.value = 'all';
    if (DOM.clearSearch) DOM.clearSearch.hidden = true;
    applyFilters();
  });
  
  DOM.export?.addEventListener('click', exportCSV);
  DOM.export2?.addEventListener('click', exportCSV);
  
  setupSorting();
}

function tick(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ───────────────────────────────────────────────
   Başlangıç
─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  loadPackages(true);
});