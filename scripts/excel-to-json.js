#!/usr/bin/env node
/**
 * MT Sales Quotation – Excel to JSON Converter
 * ─────────────────────────────────────────────
 * Usage:
 *   node scripts/excel-to-json.js <path/to/file.xlsx> [--output data/products.json]
 *
 * The script supports two Excel structures:
 *   A) Standard template  – has explicit column headers: Category, System, Brand, Type,
 *                           Series, Model, Description, Specifications, DPP_Price, SI_Price, EndUser_Price
 *   B) Branded price list – like the Hikvision / Fanvil / Audio sheets, where:
 *                           • Each sheet represents one Brand/System
 *                           • Section-header rows separate product groups (used as "Series")
 *                           • Column headers may vary (MODEL, DPP, SI/INSTALLER, END USER, DESCRIPTION)
 */

'use strict';

const XLSX  = require('xlsx');
const fs    = require('fs');
const path  = require('path');

// ─── CLI ───────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const inFile  = args[0];
const outIdx  = args.indexOf('--output');
const outFile = outIdx !== -1 ? args[outIdx + 1] : path.join(__dirname, '..', 'data', 'products.json');

if (!inFile) {
  console.error('Usage: node scripts/excel-to-json.js <excel-file> [--output <json-file>]');
  process.exit(1);
}
if (!fs.existsSync(inFile)) {
  console.error('File not found:', inFile);
  process.exit(1);
}

// ─── Main ──────────────────────────────────────────────────────
console.log('Reading:', inFile);
const workbook = XLSX.readFile(inFile);
const products = convertWorkbook(workbook);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(products, null, 2));

console.log(`✓ Extracted ${products.length} products → ${outFile}`);
if (products.length > 0) {
  console.log('  Sample:', JSON.stringify(products[0], null, 2));
}

// ─── Conversion ────────────────────────────────────────────────

function convertWorkbook(wb) {
  const all = [];
  wb.SheetNames.forEach(name => {
    console.log(`  Sheet: "${name}"`);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const sheetProducts = convertSheet(rows, name);
    console.log(`    → ${sheetProducts.length} products`);
    all.push(...sheetProducts);
  });
  return all;
}

function convertSheet(rows, sheetName) {
  if (!rows || rows.length < 2) return [];

  // ── Step 1: Find header row ────────────────────────────────
  const { headerIdx, headers, mode } = detectHeader(rows);
  if (headerIdx === -1) {
    console.log('    No header row found – skipping');
    return [];
  }
  console.log(`    Mode: ${mode}, header row: ${headerIdx}, headers: [${headers.join(', ')}]`);

  // ── Step 2: Build column map ───────────────────────────────
  const cm = buildColumnMap(headers, mode);
  console.log('    Column map:', cm);

  // ── Step 3: Infer sheet-level defaults (for price-list mode) ─
  const sheetMeta = inferSheetMeta(rows, sheetName, headerIdx);

  // ── Step 4: Parse data rows ────────────────────────────────
  return parseRows(rows, headerIdx, cm, sheetMeta, mode);
}

/**
 * Detect whether the sheet uses:
 *  - 'standard' mode (explicit column names incl. Category/Brand/etc.)
 *  - 'pricelist' mode (only MODEL/DPP/SI/END USER/DESCRIPTION)
 */
function detectHeader(rows) {
  const STANDARD_KEYS  = ['category','system','brand','type','series'];
  const PRICELIST_KEYS = ['model','dpp','si','installer','end user','enduser','description'];

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = rows[i].map(c => String(c).toLowerCase().trim());
    const stdCount  = cells.filter(c => STANDARD_KEYS.some(k => c === k)).length;
    const plCount   = cells.filter(c => PRICELIST_KEYS.some(k => c.includes(k))).length;

    if (stdCount >= 2) return { headerIdx: i, headers: cells, mode: 'standard' };
    if (plCount  >= 2) return { headerIdx: i, headers: cells, mode: 'pricelist' };
  }
  return { headerIdx: -1, headers: [], mode: null };
}

