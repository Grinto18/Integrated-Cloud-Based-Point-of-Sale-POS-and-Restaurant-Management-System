import type { ArabicEscPosEncoding, PaperType } from '../types.ts';

/**
 * Arabic contextual presentation forms mapping (Isolated, Final, Initial, Medial)
 * Ensures Arabic text printed in ESC/POS monospace thermal printers has connected,
 * non-separated letters and proper RTL visual ordering.
 */
const ARABIC_FORMS: Record<number, [number, number, number | null, number | null]> = {
  0x0621: [0xfe80, 0xfe80, null, null], // ء
  0x0622: [0xfe81, 0xfe82, null, null], // آ
  0x0623: [0xfe83, 0xfe84, null, null], // أ
  0x0624: [0xfe85, 0xfe86, null, null], // ؤ
  0x0625: [0xfe87, 0xfe88, null, null], // إ
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], // ئ
  0x0627: [0xfe8d, 0xfe8e, null, null], // ا
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], // ب
  0x0629: [0xfe93, 0xfe94, null, null], // ة
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], // ت
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], // ث
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], // ج
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], // ح
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], // خ
  0x062f: [0xfea9, 0xfeaa, null, null], // د
  0x0630: [0xfeab, 0xfeac, null, null], // ذ
  0x0631: [0xfead, 0xfeae, null, null], // ر
  0x0632: [0xfeaf, 0xfeb0, null, null], // ز
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], // س
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], // ش
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], // ص
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], // ض
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], // ط
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], // ظ
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], // ع
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], // غ
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // ـ
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], // ف
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], // ق
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], // ك
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], // ل
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], // م
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], // ن
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], // ه
  0x0648: [0xfeed, 0xfeee, null, null], // و
  0x0649: [0xfeef, 0xfef0, null, null], // ى
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4], // ي
};

const LAM_ALEF_LIGATURES: Record<number, [number, number]> = {
  0x0622: [0xfef5, 0xfef6], // لآ
  0x0623: [0xfef7, 0xfef8], // لأ
  0x0625: [0xfef9, 0xfefa], // لإ
  0x0627: [0xfefb, 0xfefc], // لا
};

const WINDOWS_1256_ARABIC_MAP: Record<number, number> = {
  0x0621: 0xc1, // ء
  0x0622: 0xc2, // آ
  0x0623: 0xc3, // أ
  0x0624: 0xc4, // ؤ
  0x0625: 0xc5, // إ
  0x0626: 0xc6, // ئ
  0x0627: 0xc7, // ا
  0x0628: 0xc8, // ب
  0x0629: 0xc9, // ة
  0x062a: 0xca, // ت
  0x062b: 0xcb, // ث
  0x062c: 0xcc, // ج
  0x062d: 0xcd, // ح
  0x062e: 0xce, // خ
  0x062f: 0xcf, // د
  0x0630: 0xd0, // ذ
  0x0631: 0xd1, // ر
  0x0632: 0xd2, // ز
  0x0633: 0xd3, // س
  0x0634: 0xd4, // ش
  0x0635: 0xd5, // ص
  0x0636: 0xd6, // ض
  0x0637: 0xd8, // ط
  0x0638: 0xd9, // ظ
  0x0639: 0xda, // ع
  0x063a: 0xdb, // غ
  0x0640: 0xdc, // ـ
  0x0641: 0xdd, // ف
  0x0642: 0xde, // ق
  0x0643: 0xdf, // ك
  0x0644: 0xe1, // ل
  0x0645: 0xe3, // م
  0x0646: 0xe4, // ن
  0x0647: 0xe5, // ه
  0x0648: 0xe6, // و
  0x0649: 0xec, // ى
  0x064a: 0xed, // ي
  0x060c: 0xa1, // ،
  0x061b: 0xba, // ؛
  0x061f: 0xbf, // ؟
};

