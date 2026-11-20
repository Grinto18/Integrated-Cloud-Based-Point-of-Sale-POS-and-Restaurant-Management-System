import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const dataDir = path.resolve(process.cwd(), 'data/official-menu');
const jsonPath = path.join(dataDir, 'golden_palace_official_menu.json');
const csvPath = path.join(dataDir, 'golden_palace_official_menu.csv');
const xlsxPath = path.join(dataDir, 'golden_palace_official_menu.xlsx');

const menu = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const headers = [
  'sku',
  'category_ar',
  'category_fr',
  'subcategory_ar',
  'subcategory_fr',
  'name_ar',
  'name_fr',
  'price',
  'variant_l_price',
  'variant_xl_price',
  'station',
];

const rows = menu.products.map((p) => {
  const varL = Array.isArray(p.variants) ? p.variants.find((v) => v.name_ar === 'L') : null;
  const varXL = Array.isArray(p.variants) ? p.variants.find((v) => v.name_ar === 'XL') : null;
  return {
    sku: p.sku || '',
    category_ar: p.category_ar,
    category_fr: p.category_fr || '',
    subcategory_ar: p.subcategory_ar || '',
    subcategory_fr: p.subcategory_fr || '',
    name_ar: p.name_ar,
    name_fr: p.name_fr || '',
    price: p.price,
    variant_l_price: varL ? varL.price : '',
    variant_xl_price: varXL ? varXL.price : '',
    station: p.station || 'MAIN_KITCHEN',
  };
});

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const csvLines = [
  headers.join(','),
  ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(',')),
];

// UTF-8 with BOM for seamless Arabic rendering in Microsoft Excel on Windows
fs.writeFileSync(csvPath, `\uFEFF${csvLines.join('\r\n')}\r\n`, 'utf8');

const workbook = new ExcelJS.Workbook();
workbook.creator = 'GOLDEN PALACE POS';
workbook.created = new Date();

const sheet = workbook.addWorksheet('Official Menu', {
  views: [{ rightToLeft: true }],
});

sheet.columns = [
  { header: 'sku', key: 'sku', width: 14 },
  { header: 'category_ar', key: 'category_ar', width: 22 },
  { header: 'category_fr', key: 'category_fr', width: 22 },
  { header: 'subcategory_ar', key: 'subcategory_ar', width: 22 },
  { header: 'subcategory_fr', key: 'subcategory_fr', width: 24 },
  { header: 'name_ar', key: 'name_ar', width: 28 },
  { header: 'name_fr', key: 'name_fr', width: 30 },
  { header: 'price', key: 'price', width: 12 },
  { header: 'variant_l_price', key: 'variant_l_price', width: 16 },
  { header: 'variant_xl_price', key: 'variant_xl_price', width: 16 },
  { header: 'station', key: 'station', width: 16 },
];

for (const row of rows) {
  sheet.addRow(row);
}

sheet.getRow(1).font = { bold: true };

await workbook.xlsx.writeFile(xlsxPath);

const catCount = new Set(rows.map((r) => r.category_ar)).size;
const subcatCount = new Set(rows.map((r) => r.subcategory_ar).filter(Boolean)).size;
const variantCount = menu.products.reduce((acc, p) => acc + (Array.isArray(p.variants) ? p.variants.length : 0), 0);

console.log(
  JSON.stringify(
    {
      generated: [csvPath, xlsxPath],
      categories: catCount,
      subcategories: subcatCount,
      products: rows.length,
      variants: variantCount,
    },
    null,
    2
  )
);
