'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS = path.join(ROOT, 'docs', 'screenshots');
const HARNESS = path.join(SCREENSHOTS, '_harness.html');
const MANIFEST = path.join(SCREENSHOTS, 'manifest.json');
const SOURCE = path.join(ROOT, 'ha-smart-reports.js');
const RENDERER = path.join(ROOT, 'scripts', 'render-screenshots.mjs');

const VARIANTS = [
  { file: 'card-report-light.png', theme: 'light', viewport: 'desktop', width: 480 },
  { file: 'card-report-dark.png', theme: 'dark', viewport: 'desktop', width: 480 },
  { file: 'card-report-narrow.png', theme: 'light', viewport: 'narrow', width: 360 },
];

const PRIVACY_PATTERNS = [
  ['private identity', /\bmaciej\b|person\.maciej|phone_maciej/i],
  ['private IPv4', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/],
  ['MAC address', /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['local user path', /\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+/i],
  ['secret-like assignment', /\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+/i],
  ['private infrastructure', /\b(?:smtp|mqtt|nas|proxmox|frigate)[_.-][a-z0-9_-]+/i],
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertPrivacySafe(label, value) {
  for (const [name, pattern] of PRIVACY_PATTERNS) {
    assert.doesNotMatch(value, pattern, `${label} contains banned ${name}`);
  }
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'asset must be PNG');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', 'PNG must start with IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function pngChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    assert.ok(offset + 12 <= buffer.length, 'PNG chunk header is truncated');
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= buffer.length, 'PNG chunk payload is truncated');
    chunks.push({
      type: buffer.subarray(offset + 4, offset + 8).toString('ascii'),
      data: buffer.subarray(offset + 8, offset + 8 + length),
    });
    offset = end;
  }
  assert.equal(offset, buffer.length, 'PNG contains trailing bytes');
  return chunks;
}