// IBM CP864 (standard ESC/POS codepage 22/37/63 on Epson/Xprinter/Rongta Arabic printers)
const CP864_FORMS_MAP: Record<number, number> = {
  0x060c: 0xac, // ،
  0x061b: 0xbb, // ؛
  0x061f: 0xbf, // ؟
  0x0621: 0xc1, // ء
  0xfe80: 0xc1,
  0xfe81: 0xc2, // آ isolated
  0xfe82: 0xa2, // آ final
  0xfe83: 0xc3, // أ isolated
  0xfe84: 0xa5, // أ final
  0xfe85: 0xc4, // ؤ
  0xfe86: 0xc4,
  0xfe87: 0xc5, // إ
  0xfe88: 0xc5,
  0xfe89: 0xc6, // ئ isolated
  0xfe8a: 0xc6,
  0xfe8b: 0xc6,
  0xfe8c: 0xc6,
  0xfe8d: 0xc7, // ا isolated
  0xfe8e: 0xa8, // ا final
  0xfe8f: 0xa9, // ب isolated
  0xfe90: 0xa9,
  0xfe91: 0xc8, // ب initial
  0xfe92: 0xc8,
  0xfe93: 0xc9, // ة
  0xfe94: 0xc9,
  0xfe95: 0xaa, // ت isolated
  0xfe96: 0xaa,
  0xfe97: 0xca, // ت initial
  0xfe98: 0xca,
  0xfe99: 0xab, // ث isolated
  0xfe9a: 0xab,
  0xfe9b: 0xcb, // ث initial
  0xfe9c: 0xcb,
  0xfe9d: 0xad, // ج isolated
  0xfe9e: 0xad,
  0xfe9f: 0xcc, // ج initial
  0xfea0: 0xcc,
  0xfea1: 0xae, // ح isolated
  0xfea2: 0xae,
  0xfea3: 0xcd, // ح initial
  0xfea4: 0xcd,
  0xfea5: 0xaf, // خ isolated
  0xfea6: 0xaf,
  0xfea7: 0xce, // خ initial
  0xfea8: 0xce,
  0xfea9: 0xcf, // د
  0xfeaa: 0xcf,
  0xfeab: 0xd0, // ذ
  0xfeac: 0xd0,
  0xfead: 0xd1, // ر
  0xfeae: 0xd1,
  0xfeaf: 0xd2, // ز
  0xfeb0: 0xd2,
  0xfeb1: 0xbc, // س isolated
  0xfeb2: 0xbc,
  0xfeb3: 0xd3, // س initial
  0xfeb4: 0xd3,
  0xfeb5: 0xbd, // ش isolated
  0xfeb6: 0xbd,
  0xfeb7: 0xd4, // ش initial
  0xfeb8: 0xd4,
  0xfeb9: 0xbe, // ص isolated
  0xfeba: 0xbe,
  0xfebb: 0xd5, // ص initial
  0xfebc: 0xd5,
  0xfebd: 0xeb, // ض isolated
  0xfebe: 0xeb,
  0xfebf: 0xd6, // ض initial
  0xfec0: 0xd6,
  0xfec1: 0xd7, // ط
  0xfec2: 0xd7,
  0xfec3: 0xd7,
  0xfec4: 0xd7,
  0xfec5: 0xd8, // ظ
  0xfec6: 0xd8,
  0xfec7: 0xd8,
  0xfec8: 0xd8,
  0xfec9: 0xdf, // ع isolated
  0xfeca: 0xc0, // ع final
  0xfecb: 0xd9, // ع initial
  0xfecc: 0xec, // ع medial
  0xfecd: 0xee, // غ isolated
  0xfece: 0xed, // غ final
  0xfecf: 0xda, // غ initial
  0xfed0: 0xf7, // غ medial
  0x0640: 0xe0, // ـ
  0xfed1: 0xba, // ف isolated
  0xfed2: 0xba,
  0xfed3: 0xe1, // ف initial
  0xfed4: 0xe1,
  0xfed5: 0xf8, // ق isolated
  0xfed6: 0xf8,
  0xfed7: 0xe2, // ق initial
  0xfed8: 0xe2,
  0xfed9: 0xfc, // ك isolated
  0xfeda: 0xfc,
  0xfedb: 0xe3, // ك initial
  0xfedc: 0xe3,
  0xfedd: 0xfb, // ل isolated
  0xfede: 0xfb,
  0xfedf: 0xe4, // ل initial
  0xfee0: 0xe4,
  0xfee1: 0xef, // م isolated
  0xfee2: 0xef,
  0xfee3: 0xe5, // م initial
  0xfee4: 0xe5,
  0xfee5: 0xf2, // ن isolated
  0xfee6: 0xf2,
  0xfee7: 0xe6, // ن initial
  0xfee8: 0xe6,
  0xfee9: 0xf3, // ه isolated
  0xfeea: 0xf3,
  0xfeeb: 0xe7, // ه initial
  0xfeec: 0xf4, // ه medial
  0xfeed: 0xe8, // و
  0xfeee: 0xe8,
  0xfeef: 0xe9, // ى isolated
  0xfef0: 0xf5, // ى final
  0xfef1: 0xfd, // ي isolated
  0xfef2: 0xf6, // ي final
  0xfef3: 0xea, // ي initial
  0xfef4: 0xea,
  0xfef5: 0x99, // لآ
  0xfef6: 0x9a,
  0xfef7: 0x9b, // لأ
  0xfef8: 0x9c,
  0xfef9: 0x9d, // لإ
  0xfefa: 0x9e,
  0xfefb: 0x9f, // لا
  0xfefc: 0xa0,
};

