import ExcelJS from 'exceljs';
import { db, sqlite } from '../db/index.ts';
import { categories, menuImportHistory, products, productVariants } from '../db/schema.ts';
import { backupManager } from './backupService.ts';
import { logAudit } from '../utils/audit.ts';
import { desc } from 'drizzle-orm';

export type MenuImportFormat = 'CSV' | 'XLSX' | 'JSON';

export interface ParsedMenuVariant {
  nameAr: string;
  nameFr: string | null;
  price: number;
  sku: string | null;
}

export interface ParsedMenuProduct {
  rowNumber: number;
  sku: string | null;
  categoryAr: string;
  categoryFr: string | null;
  subcategoryAr: string | null;
  subcategoryFr: string | null;
  nameAr: string;
  nameFr: string | null;
  price: number;
  station: string;
  variants: ParsedMenuVariant[];
}

export interface ParsedMenuCategory {
  nameAr: string;
  nameFr: string | null;
  sortOrder: number;
  station: string;
  color: string;
  icon: string;
  productCount: number;
  isNew: boolean;
}

export interface MenuImportValidationError {
  rowNumber: number;
  field: string;
  value: string;
  message: string;
}

export interface MenuImportDuplicateEntry {
  rowNumber: number;
  categoryAr: string;
  nameAr: string;
  reason: 'DUPLICATE_IN_FILE' | 'ALREADY_EXISTS_IN_DB';
  message: string;
}

export interface MenuImportPreviewResult {
  filename: string;
  fileFormat: MenuImportFormat;
  canImport: boolean;
  categoriesCount: number;
  newCategoriesCount: number;
  subcategoriesCount: number;
  productsCount: number;
  variantsCount: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  categories: ParsedMenuCategory[];
  validItems: ParsedMenuProduct[];
  duplicates: MenuImportDuplicateEntry[];
  errors: MenuImportValidationError[];
}

export interface MenuImportCommitResult {
  success: boolean;
  importId: number;
  filename: string;
  fileFormat: MenuImportFormat;
  status: 'COMPLETED';
  backup: {
    filename: string;
    filePath: string;
    sizeBytes: number;
    integrityCheck: string;
    verifiedAt?: string;
  };
  inserted: {
    categories: number;
    products: number;
    variants: number;
  };
  skippedDuplicates: number;
  totalsInDatabase: {
    categories: number;
    products: number;
    variants: number;
  };
  verification: {
    integrityCheck: string;
    foreignKeyViolations: number;
    verified: boolean;
  };
  duplicates: MenuImportDuplicateEntry[];
  createdAt: string;
}

export interface MenuImportInput {
  filename: string;
  format?: MenuImportFormat;
  content?: string;
  contentBase64?: string;
}

export interface MenuImportCommitHooks {
  failAfterProductsCount?: number;
  skipBackupForUnitTest?: boolean;
}

const VALID_STATIONS = new Set(['MAIN_KITCHEN', 'GRILL', 'DRINKS', 'DESSERT']);

const DEFAULT_CATEGORY_META: Record<string, { color: string; icon: string; station: string }> = {
  المقبلات: { color: 'amber', icon: 'Soup', station: 'MAIN_KITCHEN' },
  السلطات: { color: 'emerald', icon: 'Salad', station: 'MAIN_KITCHEN' },
  'الأطباق الرئيسية': { color: 'orange', icon: 'UtensilsCrossed', station: 'MAIN_KITCHEN' },
  'الأطباق التقليدية': { color: 'yellow', icon: 'CookingPot', station: 'MAIN_KITCHEN' },
  'المشاوي واللحوم': { color: 'red', icon: 'Flame', station: 'GRILL' },
  البروشتات: { color: 'rose', icon: 'Beef', station: 'GRILL' },
  البيتزا: { color: 'amber', icon: 'Pizza', station: 'MAIN_KITCHEN' },
  التاكوس: { color: 'orange', icon: 'Sandwich', station: 'GRILL' },
  الكالزوني: { color: 'amber', icon: 'Croissant', station: 'MAIN_KITCHEN' },
  'المأكولات البحرية': { color: 'sky', icon: 'Fish', station: 'GRILL' },
  الحلويات: { color: 'pink', icon: 'CakeSlice', station: 'DESSERT' },
  المشروبات: { color: 'cyan', icon: 'CupSoda', station: 'DRINKS' },
};

