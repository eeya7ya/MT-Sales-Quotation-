/* ═══════════════════════════════════════════════════════════
   MT Sales — Admin Dashboard Logic
═══════════════════════════════════════════════════════════ */
'use strict';

// ─── State ────────────────────────────────────────────────────
let adminToken    = localStorage.getItem('mt_admin_token') || '';
let allProducts   = [];
let filteredProducts = [];
let currentPage   = 1;
const PAGE_SIZE   = 50;
let sortCol       = 'category';
let sortDir       = 'asc';
let editingId     = null;
let deletingId    = null;

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    showApp();
  }
});

// ─── Auth ─────────────────────────────────────────────────────
async function doLogin() {
  const pw  = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  err.textContent = '';

  try {
    const res  = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      adminToken = data.token;
      localStorage.setItem('mt_admin_token', adminToken);
      showApp();
    } else {
      err.textContent = data.error || 'Login failed';
    }
  } catch (e) {
    err.textContent = 'Server error – try again';
  }
}

async function doLogout() {
  try {
    await apiFetch('/api/admin/logout', { method: 'POST' });
  } catch (_) {}
  adminToken = '';
  localStorage.removeItem('mt_admin_token');
  document.getElementById('adminApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPassword').value = '';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
  loadStats();
  loadProducts();
}

// ─── API Helper ───────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    doLogout();
    throw new Error('Session expired – please login again');
  }
  return res;
}

// ─── Load Stats ───────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await apiFetch('/api/admin/stats');
    const data = await res.json();
    document.getElementById('statTotal').textContent      = data.total || 0;
    document.getElementById('statCategories').textContent = data.categories || 0;
    document.getElementById('statBrands').textContent     = data.brands || 0;

    const badge = document.getElementById('dbTypeBadge');
    badge.textContent = data.dbType || 'Unknown';
    badge.className   = 'db-badge' + (data.dbType && data.dbType.includes('PostgreSQL') ? ' pg' : '');

    // Populate filter dropdowns
    populateFilterOptions(data.categoryList || [], data.brandList || []);
  } catch (e) {
    console.error('Stats error:', e.message);
  }
}

// ─── Load Products ────────────────────────────────────────────
async function loadProducts() {
  try {
    const res  = await apiFetch('/api/products');
    allProducts = await res.json();
    applyFilters();
  } catch (e) {
    showToast('Failed to load products: ' + e.message, 'error');
  }
}

function populateFilterOptions(categories, brands) {
  const catSel = document.getElementById('filterCategory');
  const brandSel = document.getElementById('filterBrand');
  const sysSel = document.getElementById('filterSystem');

  const currentCat   = catSel.value;
  const currentBrand = brandSel.value;
  const currentSys   = sysSel.value;

  catSel.innerHTML   = '<option value="">All Categories</option>';
  brandSel.innerHTML = '<option value="">All Brands</option>';

  categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === currentCat) o.selected = true;
    catSel.appendChild(o);
  });

  brands.forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = b;
    if (b === currentBrand) o.selected = true;
    brandSel.appendChild(o);
  });

  // Systems from current products
  const systems = [...new Set(allProducts.map(p => p.system).filter(Boolean))].sort();
  sysSel.innerHTML = '<option value="">All Systems</option>';
  systems.forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    if (s === currentSys) o.selected = true;
    sysSel.appendChild(o);
  });

  // Datalist for product form
  const dlCat   = document.getElementById('dl-category');
  const dlBrand = document.getElementById('dl-brand');
  const dlSys   = document.getElementById('dl-system');

  dlCat.innerHTML   = categories.map(c => `<option value="${escHtml(c)}">`).join('');
  dlBrand.innerHTML = brands.map(b => `<option value="${escHtml(b)}">`).join('');
  dlSys.innerHTML   = systems.map(s => `<option value="${escHtml(s)}">`).join('');
}