function isArabicChar(code: number): boolean {
  return (code >= 0x0600 && code <= 0x06ff) || (code >= 0xfe70 && code <= 0xfeff);
}

function isArabicLetter(code: number): boolean {
  return code in ARABIC_FORMS;
}

function connectsLeft(code: number): boolean {
  const form = ARABIC_FORMS[code];
  return Boolean(form && form[2] !== null);
}

/**
 * Applies Arabic contextual presentation forms (connected letters + Lam-Alef ligatures)
 * and visual BiDi reordering for thermal receipt printers that output byte-by-byte LTR.
 */
export function shapeArabicForThermal(input: string): string {
  const clean = String(input || '').replace(/[\u064b-\u065f\u0670]/g, ''); // strip diacritics
  const shapedCodes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const prevCode = i > 0 ? clean.charCodeAt(i - 1) : 0;
    const nextCode = i + 1 < clean.length ? clean.charCodeAt(i + 1) : 0;

    if (code === 0x0644 && nextCode in LAM_ALEF_LIGATURES) {
      const prevConnects = isArabicLetter(prevCode) && connectsLeft(prevCode);
      shapedCodes.push(LAM_ALEF_LIGATURES[nextCode][prevConnects ? 1 : 0]);
      i++; // consume Alef
      continue;
    }

    if (!isArabicLetter(code)) {
      shapedCodes.push(code);
      continue;
    }

    const forms = ARABIC_FORMS[code];
    const prevConnects = isArabicLetter(prevCode) && connectsLeft(prevCode);
    const nextConnects = isArabicLetter(nextCode) && Boolean(forms[2] !== null);

    let chosen = forms[0];
    if (prevConnects && nextConnects && forms[3] !== null) {
      chosen = forms[3]; // Medial
    } else if (prevConnects) {
      chosen = forms[1]; // Final
    } else if (nextConnects && forms[2] !== null) {
      chosen = forms[2]; // Initial
    }
    shapedCodes.push(chosen);
  }

  // Visual BiDi reordering for lines containing Arabic characters
  const hasArabic = shapedCodes.some(isArabicChar);
  if (!hasArabic) return String.fromCharCode(...shapedCodes);

  // Split into runs of RTL (Arabic + connecting spaces/punctuation) vs LTR (digits/Latin)
  const tokens: { rtl: boolean; chars: number[] }[] = [];
  for (const ch of shapedCodes) {
    const rtl = isArabicChar(ch);
    const isNeutral = ch === 0x20 || ch === 0x2d || ch === 0x2e || ch === 0x2f || ch === 0x3a;
    if (tokens.length > 0 && (tokens[tokens.length - 1].rtl === rtl || (isNeutral && tokens[tokens.length - 1].rtl))) {
      tokens[tokens.length - 1].chars.push(ch);
    } else {
      tokens.push({ rtl, chars: [ch] });
    }
  }

  // Reverse token order for RTL base line, reverse chars within RTL runs, preserve LTR runs
  const visualCodes: number[] = [];
  for (let t = tokens.length - 1; t >= 0; t--) {
    const tok = tokens[t];
    if (tok.rtl) {
      for (let k = tok.chars.length - 1; k >= 0; k--) {
        visualCodes.push(tok.chars[k]);
      }
    } else {
      visualCodes.push(...tok.chars);
    }
  }
  return String.fromCharCode(...visualCodes);
}

/**
 * Encodes a single line of bilingual text into ESC/POS bytes according to selected Arabic encoding.
 */
