/**
 * PisiLinux Paket Takip Sistemi — tracker.js
 * Güvenli · XSS korumalı · Rate-limit izleme
 * Token gerektirmez · Önbellek: 15 dk
 */
'use strict';

/* ── Sabitler ── */
const OWNER = 'pisilinux', REPO = 'main', BRANCH = 'master';
const API   = 'https://api.github.com';
const CACHE_KEY = 'plx_v3', CACHE_TTL = 15 * 60 * 1000;
const THRESHOLDS = { updated: 7 * 86400000, stale: 30 * 86400000 };

/* ── Durum ── */
let allPkgs = [], filtered = [], isLoading = false;
let sortKey = 'lastUpdate', sortAsc = false;

/* ── DOM ── */
const $ = (id) => document.getElementById(id);
const DOM = {
  statusDot    : $('statusDot'),
  statusMsg    : $('statusMsg'),
  progBar      : $('progBar'),
  progressWrap : $('progressWrap'),
  rateWarn     : $('rateWarn'),
  rateMsg      : $('rateMsg'),
  pkgBody      : $('pkgBody'),
  searchInput  : $('searchInput'),
  catFilter    : $('catFilter'),
  loadBtn      : $('loadBtn'),
  refreshBtn   : $('refreshBtn'),
  csvBtn       : $('csvBtn'),
  statChips    : $('statChips'),
  resultsBar   : $('resultsBar'),
  resultsCount : $('resultsCount'),
  lastFetch    : $('lastFetch'),
  cAll         : $('c-all'),
  cOk          : $('c-ok'),
  cWarn        : $('c-warn'),
  cBad         : $('c-bad'),
};

/* ── Güvenlik yardımcıları ── */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function safeUrl(u, hosts = ['github.com']) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && hosts.some(h => p.hostname === h || p.hostname.endsWith('.' + h))
      ? u : null;
  } catch { return null; }
}

function sanitize(s) {
  return String(s).slice(0, 100).replace(/[<>"'`\\;(){}[\]]/g, '');
}

function extractVersion(xml) {
  const m = String(xml).match(/<Version>\s*([^\s<]{1,60})\s*<\/Version>/);
  return m ? m[1].trim() : 'N/A';
}

/* ── Tarih yardımcıları ── */
function fmtDate(d) {
  if (!d) return '–';
  const dt = new Date(d);
  return isNaN(dt) ? '–' : dt.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relTime(d) {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days < 1)   return 'bugün';
  if (days < 7)   return days + 'g önce';
  if (days < 30)  return Math.floor(days / 7) + 'h önce';
  if (days < 365) return Math.floor(days / 30) + 'ay önce';
  return Math.floor(days / 365) + 'y önce';
}

function daysAgo(d) {
  return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 9999;
}

/* ── Durum hesapla ── */
function calcStatus(d) {
  if (!d) return { key: 'unknown', label: 'Bilinmiyor', cls: 'unknown', order: 3 };
  const ms = Date.now() - new Date(d).getTime();
  if (ms <= THRESHOLDS.updated) return { key: 'updated', label: 'Güncel',    cls: 'ok',   order: 0 };
  if (ms <= THRESHOLDS.stale)   return { key: 'stale',   label: 'Orta',      cls: 'warn', order: 1 };
  return                               { key: 'old',     label: 'Eski',       cls: 'bad',  order: 2 };
}

/* ── Kısa not ── */
function shortNote(pkg) {
  const d = pkg.daysAgo;
  if (pkg.status.key === 'unknown') return 'Bilgi alınamadı';
  if (d === 0) return 'Bugün güncellendi';
  if (d < 7)   return d + ' gün önce güncellendi';
  if (d < 30)  return Math.round(d / 7) + ' hafta önce güncellendi';
  if (d < 90)  return Math.round(d / 30) + ' ay önce güncellendi';
  return Math.round(d / 30) + ' ay güncellenmedi';
}

/* ── UI yardımcıları ── */
function setStatus(msg, type = 'spin') {
  if (DOM.statusDot) DOM.statusDot.className = 'status-dot ' + type;
  if (DOM.statusMsg) DOM.statusMsg.textContent = msg;
}

function setProgress(pct) {
  if (DOM.progBar) DOM.progBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
}

function showProgress(show) {
  if (DOM.progressWrap) DOM.progressWrap.hidden = !show;
}

function tick(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Önbellek ── */
const Cache = {
  load() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) { this.clear(); return null; }
      return Array.isArray(data) ? data : null;
    } catch { return null; }
  },
  save(data) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
  },
  clear() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  },
};