export function normalizeMenuKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function detectMenuImportFormat(filename: string, explicitFormat?: string): MenuImportFormat {
  const upperExplicit = String(explicitFormat || '').trim().toUpperCase();
  if (upperExplicit === 'CSV' || upperExplicit === 'XLSX' || upperExplicit === 'JSON') {
    return upperExplicit;
  }
  const lower = String(filename || '').trim().toLowerCase();
  if (lower.endsWith('.json')) return 'JSON';
  if (lower.endsWith('.xlsx')) return 'XLSX';
  if (lower.endsWith('.csv')) return 'CSV';
  throw new Error('صيغة الملف غير مدعومة. الصيغ المقبولة: CSV, XLSX, JSON');
}

function parseStrictIntegerDa(raw: unknown): { ok: true; value: number } | { ok: false; rawStr: string } {
  if (raw === null || raw === undefined) {
    return { ok: false, rawStr: '' };
  }
  const str = String(raw).trim();
  if (!str) {
    return { ok: false, rawStr: '' };
  }
  if (!/^\d+$/.test(str)) {
    return { ok: false, rawStr: str };
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < 0) {
    return { ok: false, rawStr: str };
  }
  return { ok: true, value: num };
}

function normalizeStation(raw: unknown, fallbackCategoryAr?: string): string {
  const candidate = String(raw ?? '').trim().toUpperCase();
  if (VALID_STATIONS.has(candidate)) return candidate;
  if (fallbackCategoryAr && DEFAULT_CATEGORY_META[fallbackCategoryAr]) {
    return DEFAULT_CATEGORY_META[fallbackCategoryAr].station;
  }
  return 'MAIN_KITCHEN';
}