export function encodeEscPosLine(line: string, encoding: ArabicEscPosEncoding = 'CP864'): number[] {
  if (encoding === 'UTF8') {
    const encoder = new TextEncoder();
    return Array.from(encoder.encode(line + '\n'));
  }

  if (encoding === 'WINDOWS_1256') {
    const out: number[] = [];
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code in WINDOWS_1256_ARABIC_MAP) out.push(WINDOWS_1256_ARABIC_MAP[code]);
      else out.push(0x20);
    }
    out.push(0x0a);
    return out;
  }

  // Default CP864 with Arabic shaping + BiDi visual order
  const shaped = shapeArabicForThermal(line);
  const out: number[] = [];
  for (let i = 0; i < shaped.length; i++) {
    const code = shaped.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code in CP864_FORMS_MAP) {
      out.push(CP864_FORMS_MAP[code]);
    } else {
      out.push(0x20);
    }
  }
  out.push(0x0a);
  return out;
}

export function getColumnsForPaper(paperType: PaperType = '80mm'): number {
  return paperType === '58mm' ? 32 : 48;
}

export function formatTwoColLine(left: string, right: string, cols = 48): string {
  const l = String(left || '');
  const r = String(right || '');
  const gap = Math.max(1, cols - l.length - r.length);
  if (l.length + r.length + 1 > cols) {
    const maxLeft = Math.max(8, cols - r.length - 1);
    return `${l.slice(0, maxLeft)} ${r}`;
  }
  return `${l}${' '.repeat(gap)}${r}`;
}

export function buildFeedAndCutTestEscPos(feedLines = 4, cutPaper = true): Uint8Array {
  const bytes: number[] = [
    0x1b, 0x40, // ESC @ init
    0x1b, 0x64, Math.max(2, Math.min(10, feedLines)), // ESC d n feed
  ];
  if (cutPaper) {
    bytes.push(0x1d, 0x56, 0x42, 0x00); // GS V 66 0 partial cut
  }
  return new Uint8Array(bytes);
}

export function buildArabicTestEscPos(options: {
  paperType?: PaperType;
  arabicEncoding?: ArabicEscPosEncoding;
  printerName?: string;
  cutPaper?: boolean;
} = {}): Uint8Array {
  const paperType = options.paperType === '58mm' ? '58mm' : '80mm';
  const encoding = options.arabicEncoding || 'CP864';
  const cols = getColumnsForPaper(paperType);
  const sep = '-'.repeat(cols);
  const bytes: number[] = [0x1b, 0x40]; // ESC @

  // Select codepage if CP864 (ESC t 22) or Windows-1256 (ESC t 37)
  if (encoding === 'CP864') {
    bytes.push(0x1b, 0x74, 22);
  } else if (encoding === 'WINDOWS_1256') {
    bytes.push(0x1b, 0x74, 37);
  }

  bytes.push(0x1b, 0x61, 0x01); // Center
  bytes.push(...encodeEscPosLine("LE PALAIS D'OR - GOLDEN PALACE", encoding));
  bytes.push(...encodeEscPosLine('مطعم القصر الذهبي', encoding));
  bytes.push(...encodeEscPosLine(`TEST ARABE / اختبار العربية (${paperType})`, encoding));
  bytes.push(...encodeEscPosLine(sep, encoding));

  bytes.push(0x1b, 0x61, 0x00); // Left
  bytes.push(...encodeEscPosLine(`Imprimante: ${options.printerName || 'CAFETERIA'}`, encoding));
  bytes.push(...encodeEscPosLine(`Encodage: ${encoding} | Largeur: ${cols} cols`, encoding));
  bytes.push(...encodeEscPosLine('جملة اختبار: مشاوي وأسماك طازجة يومياً', encoding));
  bytes.push(...encodeEscPosLine('اللام ألف: لا لأ لإ لآ — الأرقام 0123456789', encoding));
  bytes.push(...encodeEscPosLine(formatTwoColLine('Tajine Royal / طاجين', '1,500 DA', cols), encoding));
  bytes.push(...encodeEscPosLine(formatTwoColLine('TVA (0%)', '0 DA', cols), encoding));
  bytes.push(...encodeEscPosLine(formatTwoColLine('TOTAL', '1,500 DA', cols), encoding));
  bytes.push(...encodeEscPosLine(sep, encoding));

  bytes.push(0x1b, 0x64, 4);
  if (options.cutPaper !== false) {
    bytes.push(0x1d, 0x56, 0x42, 0x00);
  }
  return new Uint8Array(bytes);
}