/* ── GitHub API istemcisi ── */
async function ghGet(endpoint, params = {}) {
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (typeof k === 'string' && typeof v === 'string') url.searchParams.set(k, v);
  }
  // SSRF engeli
  if (url.hostname !== 'api.github.com') throw new Error('Güvenlik hatası: izinsiz host');

  const r = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'PisiLinux-Tracker/3.0' },
  });

  // Rate limit izle
  const rem = r.headers.get('X-RateLimit-Remaining');
  if (rem !== null && parseInt(rem) < 10) {
    const reset = r.headers.get('X-RateLimit-Reset');
    const t = reset ? new Date(parseInt(reset) * 1000).toLocaleTimeString('tr-TR') : '?';
    if (DOM.rateMsg) DOM.rateMsg.textContent = `GitHub API limiti düşük (kalan: ${rem}). ${t} sıfırlanır.`;
    if (DOM.rateWarn) DOM.rateWarn.hidden = false;
  }

  if (!r.ok) {
    if (r.status === 403 && rem === '0') throw new Error('API limiti doldu. Lütfen bekleyin.');
    throw new Error('GitHub API Hatası: ' + r.status);
  }

  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('Beklenmeyen yanıt türü');

  return r.json();
}

/* ── Ana yükleme akışı ── */
async function loadAll() {
  if (isLoading) return;
  isLoading = true;
  if (DOM.loadBtn)    DOM.loadBtn.style.display    = 'none';
  if (DOM.refreshBtn) DOM.refreshBtn.style.display = 'none';
  if (DOM.csvBtn)     DOM.csvBtn.hidden             = true;

  showProgress(true);
  setStatus('Kategoriler taranıyor…', 'spin');
  setProgress(3);

  try {
    // 1) Kategoriler
    const rootItems = await ghGet(`/repos/${OWNER}/${REPO}/contents`, { ref: BRANCH });
    const cats = Array.isArray(rootItems)
      ? rootItems.filter(i => i.type === 'dir' && typeof i.name === 'string' && !i.name.startsWith('.')).map(i => i.name)
      : [];
    setProgress(8);

    // 2) Her kategorideki paketler
    let rawPkgs = [];
    for (let i = 0; i < cats.length; i++) {
      try {
        const items = await ghGet(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(cats[i])}`, { ref: BRANCH });
        if (Array.isArray(items)) {
          items.filter(x => x.type === 'dir').forEach(x => {
            rawPkgs.push({
              category : cats[i],
              name     : x.name,
              path     : x.path,
              url      : safeUrl(x.html_url) || '#',
            });
          });
        }
      } catch { /* Kategori okunamadıysa atla */ }

      setStatus(`Paketler taranıyor: ${i + 1}/${cats.length} kategori — ${rawPkgs.length} paket`, 'spin');
      setProgress(8 + (i + 1) / cats.length * 22);
      if (i % 5 === 4) await tick(80);
    }

    // 3) Paket detayları
    const results = [];
    for (let i = 0; i < rawPkgs.length; i++) {
      const pkg = rawPkgs[i];
      let version = 'N/A', lastUpdate = null, commitUrl = pkg.url, size = '–';

      // pspec.xml → versiyon + boyut
      try {
        const ps = await ghGet(
          `/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(pkg.path)}/pspec.xml`,
          { ref: BRANCH }
        );
        if (ps?.content && typeof ps.content === 'string') {
          const b64 = ps.content.replace(/\s/g, '');
          if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
            try { version = extractVersion(atob(b64)); } catch {}
          }
        }
        if (ps?.size) {
          const kb = Math.round(ps.size / 1024);
          size = kb < 1 ? ps.size + 'B' : kb + ' KB';
        }
      } catch {}

      // Son commit
      try {
        const commits = await ghGet(
          `/repos/${OWNER}/${REPO}/commits`,
          { path: pkg.path, ref: BRANCH, per_page: '1' }
        );
        if (Array.isArray(commits) && commits[0]) {
          lastUpdate = commits[0].commit?.author?.date || null;
          commitUrl  = safeUrl(commits[0].html_url) || pkg.url;
        }
      } catch {}

      const status = calcStatus(lastUpdate);
      results.push({
        ...pkg,
        version,
        lastUpdate,
        commitUrl,
        size,
        status,
        statusKey : status.order,
        daysAgo   : daysAgo(lastUpdate),
        system    : 'pisi',
      });

      if (i % 8 === 7) {
        setStatus(`Detaylar yükleniyor: ${i + 1}/${rawPkgs.length}`, 'spin');
        setProgress(30 + (i + 1) / rawPkgs.length * 70);
        await tick(60);
      }
    }

    setProgress(100);
    Cache.save(results);
    allPkgs = results;
    onReady('GitHub API\'den');

  } catch (err) {
    console.error('[PLX]', err);
    setStatus(err.message || 'Hata oluştu.', 'err');
    if (DOM.pkgBody) {
      DOM.pkgBody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="color:var(--red)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <p>${esc(err.message || 'Bir hata oluştu.')}</p>
      </div></td></tr>`;
    }
  } finally {
    isLoading = false;
    showProgress(false);
    if (DOM.refreshBtn) DOM.refreshBtn.style.display = 'inline-flex';
  }
}

