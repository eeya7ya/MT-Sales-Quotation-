/* ═══════════════════════════════════════════════════════════════
   MT Sales Quotation — Configurator Logic
═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────────
let allProducts   = [];
let quotationItems = [];
let currentProduct = null;
let pricingMode    = 'si';
const filters      = { category: '', system: '', brand: '', type: '', series: '', model: '' };

const filterOrder  = ['category', 'system', 'brand', 'type', 'series', 'model'];

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCustomerInfo();
  loadQuotationItems();
  fetchProducts();
  setupDragDrop();
  updatePricingModeDesc();

  // Set today's date as default
  const dateInput = document.getElementById('fi-date');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
    saveCustomerInfo();
  }

  // Set default ref
  const refInput = document.getElementById('fi-ref');
  if (!refInput.value) {
    refInput.value = 'QyMT-' + String(Math.floor(Math.random() * 900) + 100);
    saveCustomerInfo();
  }
});

async function fetchProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('Server error');
    allProducts = await res.json();
    updateDbStatus(allProducts.length);
    populateFilter('category');
  } catch (err) {
    showToast('Could not load product database: ' + err.message, 'error');
    updateDbStatus(0);
  }
}

function updateDbStatus(count) {
  const dot  = document.getElementById('dbDot');
  const text = document.getElementById('dbStatusText');
  if (count > 0) {
    dot.className  = 'dot';
    text.textContent = count + ' products loaded';
  } else {
    dot.className  = 'dot empty';
    text.textContent = 'No database — upload Excel';
  }
}

// ─── Cascading Dropdowns ──────────────────────────────────────
function populateFilter(level) {
  const idx = filterOrder.indexOf(level);

  // Clear all downstream selects
  for (let i = idx; i < filterOrder.length; i++) {
    const key = filterOrder[i];
    const sel = document.getElementById('sel-' + key);
    sel.innerHTML = `<option value="">— Select ${capitalize(key)} —</option>`;
    sel.disabled  = true;
    if (i > idx) filters[key] = '';
    setStepState(key, i === idx ? 'active' : 'locked');
  }

  // Filter products based on current selections
  let filtered = allProducts;
  for (let i = 0; i < idx; i++) {
    const key = filterOrder[i];
    if (filters[key]) filtered = filtered.filter(p => p[key] === filters[key]);
  }

  // Get unique values for this level
  const key    = filterOrder[idx];
  const values = [...new Set(filtered.map(p => p[key]).filter(Boolean))].sort();

  const sel = document.getElementById('sel-' + key);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });

  // Restore selected value if it still exists
  if (filters[key] && values.includes(filters[key])) {
    sel.value = filters[key];
  }

  sel.disabled = false;
  setStepState(key, 'active');
}

function onFilterChange(level) {
  const sel = document.getElementById('sel-' + level);
  const val = sel.value;
  filters[level] = val;

  const idx = filterOrder.indexOf(level);
  setStepState(level, val ? 'done' : 'active');

  if (!val) {
    // Clear all downstream
    for (let i = idx + 1; i < filterOrder.length; i++) {
      const k = filterOrder[i];
      filters[k] = '';
      const s = document.getElementById('sel-' + k);
      s.innerHTML = `<option value="">— Select ${capitalize(k)} —</option>`;
      s.disabled  = true;
      setStepState(k, 'locked');
    }
    hideProductCard();
    return;
  }

  // Populate next level
  if (idx + 1 < filterOrder.length) {
    populateNextLevel(idx + 1);
  }
}

function populateNextLevel(idx) {
  const key = filterOrder[idx];
  let filtered = allProducts;
  for (let i = 0; i < idx; i++) {
    const k = filterOrder[i];
    if (filters[k]) filtered = filtered.filter(p => p[k] === filters[k]);
  }

  const values = [...new Set(filtered.map(p => p[key]).filter(Boolean))].sort();
  const sel    = document.getElementById('sel-' + key);

  sel.innerHTML = `<option value="">— Select ${capitalize(key)} —</option>`;
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  sel.disabled = false;
  setStepState(key, 'active');

  // Clear further downstream
  for (let i = idx + 1; i < filterOrder.length; i++) {
    const k = filterOrder[i];
    filters[k] = '';
    const s = document.getElementById('sel-' + k);
    s.innerHTML = `<option value="">— Select ${capitalize(k)} —</option>`;
    s.disabled  = true;
    setStepState(k, 'locked');
  }

  // Auto-select if only one option
  if (values.length === 1) {
    sel.value   = values[0];
    filters[key] = values[0];
    setStepState(key, 'done');
    if (idx + 1 < filterOrder.length) populateNextLevel(idx + 1);
  }

  hideProductCard();
}

function onModelSelect() {
  const sel   = document.getElementById('sel-model');
  const model = sel.value;
  filters.model = model;
  setStepState('model', model ? 'done' : 'active');

  if (!model) { hideProductCard(); return; }

  // Find product
  currentProduct = allProducts.find(p => p.model === model);
  if (currentProduct) {
    showProductCard(currentProduct);
  }
}

function clearFrom(level) {
  const idx = filterOrder.indexOf(level);
  filters[level] = '';
  const sel = document.getElementById('sel-' + level);
  sel.value = '';
  setStepState(level, 'active');

  for (let i = idx + 1; i < filterOrder.length; i++) {
    const k = filterOrder[i];
    filters[k] = '';
    const s = document.getElementById('sel-' + k);
    s.innerHTML = `<option value="">— Select ${capitalize(k)} —</option>`;
    s.disabled  = true;
    setStepState(k, 'locked');
  }

  hideProductCard();
  populateFilter(level);
}

function setStepState(level, state) {
  const step  = document.getElementById('step-' + level);
  const badge = document.getElementById('badge-' + (filterOrder.indexOf(level) + 1));
  if (!step) return;

  step.classList.remove('locked', 'active', 'done');
  step.classList.add(state);

  if (badge) {
    const num = filterOrder.indexOf(level) + 1;
    badge.textContent = state === 'done' ? '✓' : num;
  }
}

// ─── Product Card ─────────────────────────────────────────────
function showProductCard(p) {
  document.getElementById('noProductHint').style.display = 'none';
  const card = document.getElementById('productCard');
  card.classList.add('visible');

  document.getElementById('pc-model').textContent = p.model;
  document.getElementById('pc-desc').textContent  = p.description || '—';
  document.getElementById('pc-specs').textContent = p.specifications || 'No specifications available';

  const currency = document.getElementById('fi-currency').value || 'JOD';
  document.getElementById('pc-dpp').textContent = fmt(p.dpp_price,     currency);
  document.getElementById('pc-si').textContent  = fmt(p.si_price,      currency);
  document.getElementById('pc-eu').textContent  = fmt(p.enduser_price, currency);

  document.getElementById('pc-series-badge').textContent = p.series || p.type || '';

  highlightActivePrice();
  recalcCurrentPrice();
}

function hideProductCard() {
  currentProduct = null;
  document.getElementById('productCard').classList.remove('visible');
  document.getElementById('noProductHint').style.display = '';
}

function highlightActivePrice() {
  document.getElementById('pcell-dpp').classList.remove('active-price');
  document.getElementById('pcell-si').classList.remove('active-price');
  document.getElementById('pcell-eu').classList.remove('active-price');

  if (pricingMode === 'si' || pricingMode === 'contractor' || pricingMode === 'custom') {
    document.getElementById('pcell-si').classList.add('active-price');
  } else if (pricingMode === 'enduser') {
    document.getElementById('pcell-eu').classList.add('active-price');
  }
}

// ─── Pricing Mode ─────────────────────────────────────────────
function setPricingMode(mode, btn) {
  pricingMode = mode;
  document.querySelectorAll('.pm-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('customMultiplierWrap').style.display = mode === 'custom' ? 'block' : 'none';
  updatePricingModeDesc();
  highlightActivePrice();
  recalcCurrentPrice();
  renderTable();
}

function updatePricingModeDesc() {
  const descs = {
    si:         '📌 Using SI / Installer price directly from database',
    contractor: '📌 Contractor price = SI Price × 1.25',
    enduser:    '📌 Using End User price directly from database',
    custom:     '📌 Custom = SI Price × your multiplier'
  };
  document.getElementById('pricingModeDesc').textContent = descs[pricingMode] || '';
}

function getUnitPrice(p) {
  if (!p) return 0;
  switch (pricingMode) {
    case 'si':         return p.si_price || 0;
    case 'contractor': return (p.si_price || 0) * 1.25;
    case 'enduser':    return p.enduser_price || 0;
    case 'custom': {
      const m = parseFloat(document.getElementById('customMultiplier').value) || 1;
      return (p.si_price || 0) * m;
    }
    default: return p.si_price || 0;
  }
}

function recalcCurrentPrice() {
  if (!currentProduct) return;
  const currency  = document.getElementById('fi-currency').value || 'JOD';
  const unitPrice = getUnitPrice(currentProduct);
  const qty       = parseInt(document.getElementById('qtyInput').value) || 1;
  const total     = unitPrice * qty;

  const modeLabel = { si:'SI Price', contractor:'Contractor Price', enduser:'End User Price', custom:'Custom Price' };
  document.getElementById('cp-mode-label').textContent = modeLabel[pricingMode];
  document.getElementById('cp-value').textContent      = fmt(unitPrice, currency);
  document.getElementById('item-total-val').textContent = fmt(total, currency);
}

function adjustQty(delta) {
  const input = document.getElementById('qtyInput');
  const val   = Math.max(1, (parseInt(input.value) || 1) + delta);
  input.value = val;
  recalcCurrentPrice();
}

// ─── Add to Quotation ─────────────────────────────────────────
function addToQuotation() {
  if (!currentProduct) return;

  const qty  = parseInt(document.getElementById('qtyInput').value) || 1;
  const unit = getUnitPrice(currentProduct);

  const item = {
    id:             Date.now(),
    brand:          currentProduct.brand || '',
    model:          currentProduct.model,
    description:    currentProduct.description || '',
    specifications: currentProduct.specifications || '',
    category:       currentProduct.category || '',
    system:         currentProduct.system || '',
    series:         currentProduct.series || '',
    type:           currentProduct.type || '',
    qty,
    unit_price:     unit,
    pricing_mode:   pricingMode,
    si_price:       currentProduct.si_price || 0,
    enduser_price:  currentProduct.enduser_price || 0,
    dpp_price:      currentProduct.dpp_price || 0
  };

  quotationItems.push(item);
  saveQuotationItems();
  renderTable();
  showToast(`✓ ${item.model} added to quotation`, 'success');

  // Reset qty
  document.getElementById('qtyInput').value = 1;
  recalcCurrentPrice();
}

function addInstallationRow() {
  const desc  = prompt('Installation / Service description:', 'Installation & Configuration');
  if (!desc) return;
  const price = parseFloat(prompt('Unit price:', '200')) || 0;
  const qty   = parseInt(prompt('Quantity:', '1')) || 1;

  quotationItems.push({
    id:             Date.now(),
    brand:          '',
    model:          'Installation',
    description:    desc,
    specifications: '',
    category:       'Service',
    system:         'Service',
    series:         '',
    type:           '',
    qty,
    unit_price:     price,
    pricing_mode:   'custom',
    si_price:       price,
    enduser_price:  price,
    dpp_price:      price
  });

  saveQuotationItems();
  renderTable();
  showToast('✓ Installation row added', 'success');
}

function removeItem(id) {
  quotationItems = quotationItems.filter(i => i.id !== id);
  saveQuotationItems();
  renderTable();
}

function updateQty(id, val) {
  const item = quotationItems.find(i => i.id === id);
  if (item) {
    item.qty = Math.max(1, parseInt(val) || 1);
    saveQuotationItems();
    renderTable();
  }
}

function clearAllItems() {
  if (quotationItems.length === 0) return;
  if (!confirm('Clear all quotation items?')) return;
  quotationItems = [];
  saveQuotationItems();
  renderTable();
}

// ─── Render Table ─────────────────────────────────────────────
function renderTable() {
  const tbody    = document.getElementById('quotationBody');
  const empty    = document.getElementById('emptyState');
  const summary  = document.getElementById('summaryBar');
  const currency = document.getElementById('fi-currency').value || 'JOD';

  if (quotationItems.length === 0) {
    tbody.innerHTML = '';
    empty.style.display   = '';
    summary.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  summary.style.display = 'flex';

  // Group by system for section headers
  const grouped = {};
  quotationItems.forEach(item => {
    const key = item.system || 'General';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  let html    = '';
  let itemNum = 1;
  let grandTotal = 0;
  let grandQty   = 0;

  Object.entries(grouped).forEach(([system, items]) => {
    html += `<tr class="table-section-header"><td colspan="9">${system.toUpperCase()}</td></tr>`;
    items.forEach(item => {
      const total = item.unit_price * item.qty;
      grandTotal += total;
      grandQty   += item.qty;
      html += `
        <tr class="animate-in">
          <td style="color:var(--text-muted);font-size:12px;">${itemNum++}</td>
          <td><div class="item-brand">${item.brand}</div></td>
          <td><div class="item-model">${item.model}</div><div class="item-desc">${item.series || item.type || ''}</div></td>
          <td style="max-width:200px;"><div class="item-desc" title="${item.description}">${truncate(item.description, 60)}</div></td>
          <td style="max-width:180px;"><div class="item-desc" style="font-size:11px;" title="${item.specifications}">${truncate(item.specifications, 55)}</div></td>
          <td>
            <div style="display:flex;align-items:center;gap:4px;">
              <button class="qty-btn" style="width:22px;height:22px;font-size:13px;" onclick="updateQty(${item.id}, ${item.qty - 1})">−</button>
              <input type="number" class="qty-input" value="${item.qty}" min="1"
                     style="width:52px;" onchange="updateQty(${item.id}, this.value)">
              <button class="qty-btn" style="width:22px;height:22px;font-size:13px;" onclick="updateQty(${item.id}, ${item.qty + 1})">+</button>
            </div>
          </td>
          <td class="price-badge">${fmt(item.unit_price, currency)}</td>
          <td class="total-price-cell">${fmt(total, currency)}</td>
          <td><button class="remove-btn" onclick="removeItem(${item.id})" title="Remove item">✕</button></td>
        </tr>`;
    });
  });

  // Grand total row
  html += `
    <tr class="grand-total-row">
      <td colspan="6" style="text-align:right;padding-right:16px;">Total Material Cost:</td>
      <td colspan="2" style="text-align:center;font-size:16px;color:var(--accent);">${fmt(grandTotal, currency)}</td>
      <td></td>
    </tr>`;

  tbody.innerHTML = html;

  // Update summary bar
  document.getElementById('sum-items').textContent = quotationItems.length;
  document.getElementById('sum-qty').textContent   = grandQty;
  document.getElementById('sum-total').textContent = fmt(grandTotal, currency);
}

// ─── Navigation to Quotation Page ─────────────────────────────
function goToQuotation() {
  if (quotationItems.length === 0) {
    showToast('Add some items first!', 'error');
    return;
  }
  window.open('/quotation', '_blank');
}

// ─── Customer Info Persistence ────────────────────────────────
function saveCustomerInfo() {
  const info = {
    project:  document.getElementById('fi-project').value,
    client:   document.getElementById('fi-client').value,
    att:      document.getElementById('fi-att').value,
    phone:    document.getElementById('fi-phone').value,
    ref:      document.getElementById('fi-ref').value,
    date:     document.getElementById('fi-date').value,
    prepared: document.getElementById('fi-prepared').value,
    prepphone:document.getElementById('fi-prepphone').value,
    saleseng: document.getElementById('fi-saleseng').value,
    currency: document.getElementById('fi-currency').value,
    notes:    document.getElementById('fi-notes').value
  };
  localStorage.setItem('mt_customer_info', JSON.stringify(info));
}

function loadCustomerInfo() {
  try {
    const info = JSON.parse(localStorage.getItem('mt_customer_info') || '{}');
    if (info.project)  document.getElementById('fi-project').value   = info.project;
    if (info.client)   document.getElementById('fi-client').value    = info.client;
    if (info.att)      document.getElementById('fi-att').value       = info.att;
    if (info.phone)    document.getElementById('fi-phone').value     = info.phone;
    if (info.ref)      document.getElementById('fi-ref').value       = info.ref;
    if (info.date)     document.getElementById('fi-date').value      = info.date;
    if (info.prepared) document.getElementById('fi-prepared').value  = info.prepared;
    if (info.prepphone)document.getElementById('fi-prepphone').value = info.prepphone;
    if (info.saleseng) document.getElementById('fi-saleseng').value  = info.saleseng;
    if (info.currency) document.getElementById('fi-currency').value  = info.currency;
    if (info.notes)    document.getElementById('fi-notes').value     = info.notes;
  } catch (_) {}
}

function toggleCustomerInfo() {
  const body = document.getElementById('customerInfoBody');
  body.style.display = body.style.display === 'none' ? '' : 'none';
}

// ─── Quotation Items Persistence ──────────────────────────────
function saveQuotationItems() {
  localStorage.setItem('mt_quotation_items', JSON.stringify(quotationItems));
}

function loadQuotationItems() {
  try {
    quotationItems = JSON.parse(localStorage.getItem('mt_quotation_items') || '[]');
    renderTable();
  } catch (_) {
    quotationItems = [];
  }
}

// ─── Upload Modal ─────────────────────────────────────────────
let selectedFile = null;

function openUploadModal() {
  document.getElementById('uploadModal').classList.remove('hidden');
}
function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  clearFileSelection();
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  selectedFile = file;

  document.getElementById('uploadArea').style.display  = 'none';
  document.getElementById('filePreview').style.display = '';
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatBytes(file.size);
  document.getElementById('uploadBtn').disabled   = false;
  document.getElementById('uploadResult').style.display = 'none';
}

function clearFileSelection() {
  selectedFile = null;
  document.getElementById('uploadArea').style.display  = '';
  document.getElementById('filePreview').style.display = 'none';
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('excelFileInput').value = '';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadResult').style.display   = 'none';
}

async function uploadFile() {
  if (!selectedFile) return;

  const progressWrap = document.getElementById('uploadProgress');
  const progressText = document.getElementById('uploadProgressText');
  const progressBar  = document.getElementById('progressBar');
  const resultDiv    = document.getElementById('uploadResult');
  const btn          = document.getElementById('uploadBtn');

  btn.disabled = true;
  progressWrap.style.display = '';
  resultDiv.style.display    = 'none';

  const steps = [
    [15, 'Reading Excel file...'],
    [35, 'Detecting sheet structure...'],
    [55, 'Mapping columns...'],
    [75, 'Extracting products...'],
    [90, 'Saving database...']
  ];

  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) {
      const [pct, text] = steps[stepIdx++];
      progressBar.style.width  = pct + '%';
      progressText.textContent = text;
    }
  }, 400);

  const formData = new FormData();
  formData.append('excel', selectedFile);

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    clearInterval(interval);

    if (res.ok && data.success) {
      progressBar.style.width  = '100%';
      progressText.textContent = 'Done!';

      resultDiv.style.display  = '';
      resultDiv.innerHTML = `
        <div style="padding:12px;background:#d4f0e3;border-radius:8px;border:1px solid #a8d5be;color:#1a6640;">
          <strong>✓ Success!</strong> Loaded <strong>${data.count}</strong> products from your Excel file.
          <br><small>The product database has been updated.</small>
        </div>`;

      // Reload products
      await fetchProducts();
      populateFilter('category');
      setTimeout(closeUploadModal, 1500);
    } else {
      throw new Error(data.error || 'Upload failed');
    }
  } catch (err) {
    clearInterval(interval);
    progressWrap.style.display = 'none';
    resultDiv.style.display    = '';
    resultDiv.innerHTML = `
      <div style="padding:12px;background:#ffe0e0;border-radius:8px;border:1px solid #f5b5b5;color:#a00;">
        <strong>✗ Error:</strong> ${err.message}
        <br><small>Please check the format guide and try again.</small>
      </div>`;
    btn.disabled = false;
  }
}

function toggleAdvanced() {
  const div = document.getElementById('advancedMapping');
  div.style.display = div.style.display === 'none' ? '' : 'none';
}

// ─── Drag & Drop for Upload ───────────────────────────────────
function setupDragDrop() {
  const area = document.getElementById('uploadArea');
  if (!area) return;

  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const fakeInput = { files: [file] };
      handleFileSelect(fakeInput);
    }
  });
}

// ─── Utilities ────────────────────────────────────────────────
function fmt(val, currency) {
  const n = parseFloat(val) || 0;
  return `${currency || 'JOD'} ${n.toFixed(2)}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
