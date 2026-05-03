/**
 * PisiLinux Paket Takip — tracker.js
 * Kaynak: developer.pisilinux.org/packages
 * ─────────────────────────────────────────
 * Token yok · Sunucu yok · Tüm 6492 paket
 * XSS koruması · CSP uyumlu · Önbellek 30 dk
 */
'use strict';

/* ── Sabitler ── */
const BASE_URL   = 'https://developer.pisilinux.org';
const LETTERS    = 'abcdefghijklmnopqrstuvwxyz'.split('');
const CACHE_KEY  = 'plx_dev_v1';
const CACHE_TTL  = 30 * 60 * 1000; // 30 dakika

/* Durum eşikleri — pspec.xml parse edilemiyor,
   sürüm karşılaştırması yapılamıyor; durum statik
   olarak "yeni paket" / "mevcut" olarak belirlenir.
   Gerçek tarih bilgisi olmadığı için sürüm heuristiği: */
const KNOWN_STALE_PREFIXES = ['devel','docs','dbginfo','32bit'];

/* ── State ── */
let allPkgs = [], filtered = [], isLoading = false;
let sortKey = 'name', sortAsc = true;

/* ── DOM ── */
const $ = id => document.getElementById(id);
const DOM = {
  sdot       : $('sdot'),
  stext      : $('stext'),
  progWrap   : $('progWrap'),
  progFill   : $('progFill'),
  pkgBody    : $('pkgBody'),
  searchInput: $('searchInput'),
  catFilter  : $('catFilter'),
  repoFilter : $('repoFilter'),
  loadBtn    : $('loadBtn'),
  refreshBtn : $('refreshBtn'),
  csvBtn     : $('csvBtn'),
  chips      : $('chips'),
  resultsBar : $('resultsBar'),
  resultsCount:$('resultsCount'),
  lastFetch  : $('lastFetch'),
  cAll:$('c-all'), cOk:$('c-ok'), cWarn:$('c-warn'), cBad:$('c-bad'),
};

/* ── Güvenlik ── */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
function safeUrl(u, allowedHost = 'developer.pisilinux.org') {
  try {
    const p = new URL(u, BASE_URL);
    return (p.protocol === 'https:' && p.hostname === allowedHost) ? p.href : null;
  } catch { return null; }
}
function sanitize(s) {
  return String(s).slice(0, 100).replace(/[<>"'`\\;(){}[\]]/g, '');
}

/* ── Sürüm heuristiği → durum ── */
function calcStatus(pkg) {
  const name    = (pkg.name || '').toLowerCase();
  const version = (pkg.version || '').toLowerCase();
  const repo    = (pkg.repo || '').toLowerCase();

  // contrib paketleri "orta" sayılır
  if (repo === 'contrib') return { key:'stale', label:'Contrib', cls:'b-warn', order:1 };

  // devel/docs/32bit/dbginfo — alt paket
  if (KNOWN_STALE_PREFIXES.some(p => name.endsWith('-' + p))) {
    return { key:'stale', label:'Alt paket', cls:'b-warn', order:1 };
  }

  // Çok eski sürüm işaretleri
  const yearMatch = version.match(/20(\d{2})/);
  if (yearMatch) {
    const year = 2000 + parseInt(yearMatch[1]);
    if (year < 2020) return { key:'old', label:'Eski sürüm', cls:'b-bad', order:2 };
    if (year >= 2024) return { key:'updated', label:'Güncel', cls:'b-ok', order:0 };
    return { key:'stale', label:'Orta', cls:'b-warn', order:1 };
  }

  // Versiyon çok düşükse (< 1.0)
  const major = parseFloat(version);
  if (!isNaN(major) && major < 1 && major > 0) {
    return { key:'stale', label:'Orta', cls:'b-warn', order:1 };
  }

  return { key:'updated', label:'Güncel', cls:'b-ok', order:0 };
}

/* ── Kısa not ── */
function shortNote(pkg) {
  const repo = (pkg.repo || '').toLowerCase();
  if (repo === 'contrib') return 'Topluluk katkısı · contrib deposu';
  const n = (pkg.name || '').toLowerCase();
  if (n.endsWith('-devel'))   return 'Geliştirme başlık dosyaları';
  if (n.endsWith('-docs'))    return 'Belgeleme dosyaları';
  if (n.endsWith('-32bit'))   return '32-bit uyumluluk katmanı';
  if (n.endsWith('-dbginfo')) return 'Hata ayıklama sembolleri';
  const desc = pkg.desc || '';
  return desc.length > 60 ? desc.slice(0, 57) + '…' : (desc || pkg.category || '–');
}

/* ── UI yardımcıları ── */
function setStatus(msg, type = 'spin') {
  if (DOM.sdot)  DOM.sdot.className  = 'sdot ' + type;
  if (DOM.stext) DOM.stext.textContent = msg;
}
function setProgress(pct) {
  if (DOM.progFill) DOM.progFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
}
function showProgress(v) { if (DOM.progWrap) DOM.progWrap.hidden = !v; }
function tick(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Önbellek ── */
const Cache = {
  load() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) { this.clear(); return null; }
      return Array.isArray(data) ? data : null;
    } catch { return null; }
  },
  save(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); }
    catch (e) {
      // localStorage dolu olabilir — sessionStorage'a dön
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
    }
  },
  clear() {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  },
};