function buildColumnMap(headers, mode) {
  const find = (...candidates) => {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h === c || h.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  if (mode === 'standard') {
    return {
      category:       find('category'),
      system:         find('system'),
      brand:          find('brand'),
      type:           find('type'),
      series:         find('series'),
      model:          find('model no.', 'model no', 'model'),
      description:    find('description', 'desc'),
      specifications: find('specifications', 'specs', 'spec'),
      dpp:            find('dpp', 'dpp_price', 'dpp price'),
      si:             find('si_price', 'si price', 'si/installer', 'installer', 'reseller', 'silver'),
      enduser:        find('enduser_price', 'end user price', 'end user', 'enduser', 'end_user', 'end useer')
    };
  } else {
    // pricelist mode
    return {
      category:       -1,
      system:         -1,
      brand:          -1,
      type:           -1,
      series:         -1,
      model:          find('model no.', 'model no', 'model'),
      description:    find('description', 'descreption', 'desc'),
      specifications: find('specifications', 'specs'),
      dpp:            find('dpp'),
      si:             find('si/installer', 'si price', 'si_price', 'installer', 'silver partner'),
      enduser:        find('end user', 'enduser', 'end useer', 'end_user')
    };
  }
}

/**
 * For pricelist sheets, try to infer category/system/brand from:
 *  - The sheet name itself
 *  - A title row near the top
 *  - Known patterns
 */
function inferSheetMeta(rows, sheetName, headerIdx) {
  // Look for a title row above the header
  let title = '';
  for (let i = 0; i < headerIdx; i++) {
    const cell = String(rows[i][0] || rows[i][1] || '').trim();
    if (cell.length > 3) { title = cell; break; }
  }

  const name = sheetName.toLowerCase();
  let category = 'General', system = sheetName, brand = sheetName;

  // Common patterns
  if (name.includes('cctv') || name.includes('camera') || name.includes('hikvision') || name.includes('dahua')) {
    category = 'Security';
    system   = 'CCTV';
    brand    = extractBrand(sheetName) || 'Hikvision';
  } else if (name.includes('phone') || name.includes('fanvil') || name.includes('voip') || name.includes('ip phone')) {
    category = 'Networking';
    system   = 'IP Phones';
    brand    = extractBrand(sheetName) || 'Fanvil';
  } else if (name.includes('audio') || name.includes('amplif') || name.includes('speaker') || name.includes('itc') || name.includes('pa')) {
    category = 'Audio';
    system   = 'Public Address';
    brand    = extractBrand(sheetName) || 'ITC';
  } else if (name.includes('access') || name.includes('door')) {
    category = 'Security';
    system   = 'Access Control';
    brand    = extractBrand(sheetName) || sheetName;
  } else if (name.includes('alarm') || name.includes('intrus')) {
    category = 'Security';
    system   = 'Intrusion';
    brand    = extractBrand(sheetName) || sheetName;
  }

  // Try to override brand from title row
  const knownBrands = ['hikvision','dahua','fanvil','grandstream','cisco','axis','bosch','honeywell','samsung','itc','paso','toa','bose','yamaha','shure'];
  for (const b of knownBrands) {
    if (title.toLowerCase().includes(b) || name.includes(b)) {
      brand = b.charAt(0).toUpperCase() + b.slice(1);
      break;
    }
  }

  return { category, system, brand, title };
}

function extractBrand(sheetName) {
  const known = ['Hikvision','Dahua','Fanvil','Grandstream','Cisco','Axis','Bosch','Samsung','ITC','Paso','TOA','Yamaha'];
  for (const b of known) {
    if (sheetName.toLowerCase().includes(b.toLowerCase())) return b;
  }
  return '';
}

function parseRows(rows, headerIdx, cm, sheetMeta, mode) {
  const products = [];
  let currentSection = '';

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

    const nonEmpty = row.filter(c => String(c).trim() !== '' && c !== null).length;
    const hasPrice = row.some(c => {
      const n = parseFloat(c);
      return !isNaN(n) && n > 0 && n < 100000;
    });

    // Detect section header rows (rows with few non-empty cells, no numeric prices)
    if (nonEmpty <= 3 && !hasPrice) {
      const candidate = String(row[0] || row[1] || row[2] || '').trim();
      if (candidate && candidate.length > 2 && candidate.toLowerCase() !== 'model') {
        currentSection = candidate;
        continue;
      }
    }

    // Extract model
    const modelVal = cm.model >= 0 ? String(row[cm.model] || '').trim() : '';
    if (!modelVal || modelVal.toLowerCase() === 'model' || modelVal.toLowerCase() === 'model no.') continue;
    if (!hasPrice && mode === 'pricelist') continue;  // skip rows without any price in pricelist mode

    const get   = idx => idx >= 0 ? String(row[idx] || '').trim() : '';
    const price = idx => idx >= 0 ? parseFloat(row[idx]) || 0 : 0;

    const p = {
      category:       (mode === 'standard' ? get(cm.category) : '') || sheetMeta.category,
      system:         (mode === 'standard' ? get(cm.system)   : '') || sheetMeta.system,
      brand:          (mode === 'standard' ? get(cm.brand)    : '') || sheetMeta.brand,
      type:           (mode === 'standard' ? get(cm.type)     : '') || currentSection,
      series:         (mode === 'standard' ? get(cm.series)   : '') || currentSection,
      model:          modelVal,
      description:    get(cm.description),
      specifications: get(cm.specifications),
      dpp_price:      price(cm.dpp),
      si_price:       price(cm.si),
      enduser_price:  price(cm.enduser)
    };

    // For Fanvil-style with only one price column, duplicate it
    if (p.si_price === 0 && p.dpp_price === 0 && p.enduser_price === 0) continue;
    if (p.si_price === 0 && p.dpp_price > 0)   p.si_price = p.dpp_price;
    if (p.enduser_price === 0 && p.si_price > 0) p.enduser_price = Math.round(p.si_price * 1.2 * 100) / 100;
    if (p.dpp_price === 0 && p.si_price > 0)    p.dpp_price = Math.round(p.si_price * 0.9 * 100) / 100;

    products.push(p);
  }

  return products;
}