// ─── Filter / Sort / Pagination ───────────────────────────────
function onSearch() { currentPage = 1; applyFilters(); }
function onFilter() { currentPage = 1; applyFilters(); }

function applyFilters() {
  const q    = (document.getElementById('searchInput').value || '').toLowerCase();
  const cat  = document.getElementById('filterCategory').value;
  const brand= document.getElementById('filterBrand').value;
  const sys  = document.getElementById('filterSystem').value;

  filteredProducts = allProducts.filter(p => {
    if (cat   && p.category !== cat)   return false;
    if (brand && p.brand    !== brand) return false;
    if (sys   && p.system   !== sys)   return false;
    if (q) {
      const hay = `${p.model} ${p.description} ${p.brand} ${p.type} ${p.series}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sort
  filteredProducts.sort((a, b) => {
    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
    if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
    va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  document.getElementById('filterCount').textContent =
    `${filteredProducts.length} of ${allProducts.length} products`;

  renderTable();
  renderPagination();
}

function sortBy(col) {
  if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
  else { sortCol = col; sortDir = 'asc'; }

  document.querySelectorAll('.sort-arrow').forEach(el => el.textContent = '↕');
  const arrow = document.getElementById('sa-' + col);
  if (arrow) arrow.textContent = sortDir === 'asc' ? '↑' : '↓';

  applyFilters();
}

// ─── Render Table ─────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('tableBody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredProducts.slice(start, start + PAGE_SIZE);

  if (!page.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">No products found</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map((p, i) => `
    <tr>
      <td class="td-muted">${start + i + 1}</td>
      <td><span class="td-badge">${escHtml(p.category||'—')}</span></td>
      <td class="td-muted">${escHtml(p.system||'—')}</td>
      <td><strong>${escHtml(p.brand||'—')}</strong></td>
      <td class="td-muted">${escHtml(p.type||'—')}</td>
      <td class="td-muted">${escHtml(p.series||'—')}</td>
      <td class="td-model">${escHtml(p.model||'—')}</td>
      <td class="td-muted" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(p.description||'')}">${escHtml(truncate(p.description||'', 45))}</td>
      <td class="td-price">${fmt(p.dpp_price)}</td>
      <td class="td-price">${fmt(p.si_price)}</td>
      <td class="td-price">${fmt(p.enduser_price)}</td>
      <td>
        <div class="td-actions">
          <button class="btn btn-ghost btn-sm" title="Edit" onclick="openEditModal(${p.id})">✏️</button>
          <button class="btn btn-ghost btn-sm" title="Delete" onclick="openDeleteModal(${p.id}, '${escHtml(p.model||'')}')">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ─── Pagination ───────────────────────────────────────────────
function renderPagination() {
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, filteredProducts.length);

  document.getElementById('pageInfo').textContent =
    filteredProducts.length
      ? `Showing ${start}–${end} of ${filteredProducts.length}`
      : 'No results';

  const container = document.getElementById('pageBtns');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const pages = [];
  pages.push(`<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`);

  // Show at most 7 page buttons
  let lo = Math.max(1, currentPage - 3), hi = Math.min(totalPages, currentPage + 3);
  if (lo > 1) pages.push(`<button class="page-btn" onclick="goPage(1)">1</button>`);
  if (lo > 2) pages.push(`<span style="padding:0 4px;color:var(--text-muted)">…</span>`);
  for (let i = lo; i <= hi; i++) {
    pages.push(`<button class="page-btn ${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`);
  }
  if (hi < totalPages - 1) pages.push(`<span style="padding:0 4px;color:var(--text-muted)">…</span>`);
  if (hi < totalPages) pages.push(`<button class="page-btn" onclick="goPage(${totalPages})">${totalPages}</button>`);
  pages.push(`<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''}>›</button>`);

  container.innerHTML = pages.join('');
}

function goPage(p) {
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(totalPages, p));
  renderTable();
  renderPagination();
}

// ─── Add / Edit Product Modal ──────────────────────────────────
function openAddModal() {
  editingId = null;
  document.getElementById('productModalTitle').textContent = '＋ Add Product';
  document.getElementById('saveProductBtn').textContent = 'Add Product';
  clearForm();
  document.getElementById('productModal').classList.remove('hidden');
}

function openEditModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('productModalTitle').textContent = '✏️ Edit Product';
  document.getElementById('saveProductBtn').textContent = 'Save Changes';
  fillForm(p);
  document.getElementById('productModal').classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('productModal').classList.add('hidden');
  editingId = null;
}

