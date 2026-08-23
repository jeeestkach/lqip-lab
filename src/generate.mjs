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
 * @param file Путь файла относительно input/ — может быть во вложенной папке.
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
    /*
     * В разметку уезжает ТОЛЬКО имя файла: рядом с ней, в dist/img/, лежит
     * плоский набор без вложенных папок. Полный путь нужен лишь для чтения.
     */
    file: path.basename(file),
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

/** Сколько примеров показывать: сравниваются способы, а не товары. */
const MAX_SAMPLES = 6;

/**
 * Собирает изображения из папки и всех вложенных.
 * @param dir Корень поиска.
 * @returns Пути относительно корня.
 */
async function collectImages(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const rel = prefix ? path.join(prefix, e.name) : e.name;
    if (e.isDirectory()) out.push(...(await collectImages(path.join(dir, e.name), rel)));
    else if (/\.(jpe?g|png|webp|avif)$/i.test(e.name)) out.push(rel);
  }
  return out;
}

/** Собирает dist/: копирует исходники и пишет index.html. */
async function main() {
  await mkdir(DIST_DIR, { recursive: true });
  await mkdir(path.join(DIST_DIR, 'img'), { recursive: true });

  /*
   * Изображения ищем и во вложенных папках.
   *
   * Раньше брались только те, что лежат прямо в input/, и сборка сломалась,
   * когда товарный каталог переехал в input/catalog/images/. Ошибка при этом
   * гласила «input/ пуст», хотя там полторы сотни файлов, — потому и не сразу
   * понятно, что случилось.
   *
   * Берём ограниченное число: исследование сравнивает СПОСОБЫ, и сотня рядов
   * одного и того же ничего не добавляет, а страница пухнет.
   */
  const files = (await collectImages(INPUT_DIR))
    .sort((a, b) => (path.basename(a) === PRIMARY ? -1 : path.basename(b) === PRIMARY ? 1 : a.localeCompare(b)))
    .slice(0, MAX_SAMPLES);

  if (files.length === 0) {
    throw new Error(`не нашёл изображений в ${INPUT_DIR} и вложенных папках`);
  }

  const results = [];
  for (const file of files) {
    process.stdout.write(`  считаю ${file} … `);
    const r = await analyse(file);
    const dest = path.join(DIST_DIR, 'img', path.basename(file));
    await copyFile(path.join(INPUT_DIR, file), dest);
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