function parseCsvRecords(csvText: string): string[][] {
  const text = csvText.replace(/^\uFEFF/, '');
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  // Detect delimiter from first line outside quotes (comma vs semicolon)
  let delimiter = ',';
  const firstNewlineIdx = text.search(/\r?\n/);
  const headerLine = firstNewlineIdx === -1 ? text : text.slice(0, firstNewlineIdx);
  if (!headerLine.includes(',') && headerLine.includes(';')) {
    delimiter = ';';
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentField);
        currentField = '';
      } else if (ch === '\r') {
        if (text[i + 1] === '\n') i++;
        currentRow.push(currentField);
        if (currentRow.some((cell) => cell.trim() !== '')) {
          lines.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (ch === '\n') {
        currentRow.push(currentField);
        if (currentRow.some((cell) => cell.trim() !== '')) {
          lines.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (inQuotes) {
    throw new Error('ملف CSV غير صالح: علامة اقتباس غير مغلقة');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((cell) => cell.trim() !== '')) {
      lines.push(currentRow);
    }
  }

  return lines;
}

function normalizeHeaderName(header: string): string {
  return String(header || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function extractCellValue(cellValue: any): string {
  if (cellValue === null || cellValue === undefined) return '';
  if (typeof cellValue === 'string' || typeof cellValue === 'number' || typeof cellValue === 'boolean') {
    return String(cellValue).trim();
  }
  if (typeof cellValue === 'object') {
    if (Array.isArray(cellValue.richText)) {
      return cellValue.richText.map((part: any) => part?.text || '').join('').trim();
    }
    if (cellValue.result !== undefined && cellValue.result !== null) {
      return String(cellValue.result).trim();
    }
    if (cellValue.text !== undefined && cellValue.text !== null) {
      return String(cellValue.text).trim();
    }
  }
  return String(cellValue).trim();
}

interface RawImportRow {
  rowNumber: number;
  sku?: unknown;
  category_ar?: unknown;
  category_fr?: unknown;
  subcategory_ar?: unknown;
  subcategory_fr?: unknown;
  name_ar?: unknown;
  name_fr?: unknown;
  price?: unknown;
  variant_l_price?: unknown;
  variant_xl_price?: unknown;
  variants?: unknown;
  station?: unknown;
}

interface RawCategoryHint {
  name_ar: string;
  name_fr?: string | null;
  sort_order?: number;
  station?: string;
  color?: string;
  icon?: string;
}

async function extractRawRows(input: MenuImportInput): Promise<{
  fileFormat: MenuImportFormat;
  rows: RawImportRow[];
  categoryHints: Map<string, RawCategoryHint>;
}> {
  const fileFormat = detectMenuImportFormat(input.filename, input.format);
  const categoryHints = new Map<string, RawCategoryHint>();

  if (fileFormat === 'JSON') {
    const rawText =
      typeof input.content === 'string' && input.content.length > 0
        ? input.content
        : input.contentBase64
        ? Buffer.from(input.contentBase64, 'base64').toString('utf8')
        : '';

    if (!rawText.trim()) {
      throw new Error('ملف JSON فارغ');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('ملف JSON غير صالح أو تالف البنية');
    }

    let rawProducts: any[] = [];
    if (Array.isArray(parsed)) {
      rawProducts = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.products)) {
      rawProducts = parsed.products;
      if (Array.isArray(parsed.categories)) {
        parsed.categories.forEach((cat: any, idx: number) => {
          const catAr = String(cat?.name_ar ?? cat?.nameAr ?? '').trim();
          if (catAr) {
            categoryHints.set(normalizeMenuKey(catAr), {
              name_ar: catAr,
              name_fr: String(cat?.name_fr ?? cat?.nameFr ?? '').trim() || null,
              sort_order: Number.isFinite(Number(cat?.sort_order ?? cat?.sortOrder))
                ? Number(cat?.sort_order ?? cat?.sortOrder)
                : idx + 1,
              station: normalizeStation(cat?.station, catAr),
              color: String(cat?.color || DEFAULT_CATEGORY_META[catAr]?.color || 'amber'),
              icon: String(cat?.icon || DEFAULT_CATEGORY_META[catAr]?.icon || 'UtensilsCrossed'),
            });
          }
        });
      }
    } else {
      throw new Error('بنية ملف JSON غير صحيحة: يجب أن يحتوي على مصفوفة products');
    }

    const rows: RawImportRow[] = rawProducts.map((p: any, idx: number) => ({
      rowNumber: idx + 1,
      sku: p?.sku,
      category_ar: p?.category_ar ?? p?.categoryAr ?? p?.category,
      category_fr: p?.category_fr ?? p?.categoryFr,
      subcategory_ar: p?.subcategory_ar ?? p?.subcategoryAr ?? p?.subcategory,
      subcategory_fr: p?.subcategory_fr ?? p?.subcategoryFr,
      name_ar: p?.name_ar ?? p?.nameAr ?? p?.name,
      name_fr: p?.name_fr ?? p?.nameFr,
      price: p?.price,
      variant_l_price: p?.variant_l_price ?? p?.variantLPrice,
      variant_xl_price: p?.variant_xl_price ?? p?.variantXlPrice,
      variants: p?.variants,
      station: p?.station,
    }));

    return { fileFormat, rows, categoryHints };
  }

  if (fileFormat === 'CSV') {
    const rawText =
      typeof input.content === 'string' && input.content.length > 0
        ? input.content
        : input.contentBase64
        ? Buffer.from(input.contentBase64, 'base64').toString('utf8')
        : '';

    if (!rawText.trim()) {
      throw new Error('ملف CSV فارغ');
    }

    const matrix = parseCsvRecords(rawText);
    if (matrix.length < 2) {
      throw new Error('ملف CSV لا يحتوي على صفوف بيانات صالحة');
    }

    const headers = matrix[0].map(normalizeHeaderName);
    const hasRequiredHeaders =
      (headers.includes('name_ar') || headers.includes('namear') || headers.includes('name')) &&
      (headers.includes('category_ar') || headers.includes('categoryar') || headers.includes('category'));
    if (!hasRequiredHeaders) {
      throw new Error('ترويسة ملف CSV مفقودة أو غير صالحة (مطلوب: category_ar, name_ar, price)');
    }

    const rows: RawImportRow[] = [];
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i];
      const obj: Record<string, string> = {};
      headers.forEach((h, colIdx) => {
        obj[h] = String(cells[colIdx] ?? '').trim();
      });

      let parsedVariants: unknown = undefined;
      if (obj.variants_json) {
        try {
          parsedVariants = JSON.parse(obj.variants_json);
        } catch {
          parsedVariants = '__INVALID_VARIANTS_JSON__';
        }
      }

      rows.push({
        rowNumber: i + 1,
        sku: obj.sku,
        category_ar: obj.category_ar ?? obj.categoryar ?? obj.category,
        category_fr: obj.category_fr ?? obj.categoryfr,
        subcategory_ar: obj.subcategory_ar ?? obj.subcategoryar ?? obj.subcategory,
        subcategory_fr: obj.subcategory_fr ?? obj.subcategoryfr,
        name_ar: obj.name_ar ?? obj.namear ?? obj.name,
        name_fr: obj.name_fr ?? obj.namefr,
        price: obj.price,
        variant_l_price: obj.variant_l_price ?? obj.variantlprice,
        variant_xl_price: obj.variant_xl_price ?? obj.variantxlprice,
        variants: parsedVariants,
        station: obj.station,
      });
    }

    return { fileFormat, rows, categoryHints };
  }

  // XLSX
  const buffer = input.contentBase64
    ? Buffer.from(input.contentBase64, 'base64')
    : typeof input.content === 'string' && input.content.length > 0
    ? Buffer.from(input.content, 'base64')
    : null;

  if (!buffer || buffer.length === 0) {
    throw new Error('ملف Excel (XLSX) فارغ أو غير صالح');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new Error('تعذر قراءة ملف Excel (XLSX): الملف تالف أو غير متوافق');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    throw new Error('ورقة العمل في ملف Excel فارغة أو لا تحتوي على منتجات');
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum - 1] = normalizeHeaderName(extractCellValue(cell.value));
  });

  const hasRequiredHeaders =
    (headers.includes('name_ar') || headers.includes('namear') || headers.includes('name')) &&
    (headers.includes('category_ar') || headers.includes('categoryar') || headers.includes('category'));
  if (!hasRequiredHeaders) {
    throw new Error('ترويسة ملف Excel غير صالحة (مطلوب: category_ar, name_ar, price)');
  }

  const rows: RawImportRow[] = [];
  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const obj: Record<string, string> = {};
    let hasAnyNonEmpty = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const val = extractCellValue(row.getCell(idx + 1).value);
      if (val !== '') hasAnyNonEmpty = true;
      obj[h] = val;
    });
    if (!hasAnyNonEmpty) continue;

    let parsedVariants: unknown = undefined;
    if (obj.variants_json) {
      try {
        parsedVariants = JSON.parse(obj.variants_json);
      } catch {
        parsedVariants = '__INVALID_VARIANTS_JSON__';
      }
    }

    rows.push({
      rowNumber: rowNum,
      sku: obj.sku,
      category_ar: obj.category_ar ?? obj.categoryar ?? obj.category,
      category_fr: obj.category_fr ?? obj.categoryfr,
      subcategory_ar: obj.subcategory_ar ?? obj.subcategoryar ?? obj.subcategory,
      subcategory_fr: obj.subcategory_fr ?? obj.subcategoryfr,
      name_ar: obj.name_ar ?? obj.namear ?? obj.name,
      name_fr: obj.name_fr ?? obj.namefr,
      price: obj.price,
      variant_l_price: obj.variant_l_price ?? obj.variantlprice,
      variant_xl_price: obj.variant_xl_price ?? obj.variantxlprice,
      variants: parsedVariants,
      station: obj.station,
    });
  }

  return { fileFormat, rows, categoryHints };
}