function clearForm() {
  ['category','system','brand','type','series','model','description'].forEach(f =>
    document.getElementById('f-' + f).value = '');
  document.getElementById('f-specifications').value = '';
  document.getElementById('f-dpp').value = '';
  document.getElementById('f-si').value  = '';
  document.getElementById('f-eu').value  = '';
}

function fillForm(p) {
  document.getElementById('f-category').value      = p.category      || '';
  document.getElementById('f-system').value         = p.system        || '';
  document.getElementById('f-brand').value          = p.brand         || '';
  document.getElementById('f-type').value           = p.type          || '';
  document.getElementById('f-series').value         = p.series        || '';
  document.getElementById('f-model').value          = p.model         || '';
  document.getElementById('f-description').value    = p.description   || '';
  document.getElementById('f-specifications').value = p.specifications || '';
  document.getElementById('f-dpp').value            = p.dpp_price     || '';
  document.getElementById('f-si').value             = p.si_price      || '';
  document.getElementById('f-eu').value             = p.enduser_price || '';
}

async function saveProduct() {
  const model = document.getElementById('f-model').value.trim();
  if (!model) { showToast('Model is required', 'error'); return; }

  const payload = {
    category:       document.getElementById('f-category').value.trim(),
    system:         document.getElementById('f-system').value.trim(),
    brand:          document.getElementById('f-brand').value.trim(),
    type:           document.getElementById('f-type').value.trim(),
    series:         document.getElementById('f-series').value.trim(),
    model,
    description:    document.getElementById('f-description').value.trim(),
    specifications: document.getElementById('f-specifications').value.trim(),
    dpp_price:      parseFloat(document.getElementById('f-dpp').value) || 0,
    si_price:       parseFloat(document.getElementById('f-si').value)  || 0,
    enduser_price:  parseFloat(document.getElementById('f-eu').value)  || 0
  };

  const btn = document.getElementById('saveProductBtn');
  btn.disabled = true;

  try {
    let res;
    if (editingId) {
      res = await apiFetch(`/api/products/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await apiFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(editingId ? '✓ Product updated' : '✓ Product added', 'success');
      closeProductModal();
      await loadProducts();
      await loadStats();
    } else {
      showToast(data.error || 'Save failed', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── Delete ────────────────────────────────────────────────────
function openDeleteModal(id, model) {
  deletingId = id;
  document.getElementById('deleteModelName').textContent = model;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.add('hidden');
  deletingId = null;
}

async function confirmDelete() {
  if (!deletingId) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true;

  try {
    const res  = await apiFetch(`/api/products/${deletingId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✓ Product deleted', 'success');
      closeDeleteModal();
      await loadProducts();
      await loadStats();
    } else {
      showToast(data.error || 'Delete failed', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── Reset DB ─────────────────────────────────────────────────
async function doReset() {
  if (!confirm('Clear ALL products from the database?\nThis cannot be undone.')) return;
  try {
    const res  = await apiFetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✓ Database cleared – all products removed', 'success');
      await loadProducts();
      await loadStats();
    } else {
      showToast(data.error || 'Reset failed', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ─── Upload Modal ─────────────────────────────────────────────
let selectedFile = null;

function openUploadModal() {
  document.getElementById('uploadModal').classList.remove('hidden');
  clearFileSelection();
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  clearFileSelection();
}

function onFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  selectedFile = file;

  document.getElementById('uploadZone').style.display = 'none';
  const sel = document.getElementById('fileSelected');
  sel.style.display = 'flex';
  document.getElementById('selFileName').textContent = file.name;
  document.getElementById('selFileSize').textContent = fmtBytes(file.size);
  document.getElementById('uploadSubmitBtn').disabled = false;
  document.getElementById('uploadResult').style.display = 'none';
  document.getElementById('sheetPreview').style.display = 'none';
}

function clearFileSelection() {
  selectedFile = null;
  document.getElementById('uploadZone').style.display = '';
  document.getElementById('fileSelected').style.display = 'none';
  document.getElementById('xlsInput').value = '';
  document.getElementById('uploadSubmitBtn').disabled = true;
  document.getElementById('uploadProgressWrap').style.display = 'none';
  document.getElementById('uploadResult').style.display = 'none';
  document.getElementById('sheetPreview').style.display = 'none';
}

// Drag & drop
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect({ files: [file] });
  });
});

async function submitUpload() {
  if (!selectedFile) return;

  const btn         = document.getElementById('uploadSubmitBtn');
  const progWrap    = document.getElementById('uploadProgressWrap');
  const progText    = document.getElementById('uploadProgressText');
  const progBar     = document.getElementById('uploadProgressBar');
  const resultDiv   = document.getElementById('uploadResult');

  btn.disabled = true;
  progWrap.style.display  = '';
  resultDiv.style.display = 'none';

  const steps = [
    [15, 'Reading Excel file…'],
    [30, 'Detecting sheet structures…'],
    [50, 'Mapping columns intelligently…'],
    [70, 'Extracting products…'],
    [88, 'Saving to database…']
  ];

  let si = 0;
  const ticker = setInterval(() => {
    if (si < steps.length) {
      const [pct, txt] = steps[si++];
      progBar.style.width   = pct + '%';
      progText.textContent  = txt;
    }
  }, 500);

  const fd = new FormData();
  fd.append('excel', selectedFile);

  try {
    const res  = await apiFetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    clearInterval(ticker);

    if (res.ok && data.success) {
      progBar.style.width  = '100%';
      progText.textContent = 'Done!';

      // Show sheet summary
      if (data.sheetSummary && data.sheetSummary.length > 0) {
        const preview = document.getElementById('sheetPreview');
        const body    = document.getElementById('sheetPreviewBody');
        body.innerHTML = data.sheetSummary.map(s => `
          <div class="sheet-row">
            <span class="sheet-name">📄 ${escHtml(s.sheet)}</span>
            <span class="sheet-count ${s.count === 0 ? 'zero' : ''}">${s.count} products</span>
            <span class="sheet-method">${escHtml(s.method)}</span>
            ${s.brand ? `<span class="sheet-method">🏭 ${escHtml(s.brand)}</span>` : ''}
          </div>
        `).join('');
        preview.style.display = '';
      }

      resultDiv.style.display = '';
      resultDiv.innerHTML = `
        <div class="alert alert-success">
          ✓ <strong>Success!</strong> Imported <strong>${data.count}</strong> products from your Excel file.
          The database has been fully replaced.
        </div>`;

      await loadProducts();
      await loadStats();
      setTimeout(closeUploadModal, 2000);
    } else {
      throw new Error(data.error || 'Upload failed');
    }
  } catch (e) {
    clearInterval(ticker);
    progWrap.style.display  = 'none';
    resultDiv.style.display = '';
    resultDiv.innerHTML = `
      <div class="alert alert-error">
        ✗ <strong>Error:</strong> ${escHtml(e.message)}
        <br><small>Check the format guide and try again.</small>
      </div>`;
    btn.disabled = false;
  }
}

// ─── Utilities ────────────────────────────────────────────────
function fmt(val) {
  const n = parseFloat(val) || 0;
  return n > 0 ? n.toFixed(3) : '—';
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(msg, type = 'info') {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
