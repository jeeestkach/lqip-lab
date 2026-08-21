/**
 * Вариант 1 — инлайн base64 LQIP: оригинал ужимается до 16–32 px, кодируется
 * в WebP/JPEG/AVIF и кладётся в разметку как data URI. Рисуется первым пейнтом,
 * без JS. Базовый рекомендованный вариант для SSR.
 */

import sharp from 'sharp';

/** Размер строки в байтах (не в символах — важно для не-ASCII). */
export const byteLength = (s) => Buffer.byteLength(s, 'utf8');

/**
 * Делает один вариант base64-плейсхолдера.
 * @param input Буфер исходного изображения.
 * @param opts `width` — ширина уменьшенной копии в px; `format` — webp|jpeg|avif;
 *   `quality` — качество кодека 1..100.
 * @returns Метрики варианта плюс готовый data URI.
 */
export async function makeBase64Lqip(input, { width, format, quality }) {
  const pipeline = sharp(input).resize({ width, fit: 'inside' });

  const encoded =
    format === 'webp' ? pipeline.webp({ quality })
    : format === 'avif' ? pipeline.avif({ quality })
    : pipeline.jpeg({ quality });

  const buffer = await encoded.toBuffer();
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;

  return {
    width,
    format,
    quality,
    rawBytes: buffer.length,
    dataUri,
    bytes: byteLength(dataUri),
  };
}

/**
 * Считает набор вариантов для сравнения: три кодека на «рабочем» размере
 * плюс WebP на нескольких размерах, чтобы был виден размен веса и узнаваемости.
 * @param input Буфер исходного изображения.
 * @returns `{ primary, codecs, sizes }` — primary это рекомендованный вариант.
 */
export async function buildBase64Set(input) {
  const codecs = await Promise.all([
    makeBase64Lqip(input, { width: 20, format: 'webp', quality: 40 }),
    makeBase64Lqip(input, { width: 20, format: 'jpeg', quality: 35 }),
    makeBase64Lqip(input, { width: 20, format: 'avif', quality: 35 }),
  ]);

  const sizes = await Promise.all(
    [8, 12, 16, 24, 32].map((width) =>
      makeBase64Lqip(input, { width, format: 'webp', quality: 40 }),
    ),
  );

  return { primary: codecs[0], codecs, sizes };
}
