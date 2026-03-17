'use strict';

const express = require('express');
const multer  = require('multer');
const xlsx    = require('xlsx');
const path    = require('path');
const fs      = require('fs');
const cors    = require('cors');
const crypto  = require('crypto');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Multer ───────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 },   // 300 MB – supports large price lists
  fileFilter: (_, file, cb) => {
    const ok = file.originalname.match(/\.(xlsx|xls)$/i) ||
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.ms-excel', 'application/octet-stream'].includes(file.mimetype);
    cb(ok ? null : new Error('Only Excel files (.xlsx/.xls) are allowed'), ok);
  }
});

// ─── PostgreSQL / Neon ────────────────────────────────────────
let pool  = null;
let useDB = false;

(function initPool() {
  const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL ||
             process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NO_SSL;
  if (!cs) { console.log('ℹ No DB env – using JSON fallback'); return; }
  try {
    const { Pool } = require('pg');
    pool  = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,   // 10 s – prevents hanging on DB unavailable
      idleTimeoutMillis:       30000,
      statement_timeout:       15000    // 15 s query timeout
    });
    useDB = true;
    console.log('✓ PostgreSQL pool created');
  } catch (e) {
    console.error('⚠ pg module error:', e.message);
  }
})();

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id            SERIAL PRIMARY KEY,
        category      VARCHAR(150),
        system        VARCHAR(150),
        brand         VARCHAR(150),
        type          VARCHAR(150),
        series        VARCHAR(200),
        model         VARCHAR(300) NOT NULL,
        description   TEXT,
        specifications TEXT,
        dpp_price     NUMERIC(12,3) DEFAULT 0,
        si_price      NUMERIC(12,3) DEFAULT 0,
        enduser_price NUMERIC(12,3) DEFAULT 0,
        image_data    TEXT,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    // Add image_data column if upgrading from older schema
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data TEXT
    `);
    const { rows } = await pool.query('SELECT COUNT(*) FROM products');
    const count = parseInt(rows[0].count);
    if (count === 0) await seedFromJSON();
    else console.log(`✓ PostgreSQL (Neon) ready – ${count} products`);
  } catch (e) {
    console.error('⚠ DB init error:', e.message);
    useDB = false;
  }
}

async function seedFromJSON() {
  const f = path.join(__dirname, 'data', 'products.json');
  if (!fs.existsSync(f)) return;
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    await dbInsertBulk(data);
    console.log(`✓ Seeded ${data.length} products into PostgreSQL`);
  } catch (e) {
    console.warn('⚠ Seed warning:', e.message);
  }
}

async function dbInsertBulk(products) {
  if (!pool || !products.length) return;
  const CHUNK = 200;
  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK);
    const vals = [], params = [];
    let n = 1;
    for (const p of chunk) {
      vals.push(`($${n},$${n+1},$${n+2},$${n+3},$${n+4},$${n+5},$${n+6},$${n+7},$${n+8},$${n+9},$${n+10},$${n+11})`);
      n += 12;
      params.push(
        p.category||'General', p.system||'', p.brand||'', p.type||'', p.series||'',
        p.model||'', p.description||'', p.specifications||'',
        +p.dpp_price||0, +p.si_price||0, +p.enduser_price||0,
        p.image_data||null
      );
    }
    await pool.query(
      `INSERT INTO products (category,system,brand,type,series,model,description,specifications,dpp_price,si_price,enduser_price,image_data) VALUES ${vals.join(',')}`,
      params
    );
  }
}

// ─── In-memory cache + JSON fallback ──────────────────────────
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
let productsCache = [];

async function loadProducts() {
  if (useDB && pool) {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM products ORDER BY category,system,brand,type,series,model'
      );
      productsCache = rows.map(r => ({
        ...r,
        dpp_price:     parseFloat(r.dpp_price)     || 0,
        si_price:      parseFloat(r.si_price)      || 0,
        enduser_price: parseFloat(r.enduser_price) || 0
      }));
      return;
    } catch (e) { console.error('⚠ DB load error:', e.message); }
  }
  try {
    const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    productsCache = data.map((p, i) => ({ id: i + 1, ...p }));
  } catch (_) { productsCache = []; }
}

function saveJSON() {
  try {
    // eslint-disable-next-line no-unused-vars
    const data = productsCache.map(({ id, created_at, updated_at, ...rest }) => rest);
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

// ─── Admin Auth ───────────────────────────────────────────────
const sessions = new Set();

function adminAuth(req, res, next) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  if (sessions.has(tok)) return next();
  res.status(401).json({ error: 'Unauthorized – admin login required' });
}

// ─── Admin Routes ──────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const tok = crypto.randomBytes(32).toString('hex');
    sessions.add(tok);
    res.json({ success: true, token: tok });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/admin/logout', adminAuth, (req, res) => {
  sessions.delete((req.headers.authorization || '').replace('Bearer ', ''));
  res.json({ success: true });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  await loadProducts();
  const uniq = k => [...new Set(productsCache.map(p => p[k]).filter(Boolean))];
  res.json({
    total:        productsCache.length,
    categories:   uniq('category').length,
    brands:       uniq('brand').length,
    categoryList: uniq('category').sort(),
    brandList:    uniq('brand').sort(),
    dbType:       useDB ? 'PostgreSQL (Neon)' : 'JSON File'
  });
});

// ─── Products (public read) ────────────────────────────────────

app.get('/api/products', async (req, res) => {
  await loadProducts();
  res.json(productsCache);
});

app.get('/api/filter', async (req, res) => {
  await loadProducts();
  const { category, system, brand, type, series } = req.query;
  let f = [...productsCache];
  if (category) f = f.filter(p => p.category === category);
  if (system)   f = f.filter(p => p.system   === system);
  if (brand)    f = f.filter(p => p.brand    === brand);
  if (type)     f = f.filter(p => p.type     === type);
  if (series)   f = f.filter(p => p.series   === series);
  const uniq = k => [...new Set(f.map(p => p[k]).filter(Boolean))].sort();
  res.json({
    categories: uniq('category'), systems: uniq('system'),
    brands: uniq('brand'),        types:   uniq('type'),
    series: uniq('series'),
    models: f.map(p => ({
      id: p.id, model: p.model, description: p.description,
      specifications: p.specifications,
      dpp_price: p.dpp_price, si_price: p.si_price, enduser_price: p.enduser_price,
      brand: p.brand, type: p.type, series: p.series, category: p.category, system: p.system
    }))
  });
});

app.get('/api/product', async (req, res) => {
  await loadProducts();
  const p = productsCache.find(x => x.model === req.query.model);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

// ─── Products CRUD (admin only) ────────────────────────────────

app.post('/api/products', adminAuth, async (req, res) => {
  const p = req.body;
  if (!p.model) return res.status(400).json({ error: 'model is required' });
  try {
    if (useDB && pool) {
      const { rows } = await pool.query(
        `INSERT INTO products (category,system,brand,type,series,model,description,specifications,dpp_price,si_price,enduser_price,image_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [p.category||'General', p.system||'', p.brand||'', p.type||'', p.series||'',
         p.model, p.description||'', p.specifications||'',
         +p.dpp_price||0, +p.si_price||0, +p.enduser_price||0,
         p.image_data||null]
      );
      await loadProducts();
      res.json({ success: true, product: rows[0] });
    } else {
      const np = {
        id: (productsCache.length + 1),
        category: p.category||'General', system: p.system||'', brand: p.brand||'',
        type: p.type||'', series: p.series||'', model: p.model,
        description: p.description||'', specifications: p.specifications||'',
        dpp_price: +p.dpp_price||0, si_price: +p.si_price||0, enduser_price: +p.enduser_price||0,
        image_data: p.image_data||null
      };
      productsCache.push(np);
      saveJSON();
      res.json({ success: true, product: np });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const p  = req.body;
  if (!p.model) return res.status(400).json({ error: 'model is required' });
  try {
    if (useDB && pool) {
      const { rows, rowCount } = await pool.query(
        `UPDATE products SET category=$1,system=$2,brand=$3,type=$4,series=$5,model=$6,
         description=$7,specifications=$8,dpp_price=$9,si_price=$10,enduser_price=$11,
         image_data=$12,updated_at=NOW() WHERE id=$13 RETURNING *`,
        [p.category||'General', p.system||'', p.brand||'', p.type||'', p.series||'',
         p.model, p.description||'', p.specifications||'',
         +p.dpp_price||0, +p.si_price||0, +p.enduser_price||0,
         p.image_data||null, id]
      );
      if (!rowCount) return res.status(404).json({ error: 'Product not found' });
      await loadProducts();
      res.json({ success: true, product: rows[0] });
    } else {
      const idx = productsCache.findIndex(x => x.id === id);
      if (idx < 0) return res.status(404).json({ error: 'Product not found' });
      Object.assign(productsCache[idx], {
        category: p.category||'General', system: p.system||'', brand: p.brand||'',
        type: p.type||'', series: p.series||'', model: p.model,
        description: p.description||'', specifications: p.specifications||'',
        dpp_price: +p.dpp_price||0, si_price: +p.si_price||0, enduser_price: +p.enduser_price||0,
        image_data: p.image_data||null
      });
      saveJSON();
      res.json({ success: true, product: productsCache[idx] });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (useDB && pool) {
      const { rowCount } = await pool.query('DELETE FROM products WHERE id=$1', [id]);
      if (!rowCount) return res.status(404).json({ error: 'Product not found' });
      await loadProducts();
    } else {
      const idx = productsCache.findIndex(x => x.id === id);
      if (idx < 0) return res.status(404).json({ error: 'Product not found' });
      productsCache.splice(idx, 1);
      saveJSON();
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Upload Excel (admin only) ─────────────────────────────────

app.post('/api/upload', adminAuth, upload.single('excel'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const { products: newProds, sheetSummary } = parseExcelSmart(wb);
    if (!newProds.length) {
      return res.status(400).json({
        error: 'No products detected. Ensure the file has Model and at least one price column.',
        sheetSummary
      });
    }
    if (useDB && pool) {
      await pool.query('DELETE FROM products');
      await dbInsertBulk(newProds);
      await loadProducts();
    } else {
      productsCache = newProds.map((p, i) => ({ id: i + 1, ...p }));
      saveJSON();
    }
    res.json({ success: true, count: newProds.length, sheetSummary });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Reset (admin only) ────────────────────────────────────────

app.post('/api/reset', adminAuth, async (req, res) => {
  try {
    if (useDB && pool) {
      await pool.query('DELETE FROM products');
      await loadProducts();
    } else {
      productsCache = [];
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([], null, 2));
    }
    res.json({ success: true, count: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Multer / global error handler ────────────────────────────
// Must be defined AFTER all routes so multer errors reach it
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum allowed size is 300 MB.' });
  }
  if (err) {
    console.error('Unhandled error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
  next();
});

// ─── Smart Excel Parser ────────────────────────────────────────

const COL_ALIASES = {
  category:       ['category','cat','product category'],
  system:         ['system','subsystem','sys'],
  brand:          ['brand','manufacturer','make','mfg','vendor','supplier'],
  type:           ['type','product type','item type','device type','unit type'],
  series:         ['series','product series','line','product line','family'],
  model:          ['model','model no','model no.','model number','part no','part no.',
                   'part number','item no','item no.','item number','sku','code',
                   'product code','article','ref','reference','item'],
  description:    ['description','desc','product name','name','item name','item description',
                   'title','product description'],
  specifications: ['specifications','specs','spec','details','technical specs',
                   'technical description','tech specs','features'],
  dpp_price:      ['dpp','dpp price','distributor price','dist price','cost','cost price',
                   'purchase price','buy price','net price'],
  si_price:       ['si','si price','si/installer','installer','installer price','reseller',
                   'reseller price','dealer','dealer price','trade','trade price',
                   'partner price','contractor','si/reseller'],
  enduser_price:  ['end user','end user price','enduser','enduser price','retail',
                   'retail price','customer price','list price','list','msrp',
                   'rsp','rrp','public price','selling price','end-user'],
  image_data:     ['image_url','image url','image','photo','picture','img','photo url',
                   'product image','product photo','thumbnail']
};

function parseExcelSmart(workbook) {
  const allProducts  = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rawRows || rawRows.length < 2) return;

    const rows = rawRows.map(row =>
      (Array.isArray(row) ? row : []).map(c => String(c ?? '').trim())
    );

    const sheetMeta = inferSheetMeta(sheetName, rows);

    // Score each of first 12 rows as potential header
    let headerRowIdx = -1, bestScore = 0;
    for (let i = 0; i < Math.min(12, rows.length); i++) {
      const rowLow = rows[i].map(c => c.toLowerCase());
      let score = 0;
      for (const aliases of Object.values(COL_ALIASES)) {
        if (rowLow.some(h => aliases.some(a => h === a || h.includes(a)))) score++;
      }
      if (score > bestScore) { bestScore = score; headerRowIdx = i; }
    }

    if (bestScore < 2) {
      // Try headerless parse using sheet metadata
      const result = parseHeaderless(rows, sheetMeta);
      if (result.length > 0) {
        allProducts.push(...result);
        sheetSummary.push({ sheet: sheetName, count: result.length, method: 'auto-detect', ...sheetMeta });
      } else {
        sheetSummary.push({ sheet: sheetName, count: 0, method: 'skipped – no header', ...sheetMeta });
      }
      return;
    }

    const headers = rows[headerRowIdx].map(c => c.toLowerCase());

    // Map field → column index
    const idx = {};
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      idx[field] = -1;
      for (const alias of aliases) {
        const ci = headers.findIndex(h => h === alias || h.includes(alias));
        if (ci !== -1) { idx[field] = ci; break; }
      }
    }

    if (idx.model === -1) {
      sheetSummary.push({ sheet: sheetName, count: 0, method: 'skipped – no model column', ...sheetMeta });
      return;
    }

    let ctxSeries   = sheetMeta.series   || '';
    let ctxType     = sheetMeta.type     || '';
    let ctxBrand    = sheetMeta.brand    || '';
    let ctxSystem   = sheetMeta.system   || '';
    let ctxCategory = sheetMeta.category || '';

    const sheetProds = [];

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => c === '')) continue;

      const nonEmpty = row.filter(c => c !== '').length;
      const hasPrice = row.some(c => !isNaN(parseFloat(c)) && parseFloat(c) > 0.001);
      const modelVal = idx.model >= 0 ? (row[idx.model] || '') : '';

      // Section header: few cells, no price → update context
      if (nonEmpty <= 3 && !hasPrice) {
        const txt = row.find(c => c !== '') || '';
        if (txt && txt.length > 1 && !/^(model|description|price)$/i.test(txt)) {
          ctxSeries = txt;
          ctxType   = ctxType || txt;
        }
        continue;
      }

      if (!modelVal || /^(model|model no\.?|part no\.?|sku|item)$/i.test(modelVal)) continue;

      const get   = ci => ci >= 0 && row[ci] ? row[ci] : '';
      const price = ci => { const v = parseFloat(row[ci]); return ci >= 0 && !isNaN(v) ? v : 0; };

      let dpp = price(idx.dpp_price);
      let si  = price(idx.si_price);
      let eu  = price(idx.enduser_price);

      // Infer missing prices
      [dpp, si, eu] = inferPrices(dpp, si, eu, row, idx.model);

      sheetProds.push({
        category:       get(idx.category)      || ctxCategory || inferCategory(ctxSystem || sheetMeta.system) || 'General',
        system:         get(idx.system)         || ctxSystem   || sheetMeta.system   || sheetName,
        brand:          get(idx.brand)          || ctxBrand    || sheetMeta.brand    || sheetName,
        type:           get(idx.type)           || ctxType     || ctxSeries,
        series:         get(idx.series)         || ctxSeries,
        model:          modelVal,
        description:    get(idx.description),
        specifications: get(idx.specifications),
        dpp_price:      round3(dpp),
        si_price:       round3(si),
        enduser_price:  round3(eu),
        image_data:     get(idx.image_data) || null
      });
    }

    allProducts.push(...sheetProds);
    sheetSummary.push({ sheet: sheetName, count: sheetProds.length, method: 'header-detected', ...sheetMeta });
  });

  return { products: allProducts, sheetSummary };
}

function inferPrices(dpp, si, eu, row, modelIdx) {
  if (dpp > 0 || si > 0 || eu > 0) {
    if (dpp === 0 && si > 0)  dpp = round3(si * 0.85);
    if (si  === 0 && dpp > 0) si  = round3(dpp * 1.15);
    if (eu  === 0 && si > 0)  eu  = round3(si  * 1.20);
    return [dpp, si, eu];
  }
  // No price columns found – scan row for numerics
  const nums = [];
  for (let i = 0; i < row.length; i++) {
    if (i === modelIdx) continue;
    const v = parseFloat(row[i]);
    if (!isNaN(v) && v > 0) nums.push(v);
  }
  nums.sort((a, b) => a - b);
  if      (nums.length >= 3) [dpp, si, eu] = nums;
  else if (nums.length === 2) { [dpp, si] = nums; eu = round3(si * 1.20); }
  else if (nums.length === 1) { si = nums[0]; dpp = round3(si * 0.85); eu = round3(si * 1.20); }
  return [dpp, si, eu];
}

function parseHeaderless(rows, sheetMeta) {
  if (!sheetMeta.brand && !sheetMeta.system) return [];
  const products = [];
  const modelPat = /^[A-Za-z0-9][\w\-\.\/]{2,}/;
  const pricePat = /^\d+\.?\d*$/;

  for (const row of rows) {
    if (!row || row.every(c => c === '')) continue;
    const nonEmpty = row.filter(c => c !== '');
    if (nonEmpty.length < 2) continue;

    const modelIdx = row.findIndex(c => modelPat.test(c) && !pricePat.test(c));
    if (modelIdx === -1) continue;

    const priceNums = [];
    for (let i = 0; i < row.length; i++) {
      if (i === modelIdx) continue;
      const v = parseFloat(row[i]);
      if (!isNaN(v) && v > 0) priceNums.push(v);
    }
    if (!priceNums.length) continue;
    priceNums.sort((a, b) => a - b);

    let [dpp, si, eu] = [0, 0, 0];
    [dpp, si, eu] = inferPrices(...priceNums.slice(0, 3), 0, row, modelIdx);

    const descIdx = row.findIndex((c, i) =>
      c && i !== modelIdx && !pricePat.test(c) && c !== row[modelIdx]);

    products.push({
      category:       sheetMeta.category || 'General',
      system:         sheetMeta.system   || sheetMeta.brand || '',
      brand:          sheetMeta.brand    || '',
      type:           '',
      series:         '',
      model:          row[modelIdx],
      description:    descIdx >= 0 ? row[descIdx] : '',
      specifications: '',
      dpp_price:      round3(dpp),
      si_price:       round3(si),
      enduser_price:  round3(eu)
    });
  }
  return products;
}

function inferSheetMeta(sheetName, rows) {
  const KNOWN_BRANDS = [
    'hikvision','dahua','axis','hanwha','bosch','pelco','uniview','cp plus',
    'fanvil','yealink','cisco','grandstream','snom',
    'itc','adastra','bose','toa','inter-m','ahuja',
    'ubiquiti','mikrotik','tp-link','zyxel','netgear','tp link',
    'honeywell','paradox','dsc','texecom','ajax','crow'
  ];
  const SYSTEM_MAP = {
    cctv:'CCTV', camera:'CCTV', 'ip cam':'CCTV', nvr:'NVR', dvr:'DVR',
    'access control':'Access Control', access:'Access Control',
    alarm:'Intrusion', intrusion:'Intrusion',
    intercom:'Intercom', 'video door':'Intercom',
    'public address':'Public Address', ' pa ':'Public Address', audio:'Public Address',
    speaker:'Public Address', amplifier:'Public Address',
    phone:'IP Phones', voip:'IP Phones', 'ip phone':'IP Phones',
    switch:'Networking', router:'Networking', network:'Networking',
    wifi:'Networking', wireless:'Networking', 'access point':'Networking'
  };

  const lowerName = sheetName.toLowerCase();
  let brand = '';
  for (const b of KNOWN_BRANDS) {
    if (lowerName.includes(b)) { brand = titleCase(b); break; }
  }
  if (!brand && /^[A-Z][A-Za-z\s\-]+$/.test(sheetName.trim())) brand = sheetName.trim();

  let system = '';
  for (const [key, val] of Object.entries(SYSTEM_MAP)) {
    if (lowerName.includes(key)) { system = val; break; }
  }

  // Check title rows
  if (!brand || !system) {
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const cell = (rows[i][0] || rows[i][1] || '').toLowerCase();
      if (!brand) {
        for (const b of KNOWN_BRANDS) {
          if (cell.includes(b)) { brand = titleCase(b); break; }
        }
      }
      if (!system) {
        for (const [key, val] of Object.entries(SYSTEM_MAP)) {
          if (cell.includes(key)) { system = val; break; }
        }
      }
    }
  }

  return { brand, system, category: inferCategory(system), series: '', type: '' };
}

function inferCategory(system) {
  const MAP = {
    'CCTV':'Security','NVR':'Security','DVR':'Security',
    'Access Control':'Security','Intrusion':'Security','Intercom':'Security',
    'Public Address':'Audio',
    'IP Phones':'Networking','Networking':'Networking'
  };
  return MAP[system] || '';
}

function round3(n) { return Math.round((+n || 0) * 1000) / 1000; }

function titleCase(str) {
  return str.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ─── AI Chatbot (Groq + Tavily) ────────────────────────────────

function httpsPost(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const GROQ_KEY   = process.env.GROQ_API_KEY;
  const TAVILY_KEY = process.env.TAVILY_API_KEY;

  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });

  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Amman' });

    const systemPrompt = `You are an AI assistant for MT Technology Solutions — a security and technology solutions company. You help with:
- Sales quotation guidance and product selection
- Security system recommendations (CCTV, Access Control, Intrusion, IP Phones, Networking)
- Technical specifications and pricing advice
- Quotation best practices

Today's date is ${today} (Jordan time).
Be concise, professional, and helpful. Answer in the same language as the user.`;

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10),   // keep last 10 turns for context
      { role: 'user', content: message }
    ];

    // compound-beta has built-in web search — no external search API needed
    const groqRes = await httpsPost(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'compound-beta', messages: groqMessages, max_tokens: 1024, temperature: 0.7 },
      { 'Authorization': `Bearer ${GROQ_KEY}` }
    );

    if (groqRes.status !== 200) {
      const detail = groqRes.body?.error?.message || JSON.stringify(groqRes.body);
      console.error('Groq error:', groqRes.status, detail);
      return res.status(502).json({ error: `Groq API error (${groqRes.status}): ${detail}` });
    }

    const reply = groqRes.body?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ reply });
  } catch (e) {
    console.error('Chat endpoint error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Page Routes ──────────────────────────────────────────────
app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/quotation', (req, res) => res.sendFile(path.join(__dirname, 'public', 'quotation.html')));

// ─── Company Logo ──────────────────────────────────────────────
app.get('/logo', (req, res) => {
  const candidates = [
    path.join(__dirname, 'public', 'logo.png'),
    path.join(__dirname, 'Magic Tech Logo.png')
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return res.sendFile(f);
  }
  res.status(404).send('Logo not found');
});

app.get('/template', (req, res) => {
  const tpl = path.join(__dirname, 'data', 'product_template.xlsx');
  if (fs.existsSync(tpl)) {
    res.download(tpl, 'MT_Product_Template.xlsx');
  } else {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ['Category','System','Brand','Type','Series','Model','Description','Specifications','DPP_Price','SI_Price','EndUser_Price','Image_URL'],
      ['Security','CCTV','Hikvision','IP Camera','4MP','DS-2CD2047G2','4MP ColorVu Fixed Bullet','4MP, 2.8mm, ColorVu',55,60,70,''],
      ['Security','CCTV','Dahua','Dome','2MP','IPC-HDW2831T-AS','2MP IR Fixed-focal Dome','2MP, 2.8mm, IR30m',35,40,48,''],
    ]);
    xlsx.utils.book_append_sheet(wb, ws, 'Products');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="MT_Product_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  }
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => loadProducts()).then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 MT Sales Quotation System`);
    console.log(`   Running at: http://localhost:${PORT}`);
    console.log(`   Admin:      http://localhost:${PORT}/admin\n`);
  });
});
