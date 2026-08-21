/**
 * Варианты-ориентиры: доминирующий цвет (нижняя граница качества)
 * и SVG-сетка с размытием (подход plaiceholder `.svg`).
 */

import sharp from 'sharp';
import { toHex } from '../oklab.mjs';
import { sampleGrid } from './css-gradient.mjs';

/**
 * Усредняет всё изображение до одного цвета.
 * @param input Буфер исходного изображения.
 * @returns `{ hex, bytes }` — самый дешёвый из возможных плейсхолдеров.
 */
export async function buildDominantColor(input) {
  const px = await sharp(input).resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const hex = toHex(px[0], px[1], px[2]);
  return { hex, bytes: Buffer.byteLength(hex, 'utf8') };
}

/**
 * Строит SVG из сетки прямоугольников под фильтром Гаусса.
 * Масштабируется без пикселизации и не требует ни JS, ни растрового кодека.
 * @param input Буфер исходного изображения.
 * @param cols Колонок сетки.
 * @param rows Строк сетки.
 * @returns `{ svg, dataUri, bytes }`.
 */
export async function buildSvgLqip(input, cols = 6, rows = 6) {
  const cells = await sampleGrid(input, cols, rows);

  const rects = cells
    .map(({ x, y, r, g, b }) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${toHex(r, g, b)}"/>`)
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none">` +
    `<filter id="b"><feGaussianBlur stdDeviation="0.6"/></filter>` +
    `<g filter="url(#b)">${rects}</g></svg>`;

  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  return { svg, dataUri, bytes: Buffer.byteLength(dataUri, 'utf8'), rawBytes: Buffer.byteLength(svg, 'utf8') };
}
