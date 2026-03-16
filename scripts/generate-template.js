#!/usr/bin/env node
/**
 * Generates the downloadable MT_Product_Template.xlsx
 * Run once: node scripts/generate-template.js
 */
const XLSX = require('xlsx');
const path = require('path');

const headers = [
  'Category','System','Brand','Type','Series','Model',
  'Description','Specifications','DPP_Price','SI_Price','EndUser_Price'
];

const sampleRows = [
  ['Security','CCTV','Hikvision','IP Camera','ColorVu 4MP','DS-2CD2047G2-L',
   '4MP ColorVu Fixed Bullet Network Camera','4MP, 2.8mm, ColorVu, H.265+, Human & Vehicle Detection',55,60,70],
  ['Security','CCTV','Hikvision','Analog Camera','2MP HD','DS-2CE76D0T-EXIPF 2.8MM',
   'INDOOR CAM 2MP','2MP, 2.8mm fixed lens, indoor, F1.0 aperture',9.25,9.75,10.5],
  ['Security','CCTV','Hikvision','NVR','AcuSense K Series','8-ch PoE 1U K Series AcuSense 4K NVR',
   '8-ch PoE NVR','8-ch, PoE, 4K, H.265+, 80Mbps, 1 SATA',120,135,155],
  ['Audio','Public Address','ITC','Mixer Amplifier','MA Series','MA60UB',
   '60W Mini Mixer Amplifier','60W, Bluetooth/USB/Radio, 2 MIC + 2 Line in, 100V/70V/4-16Ω',80,85,93.5],
  ['Networking','IP Phones','Fanvil','IP Phone','V Series','V61G',
   'Fanvil V61G Gigabit IP Phone','Gigabit, 2.4-inch color screen, 4 SIP lines, 12 DSS keys',38,43,54],
  ['Security','Access Control','Hikvision','Card Reader','Standard','DS-K1T341AMF',
   'Face Recognition Terminal','Face, fingerprint, card & PIN, 2MP camera, IP65',130,145,168],
];

const wb = XLSX.utils.book_new();

// Sheet 1: Standard Template
const ws1 = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
ws1['!cols'] = headers.map((h, i) => ({ wch: [10,10,12,14,14,26,36,40,10,10,12][i] }));

// Style header row (basic)
const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: '1a3a5c' } } };
headers.forEach((_, i) => {
  const cell = XLSX.utils.encode_cell({ r: 0, c: i });
  if (!ws1[cell]) return;
  ws1[cell].s = headerStyle;
});

XLSX.utils.book_append_sheet(wb, ws1, 'Products (Standard Template)');

// Sheet 2: Price List style (like Hikvision sheet)
const priceListHeaders = ['MODEL', 'DPP', 'SI/INSTALLER', 'END USER', 'DESCRIPTION'];
const priceListRows = [
  ['2MP HD'],  // section header
  ['DS-2CE76D0T-EXIPF 2.8MM', 9.25, 9.75, 10.5, 'INDOOR CAM 2MP'],
  ['DS-2CE76D0T-EXIPF 3.6MM', 9.25, 9.75, 10.5, 'INDOOR CAM 2MP'],
  ['DS-2CE16D0T-EXIPF 2.8MM', 9.25, 9.75, 10.5, 'OUTDOOR CAM 2MP'],
  ['2MP HD ColorVu'],  // section header
  ['DS-2CE70DF0T-PF 2.8MM', 14, 14.5, 15, 'INDOOR 2MP COLORVU'],
  ['DS-2CE70DF0T-PF 3.6MM', 14, 14.5, 15, 'INDOOR 2MP COLORVU'],
];

const ws2 = XLSX.utils.aoa_to_sheet([
  ['HIKVISION ANALOG CAMERAS – Q4 2024'],
  [],
  priceListHeaders,
  ...priceListRows
]);
ws2['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 30 }];
XLSX.utils.book_append_sheet(wb, ws2, 'Hikvision (Price List Style)');

// Sheet 3: Fanvil style (single price)
const fanvilHeaders = ['Model', 'Description', 'Silver Partner Reseller Price'];
const fanvilRows = [
  ['Fanvil 2-wire IP Phone & POE Switch'],
  ['X303-2WIRE', 'Fanvil X303-2 Wire Office IP Phone. 2.4-inch color display, PoE, 4 SIP accounts', 42.00],
  ['H1-2WIRE',   'Fanvil H1-2 Wire Hotel IP Phone. 10/100Mbps, integrated PoE, 8 programmable soft keys', 38.00],
  ['PN1',        'Fanvil 2-wire Single Port POE Switch. Max 300m transmission. Box includes 2pcs', 100.00],
  ['Fanvil V Series IP Phones'],
  ['V50P', 'Basic IP phone, 2.3-inch dot-matrix screen, 2 SIP lines, 6-way conference, PoE', 37.00],
  ['V61G', 'Gigabit IP Phone, 2.4-inch color screen, 4 SIP lines, up to 12 DSS keys', 43.00],
];

const ws3 = XLSX.utils.aoa_to_sheet([
  ['Fanvil IP Phone Prices Q4, 2024'],
  [],
  fanvilHeaders,
  ...fanvilRows
]);
ws3['!cols'] = [{ wch: 16 }, { wch: 60 }, { wch: 22 }];
XLSX.utils.book_append_sheet(wb, ws3, 'Fanvil (Single Price Style)');

const outPath = path.join(__dirname, '..', 'data', 'product_template.xlsx');
XLSX.writeFile(wb, outPath);
console.log('✓ Template saved to', outPath);
