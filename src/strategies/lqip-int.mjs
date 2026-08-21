/**
 * Вариант «одно число» (CSS-only LQIP по методу Lean Rada) — серверная часть:
 * снимает пиксели через sharp и отдаёт их в чистый упаковщик `lqip-format.mjs`.
 * Вся арифметика формата живёт там, чтобы браузерная демка считала ровно так же.
 *
 * Спецификация метода: https://leanrada.com/notes/css-only-lqip/
 */

import sharp from 'sharp';
import { rgbToOklab, oklabToRgb, toHex } from '../oklab.mjs';
import { packLqip, unpackBaseLab } from '../lqip-format.mjs';

export { lqipIntDecoderCss } from '../lqip-format.mjs';

/**
 * Кодирует изображение в одно 20-битное число.
 * @param input Буфер исходного изображения.
 * @returns `{ value, base, cells, fallbackHex, bytes }`; `value` — то самое число
 *   для `style="--lqip:…"`, `bytes` — его длина в разметке.
 */
export async function buildLqipInt(input) {
  const base1 = await sharp(input).resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const baseLab = rgbToOklab(base1[0], base1[1], base1[2]);

  // Шесть ячеек яркости, сетка 3 колонки × 2 строки, порядок слева направо.
  const { data } = await sharp(input)
    .resize(3, 2, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cellLs = [];
  for (let i = 0; i < 6; i += 1) {
    const o = i * 3;
    cellLs.push(rgbToOklab(data[o], data[o + 1], data[o + 2]).L);
  }

  const { value, ll, aaa, bbb, cells } = packLqip(baseLab, cellLs);

  // Тот же базовый цвет после квантования — нужен как fallback для браузеров
  // без mod()/round()/oklab(), где всё CSS-объявление отбрасывается целиком.
  const lab = unpackBaseLab(ll, aaa, bbb);
  const decoded = oklabToRgb(lab.L, lab.a, lab.b);

  return {
    value,
    base: { ll, aaa, bbb },
    cells,
    fallbackHex: toHex(decoded.r, decoded.g, decoded.b),
    bytes: Buffer.byteLength(String(value), 'utf8'),
  };
}