export async function previewMenuImport(input: MenuImportInput): Promise<MenuImportPreviewResult> {
  const filename = String(input.filename || 'menu_import').trim() || 'menu_import';
  const { fileFormat, rows, categoryHints } = await extractRawRows(input);

  if (rows.length === 0) {
    throw new Error('الملف لا يحتوي على أي منتجات للاستيراد');
  }

  // Load existing categories & products from SQLite for accurate duplicate detection
  const existingCategories = sqlite
    .prepare('SELECT id, name_ar, name_fr, sort_order FROM categories')
    .all() as { id: number; name_ar: string; name_fr: string | null; sort_order: number }[];

  const existingCategoryByKey = new Map<string, { id: number; name_ar: string; name_fr: string | null }>();
  const existingCategoryById = new Map<number, string>();
  for (const cat of existingCategories) {
    const key = normalizeMenuKey(cat.name_ar);
    existingCategoryByKey.set(key, cat);
    existingCategoryById.set(cat.id, key);
  }

  const existingProducts = sqlite
    .prepare('SELECT id, category_id, name_ar FROM products')
    .all() as { id: number; category_id: number; name_ar: string }[];

  const existingProductKeys = new Set<string>();
  for (const p of existingProducts) {
    const catKey = existingCategoryById.get(p.category_id) || '';
    existingProductKeys.add(`${catKey}::${normalizeMenuKey(p.name_ar)}`);
  }

  const seenInFileKeys = new Set<string>();
  const errors: MenuImportValidationError[] = [];
  const duplicates: MenuImportDuplicateEntry[] = [];
  const validItems: ParsedMenuProduct[] = [];
  const categoryMap = new Map<string, ParsedMenuCategory>();
  const subcategoryKeys = new Set<string>();
  let sortCounter = existingCategories.length;

  for (const raw of rows) {
    const rowErrors: MenuImportValidationError[] = [];
    const categoryAr = String(raw.category_ar ?? '').trim();
    const categoryFr = String(raw.category_fr ?? '').trim() || null;
    const subcategoryAr = String(raw.subcategory_ar ?? '').trim() || null;
    const subcategoryFr = String(raw.subcategory_fr ?? '').trim() || null;
    const nameAr = String(raw.name_ar ?? '').trim();
    const nameFr = String(raw.name_fr ?? '').trim() || null;
    const sku = String(raw.sku ?? '').trim() || null;

    if (!categoryAr) {
      rowErrors.push({
        rowNumber: raw.rowNumber,
        field: 'category_ar',
        value: '',
        message: 'اسم التصنيف بالعربية مطلوب',
      });
    }

    if (!nameAr) {
      rowErrors.push({
        rowNumber: raw.rowNumber,
        field: 'name_ar',
        value: '',
        message: 'اسم المنتج بالعربية مطلوب',
      });
    }

    // Parse variants if present (either nested variants array or L/XL CSV/Excel columns)
    const parsedVariants: ParsedMenuVariant[] = [];
    if (raw.variants === '__INVALID_VARIANTS_JSON__') {
      rowErrors.push({
        rowNumber: raw.rowNumber,
        field: 'variants_json',
        value: 'invalid',
        message: 'صيغة JSON الخاصة بالأحجام غير صالحة',
      });
    } else if (Array.isArray(raw.variants) && raw.variants.length > 0) {
      const seenVariantNames = new Set<string>();
      for (const v of raw.variants) {
        const vNameAr = String(v?.name_ar ?? v?.nameAr ?? '').trim();
        const vNameFr = String(v?.name_fr ?? v?.nameFr ?? '').trim() || null;
        const vSku = String(v?.sku ?? '').trim() || null;
        const vPriceCheck = parseStrictIntegerDa(v?.price);

        if (!vNameAr) {
          rowErrors.push({
            rowNumber: raw.rowNumber,
            field: 'variants.name_ar',
            value: '',
            message: 'اسم الحجم/الخيار مطلوب',
          });
        } else if (seenVariantNames.has(normalizeMenuKey(vNameAr))) {
          rowErrors.push({
            rowNumber: raw.rowNumber,
            field: 'variants.name_ar',
            value: vNameAr,
            message: `تكرار نفس الحجم (${vNameAr}) داخل المنتج`,
          });
        } else {
          seenVariantNames.add(normalizeMenuKey(vNameAr));
        }

        if (!vPriceCheck.ok) {
          rowErrors.push({
            rowNumber: raw.rowNumber,
            field: `variants.${vNameAr || 'price'}`,
            value: vPriceCheck.rawStr,
            message: 'سعر الحجم يجب أن يكون عدداً صحيحاً موجباً بالدينار الجزائري (DA)',
          });
        } else if (vNameAr) {
          parsedVariants.push({
            nameAr: vNameAr,
            nameFr: vNameFr,
            price: vPriceCheck.value,
            sku: vSku,
          });
        }
      }
    } else {
      const hasVarL = raw.variant_l_price !== undefined && String(raw.variant_l_price).trim() !== '';
      const hasVarXL = raw.variant_xl_price !== undefined && String(raw.variant_xl_price).trim() !== '';
      if (hasVarL) {
        const lCheck = parseStrictIntegerDa(raw.variant_l_price);
        if (!lCheck.ok) {
          rowErrors.push({
            rowNumber: raw.rowNumber,
            field: 'variant_l_price',
            value: lCheck.rawStr,
            message: 'سعر الحجم L يجب أن يكون عدداً صحيحاً موجباً بالدينار (DA)',
          });
        } else {
          parsedVariants.push({
            nameAr: 'L',
            nameFr: 'Taille L',
            price: lCheck.value,
            sku: sku ? `${sku}-L` : null,
          });
        }
      }
      if (hasVarXL) {
        const xlCheck = parseStrictIntegerDa(raw.variant_xl_price);
        if (!xlCheck.ok) {
          rowErrors.push({
            rowNumber: raw.rowNumber,
            field: 'variant_xl_price',
            value: xlCheck.rawStr,
            message: 'سعر الحجم XL يجب أن يكون عدداً صحيحاً موجباً بالدينار (DA)',
          });
        } else {
          parsedVariants.push({
            nameAr: 'XL',
            nameFr: 'Taille XL',
            price: xlCheck.value,
            sku: sku ? `${sku}-XL` : null,
          });
        }
      }
    }

    // Parse base product price (must be valid integer DA)
    const rawPriceStr = String(raw.price ?? '').trim();
    let finalPrice = 0;
    if (rawPriceStr === '' && parsedVariants.length > 0) {
      finalPrice = parsedVariants[0].price;
    } else {
      const priceCheck = parseStrictIntegerDa(raw.price);
      if (!priceCheck.ok) {
        rowErrors.push({
          rowNumber: raw.rowNumber,
          field: 'price',
          value: priceCheck.rawStr,
          message: 'السعر يجب أن يكون عدداً صحيحاً موجباً بالدينار الجزائري (DA) بدون كسور',
        });
      } else {
        finalPrice = priceCheck.value;
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    const catKey = normalizeMenuKey(categoryAr);
    const productKey = `${catKey}::${normalizeMenuKey(nameAr)}`;

    if (seenInFileKeys.has(productKey)) {
      duplicates.push({
        rowNumber: raw.rowNumber,
        categoryAr,
        nameAr,
        reason: 'DUPLICATE_IN_FILE',
        message: `منتج مكرر داخل الملف ضمن التصنيف "${categoryAr}": ${nameAr}`,
      });
      continue;
    }
    seenInFileKeys.add(productKey);

    if (existingProductKeys.has(productKey)) {
      duplicates.push({
        rowNumber: raw.rowNumber,
        categoryAr,
        nameAr,
        reason: 'ALREADY_EXISTS_IN_DB',
        message: `المنتج "${nameAr}" موجود مسبقاً في قاعدة البيانات ضمن التصنيف "${categoryAr}"`,
      });
      continue;
    }

    const station = normalizeStation(raw.station, categoryAr);

    if (!categoryMap.has(catKey)) {
      const hint = categoryHints.get(catKey);
      const isExisting = existingCategoryByKey.has(catKey);
      sortCounter += 1;
      categoryMap.set(catKey, {
        nameAr: categoryAr,
        nameFr: categoryFr || hint?.name_fr || null,
        sortOrder: hint?.sort_order ?? sortCounter,
        station: hint?.station || station,
        color: hint?.color || DEFAULT_CATEGORY_META[categoryAr]?.color || 'amber',
        icon: hint?.icon || DEFAULT_CATEGORY_META[categoryAr]?.icon || 'UtensilsCrossed',
        productCount: 0,
        isNew: !isExisting,
      });
    }
    const catEntry = categoryMap.get(catKey)!;
    catEntry.productCount += 1;

    if (subcategoryAr) {
      subcategoryKeys.add(`${catKey}::${normalizeMenuKey(subcategoryAr)}`);
    }

    validItems.push({
      rowNumber: raw.rowNumber,
      sku,
      categoryAr,
      categoryFr: categoryFr || catEntry.nameFr,
      subcategoryAr,
      subcategoryFr,
      nameAr,
      nameFr,
      price: finalPrice,
      station,
      variants: parsedVariants,
    });
  }

  const parsedCategories = Array.from(categoryMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  const variantsCount = validItems.reduce((sum, p) => sum + p.variants.length, 0);

  return {
    filename,
    fileFormat,
    canImport: errors.length === 0 && validItems.length > 0,
    categoriesCount: parsedCategories.length,
    newCategoriesCount: parsedCategories.filter((c) => c.isNew).length,
    subcategoriesCount: subcategoryKeys.size,
    productsCount: validItems.length,
    variantsCount,
    validCount: validItems.length,
    duplicateCount: duplicates.length,
    invalidCount: errors.length,
    categories: parsedCategories,
    validItems,
    duplicates,
    errors,
  };
}

export async function commitMenuImport(
  input: MenuImportInput & { confirmed: boolean; rejectOnDuplicates?: boolean },
  actor: { userId?: number; userName?: string; ipAddress?: string },
  hooks?: MenuImportCommitHooks
): Promise<MenuImportCommitResult> {
  if (input.confirmed !== true) {
    throw new Error('مطلوب تأكيد صريح من المدير قبل تنفيذ استيراد القائمة');
  }

  const preview = await previewMenuImport(input);

  if (preview.errors.length > 0) {
    const first = preview.errors[0];
    throw new Error(
      `لا يمكن تنفيذ الاستيراد لوجود ${preview.errors.length} أخطاء في البيانات (السطر ${first.rowNumber}: ${first.message})`
    );
  }

  if (input.rejectOnDuplicates && preview.duplicates.length > 0) {
    throw new Error(`تم رفض الاستيراد لوجود ${preview.duplicates.length} منتجات مكررة`);
  }

  if (preview.validItems.length === 0) {
    throw new Error('لا توجد منتجات جديدة صالحة للاستيراد (جميع العناصر مكررة أو موجودة مسبقاً)');
  }

  const beforeCounts = {
    categories: Number((sqlite.prepare('SELECT COUNT(*) as c FROM categories').get() as any)?.c || 0),
    products: Number((sqlite.prepare('SELECT COUNT(*) as c FROM products').get() as any)?.c || 0),
    variants: Number((sqlite.prepare('SELECT COUNT(*) as c FROM product_variants').get() as any)?.c || 0),
  };

  // Step 5: Automatic Verified Pre-Import SQLite Backup
  let backupInfo: MenuImportCommitResult['backup'];
  if (hooks?.skipBackupForUnitTest) {
    backupInfo = {
      filename: 'unit_test_skipped.db',
      filePath: '',
      sizeBytes: 0,
      integrityCheck: 'ok',
      verifiedAt: new Date().toISOString(),
    };
  } else {
    const backupEntry = await backupManager.createBackup('PRE_IMPORT');
    const backupPath = backupManager.resolveSafeBackupPath(backupEntry.filename);
    backupInfo = {
      filename: backupEntry.filename,
      filePath: backupPath,
      sizeBytes: backupEntry.sizeBytes,
      integrityCheck: backupEntry.integrityCheck,
      verifiedAt: backupEntry.verifiedAt,
    };
  }

  // Step 6: Atomic SQLite Transaction (Full rollback on any failure)
  let insertedCategories = 0;
  let insertedProducts = 0;
  let insertedVariants = 0;

  const existingCategories = sqlite
    .prepare('SELECT id, name_ar FROM categories')
    .all() as { id: number; name_ar: string }[];
  const categoryIdByKey = new Map<string, number>();
  for (const cat of existingCategories) {
    categoryIdByKey.set(normalizeMenuKey(cat.name_ar), cat.id);
  }

  const insertCatStmt = sqlite.prepare(`
    INSERT INTO categories (name_ar, name_fr, icon, color, sort_order, is_active, station)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);

  const insertProductStmt = sqlite.prepare(`
    INSERT INTO products (
      category_id, name_ar, name_fr, sku, subcategory_ar, subcategory_fr,
      price, cost_price, is_available, is_active, station, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, datetime('now'), datetime('now'))
  `);

  const insertVariantStmt = sqlite.prepare(`
    INSERT INTO product_variants (product_id, name_ar, name_fr, price, price_adjustment, sku, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const runAtomicImport = sqlite.transaction(() => {
    for (const cat of preview.categories) {
      const key = normalizeMenuKey(cat.nameAr);
      if (!categoryIdByKey.has(key)) {
        const res = insertCatStmt.run(
          cat.nameAr,
          cat.nameFr,
          cat.icon,
          cat.color,
          cat.sortOrder,
          cat.station
        );
        categoryIdByKey.set(key, Number(res.lastInsertRowid));
        insertedCategories += 1;
      }
    }

    for (const prod of preview.validItems) {
      const catKey = normalizeMenuKey(prod.categoryAr);
      const categoryId = categoryIdByKey.get(catKey);
      if (!categoryId) {
        throw new Error(`تعذر ربط المنتج "${prod.nameAr}" بالتصنيف "${prod.categoryAr}"`);
      }

      const prodRes = insertProductStmt.run(
        categoryId,
        prod.nameAr,
        prod.nameFr,
        prod.sku,
        prod.subcategoryAr,
        prod.subcategoryFr,
        prod.price,
        prod.station
      );
      const productId = Number(prodRes.lastInsertRowid);
      insertedProducts += 1;

      for (const variant of prod.variants) {
        const priceAdjustment = variant.price - prod.price;
        insertVariantStmt.run(
          productId,
          variant.nameAr,
          variant.nameFr,
          variant.price,
          priceAdjustment,
          variant.sku
        );
        insertedVariants += 1;
      }

      if (
        hooks?.failAfterProductsCount !== undefined &&
        insertedProducts >= hooks.failAfterProductsCount
      ) {
        throw new Error('SIMULATED_IMPORT_TRANSACTION_FAILURE');
      }
    }
  });

  try {
    runAtomicImport();
  } catch (err: any) {
    // Transaction has been rolled back completely by SQLite. Record failed import audit trail cleanly.
    await logAudit({
      userId: actor.userId,
      userName: actor.userName,
      action: 'MENU_IMPORT_ROLLBACK',
      entityType: 'MENU_IMPORT',
      details: `فشل استيراد القائمة من الملف "${preview.filename}" وتم التراجع الكامل عن المعاملة: ${err?.message || 'error'}`,
      previousValue: JSON.stringify(beforeCounts),
      newValue: JSON.stringify(beforeCounts),
      ipAddress: actor.ipAddress,
    });
    throw err;
  }

  // Step 7: Post-Import Verification
  const integrityRows = sqlite.pragma('integrity_check') as { integrity_check: string }[];
  const integrityCheck =
    integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok'
      ? 'ok'
      : integrityRows.map((r) => r.integrity_check).join('; ') || 'failed';
  const fkViolations = sqlite.pragma('foreign_key_check') as any[];

  const afterCounts = {
    categories: Number((sqlite.prepare('SELECT COUNT(*) as c FROM categories').get() as any)?.c || 0),
    products: Number((sqlite.prepare('SELECT COUNT(*) as c FROM products').get() as any)?.c || 0),
    variants: Number((sqlite.prepare('SELECT COUNT(*) as c FROM product_variants').get() as any)?.c || 0),
  };

  const createdAt = new Date().toISOString();
  const summaryObj = {
    inserted: {
      categories: insertedCategories,
      products: insertedProducts,
      variants: insertedVariants,
    },
    beforeCounts,
    afterCounts,
    backupFilename: backupInfo.filename,
    integrityCheck,
    foreignKeyViolations: fkViolations.length,
  };

  // Step 8: Record menu_import_history & audit_logs
  const historyRows = await db
    .insert(menuImportHistory)
    .values({
      filename: preview.filename,
      fileFormat: preview.fileFormat,
      categoriesCount: insertedCategories,
      productsCount: insertedProducts,
      variantsCount: insertedVariants,
      validCount: preview.validCount,
      duplicateCount: preview.duplicateCount,
      invalidCount: preview.invalidCount,
      status: 'COMPLETED',
      backupFilename: backupInfo.filename,
      backupPath: backupInfo.filePath,
      summaryJson: JSON.stringify(summaryObj),
      importedBy: actor.userId ?? null,
      createdAt,
    })
    .returning();

  const importId = historyRows[0]?.id ?? 0;

  await logAudit({
    userId: actor.userId,
    userName: actor.userName,
    action: 'MENU_IMPORT',
    entityType: 'MENU_IMPORT',
    entityId: String(importId),
    details: `استيراد القائمة الرسمية من "${preview.filename}" (${preview.fileFormat}): ${insertedCategories} تصنيفات، ${insertedProducts} منتجاً، ${insertedVariants} أحجام/خيارات. النسخة الاحتياطية: ${backupInfo.filename}`,
    previousValue: JSON.stringify(beforeCounts),
    newValue: JSON.stringify({ ...afterCounts, backupFilename: backupInfo.filename }),
    ipAddress: actor.ipAddress,
  });

  return {
    success: true,
    importId,
    filename: preview.filename,
    fileFormat: preview.fileFormat,
    status: 'COMPLETED',
    backup: backupInfo,
    inserted: {
      categories: insertedCategories,
      products: insertedProducts,
      variants: insertedVariants,
    },
    skippedDuplicates: preview.duplicateCount,
    totalsInDatabase: afterCounts,
    verification: {
      integrityCheck,
      foreignKeyViolations: fkViolations.length,
      verified: integrityCheck === 'ok' && fkViolations.length === 0,
    },
    duplicates: preview.duplicates,
    createdAt,
  };
}

export async function listMenuImportHistory(limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  return db
    .select()
    .from(menuImportHistory)
    .orderBy(desc(menuImportHistory.id))
    .limit(safeLimit);
}
