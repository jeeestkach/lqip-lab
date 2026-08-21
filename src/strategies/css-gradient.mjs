/**
 * Вариант 2 — стопка CSS-градиентов (подход plaiceholder `.css`).
 * Изображение уменьшается до сетки 4×4, каждая ячейка становится
 * radial-gradient. Ни одного байта data URI, чистый CSS, рисуется первым пейнтом.
 */

import sharp from 'sharp';
import { toHex } from '../oklab.mjs';

/**
 * Читает изображение как сетку усреднённых пикселей.
 * @param input Буфер исходного изображения.
 * @param cols Число колонок сетки.
 * @param rows Число строк сетки.
 * @returns Массив `{ r, g, b, x, y }` по строкам сверху вниз; x/y — индексы ячейки.
 */
export async function sampleGrid(input, cols, rows) {
  const { data } = await sharp(input)
    .resize(cols, rows, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = (y * cols + x) * 3;
      cells.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  return cells;
}

/**
 * Строит плейсхолдер из перекрывающихся радиальных градиентов по сетке 4×4.
 *
 * Прозрачный конец каждого градиента задаётся как `rgb(... / 0)`, а не `transparent`:
 * ключевое слово `transparent` это прозрачный ЧЁРНЫЙ, и при интерполяции оно
 * затемняет середину перехода грязным ореолом.
 *
 * @param input Буфер исходного изображения.
 * @returns `{ backgroundColor, backgroundImage, css, bytes }`.
 */
export async function buildCssGradient(input) {
  const cols = 4;
  const rows = 4;
  const cells = await sampleGrid(input, cols, rows);

  const base = await sharp(input).resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const backgroundColor = toHex(base[0], base[1], base[2]);

  const layers = cells.map(({ x, y, r, g, b }) => {
    const px = ((x + 0.5) / cols) * 100;
    const py = ((y + 0.5) / rows) * 100;
    const rgb = `${r} ${g} ${b}`;
    return `radial-gradient(${100 / cols}% ${100 / rows}% at ${px.toFixed(1)}% ${py.toFixed(1)}%, rgb(${rgb} / 1) 0%, rgb(${rgb} / 0) 100%)`;
  });

  const backgroundImage = layers.join(', ');
  const css = `background-color:${backgroundColor};background-image:${backgroundImage}`;

  return {
    backgroundColor,
    backgroundImage,
    css,
    bytes: Buffer.byteLength(css, 'utf8'),
    cellCount: cells.length,
  };
}
