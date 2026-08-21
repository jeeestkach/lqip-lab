/**
 * Точка входа: считает все плейсхолдеры для входных изображений и собирает
 * статическую страницу-сравнение в dist/.
 */

import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

import { buildBase64Set } from './strategies/lqip-base64.mjs';
import { buildCssGradient } from './strategies/css-gradient.mjs';
import { buildLqipInt } from './strategies/lqip-int.mjs';
import { buildThumbHash, buildBlurHash } from './strategies/hashes.mjs';
import { buildDominantColor, buildSvgLqip } from './strategies/simple.mjs';
import { renderPage } from './render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_DIR = path.join(ROOT, 'input');
const DIST_DIR = path.join(ROOT, 'dist');

/** Имя файла, который показывается как основной пример. */
const PRIMARY = 'main.webp';

/**
 * Прогоняет одно изображение через все техники.
 * @param file Имя файла внутри input/.
 * @returns Полный набор метрик и артефактов для рендера.
 */
async function analyse(file) {
  const input = await readFile(path.join(INPUT_DIR, file));
  const meta = await sharp(input).metadata();

  const [base64, gradient, lqipInt, thumb, blur, dominant, svg] = await Promise.all([
    buildBase64Set(input),
    buildCssGradient(input),
    buildLqipInt(input),
    buildThumbHash(input),
    buildBlurHash(input),
    buildDominantColor(input),
    buildSvgLqip(input),
  ]);

  return {
    file,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    originalBytes: input.length,
    base64,
    gradient,
    lqipInt,
    thumb,
    blur,
    dominant,
    svg,
  };
}

/** Собирает dist/: копирует исходники и пишет index.html. */
async function main() {
  await mkdir(DIST_DIR, { recursive: true });
  await mkdir(path.join(DIST_DIR, 'img'), { recursive: true });

  const files = (await readdir(INPUT_DIR))
    .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
    .sort((a, b) => (a === PRIMARY ? -1 : b === PRIMARY ? 1 : a.localeCompare(b)));

  if (files.length === 0) throw new Error('input/ пуст — положите туда хотя бы одно изображение');

  const results = [];
  for (const file of files) {
    process.stdout.write(`  считаю ${file} … `);
    const r = await analyse(file);
    await copyFile(path.join(INPUT_DIR, file), path.join(DIST_DIR, 'img', file));
    results.push(r);
    console.log(`${r.width}×${r.height}, оригинал ${(r.originalBytes / 1024).toFixed(1)} КБ`);
  }

  const html = renderPage(results);
  await writeFile(path.join(DIST_DIR, 'index.html'), html, 'utf8');

  const pageBytes = Buffer.byteLength(html, 'utf8');
  console.log(`\n✓ dist/index.html — ${(pageBytes / 1024).toFixed(1)} КБ, изображений: ${results.length}`);
  console.log(`  открыть: open ${path.join(DIST_DIR, 'index.html')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