function onReady(src) {
  populateCats();
  applyFilters();
  updateChips();
  setStatus(`${allPkgs.length} paket yüklendi (${src}).`, 'ok');
  if (DOM.csvBtn) DOM.csvBtn.hidden = false;
  if (DOM.lastFetch) DOM.lastFetch.textContent = 'Son çekim: ' + fmtDate(new Date().toISOString());
}

/* ── Kategori dropdown ── */
function populateCats() {
  if (!DOM.catFilter) return;
  const cats = [...new Set(allPkgs.map(p => p.category))].sort((a, b) => a.localeCompare(b, 'tr'));
  const frag = document.createDocumentFragment();
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'Tüm kategoriler';
  frag.appendChild(all);
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    frag.appendChild(o);
  });
  DOM.catFilter.replaceChildren(frag);
}

/* ── Filtrele & sırala ── */
function applyFilters() {
  const q   = sanitize(DOM.searchInput?.value || '').toLowerCase().trim();
  const sf  = document.querySelector('.chip.active')?.dataset.f || 'all';
  const cat = DOM.catFilter?.value || 'all';
  const now = Date.now();

  filtered = allPkgs.filter(p => {
    if (cat !== 'all' && p.category !== cat) return false;
    if (sf !== 'all') {
      const d = p.lastUpdate ? now - new Date(p.lastUpdate).getTime() : Infinity;
      if (sf === 'updated' && d > THRESHOLDS.updated) return false;
      if (sf === 'stale'   && (d <= THRESHOLDS.updated || d > THRESHOLDS.stale)) return false;
      if (sf === 'old'     && d <= THRESHOLDS.stale) return false;
    }
    if (q) {
      const hay = `${p.category} ${p.name} ${p.version}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered = sortArr(filtered, sortKey, sortAsc);
  renderTable(filtered);

  const rc = DOM.resultsCount;
  if (rc) rc.textContent = `${filtered.length} / ${allPkgs.length} paket gösteriliyor`;
  if (DOM.resultsBar) DOM.resultsBar.hidden = allPkgs.length === 0;
}

function sortArr(arr, key, asc) {
  return [...arr].sort((a, b) => {
    let va = a[key] ?? '', vb = b[key] ?? '';
    if (key === 'lastUpdate') {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
      return asc ? va - vb : vb - va;
    }
    if (typeof va === 'number') return asc ? va - vb : vb - va;
    return asc
      ? String(va).localeCompare(String(vb), 'tr')
      : String(vb).localeCompare(String(va), 'tr');
  });
}

/* ── Tablo render ── */
const SVG_OK   = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,6 4,9.5 11,2.5"/></svg>`;
const SVG_WARN = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2v3.5M6 8v.5"/><path d="M1 10.5 6 1l5 9.5H1z"/></svg>`;
const SVG_BAD  = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;
const SVG_COMMIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>`;

function badgeSvg(cls) {
  if (cls === 'ok')   return SVG_OK;
  if (cls === 'warn') return SVG_WARN;
  if (cls === 'bad')  return SVG_BAD;
  return '';
}

function renderTable(pkgs) {
  if (!DOM.pkgBody) return;

  if (pkgs.length === 0) {
    DOM.pkgBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
      <p>Sonuç bulunamadı. Filtre veya arama teriminizi değiştirin.</p>
    </div></td></tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  pkgs.forEach(pkg => {
    const tr = document.createElement('tr');
    const st = pkg.status;
    const fu = safeUrl(pkg.url) || '#';
    const cu = safeUrl(pkg.commitUrl) || '#';

    // Paket adı
    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    const nameA = document.createElement('a');
    nameA.href = fu; nameA.target = '_blank'; nameA.rel = 'noopener noreferrer';
    nameA.className = 'pkg-name';
    nameA.textContent = pkg.name;
    const catSpan = document.createElement('span');
    catSpan.className = 'pkg-cat'; catSpan.textContent = pkg.category;
    tdName.appendChild(nameA); tdName.appendChild(catSpan);

    // Boyut
    const tdSize = document.createElement('td');
    tdSize.className = 'col-size';
    tdSize.innerHTML = `<span class="size-mono">${esc(pkg.size || '–')}</span>`;

    // Sistem
    const tdSys = document.createElement('td');
    tdSys.className = 'col-sys';
    tdSys.innerHTML = `<span class="sys-badge">pisi</span>`;

    // Son güncelleme (güncel sütun)
    const tdUpd = document.createElement('td');
    tdUpd.className = 'col-upd';
    tdUpd.innerHTML = `<span class="date-main">${esc(fmtDate(pkg.lastUpdate))}</span>`;

    // Geçen süre (güncel olmayan sütun)
    const tdAgo = document.createElement('td');
    tdAgo.className = 'col-ago';
    tdAgo.innerHTML = `<span class="date-rel" style="font-size:12px;color:var(--text-dim)">${esc(relTime(pkg.lastUpdate))}</span>`;

    // Durum
    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    tdStatus.innerHTML = `<span class="badge badge-${esc(st.cls)}">${badgeSvg(st.cls)}${esc(st.label)}</span>`;

    // Not + commit link
    const tdNote = document.createElement('td');
    tdNote.className = 'col-note';
    const noteSpan = document.createElement('span');
    noteSpan.className = 'note-text'; noteSpan.title = shortNote(pkg); noteSpan.textContent = shortNote(pkg);
    const commitA = document.createElement('a');
    commitA.href = cu; commitA.target = '_blank'; commitA.rel = 'noopener noreferrer';
    commitA.className = 'commit-link'; commitA.title = 'Son commit';
    commitA.innerHTML = SVG_COMMIT;
    tdNote.appendChild(noteSpan); tdNote.appendChild(commitA);

    tr.append(tdName, tdSize, tdSys, tdUpd, tdAgo, tdStatus, tdNote);
    frag.appendChild(tr);
  });

  DOM.pkgBody.replaceChildren(frag);
}

/* ── Chip sayaçlarını güncelle ── */
function updateChips() {
  let ok = 0, warn = 0, bad = 0;
  allPkgs.forEach(p => {
    const k = p.status?.key;
    if (k === 'updated') ok++;
    else if (k === 'stale') warn++;
    else bad++;
  });
  if (DOM.cAll)  DOM.cAll.textContent  = allPkgs.length;
  if (DOM.cOk)   DOM.cOk.textContent   = ok;
  if (DOM.cWarn) DOM.cWarn.textContent  = warn;
  if (DOM.cBad)  DOM.cBad.textContent   = bad;
  if (DOM.statChips) DOM.statChips.hidden = false;
}

/* ── CSV dışa aktarma ── */
function exportCSV() {
  const cols = ['Kategori', 'Paket Adı', 'Versiyon', 'Boyut', 'Sistem', 'Son Güncelleme', 'Geçen Süre', 'Durum', 'Kısa Not'];
  const rows = filtered.map(p => [
    p.category, p.name, p.version, p.size, 'pisi',
    p.lastUpdate || '', relTime(p.lastUpdate), p.status.label, shortNote(p),
  ]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `pisilinux-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ── Tablo sıralama ── */
function setupSorting() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const clickFn = () => {
      const k = th.dataset.sort;
      if (!k) return;
      sortAsc = sortKey === k ? !sortAsc : (k !== 'lastUpdate' && k !== 'daysAgo');
      sortKey = k;
      document.querySelectorAll('th[data-sort]').forEach(t => {
        t.setAttribute('aria-sort', 'none');
        t.classList.remove('sorted');
        const sp = t.querySelector('.sort-arrow');
        if (sp) sp.textContent = '';
      });
      th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      th.classList.add('sorted');
      const sp = th.querySelector('.sort-arrow');
      if (sp) sp.textContent = sortAsc ? ' ↑' : ' ↓';
      applyFilters();
    };
    th.addEventListener('click', clickFn);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickFn(); } });
  });
}

/* ── Event listeners ── */
function setupEvents() {
  // Chip filtreler
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      applyFilters();
    });
  });

  // Arama
  DOM.searchInput?.addEventListener('input', applyFilters);
  DOM.catFilter?.addEventListener('change', applyFilters);

  // Yükle / Yenile
  DOM.loadBtn?.addEventListener('click', () => {
    const cached = Cache.load();
    if (cached) { allPkgs = cached; onReady('önbellekten'); }
    else loadAll();
  });

  DOM.refreshBtn?.addEventListener('click', () => { Cache.clear(); loadAll(); });

  // CSV
  DOM.csvBtn?.addEventListener('click', exportCSV);

  // Sıralama
  setupSorting();
}

/* ── Başlat ── */
document.addEventListener('DOMContentLoaded', setupEvents);
