const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer config for Excel uploads (memory storage — works on read-only serverless filesystems)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
let products = [];

function loadProducts() {
  try {
    const data = fs.readFileSync(PRODUCTS_FILE, 'utf8');
    products = JSON.parse(data);
    console.log(`✓ Loaded ${products.length} products from database`);
  } catch (err) {
    console.error('⚠ Could not load products.json:', err.message);
    products = [];
  }
}
loadProducts();

// ─── API Routes ────────────────────────────────────────────────────────────────

// GET all products
app.get('/api/products', (req, res) => res.json(products));

// GET cascading filter data
app.get('/api/filter', (req, res) => {
  const { category, system, brand, type, series } = req.query;
  let filtered = [...products];

  if (category) filtered = filtered.filter(p => p.category === category);
  if (system)   filtered = filtered.filter(p => p.system   === system);
  if (brand)    filtered = filtered.filter(p => p.brand    === brand);
  if (type)     filtered = filtered.filter(p => p.type     === type);
  if (series)   filtered = filtered.filter(p => p.series   === series);

  const unique = (key) => [...new Set(filtered.map(p => p[key]).filter(Boolean))].sort();

  res.json({
    categories: unique('category'),
    systems:    unique('system'),
    brands:     unique('brand'),
    types:      unique('type'),
    series:     unique('series'),
    models: filtered.map(p => ({
      model:          p.model,
      description:    p.description,
      specifications: p.specifications,
      dpp_price:      p.dpp_price,
      si_price:       p.si_price,
      enduser_price:  p.enduser_price,
      brand:          p.brand,
      type:           p.type,
      series:         p.series,
      category:       p.category,
      system:         p.system
    }))
  });
});

// GET single product by model
app.get('/api/product', (req, res) => {
  const { model } = req.query;
  const product = products.find(p => p.model === model);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// POST upload Excel and convert to JSON
app.post('/api/upload', upload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const newProducts = convertExcelToProducts(workbook);

    if (newProducts.length === 0) {
      return res.status(400).json({
        error: 'No products found. Make sure your Excel has columns: Category, System, Brand, Type, Series, Model, Description, Specifications, DPP_Price, SI_Price, EndUser_Price'
      });
    }

    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(newProducts, null, 2));
    products = newProducts;

    res.json({ success: true, count: newProducts.length });
  } catch (err) {
    console.error('Excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST reset to original sample data
app.post('/api/reset', (req, res) => {
  const sampleFile = path.join(__dirname, 'data', 'products.sample.json');
  try {
    if (fs.existsSync(sampleFile)) {
      const data = fs.readFileSync(sampleFile, 'utf8');
      fs.writeFileSync(PRODUCTS_FILE, data);
      products = JSON.parse(data);
    }
    res.json({ success: true, count: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Excel Converter ──────────────────────────────────────────────────────────

function convertExcelToProducts(workbook) {
  const allProducts = [];
  const HEADER_KEYWORDS = ['model', 'model no', 'model no.', 'description', 'dpp', 'si', 'installer', 'end user', 'enduser', 'category', 'brand'];

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const rows  = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows || rows.length < 2) return;

    // Find header row
    let headerRowIdx = -1;
    let headers = [];

    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const row = rows[i].map(c => String(c).toLowerCase().trim());
      const matches = row.filter(h => HEADER_KEYWORDS.some(k => h.includes(k))).length;
      if (matches >= 2) {
        headerRowIdx = i;
        headers = row;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Try to use the sheet as a standard template
      console.log(`Sheet "${sheetName}" - no recognized header row, skipping`);
      return;
    }

    const idx = {
      category:       findCol(headers, ['category']),
      system:         findCol(headers, ['system']),
      brand:          findCol(headers, ['brand']),
      type:           findCol(headers, ['type']),
      series:         findCol(headers, ['series']),
      model:          findCol(headers, ['model no.', 'model no', 'model']),
      description:    findCol(headers, ['description', 'desc']),
      specifications: findCol(headers, ['specifications', 'specs', 'spec']),
      dpp:            findCol(headers, ['dpp']),
      si:             findCol(headers, ['si/installer', 'si_price', 'si price', 'installer', 'reseller']),
      enduser:        findCol(headers, ['end user', 'enduser', 'end_user', 'end useer'])
    };

    let currentSection = '';

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const nonEmpty = row.filter(c => String(c).trim() !== '').length;

      // Detect section header rows (rows with only 1-2 non-empty cells, no numeric price)
      const hasPrice = row.some(c => !isNaN(parseFloat(c)) && parseFloat(c) > 0);
      if (nonEmpty <= 2 && !hasPrice) {
        const val = String(row[0] || row[1] || '').trim();
        if (val) { currentSection = val; continue; }
      }

      const modelVal = idx.model >= 0 ? String(row[idx.model] || '').trim() : '';
      if (!modelVal || modelVal.toLowerCase() === 'model') continue;

      const get = (i) => i >= 0 ? String(row[i] || '').trim() : '';
      const price = (i) => i >= 0 ? parseFloat(row[i]) || 0 : 0;

      allProducts.push({
        category:       get(idx.category)  || 'General',
        system:         get(idx.system)    || sheetName,
        brand:          get(idx.brand)     || sheetName,
        type:           get(idx.type)      || currentSection,
        series:         get(idx.series)    || currentSection,
        model:          modelVal,
        description:    get(idx.description),
        specifications: get(idx.specifications),
        dpp_price:      price(idx.dpp),
        si_price:       price(idx.si),
        enduser_price:  price(idx.enduser)
      });
    }
  });

  return allProducts;
}

function findCol(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h === c || h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

// ─── Page Routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/quotation', (req, res) => res.sendFile(path.join(__dirname, 'public', 'quotation.html')));
app.get('/template', (req, res) => {
  const templatePath = path.join(__dirname, 'data', 'product_template.xlsx');
  if (fs.existsSync(templatePath)) {
    res.download(templatePath, 'MT_Product_Template.xlsx');
  } else {
    // Generate template on the fly
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ['Category','System','Brand','Type','Series','Model','Description','Specifications','DPP_Price','SI_Price','EndUser_Price'],
      ['Security','CCTV','Hikvision','IP Camera','4MP','DS-2CD2047G2','4MP ColorVu Fixed Bullet','4MP, 2.8mm, ColorVu',55,60,70],
      ['Security','CCTV','Dahua','Dome','2MP','IPC-HDW2831T-AS','2MP IR Fixed-focal Dome','2MP, 2.8mm, IR30m',35,40,48],
    ]);
    xlsx.utils.book_append_sheet(wb, ws, 'Products');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="MT_Product_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 MT Sales Quotation System`);
  console.log(`   Running at: http://localhost:${PORT}\n`);
});
