import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const ROOT_DIR = process.cwd();
const SVG_PATH = path.join(ROOT_DIR, 'public', 'icons', 'icon-512.svg');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const PNG_PATH = path.join(BUILD_DIR, 'icon.png');
const ICO_PATH = path.join(BUILD_DIR, 'icon.ico');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_ICO_SIZES = [16, 24, 32, 48, 64, 256];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validatePng(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24) return { ok: false, reason: `too small (${buf.length} B)` };
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return { ok: false, reason: 'invalid PNG signature' };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== 512 || height !== 512) {
    return { ok: false, reason: `unexpected dimensions ${width}x${height} (expected 512x512)` };
  }
  return { ok: true, size: buf.length, width, height, sha256: sha256File(filePath) };
}

function validateIco(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
  const buf = fs.readFileSync(filePath);
  if (buf.length < 22) return { ok: false, reason: `too small (${buf.length} B)` };
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  const count = buf.readUInt16LE(4);
  if (reserved !== 0 || type !== 1) {
    return { ok: false, reason: `invalid ICO header (reserved=${reserved}, type=${type})` };
  }
  if (count !== EXPECTED_ICO_SIZES.length) {
    return { ok: false, reason: `unexpected frame count ${count} (expected ${EXPECTED_ICO_SIZES.length})` };
  }
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > buf.length) return { ok: false, reason: `truncated directory entry ${i}` };
    const w = buf.readUInt8(off) || 256;
    const h = buf.readUInt8(off + 1) || 256;
    const bytesInRes = buf.readUInt32LE(off + 8);
    const imageOffset = buf.readUInt32LE(off + 12);
    if (w !== h) return { ok: false, reason: `non-square frame ${w}x${h}` };
    if (bytesInRes === 0 || imageOffset + bytesInRes > buf.length) {
      return { ok: false, reason: `frame ${i} out of bounds (offset=${imageOffset}, size=${bytesInRes}, file=${buf.length})` };
    }
    sizes.push(w);
  }
  sizes.sort((a, b) => a - b);
  if (JSON.stringify(sizes) !== JSON.stringify(EXPECTED_ICO_SIZES)) {
    return { ok: false, reason: `unexpected frame sizes [${sizes.join(', ')}]` };
  }
  return { ok: true, size: buf.length, frames: sizes, sha256: sha256File(filePath) };
}

function commandExists(cmd) {
  const probe = spawnSync(cmd, ['-version'], { encoding: 'utf8', stdio: 'pipe' });
  return !probe.error;
}

function runTool(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.error) {
    throw new Error(`${cmd} spawn error: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} exited with status ${res.status}: ${res.stderr || res.stdout}`);
  }
}

function main() {
  if (!fs.existsSync(SVG_PATH)) {
    console.error(`ERROR: Official SVG icon source missing: ${SVG_PATH}`);
    process.exit(1);
  }

  const existingPng = validatePng(PNG_PATH);
  const existingIco = validateIco(ICO_PATH);
  if (existingPng.ok && existingIco.ok) {
    console.log(
      `Desktop icons already valid:\n` +
      `  - build/icon.png: ${existingPng.size} bytes (${existingPng.width}x${existingPng.height}) SHA256=${existingPng.sha256}\n` +
      `  - build/icon.ico: ${existingIco.size} bytes (frames=${existingIco.frames.join(',')}) SHA256=${existingIco.sha256}`
    );
    return;
  }

  console.log(
    `Desktop icons require generation (png=${existingPng.ok ? 'ok' : existingPng.reason}, ico=${existingIco.ok ? 'ok' : existingIco.reason}).`
  );
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const hasMagick = commandExists('magick');
  const hasFfmpeg = commandExists('ffmpeg');
  const hasConvert = commandExists('convert');

  if (hasMagick) {
    console.log('Generating build/icon.png and build/icon.ico from public/icons/icon-512.svg via ImageMagick (magick)...');
    runTool('magick', [
      '-background', 'none',
      '-density', '384',
      SVG_PATH,
      '-resize', '512x512',
      '-define', 'png:color-type=6',
      PNG_PATH,
    ]);
    runTool('magick', [
      PNG_PATH,
      '-define', 'icon:auto-resize=256,64,48,32,24,16',
      ICO_PATH,
    ]);
  } else if (hasFfmpeg && hasConvert) {
    console.log('Generating build/icon.png (ffmpeg) and build/icon.ico (ImageMagick convert) from public/icons/icon-512.svg...');
    runTool('ffmpeg', [
      '-y',
      '-v', 'error',
      '-width', '512',
      '-height', '512',
      '-i', SVG_PATH,
      '-frames:v', '1',
      '-pix_fmt', 'rgba',
      PNG_PATH,
    ]);
    runTool('convert', [
      PNG_PATH,
      '-define', 'icon:auto-resize=256,64,48,32,24,16',
      ICO_PATH,
    ]);
  } else {
    console.error(
      'ERROR: Cannot generate missing desktop icons (build/icon.png, build/icon.ico). ' +
      'Install ImageMagick (magick) or ffmpeg+convert, or commit pre-generated build/icon.png and build/icon.ico.'
    );
    process.exit(1);
  }

  const finalPng = validatePng(PNG_PATH);
  const finalIco = validateIco(ICO_PATH);
  if (!finalPng.ok || !finalIco.ok) {
    console.error(
      `ERROR: Generated desktop icons failed binary validation (png=${finalPng.ok ? 'ok' : finalPng.reason}, ico=${finalIco.ok ? 'ok' : finalIco.reason}).`
    );
    process.exit(1);
  }

  console.log(
    `Generated and validated official desktop icons:\n` +
    `  - public/icons/icon-512.svg (preserved untouched): SHA256=${sha256File(SVG_PATH)}\n` +
    `  - build/icon.png: ${finalPng.size} bytes (${finalPng.width}x${finalPng.height}) SHA256=${finalPng.sha256}\n` +
    `  - build/icon.ico: ${finalIco.size} bytes (frames=${finalIco.frames.join(',')}) SHA256=${finalIco.sha256}`
  );
}

main();
