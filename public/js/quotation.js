/* ═══════════════════════════════════════════════════════════════
   MT Sales Quotation — Quotation Page Logic
═══════════════════════════════════════════════════════════════ */

'use strict';

let items    = [];
let info     = {};
let currency = 'JOD';

// ─── Product category → icon mapping ─────────────────────────
const CATEGORY_ICONS = {
  'cctv':           '📷',
  'camera':         '📷',
  'ip camera':      '📷',
  'analog camera':  '📷',
  'nvr':            '🖥',
  'dvr':            '🖥',
  'hdd':            '💾',
  'access control': '🔐',
  'intrusion':      '🔔',
  'ip phone':       '☎',
  'phone':          '☎',
  'poe switch':     '🔌',
  'switch':         '🔌',
  'amplifier':      '🔊',
  'speaker':        '🔈',
  'audio':          '🎵',
  'installation':   '🔧',
  'service':        '🔧',
  'default':        '📦'
};

function getIcon(item) {
  const haystack = ((item.type || '') + ' ' + (item.system || '') + ' ' + (item.description || '')).toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (haystack.includes(key)) return icon;
  }
  return CATEGORY_ICONS.default;
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  renderQuotation();
  loadLogo();
});

function loadData() {
  try {
    items    = JSON.parse(localStorage.getItem('mt_quotation_items') || '[]');
    info     = JSON.parse(localStorage.getItem('mt_customer_info')   || '{}');
    currency = info.currency || 'JOD';
  } catch (_) {
    items = []; info = {};
  }
}

// ─── Render the full quotation ────────────────────────────────
function renderQuotation() {
  if (!items || items.length === 0) {
    document.getElementById('quotationDoc').style.display = 'none';
    document.getElementById('emptyState').style.display   = '';
    return;
  }

  renderMeta();
  renderItems();
  renderNotes();
}

function renderMeta() {
  const date = info.date ? formatDisplayDate(info.date) : new Date().toLocaleDateString('en-GB');
  document.getElementById('headerDate').textContent = date;

  // Left column: project info
  const left = [
    ['Date',    date],
    ['Project', info.project  || ''],
    ['Client',  info.client   || ''],
    ['Att.',    info.att      || ''],
    ['Phone',   info.phone    || '']
  ];
  document.getElementById('metaLeft').innerHTML = left
    .filter(([,v]) => v)
    .map(([l,v]) => `
      <div class="meta-row">
        <span class="meta-label">${l}:</span>
        <span class="meta-value ${l === 'Project' || l === 'Client' ? 'bold' : ''}">${v}</span>
      </div>`).join('');

  // Right column: reference info
  const right = [
    ['Ref.',                    info.ref      || ''],
    ['Presales Engineer',       info.prepared || ''],
    ['Presales Engineer Phone', info.prepphone|| ''],
    ['Sales Engineer',          info.saleseng || '']
  ];
  document.getElementById('metaRight').innerHTML = right
    .filter(([,v]) => v)
    .map(([l,v]) => `
      <div class="meta-row">
        <span class="meta-label">${l}:</span>
        <span class="meta-value bold">${v}</span>
      </div>`).join('');
}

function renderItems() {
  const tbody = document.getElementById('itemsBody');
  const section = document.getElementById('itemsSection');

  // Group items by system
  const grouped = {};
  items.forEach(item => {
    const key = item.system || 'General';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  let html       = '';
  let itemNum    = 1;
  let grandTotal = 0;

  Object.entries(grouped).forEach(([system, groupItems]) => {
    // Section header injected as a non-table element (handled via colspanned tr)
    html += `
      <tr>
        <td colspan="8" style="padding:0;">
          <div style="background:#c8485a;color:#fff;padding:8px 10px;font-weight:700;font-size:12.5px;letter-spacing:.5px;text-align:center;text-transform:uppercase;">
            ${escHtml(system)}
          </div>
        </td>
      </tr>`;

    groupItems.forEach(item => {
      const total = item.unit_price * item.qty;
      grandTotal += total;
      const icon  = getIcon(item);

      html += `
        <tr>
          <td class="td-num">${itemNum++}</td>
          <td class="td-brand">${escHtml(item.brand || '')}</td>
          <td style="text-align:center;">
            <div class="product-thumb-placeholder">${icon}</div>
          </td>
          <td class="td-model">${escHtml(item.model)}</td>
          <td class="td-desc">
            <strong>${escHtml(item.description || item.model)}</strong>
            ${item.specifications ? `<span>${escHtml(truncate(item.specifications, 120))}</span>` : ''}
          </td>
          <td class="td-qty">${item.qty}</td>
          <td class="td-price">${fmt(item.unit_price)}</td>
          <td class="td-total">${fmt(total)}</td>
        </tr>`;
    });
  });

  // Grand total row
  html += `
    <tr class="total-row">
      <td colspan="6" class="total-label">Total Material Cost:</td>
      <td colspan="2" class="total-value">${fmt(grandTotal)}</td>
    </tr>`;

  tbody.innerHTML = html;
}

function renderNotes() {
  const notes    = info.notes || '';
  const section  = document.getElementById('notesSection');
  if (notes.trim()) {
    document.getElementById('notesText').textContent = notes;
    section.style.display = '';
  } else {
    section.style.display = 'none';
  }
}

// ─── Logo Management ──────────────────────────────────────────
function uploadLogo(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
  if (file.size > 2 * 1024 * 1024)    { showToast('Image too large (max 2MB)', 'error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    localStorage.setItem('mt_company_logo', dataUrl);
    displayLogo(dataUrl);
    showToast('Logo uploaded successfully', 'success');
  };
  reader.readAsDataURL(file);
}

function loadLogo() {
  const logoData = localStorage.getItem('mt_company_logo');
  if (logoData) displayLogo(logoData);
}

function displayLogo(dataUrl) {
  const wrap = document.getElementById('logoWrap');
  wrap.innerHTML = `<img src="${dataUrl}" class="company-logo" alt="Company Logo">`;
}

// ─── Actions ─────────────────────────────────────────────────
function printQuotation() {
  window.print();
}

function exportPDF() {
  const btn = document.querySelectorAll('.tbtn-pdf')[0];
  const toolbar = document.getElementById('toolbar');
  toolbar.style.display = 'none';

  const doc = document.getElementById('quotationDoc');
  const ref = (info.ref || 'Quotation').replace(/[^a-z0-9]/gi, '_');
  const client = (info.client || info.project || 'Client').replace(/[^a-z0-9]/gi, '_');
  const filename = `Quotation_${ref}_${client}.pdf`;

  const opt = {
    margin:      [8, 8, 8, 8],
    filename,
    image:       { type: 'jpeg', quality: 0.96 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast('Generating PDF...', 'info');

  html2pdf()
    .set(opt)
    .from(doc)
    .save()
    .then(() => {
      toolbar.style.display = '';
      showToast('PDF downloaded!', 'success');
    })
    .catch(err => {
      toolbar.style.display = '';
      showToast('PDF export failed: ' + err.message, 'error');
    });
}

function editQuotation() {
  window.location.href = '/';
}

// ─── Utilities ────────────────────────────────────────────────
function fmt(val) {
  const n = parseFloat(val) || 0;
  return `${currency} ${n.toFixed(2)}`;
}

function formatDisplayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.style.cssText = `
    background:${type==='error'?'#c0392b':type==='success'?'#27ae60':'#2980b9'};
    color:#fff; padding:10px 16px; border-radius:7px; font-size:13px;
    box-shadow:0 3px 12px rgba(0,0,0,.2); max-width:300px;
    animation: slideIn .3s ease;
  `;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