/* ── HTML'den tablo satırlarını parse et ── */
function parsePackagesFromHtml(html) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');
  const rows   = doc.querySelectorAll('table tbody tr');
  const pkgs   = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) return;

    const nameCell = cells[0];
    const anchor   = nameCell.querySelector('a');
    if (!anchor) return;

    const name    = (anchor.textContent || '').trim();
    const href    = anchor.getAttribute('href') || '';
    const version = (cells[1].textContent || '').trim();
    const desc    = (cells[2].textContent || '').trim();
    const category= (cells[3].textContent || '').trim();
    const repo    = (cells[4].textContent || '').trim();

    if (!name) return;

    // ID'yi URL'den çıkar: /packages/detail/65/a52dec → 65
    const idMatch = href.match(/\/packages\/detail\/(\d+)\//);
    const id      = idMatch ? idMatch[1] : null;
    const detailUrl = id ? safeUrl(`/packages/detail/${id}/${encodeURIComponent(name)}`) : null;

    const pkg = {
      name,
      version,
      desc,
      category,
      repo,
      detailUrl,
      id,
    };
    pkg.status    = calcStatus(pkg);
    pkg.statusKey = pkg.status.order;

    pkgs.push(pkg);
  });

  return pkgs;
}

/* ── Her harfi fetch et ── */
async function fetchLetter(letter) {
  const url = `${BASE_URL}/packages/search/${encodeURIComponent(letter)}`;

  // SSRF / host kontrolü
  const parsed = new URL(url);
  if (parsed.hostname !== 'developer.pisilinux.org') throw new Error('Güvenlik hatası');

  const response = await fetch(url, {
    method : 'GET',
    headers: { 'Accept': 'text/html', 'User-Agent': 'PisiLinux-Tracker/3.0' },
    cache  : 'default',
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} — ${letter}`);

  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('html')) throw new Error('Beklenmeyen yanıt türü');

  const html = await response.text();
  return parsePackagesFromHtml(html);
}

/* ── Ana yükleme ── */
async function loadAll() {
  if (isLoading) return;
  isLoading = true;

  if (DOM.loadBtn)    DOM.loadBtn.hidden    = true;
  if (DOM.refreshBtn) DOM.refreshBtn.hidden = true;
  if (DOM.csvBtn)     DOM.csvBtn.hidden     = true;

  showProgress(true);
  setProgress(0);
  setStatus('developer.pisilinux.org bağlanıyor…', 'spin');

  try {
    const all = [];

    for (let i = 0; i < LETTERS.length; i++) {
      const letter = LETTERS[i];
      setStatus(`Paketler taranıyor: "${letter.toUpperCase()}" harfi (${i + 1}/26)…`, 'spin');
      setProgress((i / LETTERS.length) * 95);

      try {
        const pkgs = await fetchLetter(letter);
        all.push(...pkgs);
      } catch (err) {
        console.warn(`[PLX] Harf atlandı: ${letter} —`, err.message);
      }

      await tick(120); // hız sınırlaması
    }

    setProgress(100);

    if (all.length === 0) throw new Error('Hiç paket bulunamadı. Site erişilebilir değil olabilir.');

    Cache.save(all);
    allPkgs = all;
    onReady('developer.pisilinux.org');

  } catch (err) {
    console.error('[PLX]', err);
    setStatus(err.message || 'Bir hata oluştu.', 'err');
    renderError(err.message);
  } finally {
    isLoading = false;
    showProgress(false);
    if (DOM.refreshBtn) DOM.refreshBtn.hidden = false;
  }
}

function renderError(msg) {
  if (!DOM.pkgBody) return;
  DOM.pkgBody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="color:var(--red)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    <p>${esc(msg || 'Hata oluştu.')}</p>
    <p style="font-size:11px;color:var(--tf)">CORS hatası tarayıcıda bloklanmış olabilir. Lütfen bir yerel sunucu üzerinden çalıştırın.</p>
  </div></td></tr>`;
}

function onReady(src) {
  populateFilters();
  applyFilters();
  updateChips();
  setStatus(`${allPkgs.length} paket yüklendi (${src}).`, 'ok');
  if (DOM.csvBtn)     DOM.csvBtn.hidden     = false;
  if (DOM.lastFetch)  DOM.lastFetch.textContent = 'Son çekim: ' + new Date().toLocaleString('tr-TR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

/* ── Filtre seçeneklerini doldur ── */
function populateFilters() {
  // Kategoriler
  const cats  = [...new Set(allPkgs.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const repos = [...new Set(allPkgs.map(p => p.repo).filter(Boolean))].sort();

  if (DOM.catFilter) {
    const frag = document.createDocumentFragment();
    const all  = document.createElement('option'); all.value = 'all'; all.textContent = 'Tüm kategoriler';
    frag.appendChild(all);
    cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; frag.appendChild(o); });
    DOM.catFilter.replaceChildren(frag);
  }

  if (DOM.repoFilter) {
    const frag = document.createDocumentFragment();
    const all  = document.createElement('option'); all.value = 'all'; all.textContent = 'Tüm depolar';
    frag.appendChild(all);
    repos.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; frag.appendChild(o); });
    DOM.repoFilter.replaceChildren(frag);
  }
}

/* ── Filtrele & sırala ── */
function applyFilters() {
  const q    = sanitize(DOM.searchInput?.value || '').toLowerCase().trim();
  const sf   = document.querySelector('.chip.active')?.dataset.f || 'all';
  const cat  = DOM.catFilter?.value  || 'all';
  const repo = DOM.repoFilter?.value || 'all';

  filtered = allPkgs.filter(p => {
    if (cat  !== 'all' && p.category !== cat)  return false;
    if (repo !== 'all' && p.repo     !== repo) return false;
    if (sf !== 'all') {
      if (sf === 'updated' && p.status.key !== 'updated') return false;
      if (sf === 'stale'   && p.status.key !== 'stale')   return false;
      if (sf === 'old'     && p.status.key !== 'old')     return false;
    }
    if (q) {
      const hay = `${p.name} ${p.version} ${p.category} ${p.desc}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered = sortArr(filtered, sortKey, sortAsc);
  renderTable(filtered);

  if (DOM.resultsCount) DOM.resultsCount.textContent = `${filtered.length.toLocaleString('tr-TR')} / ${allPkgs.length.toLocaleString('tr-TR')} paket`;
  if (DOM.resultsBar)   DOM.resultsBar.hidden = allPkgs.length === 0;
}

function sortArr(arr, key, asc) {
  return [...arr].sort((a, b) => {
    let va = a[key] ?? '', vb = b[key] ?? '';
    if (key === 'statusKey') return asc ? va - vb : vb - va;
    const cmp = String(va).localeCompare(String(vb), 'tr', { numeric: true });
    return asc ? cmp : -cmp;
  });
}

/* ── Tablo render ── */
const IC_OK   = `<svg viewBox="0 0 12 12"><polyline points="1,6 4,9.5 11,2.5"/></svg>`;
const IC_WARN = `<svg viewBox="0 0 12 12"><path d="M6 2v3.5M6 8v.5"/><path d="M1 10.5 6 1l5 9.5H1z"/></svg>`;
const IC_BAD  = `<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;
const IC_EXT  = `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

function badgeIco(cls) {
  if (cls === 'b-ok')   return IC_OK;
  if (cls === 'b-warn') return IC_WARN;
  if (cls === 'b-bad')  return IC_BAD;
  return '';
}

function renderTable(pkgs) {
  if (!DOM.pkgBody) return;

  if (pkgs.length === 0) {
    DOM.pkgBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      <p>Sonuç bulunamadı. Filtre veya aramayı değiştirin.</p>
    </div></td></tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  pkgs.forEach(pkg => {
    const tr  = document.createElement('tr');
    const st  = pkg.status;
    const url = pkg.detailUrl || `${BASE_URL}/packages`;

    // Paket adı
    const tdName = document.createElement('td');
    tdName.className = 'c-name';
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'pkg-link'; a.textContent = pkg.name;
    tdName.appendChild(a);

    // Sürüm
    const tdVer = document.createElement('td');
    tdVer.className = 'c-version';
    tdVer.innerHTML = `<span class="ver-tag">${esc(pkg.version || '–')}</span>`;

    // Kategori
    const tdCat = document.createElement('td');
    tdCat.className = 'c-cat';
    tdCat.innerHTML = `<span class="cat-text">${esc(pkg.category || '–')}</span>`;

    // Depo
    const tdRepo = document.createElement('td');
    tdRepo.className = 'c-repo';
    const repoCls = (pkg.repo || '').toLowerCase() === 'contrib' ? 'repo-tag contrib' : 'repo-tag';
    tdRepo.innerHTML = `<span class="${repoCls}">${esc(pkg.repo || '–')}</span>`;

    // Durum
    const tdStatus = document.createElement('td');
    tdStatus.className = 'c-status';
    tdStatus.innerHTML = `<span class="badge ${esc(st.cls)}">${badgeIco(st.cls)}${esc(st.label)}</span>`;

    // Not
    const tdNote = document.createElement('td');
    tdNote.className = 'c-note';
    const noteSpan = document.createElement('span');
    noteSpan.className = 'note-txt'; noteSpan.title = shortNote(pkg); noteSpan.textContent = shortNote(pkg);
    const detA = document.createElement('a');
    detA.href = url; detA.target = '_blank'; detA.rel = 'noopener noreferrer';
    detA.className = 'detail-lnk'; detA.title = 'Detay sayfası'; detA.innerHTML = IC_EXT;
    const wrap = document.createElement('div'); wrap.className = 'note-wrap';
    wrap.appendChild(noteSpan); wrap.appendChild(detA);
    tdNote.appendChild(wrap);

    tr.append(tdName, tdVer, tdCat, tdRepo, tdStatus, tdNote);
    frag.appendChild(tr);
  });

  DOM.pkgBody.replaceChildren(frag);
}

/* ── Chip sayaçları ── */
function updateChips() {
  let ok = 0, warn = 0, bad = 0;
  allPkgs.forEach(p => {
    const k = p.status?.key;
    if (k === 'updated') ok++;
    else if (k === 'stale') warn++;
    else bad++;
  });
  if (DOM.cAll)  DOM.cAll.textContent  = allPkgs.length.toLocaleString('tr-TR');
  if (DOM.cOk)   DOM.cOk.textContent   = ok.toLocaleString('tr-TR');
  if (DOM.cWarn) DOM.cWarn.textContent  = warn.toLocaleString('tr-TR');
  if (DOM.cBad)  DOM.cBad.textContent   = bad.toLocaleString('tr-TR');
  if (DOM.chips) DOM.chips.hidden = false;
}

/* ── CSV ── */
function exportCSV() {
  const cols = ['Paket Adı', 'Sürüm', 'Kategori', 'Depo', 'Durum', 'Açıklama', 'Detay URL'];
  const rows = filtered.map(p => [
    p.name, p.version, p.category, p.repo,
    p.status.label, p.desc,
    p.detailUrl || '',
  ]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `pisilinux-packages-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); URL.revokeObjectURL(url);
}

/* ── Sıralama ── */
function setupSorting() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const fn = () => {
      const k = th.dataset.sort;
      if (!k) return;
      sortAsc = sortKey === k ? !sortAsc : true;
      sortKey = k;
      document.querySelectorAll('th[data-sort]').forEach(t => {
        t.setAttribute('aria-sort', 'none');
        t.classList.remove('sorted');
        const sp = t.querySelector('.sa');
        if (sp) sp.textContent = '';
      });
      th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      th.classList.add('sorted');
      const sp = th.querySelector('.sa');
      if (sp) sp.textContent = sortAsc ? ' ↑' : ' ↓';
      applyFilters();
    };
    th.addEventListener('click', fn);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  });
}

/* ── Event listeners ── */
function setupEvents() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      applyFilters();
    });
  });

  DOM.searchInput?.addEventListener('input', applyFilters);
  DOM.catFilter?.addEventListener('change', applyFilters);
  DOM.repoFilter?.addEventListener('change', applyFilters);

  DOM.loadBtn?.addEventListener('click', () => {
    const cached = Cache.load();
    if (cached && cached.length > 0) { allPkgs = cached; onReady('önbellekten'); }
    else loadAll();
  });

  DOM.refreshBtn?.addEventListener('click', () => { Cache.clear(); loadAll(); });
  DOM.csvBtn?.addEventListener('click', exportCSV);

  setupSorting();
}

/* ── Başlat ── */
document.addEventListener('DOMContentLoaded', setupEvents);