test('screenshot harness is seeded, source-bound, deterministic, and offline', () => {
  const harness = readFileSync(HARNESS, 'utf8');
  for (const parameter of ['theme', 'viewport', 'seed', 'clock', 'source_sha256', 'locale', 'timezone']) {
    assert.match(harness, new RegExp(`params\\.get\\(['\"]${parameter}['\"]\\)`), `missing ${parameter} input`);
  }
  for (const attribute of [
    'data-source-sha256',
    'data-seed',
    'data-theme',
    'data-viewport',
    'data-locale',
    'data-timezone',
    'data-loading',
    'data-ready',
  ]) {
    assert.match(harness, new RegExp(attribute), `missing ${attribute} readback`);
  }
  assert.match(harness, /did not settle before the screenshot deadline/);
  assert.doesNotMatch(harness, /\bDate\.now\s*\(/, 'harness clock must be explicit');
  assert.doesNotMatch(harness, /\bsetInterval\s*\(/, 'harness must not retain nondeterministic intervals');
  assert.doesNotMatch(harness, /https?:\/\//i, 'harness must not use remote resources');
  assertPrivacySafe('harness', harness);
});

test('renderer exposes only the local harness and exact Smart Reports source', () => {
  const renderer = readFileSync(RENDERER, 'utf8');
  assert.match(renderer, /const servedPaths = new Map/);
  assert.match(renderer, /['\"]\/docs\/screenshots\/_harness\.html['\"]/);
  assert.match(renderer, /['\"]\/ha-smart-reports\.js['\"]/);
  assert.match(renderer, /servedPaths\.get\(url\.pathname\)/);
  assert.match(renderer, /Emulation\.setLocaleOverride/);
  assert.match(renderer, /Emulation\.setTimezoneOverride/);
  assert.match(renderer, /readback\.locale !== locale/);
  assert.match(renderer, /readback\.timezone !== timezone/);
  assert.match(renderer, /readback\.loading !== false/);
  assert.match(renderer, /await stopChrome\(chrome\?\.processHandle\)/);
  assert.match(renderer, /maxRetries:\s*[1-9]/);
  assert.doesNotMatch(renderer, /readFileSync\(absolutePath\)/, 'server must not expose arbitrary files');
});

test('all required current screenshot assets exist', () => {
  for (const variant of VARIANTS) {
    assert.ok(existsSync(path.join(SCREENSHOTS, variant.file)), `missing ${variant.file}`);
  }
});

test('manifest binds the exact source and two byte-identical renders', () => {
  assert.ok(existsSync(MANIFEST), 'missing docs/screenshots/manifest.json');
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['captures', 'fixture', 'renderer', 'schema_version', 'source'].sort());
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.source.path, 'ha-smart-reports.js');
  assert.equal(manifest.source.sha256, sha256(readFileSync(SOURCE)));
  assert.equal(manifest.fixture.locale, 'en-US');
  assert.equal(manifest.fixture.timezone, 'Europe/Warsaw');
  assert.match(manifest.fixture.clock, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  assert.match(manifest.fixture.seed, /^[a-z0-9-]+$/);
  assert.match(manifest.renderer.name, /chrome|chromium/i);
  assert.match(manifest.renderer.version, /^\d+(?:\.\d+){3}$/);
  assert.match(manifest.renderer.executable_sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.captures.length, VARIANTS.length);

  for (const variant of VARIANTS) {
    const capture = manifest.captures.find((item) => item.file === variant.file);
    assert.ok(capture, `missing manifest entry for ${variant.file}`);
    assert.equal(capture.theme, variant.theme);
    assert.equal(capture.viewport, variant.viewport);
    assert.equal(capture.pixel_width, variant.width);
    assert.ok(Number.isInteger(capture.pixel_height) && capture.pixel_height >= 600);
    assert.equal(capture.source_sha256, manifest.source.sha256);
    const image = readFileSync(path.join(SCREENSHOTS, variant.file));
    assert.deepEqual(pngDimensions(image), { width: capture.pixel_width, height: capture.pixel_height });
    const chunks = pngChunks(image);
    assert.equal(chunks[0] && chunks[0].type, 'IHDR');
    assert.equal(chunks.at(-1) && chunks.at(-1).type, 'IEND');
    for (const chunk of chunks) {
      assert.ok(['IHDR', 'IDAT', 'IEND'].includes(chunk.type), `${variant.file} contains forbidden ${chunk.type} metadata`);
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(chunk.type)) {
        assertPrivacySafe(`${variant.file} ${chunk.type} metadata`, chunk.data.toString('utf8'));
      }
    }
    assert.equal(capture.image_sha256, sha256(image));
    assert.deepEqual(capture.render_sha256_samples, [capture.image_sha256, capture.image_sha256]);
    assert.equal(capture.layout.horizontal_overflow, false);
    assert.deepEqual(capture.runtime, { locale: 'en-US', timezone: 'Europe/Warsaw', loading: false });
  }
  assertPrivacySafe('manifest', JSON.stringify(manifest));
});

test('OCR proves truthful synthetic data and privacy safety for every screenshot', () => {
  try {
    execFileSync('tesseract', ['--version'], { stdio: 'ignore' });
  } catch {
    assert.fail('tesseract is required for the screenshot privacy gate');
  }

  for (const variant of VARIANTS) {
    const imagePath = path.join(SCREENSHOTS, variant.file);
    assert.ok(existsSync(imagePath), `missing ${variant.file}`);
    const ocr = execFileSync('tesseract', [imagePath, 'stdout', '--psm', '6'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    assert.match(ocr, /Smart Reports/i, `${variant.file} lost the product title`);
    assert.match(ocr, /Gr.?d import/i, `${variant.file} lost the truthful total label`);
    assert.match(ocr, /Actual cost/i, `${variant.file} lost the truthful cost label`);
    assert.doesNotMatch(ocr, /697(?:[.,]0)?|104[.,]55|0[.,]15/, `${variant.file} retained stale inferred values`);
    assertPrivacySafe(`${variant.file} OCR`, ocr);
  }
});
