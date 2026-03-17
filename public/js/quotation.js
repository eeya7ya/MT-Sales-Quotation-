/* ═══════════════════════════════════════════════════════════════
   MT Sales Quotation — Quotation Page Logic (Multi-Page)
═══════════════════════════════════════════════════════════════ */

'use strict';

let items    = [];
let info     = {};
let currency = 'JOD';
let logoData = null;

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  renderQuotation();
});

function loadData() {
  try {
    items    = JSON.parse(localStorage.getItem('mt_quotation_items') || '[]');
    info     = JSON.parse(localStorage.getItem('mt_customer_info')   || '{}');
    currency = info.currency || 'JOD';
    logoData = localStorage.getItem('mt_company_logo') || null;
  } catch (_) {
    items = []; info = {};
  }
}

// ─── Render the full quotation ────────────────────────────────
function renderQuotation() {
  const doc = document.getElementById('quotationDoc');

  if (!items || items.length === 0) {
    doc.style.display = 'none';
    document.getElementById('emptyState').style.display = '';
    return;
  }

  // Group items by system
  const grouped = {};
  items.forEach(item => {
    const key = item.system || 'General';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  const systems   = Object.entries(grouped);
  let   grandTotal = 0;
  let   itemNum    = 1;

  // Calculate grand total
  items.forEach(it => { grandTotal += it.unit_price * it.qty; });

  // Clear and build pages
  doc.innerHTML = '<input type="file" id="logoInput" accept="image/*" style="display:none" onchange="uploadLogo(this)">';

  systems.forEach(([system, groupItems], pageIndex) => {
    const isFirst = pageIndex === 0;
    const isLast  = pageIndex === systems.length - 1;

    const page = document.createElement('div');
    page.className = 'q-page' + (isLast ? ' q-last-page' : '');

    // ── Company Header ────────────────────────────────────────
    const date = info.date ? formatDisplayDate(info.date) : new Date().toLocaleDateString('en-GB');
    page.innerHTML += `
      <div class="company-header">
        <label class="company-logo-upload" title="Click to upload company logo" onclick="document.getElementById('logoInput').click()">
          <div id="logoWrap${pageIndex}">${buildLogoHTML()}</div>
          <div class="logo-overlay">Click to change logo</div>
        </label>
        <div style="flex:1;text-align:center;">
          <div style="font-size:22px;font-weight:800;letter-spacing:.3px;">MT Technology Solutions</div>
          <div style="font-size:12px;opacity:.8;margin-top:3px;">Security · Networking · Audio Systems</div>
        </div>
        <div class="company-info">
          <div class="doc-title">Sales Quotation</div>
          <div style="font-size:11px;opacity:.7;margin-top:5px;">${escHtml(date)}</div>
        </div>
      </div>`;

    // ── Meta Section (full on first page, compact on subsequent) ─
    if (isFirst) {
      page.innerHTML += buildFullMeta(date);
    } else {
      page.innerHTML += buildCompactMeta(date);
    }

    // ── System Banner ──────────────────────────────────────────
    page.innerHTML += `
      <div class="system-page-banner">${escHtml(system.toUpperCase())}</div>`;

    // ── Items Table ────────────────────────────────────────────
    let subtotal = 0;
    let tableRows = '';

    groupItems.forEach(item => {
      const total = item.unit_price * item.qty;
      subtotal += total;

      // Image cell: show actual image or leave blank
      const imgCell = item.image_data
        ? `<img src="${item.image_data}" class="product-thumb" alt="${escHtml(item.model)}">`
        : `<div class="product-thumb-blank"></div>`;

      tableRows += `
        <tr>
          <td class="td-num">${itemNum++}</td>
          <td class="td-brand">${escHtml(item.brand || '')}</td>
          <td style="text-align:center;">${imgCell}</td>
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

    // Subtotal row for this system (or grand total on last page)
    if (isLast && systems.length === 1) {
      // Single system: show as "Total Material Cost"
      tableRows += `
        <tr class="total-row">
          <td colspan="6" class="total-label">Total Material Cost:</td>
          <td colspan="2" class="total-value">${fmt(grandTotal)}</td>
        </tr>`;
    } else if (isLast) {
      // Last page with multiple systems: show subtotal + grand total
      tableRows += `
        <tr class="subtotal-row">
          <td colspan="6" class="total-label" style="font-size:12px;">Subtotal — ${escHtml(system)}:</td>
          <td colspan="2" class="total-value" style="font-size:13px;">${fmt(subtotal)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="6" class="total-label">Total Material Cost:</td>
          <td colspan="2" class="total-value">${fmt(grandTotal)}</td>
        </tr>`;
    } else {
      // Not last page: show subtotal only
      tableRows += `
        <tr class="subtotal-row">
          <td colspan="6" class="total-label" style="font-size:12px;">Subtotal — ${escHtml(system)}:</td>
          <td colspan="2" class="total-value" style="font-size:13px;">${fmt(subtotal)}</td>
        </tr>`;
    }

    page.innerHTML += `
      <div class="items-section">
        <table class="items-table" id="itemsTable">
          <thead>
            <tr>
              <th class="center" style="width:36px;">#</th>
              <th style="width:70px;">Brand</th>
              <th style="width:56px;">Picture</th>
              <th style="width:130px;">Model</th>
              <th>Description</th>
              <th class="center" style="width:50px;">Qty</th>
              <th class="right" style="width:90px;">Unit Price</th>
              <th class="right" style="width:100px;">Total Price</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;

    // ── Notes & Footer on last page ────────────────────────────
    if (isLast) {
      const notes = info.notes || '';
      if (notes.trim()) {
        page.innerHTML += `
          <div class="notes-section">
            <div class="notes-title">Notes & Terms</div>
            <div class="notes-text">${escHtml(notes)}</div>
          </div>`;
      }
      page.innerHTML += `
        <div class="doc-footer">
          <div>This quotation is valid for 30 days. Prices subject to change without prior notice. | MT Technology Solutions</div>
        </div>`;
    }

    doc.appendChild(page);
  });
}

// ─── Meta builders ────────────────────────────────────────────
function buildFullMeta(date) {
  const left = [
    ['Date',    date],
    ['Project', info.project  || ''],
    ['Client',  info.client   || ''],
    ['Att.',    info.att      || ''],
    ['Phone',   info.phone    || '']
  ].filter(([,v]) => v)
   .map(([l,v]) => `<div class="meta-row"><span class="meta-label">${l}:</span><span class="meta-value ${l==='Project'||l==='Client'?'bold':''}">${escHtml(v)}</span></div>`)
   .join('');

  const right = [
    ['Ref.',                    info.ref      || ''],
    ['Presales Engineer',       info.prepared || ''],
    ['Presales Engineer Phone', info.prepphone|| ''],
    ['Sales Engineer',          info.saleseng || '']
  ].filter(([,v]) => v)
   .map(([l,v]) => `<div class="meta-row"><span class="meta-label">${l}:</span><span class="meta-value bold">${escHtml(v)}</span></div>`)
   .join('');

  return `<div class="meta-section"><div class="meta-col">${left}</div><div class="meta-col">${right}</div></div>`;
}

function buildCompactMeta(date) {
  const parts = [];
  if (date)          parts.push(`Date: <strong>${escHtml(date)}</strong>`);
  if (info.ref)      parts.push(`Ref: <strong>${escHtml(info.ref)}</strong>`);
  if (info.client)   parts.push(`Client: <strong>${escHtml(info.client)}</strong>`);
  if (info.project)  parts.push(`Project: <strong>${escHtml(info.project)}</strong>`);
  return `<div class="meta-compact">${parts.join(' &nbsp;|&nbsp; ')}</div>`;
}

// ─── Logo Management ──────────────────────────────────────────
function buildLogoHTML() {
  if (logoData) {
    return `<img src="${logoData}" class="company-logo" alt="Company Logo">`;
  }
  return `<div class="company-logo-placeholder">🏢</div>`;
}

function uploadLogo(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
  if (file.size > 2 * 1024 * 1024)    { showToast('Image too large (max 2MB)', 'error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    logoData = e.target.result;
    localStorage.setItem('mt_company_logo', logoData);
    // Update all logo wraps on page
    document.querySelectorAll('[id^="logoWrap"]').forEach(wrap => {
      wrap.innerHTML = buildLogoHTML();
    });
    showToast('Logo updated', 'success');
  };
  reader.readAsDataURL(file);
}

// ─── Actions ─────────────────────────────────────────────────
function printQuotation() {
  window.print();
}

function exportPDF() {
  const toolbar = document.getElementById('toolbar');
  toolbar.style.display = 'none';

  const doc = document.getElementById('quotationDoc');
  const ref    = (info.ref     || 'Quotation').replace(/[^a-z0-9]/gi, '_');
  const client = (info.client  || info.project || 'Client').replace(/[^a-z0-9]/gi, '_');
  const filename = `Quotation_${ref}_${client}.pdf`;

  const opt = {
    margin:      [8, 8, 8, 8],
    filename,
    image:       { type: 'jpeg', quality: 0.96 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:   { mode: ['css', 'legacy'], before: '.q-page:not(:first-child)' }
  };

  showToast('Generating PDF…', 'info');

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
